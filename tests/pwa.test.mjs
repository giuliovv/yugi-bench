import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../web/", import.meta.url);
const file = name => readFileSync(new URL(name, root));

test("all app entry points have install metadata and correctly sized icons", () => {
  execFileSync("node", ["infra/build-play.mjs"], { cwd: new URL("..", import.meta.url) });
  execFileSync("node", ["infra/build-bot.mjs"], { cwd: new URL("..", import.meta.url) });
  const manifest = JSON.parse(file("manifest.webmanifest"));
  assert.equal(manifest.start_url, "./play.html");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.scope, "./");
  for (const size of [192, 512]) {
    const icon = file(`icon-${size}.png`);
    assert.equal(icon.readUInt32BE(16), size);
    assert.equal(icon.readUInt32BE(20), size);
    assert.ok(manifest.icons.some(entry => entry.sizes === `${size}x${size}`));
  }
  for (const page of ["index.html", "play.html", "bot.html"]) {
    const html = file(page).toString();
    assert.match(html, /rel="manifest" href="\.\/manifest\.webmanifest"/);
    assert.match(html, /rel="apple-touch-icon" href="\.\/icon-192\.png"/);
    assert.match(html, /src="\.\/pwa\.js"/);
  }
});

test("generated worker caches the game offline and versions with its assets", async () => {
  execFileSync("node", ["infra/build-pwa.mjs"], { cwd: new URL("..", import.meta.url) });
  const source = file("sw.js").toString();
  const names = ["index.html", "play.html", "bot.html", "app.js", "styles.css",
    "pwa.js", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png"];
  const hash = createHash("sha256");
  for (const name of names) hash.update(file(name));
  assert.ok(source.includes(`yugi-bench-${hash.digest("hex").slice(0, 16)}`));

  const listeners = new Map();
  const storage = new Map();
  const scope = "https://example.test/";
  let online = true;
  const key = request => typeof request === "string" ? new URL(request, scope).href : request.url;
  const cache = {
    async addAll(urls) { for (const url of urls) this.put(url, await network({ url: key(url) })); },
    async put(request, response) { storage.set(key(request), response.clone()); },
    async match(request, options = {}) {
      const url = key(request);
      const found = [...storage].find(([stored]) => options.ignoreSearch
        ? new URL(stored).pathname === new URL(url).pathname : stored === url);
      return found?.[1].clone();
    },
  };
  async function network(request) {
    if (!online) throw new Error("offline");
    const path = new URL(request.url).pathname;
    return new Response(path === "/" ? file("index.html") : file(path.slice(1)));
  }
  const self = {
    registration: { scope }, location: { origin: "https://example.test" },
    addEventListener: (name, callback) => listeners.set(name, callback),
    skipWaiting: async () => {}, clients: { claim: async () => {} },
  };
  vm.runInNewContext(source, { self, caches: {
    open: async () => cache, keys: async () => [], delete: async () => true,
  }, fetch: network, URL, Promise });
  let install;
  listeners.get("install")({ waitUntil: promise => { install = promise; } });
  await install;
  assert.ok(storage.has(`${scope}play.html`));
  assert.ok(storage.has(`${scope}bot.html`));
  online = false;
  let response;
  listeners.get("fetch")({ request: { url: `${scope}play.html`, method: "GET", mode: "navigate" },
    respondWith: promise => { response = promise; } });
  assert.equal((await response).text instanceof Function, true);
  assert.match(await (await response).text(), /GOAT FORMAT/);
  assert.equal(storage.size, names.length + 1);
});
