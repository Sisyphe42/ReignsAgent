import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = join(process.cwd(), "apps", "creator-web", "dist-hosted");

describe("hosted Creator build", () => {
  it("contains a scoped offline shell without server or secret artifacts", async () => {
    const files = await walk(ROOT);
    for (const required of ["index.html", "manifest.webmanifest", "sw.js", "logo-alpha.png"]) assert.ok(files.includes(required), `missing ${required}`);
    assert.equal(files.some((file) => /(?:^|\/)(?:node_modules|\.env|test)(?:\/|$)/.test(file)), false);
    const manifest = JSON.parse(await readFile(join(ROOT, "manifest.webmanifest"), "utf8"));
    assert.match(manifest.scope, /^\/.+\/$|^\/$/);
    const serviceWorker = await readFile(join(ROOT, "sw.js"), "utf8");
    assert.match(serviceWorker, /index\.html/);
    assert.doesNotMatch(serviceWorker, /apiKey|credentials/);
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
