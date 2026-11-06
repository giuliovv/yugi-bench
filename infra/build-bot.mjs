/* Assemble a self-contained browser duel from the training bridge and policy. */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const browser = resolve(root, "vendor/goat-format-simulator/engine/browser");
const read = path => readFileSync(resolve(root, path), "utf8");
const vendor = path => readFileSync(resolve(browser, path), "utf8");
const stripExports = source => source.replace(/^export\s+(const|function|class|async function|let)/gm, "$1")
  .replace(/^export\s*\{[^}]*\}\s*;?\s*$/gm, "");
const iife = (source, returns) => `(()=>{\n${source}\nreturn {${returns}};\n})()`;

let core = vendor("out/ocgcore.bundle.js");
const match = core.match(/export\{([^}]*)\}\s*;?\s*$/m);
if (!match) throw new Error("ocgcore exports not found");
const pairs = match[1].split(",").map(pair => {
  const tokens = pair.trim().split(/\s+/);
  return { local:tokens[0], external:tokens[2] ?? tokens[0] };
});
core = core.replace(/export\{[^}]*\}\s*;?\s*$/m,
  `return {${pairs.map(pair => `${pair.external === "default" ? "createCore" : pair.external}:${pair.local}`).join(",")}};`);

const worker = read("runtime/goat-engine.mjs");
const start = worker.indexOf("const T = X.OcgMessageType;");
const end = worker.indexOf("// END_SHARED_BRIDGE");
if (start < 0 || end < start) throw new Error("shared bridge markers not found");
const shared = worker.slice(start, end);
const json = path => read(path).trim();
const parts = [
  `const X = (()=>{\n${core}\n})(); X.default = X.createCore;`,
  `const {SCRIPTS, scriptReader} = ${iife(stripExports(vendor("out/scripts.bundle.js")), "SCRIPTS, scriptReader")};`,
  `const {GoatDuel, LOC} = ${iife(stripExports(vendor("src/duel.mjs")), "GoatDuel, LOC")};`,
  `const {makeAutoPlayer} = ${iife(stripExports(vendor("src/autopilot.mjs")), "makeAutoPlayer")};`,
  `const {makeTrivialResolver} = ${iife(stripExports(vendor("src/trivial.js")), "makeTrivialResolver")};`,
  `const Policy = ${iife(stripExports(read("runtime/browser-policy.js")), "bucket, stateFeatures, actionFeatures, chooseAction")};`,
  `const WEIGHTS = ${json("models/smoke_policy.json")};`,
  `const DECKS = ${json("vendor/goat-format-simulator/engine/data/mazos.json")};`,
  `const NAMES = ${json("vendor/goat-format-simulator/engine/browser/out/names.subset.json")};`,
  `const Bridge = (()=>{\nconst cardData=${json("vendor/goat-format-simulator/engine/browser/out/cards.subset.json")};\n` +
    `const names=NAMES;\nconst pool=new Set(${json("vendor/goat-format-simulator/engine/data/goat-pool.json")}.map(Number));\n` +
    `const limits=${json("vendor/goat-format-simulator/engine/data/goat-limites.json")};\n` +
    `const cards=new Map(Object.values(cardData).map(card=>[card.code,{...card,race:BigInt(card.race)}]));\n` +
    `${shared}\nreturn {reset,step};\n})();`,
  read("runtime/browser-bot-ui.js"),
].join("\n");

const html = read("runtime/browser-bot-template.html").replace("/*__MODULES__*/", () => parts);
writeFileSync(resolve(root, "web/bot.html"), html);
console.log(`web/bot.html: ${(html.length / 1024 / 1024).toFixed(2)} MB`);
