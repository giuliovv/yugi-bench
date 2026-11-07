import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("Trap Dustshoot opponent-hand selection renders and submits a legal card", () => {
  const source = readFileSync(new URL("../hotseat/main.js", import.meta.url), "utf8")
    .replace(/^export\s+(const|function|class|async function|let)/gm, "$1");
  let options, response;
  const messageTypes = { SELECT_CARD: 15, SELECT_TRIBUTE: 20, SELECT_UNSELECT_CARD: 26 };
  const OCG = { OcgMessageType: messageTypes, OcgResponseType: messageTypes };
  const V = {
    setZoneViewClose() {}, markTargets() {}, setHandlers() {},
    momento: () => null, momentoTexto: () => "",
    closeZoneView() {}, quitarPrevia() {}, setControles() {},
  };
  const context = { OCG, V, duel: { resolve: c => ({ uid: c.sequence + 1 }) },
    panel: (_title, choices) => { options = choices; },
    respond: value => { response = value; } };
  const document = { getElementById: id => id === "ptimer" ? null : { style: { display: "block" } } };
  // Evaluate the whole module, not a sliced ask() with an injected translator.
  const { ask, T } = new Function("context", "document", `${source};
    OCG=context.OCG; V=context.V; duel=context.duel;
    NAMES={71413901:{name:"Breaker the Magical Warrior"}};
    panel=context.panel; respondLogged=context.respond; loop=()=>{};
    return {ask,T};`)(context, document);
  assert.equal(typeof T, "function");
  ask({ type: 15, player: 0, min: 1, max: 1, can_cancel: false,
    selects: [{ code: 71413901, controller: 1, location: 2, sequence: 1 }] });
  assert.match(options[0].label, /Breaker the Magical Warrior \(mano\)/);
  options[0].run();
  assert.deepEqual(response, { type: 15, indicies: [0] });
});
