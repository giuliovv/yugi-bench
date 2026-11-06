/* Browser port of the Python state/action features and deterministic policy. */
const MASK = (1n << 64n) - 1n;
const IV = [
  0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n,
  0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n,
];
const SIGMA = [
  [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15],
  [14,10,4,8,9,15,13,6,1,12,0,2,11,7,5,3],
  [11,8,12,0,5,2,15,13,10,14,3,6,7,1,9,4],
  [7,9,3,1,13,12,11,14,2,6,5,10,4,0,15,8],
  [9,0,5,7,2,4,10,15,14,1,11,12,6,8,3,13],
  [2,12,6,10,0,11,8,3,4,13,7,5,15,14,1,9],
  [12,5,1,15,14,13,4,10,0,7,6,3,9,2,8,11],
  [13,11,7,14,12,1,3,9,5,0,15,4,8,6,2,10],
  [6,15,14,9,11,3,0,8,12,2,13,7,1,4,10,5],
  [10,2,8,4,7,6,1,5,15,11,9,14,3,12,13,0],
];
const hashCache = new Map();
const rot = (x, n) => ((x >> BigInt(n)) | (x << BigInt(64 - n))) & MASK;

export function bucket(value, size) {
  const key = `${size}:${value}`;
  if (hashCache.has(key)) return hashCache.get(key);
  const bytes = new TextEncoder().encode(value);
  const h = IV.slice();
  h[0] ^= 0x01010008n; // BLAKE2b, 8-byte digest, no key.
  for (let offset = 0; offset < bytes.length || offset === 0; offset += 128) {
    const block = bytes.subarray(offset, offset + 128);
    const m = Array(16).fill(0n);
    for (let i = 0; i < block.length; i++) m[i >> 3] |= BigInt(block[i]) << BigInt((i & 7) * 8);
    const v = [...h, ...IV];
    v[12] ^= BigInt(offset + block.length);
    if (offset + block.length === bytes.length) v[14] ^= MASK;
    const g = (a, b, c, d, x, y) => {
      v[a] = (v[a] + v[b] + x) & MASK;
      v[d] = rot(v[d] ^ v[a], 32);
      v[c] = (v[c] + v[d]) & MASK;
      v[b] = rot(v[b] ^ v[c], 24);
      v[a] = (v[a] + v[b] + y) & MASK;
      v[d] = rot(v[d] ^ v[a], 16);
      v[c] = (v[c] + v[d]) & MASK;
      v[b] = rot(v[b] ^ v[c], 63);
    };
    for (let round = 0; round < 12; round++) {
      const s = SIGMA[round % 10];
      g(0,4,8,12,m[s[0]],m[s[1]]); g(1,5,9,13,m[s[2]],m[s[3]]);
      g(2,6,10,14,m[s[4]],m[s[5]]); g(3,7,11,15,m[s[6]],m[s[7]]);
      g(0,5,10,15,m[s[8]],m[s[9]]); g(1,6,11,12,m[s[10]],m[s[11]]);
      g(2,7,8,13,m[s[12]],m[s[13]]); g(3,4,9,14,m[s[14]],m[s[15]]);
    }
    for (let i = 0; i < 8; i++) h[i] ^= v[i] ^ v[i + 8];
  }
  const result = Number(h[0] % BigInt(size));
  hashCache.set(key, result);
  return result;
}

const KINDS = ["normal_summon","special_summon","set_monster","set_spell_trap","activate",
  "change_position","battle_phase","main2","end_turn","chain","pass","yes","no",
  "option","position","select_cards","cancel","attack","automatic_choice","select_tribute","other"];
const PHASES = ["draw","standby","main1","battle","main2","end"];
const bag = codes => {
  const out = Array(32).fill(0);
  for (const code of codes) out[bucket(String(code), 32)]++;
  return out.map(n => n / Math.max(1, codes.length));
};
const visible = cards => cards.filter(card => card.card_id !== null).map(card => card.card_id);

export function stateFeatures(obs) {
  const own = obs.public.players[obs.player], other = obs.public.players[1 - obs.player];
  const scalars = [...PHASES.map(phase => Number(obs.public.phase === phase)),
    Math.min(obs.public.turn, 40) / 40, Number(obs.public.turn_player === obs.player),
    own.life_points / 8000, other.life_points / 8000,
    own.hand_count / 10, other.hand_count / 10, own.deck_count / 60, other.deck_count / 60,
    own.monsters.length / 5, other.monsters.length / 5,
    own.spells_traps.length / 6, other.spells_traps.length / 6,
    own.graveyard.length / 40, other.graveyard.length / 40,
    Math.min(obs.public.chain_length, 10) / 10];
  return [...scalars,
    ...bag(obs.own_hand), ...bag(obs.own_face_down.map(pair => pair[1])),
    ...bag(visible([...own.monsters, ...own.spells_traps])),
    ...bag(visible([...other.monsters, ...other.spells_traps])),
    ...bag(own.graveyard), ...bag(other.graveyard), ...bag(obs.own_extra),
    ...bag(visible(own.banished)), ...bag(visible(other.banished))];
}

export function actionFeatures(action) {
  const out = Array(KINDS.length + 64).fill(0);
  const kind = KINDS.indexOf(action.kind);
  out[kind < 0 ? KINDS.length - 1 : kind] = 1;
  const tokens = action.label.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  for (const token of tokens) out[KINDS.length + bucket(token, 32)] += 1 / tokens.length;
  const cardBag = bag(action.card_ids);
  for (let i = 0; i < 32; i++) out[KINDS.length + 32 + i] = cardBag[i];
  return out;
}

export function chooseAction(obs, weights) {
  const state = stateFeatures(obs);
  if (state.length !== weights.w_state.length) throw new Error("Policy state feature version mismatch");
  const hidden = weights.hidden[0];
  const h = Array(hidden).fill(0).map((_, j) => {
    let value = weights.b_state[j];
    for (let i = 0; i < state.length; i++) value += state[i] * weights.w_state[i][j];
    return Math.tanh(value);
  });
  let best = -Infinity, choice = 0;
  for (let a = 0; a < obs.legal_actions.length; a++) {
    const features = actionFeatures(obs.legal_actions[a]);
    const input = [...h, ...features];
    let logit = weights.b_logit[0];
    for (let j = 0; j < hidden; j++) {
      let value = weights.b_policy[j];
      for (let i = 0; i < input.length; i++) value += input[i] * weights.w_policy[i][j];
      logit += Math.tanh(value) * weights.w_logit[j];
    }
    if (logit > best) { best = logit; choice = a; }
  }
  return choice;
}
