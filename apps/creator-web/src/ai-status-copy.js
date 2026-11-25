/**
 * Author-facing copy for AI Assist outcomes: failure notices, the cancelled state, and the
 * repair-loop stop sentence. Pure functions (no React, no DOM) so they can be unit tested.
 */

const TRAILING_STOP = /(?:\s*[.!?。！？])+$/u;

/** toSentence ends text with exactly one period, keeping an ending ellipsis. */
export function toSentence(text) {
  const value = String(text ?? "").trim();
  if (!value) return "";
  if (/(?:…|\.\.\.)$/u.test(value)) return value;
  return `${value.replace(TRAILING_STOP, "")}.`;
}

/** joinSentences joins parts as sentences without ever producing doubled punctuation. */
export function joinSentences(...parts) {
  return parts.flat().map(toSentence).filter(Boolean).join(" ");
}

/** httpStatusOf reads an HTTP status from the failure, or from "status NNN" in its message. */
export function httpStatusOf(failure) {
  const explicit = Number(failure?.status);
  if (Number.isInteger(explicit) && explicit >= 100 && explicit <= 599) return explicit;
  const match = String(failure?.message ?? "").match(/\bstatus\s+(\d{3})\b/i);
  return match ? Number(match[1]) : null;
}

const UNAVAILABLE_CODES = new Set(["endpoint_network_error", "endpoint_timeout", "image_endpoint_network_error"]);
const PROMPT_CODES = new Set([
  "endpoint_parse_error",
  "endpoint_invalid_response",
  "pipeline_error",
  "ai_repair_no_valid_response",
  "image_endpoint_parse_error"
]);
const CONFIG_CODES = new Set(["ai_endpoint_required", "ai_model_required", "ai_api_key_required"]);

export function isCancelledFailure(failure) {
  return failure?.code === "ai_cancelled" || /cancelled by the author/i.test(String(failure?.message ?? ""));
}

/** classifyAiFailure buckets a failure by what the author should do next. */
export function classifyAiFailure(failure) {
  if (isCancelledFailure(failure)) return "cancelled";
  const code = String(failure?.code ?? "");
  if (code === "ai_session_budget") return "limit";
  const status = httpStatusOf(failure);
  if (UNAVAILABLE_CODES.has(code) || (status !== null && (status >= 500 || status === 429 || status === 408))) return "unavailable";
  if (status === 401 || status === 403 || status === 404 || CONFIG_CODES.has(code)) return "config";
  if (PROMPT_CODES.has(code) || (status !== null && status >= 400)) return "prompt";
  return failure?.message ? "prompt" : "unknown";
}

function roundNumber(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

/**
 * cancelledText says what a cancel kept: the rounds that finished before it, and that no card changed.
 * `loop` is { round, maxRounds } from the repair-loop progress, or null for a single-request draft.
 */
export function cancelledText(loop = null) {
  const round = roundNumber(loop?.round);
  const maxRounds = roundNumber(loop?.maxRounds);
  if (!maxRounds || maxRounds < 2 || !round) {
    return joinSentences("You cancelled the request before the draft was ready", "Nothing was applied and no card was changed");
  }
  const finished = round - 1;
  const kept = finished === 0
    ? "No round had finished yet"
    : finished === 1
      ? "Round 1 had finished and is kept in the repair history below"
      : `Rounds 1–${finished} had finished and are kept in the repair history below`;
  return joinSentences(`You cancelled the repair loop during round ${round} of ${maxRounds}`, kept, "No card was changed");
}

/**
 * describeAiFailure turns a failed or cancelled AI Assist run into a notice:
 * { kind, tone: "neutral" | "error", title, text, actions: ("rebuild"|"retry"|"edit"|"settings")[] }.
 * `stepLabel` names the progress step that failed; `loop` is the repair-loop progress, if any.
 */
export function describeAiFailure({ code = null, message = "", stage = null, status = null, stepLabel = null, loop = null } = {}) {
  const failure = { code, message, stage, status };
  const kind = classifyAiFailure(failure);
  if (kind === "cancelled") {
    return { kind, tone: "neutral", title: "Cancelled", text: cancelledText(loop), actions: ["rebuild", "edit"] };
  }
  const where = stepLabel ? `Failed at the ${stepLabel} step: ` : "";
  const detail = message ? `${where}${String(message).trim()}` : "";
  if (kind === "limit") {
    return { kind, tone: "error", title: "Request limit reached", text: joinSentences(message || "This Creator session reached its AI request limit", "Nothing was applied"), actions: ["settings"] };
  }
  if (kind === "unavailable") {
    const httpStatus = httpStatusOf(failure);
    const why = httpStatus === 429
      ? "The endpoint is rate-limiting requests right now"
      : code === "endpoint_timeout"
        ? "The endpoint did not answer in time"
        : "The endpoint is temporarily unavailable";
    return { kind, tone: "error", title: "Endpoint unavailable", text: joinSentences(detail, why, "This is not caused by your prompt; wait a moment and retry"), actions: ["retry"] };
  }
  if (kind === "config") {
    return { kind, tone: "error", title: "Endpoint rejected the request", text: joinSentences(detail, "Check the endpoint URL, model ID, and API key in Settings, then retry"), actions: ["settings", "retry"] };
  }
  if (kind === "prompt") {
    return { kind, tone: "error", title: "Draft failed", text: joinSentences(detail, "Edit the prompt or retry"), actions: ["retry", "edit"] };
  }
  return { kind, tone: "error", title: "Draft failed", text: joinSentences("AI Assist draft failed", "Check the status bar, edit the prompt, or retry"), actions: ["retry", "edit"] };
}

const UNSCORED_STOP_LABELS = {
  offline_single_round: "Local rule-based repair runs once; asking again would return the same proposals.",
  target_not_scored: "This issue type is not scored by the Reviewer, so proposals are shown without verification.",
  no_scored_issues: "The fixed-seed scoring review found no issue to verify against.",
  target_entity_not_scored: "The selected issue target does not appear in the fixed-seed scoring review, so proposals are shown without verification."
};

/**
 * repairStopLabel explains why the repair loop stopped, naming the rounds explicitly.
 * Accepts a live `verification` ({ stopReason, selectedRound, roundsUsed, rounds, limits, agentStop })
 * or a stored history record ({ stopReason, selectedRound, roundsUsed, rounds, maxRounds, agentStop }).
 */
export function repairStopLabel(source) {
  const stopReason = source?.stopReason ?? null;
  if (!stopReason) return "";
  if (UNSCORED_STOP_LABELS[stopReason]) return UNSCORED_STOP_LABELS[stopReason];
  const maxRounds = roundNumber(source?.limits?.maxRounds ?? source?.maxRounds);
  const used = roundNumber(source?.roundsUsed ?? (Array.isArray(source?.rounds) ? source.rounds.length : null));
  const selected = roundNumber(source?.selectedRound);
  const of = maxRounds ? ` of ${maxRounds}` : "";
  // "round 2 of 3" when the round is known; otherwise the sentence avoids naming a number.
  const inRound = (round) => (round ? ` in round ${round}${of}` : "");
  const afterRound = (round) => (round ? ` after round ${round}${of}` : "");
  const showing = selected ? `Showing round ${selected}, the best scored so far` : "Showing the best round so far";
  switch (stopReason) {
    case "verified":
      return selected
        ? `Passed in round ${selected}${of}: the first proposal that cleared every blocking check.`
        : "Passed: the loop stopped at the first proposal that cleared every blocking check.";
    case "max_rounds":
      return joinSentences(`Reached the round limit${afterRound(used)} without a proposal that cleared every blocking check`, showing);
    case "endpoint_error":
      return joinSentences(`The endpoint failed${inRound(used)}`, showing);
    case "deadline":
      return joinSentences(`Stopped at the loop deadline${afterRound(used)}`, showing);
    case "total_byte_budget":
    case "ai_repair_total_budget":
      return joinSentences(`Stopped at the total byte budget${afterRound(used)}`, showing);
    case "ai_repair_request_budget":
      return joinSentences(`Stopped${inRound(used)}: its request exceeded the byte budget`, showing);
    case "ai_repair_response_budget":
      return joinSentences(`Stopped${inRound(used)}: its response exceeded the byte budget`, showing);
    case "model_stopped":
      return joinSentences(`Stopped by the model${inRound(roundNumber(source?.agentStop?.round) ?? used)}: it reported that the targets cannot be fixed without the author`, showing);
    case "ai_cancelled":
      return joinSentences(`Cancelled by the author${inRound(used)}`, "Rounds that finished before the cancel are kept below; no card was changed");
    default:
      return String(stopReason);
  }
}
