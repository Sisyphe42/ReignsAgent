import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createRepairHistoryRecord, markRepairHistoryApplied } from "../src/index.js";

describe("repair history records", () => {
  it("keeps whitelisted fields only and redacts known secrets", () => {
    const plan = {
      provider: { model: "mock-model", endpoint: "http://secret-host.test/v1" },
      config: { endpoint: "http://secret-host.test/v1", apiKey: "sk-should-not-leak" },
      request: { context: { bundle: { cardSelection: { strategy: "relevance_v1", included: 3, omitted: 1, tiers: { target: 1 }, omittedReasons: { count_limit: 1, byte_budget: 0 }, reasons: { a: "target: selected card" } } } } },
      proposals: [{ id: "p1", title: "Fix", patches: [{}], verification: { passed: true, score: { after: 70 } } }],
      verification: {
        status: "verified",
        stopReason: "verified",
        endpoint: "configured",
        targets: [{ code: "unreachable_cards", severity: "error", entity: "card:x" }],
        baseline: { healthScore: 55 },
        selectedRound: 1,
        roundsUsed: 1,
        limits: { maxRounds: 3 },
        timing: { durationMs: 1200 },
        rounds: [{
          round: 1,
          status: "evaluated",
          proposalCount: 1,
          passedCount: 1,
          bestScore: 70,
          blockedBy: {},
          exchange: [{ request: "body with sk-should-not-leak" }],
          proposals: [{ id: "p1", title: "Fix", summary: "Mentions sk-should-not-leak by accident", passed: true, failedChecks: [], failedDetails: [], scoreAfter: 70 }]
        }]
      }
    };
    const record = createRepairHistoryRecord({ plan, request: { instruction: "Repair x" }, id: "rh-unit-000001", secrets: ["sk-should-not-leak"] });
    const text = JSON.stringify(record);
    assert.equal(text.includes("sk-should-not-leak"), false);
    assert.equal(text.includes("secret-host"), false);
    assert.equal(text.includes("exchange"), false);
    assert.equal(record.model, "mock-model");
    assert.deepEqual(record.preselectedProposalIds, ["p1"]);
    assert.equal(record.rounds[0].proposals[0].summary, "Mentions [redacted] by accident");
    assert.equal(record.contextSelection.omittedReasons.count_limit, 1);

    const applied = markRepairHistoryApplied(record, { proposalIds: ["p1", "p1"], appliedAt: "2026-11-25T00:00:00.000Z" });
    assert.deepEqual([applied.outcome, applied.appliedProposalIds], ["applied", ["p1"]]);
  });

  it("never stores endpoint URLs or credentials from fetch error text", () => {
    const error = Object.assign(new Error("AI endpoint request failed: fetch failed for https://user:s3cret@api.example.test/v1/chat?sig=abc123 (ECONNREFUSED)"), { code: "endpoint_network_error", stage: "request" });
    error.repairVerification = { status: "failed", rounds: [{ round: 1, status: "endpoint_error", error: { code: "endpoint_network_error", message: "connect to http://admin:pw@10.0.0.5:8080/v1?token=t failed" } }] };
    const text = JSON.stringify(createRepairHistoryRecord({ error, id: "rh-unit-url001" }));
    for (const secret of ["s3cret", "sig=abc123", "api.example.test", "admin:pw", "token=t"]) assert.equal(text.includes(secret), false, secret);
    assert.match(text, /\[url redacted\]/);
  });

  it("records a failed loop with its error stage", () => {
    const error = Object.assign(new Error("AI endpoint request failed with status 503"), { code: "endpoint_http_error", stage: "request" });
    const record = createRepairHistoryRecord({ error, request: { instruction: "Repair" }, id: "rh-unit-000002" });
    assert.equal(record.status, "failed");
    assert.deepEqual(record.error, { code: "endpoint_http_error", stage: "request", message: "AI endpoint request failed with status 503" });
    assert.deepEqual(record.rounds, []);
  });
});
