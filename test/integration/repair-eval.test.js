import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runRepairEval } from "../../scripts/eval-repair-loop.mjs";
import { REPAIR_EVAL_CASES } from "../../scripts/repair-eval/cases.mjs";

describe("offline repair-loop eval", () => {
  it("matches every case's expected harness outcome on the scripted mock endpoint", async () => {
    const report = await runRepairEval();
    const mismatched = report.cases.filter((result) => !result.matchesExpectation);
    assert.deepEqual(mismatched.map((result) => `${result.id}: ${result.mismatches.join("; ")}`), []);

    // 10 harness cases plus 2 model-directive cases (contextRequests, stop).
    assert.ok(REPAIR_EVAL_CASES.length >= 5 && REPAIR_EVAL_CASES.length <= 12);
    assert.equal(report.summary.harnessAgreement, 1);
    assert.equal(report.summary.verified, REPAIR_EVAL_CASES.filter((entry) => entry.expect.status === "verified").length);
    assert.ok(report.summary.antiShortcutBlocks > 0);
    assert.ok(report.summary.scoreOnlyWouldAccept > 0, "some blocked shortcuts would pass a score-only judge");
    assert.ok(report.summary.averageRounds >= 1 && report.summary.averageRounds <= 3);
  });

  it("is reproducible run to run", async () => {
    const strip = (report) => report.cases.map(({ durationMs, ...rest }) => rest);
    const [first, second] = [await runRepairEval(), await runRepairEval()];
    assert.deepEqual(strip(first), strip(second));
  });
});
