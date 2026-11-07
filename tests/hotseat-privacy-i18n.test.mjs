import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { setIdioma, T } from "../hotseat/i18n.js";
import { canRenderFront } from "../hotseat/view.js";

test("English UI translates dynamic deck, prompt, and phase text", () => {
  setIdioma("en");
  assert.match(T('Con "automáticas" solo se te pregunta cuando hay algo real a lo que responder. En el turno del rival siempre se pregunta.'), /With automatic windows/);
  assert.equal(T("40 cartas · validado contra la lista oficial"), "40 cards · checked against the official list");
  assert.equal(T("⚠ 38 cartas: el Main Deck necesita 40 como mínimo"), "⚠ 38 cards: Main Deck needs at least 40");
  assert.equal(T("12 cartas posibles · escribe para filtrar"), "12 possible cards · type to filter");
  assert.equal(T("3+ coincidencias"), "3+ matches");
  assert.equal(T("Declaración de ataque"), "Attack declaration");
  assert.equal(T("2/4 dificultades"), "2/4 difficulties");
  assert.equal(T("elegidas"), "selected");
  assert.equal(T("→ Terminar turno"), "→ End turn");
  setIdioma("es");
  assert.equal(T("elegidas"), "elegidas");
  setIdioma("en");
});

test("hidden opponent cards never get front markup in the rich board", () => {
  assert.equal(canRenderFront(2, false, true), false); // opponent hand
  assert.equal(canRenderFront(4, false, true), false); // face-down monster
  assert.equal(canRenderFront(1, true, true), false); // even own deck
  assert.equal(canRenderFront(2, false, true, false, true), true); // legitimate reveal
  assert.equal(canRenderFront(2, true, false), true); // own hand

  const source = readFileSync(new URL("../hotseat/view.js", import.meta.url), "utf8")
    .replace(/^export\s+(const|function|class|async function|let)/gm, "$1")
    .replace(/^export\s*\{[^}]*\}\s*;?\s*$/gm, "");
  const elements = [];
  const document = { createElement() {
    const front = { innerHTML: "" };
    const classes = new Set();
    const element = {
      dataset: {}, front, classList: {
        add: (...names) => names.forEach(name => classes.add(name)),
        remove: (...names) => names.forEach(name => classes.delete(name)),
      },
      querySelector: () => front,
      addEventListener() {},
    };
    elements.push(element);
    return element;
  } };
  const { card, render } = new Function("document", "CARD_BACK", `${source};
    DB=new Map([[123,{code:123,type:1,attribute:1,attack:1000,defense:1000,level:4}]]);
    NAMES={123:{name:"Private card"}};useImages=false;
    layer={appendChild(){}};
    return {card:{uid:1,code:123},render:elFor};
  `)(document, "card-back");
  render(card, false);
  assert.equal(elements[0].front.innerHTML, "");
  render(card, true);
  assert.match(elements[0].front.innerHTML, /Private card/);
  render(card, false);
  assert.equal(elements[0].front.innerHTML, "");

  execFileSync("node", ["infra/build-play.mjs"], { cwd: new URL("..", import.meta.url) });
  const html = readFileSync(new URL("../web/play.html", import.meta.url), "utf8");
  assert.match(html, /\.card\.facedown \.inner\{transform:rotateY\(180deg\);transition:none\}/);
});
