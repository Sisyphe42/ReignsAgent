/**
 * Repair history records: one compact, key-free record per verified repair-loop run.
 *
 * Records are built from whitelisted fields only. They never contain the connector
 * config, credentials, endpoint URLs, or request/response bodies (`exchange`), so a
 * stored history can be shared with a project without leaking secrets. Hosts store the
 * records through the workspace repair-history contract (count and size limits).
 */

import { extractEndpointUsage } from "../../pipeline/src/index.js";

export const REPAIR_HISTORY_RECORD_VERSION = 1;
// Without a usage block from the endpoint, tokens are estimated from bytes and labelled so.
export const ESTIMATED_BYTES_PER_TOKEN = 4;

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
  // The loop logs each round's requests; a not-scored repair makes one plain request instead.
  const loopExchange = rounds.flatMap((round) => (Array.isArray(round.exchange) ? round.exchange : []).map((entry) => ({ round: Number(round.round) || 0, entry })));
  const exchange = loopExchange.length > 0
    ? loopExchange
    : (Array.isArray(plan?.exchange) ? plan.exchange : Array.isArray(error?.exchange) ? error.exchange : []).map((entry) => ({ round: 1, entry }));
  const record = {
    schemaVersion: REPAIR_HISTORY_RECORD_VERSION,
    kind: "repair_loop",
    source: clip(request.source, 40) || null,
    id: String(id ?? ""),
    createdAt,
    status: error ? (error.code === "ai_cancelled" ? "cancelled" : "failed") : String(verification?.status ?? "unverified"),
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
    // What the run brought back from the activity log: counts only, the text is in the conversation.
    memory: isRecord(verification?.memory) ? { priorAttempts: Number(verification.memory.priorAttempts) || 0, authorDeclined: Number(verification.memory.authorDeclined) || 0 } : null,
    rounds: rounds.map(compactRound),
    // The model conversation as the loop logged it: already redacted, each message capped by the
    // loop's logBytes. Endpoint URLs and headers are left out on purpose.
    conversation: exchange.map(({ round, entry }) => compactExchangeEntry(entry, round)),
    // Tokens and bytes of every request in this run (reported by the endpoint or estimated).
    usage: summarizeExchangeUsage(exchange.map(({ entry }) => entry)),
    finalProposals: finalProposals.map((proposal) => ({
      id: String(proposal.id ?? ""),
      title: clip(proposal.title, TEXT_LIMITS.title),
      summary: clip(proposal.summary, TEXT_LIMITS.summary),
      cardIds: proposalCardIds(proposal),
      passed: proposal.verification ? Boolean(proposal.verification.passed) : null,
      scoreAfter: numberOrNull(proposal.verification?.score?.after),
      patchCount: Array.isArray(proposal.patches) ? proposal.patches.length : 0
    })),
    preselectedProposalIds: finalProposals
      .filter((proposal) => proposal.verification?.passed)
      .map((proposal) => String(proposal.id ?? "")),
    outcome: error ? (error.code === "ai_cancelled" ? "cancelled" : "failed") : "draft",
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
 * createAiActivityRecord is the activity-log record for every other AI request: ordinary drafts,
 * selection actions (explain / edit), and image runs. Same whitelisting and redaction rules as
 * repair-loop records; kind tells the UI which replay to show.
 */
export function createAiActivityRecord({
  kind = "draft",
  plan = null,
  error = null,
  request = {},
  image = null,
  id,
  createdAt = new Date().toISOString(),
  durationMs = null,
  secrets = []
} = {}) {
  const proposals = Array.isArray(plan?.proposals) ? plan.proposals : [];
  const exchange = Array.isArray(plan?.exchange) ? plan.exchange : Array.isArray(error?.exchange) ? error.exchange : [];
  const focus = plan?.request?.context?.selection?.focus ?? (request.selection && typeof request.selection === "object" ? request.selection : null);
  const record = {
    schemaVersion: REPAIR_HISTORY_RECORD_VERSION,
    kind,
    source: clip(request.source, 40) || null,
    mode: clip(request.mode ?? plan?.mode ?? image?.operation, 40) || null,
    id: String(id ?? ""),
    createdAt,
    status: error ? (error.code === "ai_cancelled" ? "cancelled" : "failed") : "ready",
    stopReason: error ? (error.code ?? "error") : null,
    instruction: clip(request.instruction ?? image?.prompt, TEXT_LIMITS.instruction),
    endpoint: plan ? (plan.provider ? "configured" : "local_rules") : image ? "configured" : null,
    model: clip(plan?.provider?.model ?? image?.model, 120) || null,
    durationMs: numberOrNull(durationMs),
    selection: focus ? {
      kind: clip(focus.kind, 60),
      label: clip(focus.label, 160),
      cardId: focus.cardId ? String(focus.cardId) : null,
      text: clip(focus.text, 400)
    } : null,
    contextSelection: compactCardSelection(plan?.request?.context?.bundle?.cardSelection),
    answer: plan?.answer ? clip(plan.answer, 4000) : null,
    finalProposals: proposals.map((proposal) => ({
      id: String(proposal.id ?? ""),
      title: clip(proposal.title, TEXT_LIMITS.title),
      summary: clip(proposal.summary, TEXT_LIMITS.summary),
      passed: null,
      scoreAfter: null,
      patchCount: Array.isArray(proposal.patches) ? proposal.patches.length : 0
    })),
    scopeRejected: (Array.isArray(plan?.scopeRejected) ? plan.scopeRejected : []).slice(0, 12).map((entry) => ({ id: String(entry.id ?? ""), title: clip(entry.title, TEXT_LIMITS.title), reason: clip(entry.reason, TEXT_LIMITS.detail) })),
    image: image ? { operation: clip(image.operation, 40), outputs: Number(image.outputs) || 0 } : null,
    rounds: [],
    conversation: exchange.map((entry, index) => compactExchangeEntry({ ...entry, call: Number(entry.call) || index + 1 }, 1)),
    // Image requests are multipart and not byte-metered: only a usage block the provider reported counts.
    usage: image ? imageUsage(image.usage) : summarizeExchangeUsage(exchange),
    preselectedProposalIds: [],
    outcome: error ? (error.code === "ai_cancelled" ? "cancelled" : "failed") : "draft",
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
 * markRepairHistoryApplied records the author's final selection on a stored record. Proposals that
 * were shown with patches but not ticked are kept as `declinedProposals` (reason "not_selected"):
 * the next repair on the same issue tells the model the author did not want them.
 */
export function markRepairHistoryApplied(record, { proposalIds = [], appliedAt = new Date().toISOString() } = {}) {
  const appliedProposalIds = [...new Set((Array.isArray(proposalIds) ? proposalIds : []).map(String))].slice(0, 24);
  const applied = new Set(appliedProposalIds);
  const declined = (Array.isArray(record?.finalProposals) ? record.finalProposals : [])
    .filter((proposal) => proposal?.id && !applied.has(String(proposal.id)) && Number(proposal.patchCount) > 0)
    .map((proposal) => declinedEntry(proposal, "not_selected", appliedAt));
  return {
    ...record,
    outcome: "applied",
    appliedProposalIds,
    appliedAt,
    declinedProposals: declined.slice(0, 12)
  };
}

/**
 * markRepairHistoryUndone records that the author undid an applied draft. The undone proposals
 * join `declinedProposals` (reason "undone"). A record that was never applied is returned unchanged.
 */
export function markRepairHistoryUndone(record, { proposalIds = null, undoneAt = new Date().toISOString() } = {}) {
  if (record?.outcome !== "applied") return record;
  const appliedIds = (Array.isArray(record.appliedProposalIds) ? record.appliedProposalIds : []).map(String);
  const requested = Array.isArray(proposalIds) ? new Set(proposalIds.map(String)) : null;
  const undone = appliedIds.filter((id) => !requested || requested.has(id));
  if (undone.length === 0) return record;
  const byId = new Map((Array.isArray(record.finalProposals) ? record.finalProposals : []).map((proposal) => [String(proposal.id), proposal]));
  const undoneSet = new Set(undone);
  const kept = (Array.isArray(record.declinedProposals) ? record.declinedProposals : []).filter((entry) => !undoneSet.has(String(entry.id)));
  return {
    ...record,
    undoneAt,
    undoneProposalIds: [...new Set([...(Array.isArray(record.undoneProposalIds) ? record.undoneProposalIds : []), ...undone])].slice(0, 24),
    declinedProposals: [...undone.map((id) => declinedEntry(byId.get(id) ?? { id }, "undone", undoneAt)), ...kept].slice(0, 12)
  };
}

function declinedEntry(proposal, reason, at) {
  return {
    id: String(proposal.id ?? ""),
    title: clip(proposal.title, TEXT_LIMITS.title),
    summary: clip(proposal.summary, TEXT_LIMITS.summary),
    cardIds: Array.isArray(proposal.cardIds) ? proposal.cardIds.slice(0, 8).map(String) : [],
    reason,
    at
  };
}

// How much of the activity log a repair run may bring back as memory for the same issue.
export const REPAIR_MEMORY_LIMITS = Object.freeze({
  priorRuns: 2,
  priorAttempts: 4,
  declinedRuns: 6,
  declinedChanges: 4,
  declinedTitle: 120,
  declinedSummary: 200,
  declinedCardIds: 4,
  declinedBytes: 2 * 1024
});

/**
 * collectRepairMemory is the one host-neutral reading of the activity log before a repair run on
 * `repairTarget` (same issue code and, when given, the same target cards):
 * - priorAttempts: blocked proposals from the last two runs (up to four);
 * - authorDeclined: changes the author left unticked or undid in the last six runs (up to four,
 *   about 2 KiB), newest first, one per distinct title + cards.
 * `list` returns history summaries (newest first) and `read(id)` one full record. Errors yield
 * empty memory: the log is an aid and never blocks a repair.
 */
export async function collectRepairMemory({ list, read, repairTarget } = {}) {
  const empty = { priorAttempts: [], authorDeclined: [] };
  if (!isRecord(repairTarget) || typeof repairTarget.code !== "string" || !repairTarget.code) return empty;
  try {
    const wanted = new Set((Array.isArray(repairTarget.cardIds) ? repairTarget.cardIds : []).map((cardId) => `card:${cardId}`));
    const matches = (await list())
      .filter((entry) => (entry.kind ?? "repair_loop") === "repair_loop" && (Array.isArray(entry.targets) ? entry.targets : []).some((target) => target.code === repairTarget.code && (wanted.size === 0 || wanted.has(target.entity))))
      .slice(0, Math.max(REPAIR_MEMORY_LIMITS.priorRuns, REPAIR_MEMORY_LIMITS.declinedRuns));
    const priorAttempts = [];
    const authorDeclined = [];
    const seen = new Set();
    let declinedBytes = 0;
    for (const [index, entry] of matches.entries()) {
      const wantsAttempts = index < REPAIR_MEMORY_LIMITS.priorRuns && priorAttempts.length < REPAIR_MEMORY_LIMITS.priorAttempts;
      const wantsDeclined = entry.outcome === "applied" && authorDeclined.length < REPAIR_MEMORY_LIMITS.declinedChanges;
      if (!wantsAttempts && !wantsDeclined) continue;
      const stored = await read(entry.id);
      if (wantsAttempts) {
        for (const round of stored?.rounds ?? []) {
          for (const proposal of round.proposals ?? []) {
            if (!proposal.passed && priorAttempts.length < REPAIR_MEMORY_LIMITS.priorAttempts) {
              priorAttempts.push({ proposalId: proposal.id, title: proposal.title, failedChecks: (proposal.failedDetails ?? []).length ? proposal.failedDetails : (proposal.failedChecks ?? []).map((id) => ({ id })) });
            }
          }
        }
      }
      for (const declined of wantsDeclined && Array.isArray(stored?.declinedProposals) ? stored.declinedProposals : []) {
        const change = compactDeclinedChange(declined);
        const key = `${change.title.toLowerCase()}|${[...change.cardIds].sort().join(",")}`;
        if (!change.title || seen.has(key) || authorDeclined.length >= REPAIR_MEMORY_LIMITS.declinedChanges) continue;
        const size = new TextEncoder().encode(JSON.stringify(change)).length;
        if (declinedBytes + size > REPAIR_MEMORY_LIMITS.declinedBytes) continue;
        seen.add(key);
        declinedBytes += size;
        authorDeclined.push(change);
      }
    }
    return { priorAttempts, authorDeclined };
  } catch {
    return empty;
  }
}

/**
 * compactDeclinedChange bounds one remembered change to what the model needs: a title, a short
 * summary, the cards it touched, and whether it was left unticked or undone.
 */
export function compactDeclinedChange(entry) {
  return {
    title: clip(entry?.title, REPAIR_MEMORY_LIMITS.declinedTitle),
    summary: clip(entry?.summary, REPAIR_MEMORY_LIMITS.declinedSummary),
    cardIds: (Array.isArray(entry?.cardIds) ? entry.cardIds : []).slice(0, REPAIR_MEMORY_LIMITS.declinedCardIds).map((cardId) => clip(cardId, 80)),
    reason: entry?.reason === "undone" ? "undone" : "not_selected"
  };
}

export function scrubRecordSecrets(record, secrets = []) {
  const values = (Array.isArray(secrets) ? secrets : [secrets]).filter((value) => typeof value === "string" && value.trim().length >= 6);
  if (values.length === 0) return record;
  let text = JSON.stringify(record);
  for (const value of values) text = text.split(JSON.stringify(value.trim()).slice(1, -1)).join("[redacted]");
  return JSON.parse(text);
}

/**
 * exchangeEntryUsage is the token count of one logged request: the endpoint's own usage block
 * when it sent one (`source: "reported"`), otherwise an estimate of ESTIMATED_BYTES_PER_TOKEN bytes
 * per token on each side (`source: "estimated"`). Null when nothing was sent.
 */
export function exchangeEntryUsage(entry) {
  const reported = normalizeTokenCounts(entry?.usage);
  if (reported) return { ...reported, source: "reported" };
  const requestBytes = numberOrNull(entry?.requestBytes) ?? 0;
  const responseBytes = numberOrNull(entry?.responseBytes) ?? 0;
  if (requestBytes === 0 && responseBytes === 0) return null;
  const inputTokens = Math.ceil(requestBytes / ESTIMATED_BYTES_PER_TOKEN);
  const outputTokens = Math.ceil(responseBytes / ESTIMATED_BYTES_PER_TOKEN);
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, source: "estimated" };
}

/**
 * summarizeExchangeUsage totals a list of logged requests:
 * { calls, requestBytes, responseBytes, inputTokens, outputTokens, totalTokens, source } where
 * source is "reported" (every request reported usage), "estimated" (none did), or "mixed".
 * Null when the list is empty (for example local rules, which send nothing).
 */
export function summarizeExchangeUsage(entries) {
  const list = (Array.isArray(entries) ? entries : []).filter(isRecord);
  if (list.length === 0) return null;
  const totals = { calls: list.length, requestBytes: 0, responseBytes: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const sources = new Set();
  for (const entry of list) {
    totals.requestBytes += numberOrNull(entry.requestBytes) ?? 0;
    totals.responseBytes += numberOrNull(entry.responseBytes) ?? 0;
    const usage = exchangeEntryUsage(entry);
    if (!usage) continue;
    sources.add(usage.source);
    totals.inputTokens += usage.inputTokens ?? 0;
    totals.outputTokens += usage.outputTokens ?? 0;
    totals.totalTokens += usage.totalTokens ?? 0;
  }
  return { ...totals, source: sources.size === 1 ? [...sources][0] : sources.size > 1 ? "mixed" : "estimated" };
}

function imageUsage(usage) {
  const reported = normalizeTokenCounts(extractEndpointUsage({ usage }) ?? extractEndpointUsage(usage));
  return reported ? { calls: 1, requestBytes: null, responseBytes: null, ...reported, source: "reported" } : null;
}

function normalizeTokenCounts(usage) {
  if (!isRecord(usage)) return null;
  const inputTokens = numberOrNull(usage.inputTokens);
  const outputTokens = numberOrNull(usage.outputTokens);
  const totalTokens = numberOrNull(usage.totalTokens) ?? (inputTokens === null && outputTokens === null ? null : (inputTokens ?? 0) + (outputTokens ?? 0));
  if (totalTokens === null) return null;
  return { inputTokens, outputTokens, totalTokens };
}

function compactExchangeEntry(entry, round) {
  const usage = exchangeEntryUsage(entry);
  return {
    round: Number(round) || 0,
    call: Number(entry.call) || 0,
    status: entry.status ?? null,
    requestBytes: numberOrNull(entry.requestBytes),
    responseBytes: numberOrNull(entry.responseBytes),
    ...(usage ? { usage } : {}),
    requestBody: String(entry.requestBody ?? ""),
    responseText: String(entry.responseText ?? "")
  };
}

function proposalCardIds(proposal) {
  const ids = new Set();
  for (const patch of Array.isArray(proposal?.patches) ? proposal.patches : []) {
    const cardId = patch?.op === "addCard" ? patch?.card?.id : patch?.cardId;
    if (typeof cardId === "string" && cardId) ids.add(cardId);
  }
  for (const cardId of Array.isArray(proposal?.target?.cardIds) ? proposal.target.cardIds : []) if (typeof cardId === "string" && cardId) ids.add(cardId);
  return [...ids].slice(0, 8);
}

function compactRound(round) {
  return {
    round: Number(round.round) || 0,
    status: String(round.status ?? "evaluated"),
    proposalCount: Number(round.proposalCount) || 0,
    passedCount: Number(round.passedCount) || 0,
    bestScore: numberOrNull(round.bestScore),
    blockedBy: isRecord(round.blockedBy) ? { ...round.blockedBy } : {},
    usage: summarizeExchangeUsage(round.exchange),
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
