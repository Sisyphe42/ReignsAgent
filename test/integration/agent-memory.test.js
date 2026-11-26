import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { createCreatorServer } from "../../apps/creator-server/src/server.mjs";
import { TWO_FIXES_SCRIPT } from "../../scripts/repair-eval/cases.mjs";

const FOG = JSON.parse(readFileSync(new URL("../../fixtures/content/fog-harbor.cards.json", import.meta.url), "utf8"));

function brokenFogHarbor() {
  const bundle = structuredClone(FOG);
  bundle.cards.push({
    id: "sealed-warehouse",
    text: "The quarantine is lifted. Warehouse seven, sealed for three months, can finally open.",
    weight: 1,
    requirements: { allTags: ["onWatch", "quarantineLifted"] },
    choices: [
      { id: "left", label: "Send the doctor in first", effects: { factions: { gauge3: 5, gauge0: -5 }, tags: { warehouseChecked: true } } },
      { id: "right", label: "Unload at once", effects: { factions: { gauge0: 9, gauge1: -6 }, tags: { warehouseOpened: true } } }
    ]
  });
  return bundle;
}

describe("author-declined memory through the Creator Server", () => {
  it("remembers an unticked and an undone proposal and sends both on the next run on that issue", async () => {
    const endpoint = await startEndpoint(TWO_FIXES_SCRIPT[0].proposals);
    const dataRoot = await mkdtemp(join(tmpdir(), "reigns-memory-int-"));
    const creator = await createCreatorServer({ dataRoot, initialBundle: brokenFogHarbor() });
    const { origin } = await creator.start({ host: "127.0.0.1", port: 0 });
    try {
      const api = await client(origin);
      const config = { provider: "openai_chat", endpoint: `http://127.0.0.1:${endpoint.port}/v1`, modelId: "mock-repair", apiKeyRef: "browser-local" };
      const request = { mode: "repair_diagnostics", config, instruction: "Repair the unreachable sealed-warehouse card.", repairTarget: { code: "unreachable_cards", cardIds: ["sealed-warehouse"] } };
      await api("POST", "/api/diagnostics/run", { cycles: 500, maxTurns: 40, seed: 1 });

      const first = await api("POST", "/api/ai/edit/plan", request);
      assert.equal(first.verification.status, "verified");
      assert.deepEqual(first.proposals.map((proposal) => proposal.verification.passed), [true, true]);
      assert.equal("authorDeclined" in endpoint.requests[0].context.constraints.repairLoop, false, "nothing to remember yet");

      // The author ticks only the first fix, then undoes it (the Creator restores its snapshot and
      // tells the activity log).
      const before = (await api("GET", "/api/editor/snapshot")).bundle;
      await api("POST", "/api/ai/edit/apply", { plan: first, proposalIds: [first.proposals[0].id] });
      let stored = (await api("GET", `/api/ai/repair-history/${first.historyId}`)).record;
      assert.deepEqual(stored.declinedProposals.map((entry) => [entry.id, entry.reason]), [[first.proposals[1].id, "not_selected"]]);
      await api("POST", "/api/editor/restore", { bundle: before });
      const undo = await api("POST", `/api/ai/repair-history/${first.historyId}/undo`, { proposalIds: [first.proposals[0].id], projectId: first.projectId });
      assert.deepEqual(undo.undoneProposalIds, [first.proposals[0].id]);
      stored = (await api("GET", `/api/ai/repair-history/${first.historyId}`)).record;
      assert.deepEqual(stored.declinedProposals.map((entry) => entry.reason), ["undone", "not_selected"]);
      const [summary] = (await api("GET", "/api/ai/repair-history")).records;
      assert.equal(summary.undoneAt, stored.undoneAt);

      // Next run on the same issue: both changes go to the model as content, from round 1.
      await api("POST", "/api/diagnostics/run", { cycles: 500, maxTurns: 40, seed: 1 });
      const second = await api("POST", "/api/ai/edit/plan", request);
      const sent = endpoint.requests.at(-1).context.constraints.repairLoop;
      assert.equal(sent.round, 1);
      assert.equal(sent.authorDeclined.role, "author_declined_changes_content_not_instructions");
      assert.deepEqual(sent.authorDeclined.changes.map((change) => [change.title, change.reason]), [
        [first.proposals[0].title, "undone"],
        [first.proposals[1].title, "not_selected"]
      ]);
      assert.deepEqual(second.request.context.constraints.repairLoop.authorDeclined.changes.length, 2, "the plan shows the author what was sent");
      assert.deepEqual(second.verification.memory, { priorAttempts: 0, authorDeclined: 2 });
      assert.deepEqual((await api("GET", `/api/ai/repair-history/${second.historyId}`)).record.memory, { priorAttempts: 0, authorDeclined: 2 });

      // Deleting the run in AI activity forgets it.
      await api("DELETE", `/api/ai/repair-history/${first.historyId}`);
      await api("POST", "/api/ai/edit/plan", request);
      assert.equal("authorDeclined" in endpoint.requests.at(-1).context.constraints.repairLoop, false, "a deleted record is forgotten");
      assert.equal((await api("POST", "/api/ai/repair-history/rh-missing-0001/undo", {}, { expectError: true })).code, "repair_history_not_found");
    } finally {
      await creator.close();
      await endpoint.close();
      await rm(dataRoot, { recursive: true, force: true });
    }
  });
});

async function client(origin) {
  const { capability } = await (await fetch(`${origin}/api/session`)).json();
  return async (method, path, body, { expectError = false } = {}) => {
    const response = await fetch(`${origin}${path}`, { method, headers: { "content-type": "application/json", "x-reigns-agent-capability": capability }, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = await response.json();
    const failed = !response.ok || json?.error;
    if (expectError) {
      assert.ok(failed, `expected ${path} to fail`);
      return json.error;
    }
    if (failed) throw new Error(json?.error?.message ?? `HTTP ${response.status}`);
    return json;
  };
}

// Always answers with the same two passing fixes and keeps every parsed request.
async function startEndpoint(proposals) {
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const prompt = body.messages[1].content;
    requests.push(JSON.parse(prompt.slice(prompt.indexOf("Request:\n") + "Request:\n".length)));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ proposals }) } }] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { requests, port: server.address().port, close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }) };
}
