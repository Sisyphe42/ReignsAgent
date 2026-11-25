import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { createCreatorServer } from "../../apps/creator-server/src/server.mjs";

const FOG = JSON.parse(readFileSync(new URL("../../fixtures/content/fog-harbor.cards.json", import.meta.url), "utf8"));

describe("Creator Server progress streams (opt-in NDJSON)", () => {
  it("streams real review progress and keeps the plain JSON answer for clients that do not opt in", async () => {
    await withCreator(async ({ call, stream }) => {
      const plain = await call("/api/diagnostics/run", { cycles: 300, maxTurns: 30, seed: 1 });
      const { events, final } = await stream("/api/diagnostics/run", { cycles: 300, maxTurns: 30, seed: 1 });
      assert.equal(final.type, "result");
      assert.deepEqual(final.result, plain, "streaming does not change the projection");
      const simulate = events.filter((event) => event.phase === "simulate");
      assert.ok(simulate.length >= 6, "one event per 50 cycles");
      assert.deepEqual(simulate.map((event) => event.completed), [...simulate.map((event) => event.completed)].sort((a, b) => a - b));
      assert.deepEqual(events.at(-1), { type: "progress", phase: "summarize", completed: 300, total: 300 });
    });
  });

  it("refuses to publish a streamed review when the deck changed while it ran", async () => {
    await withCreator(async ({ call, stream, headers, base }) => {
      const pending = stream("/api/diagnostics/run", { cycles: 4000, maxTurns: 40, seed: 1 });
      // Edit the deck while the review yields between chunks.
      await new Promise((resolve) => setTimeout(resolve, 30));
      await fetch(`${base}/api/editor/cards`, { method: "POST", headers, body: JSON.stringify({ card: { id: "late-edit", text: "A late edit arrives.", choices: [{ id: "left", label: "Yes", effects: {} }, { id: "right", label: "No", effects: {} }] } }) });
      const { final } = await pending;
      assert.equal(final.type, "error");
      assert.equal(final.error.code, "diagnostics_stale");
      await call("/api/diagnostics/run", { cycles: 50, maxTurns: 20, seed: 1 });
    });
  });

  it("streams draft stages and reports the failing stage of an endpoint error", async () => {
    const endpoint = await startEndpoint((count) => count === 1
      ? { status: 200, body: { choices: [{ message: { content: JSON.stringify({ proposals: [] }) } }] } }
      : { status: 503, body: { error: "busy" } });
    try {
      await withCreator(async ({ stream }) => {
        const config = { provider: "openai_chat", endpoint: `http://127.0.0.1:${endpoint.port}/v1`, modelId: "mock", apiKeyRef: "browser-local" };
        const ok = await stream("/api/ai/edit/plan", { mode: "generate_cards", config, instruction: "Draft one card." });
        assert.equal(ok.final.type, "result");
        assert.deepEqual(ok.events.map((event) => event.stage), ["context", "request", "response", "parse", "validate"]);

        const failed = await stream("/api/ai/edit/plan", { mode: "generate_cards", config, instruction: "Draft one card." });
        assert.equal(failed.final.type, "error");
        assert.equal(failed.final.error.code, "endpoint_http_error");
        assert.equal(failed.final.error.stage, "request");
      });
    } finally {
      await endpoint.close();
    }
  });
});

async function withCreator(run) {
  const dataRoot = await mkdtemp(join(tmpdir(), "reigns-progress-"));
  const creator = await createCreatorServer({ dataRoot, initialBundle: FOG });
  const { origin: base } = await creator.start({ host: "127.0.0.1", port: 0 });
  try {
    const { capability } = await (await fetch(`${base}/api/session`)).json();
    const headers = { "content-type": "application/json", "x-reigns-agent-capability": capability };
    const call = async (path, body) => {
      const response = await fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
      const json = await response.json();
      if (!response.ok || json?.error) throw new Error(json?.error?.message ?? `HTTP ${response.status}`);
      return json;
    };
    const stream = async (path, body) => {
      const response = await fetch(`${base}${path}`, { method: "POST", headers: { ...headers, accept: "application/x-ndjson" }, body: JSON.stringify(body) });
      assert.match(response.headers.get("content-type"), /application\/x-ndjson/);
      const lines = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
      return { events: lines.filter((line) => line.type === "progress"), final: lines.at(-1) };
    };
    await run({ call, stream, headers, base });
  } finally {
    await creator.close();
    await rm(dataRoot, { recursive: true, force: true });
  }
}

async function startEndpoint(answer) {
  let count = 0;
  const server = createServer(async (req, res) => {
    for await (const chunk of req) void chunk;
    count += 1;
    const { status, body } = answer(count);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { port: server.address().port, close: () => new Promise((resolve) => server.close(resolve)) };
}
