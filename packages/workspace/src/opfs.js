import {
  PROJECT_SCHEMA_VERSION, assertProjectId, blankBundle, defaultConfig, defaultWorkspaceState,
  mergeConfig, normalizeConfig, normalizeWorkspaceState, parseBundle, parseToml, projectConfig,
  serializeBundle, stringifyToml
} from "./contracts.js";

export async function createOpfsWorkspaceStore({ rootName = "ReignsAgentData", initialBundle = null, storageManager = globalThis.navigator?.storage } = {}) {
  if (!storageManager?.getDirectory) throw workspaceError("Origin private file system is unavailable", "opfs_unavailable");
  const root = await storageManager.getDirectory();
  const dataRoot = await root.getDirectoryHandle(rootName, { create: true });
  const store = new OpfsWorkspaceStore({ dataRoot, initialBundle, storageManager });
  await store.initialize();
  return store;
}

class OpfsWorkspaceStore {
  #queue = Promise.resolve();
  constructor({ dataRoot, initialBundle, storageManager }) { this.root = dataRoot; this.initialBundle = initialBundle; this.storageManager = storageManager; this.config = null; }
  async initialize() {
    await this.root.getDirectoryHandle("projects", { create: true });
    this.config = await this.#readConfig();
    const projects = await this.listProjects();
    if (!projects.length) await this.createProject({ bundle: this.initialBundle ?? blankBundle(), source: this.initialBundle ? "sample" : "blank" });
    else if (!projects.some((entry) => entry.id === this.config.activeProjectId)) await this.openProject(projects[0].id);
    return this;
  }
  async getStorageStatus() {
    const estimate = await this.storageManager.estimate?.().catch(() => null);
    const persisted = await this.storageManager.persisted?.().catch(() => false);
    return { supported: true, persisted: Boolean(persisted), usage: estimate?.usage ?? null, quota: estimate?.quota ?? null };
  }
  async requestPersistence() { const persisted = await this.storageManager.persist?.().catch(() => false); return { ...(await this.getStorageStatus()), persisted: Boolean(persisted) }; }
  async getConfig() { await this.#settled(); return projectConfig(this.config); }
  async getRawConfig({ includeApiKey = false } = {}) { await this.#settled(); const value = clone(this.config); if (!includeApiKey) value.ai.apiKey = ""; return value; }
  async getStoredApiKey() { await this.#settled(); return this.config.ai.apiKey || null; }
  async updateConfig(patch = {}) { return this.#enqueue(async () => { const next = mergeConfig(this.config, patch); await writeText(this.root, ["config.toml"], stringifyToml(next)); this.config = next; return projectConfig(next); }); }
  async listProjects() {
    await this.#settled(); const dir = await this.root.getDirectoryHandle("projects", { create: true }); const result = [];
    for await (const [id, handle] of dir.entries()) { if (handle.kind !== "directory") continue; try { result.push(await this.#readProject(id)); } catch { /* malformed directories stay recoverable through OPFS tools */ } }
    return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async createProject({ bundle = blankBundle(), source = "blank" } = {}) { return this.#enqueue(async () => { const id = crypto.randomUUID(); const now = new Date().toISOString(); const dir = await this.#projectDir(id, true); await Promise.all(["assets", "reviews", "builds"].map((name) => dir.getDirectoryHandle(name, { create: true }))); await writeText(dir, ["project.toml"], stringifyToml({ schemaVersion: PROJECT_SCHEMA_VERSION, id, source, createdAt: now, updatedAt: now, contentPath: "content.json" })); await writeText(dir, ["content.json"], serializeBundle(bundle)); await writeText(dir, ["workspace.toml"], stringifyToml(defaultWorkspaceState())); await this.#select(id); return this.#readProject(id); }); }
  async openProject(id) { assertProjectId(id); return this.#enqueue(async () => { const project = await this.#readProject(id); await this.#select(id); return project; }); }
  async readActiveBundle() { await this.#settled(); return parseBundle(await readText(await this.#projectDir(this.#active()), ["content.json"]), this.#active()); }
  async saveActiveBundle(bundle) { return this.#enqueue(async () => { const id = this.#active(); const dir = await this.#projectDir(id); await writeText(dir, ["content.json"], serializeBundle(bundle)); const manifest = await this.#manifest(id); manifest.updatedAt = new Date().toISOString(); await writeText(dir, ["project.toml"], stringifyToml(manifest)); return this.#readProject(id); }); }
  async getWorkspaceState() { await this.#settled(); return normalizeWorkspaceState(parseToml(await readText(await this.#projectDir(this.#active()), ["workspace.toml"]))); }
  async updateWorkspaceState(patch = {}) { return this.#enqueue(async () => { const dir = await this.#projectDir(this.#active()); const next = normalizeWorkspaceState({ ...parseToml(await readText(dir, ["workspace.toml"])), ...clone(patch) }); await writeText(dir, ["workspace.toml"], stringifyToml(next)); return clone(next); }); }
  async deleteProject(id) { assertProjectId(id); return this.#enqueue(async () => { const projects = await this.root.getDirectoryHandle("projects"); await projects.removeEntry(id, { recursive: true }); const remaining = await this.#listUnsafe(); if (!remaining.length) { const project = await this.#createUnsafe({ bundle: blankBundle(), source: "blank" }); return { deleted: true, activeProjectId: project.id }; } if (this.config.activeProjectId === id) await this.#select(remaining[0].id); return { deleted: true, activeProjectId: this.config.activeProjectId }; }); }
  async exportSnapshot({ includeApiKey = false } = {}) { await this.#settled(); const projects = []; for (const project of await this.listProjects()) { const dir = await this.#projectDir(project.id); projects.push({ manifest: await this.#manifest(project.id), content: parseBundle(await readText(dir, ["content.json"]), project.id), workspace: normalizeWorkspaceState(parseToml(await readText(dir, ["workspace.toml"]))) }); } return { schemaVersion: 1, exportedAt: new Date().toISOString(), config: await this.getRawConfig({ includeApiKey }), projects }; }
  async importSnapshot(snapshot, { replace = false } = {}) { if (snapshot?.schemaVersion !== 1 || !Array.isArray(snapshot.projects)) throw workspaceError("Invalid workspace backup", "workspace_backup_invalid"); const validated = snapshot.projects.map((entry) => ({ ...entry, content: parseBundle(entry.content, entry.manifest?.id), workspace: normalizeWorkspaceState(entry.workspace ?? {}) })); if (replace) { const projects = await this.root.getDirectoryHandle("projects"); for await (const [name] of projects.entries()) await projects.removeEntry(name, { recursive: true }); } for (const entry of validated) await this.createProject({ bundle: entry.content, source: entry.manifest?.source ?? "import" }); if (snapshot.config) await this.updateConfig(snapshot.config); return { imported: validated.length, projects: await this.listProjects() }; }
  async #readConfig() { try { return normalizeConfig(parseToml(await readText(this.root, ["config.toml"]))); } catch (error) { if (error?.name !== "NotFoundError") throw error; const value = defaultConfig(); await writeText(this.root, ["config.toml"], stringifyToml(value)); return value; } }
  async #readProject(id) { const manifest = await this.#manifest(id); const bundle = parseBundle(await readText(await this.#projectDir(id), ["content.json"]), id); return { id, title: bundle.metadata?.title || "Untitled", source: manifest.source, createdAt: manifest.createdAt, updatedAt: manifest.updatedAt, active: id === this.config.activeProjectId }; }
  async #manifest(id) { assertProjectId(id); const value = parseToml(await readText(await this.#projectDir(id), ["project.toml"])); if (value.schemaVersion !== PROJECT_SCHEMA_VERSION || value.id !== id || value.contentPath !== "content.json") throw workspaceError(`Invalid project manifest '${id}'`, "project_manifest_invalid"); return value; }
  async #projectDir(id, create = false) { assertProjectId(id); return (await this.root.getDirectoryHandle("projects", { create: true })).getDirectoryHandle(id, { create }); }
  async #select(id) { this.config = normalizeConfig({ ...this.config, activeProjectId: id, recentProjectIds: [id, ...this.config.recentProjectIds.filter((entry) => entry !== id)].slice(0, 12) }); await writeText(this.root, ["config.toml"], stringifyToml(this.config)); }
  async #listUnsafe() { const dir = await this.root.getDirectoryHandle("projects"); const result = []; for await (const [id, handle] of dir.entries()) if (handle.kind === "directory") result.push(await this.#readProject(id)); return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  async #createUnsafe({ bundle, source }) { const id = crypto.randomUUID(); const now = new Date().toISOString(); const dir = await this.#projectDir(id, true); await Promise.all(["assets", "reviews", "builds"].map((name) => dir.getDirectoryHandle(name, { create: true }))); await writeText(dir, ["project.toml"], stringifyToml({ schemaVersion: 1, id, source, createdAt: now, updatedAt: now, contentPath: "content.json" })); await writeText(dir, ["content.json"], serializeBundle(bundle)); await writeText(dir, ["workspace.toml"], stringifyToml(defaultWorkspaceState())); await this.#select(id); return this.#readProject(id); }
  #active() { if (!this.config.activeProjectId) throw workspaceError("No active project", "active_project_missing"); return this.config.activeProjectId; }
  #enqueue(operation) { const result = this.#queue.then(operation); this.#queue = result.catch(() => {}); return result; }
  #settled() { return this.#queue; }
}

async function readText(root, parts) { let dir = root; for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part); return (await (await dir.getFileHandle(parts.at(-1))).getFile()).text(); }
async function writeText(root, parts, contents) { let dir = root; for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true }); const file = await dir.getFileHandle(parts.at(-1), { create: true }); const writer = await file.createWritable(); try { await writer.write(contents); await writer.close(); } catch (error) { await writer.abort().catch(() => {}); throw error; } }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function workspaceError(message, code) { const error = new Error(message); error.name = "WorkspaceError"; error.code = code; return error; }
