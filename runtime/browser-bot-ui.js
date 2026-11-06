const $ = id => document.getElementById(id);
const decks = DECKS.filter(deck => !deck.aviso && deck.main.length >= 40);
const deckOption = (select, index) => {
  for (const [i, deck] of decks.entries()) {
    const option = document.createElement("option");
    option.value = String(i);
    option.textContent = deck.nombre;
    select.append(option);
  }
  select.value = String(Math.min(index, decks.length - 1));
};
deckOption($("human-deck"), 0);
deckOption($("model-deck"), 1);

let humanSeat = 0;
let busy = false;
let decisions = 0;
const cardName = code => code == null ? "Face-down card" : NAMES[code]?.name ?? `Card #${code}`;
const status = (message, error = false) => {
  $("status").textContent = message;
  $("status").classList.toggle("error", error);
};
const addText = (parent, tag, text, className) => {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  parent.append(element);
  return element;
};

function zone(parent, title, cards, ownHidden = new Map()) {
  const section = addText(parent, "div", "", "zone");
  addText(section, "h3", title);
  const row = addText(section, "div", "", "cards");
  if (!cards.length) { addText(row, "span", "Empty", "empty"); return; }
  for (const card of cards) {
    const code = card.face_up ? card.card_id : ownHidden.get(card.instance_id);
    const tile = addText(row, "div", cardName(code), `card${card.face_up ? "" : " facedown"}`);
    addText(tile, "small", card.face_up ? "Face up" : "Set");
  }
}

function side(parent, title, player, hand, ownHidden) {
  parent.replaceChildren();
  const wrapper = addText(parent, "div", "", "side");
  const heading = addText(wrapper, "h2", title);
  addText(heading, "small", `${player.life_points} LP`);
  addText(wrapper, "div", `Deck ${player.deck_count} · Hand ${player.hand_count} · Graveyard ${player.graveyard.length}`, "meta");
  zone(wrapper, "Monsters", player.monsters, ownHidden);
  zone(wrapper, "Spells & traps", player.spells_traps, ownHidden);
  if (hand) {
    const section = addText(wrapper, "div", "", "zone");
    addText(section, "h3", "Your hand");
    const row = addText(section, "div", "", "cards");
    for (const code of hand) addText(row, "div", cardName(code), "card");
  }
}

function render(obs) {
  const own = obs.public.players[humanSeat], other = obs.public.players[1 - humanSeat];
  side($("opponent"), "Model", other, null, new Map());
  side($("human"), "You", own, obs.own_hand, new Map(obs.own_face_down));
  $("choice-title").textContent = `Turn ${obs.public.turn} · ${obs.public.phase}`;
  $("choice-note").textContent = "Choose one legal action. The model sees only its own player-safe observation.";
  const list = $("actions");
  list.replaceChildren();
  for (const [index, action] of obs.legal_actions.entries()) {
    const button = addText(list, "button", "", "action");
    button.type = "button";
    addText(button, "span", String(index + 1).padStart(2, "0"));
    addText(button, "strong", action.label);
    button.onclick = () => play(action.id);
  }
  $("game").classList.remove("hidden");
  status(`Your decision · turn ${obs.public.turn}`);
}

async function advance(result) {
  let botMoves = 0;
  while (!result.terminated && result.observation.legal_actions.length) {
    if (++decisions > 3000) throw new Error("Safety limit: duel exceeded 3000 decisions. Reload to try again.");
    const obs = result.observation;
    if (obs.player === humanSeat) {
      if (obs.legal_actions.length !== 1 || obs.legal_actions[0].kind !== "automatic_choice") {
        render(obs);
        if (botMoves) $("choice-note").textContent = `Model made ${botMoves} decisions. Choose a legal action; hidden cards remain hidden.`;
        return;
      }
      result = await Bridge.step({ action_id: obs.legal_actions[0].id });
    } else {
      status("Model is deciding…");
      const choice = Policy.chooseAction(obs, WEIGHTS);
      result = await Bridge.step({ action_id: obs.legal_actions[choice].id });
      botMoves++;
    }
    if (decisions % 8 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  $("actions").replaceChildren();
  const winner = result.winner;
  const message = result.terminated ? winner == null ? "Draw." : winner === humanSeat ? "You win!" : "The model wins!" : "Duel stopped without a result.";
  $("result").textContent = message;
  $("result").classList.remove("hidden");
  status(`${message} Reload to start a new duel.`);
}

async function play(actionId) {
  if (busy) return;
  busy = true;
  $("actions").querySelectorAll("button").forEach(button => button.disabled = true);
  try { await advance(await Bridge.step({ action_id: actionId })); }
  catch (error) { console.error(error); status(`Duel error: ${error.message ?? error}`, true); }
  finally { busy = false; }
}

$("start").onclick = async () => {
  if (busy) return;
  busy = true;
  $("start").disabled = true;
  humanSeat = Number($("human-seat").value);
  const humanDeck = decks[Number($("human-deck").value)];
  const modelDeck = decks[Number($("model-deck").value)];
  const order = humanSeat === 0 ? [humanDeck, modelDeck] : [modelDeck, humanDeck];
  try {
    status("Loading GOAT rules and starting duel…");
    const seed = Math.floor(Math.random() * 0x7fffffff);
    const result = await Bridge.reset({ seed, decks: order.map(deck => deck.main), extras: order.map(deck => deck.extra) });
    $("setup").classList.add("hidden");
    await advance(result);
  } catch (error) {
    console.error(error);
    status(`Could not start duel: ${error.message ?? error}`, true);
    $("start").disabled = false;
  } finally { busy = false; }
};
