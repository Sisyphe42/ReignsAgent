import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import { parse, stringify } from "./toml.js";
import {
  PROJECT_SCHEMA_VERSION, PROJECT_ID_PATTERN, assertProjectId, blankBundle, defaultConfig,
  defaultWorkspaceState, mergeConfig, normalizeConfig, normalizeWorkspaceState, parseBundle,
  projectConfig, serializeBundle
} from "./contracts.js";
import { createReleaseRecord, normalizeArtifactRelativePath, normalizeReleaseRecord, WINDOWS_RELEASE_TARGET } from "./release-contracts.js";

export { createReleaseRecord, normalizeReleaseRecord, WINDOWS_RELEASE_TARGET };

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

  async getActiveProject() {
    await this.#settled();
    return this.#readProject(this.#activeProjectId());
  }

  async getReleaseOutput({ fileName }) {
    await this.#settled();
    const projectId = this.#activeProjectId();
    const safeFileName = normalizeReleaseFileName(fileName);
    const artifactRelativePath = `${projectId}/${safeFileName}`;
    const artifactPath = this.#resolveBuildArtifact(artifactRelativePath, projectId);
    return { projectId, artifactRelativePath, artifactPath };
  }

  async readActiveProjectAsset(uri) {
    await this.#settled();
    const normalized = normalizeProjectAssetUri(uri);
    const projectRoot = this.#projectRoot(this.#activeProjectId());
    const assetPath = resolve(projectRoot, ...normalized.split("/"));
    const relativePath = relative(projectRoot, assetPath);
    if (relativePath.startsWith("..") || relativePath === "" || assetPath.includes("\0")) {
      throw new WorkspaceError("Project asset path escapes its project", "project_asset_path_invalid");
    }
    try {
      return await readFile(assetPath);
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  async listReleases() {
    await this.#settled();
    return this.#listReleasesForProject(this.#activeProjectId());
  }

  async saveRelease(record) {
    return this.#enqueue(async () => {
      const projectId = this.#activeProjectId();
      const normalized = normalizeReleaseRecord(record, projectId);
      this.#resolveBuildArtifact(normalized.artifactRelativePath, projectId);
      const artifact = await stat(this.#resolveBuildArtifact(normalized.artifactRelativePath, projectId));
      if (!artifact.isFile() || artifact.size !== normalized.size) {
        throw new WorkspaceError("Release artifact does not match its record", "release_artifact_mismatch");
      }
      await assertArtifactHash(this.#resolveBuildArtifact(normalized.artifactRelativePath, projectId), normalized.sha256);
      await atomicWrite(this.#releaseRecordPath(projectId, normalized.id), `${JSON.stringify(normalized, null, 2)}\n`);
      return normalized;
    });
  }

  async resolveReleaseArtifact(releaseId) {
    await this.#settled();
    const projectId = this.#activeProjectId();
    const record = await this.#readRelease(projectId, releaseId);
    const artifactPath = this.#resolveBuildArtifact(record.artifactRelativePath, projectId);
    const artifact = await stat(artifactPath).catch((error) => {
      if (error?.code === "ENOENT") throw new WorkspaceError("Release artifact is missing", "release_artifact_missing");
      throw error;
    });
    if (!artifact.isFile() || artifact.size !== record.size) {
      throw new WorkspaceError("Release artifact does not match its record", "release_artifact_mismatch");
    }
    await assertArtifactHash(artifactPath, record.sha256);
    return { record, artifactPath };
  }

  async deleteRelease(releaseId) {
    return this.#enqueue(async () => {
      const projectId = this.#activeProjectId();
      const record = await this.#readRelease(projectId, releaseId);
      const artifactPath = this.#resolveBuildArtifact(record.artifactRelativePath, projectId);
      await rm(artifactPath, { force: true });
      await rm(this.#releaseRecordPath(projectId, record.id), { force: false });
      return { deleted: true, id: record.id };
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

  async #listReleasesForProject(projectId) {
    const releasesRoot = join(this.#projectRoot(projectId), "builds");
    const entries = await readdir(releasesRoot, { withFileTypes: true });
    const releases = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const releaseId = entry.name.slice(0, -5);
      try {
        releases.push(await this.#readRelease(projectId, releaseId));
      } catch (error) {
        if (error instanceof WorkspaceError) throw error;
        throw new WorkspaceError(`Could not read release '${releaseId}': ${error.message}`, "release_read_failed");
      }
    }
    return releases.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async #readRelease(projectId, releaseId) {
    assertReleaseId(releaseId);
    let value;
    try {
      value = JSON.parse(await readFile(this.#releaseRecordPath(projectId, releaseId), "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") throw new WorkspaceError(`Unknown release '${releaseId}'`, "release_not_found");
      throw new WorkspaceError(`Could not parse release '${releaseId}': ${error.message}`, "release_record_invalid");
    }
    try {
      const record = normalizeReleaseRecord(value, projectId);
      if (record.id !== releaseId) throw new Error("Release id does not match its file name");
      this.#resolveBuildArtifact(record.artifactRelativePath, projectId);
      return record;
    } catch (error) {
      throw new WorkspaceError(`Invalid release '${releaseId}': ${error.message}`, error.code ?? "release_record_invalid");
    }
  }

  #releaseRecordPath(projectId, releaseId) {
    assertReleaseId(releaseId);
    return join(this.#projectRoot(projectId), "builds", `${releaseId}.json`);
  }

  #resolveBuildArtifact(artifactRelativePath, projectId) {
    const normalized = normalizeArtifactRelativePath(artifactRelativePath);
    if (!normalized.startsWith(`${projectId}/`)) {
      throw new WorkspaceError("Release artifact is outside its project output", "release_project_mismatch");
    }
    const buildsRoot = resolve(this.dataRoot, "Builds");
    const artifactPath = resolve(buildsRoot, ...normalized.split("/"));
    const relativePath = relative(buildsRoot, artifactPath);
    if (relativePath.startsWith("..") || relativePath === "" || artifactPath.includes("\0")) {
      throw new WorkspaceError("Release artifact path escapes Builds", "release_artifact_path_invalid");
    }
    return artifactPath;
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

function normalizeString(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

function normalizeReleaseFileName(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,191}\.exe$/.test(value)) {
    throw new WorkspaceError("Release file name is invalid", "release_file_name_invalid");
  }
  return value;
}

function assertReleaseId(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/.test(value)) {
    throw new WorkspaceError("Release id is invalid", "release_id_invalid");
  }
}

function normalizeProjectAssetUri(value) {
  if (typeof value !== "string" || !value.startsWith("assets/") || value.includes("\\") || value.includes("\0")) {
    throw new WorkspaceError("Project asset path is invalid", "project_asset_path_invalid");
  }
  const parts = value.split("/");
  if (parts.some((part) => {
    const stem = part.split(".")[0].toUpperCase();
    return part === "" || part === "." || part === ".." || /[<>:"|?*\u0000-\u001f]/.test(part)
      || /[. ]$/.test(part) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem);
  })) {
    throw new WorkspaceError("Project asset path is invalid", "project_asset_path_invalid");
  }
  return parts.join("/");
}

async function assertArtifactHash(path, expected) {
  const actual = createHash("sha256").update(await readFile(path)).digest("hex");
  if (actual !== expected) throw new WorkspaceError("Release artifact hash does not match its record", "release_artifact_mismatch");
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
