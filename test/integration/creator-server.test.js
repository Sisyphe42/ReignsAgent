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
