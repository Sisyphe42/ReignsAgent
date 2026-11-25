import {
  applyAiEditPatches,
  createAiEditSuggestions,
  createContentBundle,
  selectAiContextCards
} from "../../pipeline/src/index.js";
import { readBoundedResponseText } from "../../pipeline/src/response.js";
import { InterfaceError, buildAiEditPlanAsync, runDiagnostics, validatePlayerCards } from "./index.js";

/**
 * Verified repair loop (evaluator-optimizer workflow) for `repair_diagnostics`.
 *
 * The model proposes patches; every proposal is applied to a copy of the
 * content, gated on player validation, scored with a fixed-seed Reviewer run,
 * and checked against anti-shortcut rules. Failed checks are fed back to the
 * model for at most three rounds. The loop never mutates the editor: the
 * returned plan still goes through applyAiEditPlan (baseFingerprint check and
 * explicit author selection).
 */

export const REPAIR_LOOP_SCHEMA_VERSION = 1;
export const REPAIR_LOOP_HARD_MAX_ROUNDS = 3;

export const DEFAULT_REPAIR_SCORING = Object.freeze({ cycles: 500, maxTurns: 40, seed: 1 });

export const DEFAULT_REPAIR_LOOP_LIMITS = Object.freeze({
  maxRounds: 3,
  maxProposalsPerRound: 6,
  maxPatchesPerProposal: 8,
  maxEditedCards: 4,
  maxRequestBytes: 256 * 1024,
  maxResponseBytes: 512 * 1024,
  maxTotalBytes: 2 * 1024 * 1024,
  // Two full 120 s text-request timeouts plus scoring fit inside the deadline, and the
  // author never waits more than five minutes for one repair draft.
  deadlineMs: 300 * 1000,
  feedbackBytes: 6 * 1024,
  logBytes: 16 * 1024
});

const REJECTED_RESPONSE_CODES = new Set(["endpoint_invalid_response", "endpoint_parse_error", "pipeline_error"]);
const REPAIR_PATCH_OPS = new Set(["addCard", "updateCard", "setChoiceLabel", "setChoiceEffects"]);
const MIN_EFFECT_MAGNITUDE_RATIO = 0.5;

export const REPAIR_CHECKS = Object.freeze([
  { id: "patches_apply", severity: "blocking", label: "Patches apply cleanly", rule: "Every patch applies to a copy and the content bundle stays valid." },
  { id: "allowed_ops", severity: "blocking", label: "Allowed patch operations", rule: "Only addCard, updateCard, setChoiceLabel, setChoiceEffects; at most {maxPatchesPerProposal} patches; at least one." },
  { id: "player_valid", severity: "blocking", label: "Player validation", rule: "Hard gate: every card keeps exactly one left and one right choice (validatePlayerCards)." },
  { id: "card_ids_preserved", severity: "blocking", label: "No card removed, renamed, or disabled", rule: "Every original card id still exists and keeps weight > 0." },
  { id: "target_resolved", severity: "blocking", label: "Target issue resolved", rule: "Every targeted review issue (code + card/tag/variable/gauge) is gone after the patch." },
  { id: "no_new_errors", severity: "blocking", label: "No new review errors", rule: "No error-level review issue appears that was not there before." },
  { id: "scope", severity: "blocking", label: "Edits stay in scope", rule: "Edited existing cards are related to the target (target cards, graph neighbours, cards sharing its tags/variables/gauge) and at most {maxEditedCards}." },
  { id: "gates_preserved", severity: "blocking", label: "Author gates preserved", rule: "No requirement is removed or loosened unless it can never be satisfied (named by the baseline review)." },
  { id: "effects_preserved", severity: "blocking", label: "Choice effects preserved", rule: "Edited existing choices keep every tag/variable they set and at least 50% of their total gauge movement." },
  { id: "reachability_kept", severity: "blocking", label: "Reachable cards not reduced", rule: "No card that was reachable before becomes unreachable." },
  { id: "score_not_lower", severity: "blocking", label: "Health score not lower", rule: "Fixed-seed health score after the patch is at least the score before." },
  { id: "gate_relaxed", severity: "advisory", label: "Dead gate removed", rule: "Reported when a never-satisfiable requirement was removed instead of adding a producer." },
  { id: "new_warnings", severity: "advisory", label: "No new review warnings", rule: "Reported when a new warning-level issue appears." },
  { id: "stalled_rate", severity: "advisory", label: "Stalled runs not higher", rule: "Reported when the share of stalled simulated runs rises." }
]);

const CHECK_BY_ID = new Map(REPAIR_CHECKS.map((check) => [check.id, check]));

/**
 * buildVerifiedRepairPlan runs the bounded loop and returns an AI edit plan
 * with `verification` evidence. It only reads the editor.
 */
export async function buildVerifiedRepairPlan({
  editor,
  getEditor = null,
  config = {},
  credentials = {},
  instruction = "",
  targetCardId = null,
  repairTarget = null,
  diagnostics = null,
  scoring = {},
  limits = {},
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  onProgress = null,
  yieldToHost = defaultYield
} = {}) {
  const startedAt = now();
  const budget = normalizeLimits(limits);
  const scoringConfig = normalizeScoring(scoring);
  const progress = createLoopProgress(onProgress, budget.maxRounds);
  progress.emit({ stage: "baseline" });
  await yieldToHost();
  const baseBundle = toBundle(editor);
  const baseFingerprint = fingerprintBundle(baseBundle);
  const baseline = runDiagnostics({ cards: baseBundle.cards, metadata: baseBundle.metadata, ...scoringConfig });
  const baselineIssues = collectIssueEntities(baseline);
  const targetSelection = resolveRepairTargets({ baselineIssues, repairTarget });
  const apiKey = typeof credentials?.apiKey === "string" ? credentials.apiKey.trim() : "";

  if (targetSelection.status === "not_verifiable") {
    const plan = await buildAiEditPlanAsync({
      editor: baseBundle,
      config,
      credentials,
      mode: "repair_diagnostics",
      instruction,
      targetCardId,
      // Nothing to score: give the model the Review the author actually looked at.
      diagnostics: diagnostics ?? baseline,
      fetchImpl,
      onProgress: (event) => progress.emit({ ...event, round: 1, maxRounds: 1 })
    });
    progress.emit({ stage: "done", round: 1, maxRounds: 1 });
    return {
      ...plan,
      verification: {
        schemaVersion: REPAIR_LOOP_SCHEMA_VERSION,
        status: "not_verifiable",
        stopReason: targetSelection.stopReason,
        message: targetSelection.message,
        unmatchedTargets: targetSelection.unmatchedTargets ?? [],
        scoring: scoringConfig,
        limits: budget,
        baseline: summarizeScore(baseline),
        targets: [],
        rounds: [],
        checks: REPAIR_CHECKS.map(describeCheck(budget))
      }
    };
  }

  const targets = targetSelection.targets;
  const context = buildEvaluationContext({ baseBundle, baseline, baselineIssues, targets, budget, scoring: scoringConfig });
  const rounds = [];
  const evaluatedRounds = [];
  const attempts = [];
  let totalBytes = 0;
  let stopReason = "max_rounds";
  let endpointUsed = false;
  let finalRound = null;
  let lastPlan = null;

  for (let round = 1; round <= budget.maxRounds; round += 1) {
    const elapsed = now() - startedAt;
    if (elapsed >= budget.deadlineMs) {
      stopReason = "deadline";
      break;
    }
    if (totalBytes >= budget.maxTotalBytes) {
      stopReason = "total_byte_budget";
      break;
    }

    const meter = createMeter({ fetchImpl, budget, remainingMs: budget.deadlineMs - elapsed, remainingTotalBytes: budget.maxTotalBytes - totalBytes, apiKey });
    const repairLoop = buildRepairLoopConstraints({ round, budget, targets, attempts });
    const roundConfig = {
      ...(isRecord(config) ? config : {}),
      constraints: { ...(isRecord(config?.constraints) ? config.constraints : {}), repairLoop }
    };
    const roundStartedAt = now();
    let plan;
    try {
      plan = await buildAiEditPlanAsync({
        editor: baseBundle,
        config: roundConfig,
        credentials,
        mode: "repair_diagnostics",
        instruction,
        targetCardId,
        diagnostics: baseline,
        fetchImpl: meter.fetch,
        onProgress: (event) => progress.emit({ ...event, round })
      });
    } catch (error) {
      const failure = { code: meter.budgetError?.code ?? error?.code ?? "endpoint_error", message: scrub(meter.budgetError?.message ?? error?.message ?? String(error), apiKey) };
      totalBytes += meter.totalBytes;
      if (!meter.budgetError && REJECTED_RESPONSE_CODES.has(error?.code)) {
        // The endpoint answered but the proposals failed parsing or prevalidation (for example a
        // patch targeting a missing card). That is a model mistake, so feed it back like a failed check.
        rounds.push({
          round,
          status: "rejected_response",
          error: failure,
          proposalCount: 0,
          evaluatedCount: 0,
          passedCount: 0,
          bestScore: null,
          blockedBy: { patches_apply: 1 },
          usage: meter.usage(),
          timing: { durationMs: now() - roundStartedAt },
          exchange: meter.exchange(),
          proposals: []
        });
        attempts.push({ round, proposalId: null, title: "Response rejected", failedChecks: [{ id: "patches_apply", detail: failure.message.slice(0, 240) }] });
        continue;
      }
      rounds.push({
        round,
        status: "endpoint_error",
        error: failure,
        proposalCount: 0,
        evaluatedCount: 0,
        passedCount: 0,
        bestScore: null,
        blockedBy: {},
        usage: meter.usage(),
        timing: { durationMs: now() - roundStartedAt },
        exchange: meter.exchange()
      });
      // Round 1 has nothing to fall back to: surface the error unchanged.
      if (round === 1) {
        if (meter.budgetError) throw new InterfaceError(meter.budgetError.message, meter.budgetError.code);
        throw error;
      }
      stopReason = meter.budgetError ? meter.budgetError.code : "endpoint_error";
      break;
    }

    totalBytes += meter.totalBytes;
    endpointUsed = endpointUsed || Boolean(plan.provider);
    if (plan.baseFingerprint !== baseFingerprint) {
      throw new InterfaceError("Repair loop content fingerprint changed between rounds", "ai_repair_fingerprint_mismatch");
    }
    lastPlan = plan;

    const proposals = Array.isArray(plan.proposals) ? plan.proposals : [];
    const evaluated = [];
    const scoredCount = Math.min(proposals.length, budget.maxProposalsPerRound);
    for (const [index, proposal] of proposals.entries()) {
      if (index >= budget.maxProposalsPerRound) {
        evaluated.push(withVerification(proposal, round, skippedVerdict(budget)));
        continue;
      }
      const position = { round, proposalIndex: index + 1, proposalCount: scoredCount };
      const verdict = await evaluateRepairProposalStaged({
        context,
        proposal,
        onStage: async (stage) => {
          progress.emit({ ...position, stage });
          await yieldToHost();
        }
      });
      evaluated.push(withVerification(proposal, round, verdict));
    }
    const passed = evaluated.filter((proposal) => proposal.verification.passed);
    const roundRecord = {
      round,
      status: "evaluated",
      proposalCount: proposals.length,
      evaluatedCount: Math.min(proposals.length, budget.maxProposalsPerRound),
      passedCount: passed.length,
      bestScore: bestScoreOf(evaluated),
      blockedBy: countBlockedChecks(evaluated),
      usage: meter.usage(),
      timing: { durationMs: now() - roundStartedAt },
      exchange: meter.exchange(),
      proposals: evaluated.map((proposal) => ({
        id: proposal.id,
        title: proposal.title,
        summary: String(proposal.summary ?? "").slice(0, 240),
        patchCount: Array.isArray(proposal.patches) ? proposal.patches.length : 0,
        cardIds: patchedCardIds(proposal.patches),
        passed: proposal.verification.passed,
        failedChecks: proposal.verification.failedChecks,
        failedDetails: proposal.verification.checks
          .filter((check) => check.severity === "blocking" && !check.passed)
          .map((check) => ({ id: check.id, detail: String(check.detail ?? "").slice(0, 200) })),
        scoreAfter: proposal.verification.score.after
      }))
    };
    rounds.push(roundRecord);
    finalRound = { round, proposals: evaluated, plan };
    evaluatedRounds.push(finalRound);

    if (passed.length > 0) {
      stopReason = "verified";
      break;
    }
    if (proposals.length === 0) {
      attempts.push({ round, proposalId: null, title: "No proposals returned", failedChecks: [{ id: "patches_apply", detail: "The response contained no proposals." }] });
    } else {
      for (const proposal of evaluated) attempts.push(compactAttempt(round, proposal));
    }
    if (!plan.provider) {
      // Local rule-based repair is deterministic; asking again returns the same proposals.
      stopReason = "offline_single_round";
      break;
    }
  }

  if (!lastPlan) {
    const lastError = [...rounds].reverse().find((record) => record.error)?.error;
    throw new InterfaceError(
      `Repair loop produced no usable proposals (${stopReason})${lastError ? `: ${lastError.message}` : ""}`,
      lastError?.code === "endpoint_invalid_response" || lastError?.code === "endpoint_parse_error" || lastError?.code === "pipeline_error"
        ? "ai_repair_no_valid_response"
        : "ai_repair_no_rounds"
    );
  }

  progress.emit({ stage: "done", round: rounds.length, stopReason });
  const chosen = stopReason === "verified" ? finalRound : pickBestRound(evaluatedRounds);
  const status = stopReason === "verified" ? "verified" : "unverified";
  const proposals = chosen?.proposals ?? [];
  // Re-check the live editor at the end: a concurrent edit would make the plan stale anyway,
  // but failing here is clearer than a later apply rejection.
  const liveEditor = typeof getEditor === "function" ? getEditor() : editor;
  if (fingerprintBundle(toBundle(liveEditor)) !== baseFingerprint) {
    throw new InterfaceError("Content changed while the repair loop was running; rebuild the repair draft", "ai_repair_stale");
  }

  return {
    ...lastPlan,
    baseFingerprint,
    config: stripRepairConstraints(lastPlan.config),
    proposals,
    verification: {
      schemaVersion: REPAIR_LOOP_SCHEMA_VERSION,
      status,
      stopReason,
      endpoint: endpointUsed ? "configured" : "local_rules",
      selectedRound: chosen?.round ?? null,
      roundsUsed: rounds.length,
      scoring: scoringConfig,
      limits: budget,
      baseline: summarizeScore(baseline),
      targets: targets.map(({ code, severity, entity }) => ({ code, severity, entity })),
      unmatchedTargets: targetSelection.unmatchedTargets ?? [],
      relatedCardIds: [...context.relatedCards].sort(),
      rounds,
      usage: { totalBytes, estimatedTokens: Math.ceil(totalBytes / 4) },
      timing: { durationMs: now() - startedAt },
      checks: REPAIR_CHECKS.map(describeCheck(budget))
    }
  };
}

/**
 * evaluateRepairProposal applies one proposal to a copy and runs every check.
 * Deterministic for a fixed context (fixed Reviewer seed).
 */
export function evaluateRepairProposal({ context, proposal }) {
  const steps = repairEvaluationSteps({ context, proposal });
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

/**
 * evaluateRepairProposalStaged is the same evaluation, reporting each real stage
 * ("trial" = apply to a copy and structural checks, "scoring" = fixed-seed Reviewer run,
 * "checks" = review-based checks) to `onStage` before it starts.
 */
export async function evaluateRepairProposalStaged({ context, proposal, onStage = null }) {
  const steps = repairEvaluationSteps({ context, proposal });
  let next = steps.next();
  while (!next.done) {
    if (typeof onStage === "function") await onStage(next.value);
    next = steps.next();
  }
  return next.value;
}

function* repairEvaluationSteps({ context, proposal }) {
  yield "trial";
  const checks = [];
  const add = (id, passed, detail) => checks.push({ id, severity: CHECK_BY_ID.get(id).severity, passed, detail });
  const patches = Array.isArray(proposal?.patches) ? proposal.patches : [];
  const before = summarizeScore(context.baseline);

  const ops = patches.map((patch) => patch?.op);
  const badOps = ops.filter((op) => !REPAIR_PATCH_OPS.has(op));
  const opsOk = patches.length > 0 && patches.length <= context.budget.maxPatchesPerProposal && badOps.length === 0;
  add("allowed_ops", opsOk, patches.length === 0
    ? "Proposal has no patches."
    : badOps.length > 0
      ? `Not allowed in repair: ${[...new Set(badOps)].join(", ")}.`
      : patches.length > context.budget.maxPatchesPerProposal
        ? `${patches.length} patches exceeds the limit of ${context.budget.maxPatchesPerProposal}.`
        : `${patches.length} patch${patches.length === 1 ? "" : "es"}: ${[...new Set(ops)].join(", ")}.`);

  let applied;
  try {
    applied = applyAiEditPatches({ bundle: context.baseBundle, patches });
  } catch (error) {
    add("patches_apply", false, error?.message ?? String(error));
  }
  if (applied && !applied.validation.valid) {
    add("patches_apply", false, applied.validation.errors.slice(0, 3).join("; "));
    applied = null;
  } else if (applied) {
    add("patches_apply", true, "Applied to a copy; content validation passed.");
  }

  if (!applied) {
    return finalizeVerdict({ checks, before, after: null, metrics: null });
  }

  const afterCards = applied.bundle.cards;
  const player = validatePlayerCards(afterCards);
  add("player_valid", player.valid, player.valid ? "Every card has left and right choices." : player.errors.slice(0, 3).join("; "));

  const afterById = new Map(afterCards.map((card) => [card.id, card]));
  const missing = [...context.baseById.keys()].filter((cardId) => !afterById.has(cardId));
  const disabled = [...context.baseById.keys()].filter((cardId) => afterById.has(cardId) && !(Number(afterById.get(cardId).weight ?? 1) > 0));
  add("card_ids_preserved", missing.length === 0 && disabled.length === 0, missing.length > 0
    ? `Removed or renamed: ${missing.slice(0, 5).join(", ")}.`
    : disabled.length > 0
      ? `Disabled with weight 0: ${disabled.slice(0, 5).join(", ")}.`
      : `All ${context.baseById.size} original cards kept.`);

  const edited = collectEditedCards(context.baseById, afterById);
  // An unrelated card may still be edited when the edit only adds a producer for a
  // missing tag/variable named by the target (see producerOnlyEdit). It still counts
  // toward maxEditedCards.
  const scopeExempt = [];
  const outOfScope = [];
  for (const cardId of edited.filter((candidate) => !context.relatedCards.has(candidate))) {
    const signals = producerOnlyEdit(context.baseById.get(cardId), afterById.get(cardId), context.missingProducerSignals);
    if (signals) scopeExempt.push({ cardId, reason: "adds_missing_producer", signals });
    else outOfScope.push(cardId);
  }
  const scopeOk = outOfScope.length === 0 && edited.length <= context.budget.maxEditedCards;
  const exemptNote = scopeExempt.length > 0
    ? ` scope_exempt: adds_missing_producer (${scopeExempt.map((entry) => `${entry.cardId}: ${entry.signals.join(", ")}`).join("; ")}).`
    : "";
  add("scope", scopeOk, (outOfScope.length > 0
    ? `Edited unrelated card${outOfScope.length === 1 ? "" : "s"}: ${outOfScope.slice(0, 5).join(", ")}.`
    : edited.length > context.budget.maxEditedCards
      ? `${edited.length} existing cards edited; limit is ${context.budget.maxEditedCards}.`
      : `${edited.length} existing card${edited.length === 1 ? "" : "s"} edited${edited.length ? ` (${edited.join(", ")})` : ""}; ${afterCards.length - context.baseById.size} added.`) + exemptNote);
  if (scopeExempt.length > 0) checks[checks.length - 1].exemptions = scopeExempt;

  const gateResult = compareGates(context, afterById, edited);
  add("gates_preserved", gateResult.removed.length === 0, gateResult.removed.length > 0
    ? `Removed author requirement${gateResult.removed.length === 1 ? "" : "s"}: ${gateResult.removed.slice(0, 4).join(", ")}.`
    : "No satisfiable requirement was removed.");

  const effectResult = compareEffects(context.baseById, afterById, edited);
  add("effects_preserved", effectResult.problems.length === 0, effectResult.problems.length > 0
    ? effectResult.problems.slice(0, 3).join("; ")
    : "Edited choices keep their tags, variables, and gauge weight.");

  yield "scoring";
  let afterDiagnostics;
  try {
    afterDiagnostics = runDiagnostics({ cards: afterCards, metadata: applied.bundle.metadata, ...context.scoring });
  } catch (error) {
    add("target_resolved", false, `Review could not run: ${error?.message ?? error}`);
    return finalizeVerdict({ checks, before, after: null, metrics: null });
  }
  yield "checks";

  const afterIssues = collectIssueEntities(afterDiagnostics);
  const afterKeys = new Set(afterIssues.map((issue) => issue.key));
  const unresolved = context.targets.filter((target) => afterKeys.has(target.key));
  add("target_resolved", unresolved.length === 0, unresolved.length > 0
    ? `Still present: ${unresolved.slice(0, 4).map(formatIssue).join(", ")}.`
    : `Resolved: ${context.targets.slice(0, 4).map(formatIssue).join(", ")}.`);

  const newErrors = afterIssues.filter((issue) => issue.severity === "error" && !context.baselineKeys.has(issue.key));
  add("no_new_errors", newErrors.length === 0, newErrors.length > 0
    ? `New: ${newErrors.slice(0, 4).map(formatIssue).join(", ")}.`
    : "No new error-level issues.");

  const reachableAfter = new Set(afterDiagnostics.graph?.reachableCards ?? []);
  const lostReach = (context.baseline.graph?.reachableCards ?? []).filter((cardId) => !reachableAfter.has(cardId));
  add("reachability_kept", lostReach.length === 0, lostReach.length > 0
    ? `No longer reachable: ${lostReach.slice(0, 5).join(", ")}.`
    : `${reachableAfter.size} reachable (was ${(context.baseline.graph?.reachableCards ?? []).length}).`);

  const after = summarizeScore(afterDiagnostics);
  const scoreCheck = compareHealthScores(before, after);
  add("score_not_lower", scoreCheck.passed, scoreCheck.detail);

  add("gate_relaxed", gateResult.relaxedDead.length === 0, gateResult.relaxedDead.length > 0
    ? `Removed never-satisfiable requirement${gateResult.relaxedDead.length === 1 ? "" : "s"}: ${gateResult.relaxedDead.slice(0, 4).join(", ")}. Consider adding a producer instead.`
    : "No requirement removed.");
  const newWarnings = afterIssues.filter((issue) => issue.severity !== "error" && !context.baselineKeys.has(issue.key));
  add("new_warnings", newWarnings.length === 0, newWarnings.length > 0
    ? `New: ${newWarnings.slice(0, 4).map(formatIssue).join(", ")}.`
    : "No new warnings.");
  add("stalled_rate", after.stalledRate <= before.stalledRate, `${formatRate(before.stalledRate)} → ${formatRate(after.stalledRate)}.`);

  return finalizeVerdict({
    checks,
    before,
    after,
    metrics: {
      editedCardIds: edited,
      addedCardIds: afterCards.filter((card) => !context.baseById.has(card.id)).map((card) => card.id)
    }
  });
}

/**
 * compareHealthScores implements score_not_lower. The displayed score is clamped at 0, so
 * once the baseline is saturated the unclamped score is compared too: worse game-over or
 * stalled rates and more issues still count as a regression.
 */
export function compareHealthScores(before, after) {
  const saturated = Number.isFinite(before?.rawHealthScore) && before.rawHealthScore < 0;
  const rawOk = !saturated || (Number.isFinite(after?.rawHealthScore) && after.rawHealthScore >= before.rawHealthScore);
  return {
    passed: after.healthScore >= before.healthScore && rawOk,
    detail: saturated
      ? `${before.healthScore} → ${after.healthScore} (score floor reached; unclamped ${before.rawHealthScore} → ${after.rawHealthScore}).`
      : `${before.healthScore} → ${after.healthScore}.`
  };
}

/**
 * collectIssueEntities flattens review warnings into comparable entities:
 * one entry per (code, card | tag | variable | gauge), or "*" for deck-wide issues.
 */
export function collectIssueEntities(diagnostics) {
  const entities = [];
  const seen = new Set();
  for (const warning of Array.isArray(diagnostics?.warnings) ? diagnostics.warnings : []) {
    const details = isRecord(warning.details) ? warning.details : warning;
    const names = [
      ...strings(details.cardIds).map((id) => `card:${id}`),
      ...(Array.isArray(details.cards) ? details.cards.map((entry) => entry?.cardId).filter(isText).map((id) => `card:${id}`) : []),
      ...strings(details.tags).map((tag) => `tag:${tag}`),
      ...strings(details.variables).map((variable) => `var:${variable}`),
      ...strings(details.factions).map((faction) => `gauge:${faction}`),
      ...(isText(details.faction) ? [`gauge:${details.faction}`] : [])
    ];
    for (const entity of names.length > 0 ? names : ["*"]) {
      const key = `${warning.code}|${entity}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entities.push({ code: warning.code, severity: warning.severity ?? "warning", entity, key });
    }
  }
  return entities;
}

function resolveRepairTargets({ baselineIssues, repairTarget }) {
  if (isRecord(repairTarget) && isText(repairTarget.code)) {
    const ofCode = baselineIssues.filter((issue) => issue.code === repairTarget.code);
    if (ofCode.length === 0) {
      return {
        status: "not_verifiable",
        stopReason: "target_not_scored",
        message: `'${repairTarget.code}' is not a current Reviewer warning, so the loop cannot score it. Proposals are shown without verification.`
      };
    }
    const wanted = new Set([
      ...strings(repairTarget.cardIds).map((id) => `card:${id}`),
      ...strings(repairTarget.entities)
    ]);
    if (wanted.size === 0) return { status: "ok", targets: ofCode, unmatchedTargets: [] };
    const matched = ofCode.filter((issue) => wanted.has(issue.entity));
    const unmatched = [...wanted].filter((entity) => !ofCode.some((issue) => issue.entity === entity));
    // Never broaden or narrow a specific target: if any selected entity is missing from the
    // fixed-seed baseline, a proposal could look verified while ignoring part of what the
    // author selected, so the whole repair stays unverified.
    if (unmatched.length > 0) {
      return {
        status: "not_verifiable",
        stopReason: "target_entity_not_scored",
        unmatchedTargets: unmatched,
        message: `Selected ${repairTarget.code} target${unmatched.length === 1 ? "" : "s"} ${unmatched.join(", ")} ${unmatched.length === 1 ? "is" : "are"} not present in the fixed-seed scoring review, so the loop cannot score the selection. Proposals are shown without verification.`
      };
    }
    return { status: "ok", targets: matched, unmatchedTargets: [] };
  }
  const errors = baselineIssues.filter((issue) => issue.severity === "error");
  const targets = errors.length > 0 ? errors : baselineIssues;
  if (targets.length === 0) {
    return {
      status: "not_verifiable",
      stopReason: "no_scored_issues",
      message: "The fixed-seed scoring review finds no issue to verify against, so proposals are shown without verification. Run Review with the scoring settings to compare."
    };
  }
  return { status: "ok", targets };
}

function buildEvaluationContext({ baseBundle, baseline, baselineIssues, targets, budget, scoring }) {
  const baseById = new Map(baseBundle.cards.map((card) => [card.id, card]));
  const targetCardIds = new Set();
  const focus = { tags: [], variables: [], factions: [] };
  let deckWide = false;
  for (const target of targets) {
    const [kind, name] = splitEntity(target.entity);
    if (kind === "card") targetCardIds.add(name);
    if (kind === "tag") focus.tags.push(name);
    if (kind === "var") focus.variables.push(name);
    if (kind === "gauge") focus.factions.push(name);
    if (kind === "*") deckWide = true;
  }
  // Cards gated on a targeted tag/variable/gauge are the stuck cards; treat them as targets too.
  for (const card of baseBundle.cards) {
    const requirements = card.requirements ?? {};
    const tags = [...strings(requirements.allTags), ...strings(requirements.anyTags)];
    if (tags.some((tag) => focus.tags.includes(tag))) targetCardIds.add(card.id);
    if (Object.keys(requirements.variables ?? {}).some((key) => focus.variables.includes(key))) targetCardIds.add(card.id);
    if (Object.keys(requirements.factions ?? {}).some((key) => focus.factions.includes(key))) targetCardIds.add(card.id);
  }
  let relatedCards;
  if (deckWide) {
    relatedCards = new Set(baseById.keys());
  } else {
    const selection = selectAiContextCards({
      cards: baseBundle.cards,
      focus: [{ cardIds: [...targetCardIds], ...focus }],
      maxCards: Number.POSITIVE_INFINITY,
      budgetBytes: Number.POSITIVE_INFINITY
    });
    relatedCards = new Set(Object.entries(selection.report.reasons)
      .filter(([, reason]) => !reason.startsWith("other:"))
      .map(([cardId]) => cardId));
    for (const cardId of targetCardIds) relatedCards.add(cardId);
  }

  const graph = baseline.graph ?? {};
  const deadSignals = new Set([
    ...strings(graph.unsatisfiedRequiredTags).map((tag) => `tag:${tag}`),
    ...strings(graph.unsatisfiedRequiredVariables).map((variable) => `var:${variable}`),
    ...strings(graph.unsatisfiedRequiredFactions).map((faction) => `gauge:${faction}`)
  ]);
  const missingProducerSignals = collectMissingProducerSignals({
    cards: baseBundle.cards,
    reachableCardIds: new Set(graph.reachableCards ?? []),
    targetCardIds,
    namedSignals: [...focus.tags.map((tag) => `tag:${tag}`), ...focus.variables.map((variable) => `var:${variable}`)]
  });
  return {
    baseBundle,
    baseById,
    baseline,
    baselineKeys: new Set(baselineIssues.map((issue) => issue.key)),
    targets,
    relatedCards,
    deadSignals,
    missingProducerSignals,
    scoring,
    budget
  };
}

/**
 * collectMissingProducerSignals walks upstream from the target cards through the
 * signal network and returns every tag/variable that is "effectively missing": some
 * card in the upstream closure requires it, and no card reachable in the baseline
 * produces it. Signals with no producer at all are the end of the chain; signals that
 * are only produced by unreachable cards are intermediate links, and the walk
 * continues into those producers' own requirements. One rule covers any depth, and
 * the visited set makes cycles (A needs B, B needs A) terminate.
 *
 * Adding a producer for any signal in this set is what the scope exemption allows:
 * producing an end-of-chain signal unlocks the whole chain, producing an intermediate
 * signal bypasses the broken upstream part.
 */
export function collectMissingProducerSignals({ cards, reachableCardIds, targetCardIds, namedSignals = [] }) {
  const producersBySignal = new Map();
  for (const card of cards) {
    for (const choice of card.choices ?? []) {
      const effects = choice.effects ?? {};
      for (const [tag, value] of Object.entries(isRecord(effects.tags) ? effects.tags : {})) {
        if (value) addToMapSet(producersBySignal, `tag:${tag}`, card.id);
      }
      for (const [key, value] of Object.entries(isRecord(effects.variables) ? effects.variables : {})) {
        if (value !== null && value !== undefined) addToMapSet(producersBySignal, `var:${key}`, card.id);
      }
    }
  }
  const byId = new Map(cards.map((card) => [card.id, card]));
  const missing = new Set();
  const visitedCards = new Set();
  const visitedSignals = new Set();
  const queue = [];
  const visitSignal = (signal) => {
    if (visitedSignals.has(signal)) return;
    visitedSignals.add(signal);
    const producers = [...(producersBySignal.get(signal) ?? [])];
    if (producers.some((cardId) => reachableCardIds.has(cardId))) return;
    missing.add(signal);
    for (const cardId of producers) queue.push(cardId);
  };
  for (const signal of namedSignals) visitSignal(signal);
  for (const cardId of targetCardIds) queue.push(cardId);
  while (queue.length > 0) {
    const cardId = queue.shift();
    if (visitedCards.has(cardId)) continue;
    visitedCards.add(cardId);
    const requirements = byId.get(cardId)?.requirements ?? {};
    for (const tag of strings(requirements.allTags)) visitSignal(`tag:${tag}`);
    // anyTags only blocks a card when none of the alternatives has a reachable producer.
    const anyTags = strings(requirements.anyTags).map((tag) => `tag:${tag}`);
    const anySatisfiable = anyTags.some((signal) => [...(producersBySignal.get(signal) ?? [])].some((producer) => reachableCardIds.has(producer)));
    if (!anySatisfiable) anyTags.forEach(visitSignal);
    for (const key of Object.keys(requirements.variables ?? {})) visitSignal(`var:${key}`);
  }
  return missing;
}

function addToMapSet(map, key, value) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(value);
}

/**
 * producerOnlyEdit returns the added producer signals when the only difference
 * between `before` and `after` is new entries in choice effects that produce a
 * missing tag (set to a truthy value) or a missing variable. Text, weight,
 * requirements, labels, choice ids/order, gauge deltas, hooks, and every existing
 * tag/variable entry must be unchanged. Returns null otherwise.
 */
export function producerOnlyEdit(before, after, missingSignals) {
  if (!before || !after || !(missingSignals instanceof Set) || missingSignals.size === 0) return null;
  const stripped = JSON.parse(JSON.stringify(after));
  const beforeChoices = new Map((before.choices ?? []).map((choice) => [choice.id, choice]));
  const added = new Set();
  for (const choice of stripped.choices ?? []) {
    const original = beforeChoices.get(choice.id);
    if (!original || !isRecord(choice.effects)) continue;
    const originalEffects = original.effects ?? {};
    for (const [bucket, prefix] of [["tags", "tag"], ["variables", "var"]]) {
      const entries = choice.effects[bucket];
      if (!isRecord(entries)) continue;
      for (const [key, value] of Object.entries(entries)) {
        if (originalEffects[bucket] && key in originalEffects[bucket]) continue;
        if (!missingSignals.has(`${prefix}:${key}`)) continue;
        if (bucket === "tags" && !value) continue;
        // Core treats a null variable effect as clearing the variable, not producing it.
        if (bucket === "variables" && (value === null || value === undefined)) continue;
        delete entries[key];
        added.add(`${prefix}:${key}`);
      }
      if (Object.keys(entries).length === 0 && !(bucket in originalEffects)) delete choice.effects[bucket];
    }
  }
  if (added.size === 0) return null;
  return stableJson(stripped) === stableJson(before) ? [...added].sort() : null;
}

function collectEditedCards(baseById, afterById) {
  const edited = [];
  for (const [cardId, card] of baseById.entries()) {
    const after = afterById.get(cardId);
    if (after && stableJson(after) !== stableJson(card)) edited.push(cardId);
  }
  return edited;
}

function requirementAtoms(card) {
  const requirements = card?.requirements ?? {};
  const atoms = [];
  for (const key of ["allTags", "anyTags"]) for (const tag of strings(requirements[key])) atoms.push({ atom: `${key}:${tag}`, signal: `tag:${tag}` });
  for (const tag of strings(requirements.noneTags)) atoms.push({ atom: `noneTags:${tag}`, signal: null });
  for (const [key, value] of Object.entries(requirements.variables ?? {})) atoms.push({ atom: `variables:${key}=${stableJson(value)}`, signal: `var:${key}` });
  for (const [key, value] of Object.entries(requirements.factions ?? {})) atoms.push({ atom: `factions:${key}=${stableJson(value)}`, signal: `gauge:${key}` });
  return atoms;
}

function compareGates(context, afterById, edited) {
  const removed = [];
  const relaxedDead = [];
  for (const cardId of edited) {
    const afterAtoms = new Set(requirementAtoms(afterById.get(cardId)).map((entry) => entry.atom));
    for (const entry of requirementAtoms(context.baseById.get(cardId))) {
      if (afterAtoms.has(entry.atom)) continue;
      const label = `${cardId} ${entry.atom}`;
      if (entry.signal && context.deadSignals.has(entry.signal)) relaxedDead.push(label);
      else removed.push(label);
    }
  }
  return { removed, relaxedDead };
}

function compareEffects(baseById, afterById, edited) {
  const problems = [];
  for (const cardId of edited) {
    const afterCard = afterById.get(cardId);
    for (const choice of baseById.get(cardId).choices ?? []) {
      const afterChoice = (afterCard.choices ?? []).find((candidate) => candidate.id === choice.id);
      if (!afterChoice) continue; // player_valid reports missing left/right choices.
      const beforeEffects = choice.effects ?? {};
      const afterEffects = afterChoice.effects ?? {};
      // Core treats tag false/null and variable null as deletions, and variable values feed
      // requirements, so every existing tag/variable entry must keep its exact meaning.
      const lostTags = Object.entries(beforeEffects.tags ?? {})
        .filter(([tag, value]) => tagEffectMeaning(value) !== tagEffectMeaning(afterEffects.tags?.[tag], tag in (afterEffects.tags ?? {})))
        .map(([tag]) => tag);
      const lostVariables = Object.entries(beforeEffects.variables ?? {})
        .filter(([key, value]) => !(key in (afterEffects.variables ?? {})) || stableJson(afterEffects.variables[key]) !== stableJson(value))
        .map(([key]) => key);
      const beforeMagnitude = magnitude(beforeEffects.factions);
      const afterMagnitude = magnitude(afterEffects.factions);
      if (lostTags.length > 0) problems.push(`${cardId}/${choice.id} changes or drops tag effect ${lostTags.join(", ")}`);
      if (lostVariables.length > 0) problems.push(`${cardId}/${choice.id} changes or drops variable effect ${lostVariables.join(", ")}`);
      if (beforeMagnitude > 0 && afterMagnitude < beforeMagnitude * MIN_EFFECT_MAGNITUDE_RATIO) {
        problems.push(`${cardId}/${choice.id} gauge movement ${beforeMagnitude} → ${afterMagnitude} (below 50%)`);
      }
    }
  }
  return { problems };
}

function finalizeVerdict({ checks, before, after, metrics }) {
  const blockingFailed = checks.filter((check) => check.severity === "blocking" && !check.passed).map((check) => check.id);
  const ordered = REPAIR_CHECKS.map((definition) => checks.find((check) => check.id === definition.id)).filter(Boolean);
  return {
    passed: blockingFailed.length === 0 && Boolean(after),
    failedChecks: blockingFailed,
    advisories: ordered.filter((check) => check.severity === "advisory" && !check.passed).map((check) => check.id),
    checks: ordered,
    score: {
      before: before.healthScore,
      after: after ? after.healthScore : null,
      delta: after ? after.healthScore - before.healthScore : null
    },
    metrics: {
      before,
      after,
      ...(metrics ?? {})
    }
  };
}

function skippedVerdict(budget) {
  return {
    passed: false,
    failedChecks: ["evaluation_budget"],
    advisories: [],
    checks: [{ id: "evaluation_budget", severity: "blocking", passed: false, detail: `Not evaluated: only the first ${budget.maxProposalsPerRound} proposals per round are scored.` }],
    score: { before: null, after: null, delta: null },
    metrics: {}
  };
}

function patchedCardIds(patches) {
  const ids = new Set();
  for (const patch of Array.isArray(patches) ? patches : []) {
    const cardId = patch?.op === "addCard" ? patch?.card?.id : patch?.cardId;
    if (typeof cardId === "string" && cardId) ids.add(cardId);
  }
  return [...ids].slice(0, 8);
}

function defaultYield() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * createLoopProgress forwards loop progress to an optional observer. Events always carry
 * maxRounds and the latest round, so a UI can render "Round r/3 · stage".
 */
function createLoopProgress(onProgress, maxRounds) {
  let lastRound = 0;
  return {
    emit(event) {
      if (typeof onProgress !== "function") return;
      if (Number.isInteger(event.round)) lastRound = event.round;
      try {
        onProgress({ maxRounds, ...event, round: event.round ?? lastRound });
      } catch {
        // Progress observers must never break the loop.
      }
    }
  };
}

function withVerification(proposal, round, verdict) {
  return { ...proposal, verification: { round, ...verdict } };
}

function compactAttempt(round, proposal) {
  const verification = proposal.verification;
  return {
    round,
    proposalId: proposal.id,
    title: String(proposal.title ?? "").slice(0, 120),
    ops: (proposal.patches ?? []).map((patch) => patch?.op).slice(0, 8),
    score: verification.score,
    failedChecks: verification.checks
      .filter((check) => check.severity === "blocking" && !check.passed)
      .map((check) => ({ id: check.id, detail: String(check.detail ?? "").slice(0, 240) }))
  };
}

function buildRepairLoopConstraints({ round, budget, targets, attempts }) {
  const base = {
    round,
    maxRounds: budget.maxRounds,
    targets: groupTargets(targets),
    acceptanceRules: REPAIR_CHECKS.filter((check) => check.severity === "blocking").map((check) => `${check.id}: ${fillRule(check.rule, budget)}`),
    previousAttempts: []
  };
  // Newest attempts are most useful; drop the oldest until the feedback fits the byte budget.
  const recent = [...attempts].reverse();
  const kept = [];
  for (const attempt of recent) {
    const candidate = { ...base, previousAttempts: [attempt, ...kept] };
    if (byteLength(JSON.stringify(candidate)) > budget.feedbackBytes) break;
    kept.unshift(attempt);
  }
  return { ...base, previousAttempts: kept, omittedAttempts: attempts.length - kept.length };
}

function groupTargets(targets) {
  const byCode = new Map();
  for (const target of targets) {
    const entry = byCode.get(target.code) ?? { code: target.code, severity: target.severity, cardIds: [], tags: [], variables: [], factions: [] };
    const [kind, name] = splitEntity(target.entity);
    if (kind === "card") entry.cardIds.push(name);
    if (kind === "tag") entry.tags.push(name);
    if (kind === "var") entry.variables.push(name);
    if (kind === "gauge") entry.factions.push(name);
    byCode.set(target.code, entry);
  }
  return [...byCode.values()];
}

function pickBestRound(evaluatedRounds) {
  if (evaluatedRounds.length === 0) return null;
  // No round passed: prefer the round whose best proposal fails the fewest blocking
  // checks, then the higher score, then the later round (it saw more feedback).
  // Proposals skipped by the per-round evaluation budget were never scored; ignore them.
  const rank = (entry) => entry.proposals.filter((proposal) => !proposal.verification.failedChecks.includes("evaluation_budget")).reduce((best, proposal) => {
    const failed = proposal.verification.failedChecks.length;
    const score = proposal.verification.score.after ?? -1;
    return failed < best.failed || (failed === best.failed && score > best.score) ? { failed, score } : best;
  }, { failed: Number.POSITIVE_INFINITY, score: -1 });
  let chosen = evaluatedRounds[0];
  let chosenRank = rank(chosen);
  for (const entry of evaluatedRounds.slice(1)) {
    const current = rank(entry);
    if (current.failed < chosenRank.failed || (current.failed === chosenRank.failed && current.score >= chosenRank.score)) {
      chosen = entry;
      chosenRank = current;
    }
  }
  return chosen;
}

function countBlockedChecks(proposals) {
  const counts = {};
  for (const proposal of proposals) {
    for (const id of proposal.verification.failedChecks) counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

function bestScoreOf(proposals) {
  const scores = proposals.map((proposal) => proposal.verification.score.after).filter((score) => Number.isFinite(score));
  return scores.length > 0 ? Math.max(...scores) : null;
}

function summarizeScore(diagnostics) {
  const warnings = Array.isArray(diagnostics?.warnings) ? diagnostics.warnings : [];
  return {
    healthScore: diagnostics?.healthScore ?? 0,
    rawHealthScore: Number.isFinite(diagnostics?.rawHealthScore) ? diagnostics.rawHealthScore : null,
    errors: warnings.filter((warning) => warning.severity === "error").length,
    warnings: warnings.filter((warning) => warning.severity !== "error").length,
    stalledRate: diagnostics?.coverage?.stalledRate ?? 0,
    gameOverRate: diagnostics?.coverage?.gameOverRate ?? 0,
    reachableCards: (diagnostics?.graph?.reachableCards ?? []).length,
    unreachableCards: (diagnostics?.graph?.unreachableCards ?? []).length
  };
}

function createMeter({ fetchImpl, budget, remainingMs, remainingTotalBytes, apiKey }) {
  const state = { requestBytes: 0, responseBytes: 0, calls: 0, budgetError: null, exchanges: [] };
  const deadline = AbortSignal.timeout(Math.max(1, remainingMs));
  const fail = (code, message) => {
    state.budgetError = { code, message };
    const error = new Error(message);
    error.code = code;
    return error;
  };
  const meter = {
    get budgetError() {
      return state.budgetError;
    },
    get totalBytes() {
      return state.requestBytes + state.responseBytes;
    },
    usage() {
      return {
        calls: state.calls,
        requestBytes: state.requestBytes,
        responseBytes: state.responseBytes,
        estimatedTokens: Math.ceil((state.requestBytes + state.responseBytes) / 4)
      };
    },
    exchange() {
      return state.exchanges.map((entry) => ({ ...entry }));
    },
    async fetch(url, init = {}) {
      if (typeof fetchImpl !== "function") throw fail("endpoint_fetch_unavailable", "AI endpoint execution requires fetch");
      const body = typeof init.body === "string" ? init.body : "";
      const requestBytes = byteLength(body);
      state.calls += 1;
      state.requestBytes += requestBytes;
      const record = {
        call: state.calls,
        method: init.method ?? "GET",
        url: redactUrl(url),
        headers: redactHeaders(init.headers),
        requestBytes,
        requestBody: truncate(scrub(body, apiKey), budget.logBytes),
        status: null,
        responseBytes: 0,
        responseText: ""
      };
      state.exchanges.push(record);
      if (requestBytes > budget.maxRequestBytes) {
        throw fail("ai_repair_request_budget", `Repair round request is ${requestBytes} bytes; limit is ${budget.maxRequestBytes}`);
      }
      if (state.requestBytes + state.responseBytes > remainingTotalBytes) {
        throw fail("ai_repair_total_budget", "Repair loop exceeded its total byte budget");
      }
      const signal = init.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
      const response = await fetchImpl(url, { ...init, signal });
      // Include bytes already received (e.g. the first attempt before a JSON-mode retry).
      const limit = Math.min(budget.maxResponseBytes, Math.max(0, remainingTotalBytes - state.requestBytes - state.responseBytes));
      let text;
      try {
        text = await readBoundedResponseText(response, {
          maxBytes: limit,
          createLimitError: () => fail("ai_repair_response_budget", `Repair round response exceeds ${limit} bytes`)
        });
      } catch (error) {
        record.status = response?.status ?? null;
        throw error;
      }
      const responseBytes = byteLength(text);
      state.responseBytes += responseBytes;
      record.status = response?.status ?? null;
      record.responseBytes = responseBytes;
      record.responseText = truncate(scrub(text, apiKey), budget.logBytes);
      return {
        ok: Boolean(response?.ok),
        status: response?.status,
        headers: { get: (name) => (String(name).toLowerCase() === "content-length" ? String(responseBytes) : response?.headers?.get?.(name) ?? null) },
        text: async () => text
      };
    }
  };
  return meter;
}

function normalizeLimits(limits) {
  const merged = { ...DEFAULT_REPAIR_LOOP_LIMITS, ...(isRecord(limits) ? limits : {}) };
  const result = {};
  for (const [key, fallback] of Object.entries(DEFAULT_REPAIR_LOOP_LIMITS)) {
    const value = Number(merged[key]);
    result[key] = Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
  }
  result.maxRounds = Math.min(REPAIR_LOOP_HARD_MAX_ROUNDS, Math.max(1, result.maxRounds));
  return result;
}

function normalizeScoring(scoring) {
  const source = isRecord(scoring) ? scoring : {};
  const pick = (key, max) => {
    const value = Number(source[key]);
    return Number.isInteger(value) && value > 0 ? Math.min(value, max) : DEFAULT_REPAIR_SCORING[key];
  };
  return { cycles: pick("cycles", 10000), maxTurns: pick("maxTurns", 200), seed: Number.isInteger(source.seed) ? source.seed : DEFAULT_REPAIR_SCORING.seed };
}

function describeCheck(budget) {
  return (check) => ({ id: check.id, severity: check.severity, label: check.label, rule: fillRule(check.rule, budget) });
}

function fillRule(rule, budget) {
  return rule.replace(/\{(\w+)\}/g, (_, key) => String(budget[key] ?? key));
}

function stripRepairConstraints(config) {
  if (!isRecord(config) || !isRecord(config.constraints)) return config;
  const { repairLoop, ...rest } = config.constraints;
  void repairLoop;
  return { ...config, constraints: rest };
}

function toBundle(editor) {
  return editor?.toBundle ? editor.toBundle() : createContentBundle(editor ?? {});
}

function fingerprintBundle(bundle) {
  return createAiEditSuggestions({ bundle, mode: "generate_cards", config: { cardCount: 1 }, instruction: "" }).baseFingerprint;
}

function formatIssue(issue) {
  return issue.entity === "*" ? issue.code : `${issue.code} ${issue.entity}`;
}

function formatRate(value) {
  return `${Math.round((Number(value) || 0) * 1000) / 10}%`;
}

function splitEntity(entity) {
  if (entity === "*") return ["*", null];
  const index = entity.indexOf(":");
  return [entity.slice(0, index), entity.slice(index + 1)];
}

// "set" (truthy value, compared exactly), "clear" (false/null), or "absent".
function tagEffectMeaning(value, present = true) {
  if (!present || value === undefined) return "absent";
  if (value === false || value === null) return "clear";
  return `set:${stableJson(value)}`;
}

function magnitude(factions) {
  return Object.values(isRecord(factions) ? factions : {}).reduce((total, value) => total + (Number.isFinite(value) ? Math.abs(value) : 0), 0);
}

function redactHeaders(headers) {
  const result = {};
  for (const [key, value] of Object.entries(isRecord(headers) ? headers : {})) {
    result[key] = /authorization|api-key|token|secret|cookie/i.test(key) ? "[redacted]" : String(value);
  }
  return result;
}

function redactUrl(url) {
  try {
    const parsed = new URL(String(url));
    parsed.username = "";
    parsed.password = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (/key|token|secret|credential/i.test(key)) parsed.searchParams.set(key, "[redacted]");
    }
    return parsed.toString();
  } catch {
    return "[unparseable url]";
  }
}

function scrub(text, apiKey) {
  const value = String(text ?? "");
  return apiKey && apiKey.length >= 4 ? value.split(apiKey).join("[redacted]") : value;
}

function truncate(text, limit) {
  return text.length > limit ? `${text.slice(0, limit)}… [truncated ${text.length - limit} chars]` : text;
}

function byteLength(text) {
  return new TextEncoder().encode(String(text ?? "")).length;
}

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function strings(value) {
  return Array.isArray(value) ? value.filter(isText) : [];
}

function isText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
