import { parse, stringify } from "./toml.js";

export const CONFIG_SCHEMA_VERSION = 1;
export const PROJECT_SCHEMA_VERSION = 1;
export const WORKSPACE_SCHEMA_VERSION = 1;
export const PROJECT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/;

export function defaultConfig() {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION, theme: "github-light", locale: "system", aiAssistEnabled: false,
    activeProjectId: "", recentProjectIds: [], build: { defaultOutputDir: "Builds" },
    ai: { endpoint: "", protocol: "openai_chat", endpointPresetId: "custom", compatibilityFamily: "custom", modelId: "", routeMode: "auto", jsonMode: "auto", capabilities: ["structuredJson"], apiKey: "" }
  };
}

export function normalizeConfig(value) {
  if (!isRecord(value)) throw contractError("Config must be a TOML table", "config_invalid");
  if (value.schemaVersion !== undefined && value.schemaVersion !== CONFIG_SCHEMA_VERSION) throw contractError(`Unsupported config schemaVersion '${value.schemaVersion}'`, "config_schema_unsupported");
  const defaults = defaultConfig();
  const build = isRecord(value.build) ? value.build : {};
  const ai = isRecord(value.ai) ? value.ai : {};
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    theme: string(value.theme, defaults.theme), locale: string(value.locale, defaults.locale),
    aiAssistEnabled: typeof value.aiAssistEnabled === "boolean" ? value.aiAssistEnabled : defaults.aiAssistEnabled,
    activeProjectId: string(value.activeProjectId, ""), recentProjectIds: stringArray(value.recentProjectIds),
    build: { defaultOutputDir: string(build.defaultOutputDir, defaults.build.defaultOutputDir) },
    ai: { endpoint: string(ai.endpoint, ""), protocol: string(ai.protocol, defaults.ai.protocol), endpointPresetId: string(ai.endpointPresetId, defaults.ai.endpointPresetId), compatibilityFamily: string(ai.compatibilityFamily, defaults.ai.compatibilityFamily), modelId: string(ai.modelId, ""), routeMode: string(ai.routeMode, defaults.ai.routeMode), jsonMode: string(ai.jsonMode, defaults.ai.jsonMode), capabilities: Array.isArray(ai.capabilities) ? ai.capabilities.filter((entry) => typeof entry === "string") : defaults.ai.capabilities, apiKey: typeof ai.apiKey === "string" ? ai.apiKey : "" }
  };
}

export function mergeConfig(current, patch) {
  if (!isRecord(patch)) throw contractError("Config patch must be an object", "config_patch_invalid");
  const next = normalizeConfig({ ...current, ...patch, build: { ...current.build, ...(isRecord(patch.build) ? patch.build : {}) }, ai: { ...current.ai, ...(isRecord(patch.ai) ? patch.ai : {}) } });
  if (patch.clearApiKey === true) next.ai.apiKey = "";
  return next;
}

export function projectConfig(config) {
  return { schemaVersion: config.schemaVersion, theme: config.theme, locale: config.locale, aiAssistEnabled: config.aiAssistEnabled, activeProjectId: config.activeProjectId || null, recentProjectIds: [...config.recentProjectIds], build: clone(config.build), ai: { endpoint: config.ai.endpoint, protocol: config.ai.protocol, endpointPresetId: config.ai.endpointPresetId, compatibilityFamily: config.ai.compatibilityFamily, modelId: config.ai.modelId, routeMode: config.ai.routeMode, jsonMode: config.ai.jsonMode, capabilities: [...config.ai.capabilities], hasApiKey: Boolean(config.ai.apiKey) } };
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
