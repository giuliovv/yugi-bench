import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { actionFeatures, bucket, chooseAction, stateFeatures } from "../runtime/browser-policy.js";

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const fixtures = read("./fixtures/browser-policy.json");
const weights = read("../models/smoke_policy.json");

test("BLAKE2b buckets and policy choices match Python fixtures", () => {
  assert.equal(bucket("", 32), 4);
  assert.equal(bucket("éclair", 32), 18);
  assert.equal(bucket("a".repeat(200), 32), 20);
  for (const fixture of fixtures) {
    const state = stateFeatures(fixture.observation);
    assert.equal(state.length, fixture.state.length);
    state.forEach((value, i) => assert.ok(Math.abs(value - fixture.state[i]) < 1e-6));
    fixture.observation.legal_actions.forEach((action, index) => {
      const features = actionFeatures(action);
      features.forEach((value, i) => assert.ok(Math.abs(value - fixture.actions[index][i]) < 1e-6));
    });
    assert.equal(chooseAction(fixture.observation, weights), fixture.choice);
  }
});

test("generated static page starts a rules-valid duel and advances a model move", async () => {
  execFileSync("node", ["infra/build-bot.mjs"], { cwd: new URL("..", import.meta.url) });
  const html = readFileSync(new URL("../web/bot.html", import.meta.url), "utf8");
  const script = html.split("<script>")[1].split("</script>")[0];
  const engineCode = script.slice(0, script.indexOf("const $ ="));
  assert.ok(engineCode.includes("const Bridge ="));
  const { Bridge, Policy, WEIGHTS, DECKS } = new Function(`${engineCode}; return {Bridge, Policy, WEIGHTS, DECKS};`)();
  const decks = DECKS.filter(deck => !deck.aviso && deck.main.length >= 40);
  const first = await Bridge.reset({ seed:42, decks:[decks[0].main, decks[1].main],
    extras:[decks[0].extra, decks[1].extra] });
  assert.equal(first.core_errors.length, 0);
  assert.ok(first.observation.legal_actions.length > 0);
  const choice = Policy.chooseAction(first.observation, WEIGHTS);
  const second = await Bridge.step({ action_id:first.observation.legal_actions[choice].id });
  assert.equal(second.core_errors.length, 0);
  assert.ok(second.observation.legal_actions.length > 0);
});

test("browser controls start a duel and accept a human action", async () => {
  const html = readFileSync(new URL("../web/bot.html", import.meta.url), "utf8");
  const script = html.split("<script>")[1].split("</script>")[0];
  class Element {
    constructor(tag = "div") {
      this.tag = tag;
      this.children = [];
      this.value = "";
      this.classes = new Set();
      this.classList = {
        add: name => this.classes.add(name),
        remove: name => this.classes.delete(name),
        toggle: (name, on) => on ? this.classes.add(name) : this.classes.delete(name),
      };
    }
    set textContent(value) { this.text = value; this.children = []; }
    get textContent() { return (this.text ?? "") + this.children.map(child => child.textContent).join(""); }
    append(child) { this.children.push(child); }
    replaceChildren(...children) { this.children = children; }
    querySelectorAll(tag) { return this.children.flatMap(child => [child, ...child.querySelectorAll(tag)]).filter(child => child.tag === tag); }
  }
  const ids = new Map();
  const document = {
    getElementById: id => { if (!ids.has(id)) ids.set(id, new Element()); return ids.get(id); },
    createElement: tag => new Element(tag),
  };
  const shuffleMain = new Function("document", `${script}; return shuffleMain;`)(document);
  const cards = [1, 2, 3, 4];
  assert.deepEqual(shuffleMain(cards, () => 0), [2, 3, 4, 1]);
  assert.deepEqual(cards, [1, 2, 3, 4]);
  assert.ok(ids.get("human-deck").children.length >= 2);
  document.getElementById("human-seat").value = "0";
  await ids.get("start").onclick();
  assert.ok(ids.get("actions").children.length > 0);
  assert.match(ids.get("status").textContent, /Your decision/);
  const endTurn = ids.get("actions").children.find(button => /End turn/.test(button.textContent));
  assert.ok(endTurn);
  await endTurn.onclick();
  assert.ok(ids.get("actions").children.length > 0);
  assert.match(ids.get("choice-note").textContent, /Model made/);
});
