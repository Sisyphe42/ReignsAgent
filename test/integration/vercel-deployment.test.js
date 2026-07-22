import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const config = JSON.parse(await readFile(new URL("../../vercel.json", import.meta.url), "utf8"));
const hostedIndex = await readFile(new URL("../../apps/creator-web/dist-hosted/index.html", import.meta.url), "utf8");
const hostedManifest = JSON.parse(await readFile(new URL("../../apps/creator-web/dist-hosted/manifest.webmanifest", import.meta.url), "utf8"));

describe("Vercel Hosted deployment", () => {
  it("builds root-scoped assets and preserves SPA deep links", () => {
    assert.equal(config.framework, "vite");
    assert.equal(config.buildCommand, "REIGNS_AGENT_BASE_PATH=/ npm run build:hosted");
    assert.equal(config.outputDirectory, "apps/creator-web/dist-hosted");
    assert.deepEqual(config.rewrites, [{ source: "/(.*)", destination: "/index.html" }]);
    assert.match(hostedIndex, /(?:src|href)="\/assets\//);
    assert.doesNotMatch(hostedIndex, /(?:src|href)="\/reignsagent\/assets\//);
    assert.equal(hostedManifest.scope, "/");
  });
});
