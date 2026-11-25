/**
 * Repair history records: one compact, key-free record per verified repair-loop run.
 *
 * Records are built from whitelisted fields only. They never contain the connector
 * config, credentials, endpoint URLs, or request/response bodies (`exchange`), so a
 * stored history can be shared with a project without leaking secrets. Hosts store the
 * records through the workspace repair-history contract (count and size limits).
 */

export const REPAIR_HISTORY_RECORD_VERSION = 1;

const TEXT_LIMITS = Object.freeze({ instruction: 400, title: 160, summary: 240, detail: 200, error: 300 });

export function createRepairHistoryRecord({
  plan = null,
  error = null,
  request = {},
  id,
  createdAt = new Date().toISOString(),
  secrets = []
} = {}) {
  // A failed loop carries what it recorded before failing on error.repairVerification.
  const verification = plan?.verification ?? error?.repairVerification ?? null;
  const rounds = Array.isArray(verification?.rounds) ? verification.rounds : [];
  const finalProposals = Array.isArray(plan?.proposals) ? plan.proposals : [];
  const record = {
    schemaVersion: REPAIR_HISTORY_RECORD_VERSION,
    id: String(id ?? ""),
    createdAt,
    status: error ? "failed" : String(verification?.status ?? "unverified"),
    stopReason: error ? (error.code ?? "error") : (verification?.stopReason ?? null),
    instruction: clip(request.instruction, TEXT_LIMITS.instruction),
    repairTarget: compactRepairTarget(request.repairTarget),
    endpoint: verification?.endpoint ?? (plan?.provider ? "configured" : plan ? "local_rules" : null),
    model: typeof plan?.provider?.model === "string" ? clip(plan.provider.model, 120) : null,
    targets: (Array.isArray(verification?.targets) ? verification.targets : []).slice(0, 12).map((target) => ({
      code: String(target.code ?? ""),
      severity: target.severity ?? null,
      entity: String(target.entity ?? "*")
    })),
    baseline: verification?.baseline ? { healthScore: numberOrNull(verification.baseline.healthScore) } : null,
    selectedRound: Number.isInteger(verification?.selectedRound) ? verification.selectedRound : null,
    roundsUsed: Number.isInteger(verification?.roundsUsed) ? verification.roundsUsed : rounds.length,
    maxRounds: Number.isInteger(verification?.limits?.maxRounds) ? verification.limits.maxRounds : null,
    durationMs: numberOrNull(verification?.timing?.durationMs),
    contextSelection: compactCardSelection(plan?.request?.context?.bundle?.cardSelection),
    agentStop: verification?.agentStop ? { round: Number(verification.agentStop.round) || null, reason: clip(verification.agentStop.reason, 400) } : null,
    requestedCardIds: Array.isArray(verification?.requestedCardIds) ? verification.requestedCardIds.slice(0, 12).map(String) : [],
    rounds: rounds.map(compactRound),
    // The model conversation as the loop logged it: already redacted, each message capped by the
    // loop's logBytes. Endpoint URLs and headers are left out on purpose.
    conversation: rounds.flatMap((round) => (Array.isArray(round.exchange) ? round.exchange : []).map((entry) => ({
      round: Number(round.round) || 0,
      call: Number(entry.call) || 0,
      status: entry.status ?? null,
      requestBytes: numberOrNull(entry.requestBytes),
      responseBytes: numberOrNull(entry.responseBytes),
      requestBody: String(entry.requestBody ?? ""),
      responseText: String(entry.responseText ?? "")
    }))),
    finalProposals: finalProposals.map((proposal) => ({
      id: String(proposal.id ?? ""),
      title: clip(proposal.title, TEXT_LIMITS.title),
      passed: proposal.verification ? Boolean(proposal.verification.passed) : null,
      scoreAfter: numberOrNull(proposal.verification?.score?.after),
      patchCount: Array.isArray(proposal.patches) ? proposal.patches.length : 0
    })),
    preselectedProposalIds: finalProposals
      .filter((proposal) => proposal.verification?.passed)
      .map((proposal) => String(proposal.id ?? "")),
    outcome: error ? "failed" : "draft",
    appliedProposalIds: [],
    appliedAt: null,
    error: error ? {
      code: String(error.code ?? "error"),
      stage: typeof error.stage === "string" ? error.stage : null,
      message: clip(redactUrls(error.message ?? String(error)), TEXT_LIMITS.error)
    } : null
  };
  return scrubRecordSecrets(record, secrets);
}

/**
 * markRepairHistoryApplied records the author's final selection on a stored record.
 */
export function markRepairHistoryApplied(record, { proposalIds = [], appliedAt = new Date().toISOString() } = {}) {
  return {
    ...record,
    outcome: "applied",
    appliedProposalIds: [...new Set((Array.isArray(proposalIds) ? proposalIds : []).map(String))].slice(0, 24),
    appliedAt
  };
}

export function scrubRecordSecrets(record, secrets = []) {
  const values = (Array.isArray(secrets) ? secrets : [secrets]).filter((value) => typeof value === "string" && value.trim().length >= 6);
  if (values.length === 0) return record;
  let text = JSON.stringify(record);
  for (const value of values) text = text.split(JSON.stringify(value.trim()).slice(1, -1)).join("[redacted]");
  return JSON.parse(text);
}

function compactRound(round) {
  return {
    round: Number(round.round) || 0,
    status: String(round.status ?? "evaluated"),
    proposalCount: Number(round.proposalCount) || 0,
    passedCount: Number(round.passedCount) || 0,
    bestScore: numberOrNull(round.bestScore),
    blockedBy: isRecord(round.blockedBy) ? { ...round.blockedBy } : {},
    durationMs: numberOrNull(round.timing?.durationMs),
    requestMs: numberOrNull(round.timing?.requestMs),
    agent: round.agent ? {
      contextRequests: Array.isArray(round.agent.contextRequests) ? round.agent.contextRequests.slice(0, 6).map(String) : [],
      stop: round.agent.stop ? { reason: clip(round.agent.stop.reason, 400) } : null
    } : null,
    error: round.error ? { code: String(round.error.code ?? "error"), message: clip(redactUrls(round.error.message), TEXT_LIMITS.error) } : null,
    proposals: (Array.isArray(round.proposals) ? round.proposals : []).map((proposal) => ({
      id: String(proposal.id ?? ""),
      title: clip(proposal.title, TEXT_LIMITS.title),
      summary: clip(proposal.summary, TEXT_LIMITS.summary),
      passed: Boolean(proposal.passed),
      scoreAfter: numberOrNull(proposal.scoreAfter),
      patchCount: Number.isInteger(proposal.patchCount) ? proposal.patchCount : null,
      cardIds: Array.isArray(proposal.cardIds) ? proposal.cardIds.slice(0, 8).map(String) : [],
      failedChecks: Array.isArray(proposal.failedChecks) ? proposal.failedChecks.map(String) : [],
      failedDetails: (Array.isArray(proposal.failedDetails) ? proposal.failedDetails : []).slice(0, 8).map((entry) => ({
        id: String(entry.id ?? ""),
        detail: clip(entry.detail, TEXT_LIMITS.detail)
      }))
    }))
  };
}

function compactCardSelection(selection) {
  if (!isRecord(selection)) return null;
  const reasons = isRecord(selection.reasons) ? Object.fromEntries(Object.entries(selection.reasons).slice(0, 40).map(([key, value]) => [key, clip(value, 160)])) : {};
  return {
    strategy: selection.strategy ?? null,
    included: Number(selection.included) || 0,
    omitted: Number(selection.omitted) || 0,
    maxCards: numberOrNull(selection.maxCards),
    budgetBytes: numberOrNull(selection.budgetBytes),
    usedBytes: numberOrNull(selection.usedBytes),
    tiers: isRecord(selection.tiers) ? { ...selection.tiers } : null,
    omittedReasons: isRecord(selection.omittedReasons) ? { ...selection.omittedReasons } : null,
    reasons
  };
}

function compactRepairTarget(target) {
  if (!isRecord(target)) return null;
  return {
    code: clip(target.code, 80),
    cardIds: Array.isArray(target.cardIds) ? target.cardIds.slice(0, 12).map(String) : []
  };
}

/**
 * redactUrls removes URLs from error text before it is stored: a native fetch failure can echo
 * the endpoint URL, which may carry user-info or signed query tokens.
 */
export function redactUrls(text) {
  return String(text ?? "")
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>()]+/gi, "[url redacted]")
    .replace(/\b[^\s:@/]+:[^\s:@/]+@[^\s/]+/g, "[credentials redacted]");
}

function clip(value, limit) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function numberOrNull(value) {
  return Number.isFinite(Number(value)) && value !== null && value !== "" ? Number(value) : null;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
