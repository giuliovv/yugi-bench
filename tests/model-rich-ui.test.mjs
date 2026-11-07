import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));

test("rich board's bundled model plays legal actions in a real duel", async () => {
  execFileSync("node", ["infra/build-play.mjs"], { cwd: new URL("..", import.meta.url) });
  const html = readFileSync(new URL("../web/play.html", import.meta.url), "utf8");
  assert.match(html, /id="irModelo"/);
  assert.match(html, /id="irJugar"/);
  assert.match(html, /id="irLLM"/);
  assert.match(html, /<select id="llmModel"><\/select>/);
  assert.match(html, /claude-sonnet-5-5/);
  assert.match(html, /claude-opus-5-5/);
  const script = html.split('<script type="module">')[1].split("</script>")[0];
  const bundled = script.slice(0, script.indexOf("const CARDS ="));
  const { createModelAdapter, GoatDuel, LOC, Policy, MODEL_WEIGHTS, __OCG__,
    scriptReader, makeTrivialResolver, makeAutoPlayer } = new Function(
    `${bundled}; return {createModelAdapter,GoatDuel,LOC,Policy,MODEL_WEIGHTS,__OCG__,` +
      `scriptReader,makeTrivialResolver,makeAutoPlayer};`
  )();
  const cards = read("../vendor/goat-format-simulator/engine/browser/out/cards.subset.json");
  const names = read("../vendor/goat-format-simulator/engine/browser/out/names.subset.json");
  const decks = read("../vendor/goat-format-simulator/engine/data/mazos.json");
  const cardDb = new Map(Object.values(cards).map(card => [card.code,
    { ...card, race: BigInt(card.race) }]));
  let adapter;
  const lib = await __OCG__.createCore({ sync: true });
  const duel = new GoatDuel({ lib, X: __OCG__, cardDb, scriptReader,
    onEvent: event => adapter?.onEvent(event) });
  adapter = createModelAdapter({ duel, X: __OCG__, names, LOC,
    automatic: makeAutoPlayer(__OCG__) });
  const trivial = makeTrivialResolver(__OCG__);
  await duel.create({ deck0: decks[0].main, deck1: decks[1].main,
    extra0: decks[0].extra, extra1: decks[1].extra, seed: [42n, 7n, 13n, 29n] });

  let modelActions = 0;
  for (let i = 0; i < 600 && !duel.finished; i++) {
    const prompt = await duel.run();
    if (!prompt) break;
    const trivialResponse = trivial(prompt);
    if (trivialResponse) { duel.respond(trivialResponse); continue; }
    const observation = adapter.describe(prompt);
    assert.ok(observation.legal_actions.length > 0);
    const choice = prompt.player === 1
      ? Policy.chooseAction(observation, MODEL_WEIGHTS) : 0;
    const action = observation.legal_actions[choice];
    assert.ok(action);
    const response = adapter.response(action.id);
    assert.ok(response);
    duel.respond(response);
    if (prompt.player === 1) modelActions++;
  }
  assert.ok(modelActions > 20, `expected many model decisions, got ${modelActions}`);
  assert.ok(duel.turnCount > 3);
});
