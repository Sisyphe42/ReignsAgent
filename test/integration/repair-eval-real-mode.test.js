import assert from "node:assert/strict";
import { createServer } from "node:http";
import { describe, it } from "node:test";

import { realEvalTasks, runRealRepairEval, skippedForRealEval } from "../../scripts/repair-eval/real-eval.mjs";

// Exercises the real-endpoint runner against a local stand-in "model" so the code path is
// tested offline. The stand-in only sees the request; it is never given scripted answers
// by the runner (it answers with a generic producer card for whatever it is asked).
async function startStandIn() {
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    requests.push({ authorization: req.headers.authorization ?? null, raw });
    const proposals = [{
      id: "wipe-all",
      title: "Clear the warehouse gate",
      summary: "Remove every requirement.",
      patches: [{ op: "updateCard", cardId: "sealed-warehouse", changes: { requirements: {} } }]
    }];
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ proposals }) } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { port: server.address().port, requests, close: () => new Promise((resolve) => server.close(resolve)) };
}

describe("real-endpoint repair eval runner", () => {
  it("declares real tasks and skip reasons for scripted-only cases", () => {
    const tasks = realEvalTasks();
    assert.deepEqual(tasks.map((task) => task.id), ["fog-unreachable", "fog-missing-tag", "court-gauge-pressure", "court-variable-gate", "night-watch-stall"]);
    assert.ok(skippedForRealEval().every((entry) => entry.reason.length > 0));
  });

  it("runs k times per task without sending a key, honours the request cap, and records blocks and usage", async () => {
    const standIn = await startStandIn();
    try {
      const tasks = realEvalTasks().filter((task) => task.id === "fog-unreachable");
      const report = await runRealRepairEval({ endpoint: `http://127.0.0.1:${standIn.port}/v1`, model: "stand-in", k: 2, maxRequests: 4, tasks });
      assert.equal(report.requestsSent, 4);
      assert.ok(standIn.requests.every((request) => request.authorization === null));
      assert.ok(!standIn.requests.some((request) => request.raw.includes("quarantine-board") || request.raw.includes("realSkip")), "scripted answers never reach the model");
      assert.equal(report.runs.length, 2);
      assert.equal(report.summary.verifiedRuns, 0);
      assert.ok(report.summary.blockedByCheck.gates_preserved >= 1);
      assert.equal(report.summary.tokens.total, 15 * report.requestsSent);
      assert.ok(report.runs.some((run) => run.status === "unverified" || run.status === "not_run"));
    } finally {
      await standIn.close();
    }
  });

  it("refuses non-loopback endpoints", async () => {
    await assert.rejects(runRealRepairEval({ endpoint: "https://api.example.com/v1", model: "x", k: 1, tasks: [] }), /loopback/);
  });
});
