import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { parse, stringify } from "./toml.js";

const CONFIG_SCHEMA_VERSION = 1;
const PROJECT_SCHEMA_VERSION = 1;
const WORKSPACE_SCHEMA_VERSION = 1;
const PROJECT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/;

export class WorkspaceError extends Error {
  constructor(message, code = "workspace_error") {
    super(message);
    this.name = "WorkspaceError";
    this.code = code;
  }
}

export async function createWorkspaceStore(options = {}) {
  if (!options.dataRoot) throw new WorkspaceError("Workspace dataRoot is required", "data_root_required");
  const store = new WorkspaceStore(options);
  await store.initialize();
  return store;
}

class WorkspaceStore {
  #writeQueue = Promise.resolve();

  constructor({ dataRoot, initialBundle = null }) {
    this.dataRoot = resolve(dataRoot);
    this.projectsRoot = join(this.dataRoot, "projects");
    this.configPath = join(this.dataRoot, "config.toml");
    this.initialBundle = initialBundle ? cloneJson(initialBundle, "Initial bundle") : null;
    this.config = defaultConfig();
  }

  async initialize() {
    await mkdir(this.projectsRoot, { recursive: true });
    await mkdir(join(this.dataRoot, "Builds"), { recursive: true });
    this.config = await this.#readConfig();
    const projects = await this.listProjects();
    if (projects.length === 0) {
      await this.createProject({
        bundle: this.initialBundle ?? blankBundle(),
        source: this.initialBundle ? "sample" : "blank"
      });
    } else if (!projects.some((project) => project.id === this.config.activeProjectId)) {
      await this.openProject(projects[0].id);
    }
    return this;
  }

  getPaths() {
    return {
      dataRoot: this.dataRoot,
      configPath: this.configPath,
      projectsRoot: this.projectsRoot,
      buildsRoot: join(this.dataRoot, "Builds")
    };
  }

  async getConfig() {
    await this.#settled();
    return projectConfig(this.config);
  }

  async getStoredApiKey() {
    await this.#settled();
    return this.config.ai.apiKey || null;
  }

  async updateConfig(patch = {}) {
    return this.#enqueue(async () => {
      const next = mergeConfig(this.config, patch);
      await atomicWrite(this.configPath, stringify(next));
      this.config = next;
      return projectConfig(next);
    });
  }

  async listProjects() {
    await this.#settled();
    const entries = await readdir(this.projectsRoot, { withFileTypes: true });
    const projects = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !PROJECT_ID_PATTERN.test(entry.name)) continue;
      try {
        projects.push(await this.#readProject(entry.name));
      } catch (error) {
        if (error instanceof WorkspaceError) throw error;
        throw new WorkspaceError(`Could not read project '${entry.name}': ${error.message}`, "project_read_failed");
      }
    }
    return projects.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async createProject({ bundle = blankBundle(), source = "blank" } = {}) {
    return this.#enqueue(async () => {
      const id = randomUUID();
      const projectRoot = this.#projectRoot(id);
      const now = new Date().toISOString();
      const manifest = {
        schemaVersion: PROJECT_SCHEMA_VERSION,
        id,
        source: normalizeString(source, "blank"),
        createdAt: now,
        updatedAt: now,
        contentPath: "content.json"
      };
      await mkdir(join(projectRoot, "assets"), { recursive: true });
      await mkdir(join(projectRoot, "reviews"), { recursive: true });
      await mkdir(join(projectRoot, "builds"), { recursive: true });
      await atomicWrite(join(projectRoot, "project.toml"), stringify(manifest));
      await atomicWrite(join(projectRoot, "content.json"), serializeBundle(bundle));
      await atomicWrite(join(projectRoot, "workspace.toml"), stringify(defaultWorkspaceState()));
      await this.#selectProject(id);
      return this.#readProject(id);
    });
  }

  async openProject(id) {
    assertProjectId(id);
    return this.#enqueue(async () => {
      const project = await this.#readProject(id);
      await this.#selectProject(id);
      return project;
    });
  }

  async readActiveBundle() {
    await this.#settled();
    const id = this.#activeProjectId();
    return parseBundle(await readFile(join(this.#projectRoot(id), "content.json"), "utf8"), id);
  }

  async saveActiveBundle(bundle) {
    return this.#enqueue(async () => {
      const id = this.#activeProjectId();
      const projectRoot = this.#projectRoot(id);
      await atomicWrite(join(projectRoot, "content.json"), serializeBundle(bundle));
      const manifest = await this.#readManifest(id);
      manifest.updatedAt = new Date().toISOString();
      await atomicWrite(join(projectRoot, "project.toml"), stringify(manifest));
      return this.#readProject(id);
    });
  }

  async getWorkspaceState() {
    await this.#settled();
    const id = this.#activeProjectId();
    return normalizeWorkspaceState(await readToml(join(this.#projectRoot(id), "workspace.toml"), "workspace state"));
  }

  async updateWorkspaceState(patch = {}) {
    return this.#enqueue(async () => {
      const id = this.#activeProjectId();
      const path = join(this.#projectRoot(id), "workspace.toml");
      const current = normalizeWorkspaceState(await readToml(path, "workspace state"));
      const next = normalizeWorkspaceState({ ...current, ...cloneJson(patch, "Workspace patch") });
      await atomicWrite(path, stringify(next));
      return cloneJson(next, "Workspace state");
    });
  }

  async deleteProject(id) {
    assertProjectId(id);
    return this.#enqueue(async () => {
      await access(join(this.#projectRoot(id), "project.toml"));
      await rm(this.#projectRoot(id), { recursive: true, force: false });
      const remaining = await this.#listProjectsUnsafe();
      if (remaining.length === 0) {
        return this.#createBlankAfterDelete();
      }
      if (this.config.activeProjectId === id) await this.#selectProject(remaining[0].id);
      return { deleted: true, activeProjectId: this.config.activeProjectId };
    });
  }

  async #createBlankAfterDelete() {
    const id = randomUUID();
    const projectRoot = this.#projectRoot(id);
    const now = new Date().toISOString();
    await mkdir(join(projectRoot, "assets"), { recursive: true });
    await mkdir(join(projectRoot, "reviews"), { recursive: true });
    await mkdir(join(projectRoot, "builds"), { recursive: true });
    await atomicWrite(join(projectRoot, "project.toml"), stringify({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id,
      source: "blank",
      createdAt: now,
      updatedAt: now,
      contentPath: "content.json"
    }));
    await atomicWrite(join(projectRoot, "content.json"), serializeBundle(blankBundle()));
    await atomicWrite(join(projectRoot, "workspace.toml"), stringify(defaultWorkspaceState()));
    await this.#selectProject(id);
    return { deleted: true, activeProjectId: id };
  }

  async #readConfig() {
    if (!await exists(this.configPath)) {
      const config = defaultConfig();
      await atomicWrite(this.configPath, stringify(config));
      return config;
    }
    return normalizeConfig(await readToml(this.configPath, "config"));
  }

  async #readProject(id) {
    const manifest = await this.#readManifest(id);
    const bundle = parseBundle(await readFile(join(this.#projectRoot(id), manifest.contentPath), "utf8"), id);
    return {
      id,
      title: normalizeString(bundle.metadata?.title, "Untitled"),
      source: manifest.source,
      createdAt: manifest.createdAt,
      updatedAt: manifest.updatedAt,
      active: id === this.config.activeProjectId
    };
  }

  async #readManifest(id) {
    assertProjectId(id);
    const path = join(this.#projectRoot(id), "project.toml");
    const value = await readToml(path, `project '${id}' manifest`);
    if (value.schemaVersion !== PROJECT_SCHEMA_VERSION || value.id !== id || value.contentPath !== "content.json") {
      throw new WorkspaceError(`Invalid project manifest '${path}'`, "project_manifest_invalid");
    }
    return {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id,
      source: normalizeString(value.source, "unknown"),
      createdAt: normalizeString(value.createdAt, new Date(0).toISOString()),
      updatedAt: normalizeString(value.updatedAt, new Date(0).toISOString()),
      contentPath: "content.json"
    };
  }

  async #selectProject(id) {
    this.config = normalizeConfig({
      ...this.config,
      activeProjectId: id,
      recentProjectIds: [id, ...this.config.recentProjectIds.filter((entry) => entry !== id)].slice(0, 12)
    });
    await atomicWrite(this.configPath, stringify(this.config));
  }

  async #listProjectsUnsafe() {
    const entries = await readdir(this.projectsRoot, { withFileTypes: true });
    const projects = [];
    for (const entry of entries) {
      if (entry.isDirectory() && PROJECT_ID_PATTERN.test(entry.name)) projects.push(await this.#readProject(entry.name));
    }
    return projects.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  #activeProjectId() {
    if (!this.config.activeProjectId) throw new WorkspaceError("No active project", "active_project_missing");
    return this.config.activeProjectId;
  }

  #projectRoot(id) {
    assertProjectId(id);
    return join(this.projectsRoot, id);
  }

  #enqueue(operation) {
    const result = this.#writeQueue.then(operation);
    this.#writeQueue = result.catch(() => {});
    return result;
  }

  #settled() {
    return this.#writeQueue;
  }
}

function defaultConfig() {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    theme: "github-light",
    locale: "en",
    aiAssistEnabled: false,
    activeProjectId: "",
    recentProjectIds: [],
    build: { defaultOutputDir: "Builds" },
    ai: {
      endpoint: "",
      protocol: "openai_chat",
      endpointPresetId: "custom",
      compatibilityFamily: "custom",
      modelId: "",
      routeMode: "auto",
      jsonMode: "auto",
      capabilities: ["structuredJson"],
      apiKey: ""
    }
  };
}

function normalizeConfig(value) {
  if (!isRecord(value)) throw new WorkspaceError("Config must be a TOML table", "config_invalid");
  if (value.schemaVersion !== undefined && value.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    throw new WorkspaceError(`Unsupported config schemaVersion '${value.schemaVersion}'`, "config_schema_unsupported");
  }
  const defaults = defaultConfig();
  const build = isRecord(value.build) ? value.build : {};
  const ai = isRecord(value.ai) ? value.ai : {};
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    theme: normalizeString(value.theme, defaults.theme),
    locale: normalizeString(value.locale, defaults.locale),
    aiAssistEnabled: typeof value.aiAssistEnabled === "boolean" ? value.aiAssistEnabled : defaults.aiAssistEnabled,
    activeProjectId: normalizeString(value.activeProjectId, ""),
    recentProjectIds: normalizeStringArray(value.recentProjectIds),
    build: { defaultOutputDir: normalizeString(build.defaultOutputDir, defaults.build.defaultOutputDir) },
    ai: {
      endpoint: normalizeString(ai.endpoint, ""),
      protocol: normalizeString(ai.protocol, defaults.ai.protocol),
      endpointPresetId: normalizeString(ai.endpointPresetId, defaults.ai.endpointPresetId),
      compatibilityFamily: normalizeString(ai.compatibilityFamily, defaults.ai.compatibilityFamily),
      modelId: normalizeString(ai.modelId, ""),
      routeMode: normalizeString(ai.routeMode, defaults.ai.routeMode),
      jsonMode: normalizeString(ai.jsonMode, defaults.ai.jsonMode),
      capabilities: Array.isArray(ai.capabilities) ? ai.capabilities.filter((entry) => typeof entry === "string") : defaults.ai.capabilities,
      apiKey: typeof ai.apiKey === "string" ? ai.apiKey : ""
    }
  };
}

function mergeConfig(current, patch) {
  if (!isRecord(patch)) throw new WorkspaceError("Config patch must be an object", "config_patch_invalid");
  const aiPatch = isRecord(patch.ai) ? patch.ai : {};
  const buildPatch = isRecord(patch.build) ? patch.build : {};
  const next = normalizeConfig({
    ...current,
    ...patch,
    build: { ...current.build, ...buildPatch },
    ai: { ...current.ai, ...aiPatch }
  });
  if (patch.clearApiKey === true) next.ai.apiKey = "";
  return next;
}

function projectConfig(config) {
  return {
    schemaVersion: config.schemaVersion,
    theme: config.theme,
    locale: config.locale,
    aiAssistEnabled: config.aiAssistEnabled,
    activeProjectId: config.activeProjectId || null,
    recentProjectIds: [...config.recentProjectIds],
    build: cloneJson(config.build, "Build config"),
    ai: {
      endpoint: config.ai.endpoint,
      protocol: config.ai.protocol,
      endpointPresetId: config.ai.endpointPresetId,
      compatibilityFamily: config.ai.compatibilityFamily,
      modelId: config.ai.modelId,
      routeMode: config.ai.routeMode,
      jsonMode: config.ai.jsonMode,
      capabilities: [...config.ai.capabilities],
      hasApiKey: Boolean(config.ai.apiKey)
    }
  };
}

function defaultWorkspaceState() {
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    activePanel: "overview",
    selectedCardId: "",
    previewSkin: ""
  };
}

function normalizeWorkspaceState(value) {
  if (!isRecord(value)) throw new WorkspaceError("Workspace state must be a TOML table", "workspace_state_invalid");
  if (value.schemaVersion !== undefined && value.schemaVersion !== WORKSPACE_SCHEMA_VERSION) {
    throw new WorkspaceError(`Unsupported workspace schemaVersion '${value.schemaVersion}'`, "workspace_schema_unsupported");
  }
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    activePanel: normalizeString(value.activePanel, "overview"),
    selectedCardId: normalizeString(value.selectedCardId, ""),
    previewSkin: normalizeString(value.previewSkin, "")
  };
}

function blankBundle() {
  return { schemaVersion: 1, metadata: { title: "Untitled" }, cards: [], assets: [] };
}

function serializeBundle(bundle) {
  return `${JSON.stringify(cloneJson(bundle, "Content bundle"), null, 2)}\n`;
}

function parseBundle(source, id) {
  try {
    const bundle = JSON.parse(source);
    if (!isRecord(bundle) || !Array.isArray(bundle.cards)) throw new Error("cards must be an array");
    return cloneJson(bundle, `Project '${id}' content`);
  } catch (error) {
    throw new WorkspaceError(`Invalid content for project '${id}': ${error.message}`, "project_content_invalid");
  }
}

async function readToml(path, label) {
  try {
    return parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof WorkspaceError) throw error;
    throw new WorkspaceError(`Could not parse ${label} at '${path}': ${error.message}`, "toml_parse_failed");
  }
}

let temporarySequence = 0;
async function atomicWrite(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  temporarySequence += 1;
  const temporaryPath = `${path}.${process.pid}.${temporarySequence}.tmp`;
  try {
    await writeFile(temporaryPath, contents, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function assertProjectId(id) {
  if (typeof id !== "string" || !PROJECT_ID_PATTERN.test(id)) {
    throw new WorkspaceError(`Invalid project id '${id}'`, "project_id_invalid");
  }
}

function normalizeString(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry) => typeof entry === "string" && PROJECT_ID_PATTERN.test(entry)))];
}

function cloneJson(value, label) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    throw new WorkspaceError(`${label} must be JSON-safe: ${error.message}`, "json_invalid");
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
