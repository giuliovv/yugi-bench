/* Ensambla UN solo .html autocontenido (sin servidor, sin imports externos).
   Cada módulo va en su propio ámbito: el core está minificado y sus
   identificadores de una letra chocan con los nuestros si se mezclan. */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
process.chdir(resolve(root,"vendor/goat-format-simulator/engine/browser"));
const R = f => readFileSync(f.startsWith("./src/") && ["main.js","view.js","template.html"].includes(f.split("/").at(-1))
  ? resolve(root,"hotseat",f.split("/").at(-1)) : f,"utf-8");
const stripExports = s => s.replace(/^export\s+(const|function|class|async function|let)/gm,"$1")
                           .replace(/^export\s*\{[^}]*\}\s*;?\s*$/gm,"");
// los módulos de IA se importan entre sí: al concatenarlos hay que quitar
// los import, porque dentro de un ámbito no se puede importar
const stripImports = s => s.replace(/^import[\s\S]*?from\s*"[^"]*";?\s*$/gm,"");
const juntarIA = () => ["knowledge.js","view.js","evaluar.js","brain.js"]
  .map(f => stripImports(stripExports(R("./src/ai/"+f)))).join("\n");

// núcleo: su "export{a as B,...}" pasa a ser el objeto que devuelve el ámbito
let core = R("./out/ocgcore.bundle.js");
const em = core.match(/export\{([^}]*)\}\s*;?\s*$/m);
const pairs = em[1].split(",").map(p=>{const t=p.trim().split(/\s+/);return {local:t[0], ext:t[2]??t[0]};});
core = core.replace(/export\{[^}]*\}\s*;?\s*$/m,
  `return {${pairs.map(p=>`${p.ext==="default"?"createCore":p.ext}:${p.local}`).join(",")}};`);

const iife = (body, returns) => `(()=>{\n${body}\nreturn {${returns}};\n})()`;
const sharedSource = readFileSync(resolve(root,"runtime/goat-engine.mjs"),"utf8");
const between = (start,end) => {
  const from=sharedSource.indexOf(start), to=sharedSource.indexOf(end);
  if(from<0 || to<=from) throw new Error(`missing bridge markers: ${start} / ${end}`);
  return sharedSource.slice(from+start.length,to);
};
const decisionSource = between("// BEGIN_DECISION_VISIBILITY","// END_DECISION_VISIBILITY")
  + between("// BEGIN_DECISION_ACTIONS","// END_DECISION_ACTIONS");
const modelAdapter = `const createModelAdapter = ({duel,X,names,LOC,automatic})=>{\n`+
  `const T=X.OcgMessageType,R=X.OcgResponseType,IA=X.SelectIdleCMDAction,BA=X.SelectBattleCMDAction;\n`+
  `const name=code=>names[code]?.name ?? \`Card #\${code}\`;\n`+
  `let pending=null,actions=new Map(),revealed=new Set(),winner=null,coreErrors=[];\n`+
  decisionSource+`\nreturn {describe(prompt){pending=prompt;return state().observation;},`+
  `response(id){if(!actions.has(id))throw new Error(\`illegal model action: \${id}\`);return actions.get(id);},`+
  `onEvent(event){if(event.t==="revelar")for(const uid of event.uids)revealed.add(uid);`+
  `if(event.t==="chainEnd")revealed.clear();}};\n};`;

const parts = [
`${stripExports(R("./out/cardback.js"))}`,
// el módulo de idiomas va PRIMERO: deja __T en globalThis y el resto lo usa
`const I18N = ${iife(stripExports(R("./src/i18n.js")), "T, setIdioma, idioma, traducirDOM")};`,
`const {T:__T_, setIdioma:__setIdioma, traducirDOM:__traducirDOM} = I18N;`,
`const __OCG__ = (()=>{\n${core}\n})();`,
`const {SCRIPTS, scriptReader} = ${iife(stripExports(R("./out/scripts.bundle.js")), "SCRIPTS, scriptReader")};`,
`const {GoatDuel, LOC} = ${iife(stripExports(R("./src/duel.mjs")), "GoatDuel, LOC")};`,
`const {makeAutoPlayer} = ${iife(stripExports(R("./src/autopilot.mjs")), "makeAutoPlayer")};`,
`const {makeTrivialResolver} = ${iife(stripExports(R("./src/trivial.js")), "makeTrivialResolver")};`,
`const Policy = ${iife(stripExports(readFileSync(resolve(root,"runtime/browser-policy.js"),"utf8")), "chooseAction")};`,
`const MODEL_WEIGHTS = ${readFileSync(resolve(root,"models/smoke_policy.json"),"utf8")};`,
modelAdapter,
`const {crearCerebro, NIVELES} = ${iife(juntarIA(), "crearCerebro, NIVELES")};`,
`const View = ${iife(stripExports(R("./src/view.js")),
   "initView, setPerspective, sorteo, setControles, markAtacadas, setImages, announcePhase, markUsable, moverEnMano, previaSuelta, quitarPrevia, confirmar, revelar, ocultarReveladas, setMomento, momento, momentoTexto, pantallaFinal, alHistorial, fitBoard, openZoneView, closeZoneView, setZoneViewClose, setZoneViewHandler, layoutAll, setHandlers, markTargets, markDraggable, showDetail, choiceMenu, closeChoice, toast, banner, setLP, setPhase, flash, popDamage, telegraphAttack, animateBattle, glow, sleep")};`,
`const {boot} = ${iife(stripExports(R("./src/main.js")), "boot")};`,
].join("\n");

const html = R("./src/template.html")
  .replace("/*__MODULES__*/", () => parts)
  .replace("/*__CARDS__*/",   () => R("./out/cards.subset.json"))
  .replace("/*__NAMES__*/",   () => R("./out/names.subset.json"))
  .replace("/*__DECK__*/",    () => R("./out/deck.json"))
  // TRAMPA: esto leía ./out/mazos.json, que era una copia a mano y nadie
  // regeneraba. Arreglar un mazo en data/mazos.json no llegaba al HTML y
  // parecía que el arreglo no funcionaba. Se lee la fuente canónica.
  .replace("/*__MAZOS__*/",   () => R("../data/mazos.json"))
  /* Los avatares van dentro como WebP de 88px en base64: 28 caras ocupan
     86 KB, menos que una sola imagen de carta, y el HTML sigue siendo un
     archivo suelto que funciona sin internet. */
  .replace("/*__AVATARES__*/",() => R("../data/avatares.json"));

writeFileSync(resolve(root,"web/play.html"), html);
console.log("web/play.html:", (html.length/1024/1024).toFixed(2), "MB");
