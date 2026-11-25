import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { createCreatorServer } from "../../apps/creator-server/src/server.mjs";

const FOG = JSON.parse(readFileSync(new URL("../../fixtures/content/fog-harbor.cards.json", import.meta.url), "utf8"));
const SECRET = "history-secret-key-value";

function brokenFogHarbor() {
  const bundle = structuredClone(FOG);
  bundle.cards.push({
    id: "sealed-warehouse",
    text: "The quarantine is lifted. Warehouse seven can open.",
    weight: 1,
    requirements: { allTags: ["onWatch", "quarantineLifted"] },
    choices: [
      { id: "left", label: "Send the doctor first", effects: { factions: { gauge3: 5, gauge0: -5 } } },
      { id: "right", label: "Unload at once", effects: { factions: { gauge0: 9, gauge1: -6 } } }
    ]
  });
  return bundle;
}

const WIPE = [{ id: "wipe-gate", title: "Open the warehouse", summary: "Remove the gate.", patches: [{ op: "updateCard", cardId: "sealed-warehouse", changes: { requirements: {} } }] }];
const FIX = [{
  id: "quarantine-board",
  title: "Add a quarantine decision",
  summary: "A health-board card can lift the quarantine.",
  patches: [{ op: "addCard", card: { id: "quarantine-board", text: "The health board asks to end the quarantine.", weight: 1, requirements: { allTags: ["onWatch"] }, choices: [
    { id: "left", label: "Lift it", effects: { factions: { gauge1: 4, gauge0: -3 }, tags: { quarantineLifted: true } } },
    { id: "right", label: "Keep it", effects: { factions: { gauge0: 3, gauge1: -4 } } }
  ] } }]
}];

describe("repair history through the Creator Server", () => {
  it("records every loop with rounds, blocking checks, and the author's final selection, without keys", async () => {
    const answers = [{ status: 200, proposals: WIPE }, { status: 200, proposals: FIX }, { status: 503 }];
    const endpoint = await startEndpoint(answers);
    const dataRoot = await mkdtemp(join(tmpdir(), "reigns-history-int-"));
    const creator = await createCreatorServer({ dataRoot, initialBundle: brokenFogHarbor() });
    const { origin } = await creator.start({ host: "127.0.0.1", port: 0 });
    try {
      const api = await client(origin);
      await api("POST", "/api/diagnostics/run", { cycles: 500, maxTurns: 40, seed: 1 });
      const config = { provider: "openai_chat", endpoint: `http://127.0.0.1:${endpoint.port}/v1`, modelId: "mock-repair", apiKeyRef: "browser-local" };
      const request = { mode: "repair_diagnostics", config, credentials: { apiKey: SECRET }, instruction: "Repair the unreachable sealed-warehouse card.", repairTarget: { code: "unreachable_cards", cardIds: ["sealed-warehouse"] } };

      const plan = await api("POST", "/api/ai/edit/plan", request);
      assert.equal(plan.verification.status, "verified");
      assert.match(plan.historyId, /^rh-/);

      const applied = await api("POST", "/api/ai/edit/apply", { plan, proposalIds: ["quarantine-board"] });
      assert.equal(applied.historyId, plan.historyId);

      // A later loop fails in round one (503): it is recorded as failed at the request stage.
      await api("POST", "/api/diagnostics/run", { cycles: 500, maxTurns: 40, seed: 1 });
      const failed = await api("POST", "/api/ai/edit/plan", { ...request, repairTarget: null }, { expectError: true });
      assert.equal(failed.code, "endpoint_http_error");

      const { records } = await api("GET", "/api/ai/repair-history");
      assert.equal(records.length, 2);
      assert.equal(records[0].status, "failed");
      assert.equal(records[1].id, plan.historyId);
      assert.equal(records[1].outcome, "applied");
      assert.deepEqual(records[1].appliedProposalIds, ["quarantine-board"]);

      const { record } = await api("GET", `/api/ai/repair-history/${plan.historyId}`);
      assert.equal(record.rounds.length, 2);
      assert.deepEqual(record.rounds[0].proposals[0].failedChecks, ["gates_preserved"]);
      assert.equal(record.rounds[0].proposals[0].summary, "Remove the gate.");
      assert.ok(record.rounds[0].proposals[0].failedDetails[0].detail.length > 0, "keeps why the check blocked it");
      assert.equal(record.rounds[1].proposals[0].passed, true);
      assert.equal(record.baseline.healthScore, 55);
      assert.ok(record.contextSelection.included > 0);
      assert.equal(record.instruction, request.instruction);
      const failedRecord = (await api("GET", `/api/ai/repair-history/${records[0].id}`)).record;
      assert.deepEqual([failedRecord.error.code, failedRecord.error.stage], ["endpoint_http_error", "request"]);

      const { activeProjectId } = await api("GET", "/api/config");
      const stored = await readFile(join(dataRoot, "projects", activeProjectId, "repair-history.json"), "utf8");
      assert.equal(stored.includes(SECRET), false, "no key in stored history");
      assert.equal(stored.includes(`127.0.0.1:${endpoint.port}`), false, "no endpoint URL in stored history");

      await api("DELETE", `/api/ai/repair-history/${records[0].id}`);
      assert.equal((await api("GET", "/api/ai/repair-history")).records.length, 1);
      assert.deepEqual(await api("DELETE", "/api/ai/repair-history"), { cleared: 1 });
      const missing = await api("GET", `/api/ai/repair-history/${plan.historyId}`, undefined, { expectError: true });
      assert.equal(missing.code, "repair_history_not_found");
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

async function startEndpoint(answers) {
  let count = 0;
  const server = createServer(async (req, res) => {
    for await (const chunk of req) void chunk;
    const answer = answers[Math.min(count, answers.length - 1)];
    count += 1;
    res.writeHead(answer.status, { "content-type": "application/json" });
    res.end(JSON.stringify(answer.status === 200 ? { choices: [{ message: { content: JSON.stringify({ proposals: answer.proposals }) } }] } : { error: "busy" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { port: server.address().port, close: () => new Promise((resolve) => server.close(resolve)) };
}
