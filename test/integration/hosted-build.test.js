import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";

const ROOT = join(process.cwd(), "apps", "creator-web", "dist-hosted");

describe("hosted Creator build", () => {
  it("contains a scoped offline shell without server or secret artifacts", async () => {
    const files = await walk(ROOT);
    for (const required of ["index.html", "play.html", "manifest.webmanifest", "sw.js", "logo-alpha.png"]) assert.ok(files.includes(required), `missing ${required}`);
    assert.equal(files.some((file) => /(?:^|\/)(?:node_modules|\.env|test)(?:\/|$)/.test(file)), false);
    const manifest = JSON.parse(await readFile(join(ROOT, "manifest.webmanifest"), "utf8"));
    assert.match(manifest.scope, /^\/.+\/$|^\/$/);
    const serviceWorker = await readFile(join(ROOT, "sw.js"), "utf8");
    assert.match(serviceWorker, /index\.html/);
    assert.match(serviceWorker, /play\.html/);
    assert.doesNotMatch(serviceWorker, /apiKey|credentials/);
    const browserBuild = files.find((file) => /^assets\/browser-build-.*\.js$/.test(file));
    assert.ok(browserBuild, "missing browser player builder");
    const browserBuildSource = await readFile(join(ROOT, browserBuild), "utf8");
    for (const asset of ["castle.svg", "coins.svg", "ATTRIBUTION.md"]) {
      assert.match(browserBuildSource, new RegExp(asset.replace(".", "\\.")));
      assert.ok(files.includes(`assets/sample/${asset}`), `missing Hosted sample asset '${asset}'`);
    }
  });

  it("falls back to the cached app shell when an online navigation returns 404", async () => {
    const source = await readFile(join(ROOT, "sw.js"), "utf8");
    const manifest = JSON.parse(await readFile(join(ROOT, "manifest.webmanifest"), "utf8"));
    const listeners = new Map();
    const creatorShell = { ok: true, source: "cached-creator" };
    const playerShell = { ok: true, source: "cached-player" };
    const caches = {
      open: async () => ({ addAll: async () => {}, put: async () => {} }),
      keys: async () => [],
      delete: async () => true,
      match: async (request) => String(request).endsWith("index.html") ? creatorShell : String(request).endsWith("play.html") ? playerShell : undefined
    };
    const self = {
      addEventListener(type, listener) { listeners.set(type, listener); },
      skipWaiting() {}
    };
    runInNewContext(source, {
      self,
      caches,
      fetch: async () => ({ ok: false, status: 404 }),
      URL,
      location: { origin: "https://creator.example", pathname: manifest.scope }
    });

    let responsePromise;
    listeners.get("fetch")({
      request: { method: "GET", mode: "navigate", url: `https://creator.example${manifest.scope}workbench/content` },
      respondWith(value) { responsePromise = value; }
    });
    assert.equal(await responsePromise, creatorShell);

    listeners.get("fetch")({
      request: { method: "GET", mode: "navigate", url: `https://creator.example${manifest.scope}play.html` },
      respondWith(value) { responsePromise = value; }
    });
    assert.equal(await responsePromise, playerShell);
  });
});

async function walk(root, relative = "") {
  const entries = await readdir(join(root, relative), { withFileTypes: true });
  const output = [];
  for (const entry of entries) {
    const path = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) output.push(...await walk(root, path)); else output.push(path);
  }
  return output.sort();
}
