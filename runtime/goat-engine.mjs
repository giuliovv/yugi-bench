// AGPL-3.0-or-later. This is the training bridge to the pinned external ocgcore.
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import * as X from "../vendor/goat-format-simulator/engine/browser/out/ocgcore.bundle.js";
import { scriptReader } from "../vendor/goat-format-simulator/engine/browser/out/scripts.bundle.js";
import { GoatDuel, LOC } from "../vendor/goat-format-simulator/engine/browser/src/duel.mjs";
import { makeTrivialResolver } from "../vendor/goat-format-simulator/engine/browser/src/trivial.js";
import { makeAutoPlayer } from "../vendor/goat-format-simulator/engine/browser/src/autopilot.mjs";

const base = new URL("../vendor/goat-format-simulator/engine/", import.meta.url);
const read = path => JSON.parse(readFileSync(new URL(path, base), "utf8"));
// BEGIN_SHARED_BRIDGE: bundled verbatim into the static browser opponent.
const cardData = read("browser/out/cards.subset.json");
const names = read("browser/out/names.subset.json");
const pool = new Set(read("data/goat-pool.json").map(Number));
const limits = read("data/goat-limites.json");
const cards = new Map(Object.values(cardData).map(card => [card.code, { ...card, race: BigInt(card.race) }]));
const T = X.OcgMessageType;
const R = X.OcgResponseType;
const IA = X.SelectIdleCMDAction;
const BA = X.SelectBattleCMDAction;
const FUSION_TYPE = 0x40;
const trivial = makeTrivialResolver(X);
const automatic = makeAutoPlayer(X);
const name = code => names[code]?.name ?? `Card #${code}`;
let duel;
let pending;
let actions = new Map();
let winner = null;
let coreErrors = [];
let revealed = new Set();

// BEGIN_DECISION_VISIBILITY
function visibleChoiceCode(prompt, reference) {
  const code = reference.code;
  if (!code) return null;
  const owner = reference.controller ?? prompt.player;
  const location = reference.location;
  if (owner === prompt.player || location === LOC.GRAVE) return code;
  const card = duel.zones[owner]?.[location]?.[reference.sequence];
  if (!card || card.code !== code) return null;
  if (location === LOC.HAND) return revealed.has(card.uid) ? code : null;
  if ([LOC.MZONE, LOC.SZONE, LOC.FZONE, LOC.REMOVED].includes(location)) {
    return !(card.position & 0x0a) ? code : null;
  }
  return null;
}

const choiceName = (prompt, reference) => {
  const code = visibleChoiceCode(prompt, reference);
  return code === null ? "Hidden card" : name(code);
};
// END_DECISION_VISIBILITY

function validateDecks(decks, extras) {
  if (!Array.isArray(decks) || decks.length !== 2) throw new Error("exactly two decks are required");
  if (!Array.isArray(extras) || extras.length !== 2) throw new Error("exactly two Fusion decks are required");
  for (const [player, deck] of decks.entries()) {
    if (!Array.isArray(deck) || deck.length < 40 || deck.length > 60) {
      throw new Error(`player ${player}: main deck must have 40-60 cards`);
    }
    const counts = new Map();
    for (const [zone, stack] of [["main", deck], ["extra", extras[player]]]) {
      if (!Array.isArray(stack)) throw new Error(`player ${player}: ${zone} deck must be an array`);
      for (const code of stack) {
      if (!Number.isInteger(code) || !pool.has(code) || !cards.has(code)) {
        throw new Error(`player ${player}: card ${code} is outside the bundled GOAT pool`);
      }
      const fusion = Boolean(cards.get(code).type & FUSION_TYPE);
      if (fusion !== (zone === "extra")) {
        throw new Error(`player ${player}: ${name(code)} is in the wrong deck`);
      }
      const count = (counts.get(code) ?? 0) + 1;
      if (count > (limits[code] ?? 3)) throw new Error(`player ${player}: too many copies of ${name(code)}`);
      counts.set(code, count);
      }
    }
  }
}

// BEGIN_DECISION_ACTIONS
function choiceList(prompt) {
  const out = [];
  const add = (kind, label, response, cardIds = []) => {
    const id = String(out.length);
    out.push({ id, kind, label, card_ids: cardIds });
    actions.set(id, response);
  };
  const indexed = (key, kind, action, type) => {
    for (const [index, card] of (prompt[key] ?? []).entries()) {
      const code = visibleChoiceCode(prompt, card);
      add(kind, `${kind.replaceAll("_", " ")} ${choiceName(prompt, card)}`,
        { type, action, index }, code === null ? [] : [code]);
    }
  };
  actions = new Map();
  switch (prompt.type) {
    case T.SELECT_IDLECMD:
      indexed("summons", "normal_summon", IA.SELECT_SUMMON, R.SELECT_IDLECMD);
      indexed("special_summons", "special_summon", IA.SELECT_SPECIAL_SUMMON, R.SELECT_IDLECMD);
      indexed("monster_sets", "set_monster", IA.SELECT_MONSTER_SET, R.SELECT_IDLECMD);
      indexed("spell_sets", "set_spell_trap", IA.SELECT_SPELL_SET, R.SELECT_IDLECMD);
      indexed("activates", "activate", IA.SELECT_ACTIVATE, R.SELECT_IDLECMD);
      indexed("pos_changes", "change_position", IA.SELECT_POS_CHANGE, R.SELECT_IDLECMD);
      if (prompt.to_bp) add("battle_phase", "Enter Battle Phase", { type: R.SELECT_IDLECMD, action: IA.TO_BP, index: null });
      if (prompt.to_ep) add("end_turn", "End turn", { type: R.SELECT_IDLECMD, action: IA.TO_EP, index: null });
      break;
    case T.SELECT_BATTLECMD:
      indexed("chains", "activate", BA.SELECT_CHAIN, R.SELECT_BATTLECMD);
      indexed("attacks", "attack", BA.SELECT_BATTLE, R.SELECT_BATTLECMD);
      if (prompt.to_m2) add("main2", "Enter Main Phase 2", { type: R.SELECT_BATTLECMD, action: BA.TO_M2, index: null });
      if (prompt.to_ep) add("end_turn", "End turn", { type: R.SELECT_BATTLECMD, action: BA.TO_EP, index: null });
      break;
    case T.SELECT_CHAIN:
      (prompt.selects ?? []).forEach((card, index) => {
        const code = visibleChoiceCode(prompt, card);
        add("chain", `Chain ${choiceName(prompt, card)}`, { type: R.SELECT_CHAIN, index },
          code === null ? [] : [code]);
      });
      if (!prompt.forced) add("pass", "Do not chain", { type: R.SELECT_CHAIN, index: null });
      break;
    case T.SELECT_EFFECTYN:
    case T.SELECT_YESNO: {
      const type = prompt.type === T.SELECT_EFFECTYN ? R.SELECT_EFFECTYN : R.SELECT_YESNO;
      add("yes", "Yes", { type, yes: true });
      add("no", "No", { type, yes: false });
      break;
    }
    case T.SELECT_OPTION:
      (prompt.options ?? []).forEach((_, index) => add("option", `Option ${index + 1}`, { type: R.SELECT_OPTION, index }));
      break;
    case T.SELECT_POSITION:
      for (const [bit, label] of [[1, "Face-up attack"], [2, "Face-down attack"], [4, "Face-up defense"], [8, "Face-down defense"]]) {
        if (prompt.positions & bit) add("position", label, { type: R.SELECT_POSITION, position: bit });
      }
      break;
    case T.SELECT_CARD:
    case T.SELECT_TRIBUTE: {
      const type = prompt.type === T.SELECT_CARD ? R.SELECT_CARD : R.SELECT_TRIBUTE;
      const selects = prompt.selects ?? [];
      const min = Math.max(0, prompt.min ?? 1);
      const max = Math.min(selects.length, prompt.max ?? min);
      const combinations = (n, k) => {
        let count = 1;
        for (let i = 1; i <= k; i++) count = count * (n - i + 1) / i;
        return count;
      };
      const count = Array.from({ length: Math.max(0, max - min + 1) }, (_, i) => combinations(selects.length, min + i))
        .reduce((total, value) => total + value, 0);
      if (count > 256) {
        const response = automatic(prompt, 0);
        if (!response) throw new Error(`cannot resolve large card selection prompt ${prompt.type}`);
        add("automatic_choice", `Use default response among ${count} card choices`, response);
        break;
      }
      const visit = (start, chosen, size) => {
        if (chosen.length === size) {
          const codes = chosen.map(i => visibleChoiceCode(prompt, selects[i]));
          add("select_cards", chosen.map(i => choiceName(prompt, selects[i])).join(", ") || "Select none",
            { type, indicies: chosen }, codes.filter(code => code !== null));
          return;
        }
        for (let i = start; i <= selects.length - (size - chosen.length); i++) visit(i + 1, [...chosen, i], size);
      };
      for (let size = min; size <= max; size++) visit(0, [], size);
      if (prompt.can_cancel) add("cancel", "Cancel", { type, indicies: null });
      break;
    }
    default: {
      // The rules core still resolves these prompts, but the agent has only
      // one explicit deterministic fallback until that response is enumerated.
      const response = automatic(prompt, 0);
      if (!response) throw new Error(`unsupported core prompt type ${prompt.type}`);
      add("automatic_choice", `Use default response to prompt ${prompt.type}`, response);
    }
  }
  if (!out.length) throw new Error(`no response generated for core prompt ${prompt.type}`);
  return out;
}

function cardView(card, zone) {
  const faceUp = !(card.position & 0x0a);
  return {
    instance_id: String(card.uid), zone, face_up: faceUp,
    card_id: faceUp ? card.code : null, position: String(card.position)
  };
}

function playerView(player) {
  const z = duel.zones[player];
  const visible = (location, label) => z[location].flatMap((card, i) => card ? [cardView(card, `${label}:${i}`)] : []);
  return {
    life_points: duel.lp[player], deck_count: z[LOC.DECK].length,
    hand_count: z[LOC.HAND].length,
    graveyard: z[LOC.GRAVE].map(card => card.code),
    banished: visible(LOC.REMOVED, "banished"),
    monsters: visible(LOC.MZONE, "monster"),
    spells_traps: [...visible(LOC.SZONE, "spell_trap"), ...visible(LOC.FZONE, "field")]
  };
}

function phaseName(phase) {
  if (phase === X.OcgPhase.DRAW) return "draw";
  if (phase === X.OcgPhase.STANDBY) return "standby";
  if (phase === X.OcgPhase.MAIN1) return "main1";
  if (phase === X.OcgPhase.MAIN2) return "main2";
  if (phase === X.OcgPhase.END) return "end";
  return "battle";
}

function state() {
  const player = pending?.player ?? duel.turnPlayer;
  const z = duel.zones[player];
  return {
    observation: {
      player,
      public: {
        turn: duel.turnCount, turn_player: duel.turnPlayer,
        phase: phaseName(duel.phase), priority_player: player,
        chain_length: duel.cadena.length,
        players: [playerView(0), playerView(1)]
      },
      own_hand: z[LOC.HAND].map(card => card.code),
      own_face_down: [...z[LOC.MZONE], ...z[LOC.SZONE], ...z[LOC.FZONE]]
        .filter(card => card && (card.position & 0x0a))
        .map(card => [String(card.uid), card.code]),
      own_extra: z[LOC.EXTRA].map(card => card.code),
      legal_actions: pending ? choiceList(pending) : []
    },
    rewards: winner === 0 ? [1, -1] : winner === 1 ? [-1, 1] : [0, 0],
    terminated: duel.finished, truncated: false, winner,
    core_errors: coreErrors
  };
}
// END_DECISION_ACTIONS

async function advance() {
  for (let i = 0; i < 500; i++) {
    pending = await duel.run();
    if (duel.finished || !pending) { pending = null; return state(); }
    const response = trivial(pending);
    if (!response) return state();
    duel.respond(response);
  }
  throw new Error("core did not reach a decision after 500 automatic steps");
}

async function reset({ seed, decks, extras = [[], []] }) {
  if (duel) throw new Error("one duel per worker; start a new worker to reset");
  if (!Number.isSafeInteger(seed) || seed < 0) throw new Error("seed must be a nonnegative safe integer");
  validateDecks(decks, extras);
  winner = null;
  coreErrors = [];
  revealed = new Set();
  const lib = await X.default({ sync: true });
  duel = new GoatDuel({ lib, X, cardDb: cards, scriptReader, onEvent: event => {
    if (event.t === "win") winner = event.player;
    if (event.t === "coreError") coreErrors.push(event.text);
    if (event.t === "revelar") for (const uid of event.uids) revealed.add(uid);
    if (event.t === "chainEnd") revealed.clear();
  } });
  const start = BigInt(seed);
  await duel.create({ deck0: decks[0], deck1: decks[1], extra0: extras[0], extra1: extras[1],
    seed: [start + 1n, start + 7n, start + 13n, start + 29n] });
  return advance();
}

async function step({ action_id }) {
  if (!duel || !pending) throw new Error("no pending decision");
  if (!actions.has(action_id)) throw new Error(`illegal action: ${action_id}`);
  duel.respond(actions.get(action_id));
  return advance();
}

// END_SHARED_BRIDGE
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  try {
    const command = JSON.parse(line);
    const result = command.op === "reset" ? await reset(command)
      : command.op === "step" ? await step(command)
      : (() => { throw new Error(`unknown operation ${command.op}`); })();
    process.stdout.write(JSON.stringify({ ok: true, ...result }) + "\n");
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: String(error.message ?? error) }) + "\n");
  }
}
