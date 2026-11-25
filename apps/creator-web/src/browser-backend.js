import sampleBundle from "../../../fixtures/content/oss-court.cards.json";
import fogHarborBundle from "../../../fixtures/content/fog-harbor.cards.json";

const BUNDLED_SAMPLES = { "oss-court": sampleBundle, "fog-harbor": fogHarborBundle };
import {
  applyAiEditPlan, applyImageDraftAsset, buildAiEditPlanAsync, buildVerifiedRepairPlan, createAiActivityRecord, createRepairHistoryRecord, markRepairHistoryApplied, buildImageOperationDraft, buildGenerationPlan, createConnectorConfig, createPlaySession,
  deriveStoryGroups, deriveTagCatalog, getCardGraph, listAiEditEndpointModels, loadEditorFromContent,
  prepareGameBuild, projectFactionGauges, summarizeDiagnostics, summarizeFeedback,
  inspectImageEndpointConfig, validateAiEditEndpointConfig, validatePlayerCards
} from "../../../packages/interface/src/index.js";
import { createOpfsWorkspaceStore } from "./opfs-workspace.js";
import { backendError } from "./backend.js";
import { corsFetch } from "./cors-fetch.js";

export class BrowserCreatorBackend {
  static async create(options = {}) { const workspace = await createOpfsWorkspaceStore({ initialBundle: sampleBundle, ...options }); return new BrowserCreatorBackend(workspace, await workspace.readActiveBundle()); }
  constructor(workspace, bundle) { this.workspace = workspace; this.editor = loadEditorFromContent(bundle); this.sessions = new Map(); this.imageDrafts = new Map(); this.assetUrls = new Map(); this.lastDiagnostics = null; this.aiRequestsUsed = 0; }
  async request(path, options = {}) {
    try { return await this.#dispatch(path, options.method ?? "GET", options.body ?? null, options); }
    catch (error) { if (error?.code) throw error; throw backendError(error?.message ?? String(error), "browser_backend_error"); }
  }
  async #dispatch(path, method, body, options = {}) {
    if (path === "/api/config" && method === "GET") return this.workspace.getConfig();
    if (path === "/api/config" && method === "PATCH") return this.workspace.updateConfig(body ?? {});
    if (path === "/api/workspace/storage" && method === "GET") return this.workspace.getStorageStatus();
    if (path === "/api/workspace/persist" && method === "POST") return this.workspace.requestPersistence();
    if (path === "/api/workspace/export" && method === "POST") return this.workspace.exportSnapshot({ includeApiKey: body?.includeApiKey === true });
    if (path === "/api/workspace/import" && method === "POST") { const result = await this.workspace.importSnapshot(body?.snapshot, { replace: body?.replace === true }); await this.#reload(); return result; }
    if (path === "/api/workspace" && method === "GET") return this.workspace.getWorkspaceState();
    if (path === "/api/workspace" && method === "PATCH") return this.workspace.updateWorkspaceState(body ?? {});
    if (path === "/api/projects" && method === "GET") return { projects: await this.workspace.listProjects() };
    if (path === "/api/projects" && method === "POST") { const source = body?.source === "sample" ? "sample" : "blank"; const project = await this.workspace.createProject({ bundle: body?.bundle ?? (source === "sample" ? resolveSample(body?.sample) : undefined), source }); await this.#reload(); return { project, projects: await this.workspace.listProjects() }; }
    const project = path.match(/^\/api\/projects\/([^/]+)(?:\/(open))?$/);
    if (project && method === "POST" && project[2] === "open") { const result = await this.workspace.openProject(decodeURIComponent(project[1])); await this.#reload(); return { project: result }; }
    if (project && method === "PATCH" && !project[2]) { await this.workspace.openProject(decodeURIComponent(project[1])); await this.#reload(); if (typeof body?.title === "string") this.editor.setMetadata({ title: body.title }); await this.#persist(); return { project: (await this.workspace.listProjects()).find((entry) => entry.id === decodeURIComponent(project[1])) }; }
    if (project && method === "DELETE" && !project[2]) { const result = await this.workspace.deleteProject(decodeURIComponent(project[1])); await this.#reload(); return { ...result, projects: await this.workspace.listProjects() }; }
    if (path === "/api/samples" && method === "GET") return { samples: Object.entries(BUNDLED_SAMPLES).map(([id, bundle]) => ({ id, title: bundle.metadata?.title ?? id, description: bundle.metadata?.description ?? "", cardCount: bundle.cards?.length ?? 0 })) };
    const sampleRoute = path.match(/^\/api\/samples\/([a-z0-9-]+)$/);
    if (sampleRoute && method === "GET") return resolveSample(sampleRoute[1]);
    if (path === "/api/editor" && method === "GET") return this.#editorProjection();
    if (path === "/api/editor/import" && method === "POST") { this.#replace(body?.bundle ?? body?.content ?? body); await this.#persist(); return { imported: true, cardCount: this.editor.cardCount(), validation: this.editor.validate() }; }
    if (path === "/api/editor/snapshot" && method === "GET") return { bundle: this.editor.toBundle(), validation: this.editor.validate() };
    if (path === "/api/editor/restore" && method === "POST") { this.#replace(body?.bundle ?? body); await this.#persist(); return { restored: true, cardCount: this.editor.cardCount(), validation: this.editor.validate(), playerValidation: this.editor.validateForPlayer() }; }
    if (path === "/api/editor/metadata" && method === "PATCH") { const metadata = this.editor.setMetadata(body?.metadata ?? {}); await this.#persist(true); return { metadata }; }
    const assetPath = path.match(/^\/api\/editor\/assets\/([^/]+)$/);
    if (assetPath && method === "PATCH") { const asset = this.editor.setAssetDisplay(decodeURIComponent(assetPath[1]), body?.display); await this.#persist(true); return { asset, validation: this.editor.validate(), playerValidation: this.editor.validateForPlayer() }; }
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
    if (path === "/api/diagnostics/run" && method === "POST") { const cycles = Math.min(10000, Math.max(1, Number(body?.cycles ?? 1000))); const startDeck = JSON.stringify(this.editor.toBundle()); const result = await this.#runReview({ cards: this.editor.toCards(), metadata: this.editor.metadata, cycles, maxTurns: Math.min(200, Number(body?.maxTurns ?? 50)), seed: Number(body?.seed ?? 1) }, options.onProgress); if (JSON.stringify(this.editor.toBundle()) !== startDeck) throw backendError("The deck changed while Review was running; run Review again", "diagnostics_stale"); this.lastDiagnostics = result; return result; }
    if (path === "/api/diagnostics/cancel" && method === "POST") { this.reviewWorker?.terminate(); this.reviewWorker = null; return { cancelled: true }; }
    if (path === "/api/diagnostics/feedback" && method === "POST") return summarizeFeedback(body?.report ?? body);
    if (path === "/api/diagnostics/project" && method === "POST") return summarizeDiagnostics(body?.report ?? body);
    if (path === "/api/connector/plan" && method === "POST") return buildGenerationPlan({ config: createConnectorConfig(body?.config ?? body), diagnostics: body?.diagnostics ?? null });
    if (path === "/api/ai/edit/plan" && method === "POST") return this.#buildPlan(body, options);
    if (path === "/api/ai/edit/validate" && method === "POST") return validateAiEditEndpointConfig({ editor: this.editor, config: body?.config ?? {}, credentials: await this.#credentials(body?.credentials), fetchImpl: await this.#countedFetch() });
    if (path === "/api/ai/edit/models" && method === "POST") return listAiEditEndpointModels({ config: body?.config ?? {}, credentials: await this.#credentials(body?.credentials), fetchImpl: await this.#countedFetch() });
    if (path === "/api/ai/repair-history" && method === "GET") return { records: await this.workspace.listRepairHistory() };
    if (path === "/api/ai/repair-history?full=1" && method === "GET") { const records = []; for (const entry of await this.workspace.listRepairHistory()) records.push(await this.workspace.readRepairHistoryRecord(entry.id)); return { exportedAt: new Date().toISOString(), records }; }
    if (path === "/api/ai/session-usage" && method === "GET") { const limit = (await this.workspace.getConfig()).ai.sessionRequestLimit ?? 0; return { used: this.aiRequestsUsed, limit, remaining: limit > 0 ? Math.max(0, limit - this.aiRequestsUsed) : null }; }
    if (path === "/api/ai/repair-history" && method === "DELETE") return this.workspace.clearRepairHistory();
    const historyRoute = path.match(/^\/api\/ai\/repair-history\/([^/]+)$/);
    if (historyRoute && method === "GET") return { record: await this.workspace.readRepairHistoryRecord(decodeURIComponent(historyRoute[1])) };
    if (historyRoute && method === "DELETE") return this.workspace.deleteRepairHistoryRecord(decodeURIComponent(historyRoute[1]));
    if (path === "/api/ai/edit/apply" && method === "POST") { const activeProjectId = (await this.workspace.getConfig()).activeProjectId; if (body?.plan?.projectId && body.plan.projectId !== activeProjectId) throw backendError("This draft was built in another project; open that project or build the draft again here", "ai_plan_other_project"); const result = applyAiEditPlan({ editor: this.editor, plan: body?.plan, proposalIds: body?.proposalIds ?? [] }); this.editor = result.editor; await this.#persist(true); const historyId = await this.#markRepairHistory(body?.historyId ?? body?.plan?.historyId, result.proposalIds, body?.plan?.projectId ?? activeProjectId); return { applied: result.applied, ...(historyId ? { historyId } : {}), proposalIds: result.proposalIds, patchCount: result.patchCount, bundle: result.bundle, validation: result.validation, playerValidation: result.playerValidation }; }
    if (path === "/api/ai/images/validate" && method === "POST") return inspectImageEndpointConfig({ config: body?.config ?? {} });
    if (path === "/api/ai/images/stage" && method === "POST") { const draftId = body?.draftId || `input-${crypto.randomUUID()}`; return this.workspace.stageActiveProjectAsset({ draftId, fileName: body?.fileName || "input.png", bytes: body?.bytes, mimeType: body?.mimeType }); }
    if (path === "/api/ai/images/run" && method === "POST") {
      const draftId = `img-${crypto.randomUUID()}`;
      const request = body?.request ?? {};
      const inputDraftIds = stagedInputDraftIds(request);
      const inputs = [];
      let aggregateBytes = 0;
      for (const uri of [...new Set(request.references ?? [])]) { const bytes = await this.workspace.readActiveProjectAsset(uri); if (!bytes) throw backendError(`Project image '${uri}' was not found`, "image_input_not_found"); aggregateBytes += bytes.byteLength; if (aggregateBytes > 50 * 1024 * 1024) throw backendError("Image inputs exceed the 50 MiB request limit", "image_input_limit"); inputs.push({ id: uri, name: uri.split("/").at(-1), bytes, role: "reference" }); }
      if (request.mask) { const bytes = await this.workspace.readActiveProjectAsset(request.mask); if (!bytes) throw backendError(`Project image '${request.mask}' was not found`, "image_input_not_found"); aggregateBytes += bytes.byteLength; if (aggregateBytes > 50 * 1024 * 1024) throw backendError("Image inputs exceed the 50 MiB request limit", "image_input_limit"); inputs.push({ id: request.mask, name: request.mask.split("/").at(-1), bytes, role: "mask" }); }
      const imageStartedAt = Date.now(); const projectId = (await this.workspace.getConfig()).activeProjectId; const imageCredentials = await this.#imageCredentials(body?.credentials, body?.config);
      let generated;
      try { generated = await buildImageOperationDraft({ editor: this.editor, config: body?.config ?? {}, credentials: imageCredentials, request, inputs, fetchImpl: await this.#countedFetch(), signal: options.signal }); }
      catch (error) { await this.#recordActivity({ kind: "image", error: options.signal?.aborted ? Object.assign(error, { code: "ai_cancelled" }) : error, image: { operation: request.operation, prompt: request.prompt, model: body?.config?.modelId }, body: { source: "AI Assist" }, credentials: imageCredentials, projectId, durationMs: Date.now() - imageStartedAt }); throw error; }
      await this.#recordActivity({ kind: "image", image: { operation: generated.operation ?? request.operation, prompt: request.prompt, model: generated.provider?.model ?? body?.config?.modelId, outputs: generated.outputs?.length ?? 0 }, body: { source: "AI Assist" }, credentials: imageCredentials, projectId, durationMs: Date.now() - imageStartedAt });
      const outputs = [];
      for (const [index, output] of generated.outputs.entries()) { const extension = output.mimeType === "image/jpeg" ? "jpg" : output.mimeType.split("/")[1]; const staged = await this.workspace.stageActiveProjectAsset({ draftId, fileName: `output-${index + 1}.${extension}`, bytes: output.bytes, mimeType: output.mimeType }); outputs.push({ id: `output-${index + 1}`, ...staged, previewUrl: await this.assetUrl(staged.uri) }); }
      const draft = { ...generated, draftId, outputs, inputDraftIds }; this.imageDrafts.set(draftId, draft); return draft;
    }
    if (path === "/api/ai/images/apply" && method === "POST") { const draft = this.imageDrafts.get(body?.draftId); if (!draft) throw backendError("Image draft was not found or has expired", "image_draft_not_found"); const output = draft.outputs.find((entry) => entry.id === body?.outputId); if (!output) throw backendError("Selected image output was not found", "image_output_not_found"); const committed = await this.workspace.commitActiveProjectAsset(output.uri); const cardId = body?.cardId || draft.request?.targetCardId || undefined; const asset = { id: body?.assetId || draft.request?.targetAssetId || `generated-${committed.sha256.slice(0, 12)}`, ...(cardId ? { cardId } : {}), uri: committed.uri, title: body?.title || draft.request?.prompt || "Generated card art", source: { type: "ai-image", protocol: draft.provider.protocol, model: draft.provider.model, operation: draft.operation }, metadata: { mimeType: committed.mimeType, sha256: committed.sha256 } }; const result = applyImageDraftAsset({ editor: this.editor, draft, outputId: output.id, asset }); this.editor = result.editor; await this.#persist(true); await this.workspace.discardActiveProjectAssetDraft(draft.draftId); for (const inputDraftId of draft.inputDraftIds ?? []) await this.workspace.discardActiveProjectAssetDraft(inputDraftId); this.imageDrafts.delete(draft.draftId); return { applied: true, outputId: output.id, asset: result.asset, bundle: result.bundle, validation: result.validation, playerValidation: result.playerValidation }; }
    const imageDraft = path.match(/^\/api\/ai\/images\/drafts\/([^/]+)$/);
    if (imageDraft && method === "DELETE") { const draftId = decodeURIComponent(imageDraft[1]); const draft = this.imageDrafts.get(draftId); await this.workspace.discardActiveProjectAssetDraft(draftId); for (const inputDraftId of draft?.inputDraftIds ?? []) await this.workspace.discardActiveProjectAssetDraft(inputDraftId); this.imageDrafts.delete(draftId); return { discarded: true, draftId }; }
    if (path === "/api/play/start" && method === "POST") return this.#startPlay(body);
    if (path === "/api/play/swipe" && method === "POST") return this.#swipe(body);
    if (path === "/api/build/prepare" && method === "POST") return { build: prepareGameBuild({ editor: this.editor, config: body?.config ?? null, buildId: body?.buildId ?? null }) };
    if (path === "/api/build/export" && method === "POST") { const { downloadPlayerZip } = await import("./browser-build.js"); const result = await downloadPlayerZip({ editor: this.editor, config: body?.config ?? null, buildId: body?.buildId ?? null, assetReader: (uri) => this.workspace.readActiveProjectAsset(uri) }); return { exported: true, outputPath: result.fileName, buildId: result.buildId, downloaded: true }; }
    throw backendError(`Unknown API route: ${method} ${path}`, "route_not_found");
  }
  async #buildPlan(body, options = {}) {
    const mode = body?.mode ?? "generate_cards";
    const diagnostics = body?.diagnostics ?? (mode === "repair_diagnostics" ? this.lastDiagnostics : null);
    if (mode === "repair_diagnostics" && !diagnostics) throw backendError("Run Review before building repair proposals", "diagnostics_required");
    const credentials = await this.#credentials(body?.credentials);
    const projectId = (await this.workspace.getConfig()).activeProjectId;
    const isRepairLoop = mode === "repair_diagnostics" && body?.verify !== false;
    const startedAt = Date.now();
    const record = (outcome) => isRepairLoop
      ? this.#recordRepairHistory({ ...outcome, body, credentials, projectId })
      : this.#recordActivity({ ...outcome, kind: body?.selection ? "selection" : "draft", body, credentials, projectId, durationMs: Date.now() - startedAt });
    let plan;
    try {
      plan = isRepairLoop
        ? await this.#runRepairLoop({ config: body?.config ?? {}, credentials, instruction: body?.instruction ?? "", targetCardId: body?.targetCardId ?? null, repairTarget: body?.repairTarget ?? null, diagnostics, priorAttempts: await this.#priorRepairAttempts(body?.repairTarget) }, options.onProgress, options.signal)
        : await buildAiEditPlanAsync({ editor: this.editor, config: body?.config ?? {}, credentials, mode, instruction: body?.instruction ?? "", targetCardId: body?.targetCardId ?? null, assetId: body?.assetId ?? null, diagnostics, fetchImpl: await this.#countedFetch(), onProgress: progressObserver(options.onProgress), selection: body?.selection ?? null, signal: options.signal ?? null });
    } catch (error) {
      await record({ error });
      throw error;
    }
    const historyId = await record({ plan });
    return { ...plan, projectId, ...(historyId ? { historyId } : {}) };
  }
  // The one session counter: page requests and worker requests are admitted here, synchronously.
  #admitRequest(limit) {
    if (limit > 0 && this.aiRequestsUsed >= limit) return false;
    this.aiRequestsUsed += 1;
    return true;
  }
  async #countedFetch() {
    const limit = (await this.workspace.getConfig()).ai.sessionRequestLimit ?? 0;
    return async (input, init) => {
      if (!this.#admitRequest(limit)) throw backendError(`This Creator session reached its AI request limit (${limit}). Raise it in Settings or reload the page.`, "ai_session_budget");
      return corsFetch(input, init);
    };
  }
  async #priorRepairAttempts(repairTarget) {
    if (!repairTarget?.code) return [];
    try {
      const wanted = new Set((Array.isArray(repairTarget.cardIds) ? repairTarget.cardIds : []).map((cardId) => `card:${cardId}`));
      const matches = (await this.workspace.listRepairHistory()).filter((entry) => entry.kind === "repair_loop" && entry.targets.some((target) => target.code === repairTarget.code && (wanted.size === 0 || wanted.has(target.entity)))).slice(0, 2);
      const attempts = [];
      for (const entry of matches) {
        const stored = await this.workspace.readRepairHistoryRecord(entry.id);
        for (const round of stored.rounds ?? []) for (const proposal of round.proposals ?? []) if (!proposal.passed && attempts.length < 4) attempts.push({ proposalId: proposal.id, title: proposal.title, failedChecks: (proposal.failedDetails ?? []).length ? proposal.failedDetails : (proposal.failedChecks ?? []).map((id) => ({ id })) });
      }
      return attempts;
    } catch {
      return [];
    }
  }
  async #recordActivity({ kind, plan = null, error = null, image = null, body = {}, credentials = {}, projectId = null, durationMs = null }) {
    try {
      const record = createAiActivityRecord({ kind, plan, error, image, request: { source: body?.source, mode: body?.mode, instruction: body?.instruction, selection: body?.selection }, id: `rh-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`, durationMs, secrets: [credentials?.apiKey] });
      return (await this.workspace.appendRepairHistoryRecord(record, { projectId })).record.id;
    } catch {
      return null; // The activity log never breaks drafting.
    }
  }
  // The verified repair loop runs in a worker; the page only checks for edits made meanwhile.
  async #runRepairLoop(input, onProgress = null, signal = null) {
    const bundle = this.editor.toBundle();
    const startedJson = JSON.stringify(bundle);
    let plan;
    if (typeof Worker === "function") {
      const limit = (await this.workspace.getConfig()).ai.sessionRequestLimit ?? 0;
      plan = await new Promise((resolve, reject) => {
        if (signal?.aborted) { reject(backendError("AI request cancelled by the author", "ai_cancelled")); return; }
        const worker = new Worker(new URL("./repair-worker.js", import.meta.url), { type: "module" });
        // Ask the worker to cancel so it returns the rounds it already ran; terminate only if it
        // does not answer within 2 s.
        signal?.addEventListener("abort", () => {
          worker.postMessage({ type: "cancel", id });
          window.setTimeout(() => { worker.terminate(); if (this.repairWorker === worker) this.repairWorker = null; reject(backendError("AI request cancelled by the author", "ai_cancelled")); }, 2000);
        }, { once: true });
        this.repairWorker = worker;
        const id = crypto.randomUUID();
        const finish = () => { worker.terminate(); if (this.repairWorker === worker) this.repairWorker = null; };
        worker.addEventListener("message", (event) => {
          if (event.data?.id !== id) return;
          if (event.data.type === "progress") { progressObserver(onProgress)?.(event.data.event); return; }
          if (event.data.type === "request-slot") { worker.postMessage({ type: "slot", seq: event.data.seq, granted: this.#admitRequest(limit) }); return; }
          finish();
          if (event.data.type === "result") resolve(event.data.result);
          else {
            const failure = backendError(event.data.error?.message ?? "Repair loop failed", event.data.error?.code ?? "ai_repair_failed", event.data.error?.stage ?? null);
            if (event.data.error?.repairVerification) failure.repairVerification = event.data.error.repairVerification;
            reject(failure);
          }
        });
        worker.addEventListener("error", (event) => { finish(); reject(backendError(event.message || "Repair worker failed", "ai_repair_worker_failed")); });
        worker.postMessage({ id, input: { ...input, bundle } });
      });
    } else {
      plan = await buildVerifiedRepairPlan({ editor: this.editor, getEditor: () => this.editor, ...input, fetchImpl: await this.#countedFetch(), onProgress: progressObserver(onProgress), signal });
    }
    if (JSON.stringify(this.editor.toBundle()) !== startedJson) {
      // Keep the finished rounds for History even though the draft can no longer be applied.
      const stale = backendError("Content changed while the repair loop was running; rebuild the repair draft", "ai_repair_stale");
      if (plan?.verification) stale.repairVerification = { ...plan.verification, status: "failed", stopReason: "ai_repair_stale" };
      throw stale;
    }
    return plan;
  }
  async #recordRepairHistory({ plan = null, error = null, body = {}, credentials = {}, projectId = null }) {
    try {
      const record = createRepairHistoryRecord({ plan, error, request: { instruction: body?.instruction, repairTarget: body?.repairTarget }, id: `rh-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`, secrets: [credentials?.apiKey] });
      return (await this.workspace.appendRepairHistoryRecord(record, { projectId })).record.id;
    } catch {
      return null; // History never breaks drafting.
    }
  }
  async #markRepairHistory(historyId, proposalIds, projectId = null) {
    if (typeof historyId !== "string" || !historyId.startsWith("rh-")) return null;
    try { await this.workspace.updateRepairHistoryRecord(historyId, (record) => markRepairHistoryApplied(record, { proposalIds }), { projectId }); return historyId; } catch { return null; }
  }
  #editorProjection() { return { metadata: this.editor.metadata, assets: this.editor.assets, cards: this.editor.toCards(), validation: this.editor.validate(), playerValidation: this.editor.validateForPlayer() }; }
  async #reload() { this.#replace(await this.workspace.readActiveBundle()); }
  // Object URLs stay valid across editor reloads: project asset URIs are
  // content-addressed (sha256 names) or shared bundled sample art, so a cached
  // URL for a URI never goes stale. Revoking them here would break <img>
  // elements that still reference the same URI (e.g. after undo/restore or
  // project switches), which surfaced as artwork randomly disappearing.
  #replace(bundle) { this.editor = loadEditorFromContent(bundle); this.sessions.clear(); this.lastDiagnostics = null; }
  async #persist(edited = false) { await this.workspace.saveActiveBundle(this.editor.toBundle()); if (edited) { this.sessions.clear(); this.lastDiagnostics = null; } }
  async #credentials(input) { const explicit = typeof input?.apiKey === "string" ? input.apiKey.trim() : ""; return { ...(input ?? {}), apiKey: explicit || await this.workspace.getStoredApiKey() || "" }; }
  async #imageCredentials(input, config) { const explicit = typeof input?.apiKey === "string" ? input.apiKey.trim() : ""; const stored = config?.credentialMode === "inherit_text" ? await this.workspace.getStoredApiKey() : await this.workspace.getStoredImageApiKey(); return { ...(input ?? {}), apiKey: explicit || stored || "" }; }
  async assetUrl(uri) { if (!uri) return ""; if (this.assetUrls.has(uri)) return this.assetUrls.get(uri); const bytes = await this.workspace.readActiveProjectAsset(uri); if (!bytes) return `${import.meta.env.BASE_URL}${uri}`; const extension = uri.split(".").at(-1)?.toLowerCase(); const mimeType = extension === "jpg" || extension === "jpeg" ? "image/jpeg" : extension === "webp" ? "image/webp" : "image/png"; const url = URL.createObjectURL(new Blob([bytes], { type: mimeType })); this.assetUrls.set(uri, url); return url; }
  async #choice(match, method, body) { const card = this.editor.findCard(match.cardId); if (!card) throw backendError(`Card '${match.cardId}' was not found`); if (match.kind === null) { if (body?.label !== undefined) this.editor.setChoiceLabel(match.cardId, match.choiceId, body.label); if (body?.effects !== undefined) this.editor.setChoiceEffects(match.cardId, match.choiceId, body.effects); } else { const choice = card.choices?.find((entry) => entry.id === match.choiceId); if (!choice) throw backendError(`Choice '${match.choiceId}' was not found`); const effects = clone(choice.effects ?? {}); const bucket = match.kind === "faction" ? "factions" : `${match.kind}s`; if (method === "DELETE" || body?.value === null || (match.kind !== "variable" && body?.value === false)) delete effects[bucket]?.[match.target]; else { if (body?.value === undefined) throw backendError("Effect route requires a value"); effects[bucket] = { ...(effects[bucket] ?? {}), [match.target]: body.value }; } for (const key of ["factions", "tags", "variables"]) if (effects[key] && !Object.keys(effects[key]).length) delete effects[key]; this.editor.setChoiceEffects(match.cardId, match.choiceId, effects); } await this.#persist(true); return { card: this.editor.findCard(match.cardId), validation: this.editor.validate() }; }
  #startPlay(body) { const cards = this.editor.toCards(); const validation = validatePlayerCards(cards); if (!validation.valid) throw backendError("Cards are not player-ready", "player_invalid"); const session = createPlaySession({ cards, metadata: this.editor.metadata, locale: body?.locale, rng: Math.random }); const sessionId = crypto.randomUUID(); this.sessions.set(sessionId, session); return playProjection(sessionId, session, session.start(), this.editor.metadata); }
  #swipe(body) { const session = this.sessions.get(body?.sessionId); if (!session) throw backendError(`Unknown sessionId '${body?.sessionId}'`); const result = session.swipe(body.direction); return playProjection(body.sessionId, session, result.nextCard, this.editor.metadata, result); }
  #runReview(input, onProgress = null) { this.reviewWorker?.terminate(); const worker = new Worker(new URL("./review-worker.js", import.meta.url), { type: "module" }); this.reviewWorker = worker; const id = crypto.randomUUID(); return new Promise((resolve, reject) => { worker.addEventListener("message", (event) => { if (event.data?.id !== id) return; if (event.data.type === "progress") { if (typeof onProgress === "function" && event.data.event) { try { onProgress(event.data.event); } catch { /* observers never break review */ } } return; } if (event.data.type === "result") { worker.terminate(); this.reviewWorker = null; resolve(event.data.result); } else if (event.data.type === "error") { worker.terminate(); this.reviewWorker = null; reject(backendError(event.data.error.message, event.data.error.code)); } }); worker.addEventListener("error", (event) => { worker.terminate(); this.reviewWorker = null; reject(backendError(event.message, "review_worker_failed")); }); worker.postMessage({ id, input }); }); }
}

function progressObserver(onProgress) { return typeof onProgress === "function" ? (event) => { try { onProgress(event); } catch { /* observers never break drafting */ } } : null; }
function matchChoice(path) { const match = path.match(/^\/api\/editor\/cards\/([^/]+)\/choices\/([^/]+)(?:\/effects\/(faction|tag|variable)\/([^/]+))?$/); return match ? { cardId: decodeURIComponent(match[1]), choiceId: decodeURIComponent(match[2]), kind: match[3] ?? null, target: match[4] ? decodeURIComponent(match[4]) : null } : null; }
function playProjection(sessionId, session, card, metadata, result = null) { const factions = result?.factions ?? session.factions; return { sessionId, turn: session.turn, factions, gauges: projectFactionGauges(factions, metadata?.presentation), currentCard: card, gameOver: result?.gameOver ?? session.gameOver }; }
function stagedInputDraftIds(request) { return [...new Set([...(request?.references ?? []), request?.mask].filter((uri) => typeof uri === "string" && uri.startsWith("assets/.drafts/")).map((uri) => uri.split("/")[2]).filter(Boolean))]; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function resolveSample(id = "oss-court") {
  if (typeof id !== "string" || !Object.hasOwn(BUNDLED_SAMPLES, id)) throw backendError("Unknown sample", "sample_not_found");
  return clone(BUNDLED_SAMPLES[id]);
}
