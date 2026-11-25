import { parse, stringify } from "./toml.js";

export const CONFIG_SCHEMA_VERSION = 1;
export const PROJECT_SCHEMA_VERSION = 1;
export const WORKSPACE_SCHEMA_VERSION = 1;
export const PROJECT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/;

export function defaultConfig() {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION, theme: "github-light", locale: "system", aiAssistEnabled: false,
    activeProjectId: "", recentProjectIds: [], build: { defaultOutputDir: "Builds" },
    ai: { endpoint: "", protocol: "openai_chat", endpointPresetId: "custom", compatibilityFamily: "custom", modelId: "", routeMode: "auto", jsonMode: "auto", capabilities: ["structuredJson"], apiKey: "", image: { endpoint: "", protocol: "openai_images", modelId: "", routeMode: "auto", credentialMode: "inherit_text", capabilities: ["generate", "edit", "inpaint", "outpaint"], variant: "core", apiKey: "" } }
  };
}

export function normalizeConfig(value) {
  if (!isRecord(value)) throw contractError("Config must be a TOML table", "config_invalid");
  if (value.schemaVersion !== undefined && value.schemaVersion !== CONFIG_SCHEMA_VERSION) throw contractError(`Unsupported config schemaVersion '${value.schemaVersion}'`, "config_schema_unsupported");
  const defaults = defaultConfig();
  const build = isRecord(value.build) ? value.build : {};
  const ai = isRecord(value.ai) ? value.ai : {};
  const image = isRecord(ai.image) ? ai.image : {};
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    theme: string(value.theme, defaults.theme), locale: string(value.locale, defaults.locale),
    aiAssistEnabled: typeof value.aiAssistEnabled === "boolean" ? value.aiAssistEnabled : defaults.aiAssistEnabled,
    activeProjectId: string(value.activeProjectId, ""), recentProjectIds: stringArray(value.recentProjectIds),
    build: { defaultOutputDir: string(build.defaultOutputDir, defaults.build.defaultOutputDir) },
    ai: { endpoint: string(ai.endpoint, ""), protocol: string(ai.protocol, defaults.ai.protocol), endpointPresetId: string(ai.endpointPresetId, defaults.ai.endpointPresetId), compatibilityFamily: string(ai.compatibilityFamily, defaults.ai.compatibilityFamily), modelId: string(ai.modelId, ""), routeMode: string(ai.routeMode, defaults.ai.routeMode), jsonMode: string(ai.jsonMode, defaults.ai.jsonMode), capabilities: Array.isArray(ai.capabilities) ? ai.capabilities.filter((entry) => typeof entry === "string") : defaults.ai.capabilities, apiKey: typeof ai.apiKey === "string" ? ai.apiKey : "", image: { endpoint: string(image.endpoint, ""), protocol: string(image.protocol, defaults.ai.image.protocol), modelId: string(image.modelId, ""), routeMode: string(image.routeMode, defaults.ai.image.routeMode), credentialMode: image.credentialMode === "dedicated" ? "dedicated" : "inherit_text", capabilities: Array.isArray(image.capabilities) ? image.capabilities.filter((entry) => typeof entry === "string") : defaults.ai.image.capabilities, variant: string(image.variant, defaults.ai.image.variant), apiKey: typeof image.apiKey === "string" ? image.apiKey : "" } }
  };
}

export function mergeConfig(current, patch) {
  if (!isRecord(patch)) throw contractError("Config patch must be an object", "config_patch_invalid");
  const next = normalizeConfig({ ...current, ...patch, build: { ...current.build, ...(isRecord(patch.build) ? patch.build : {}) }, ai: { ...current.ai, ...(isRecord(patch.ai) ? patch.ai : {}), image: { ...current.ai.image, ...(isRecord(patch.ai?.image) ? patch.ai.image : {}) } } });
  if (patch.clearApiKey === true) next.ai.apiKey = "";
  if (patch.clearImageApiKey === true) next.ai.image.apiKey = "";
  return next;
}

export function projectConfig(config) {
  return { schemaVersion: config.schemaVersion, theme: config.theme, locale: config.locale, aiAssistEnabled: config.aiAssistEnabled, activeProjectId: config.activeProjectId || null, recentProjectIds: [...config.recentProjectIds], build: clone(config.build), ai: { endpoint: config.ai.endpoint, protocol: config.ai.protocol, endpointPresetId: config.ai.endpointPresetId, compatibilityFamily: config.ai.compatibilityFamily, modelId: config.ai.modelId, routeMode: config.ai.routeMode, jsonMode: config.ai.jsonMode, capabilities: [...config.ai.capabilities], hasApiKey: Boolean(config.ai.apiKey), image: { endpoint: config.ai.image.endpoint, protocol: config.ai.image.protocol, modelId: config.ai.image.modelId, routeMode: config.ai.image.routeMode, credentialMode: config.ai.image.credentialMode, capabilities: [...config.ai.image.capabilities], variant: config.ai.image.variant, hasApiKey: Boolean(config.ai.image.apiKey) } } };
}

export function defaultWorkspaceState() { return { schemaVersion: WORKSPACE_SCHEMA_VERSION, activePanel: "overview", selectedCardId: "", previewSkin: "" }; }
export function normalizeWorkspaceState(value) {
  if (!isRecord(value)) throw contractError("Workspace state must be a TOML table", "workspace_state_invalid");
  if (value.schemaVersion !== undefined && value.schemaVersion !== WORKSPACE_SCHEMA_VERSION) throw contractError(`Unsupported workspace schemaVersion '${value.schemaVersion}'`, "workspace_schema_unsupported");
  return { schemaVersion: WORKSPACE_SCHEMA_VERSION, activePanel: string(value.activePanel, "overview"), selectedCardId: string(value.selectedCardId, ""), previewSkin: string(value.previewSkin, "") };
}
export function blankBundle() { return { schemaVersion: 1, metadata: { title: "Untitled" }, cards: [], assets: [] }; }
export function serializeBundle(bundle) { return `${JSON.stringify(clone(bundle), null, 2)}\n`; }
export function parseBundle(source, id = "active") { try { const value = typeof source === "string" ? JSON.parse(source) : clone(source); if (!isRecord(value) || !Array.isArray(value.cards)) throw new Error("cards must be an array"); return value; } catch (error) { throw contractError(`Invalid content for project '${id}': ${error.message}`, "project_content_invalid"); } }
export function parseToml(source) { return parse(source); }
export function stringifyToml(value) { return stringify(value); }
export function assertProjectId(id) { if (typeof id !== "string" || !PROJECT_ID_PATTERN.test(id)) throw contractError(`Invalid project id '${id}'`, "project_id_invalid"); }
function string(value, fallback) { return typeof value === "string" ? value : fallback; }
function stringArray(value) { return Array.isArray(value) ? [...new Set(value.filter((entry) => typeof entry === "string" && PROJECT_ID_PATTERN.test(entry)))] : []; }
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function contractError(message, code) { const error = new Error(message); error.name = "WorkspaceError"; error.code = code; return error; }

// Repair history: project-local, key-free records of verified repair-loop runs.
// Stored as one JSON file per project; newest first, bounded by count and per-record size.
export const REPAIR_HISTORY_FILE = "repair-history.json";
export const REPAIR_HISTORY_SCHEMA_VERSION = 1;
// 128 KiB fits three rounds of logged conversation (each message is capped at 16 KiB by the loop).
export const REPAIR_HISTORY_LIMITS = Object.freeze({ maxRecords: 40, maxRecordBytes: 128 * 1024, conversationTrimBytes: 2 * 1024 });
export const REPAIR_HISTORY_ID_PATTERN = /^rh-[a-z0-9-]{6,64}$/;

export function emptyRepairHistory() { return { schemaVersion: REPAIR_HISTORY_SCHEMA_VERSION, records: [] }; }

export function parseRepairHistory(source) {
  if (source === null || source === undefined || source === "") return emptyRepairHistory();
  let value;
  try { value = typeof source === "string" ? JSON.parse(source) : clone(source); } catch { return emptyRepairHistory(); }
  const records = Array.isArray(value?.records) ? value.records.filter(isStoredRepairRecord) : [];
  return { schemaVersion: REPAIR_HISTORY_SCHEMA_VERSION, records: records.slice(0, REPAIR_HISTORY_LIMITS.maxRecords) };
}

export function serializeRepairHistory(history) { return `${JSON.stringify(parseRepairHistory(history))}\n`; }

export function assertRepairHistoryId(id) { if (typeof id !== "string" || !REPAIR_HISTORY_ID_PATTERN.test(id)) throw contractError(`Invalid repair history id '${id}'`, "repair_history_id_invalid"); }

/**
 * appendRepairHistory adds a record (newest first). Oversized records keep their rounds
 * summary but drop per-proposal detail and get `truncated: true`; the oldest records beyond
 * maxRecords are pruned. Returns { history, record, pruned }.
 */
export function appendRepairHistory(history, record, limits = REPAIR_HISTORY_LIMITS) {
  if (!isRecord(record)) throw contractError("Repair history record must be an object", "repair_history_record_invalid");
  assertRepairHistoryId(record.id);
  const stored = fitRepairRecord(clone(record), limits.maxRecordBytes);
  const current = parseRepairHistory(history).records.filter((entry) => entry.id !== stored.id);
  const records = [stored, ...current];
  const pruned = records.slice(limits.maxRecords).map((entry) => entry.id);
  return { history: { schemaVersion: REPAIR_HISTORY_SCHEMA_VERSION, records: records.slice(0, limits.maxRecords) }, record: stored, pruned };
}

export function updateRepairHistory(history, id, update) {
  assertRepairHistoryId(id);
  const parsed = parseRepairHistory(history);
  const index = parsed.records.findIndex((entry) => entry.id === id);
  if (index < 0) throw contractError(`Unknown repair history record '${id}'`, "repair_history_not_found");
  const next = fitRepairRecord(typeof update === "function" ? update(clone(parsed.records[index])) : { ...parsed.records[index], ...update }, REPAIR_HISTORY_LIMITS.maxRecordBytes);
  if (next.id !== id) throw contractError("Repair history record id cannot change", "repair_history_record_invalid");
  parsed.records[index] = next;
  return { history: parsed, record: next };
}

export function removeRepairHistory(history, id) {
  assertRepairHistoryId(id);
  const parsed = parseRepairHistory(history);
  const records = parsed.records.filter((entry) => entry.id !== id);
  if (records.length === parsed.records.length) throw contractError(`Unknown repair history record '${id}'`, "repair_history_not_found");
  return { history: { ...parsed, records }, removed: id };
}

/** summarizeRepairHistory is the list projection (no per-round detail). */
export function summarizeRepairHistory(history) {
  return parseRepairHistory(history).records.map((entry) => ({
    id: entry.id,
    createdAt: entry.createdAt,
    status: entry.status,
    stopReason: entry.stopReason ?? null,
    targets: Array.isArray(entry.targets) ? entry.targets.slice(0, 3) : [],
    roundsUsed: entry.roundsUsed ?? (Array.isArray(entry.rounds) ? entry.rounds.length : 0),
    maxRounds: entry.maxRounds ?? null,
    baseline: entry.baseline ?? null,
    bestScore: bestRecordScore(entry),
    outcome: entry.outcome ?? "draft",
    appliedProposalIds: Array.isArray(entry.appliedProposalIds) ? entry.appliedProposalIds : [],
    model: typeof entry.model === "string" ? entry.model : null,
    endpoint: entry.endpoint ?? null,
    // Measured model request times (ms), newest record first; used for the UI wait estimate.
    requestMs: (Array.isArray(entry.rounds) ? entry.rounds : []).map((round) => round?.requestMs).filter((value) => Number.isFinite(value) && value >= 0),
    truncated: Boolean(entry.truncated)
  }));
}

function bestRecordScore(entry) {
  const scores = (Array.isArray(entry.rounds) ? entry.rounds : []).map((round) => round?.bestScore).filter((value) => Number.isFinite(value));
  return scores.length ? Math.max(...scores) : null;
}

function fitRepairRecord(record, maxBytes) {
  if (byteLength(record) <= maxBytes) return record;
  // First shorten the conversation, then drop it, before touching the round evidence.
  if (Array.isArray(record.conversation) && record.conversation.length > 0) {
    const keep = REPAIR_HISTORY_LIMITS.conversationTrimBytes;
    const shortened = { ...record, conversationTruncated: true, conversation: record.conversation.map((entry) => ({ ...entry, requestBody: clipText(entry.requestBody, keep), responseText: clipText(entry.responseText, keep) })) };
    if (byteLength(shortened) <= maxBytes) return shortened;
    record = { ...shortened, conversation: [] };
    if (byteLength(record) <= maxBytes) return record;
  }
  const trimmed = { ...record, truncated: true, contextSelection: record.contextSelection ? { ...record.contextSelection, reasons: {} } : null };
  trimmed.rounds = (Array.isArray(record.rounds) ? record.rounds : []).map((round) => ({
    ...round,
    proposals: (Array.isArray(round.proposals) ? round.proposals : []).slice(0, 6).map((proposal) => ({
      id: proposal.id, title: String(proposal.title ?? "").slice(0, 80), passed: proposal.passed, scoreAfter: proposal.scoreAfter ?? null,
      failedChecks: Array.isArray(proposal.failedChecks) ? proposal.failedChecks.slice(0, 6) : []
    }))
  }));
  if (byteLength(trimmed) <= maxBytes) return trimmed;
  trimmed.rounds = trimmed.rounds.map((round) => ({ ...round, proposals: [] }));
  trimmed.instruction = String(trimmed.instruction ?? "").slice(0, 200);
  if (byteLength(trimmed) <= maxBytes) return trimmed;
  throw contractError("Repair history record exceeds the size limit", "repair_history_record_too_large");
}

function clipText(value, maxChars) {
  const text = String(value ?? "");
  return text.length > maxChars ? `${text.slice(0, maxChars)}… [trimmed to fit the history size limit]` : text;
}

function isStoredRepairRecord(value) { return isRecord(value) && typeof value.id === "string" && REPAIR_HISTORY_ID_PATTERN.test(value.id) && typeof value.createdAt === "string"; }
function byteLength(value) { return new TextEncoder().encode(JSON.stringify(value)).length; }
