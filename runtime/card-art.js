const REMOTE = "https://images.ygoprodeck.com/images";

export function createCardArt(manifest) {
  const full = new Set(manifest.full || []);
  const cropped = new Set(manifest.cropped || []);
  return {
    full(id) { return full.has(Number(id)) ? `./cards/full/${id}.jpg` : `${REMOTE}/cards/${id}.jpg`; },
    cropped(id) { return cropped.has(Number(id)) ? `./cards/cropped/${id}.jpg` : `${REMOTE}/cards_cropped/${id}.jpg`; },
  };
}
