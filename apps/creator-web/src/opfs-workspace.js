import {
  PROJECT_SCHEMA_VERSION, assertProjectId, blankBundle, defaultConfig, defaultWorkspaceState,
  mergeConfig, normalizeConfig, normalizeWorkspaceState, parseBundle, parseToml, projectConfig,
  serializeBundle, stringifyToml
} from "../../../packages/workspace/src/contracts.js";

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
  async getRawConfig({ includeApiKey = false } = {}) { await this.#settled(); const value = clone(this.config); if (!includeApiKey) { delete value.ai.apiKey; delete value.ai.image.apiKey; } return value; }
  async getStoredApiKey() { await this.#settled(); return this.config.ai.apiKey || null; }
  async getStoredImageApiKey() { await this.#settled(); return this.config.ai.image.credentialMode === "inherit_text" ? this.config.ai.apiKey || null : this.config.ai.image.apiKey || null; }
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
  async readActiveProjectAsset(uri) { await this.#settled(); const parts = normalizeAssetUri(uri).split("/"); try { const file = await readFileHandle(await this.#projectDir(this.#active()), parts); return new Uint8Array(await (await file.getFile()).arrayBuffer()); } catch (error) { if (error?.name === "NotFoundError") return null; throw error; } }
  async stageActiveProjectAsset({ draftId, fileName, bytes, mimeType }) { return this.#enqueue(async () => { const safeDraftId = normalizeDraftId(draftId); const safeFileName = normalizeAssetFileName(fileName); const value = normalizeImageBytes(bytes, mimeType); const uri = `assets/.drafts/${safeDraftId}/${safeFileName}`; await writeBinary(await this.#projectDir(this.#active()), uri.split("/"), value.bytes); return { uri, mimeType: value.mimeType, byteLength: value.bytes.byteLength, sha256: await sha256(value.bytes) }; }); }
  async commitActiveProjectAsset(uri) { return this.#enqueue(async () => { const normalized = normalizeAssetUri(uri); if (!normalized.startsWith("assets/.drafts/")) throw workspaceError("Only staged project assets can be committed", "project_asset_not_staged"); const root = await this.#projectDir(this.#active()); let file; try { file = await readFileHandle(root, normalized.split("/")); } catch (error) { if (error?.name === "NotFoundError") throw workspaceError("Staged project asset was not found", "project_asset_not_found"); throw error; } const bytes = new Uint8Array(await (await file.getFile()).arrayBuffer()); const mimeType = detectImageMime(bytes); if (!mimeType) throw workspaceError("Staged project asset is not a supported image", "project_asset_mime_invalid"); const digest = await sha256(bytes); const finalUri = `assets/generated/${digest}.${mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1]}`; try { await readFileHandle(root, finalUri.split("/")); } catch (error) { if (error?.name !== "NotFoundError") throw error; await writeBinary(root, finalUri.split("/"), bytes); } return { uri: finalUri, mimeType, byteLength: bytes.byteLength, sha256: digest }; }); }
  async discardActiveProjectAssetDraft(draftId) { return this.#enqueue(async () => { const safeDraftId = normalizeDraftId(draftId); const root = await this.#projectDir(this.#active()); try { const assets = await root.getDirectoryHandle("assets"); const drafts = await assets.getDirectoryHandle(".drafts"); await drafts.removeEntry(safeDraftId, { recursive: true }); } catch (error) { if (error?.name !== "NotFoundError") throw error; } return { discarded: true, draftId: safeDraftId }; }); }
  async getWorkspaceState() { await this.#settled(); return normalizeWorkspaceState(parseToml(await readText(await this.#projectDir(this.#active()), ["workspace.toml"]))); }
  async updateWorkspaceState(patch = {}) { return this.#enqueue(async () => { const dir = await this.#projectDir(this.#active()); const next = normalizeWorkspaceState({ ...parseToml(await readText(dir, ["workspace.toml"])), ...clone(patch) }); await writeText(dir, ["workspace.toml"], stringifyToml(next)); return clone(next); }); }
  async deleteProject(id) { assertProjectId(id); return this.#enqueue(async () => { const projects = await this.root.getDirectoryHandle("projects"); await projects.removeEntry(id, { recursive: true }); const remaining = await this.#listUnsafe(); if (!remaining.length) { const project = await this.#createUnsafe({ bundle: blankBundle(), source: "blank" }); return { deleted: true, activeProjectId: project.id }; } if (this.config.activeProjectId === id) await this.#select(remaining[0].id); return { deleted: true, activeProjectId: this.config.activeProjectId }; }); }
  async exportSnapshot({ includeApiKey = false } = {}) { await this.#settled(); const projects = []; for (const project of await this.listProjects()) { const dir = await this.#projectDir(project.id); projects.push({ manifest: await this.#manifest(project.id), content: parseBundle(await readText(dir, ["content.json"]), project.id), workspace: normalizeWorkspaceState(parseToml(await readText(dir, ["workspace.toml"]))) }); } return { schemaVersion: 1, exportedAt: new Date().toISOString(), config: await this.getRawConfig({ includeApiKey }), projects }; }
  async importSnapshot(snapshot, { replace = false } = {}) {
    if (snapshot?.schemaVersion !== 1 || !Array.isArray(snapshot.projects)) throw workspaceError("Invalid workspace backup", "workspace_backup_invalid");
    const validated = snapshot.projects.map((entry) => ({ ...entry, content: parseBundle(entry.content, entry.manifest?.id), workspace: normalizeWorkspaceState(entry.workspace ?? {}) }));
    if (replace) { const projects = await this.root.getDirectoryHandle("projects"); for await (const [name] of projects.entries()) await projects.removeEntry(name, { recursive: true }); }
    const importedIds = new Map();
    for (const entry of validated) {
      const project = await this.createProject({ bundle: entry.content, source: entry.manifest?.source ?? "import" });
      importedIds.set(entry.manifest?.id, project.id);
      await this.updateWorkspaceState(entry.workspace);
    }
    if (snapshot.config) {
      const config = clone(snapshot.config);
      config.activeProjectId = importedIds.get(config.activeProjectId) ?? this.config.activeProjectId;
      config.recentProjectIds = (config.recentProjectIds ?? []).map((id) => importedIds.get(id)).filter(Boolean);
      await this.updateConfig(config);
    }
    return { imported: validated.length, projects: await this.listProjects() };
  }
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
async function readFileHandle(root, parts) { let dir = root; for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part); return dir.getFileHandle(parts.at(-1)); }
async function writeBinary(root, parts, contents) { let dir = root; for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true }); const file = await dir.getFileHandle(parts.at(-1), { create: true }); const writer = await file.createWritable(); try { await writer.write(contents); await writer.close(); } catch (error) { await writer.abort().catch(() => {}); throw error; } }
function normalizeAssetUri(value) { if (typeof value !== "string" || !value.startsWith("assets/") || value.includes("\\") || value.includes("\0")) throw workspaceError("Project asset path is invalid", "project_asset_path_invalid"); const parts = value.split("/"); if (parts.some((part) => !part || part === "." || part === ".." || /[<>:"|?*\u0000-\u001f]/.test(part))) throw workspaceError("Project asset path is invalid", "project_asset_path_invalid"); return parts.join("/"); }
function normalizeDraftId(value) { if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value)) throw workspaceError("Project asset draft id is invalid", "project_asset_draft_id_invalid"); return value; }
function normalizeAssetFileName(value) { if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}\.(?:png|jpe?g|webp)$/i.test(value)) throw workspaceError("Project asset file name is invalid", "project_asset_file_name_invalid"); return value; }
function normalizeImageBytes(value, claimedMimeType) { const bytes = value instanceof Uint8Array ? value : new Uint8Array(value ?? []); if (!bytes.byteLength || bytes.byteLength > 50 * 1024 * 1024) throw workspaceError("Project asset must be between 1 byte and 50 MiB", "project_asset_size_invalid"); const mimeType = detectImageMime(bytes); if (!mimeType || (claimedMimeType && claimedMimeType !== mimeType)) throw workspaceError("Project asset MIME does not match its bytes", "project_asset_mime_invalid"); return { bytes, mimeType }; }
function detectImageMime(bytes) { if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png"; if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg"; if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") return "image/webp"; return null; }
async function sha256(bytes) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((value) => value.toString(16).padStart(2, "0")).join(""); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function workspaceError(message, code) { const error = new Error(message); error.name = "WorkspaceError"; error.code = code; return error; }
