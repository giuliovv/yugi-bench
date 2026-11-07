import assert from "node:assert/strict";
import test from "node:test";
import { bundledCardArt } from "../infra/card-asset-plan.mjs";
import { createCardArt } from "../runtime/card-art.js";

test("bundled deck artwork is deduplicated and sorted", () => {
  const plan = bundledCardArt();
  assert.ok(plan.full.length >= 100);
  assert.ok(plan.cropped.length >= 10);
  for (const kind of ["full", "cropped"]) {
    assert.deepEqual(plan[kind], [...new Set(plan[kind])].sort((a, b) => a - b));
  }
});

test("bundled artwork is local and other cards fall back to the remote source", () => {
  const art = createCardArt({ full: [123], cropped: [456] });
  assert.equal(art.full(123), "./cards/full/123.jpg");
  assert.equal(art.full(789), "https://images.ygoprodeck.com/images/cards/789.jpg");
  assert.equal(art.cropped(456), "./cards/cropped/456.jpg");
  assert.equal(art.cropped(789), "https://images.ygoprodeck.com/images/cards_cropped/789.jpg");
});
