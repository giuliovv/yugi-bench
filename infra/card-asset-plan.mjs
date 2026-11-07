import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function bundledCardArt() {
  const decks = JSON.parse(readFileSync(resolve(root, "vendor/goat-format-simulator/engine/data/mazos.json"), "utf8"));
  const cards = JSON.parse(readFileSync(resolve(root, "vendor/goat-format-simulator/engine/browser/out/cards.subset.json"), "utf8"));
  const full = new Set();
  const cropped = new Set();
  for (const deck of decks) {
    for (const code of [...deck.main, ...deck.extra]) full.add(cards[code]?.alias || code);
    if (deck.portada) cropped.add(deck.portada);
  }
  const sorted = values => [...values].map(Number).sort((a, b) => a - b);
  return { full: sorted(full), cropped: sorted(cropped) };
}
