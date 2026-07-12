import sampleBundle from "../../../fixtures/content/oss-court.cards.json";
import {
  applyAiEditPlan, buildAiEditPlanAsync, buildGenerationPlan, createConnectorConfig, createPlaySession,
  deriveStoryGroups, deriveTagCatalog, getCardGraph, listAiEditEndpointModels, loadEditorFromContent,
  prepareGameBuild, projectFactionGauges, summarizeDiagnostics, summarizeFeedback,
  validateAiEditEndpointConfig, validatePlayerCards
} from "../../../packages/interface/src/index.js";
import { createOpfsWorkspaceStore } from "./opfs-workspace.js";
import { backendError } from "./backend.js";

export class BrowserCreatorBackend {
  static async create(options = {}) { const workspace = await createOpfsWorkspaceStore({ initialBundle: sampleBundle, ...options }); return new BrowserCreatorBackend(workspace, await workspace.readActiveBundle()); }
  constructor(workspace, bundle) { this.workspace = workspace; this.editor = loadEditorFromContent(bundle); this.sessions = new Map(); this.lastDiagnostics = null; }
  async request(path, options = {}) {
    try { return await this.#dispatch(path, options.method ?? "GET", options.body ?? null); }
    catch (error) { if (error?.code) throw error; throw backendError(error?.message ?? String(error), "browser_backend_error"); }
  }
  async #dispatch(path, method, body) {
    if (path === "/api/config" && method === "GET") return this.workspace.getConfig();
    if (path === "/api/config" && method === "PATCH") return this.workspace.updateConfig(body ?? {});
    if (path === "/api/workspace/storage" && method === "GET") return this.workspace.getStorageStatus();
    if (path === "/api/workspace/persist" && method === "POST") return this.workspace.requestPersistence();
    if (path === "/api/workspace/export" && method === "POST") return this.workspace.exportSnapshot({ includeApiKey: body?.includeApiKey === true });
    if (path === "/api/workspace/import" && method === "POST") { const result = await this.workspace.importSnapshot(body?.snapshot, { replace: body?.replace === true }); await this.#reload(); return result; }
    if (path === "/api/workspace" && method === "GET") return this.workspace.getWorkspaceState();
    if (path === "/api/workspace" && method === "PATCH") return this.workspace.updateWorkspaceState(body ?? {});
    if (path === "/api/projects" && method === "GET") return { projects: await this.workspace.listProjects() };
    if (path === "/api/projects" && method === "POST") { const source = body?.source === "sample" ? "sample" : "blank"; const project = await this.workspace.createProject({ bundle: body?.bundle ?? (source === "sample" ? sampleBundle : undefined), source }); await this.#reload(); return { project, projects: await this.workspace.listProjects() }; }
    const project = path.match(/^\/api\/projects\/([^/]+)(?:\/(open))?$/);
    if (project && method === "POST" && project[2] === "open") { const result = await this.workspace.openProject(decodeURIComponent(project[1])); await this.#reload(); return { project: result }; }
    if (project && method === "PATCH" && !project[2]) { await this.workspace.openProject(decodeURIComponent(project[1])); await this.#reload(); if (typeof body?.title === "string") this.editor.setMetadata({ title: body.title }); await this.#persist(); return { project: (await this.workspace.listProjects()).find((entry) => entry.id === decodeURIComponent(project[1])) }; }
    if (project && method === "DELETE" && !project[2]) { const result = await this.workspace.deleteProject(decodeURIComponent(project[1])); await this.#reload(); return { ...result, projects: await this.workspace.listProjects() }; }
    if (path === "/api/samples/oss-court" && method === "GET") return clone(sampleBundle);
    if (path === "/api/editor" && method === "GET") return this.#editorProjection();
    if (path === "/api/editor/import" && method === "POST") { this.#replace(body?.bundle ?? body?.content ?? body); await this.#persist(); return { imported: true, cardCount: this.editor.cardCount(), validation: this.editor.validate() }; }
    if (path === "/api/editor/snapshot" && method === "GET") return { bundle: this.editor.toBundle(), validation: this.editor.validate() };
    if (path === "/api/editor/restore" && method === "POST") { this.#replace(body?.bundle ?? body); await this.#persist(); return { restored: true, cardCount: this.editor.cardCount(), validation: this.editor.validate(), playerValidation: this.editor.validateForPlayer() }; }
    if (path === "/api/editor/metadata" && method === "PATCH") { const metadata = this.editor.setMetadata(body?.metadata ?? {}); await this.#persist(true); return { metadata }; }
    if (path === "/api/editor/cards" && method === "POST") { const card = this.editor.addCard(body.card); await this.#persist(true); return { card, validation: this.editor.validate() }; }
    const cardPath = path.match(/^\/api\/editor\/cards\/([^/]+)$/);
    if (cardPath && method === "PUT") { const card = this.editor.updateCard(decodeURIComponent(cardPath[1]), body?.changes ?? {}); await this.#persist(true); return { card, validation: this.editor.validate() }; }
    if (cardPath && method === "DELETE") { const removed = this.editor.removeCard(decodeURIComponent(cardPath[1])); await this.#persist(true); return { removed, validation: this.editor.validate() }; }
    const choice = matchChoice(path);
    if (choice) return this.#choice(choice, method, body);
    if (path === "/api/editor/validate" && method === "GET") return { validation: this.editor.validate(), playerValidation: this.editor.validateForPlayer(), playerReady: this.editor.validateForPlayer().valid };
    if (path === "/api/editor/graph" && method === "GET") return getCardGraph({ cards: this.editor.toCards() });
    if (path === "/api/editor/tags" && method === "GET") return deriveTagCatalog({ cards: this.editor.toCards(), metadata: this.editor.metadata });
    if (path === "/api/editor/story-groups" && method === "GET") return deriveStoryGroups({ cards: this.editor.toCards(), metadata: this.editor.metadata });
    if (path === "/api/diagnostics/run" && method === "POST") { const cycles = Math.min(10000, Math.max(1, Number(body?.cycles ?? 1000))); this.lastDiagnostics = await this.#runReview({ cards: this.editor.toCards(), metadata: this.editor.metadata, cycles, maxTurns: Math.min(200, Number(body?.maxTurns ?? 50)), seed: Number(body?.seed ?? 1) }); return this.lastDiagnostics; }
    if (path === "/api/diagnostics/cancel" && method === "POST") { this.reviewWorker?.terminate(); this.reviewWorker = null; return { cancelled: true }; }
    if (path === "/api/diagnostics/feedback" && method === "POST") return summarizeFeedback(body?.report ?? body);
    if (path === "/api/diagnostics/project" && method === "POST") return summarizeDiagnostics(body?.report ?? body);
    if (path === "/api/connector/plan" && method === "POST") return buildGenerationPlan({ config: createConnectorConfig(body?.config ?? body), diagnostics: body?.diagnostics ?? null });
    if (path === "/api/ai/edit/plan" && method === "POST") { const diagnostics = body?.diagnostics ?? (body?.mode === "repair_diagnostics" ? this.lastDiagnostics : null); if (body?.mode === "repair_diagnostics" && !diagnostics) throw backendError("Run Review before building repair proposals", "diagnostics_required"); return buildAiEditPlanAsync({ editor: this.editor, config: body?.config ?? {}, credentials: await this.#credentials(body?.credentials), mode: body?.mode ?? "generate_cards", instruction: body?.instruction ?? "", targetCardId: body?.targetCardId ?? null, assetId: body?.assetId ?? null, diagnostics, fetchImpl: corsFetch }); }
    if (path === "/api/ai/edit/validate" && method === "POST") return validateAiEditEndpointConfig({ editor: this.editor, config: body?.config ?? {}, credentials: await this.#credentials(body?.credentials), fetchImpl: corsFetch });
    if (path === "/api/ai/edit/models" && method === "POST") return listAiEditEndpointModels({ config: body?.config ?? {}, credentials: await this.#credentials(body?.credentials), fetchImpl: corsFetch });
    if (path === "/api/ai/edit/apply" && method === "POST") { const result = applyAiEditPlan({ editor: this.editor, plan: body?.plan, proposalIds: body?.proposalIds ?? [] }); this.editor = result.editor; await this.#persist(true); return { applied: result.applied, proposalIds: result.proposalIds, patchCount: result.patchCount, bundle: result.bundle, validation: result.validation, playerValidation: result.playerValidation }; }
    if (path === "/api/play/start" && method === "POST") return this.#startPlay(body);
    if (path === "/api/play/swipe" && method === "POST") return this.#swipe(body);
    if (path === "/api/build/prepare" && method === "POST") return { build: prepareGameBuild({ editor: this.editor, config: body?.config ?? null, buildId: body?.buildId ?? null }) };
    if (path === "/api/build/export" && method === "POST") { const { downloadPlayerZip } = await import("./browser-build.js"); const result = await downloadPlayerZip({ editor: this.editor, config: body?.config ?? null, buildId: body?.buildId ?? null }); return { exported: true, outputPath: result.fileName, buildId: result.buildId, downloaded: true }; }
    throw backendError(`Unknown API route: ${method} ${path}`, "route_not_found");
  }
  #editorProjection() { return { metadata: this.editor.metadata, assets: this.editor.assets, cards: this.editor.toCards(), validation: this.editor.validate(), playerValidation: this.editor.validateForPlayer() }; }
  async #reload() { this.#replace(await this.workspace.readActiveBundle()); }
  #replace(bundle) { this.editor = loadEditorFromContent(bundle); this.sessions.clear(); this.lastDiagnostics = null; }
  async #persist(edited = false) { await this.workspace.saveActiveBundle(this.editor.toBundle()); if (edited) { this.sessions.clear(); this.lastDiagnostics = null; } }
  async #credentials(input) { const explicit = typeof input?.apiKey === "string" ? input.apiKey.trim() : ""; return { ...(input ?? {}), apiKey: explicit || await this.workspace.getStoredApiKey() || "" }; }
  async #choice(match, method, body) { const card = this.editor.findCard(match.cardId); if (!card) throw backendError(`Card '${match.cardId}' was not found`); if (match.kind === null) { if (body?.label !== undefined) this.editor.setChoiceLabel(match.cardId, match.choiceId, body.label); if (body?.effects !== undefined) this.editor.setChoiceEffects(match.cardId, match.choiceId, body.effects); } else { const choice = card.choices?.find((entry) => entry.id === match.choiceId); if (!choice) throw backendError(`Choice '${match.choiceId}' was not found`); const effects = clone(choice.effects ?? {}); const bucket = match.kind === "faction" ? "factions" : `${match.kind}s`; if (method === "DELETE" || body?.value === null || (match.kind !== "variable" && body?.value === false)) delete effects[bucket]?.[match.target]; else { if (body?.value === undefined) throw backendError("Effect route requires a value"); effects[bucket] = { ...(effects[bucket] ?? {}), [match.target]: body.value }; } for (const key of ["factions", "tags", "variables"]) if (effects[key] && !Object.keys(effects[key]).length) delete effects[key]; this.editor.setChoiceEffects(match.cardId, match.choiceId, effects); } await this.#persist(true); return { card: this.editor.findCard(match.cardId), validation: this.editor.validate() }; }
  #startPlay(body) { const cards = this.editor.toCards(); const validation = validatePlayerCards(cards); if (!validation.valid) throw backendError("Cards are not player-ready", "player_invalid"); const session = createPlaySession({ cards, metadata: this.editor.metadata, locale: body?.locale, rng: Math.random }); const sessionId = crypto.randomUUID(); this.sessions.set(sessionId, session); return playProjection(sessionId, session, session.start(), this.editor.metadata); }
  #swipe(body) { const session = this.sessions.get(body?.sessionId); if (!session) throw backendError(`Unknown sessionId '${body?.sessionId}'`); const result = session.swipe(body.direction); return playProjection(body.sessionId, session, result.nextCard, this.editor.metadata, result); }
  #runReview(input) { this.reviewWorker?.terminate(); const worker = new Worker(new URL("./review-worker.js", import.meta.url), { type: "module" }); this.reviewWorker = worker; const id = crypto.randomUUID(); return new Promise((resolve, reject) => { worker.addEventListener("message", (event) => { if (event.data?.id !== id) return; if (event.data.type === "result") { worker.terminate(); this.reviewWorker = null; resolve(event.data.result); } else if (event.data.type === "error") { worker.terminate(); this.reviewWorker = null; reject(backendError(event.data.error.message, event.data.error.code)); } }); worker.addEventListener("error", (event) => { worker.terminate(); this.reviewWorker = null; reject(backendError(event.message, "review_worker_failed")); }); worker.postMessage({ id, input }); }); }
}

function matchChoice(path) { const match = path.match(/^\/api\/editor\/cards\/([^/]+)\/choices\/([^/]+)(?:\/effects\/(faction|tag|variable)\/([^/]+))?$/); return match ? { cardId: decodeURIComponent(match[1]), choiceId: decodeURIComponent(match[2]), kind: match[3] ?? null, target: match[4] ? decodeURIComponent(match[4]) : null } : null; }
function playProjection(sessionId, session, card, metadata, result = null) { const factions = result?.factions ?? session.factions; return { sessionId, turn: session.turn, factions, gauges: projectFactionGauges(factions, metadata?.presentation), currentCard: card, gameOver: result?.gameOver ?? session.gameOver }; }
async function corsFetch(input, init) { const url = new URL(typeof input === "string" ? input : input.url, location.href); if (location.protocol === "https:" && url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw backendError("HTTPS Creator cannot call an insecure AI endpoint. Use HTTPS or localhost.", "mixed_content_blocked"); try { return await fetch(input, init); } catch (error) { throw backendError(`The AI endpoint could not be reached. Confirm that it allows CORS for ${location.origin} and permits Authorization and Content-Type headers.`, "cors_or_network_error"); } }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
