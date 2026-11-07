import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("Trap Dustshoot opponent-hand selection renders and submits a legal card", () => {
  const source = readFileSync(new URL("../hotseat/main.js", import.meta.url), "utf8");
  const start = source.indexOf("function ask(m){");
  const end = source.indexOf("function placeFromDrop(m){", start);
  assert.ok(start >= 0 && end > start);
  let options, response;
  const messageTypes = { SELECT_CARD: 15, SELECT_TRIBUTE: 20, SELECT_UNSELECT_CARD: 26 };
  const OCG = { OcgMessageType: messageTypes, OcgResponseType: messageTypes };
  const V = {
    setZoneViewClose() {}, markTargets() {}, setHandlers() {},
    momento: () => null, momentoTexto: () => "",
    closeZoneView() {}, quitarPrevia() {},
  };
  const ask = new Function("OCG", "V", "duel", "document", "panel", "conMomento",
    "T", "nm", "LOCNAME", "hidePanel", "respondLogged", "loop", "msgName",
    `${source.slice(start, end)}; return ask;`)(
    OCG, V, { resolve: c => ({ uid: c.sequence + 1 }) },
    { getElementById: () => ({ style: { display: "block" } }) },
    (_title, choices) => { options = choices; }, title => title,
    value => value, code => `Card ${code}`, { 2: "hand" },
    () => {}, value => { response = value; }, () => {}, () => "SELECT_CARD",
  );
  ask({ type: 15, player: 0, min: 1, max: 1, can_cancel: false,
    selects: [{ code: 71413901, controller: 1, location: 2, sequence: 1 }] });
  assert.match(options[0].label, /Card 71413901 \(hand\)/);
  options[0].run();
  assert.deepEqual(response, { type: 15, indicies: [0] });
});
