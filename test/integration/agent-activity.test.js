import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { createCreatorServer } from "../../apps/creator-server/src/server.mjs";

const FOG = JSON.parse(readFileSync(new URL("../../fixtures/content/fog-harbor.cards.json", import.meta.url), "utf8"));

describe("AI activity log, session limit, and cancel through the Creator Server", () => {
  it("records drafts and selection actions, enforces the session limit, and records a cancel", async () => {
    const endpoint = await startEndpoint();
    const dataRoot = await mkdtemp(join(tmpdir(), "reigns-activity-"));
    const creator = await createCreatorServer({ dataRoot, initialBundle: FOG });
    const { origin } = await creator.start({ host: "127.0.0.1", port: 0 });
    try {
      const { capability } = await (await fetch(`${origin}/api/session`)).json();
      const headers = { "content-type": "application/json", "x-reigns-agent-capability": capability };
      const call = async (method, path, body, signal) => {
        const response = await fetch(`${origin}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal });
        return { status: response.status, json: await response.json() };
      };
      const config = { provider: "openai_chat", endpoint: `http://127.0.0.1:${endpoint.port}/v1`, modelId: "mock-model", apiKeyRef: "browser-local" };
      await call("PATCH", "/api/config", { ai: { sessionRequestLimit: 3 } });

      const draft = await call("POST", "/api/ai/edit/plan", { mode: "generate_cards", config, instruction: "Draft one card.", source: "Overview" });
      assert.match(draft.json.historyId, /^rh-/);
      const explain = await call("POST", "/api/ai/edit/plan", { mode: "explain_selection", config, instruction: "Explain", source: "Ambient", selection: { kind: "card", cardId: FOG.cards[0].id, text: FOG.cards[0].text } });
      assert.equal(explain.json.answer, "Explained.");

      // Third request is slow; the client gives up (Cancel) and the server records it as cancelled.
      endpoint.slow = true;
      const controller = new AbortController();
      const pending = call("POST", "/api/ai/edit/plan", { mode: "generate_cards", config, instruction: "Slow draft." }, controller.signal).catch((error) => error);
      await new Promise((resolve) => setTimeout(resolve, 150));
      controller.abort();
      await pending;
      await waitFor(async () => (await call("GET", "/api/ai/repair-history")).json.records.some((entry) => entry.status === "cancelled"));
      endpoint.slow = false;

      const usage = (await call("GET", "/api/ai/session-usage")).json;
      assert.deepEqual([usage.used, usage.limit, usage.remaining], [3, 3, 0]);
      const blocked = await call("POST", "/api/ai/edit/plan", { mode: "generate_cards", config, instruction: "One more." });
      assert.equal(blocked.json.error.code, "ai_session_budget");
      assert.equal(endpoint.count, 3, "the over-limit request never reached the endpoint");

      const { records } = (await call("GET", "/api/ai/repair-history")).json;
      const byKind = Object.groupBy(records, (entry) => entry.kind);
      assert.equal(byKind.selection.length, 1);
      assert.ok(byKind.draft.length >= 2);
      assert.equal(byKind.selection[0].source, "Ambient");
      const exported = (await call("GET", "/api/ai/repair-history?full=1")).json;
      const selectionRecord = exported.records.find((entry) => entry.kind === "selection");
      assert.equal(selectionRecord.answer, "Explained.");
      assert.equal(selectionRecord.conversation.length, 1);
      // Usage travels in the list, the record, and the export: reported when the endpoint sent it.
      assert.deepEqual(selectionRecord.usage, { calls: 1, requestBytes: selectionRecord.conversation[0].requestBytes, responseBytes: selectionRecord.conversation[0].responseBytes, inputTokens: 640, outputTokens: 12, totalTokens: 652, source: "reported" });
      assert.equal(byKind.selection[0].usage.totalTokens, 652);
      const draftRecord = exported.records.find((entry) => entry.id === draft.json.historyId);
      assert.equal(draftRecord.usage.source, "estimated");
      assert.equal(draftRecord.conversation[0].usage.inputTokens, Math.ceil(draftRecord.conversation[0].requestBytes / 4));
      assert.equal(JSON.stringify(exported).includes(`127.0.0.1:${endpoint.port}`), false, "no endpoint address in the export");
    } finally {
      await creator.close();
      await endpoint.close();
      await rm(dataRoot, { recursive: true, force: true });
    }
  });
});

async function waitFor(check) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("condition not met");
}

async function startEndpoint() {
  const state = { count: 0, slow: false };
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    state.count += 1;
    if (state.slow) await new Promise((resolve) => setTimeout(resolve, 1500));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const explaining = JSON.stringify(body).includes("explain_selection");
    if (res.destroyed) return;
    res.writeHead(200, { "content-type": "application/json" });
    // Explain answers report usage; draft answers do not, so their tokens are estimated.
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(explaining ? { answer: "Explained.", proposals: [] } : { proposals: [] }) } }], ...(explaining ? { usage: { prompt_tokens: 640, completion_tokens: 12, total_tokens: 652 } } : {}) }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return Object.assign(state, { port: server.address().port, close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }) });
}
