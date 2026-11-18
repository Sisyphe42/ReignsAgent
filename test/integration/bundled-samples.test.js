import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { createCreatorServer } from "../../apps/creator-server/src/server.mjs";
import { validateCards } from "../../packages/core/src/index.js";
import { loadEditorFromContent, validatePlayerCards } from "../../packages/interface/src/index.js";
import { runMonteCarloReview } from "../../packages/reviewer/src/index.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SAMPLES = [
  { id: "oss-court", file: "fixtures/content/oss-court.cards.json" },
  { id: "fog-harbor", file: "fixtures/content/fog-harbor.cards.json" }
];

describe("Bundled samples", () => {
  for (const sample of SAMPLES) {
    it(`loads '${sample.id}' and passes Core, Player and Reviewer checks`, async () => {
      const bundle = JSON.parse(await readFile(join(ROOT, sample.file), "utf8"));
      const editor = loadEditorFromContent(bundle);
      const cards = editor.toCards();
      assert.ok(cards.length > 0);
      assert.deepEqual(validateCards(cards).errors, []);
      assert.equal(editor.validate().valid, true);
      assert.deepEqual(validatePlayerCards(cards).errors, []);
      const report = runMonteCarloReview({ cards, cycles: 50, maxTurns: 40, seed: 1 });
      assert.ok(report);
      for (const asset of bundle.assets ?? []) {
        if (asset.uri.startsWith("assets/sample/")) await access(join(ROOT, "packages/interface/web", asset.uri));
      }
    });
  }

  it("lists both samples and creates a project from the selected one", async () => {
    const server = await createCreatorServer({ rootDir: ROOT });
    try {
      const address = await server.start({ port: 0 });
      const { capability } = await (await fetch(`${address.origin}/api/session`)).json();
      const call = async (path, options = {}) => {
        const response = await fetch(`${address.origin}${path}`, {
          ...options,
          headers: { "x-reigns-agent-capability": capability, ...(options.body ? { "content-type": "application/json" } : {}) }
        });
        return { status: response.status, json: await response.json() };
      };
      const list = await call("/api/samples");
      assert.deepEqual(list.json.samples.map((sample) => sample.id), SAMPLES.map((sample) => sample.id));
      assert.equal(list.json.samples[1].title, "雾港");
      assert.equal((await call("/api/samples/fog-harbor")).json.cards.length, 20);
      assert.equal((await call("/api/samples/missing")).status, 404);
      const created = await call("/api/projects", { method: "POST", body: JSON.stringify({ source: "sample", sample: "fog-harbor" }) });
      assert.equal(created.status, 200);
      const editor = (await call("/api/editor")).json;
      assert.equal(editor.metadata.title, "雾港");
      assert.equal(editor.cards.length, 20);
      assert.equal(editor.validation.valid, true);
      assert.equal(editor.playerValidation.valid, true);
    } finally {
      await server.close();
    }
  });
});
