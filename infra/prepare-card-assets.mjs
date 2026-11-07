import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { bundledCardArt } from "./card-asset-plan.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const base = resolve(root, "web/cards");
const source = "https://images.ygoprodeck.com/images";
const wait = ms => new Promise(done => setTimeout(done, ms));
const validJpeg = path => {
  if (!existsSync(path) || statSync(path).size < 1000) return false;
  const head = readFileSync(path).subarray(0, 2);
  return head[0] === 0xff && head[1] === 0xd8;
};

async function download(kind, id) {
  const path = resolve(base, kind, `${id}.jpg`);
  if (validJpeg(path)) return false;
  mkdirSync(dirname(path), { recursive: true });
  const upstreamKind = kind === "full" ? "cards" : "cards_cropped";
  const url = `${source}/${upstreamKind}/${id}.jpg`;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await wait(1000 * attempt);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) {
        if (response.status === 429 || response.status >= 500) continue;
        throw new Error(`${response.status} for ${kind}/${id}`);
      }
      const image = Buffer.from(await response.arrayBuffer());
      if (image.length < 1000 || image[0] !== 0xff || image[1] !== 0xd8)
        throw new Error(`Invalid JPEG for ${kind}/${id}`);
      const tmp = `${path}.tmp`;
      try { writeFileSync(tmp, image); renameSync(tmp, path); }
      finally { rmSync(tmp, { force: true }); }
      await wait(350);
      return true;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
  throw new Error(`Could not download ${kind}/${id}`);
}

const plan = bundledCardArt();
let downloaded = 0;
for (const kind of ["full", "cropped"]) {
  for (const [index, id] of plan[kind].entries()) {
    if (await download(kind, id)) downloaded++;
    if ((index + 1) % 25 === 0 || index + 1 === plan[kind].length)
      console.log(`${kind}: ${index + 1}/${plan[kind].length}`);
  }
}
mkdirSync(base, { recursive: true });
writeFileSync(resolve(base, "manifest.json"), `${JSON.stringify(plan)}\n`);
console.log(`Card art ready: ${plan.full.length} full, ${plan.cropped.length} cropped; ${downloaded} fetched`);
