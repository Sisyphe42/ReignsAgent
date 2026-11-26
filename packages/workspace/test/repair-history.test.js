import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  REPAIR_HISTORY_FILE,
  REPAIR_HISTORY_LIMITS,
  appendRepairHistory,
  emptyRepairHistory,
  parseRepairHistory,
  removeRepairHistory,
  summarizeRepairHistory,
  updateRepairHistory
} from "../src/contracts.js";
import { createWorkspaceStore } from "../src/index.js";

function record(index, extra = {}) {
  return {
    id: `rh-test-${String(index).padStart(4, "0")}`,
    createdAt: new Date(Date.UTC(2026, 10, 25, 0, 0, index)).toISOString(),
    status: "verified",
    baseline: { healthScore: 55 },
    roundsUsed: 1,
    maxRounds: 3,
    rounds: [{ round: 1, status: "evaluated", proposalCount: 1, passedCount: 1, bestScore: 78, proposals: [{ id: "p", title: "Fix", summary: "s", passed: true, failedChecks: [] }] }],
    outcome: "draft",
    appliedProposalIds: [],
    ...extra
  };
}

describe("repair history contract", () => {
  it("keeps the newest records first and prunes beyond the count limit", () => {
    let history = emptyRepairHistory();
    let pruned = [];
    for (let index = 0; index < REPAIR_HISTORY_LIMITS.maxRecords + 3; index += 1) {
      const result = appendRepairHistory(history, record(index));
      history = result.history;
      pruned = pruned.concat(result.pruned);
    }
    assert.equal(history.records.length, REPAIR_HISTORY_LIMITS.maxRecords);
    assert.equal(history.records[0].id, `rh-test-${String(REPAIR_HISTORY_LIMITS.maxRecords + 2).padStart(4, "0")}`);
    assert.deepEqual(pruned, ["rh-test-0000", "rh-test-0001", "rh-test-0002"]);
    assert.equal(summarizeRepairHistory(history)[0].bestScore, 78);
  });

  it("trims oversized records instead of storing unbounded detail", () => {
    const proposals = Array.from({ length: 80 }, (_, index) => ({ id: `p${index}`, title: "t".repeat(150), summary: "s".repeat(240), passed: false, failedChecks: ["scope"], failedDetails: [{ id: "scope", detail: "d".repeat(200) }] }));
    const big = record(1, { rounds: [1, 2, 3].map((round) => ({ round, status: "evaluated", proposalCount: 80, passedCount: 0, bestScore: 50, proposals })) });
    const { record: stored } = appendRepairHistory(emptyRepairHistory(), big);
    assert.equal(stored.truncated, true);
    assert.ok(new TextEncoder().encode(JSON.stringify(stored)).length <= REPAIR_HISTORY_LIMITS.maxRecordBytes);
    assert.equal(stored.rounds.length, 3, "every round stays replayable");
  });

  it("shortens the stored conversation before touching round evidence", () => {
    const conversation = [1, 2, 3].map((round) => ({ round, call: round, requestBody: "q".repeat(40_000), responseText: "a".repeat(10_000) }));
    const { record: stored } = appendRepairHistory(emptyRepairHistory(), record(7, { conversation }));
    assert.equal(stored.conversationTruncated, true);
    assert.equal(stored.truncated, undefined, "round evidence untouched");
    assert.ok(stored.conversation[0].requestBody.length < 3000);
    assert.equal(summarizeRepairHistory({ records: [record(8, { rounds: [{ round: 1, requestMs: 1200 }, { round: 2, requestMs: 900 }] })] })[0].requestMs.join(), "1200,900");
  });

  it("summarizes usage and blocking checks for the list", () => {
    const usage = { calls: 2, requestBytes: 9000, responseBytes: 800, inputTokens: 2250, outputTokens: 200, totalTokens: 2450, source: "estimated" };
    const rounds = [{ round: 1, blockedBy: { scope: 2, gates_preserved: 1 } }, { round: 2, blockedBy: { scope: 1, bogus: "x" } }, { round: 3 }];
    const [summary] = summarizeRepairHistory({ records: [record(9, { usage, rounds })] });
    assert.deepEqual(summary.usage, usage);
    assert.deepEqual(summary.blockedBy, { scope: 3, gates_preserved: 1 });
    const [old] = summarizeRepairHistory({ records: [record(10)] });
    assert.equal(old.usage, null, "records written before usage tracking list as unknown");
    assert.deepEqual(old.blockedBy, {});
  });

  it("updates, removes, rejects bad ids, and recovers from a corrupt file", () => {
    let { history } = appendRepairHistory(emptyRepairHistory(), record(1));
    ({ history } = updateRepairHistory(history, "rh-test-0001", (entry) => ({ ...entry, outcome: "applied", appliedProposalIds: ["p"] })));
    assert.deepEqual(summarizeRepairHistory(history)[0].appliedProposalIds, ["p"]);
    assert.throws(() => updateRepairHistory(history, "rh-test-0001", (entry) => ({ ...entry, id: "rh-other-0001" })), /cannot change/);
    assert.throws(() => removeRepairHistory(history, "../escape"), { code: "repair_history_id_invalid" });
    assert.equal(removeRepairHistory(history, "rh-test-0001").history.records.length, 0);
    assert.deepEqual(parseRepairHistory("{not json"), emptyRepairHistory());
  });
});

describe("repair history workspace storage", () => {
  it("stores records in the active project's directory and clears them", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "reigns-history-"));
    try {
      const store = await createWorkspaceStore({ dataRoot, initialBundle: { cards: [] } });
      assert.deepEqual(await store.listRepairHistory(), []);
      await store.appendRepairHistoryRecord(record(1));
      await store.appendRepairHistoryRecord(record(2));
      await store.updateRepairHistoryRecord("rh-test-0001", (entry) => ({ ...entry, outcome: "applied", appliedProposalIds: ["p"] }));
      const list = await store.listRepairHistory();
      assert.deepEqual(list.map((entry) => entry.id), ["rh-test-0002", "rh-test-0001"]);
      assert.equal((await store.readRepairHistoryRecord("rh-test-0001")).outcome, "applied");
      const { activeProjectId } = await store.getConfig();
      const file = await readFile(join(dataRoot, "projects", activeProjectId, REPAIR_HISTORY_FILE), "utf8");
      assert.equal(JSON.parse(file).records.length, 2);

      await store.createProject({ source: "blank" });
      assert.deepEqual(await store.listRepairHistory(), [], "history is per project");
      // A run started in the first project and finished after the switch still lands there.
      await store.appendRepairHistoryRecord(record(3), { projectId: activeProjectId });
      assert.deepEqual(await store.listRepairHistory(), [], "the newly active project stays empty");
      await store.openProject(activeProjectId);
      assert.equal((await store.listRepairHistory()).length, 3);
      await store.deleteRepairHistoryRecord("rh-test-0002");
      assert.deepEqual(await store.clearRepairHistory(), { cleared: 2 });
      assert.deepEqual(await store.listRepairHistory(), []);
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  });
});
