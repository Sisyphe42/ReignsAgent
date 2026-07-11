import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { createCreatorServer } from "../../apps/creator-server/src/server.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

describe("Creator Server factory", () => {
  it("creates isolated instances with random ports and idempotent shutdown", async () => {
    const bundle = JSON.parse(await readFile(join(ROOT, "fixtures/content/oss-court.cards.json"), "utf8"));
    const outputRoot = await mkdtemp(join(tmpdir(), "reigns-agent-server-"));
    const first = await createCreatorServer({ rootDir: ROOT, initialBundle: bundle, defaultBuildOutputDir: outputRoot });
    const second = await createCreatorServer({ rootDir: ROOT, initialBundle: bundle });

    try {
      const [firstAddress, secondAddress] = await Promise.all([
        first.start({ port: 0 }),
        second.start({ port: 0 })
      ]);
      assert.notEqual(firstAddress.port, secondAddress.port);
      assert.match(firstAddress.origin, /^http:\/\/127\.0\.0\.1:\d+$/);

      const edited = await request(firstAddress.origin, "/api/editor/metadata", {
        method: "PATCH",
        body: { metadata: { title: "First instance" } }
      });
      assert.equal(edited.metadata.title, "First instance");

      const untouched = await request(secondAddress.origin, "/api/editor");
      assert.notEqual(untouched.metadata.title, "First instance");

      const exported = await request(firstAddress.origin, "/api/build/export", {
        method: "POST",
        body: { buildId: "factory-smoke" }
      });
      assert.equal(exported.exported, true);
      assert.equal(exported.outputPath, join(outputRoot, "factory-smoke.game.json"));
      assert.equal(JSON.parse(await readFile(exported.outputPath, "utf8")).buildId, "factory-smoke");
    } finally {
      await Promise.all([first.close(), second.close()]);
      await Promise.all([first.close(), second.close()]);
      await rm(outputRoot, { recursive: true, force: true });
    }
  });

  it("persists config, projects, editor content, and workspace state across restarts", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "reigns-agent-data-"));
    const bundle = JSON.parse(await readFile(join(ROOT, "fixtures/content/minimal.cards.json"), "utf8"));
    let server = await createCreatorServer({ rootDir: ROOT, dataRoot, initialBundle: bundle });
    try {
      let address = await server.start({ port: 0 });
      const initialProjects = await request(address.origin, "/api/projects");
      assert.equal(initialProjects.projects.length, 1);
      const originalId = initialProjects.projects[0].id;

      const config = await request(address.origin, "/api/config", {
        method: "PATCH",
        body: {
          theme: "phantom",
          aiAssistEnabled: true,
          ai: { endpoint: "https://ai.example.test/v1", modelId: "example-model", apiKey: "stored-secret" }
        }
      });
      assert.equal(config.theme, "phantom");
      assert.equal(config.ai.hasApiKey, true);
      assert.doesNotMatch(JSON.stringify(config), /stored-secret/);

      await request(address.origin, "/api/workspace", {
        method: "PATCH",
        body: { activePanel: "review", selectedCardId: "minimal-card" }
      });
      await request(address.origin, "/api/editor/metadata", {
        method: "PATCH",
        body: { metadata: { title: "Persistent project" } }
      });
      const created = await request(address.origin, "/api/projects", {
        method: "POST",
        body: { source: "sample" }
      });
      assert.equal(created.projects.length, 2);
      await request(address.origin, `/api/projects/${originalId}/open`, { method: "POST", body: {} });
      await server.close();

      server = await createCreatorServer({ rootDir: ROOT, dataRoot });
      address = await server.start({ port: 0 });
      assert.equal((await request(address.origin, "/api/editor")).metadata.title, "Persistent project");
      assert.equal((await request(address.origin, "/api/config")).theme, "phantom");
      assert.equal((await request(address.origin, "/api/config")).ai.hasApiKey, true);
      assert.equal((await request(address.origin, "/api/projects")).projects.length, 2);
      assert.equal((await request(address.origin, "/api/workspace")).activePanel, "review");
      assert.match(await readFile(join(dataRoot, "config.toml"), "utf8"), /apiKey = "stored-secret"/);
    } finally {
      await server.close();
      await rm(dataRoot, { recursive: true, force: true });
    }
  });
});

async function request(origin, path, { method = "GET", body } = {}) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return JSON.parse(text);
}
