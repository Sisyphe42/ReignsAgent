import { buildVerifiedRepairPlan, createCardEditor, runDiagnostics, collectIssueEntities, DEFAULT_REPAIR_SCORING } from "../../packages/interface/src/index.js";
import { REPAIR_EVAL_CASES } from "./cases.mjs";

/**
 * Real-endpoint repair-loop eval.
 *
 * Each real-capable task sends only the broken deck and the target issue to the
 * endpoint (no scripted answers); the verified loop judges the answers with the
 * same checks as the offline eval. No API key is set or read: the endpoint must
 * accept unauthenticated loopback requests.
 */
const INFRA_ERROR_CODES = new Set(["endpoint_http_error", "endpoint_timeout", "endpoint_network_error", "endpoint_response_limit"]);
const RETRY_DELAY_MS = 5000;

export function realEvalTasks(cases = REPAIR_EVAL_CASES) {
  const tasks = new Map();
  for (const entry of cases) {
    if (!entry.real?.taskId || tasks.has(entry.real.taskId)) continue;
    tasks.set(entry.real.taskId, { id: entry.real.taskId, sourceCase: entry.id, deck: entry.deck, repairTarget: entry.repairTarget });
  }
  return [...tasks.values()];
}

export function skippedForRealEval(cases = REPAIR_EVAL_CASES) {
  return cases.filter((entry) => entry.realSkip).map((entry) => ({ case: entry.id, reason: entry.realSkip }));
}

export async function runRealRepairEval({ endpoint, model, k = 3, maxRequests = 150, tasks = realEvalTasks(), log = () => {} }) {
  assertLoopback(endpoint);
  const counter = { requests: 0, cap: maxRequests };
  const runs = [];
  const startedAt = Date.now();
  for (const task of tasks) {
    for (let attempt = 1; attempt <= k; attempt += 1) {
      if (counter.requests >= counter.cap) {
        runs.push({ task: task.id, run: attempt, status: "not_run", reason: `request cap ${counter.cap} reached` });
        continue;
      }
      let result = await runOnce({ task, endpoint, model, counter });
      if (result.error && INFRA_ERROR_CODES.has(result.error.code) && counter.requests < counter.cap) {
        log(`  ${task.id} #${attempt}: ${result.error.code}, retrying once after ${RETRY_DELAY_MS} ms`);
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        const retry = await runOnce({ task, endpoint, model, counter });
        result = { ...retry, retriedAfter: result.error };
      }
      runs.push({ task: task.id, run: attempt, ...result });
      log(`  ${task.id} #${attempt}: ${result.status}${result.stopReason ? ` (${result.stopReason})` : ""}, rounds ${result.rounds ?? "-"}, ${result.durationMs} ms`);
    }
  }
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    endpoint,
    model,
    k,
    scoring: DEFAULT_REPAIR_SCORING,
    requestCap: maxRequests,
    requestsSent: counter.requests,
    durationMs: Date.now() - startedAt,
    skippedCases: skippedForRealEval(),
    summary: summarizeRuns(tasks, runs, k),
    runs
  };
}

async function runOnce({ task, endpoint, model, counter }) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    if (counter.requests >= counter.cap) {
      const error = new Error(`eval request cap ${counter.cap} reached`);
      error.code = "eval_request_cap";
      throw error;
    }
    counter.requests += 1;
    const started = Date.now();
    const response = await fetch(url, init);
    const text = await response.text();
    calls.push(describeCall({ status: response.status, text, durationMs: Date.now() - started, requestBytes: Buffer.byteLength(String(init?.body ?? "")) }));
    return { ok: response.ok, status: response.status, headers: { get: (name) => response.headers.get(name) }, text: async () => text };
  };
  const bundle = task.deck();
  const baseline = runDiagnostics({ cards: bundle.cards, metadata: bundle.metadata, ...DEFAULT_REPAIR_SCORING });
  const targetIssue = collectIssueEntities(baseline).find((issue) => issue.code === task.repairTarget.code);
  const warning = (baseline.warnings ?? []).find((entry) => entry.code === task.repairTarget.code);
  // Same wording the Creator UI uses for a Review "AI Repair" action.
  const targets = [...(task.repairTarget.cardIds ?? []), ...(task.repairTarget.entities ?? [])];
  const instruction = `Use the latest Review diagnostics to repair '${task.repairTarget.code}'. Focus on: ${warning?.message ?? targetIssue?.code ?? task.repairTarget.code}. Targets: ${targets.length ? targets.join(", ") : "project-level issue"}. Keep changes as explicit patch proposals.`;
  const started = Date.now();
  try {
    const plan = await buildVerifiedRepairPlan({
      editor: createCardEditor(bundle),
      config: { provider: "openai_chat", endpoint, modelId: model, apiKeyRef: null, capabilities: ["structuredJson"] },
      credentials: {},
      instruction,
      repairTarget: task.repairTarget,
      fetchImpl
    });
    const verification = plan.verification;
    return {
      status: verification.status,
      stopReason: verification.stopReason,
      rounds: verification.rounds.length,
      baselineScore: verification.baseline.healthScore,
      roundSummaries: verification.rounds.map((round) => ({
        round: round.round,
        status: round.status,
        proposalCount: round.proposalCount,
        passedCount: round.passedCount,
        bestScore: round.bestScore,
        blockedBy: round.blockedBy,
        error: round.error ?? null,
        proposals: (round.proposals ?? []).map((proposal) => ({
          id: proposal.id,
          title: proposal.title,
          passed: proposal.passed,
          scoreAfter: proposal.scoreAfter,
          failedDetails: proposal.failedDetails
        }))
      })),
      passedProposal: summarizePassed(plan),
      usage: aggregateUsage(calls),
      calls,
      durationMs: Date.now() - started
    };
  } catch (error) {
    return { status: "error", error: { code: error?.code ?? "error", message: String(error?.message ?? error).slice(0, 400) }, usage: aggregateUsage(calls), calls, durationMs: Date.now() - started };
  }
}

function describeCall({ status, text, durationMs, requestBytes }) {
  let content = null;
  let usage = null;
  try {
    const json = JSON.parse(text);
    usage = json.usage ?? null;
    content = json.choices?.[0]?.message?.content ?? json.output_text ?? null;
  } catch {
    content = null;
  }
  const proposals = parseProposals(content);
  return {
    status,
    durationMs,
    requestBytes,
    responseBytes: Buffer.byteLength(text),
    usage,
    proposals: proposals?.map((proposal) => ({
      id: proposal.id,
      title: proposal.title,
      summary: typeof proposal.summary === "string" ? proposal.summary.slice(0, 400) : null,
      patches: summarizePatches(proposal.patches)
    })) ?? null,
    contentExcerpt: typeof content === "string" ? content.slice(0, 4000) : text.slice(0, 1000)
  };
}

function parseProposals(content) {
  if (typeof content !== "string") return null;
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed?.proposals) ? parsed.proposals : null;
  } catch {
    return null;
  }
}

function summarizePatches(patches) {
  if (!Array.isArray(patches)) return [];
  return patches.map((patch) => {
    if (patch?.op === "addCard") return { op: "addCard", cardId: patch.card?.id, requirements: patch.card?.requirements ?? {}, choices: (patch.card?.choices ?? []).map((choice) => ({ id: choice.id, label: choice.label, effects: choice.effects })) };
    if (patch?.op === "updateCard") return { op: "updateCard", cardId: patch.cardId, changes: patch.changes };
    if (patch?.op === "setChoiceEffects") return { op: "setChoiceEffects", cardId: patch.cardId, choiceId: patch.choiceId, effects: patch.effects };
    return { op: patch?.op, cardId: patch?.cardId ?? null };
  });
}

function summarizePassed(plan) {
  const passed = (plan.proposals ?? []).find((proposal) => proposal.verification?.passed);
  if (!passed) return null;
  return {
    id: passed.id,
    title: passed.title,
    summary: passed.summary,
    round: passed.verification.round,
    score: passed.verification.score,
    advisories: passed.verification.advisories,
    patches: summarizePatches(passed.patches)
  };
}

function aggregateUsage(calls) {
  const totals = { calls: calls.length, requestBytes: 0, responseBytes: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, callsWithUsage: 0 };
  for (const call of calls) {
    totals.requestBytes += call.requestBytes;
    totals.responseBytes += call.responseBytes;
    if (call.usage) {
      totals.callsWithUsage += 1;
      totals.promptTokens += call.usage.prompt_tokens ?? call.usage.input_tokens ?? 0;
      totals.completionTokens += call.usage.completion_tokens ?? call.usage.output_tokens ?? 0;
      totals.totalTokens += call.usage.total_tokens ?? ((call.usage.prompt_tokens ?? 0) + (call.usage.completion_tokens ?? 0));
    }
  }
  return totals;
}

function summarizeRuns(tasks, runs, k) {
  const perTask = tasks.map((task) => {
    const taskRuns = runs.filter((run) => run.task === task.id && run.status !== "not_run");
    const verified = taskRuns.filter((run) => run.status === "verified").length;
    return {
      task: task.id,
      runs: taskRuns.length,
      verified,
      passAt1: taskRuns.length ? round(verified / taskRuns.length) : null,
      anySuccess: verified > 0,
      statuses: taskRuns.map((run) => run.status),
      rounds: taskRuns.map((run) => run.rounds ?? null)
    };
  });
  const completed = runs.filter((run) => run.status !== "not_run");
  const withRounds = completed.filter((run) => Number.isFinite(run.rounds));
  const blockedByCheck = {};
  let blockedProposals = 0;
  let evaluatedProposals = 0;
  let rejectedRounds = 0;
  let endpointErrorRounds = 0;
  for (const run of completed) {
    for (const roundSummary of run.roundSummaries ?? []) {
      if (roundSummary.status === "rejected_response") rejectedRounds += 1;
      if (roundSummary.status === "endpoint_error") endpointErrorRounds += 1;
      for (const proposal of roundSummary.proposals ?? []) {
        evaluatedProposals += 1;
        if (!proposal.passed) blockedProposals += 1;
        for (const detail of proposal.failedDetails ?? []) blockedByCheck[detail.id] = (blockedByCheck[detail.id] ?? 0) + 1;
      }
    }
  }
  const sum = (values) => values.reduce((total, value) => total + value, 0);
  return {
    tasks: tasks.length,
    k,
    runsCompleted: completed.length,
    runsErrored: completed.filter((run) => run.status === "error").length,
    runsRetried: completed.filter((run) => run.retriedAfter).length,
    verifiedRuns: completed.filter((run) => run.status === "verified").length,
    passAt1Mean: round(sum(perTask.map((task) => task.passAt1 ?? 0)) / (perTask.length || 1)),
    tasksWithAnySuccess: perTask.filter((task) => task.anySuccess).length,
    anySuccessRate: round(perTask.filter((task) => task.anySuccess).length / (perTask.length || 1)),
    averageRounds: withRounds.length ? round(sum(withRounds.map((run) => run.rounds)) / withRounds.length) : null,
    evaluatedProposals,
    blockedProposals,
    blockedByCheck: Object.fromEntries(Object.entries(blockedByCheck).sort()),
    rejectedRounds,
    endpointErrorRounds,
    averageRunMs: completed.length ? Math.round(sum(completed.map((run) => run.durationMs ?? 0)) / completed.length) : null,
    requestBytes: sum(completed.map((run) => run.usage?.requestBytes ?? 0)),
    responseBytes: sum(completed.map((run) => run.usage?.responseBytes ?? 0)),
    tokens: {
      prompt: sum(completed.map((run) => run.usage?.promptTokens ?? 0)),
      completion: sum(completed.map((run) => run.usage?.completionTokens ?? 0)),
      total: sum(completed.map((run) => run.usage?.totalTokens ?? 0)),
      callsWithUsage: sum(completed.map((run) => run.usage?.callsWithUsage ?? 0))
    },
    perTask
  };
}

function assertLoopback(endpoint) {
  const host = new URL(endpoint).hostname;
  if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(host)) {
    throw new Error(`Real eval only targets loopback endpoints without keys; got '${host}'`);
  }
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
