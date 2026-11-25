#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { buildVerifiedRepairPlan, createCardEditor } from "../packages/interface/src/index.js";
import { ANTI_SHORTCUT_CHECKS, REPAIR_EVAL_CASES } from "./repair-eval/cases.mjs";
import { startRepairMockEndpoint } from "./repair-eval/mock-endpoint.mjs";

/**
 * Offline repair-loop eval. Runs every case against a local scripted mock
 * endpoint (real HTTP, no real model, no key) and reports:
 * - repair success rate (cases that end "verified"),
 * - harness agreement (outcome matches the case's expected outcome),
 * - average rounds, anti-shortcut blocks, and how many blocked proposals a
 *   score-only judge (target gone + score not lower) would have accepted.
 */
export async function runRepairEval({ cases = REPAIR_EVAL_CASES } = {}) {
  const mock = await startRepairMockEndpoint({ scripts: Object.fromEntries(cases.map((entry) => [entry.id, entry.script])) });
  const results = [];
  try {
    for (const entry of cases) {
      const startedAt = Date.now();
      let plan = null;
      let error = null;
      try {
        plan = await buildVerifiedRepairPlan({
          editor: createCardEditor(entry.deck()),
          config: { provider: "openai_chat", endpoint: `http://127.0.0.1:${mock.port}/${entry.id}/v1`, modelId: "scripted-repair-model", apiKeyRef: "none" },
          instruction: entry.description,
          repairTarget: entry.repairTarget ?? null,
          fetchImpl: globalThis.fetch
        });
      } catch (caught) {
        error = { code: caught?.code ?? "error", message: caught?.message ?? String(caught) };
      }
      results.push(scoreCase(entry, plan, error, Date.now() - startedAt));
    }
  } finally {
    await mock.close();
  }
  return { cases: results, summary: summarize(results) };
}

function scoreCase(entry, plan, error, durationMs) {
  const verification = plan?.verification ?? null;
  const rounds = verification?.rounds ?? [];
  const blocked = {};
  let antiShortcutBlocks = 0;
  let scoreOnlyWouldAccept = 0;
  let evaluatedProposals = 0;
  for (const round of rounds) {
    for (const [id, count] of Object.entries(round.blockedBy ?? {})) {
      if (round.status === "rejected_response") continue;
      blocked[id] = (blocked[id] ?? 0) + count;
    }
  }
  for (const proposal of collectEvaluatedProposals(plan, rounds)) {
    evaluatedProposals += 1;
    const failed = new Set(proposal.failedChecks ?? []);
    if ([...failed].some((id) => ANTI_SHORTCUT_CHECKS.has(id))) antiShortcutBlocks += 1;
    if (failed.size > 0 && !failed.has("target_resolved") && !failed.has("score_not_lower") && !failed.has("patches_apply")) scoreOnlyWouldAccept += 1;
  }
  const rejectedRounds = rounds.filter((round) => round.status === "rejected_response").length;
  const mismatches = [];
  if (error) mismatches.push(`threw ${error.code}: ${error.message}`);
  if (verification) {
    if (verification.status !== entry.expect.status) mismatches.push(`status ${verification.status} (expected ${entry.expect.status})`);
    if (rounds.length !== entry.expect.rounds) mismatches.push(`rounds ${rounds.length} (expected ${entry.expect.rounds})`);
    if (entry.expect.stopReason && verification.stopReason !== entry.expect.stopReason) mismatches.push(`stopReason ${verification.stopReason} (expected ${entry.expect.stopReason})`);
    if (entry.expect.contextRequests && JSON.stringify(verification.requestedCardIds ?? []) !== JSON.stringify(entry.expect.contextRequests)) mismatches.push(`requested cards ${JSON.stringify(verification.requestedCardIds ?? [])} (expected ${JSON.stringify(entry.expect.contextRequests)})`);
    if ((entry.expect.rejectedRounds ?? 0) !== rejectedRounds) mismatches.push(`rejected rounds ${rejectedRounds} (expected ${entry.expect.rejectedRounds ?? 0})`);
    for (const [id, count] of Object.entries(entry.expect.blocked ?? {})) {
      if ((blocked[id] ?? 0) !== count) mismatches.push(`${id} blocked ${blocked[id] ?? 0}× (expected ${count})`);
    }
  }
  const finalPassed = (plan?.proposals ?? []).find((proposal) => proposal.verification?.passed);
  return {
    id: entry.id,
    description: entry.description,
    status: verification?.status ?? "error",
    stopReason: verification?.stopReason ?? error?.code ?? null,
    rounds: rounds.length,
    roundStatuses: rounds.map((round) => round.status),
    baselineScore: verification?.baseline?.healthScore ?? null,
    bestScoreByRound: rounds.map((round) => round.bestScore),
    finalScore: finalPassed?.verification?.score?.after ?? null,
    blocked,
    evaluatedProposals,
    antiShortcutBlocks,
    scoreOnlyWouldAccept,
    requestBytes: rounds.reduce((total, round) => total + (round.usage?.requestBytes ?? 0), 0),
    responseBytes: rounds.reduce((total, round) => total + (round.usage?.responseBytes ?? 0), 0),
    durationMs,
    matchesExpectation: mismatches.length === 0,
    mismatches
  };
}

function collectEvaluatedProposals(plan, rounds) {
  return rounds.flatMap((round) => round.proposals ?? []).filter((proposal) => !(proposal.failedChecks ?? []).includes("evaluation_budget"));
}

function summarize(results) {
  const total = results.length;
  const verified = results.filter((result) => result.status === "verified");
  const sum = (values) => values.reduce((total, value) => total + value, 0);
  const blockedByCheck = {};
  for (const result of results) {
    for (const [id, count] of Object.entries(result.blocked)) blockedByCheck[id] = (blockedByCheck[id] ?? 0) + count;
  }
  return {
    cases: total,
    verified: verified.length,
    repairSuccessRate: round(verified.length / total),
    harnessAgreement: round(results.filter((result) => result.matchesExpectation).length / total),
    averageRounds: round(sum(results.map((result) => result.rounds)) / total),
    averageRoundsWhenVerified: verified.length ? round(sum(verified.map((result) => result.rounds)) / verified.length) : null,
    evaluatedProposals: sum(results.map((result) => result.evaluatedProposals)),
    antiShortcutBlocks: sum(results.map((result) => result.antiShortcutBlocks)),
    scoreOnlyWouldAccept: sum(results.map((result) => result.scoreOnlyWouldAccept)),
    rejectedResponses: sum(results.map((result) => result.roundStatuses.filter((status) => status === "rejected_response").length)),
    endpointErrors: sum(results.map((result) => result.roundStatuses.filter((status) => status === "endpoint_error").length)),
    blockedByCheck: Object.fromEntries(Object.entries(blockedByCheck).sort()),
    totalRequestBytes: sum(results.map((result) => result.requestBytes)),
    totalResponseBytes: sum(results.map((result) => result.responseBytes))
  };
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function formatReport({ cases, summary }) {
  const lines = [];
  lines.push("Repair-loop eval (scripted mock endpoint; measures the harness, not a model)");
  lines.push("");
  lines.push(["case", "status", "rounds", "score by round", "blocked by", "match"].join(" | "));
  for (const result of cases) {
    const scores = `${result.baselineScore ?? "–"} → [${result.bestScoreByRound.map((score) => score ?? "–").join(", ")}]`;
    const blocked = Object.entries(result.blocked).map(([id, count]) => `${id}×${count}`).join(", ") || "–";
    lines.push([result.id, `${result.status} (${result.stopReason})`, result.rounds, scores, blocked, result.matchesExpectation ? "yes" : `NO: ${result.mismatches.join("; ")}`].join(" | "));
  }
  lines.push("");
  lines.push(`cases: ${summary.cases}`);
  lines.push(`repair success (verified): ${summary.verified}/${summary.cases} = ${(summary.repairSuccessRate * 100).toFixed(1)}%`);
  lines.push(`harness agreement with expected outcome: ${(summary.harnessAgreement * 100).toFixed(1)}%`);
  lines.push(`average rounds: ${summary.averageRounds} (verified cases: ${summary.averageRoundsWhenVerified})`);
  lines.push(`evaluated proposals: ${summary.evaluatedProposals}; blocked by anti-shortcut checks: ${summary.antiShortcutBlocks}; of those a score-only judge would have accepted: ${summary.scoreOnlyWouldAccept}`);
  lines.push(`rejected responses fed back: ${summary.rejectedResponses}; endpoint errors: ${summary.endpointErrors}`);
  lines.push(`blocked by check: ${Object.entries(summary.blockedByCheck).map(([id, count]) => `${id}=${count}`).join(", ")}`);
  lines.push(`bytes sent/received: ${summary.totalRequestBytes}/${summary.totalResponseBytes}`);
  return lines.join("\n");
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index !== -1 ? process.argv[index + 1] : undefined;
}

async function runRealCli() {
  const { runRealRepairEval } = await import("./repair-eval/real-eval.mjs");
  const endpoint = argValue("--endpoint");
  const model = argValue("--model");
  if (!endpoint || !model) {
    console.error("Usage: npm run eval:repair -- --real --endpoint http://127.0.0.1:<port>/v1 --model <id> [--k 3] [--max-requests 150] [--json <path>]");
    process.exit(2);
  }
  const report = await runRealRepairEval({
    endpoint,
    model,
    k: Number(argValue("--k") ?? 3),
    maxRequests: Number(argValue("--max-requests") ?? 150),
    log: (line) => console.log(line)
  });
  const { summary } = report;
  console.log("");
  console.log(`Real-endpoint repair eval: ${model} @ ${endpoint} (no key sent)`);
  for (const task of summary.perTask) console.log(`  ${task.task}: ${task.verified}/${task.runs} verified, rounds [${task.rounds.join(", ")}], statuses [${task.statuses.join(", ")}]`);
  console.log(`pass@1 mean: ${(summary.passAt1Mean * 100).toFixed(1)}%; tasks with >=1 success: ${summary.tasksWithAnySuccess}/${summary.tasks}`);
  console.log(`average rounds: ${summary.averageRounds}; runs errored: ${summary.runsErrored}; retried: ${summary.runsRetried}`);
  console.log(`proposals evaluated: ${summary.evaluatedProposals}; blocked: ${summary.blockedProposals}; rejected responses: ${summary.rejectedRounds}; endpoint-error rounds: ${summary.endpointErrorRounds}`);
  console.log(`blocked by check: ${Object.entries(summary.blockedByCheck).map(([id, count]) => `${id}=${count}`).join(", ") || "none"}`);
  console.log(`requests: ${report.requestsSent}/${report.requestCap}; bytes sent/received: ${summary.requestBytes}/${summary.responseBytes}; tokens: ${summary.tokens.total} (${summary.tokens.callsWithUsage} calls reported usage); avg run ${summary.averageRunMs} ms; total ${report.durationMs} ms`);
  const jsonPath = argValue("--json");
  if (jsonPath) {
    await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`JSON report: ${jsonPath}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href && process.argv.includes("--real")) {
  await runRealCli();
} else if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const jsonIndex = process.argv.indexOf("--json");
  const report = await runRepairEval();
  console.log(formatReport(report));
  if (jsonIndex !== -1 && process.argv[jsonIndex + 1]) {
    await writeFile(process.argv[jsonIndex + 1], `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`\nJSON report: ${process.argv[jsonIndex + 1]}`);
  }
  if (report.summary.harnessAgreement < 1) process.exitCode = 1;
}
