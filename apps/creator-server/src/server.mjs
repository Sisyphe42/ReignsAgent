#!/usr/bin/env node
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, writeFile, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyAiEditPlan,
  applyImageDraftAsset,
  buildAiEditPlanAsync,
  buildImageOperationDraft,
  buildVerifiedRepairPlan,
  buildGenerationPlan,
  createAiActivityRecord,
  createCardEditor,
  createConnectorConfig,
  createRepairHistoryRecord,
  markRepairHistoryApplied,
  createPlaySession,
  deriveStoryGroups,
  deriveTagCatalog,
  getCardGraph,
  listAiEditEndpointModels,
  loadEditorFromContent,
  prepareGameBuild,
  projectFactionGauges,
  runDiagnostics,
  runDiagnosticsAsync,
  serializeBuild,
  summarizeDiagnostics,
  summarizeFeedback,
  validateAiEditEndpointConfig,
  inspectImageEndpointConfig,
  validatePlayerCards
} from "../../../packages/interface/src/index.js";
import { createWorkspaceStore } from "../../../packages/workspace/src/index.js";
import { buildWindowsPlayerRelease, windowsReleaseCapability } from "./windows-release.mjs";

const DEFAULT_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const DEFAULT_SAMPLE_ID = "oss-court";
const BUNDLED_SAMPLE_FILES = { "fog-harbor": "fixtures/content/fog-harbor.cards.json" };
const API_CAPABILITY_HEADER = "x-reigns-agent-capability";
const API_CAPABILITY_QUERY = "_reignsAgentCapability";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const MAX_JSON_BODY_BYTES = 10 * 1024 * 1024;
const MAX_CREATOR_DIAGNOSTIC_CYCLES = 10000;
const MAX_DIAGNOSTIC_TURNS = 200;
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp"
};

/**
 * SessionState keeps an editor and an optional active play session for the local
 * creator dash. It is process-local: this server is a development tool, never a
 * production runtime.
 */
class SessionState {
  constructor(initialBundle = { cards: [] }) {
    this.editor = loadEditorFromContent(initialBundle);
    this.sessions = new Map();
    this.lastDiagnostics = null;
  }

  loadEditor(bundleLike) {
    this.editor = loadEditorFromContent(bundleLike);
    this.sessions.clear();
    this.lastDiagnostics = null;
    return this.editor;
  }

  replaceEditor(editor) {
    this.editor = editor;
    this.sessions.clear();
    this.lastDiagnostics = null;
    return this.editor;
  }

  markEdited() {
    this.sessions.clear();
    this.lastDiagnostics = null;
  }
}

export async function createCreatorServer({
  rootDir = DEFAULT_ROOT,
  staticRoot = null,
  samplePath = join(rootDir, "fixtures/content/oss-court.cards.json"),
  interfaceWebRoot = join(rootDir, "packages/interface/web"),
  defaultBuildOutputDir = join(process.cwd(), "dist"),
  windowsPlayerHostPath = join(rootDir, "apps/player-windows/out/win-x64/ReignsAgentPlayer.exe"),
  enableWindowsRelease = process.platform === "win32",
  dataRoot = null,
  initialBundle
} = {}) {
const resolvedStaticRoot = staticRoot ? resolve(staticRoot) : null;
const resolvedInterfaceWebRoot = resolve(interfaceWebRoot);
const resolvedWindowsPlayerHostPath = resolve(windowsPlayerHostPath);
const temporaryDataRoot = dataRoot ? null : await mkdtemp(join(tmpdir(), "reigns-creator-"));
const workspace = await createWorkspaceStore({
  dataRoot: dataRoot ?? temporaryDataRoot,
  initialBundle: initialBundle ?? await readSample(DEFAULT_SAMPLE_ID)
});
const store = new SessionState(await workspace.readActiveBundle());
const imageDrafts = new Map();
const apiCapability = randomBytes(32).toString("base64url");
// Plans are signed when issued and verified on apply, so a client cannot edit proposals,
// patches, verification evidence, or the base fingerprint between review and apply.
const planSigningKey = randomBytes(32);
// AI endpoint requests sent by this Creator session (text drafts, repair rounds, validation,
// model listing, images). config.ai.sessionRequestLimit caps it; 0 means no limit.
let aiRequestsUsed = 0;
let trustedRequestHosts = new Set();

const server = createServer(async (req, res) => {
  try {
    assertTrustedHost(req.headers.host);
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;

    if (path.startsWith("/api/")) {
      assertLocalOrigin(req.headers.origin);
      if (path === "/api/session" && req.method === "GET") {
        return sendJson(res, { capability: apiCapability });
      }
      assertApiCapability(req, url);
      assertJsonContentType(req, path);
      return await handleApi(req, res, url);
    }

    if (resolvedStaticRoot && (req.method === "GET" || req.method === "HEAD")) {
      const served = await handleReleaseAsset(req, res, url);
      if (served) return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: `Not found: ${path}` } }));
  } catch (error) {
    res.writeHead(error.statusCode ?? 500, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ error: { name: error.name, message: error.message, code: error.code ?? "internal_error" } }));
  }
});

async function handleApi(req, res, url) {
  const path = url.pathname;

  if (path === "/api/ai/images/stage" && req.method === "POST") {
    const bytes = await readBinaryBody(req, 50 * 1024 * 1024);
    const draftId = url.searchParams.get("draftId") || `input-${randomId()}`;
    const fileName = url.searchParams.get("fileName") || "input.png";
    const staged = await workspace.stageActiveProjectAsset({ draftId, fileName, bytes, mimeType: req.headers["content-type"]?.split(";")[0] });
    return sendJson(res, staged);
  }

  if (path.startsWith("/api/project-assets/") && req.method === "GET") {
    const uri = decodeURIComponent(path.slice("/api/project-assets/".length));
    return sendProjectAsset(res, uri);
  }

  const body = await readJsonBody(req);

  if (path === "/api/config" && req.method === "GET") {
    return sendJson(res, await workspace.getConfig());
  }

  if (path === "/api/config" && req.method === "PATCH") {
    return sendJson(res, await workspace.updateConfig(body ?? {}));
  }

  if (path === "/api/workspace" && req.method === "GET") {
    return sendJson(res, await workspace.getWorkspaceState());
  }

  if (path === "/api/workspace" && req.method === "PATCH") {
    return sendJson(res, await workspace.updateWorkspaceState(body ?? {}));
  }

  if (path === "/api/projects" && req.method === "GET") {
    return sendJson(res, { projects: await workspace.listProjects() });
  }

  if (path === "/api/projects" && req.method === "POST") {
    const source = body?.source === "sample" ? "sample" : "blank";
    let bundle = body?.bundle;
    if (bundle === undefined && source === "sample") {
      bundle = await readSample(typeof body?.sample === "string" ? body.sample : DEFAULT_SAMPLE_ID);
      if (!bundle) throw apiError("Unknown sample", "sample_not_found", 404);
    }
    const project = await workspace.createProject({ bundle, source });
    store.loadEditor(await workspace.readActiveBundle());
    return sendJson(res, { project, projects: await workspace.listProjects() });
  }

  const projectRoute = matchProjectPath(path);
  if (projectRoute?.action === "open" && req.method === "POST") {
    const project = await workspace.openProject(projectRoute.id);
    store.loadEditor(await workspace.readActiveBundle());
    return sendJson(res, { project });
  }

  if (projectRoute?.action === null && req.method === "PATCH") {
    await workspace.openProject(projectRoute.id);
    store.loadEditor(await workspace.readActiveBundle());
    if (typeof body?.title === "string") store.editor.setMetadata({ title: body.title });
    await persistEditor();
    return sendJson(res, { project: (await workspace.listProjects()).find((entry) => entry.id === projectRoute.id) });
  }

  if (projectRoute?.action === null && req.method === "DELETE") {
    const result = await workspace.deleteProject(projectRoute.id);
    store.loadEditor(await workspace.readActiveBundle());
    return sendJson(res, { ...result, projects: await workspace.listProjects() });
  }

  if (path === "/api/editor" && req.method === "GET") {
    return sendJson(res, {
      metadata: store.editor.metadata,
      assets: store.editor.assets,
      cards: store.editor.toCards(),
      validation: store.editor.validate(),
      playerValidation: store.editor.validateForPlayer()
    });
  }

  if (path === "/api/samples" && req.method === "GET") {
    return sendJson(res, { samples: await listSamples() });
  }

  const sampleMatch = path.match(/^\/api\/samples\/([a-z0-9-]+)$/);
  if (sampleMatch && req.method === "GET") {
    const sample = await readSample(sampleMatch[1]);
    if (!sample) throw apiError("Unknown sample", "sample_not_found", 404);
    return sendJson(res, sample);
  }

  if (path === "/api/editor/import" && req.method === "POST") {
    const editor = store.loadEditor(body?.bundle ?? body?.content ?? body);
    await persistEditor();
    return sendJson(res, {
      imported: true,
      cardCount: editor.cardCount(),
      validation: editor.validate()
    });
  }

  if (path === "/api/editor/upload" && req.method === "POST") {
    const text = typeof body === "string" ? body : body?.content;
    if (typeof text !== "string") {
      throw new Error("upload requires a 'content' string field");
    }
    const editor = store.loadEditor(text);
    await persistEditor();
    return sendJson(res, {
      imported: true,
      cardCount: editor.cardCount(),
      validation: editor.validate()
    });
  }

  if (path === "/api/editor/cards" && req.method === "POST") {
    const card = store.editor.addCard(body.card);
    store.markEdited();
    await persistEditor();
    return sendJson(res, { card, validation: store.editor.validate() });
  }

  if (path.startsWith("/api/editor/cards/") && req.method === "PUT" && isCardRootPath(path)) {
    const cardId = decodeURIComponent(path.slice("/api/editor/cards/".length));
    const card = store.editor.updateCard(cardId, body.changes ?? {});
    store.markEdited();
    await persistEditor();
    return sendJson(res, { card, validation: store.editor.validate() });
  }

  if (path.startsWith("/api/editor/cards/") && req.method === "DELETE" && isCardRootPath(path)) {
    const cardId = decodeURIComponent(path.slice("/api/editor/cards/".length));
    const removed = store.editor.removeCard(cardId);
    store.markEdited();
    await persistEditor();
    return sendJson(res, { removed, validation: store.editor.validate() });
  }

  if (path === "/api/editor/metadata" && req.method === "PATCH") {
    const metadata = store.editor.setMetadata(body.metadata ?? {});
    store.markEdited();
    await persistEditor();
    return sendJson(res, { metadata });
  }

  const assetMatch = path.match(/^\/api\/editor\/assets\/([^/]+)$/);
  if (assetMatch && req.method === "PATCH") {
    const asset = store.editor.setAssetDisplay(decodeURIComponent(assetMatch[1]), body?.display);
    store.markEdited();
    await persistEditor();
    return sendJson(res, {
      asset,
      validation: store.editor.validate(),
      playerValidation: store.editor.validateForPlayer()
    });
  }

  if (path === "/api/editor/snapshot" && req.method === "GET") {
    return sendJson(res, { bundle: store.editor.toBundle(), validation: store.editor.validate() });
  }

  if (path === "/api/editor/restore" && req.method === "POST") {
    const editor = store.loadEditor(body?.bundle ?? body);
    await persistEditor();
    return sendJson(res, {
      restored: true,
      cardCount: editor.cardCount(),
      validation: editor.validate(),
      playerValidation: editor.validateForPlayer()
    });
  }

  const choiceMatch = matchChoicePath(path);
  if (choiceMatch) {
    return handleChoiceRoute(req, res, choiceMatch, body);
  }

  if (path === "/api/editor/validate" && req.method === "GET") {
    return sendJson(res, {
      validation: store.editor.validate(),
      playerValidation: store.editor.validateForPlayer(),
      playerReady: store.editor.validateForPlayer().valid
    });
  }

  if (path === "/api/editor/graph" && req.method === "GET") {
    return sendJson(res, getCardGraph({ cards: store.editor.toCards() }));
  }

  if (path === "/api/editor/tags" && req.method === "GET") {
    return sendJson(res, deriveTagCatalog({ cards: store.editor.toCards(), metadata: store.editor.metadata }));
  }

  if (path === "/api/editor/story-groups" && req.method === "GET") {
    return sendJson(res, deriveStoryGroups({ cards: store.editor.toCards(), metadata: store.editor.metadata }));
  }

  if (path === "/api/diagnostics/run" && req.method === "POST") {
    const cards = store.editor.toCards();
    const reviewInput = {
      cards,
      metadata: store.editor.metadata,
      cycles: normalizeDiagnosticLimit(body?.cycles ?? 1000, "cycles", MAX_CREATOR_DIAGNOSTIC_CYCLES),
      maxTurns: normalizeDiagnosticLimit(body?.maxTurns ?? 50, "maxTurns", MAX_DIAGNOSTIC_TURNS),
      seed: Number(body?.seed ?? 1)
    };
    if (wantsProgressStream(req)) {
      // Opt-in NDJSON: real simulated-cycle progress, then the same projection.
      // The deck can change while the event loop is free: only publish a result for the deck
      // (and project) it was computed from.
      const startProjectId = (await workspace.getConfig()).activeProjectId;
      const startDeck = JSON.stringify({ cards: reviewInput.cards, metadata: reviewInput.metadata });
      return streamWithProgress(res, async (progress) => {
        const projection = await runDiagnosticsAsync({ ...reviewInput, onProgress: progress });
        const currentProjectId = (await workspace.getConfig()).activeProjectId;
        if (currentProjectId !== startProjectId || JSON.stringify({ cards: store.editor.toCards(), metadata: store.editor.metadata }) !== startDeck) {
          throw apiError("The deck changed while Review was running; run Review again", "diagnostics_stale", 409);
        }
        store.lastDiagnostics = projection;
        return projection;
      });
    }
    const projection = runDiagnostics(reviewInput);
    store.lastDiagnostics = projection;
    return sendJson(res, projection);
  }

  if (path === "/api/diagnostics/feedback" && req.method === "POST") {
    return sendJson(res, summarizeFeedback(body.report ?? body));
  }

  if (path === "/api/diagnostics/project" && req.method === "POST") {
    return sendJson(res, summarizeDiagnostics(body.report ?? body));
  }

  if (path === "/api/connector/plan" && req.method === "POST") {
    const config = createConnectorConfig(body.config ?? body);
    const plan = buildGenerationPlan({ config, diagnostics: body.diagnostics ?? null });
    return sendJson(res, plan);
  }

  if (path === "/api/ai/edit/plan" && req.method === "POST") {
    const mode = body?.mode ?? "generate_cards";
    const diagnostics = body?.diagnostics ?? (mode === "repair_diagnostics" ? store.lastDiagnostics : null);
    if (mode === "repair_diagnostics" && !diagnostics) {
      return sendJson(res, {
        error: {
          message: "Run Review before building repair proposals",
          code: "diagnostics_required"
        }
      });
    }
    const credentials = await resolveCredentials(body?.credentials, body?.config);
    // Closing the request (Cancel in the UI, or a closed tab) cancels the model call and the loop.
    const cancel = new AbortController();
    res.once("close", () => { if (!res.writableEnded) cancel.abort(); });
    const fetchImpl = await countedFetch();
    const isRepairLoop = mode === "repair_diagnostics" && body?.verify !== false;
    const buildPlan = async (onProgress = null) => {
      if (isRepairLoop) {
        // Verified repair loop: proposals are scored on copies; nothing is written here.
        return buildVerifiedRepairPlan({
          editor: store.editor,
          getEditor: () => store.editor,
          config: body?.config ?? {},
          credentials,
          instruction: body?.instruction ?? "",
          targetCardId: body?.targetCardId ?? null,
          repairTarget: body?.repairTarget ?? null,
          diagnostics,
          onProgress,
          fetchImpl,
          signal: cancel.signal,
          priorAttempts: await priorRepairAttempts(body?.repairTarget)
        });
      }
      return buildAiEditPlanAsync({
        editor: store.editor,
        config: body?.config ?? {},
        credentials,
        mode,
        instruction: body?.instruction ?? "",
        targetCardId: body?.targetCardId ?? null,
        assetId: body?.assetId ?? null,
        diagnostics,
        onProgress,
        fetchImpl,
        signal: cancel.signal,
        selection: body?.selection ?? null
      });
    };
    // Every AI request (repair loop, draft, selection action) leaves one key-free activity record,
    // written to the project that started it even if the author switches projects meanwhile.
    const historyProjectId = (await workspace.getConfig()).activeProjectId;
    const startedAt = Date.now();
    const record = (outcome) => isRepairLoop
      ? recordRepairHistory({ ...outcome, body, credentials, projectId: historyProjectId })
      : recordAiActivity({ ...outcome, kind: body?.selection ? "selection" : "draft", body, credentials, projectId: historyProjectId, durationMs: Date.now() - startedAt });
    const buildAndRecord = async (onProgress = null) => {
      let plan;
      try {
        plan = await buildPlan(onProgress);
      } catch (error) {
        await record({ error });
        throw error;
      }
      const historyId = await record({ plan });
      // The plan names its project (covered by the signature) so apply cannot cross projects.
      return signPlan({ ...plan, projectId: historyProjectId, ...(historyId ? { historyId } : {}) });
    };
    if (wantsProgressStream(req)) return streamWithProgress(res, buildAndRecord);
    return sendJson(res, await buildAndRecord());
  }

  if (path === "/api/ai/repair-history" && req.method === "GET") {
    if (url.searchParams.get("full") === "1") {
      // Export: every stored record in full (already key-free and URL-redacted).
      const summaries = await workspace.listRepairHistory();
      const records = [];
      for (const entry of summaries) records.push(await workspace.readRepairHistoryRecord(entry.id));
      return sendJson(res, { exportedAt: new Date().toISOString(), records });
    }
    return sendJson(res, { records: await workspace.listRepairHistory() });
  }

  if (path === "/api/ai/session-usage" && req.method === "GET") {
    const limit = (await workspace.getConfig()).ai.sessionRequestLimit ?? 0;
    return sendJson(res, { used: aiRequestsUsed, limit, remaining: limit > 0 ? Math.max(0, limit - aiRequestsUsed) : null });
  }

  if (path === "/api/ai/repair-history" && req.method === "DELETE") {
    return sendJson(res, await workspace.clearRepairHistory());
  }

  const historyRoute = path.match(/^\/api\/ai\/repair-history\/([^/]+)$/);
  if (historyRoute && req.method === "GET") {
    return sendJson(res, { record: await workspace.readRepairHistoryRecord(decodeURIComponent(historyRoute[1])) });
  }
  if (historyRoute && req.method === "DELETE") {
    return sendJson(res, await workspace.deleteRepairHistoryRecord(decodeURIComponent(historyRoute[1])));
  }

  if (path === "/api/ai/edit/validate" && req.method === "POST") {
    const result = await validateAiEditEndpointConfig({
      editor: store.editor,
      config: body?.config ?? {},
      credentials: await resolveCredentials(body?.credentials, body?.config),
      fetchImpl: await countedFetch()
    });
    return sendJson(res, result);
  }

  if (path === "/api/ai/edit/models" && req.method === "POST") {
    const result = await listAiEditEndpointModels({
      config: body?.config ?? {},
      credentials: await resolveCredentials(body?.credentials, body?.config),
      fetchImpl: await countedFetch()
    });
    return sendJson(res, result);
  }

  if (path === "/api/ai/edit/apply" && req.method === "POST") {
    assertSignedPlan(body?.plan);
    const activeProjectId = (await workspace.getConfig()).activeProjectId;
    if (body?.plan?.projectId && body.plan.projectId !== activeProjectId) {
      throw apiError("This draft was built in another project; open that project or build the draft again here", "ai_plan_other_project", 409);
    }
    const result = applyAiEditPlan({
      editor: store.editor,
      plan: body?.plan,
      proposalIds: body?.proposalIds ?? []
    });
    store.replaceEditor(result.editor);
    await persistEditor();
    const historyId = await markRepairHistory(body?.historyId ?? body?.plan?.historyId, result.proposalIds, body?.plan?.projectId ?? activeProjectId);
    return sendJson(res, {
      applied: result.applied,
      ...(historyId ? { historyId } : {}),
      proposalIds: result.proposalIds,
      patchCount: result.patchCount,
      bundle: result.bundle,
      validation: result.validation,
      playerValidation: result.playerValidation
    });
  }

  if (path === "/api/ai/images/validate" && req.method === "POST") {
    return sendJson(res, inspectImageEndpointConfig({ config: body?.config ?? {} }));
  }

  if (path === "/api/ai/images/run" && req.method === "POST") {
    const draftId = randomId();
    const request = body?.request ?? {};
    const inputDraftIds = stagedInputDraftIds(request);
    const controller = new AbortController();
    const abortOnDisconnect = () => { if (!res.writableEnded) controller.abort(); };
    req.once("aborted", abortOnDisconnect);
    res.once("close", abortOnDisconnect);
    const inputs = [];
    let aggregateBytes = 0;
    for (const uri of [...new Set(request.references ?? [])]) {
      const bytes = await workspace.readActiveProjectAsset(uri);
      if (!bytes) throw apiError(`Project image '${uri}' was not found`, "image_input_not_found");
      aggregateBytes += bytes.byteLength;
      if (aggregateBytes > 50 * 1024 * 1024) throw apiError("Image inputs exceed the 50 MiB request limit", "image_input_limit");
      inputs.push({ id: uri, name: basename(uri), bytes, role: "reference" });
    }
    if (request.mask) {
      const bytes = await workspace.readActiveProjectAsset(request.mask);
      if (!bytes) throw apiError(`Project image '${request.mask}' was not found`, "image_input_not_found");
      aggregateBytes += bytes.byteLength;
      if (aggregateBytes > 50 * 1024 * 1024) throw apiError("Image inputs exceed the 50 MiB request limit", "image_input_limit");
      inputs.push({ id: request.mask, name: basename(request.mask), bytes, role: "mask" });
    }
    const imageStartedAt = Date.now();
    const imageProjectId = (await workspace.getConfig()).activeProjectId;
    const imageCredentials = await resolveImageCredentials(body?.credentials, body?.config);
    let generated;
    try {
      generated = await buildImageOperationDraft({
        editor: store.editor,
        config: body?.config ?? {},
        credentials: imageCredentials,
        request,
        inputs,
        signal: controller.signal,
        fetchImpl: await countedFetch()
      });
    } catch (error) {
      await recordAiActivity({ kind: "image", error: controller.signal.aborted ? Object.assign(error, { code: "ai_cancelled" }) : error, image: { operation: request.operation, prompt: request.prompt, model: body?.config?.modelId }, body: { source: "AI Assist" }, credentials: imageCredentials, projectId: imageProjectId, durationMs: Date.now() - imageStartedAt });
      throw error;
    }
    await recordAiActivity({ kind: "image", image: { operation: generated.operation ?? request.operation, prompt: request.prompt, model: generated.provider?.model ?? body?.config?.modelId, outputs: generated.outputs?.length ?? 0 }, body: { source: "AI Assist" }, credentials: imageCredentials, projectId: imageProjectId, durationMs: Date.now() - imageStartedAt });
    const outputs = [];
    for (const [index, output] of generated.outputs.entries()) {
      const extension = output.mimeType === "image/jpeg" ? "jpg" : output.mimeType.split("/")[1];
      const staged = await workspace.stageActiveProjectAsset({ draftId, fileName: `output-${index + 1}.${extension}`, bytes: output.bytes, mimeType: output.mimeType });
      outputs.push({ id: `output-${index + 1}`, ...staged, previewUrl: projectAssetUrl(staged.uri) });
    }
    const draft = { ...generated, draftId, outputs, inputDraftIds };
    imageDrafts.set(draftId, draft);
    return sendJson(res, draft);
  }

  if (path === "/api/ai/images/apply" && req.method === "POST") {
    const draft = imageDrafts.get(body?.draftId);
    if (!draft) throw apiError("Image draft was not found or has expired", "image_draft_not_found");
    const output = draft.outputs.find((entry) => entry.id === body?.outputId);
    if (!output) throw apiError("Selected image output was not found", "image_output_not_found");
    const committed = await workspace.commitActiveProjectAsset(output.uri);
    const cardId = body?.cardId || draft.request?.targetCardId || undefined;
    const asset = {
      id: body?.assetId || draft.request?.targetAssetId || `generated-${committed.sha256.slice(0, 12)}`,
      ...(cardId ? { cardId } : {}),
      uri: committed.uri,
      title: body?.title || draft.request?.prompt || "Generated card art",
      source: { type: "ai-image", protocol: draft.provider.protocol, model: draft.provider.model, operation: draft.operation },
      metadata: { mimeType: committed.mimeType, sha256: committed.sha256 }
    };
    const result = applyImageDraftAsset({ editor: store.editor, draft, outputId: output.id, asset });
    store.replaceEditor(result.editor);
    await persistEditor();
    await workspace.discardActiveProjectAssetDraft(draft.draftId);
    for (const inputDraftId of draft.inputDraftIds ?? []) await workspace.discardActiveProjectAssetDraft(inputDraftId);
    imageDrafts.delete(draft.draftId);
    return sendJson(res, { applied: true, outputId: output.id, asset: result.asset, bundle: result.bundle, validation: result.validation, playerValidation: result.playerValidation });
  }

  const imageDraftPath = path.match(/^\/api\/ai\/images\/drafts\/([^/]+)$/);
  if (imageDraftPath && req.method === "DELETE") {
    const draftId = decodeURIComponent(imageDraftPath[1]);
    const draft = imageDrafts.get(draftId);
    await workspace.discardActiveProjectAssetDraft(draftId);
    for (const inputDraftId of draft?.inputDraftIds ?? []) await workspace.discardActiveProjectAssetDraft(inputDraftId);
    imageDrafts.delete(draftId);
    return sendJson(res, { discarded: true, draftId });
  }

  if (path === "/api/play/start" && req.method === "POST") {
    const cards = store.editor.toCards();
    const playerValidation = validatePlayerCards(cards);
    if (!playerValidation.valid) {
      return sendJson(res, {
        error: { message: "Cards are not player-ready", validation: playerValidation }
      });
    }
    const session = createPlaySession({
      cards,
      metadata: store.editor.metadata,
      locale: body?.locale,
      rng: Math.random
    });
    const sessionId = `s_${Date.now().toString(36)}`;
    store.sessions.set(sessionId, session);
    const card = session.start();
    return sendJson(res, {
      sessionId,
      turn: session.turn,
      factions: session.factions,
      gauges: projectFactionGauges(session.factions, store.editor.metadata?.presentation),
      currentCard: card,
      gameOver: session.gameOver
    });
  }

  if (path === "/api/play/swipe" && req.method === "POST") {
    const session = store.sessions.get(body.sessionId);
    if (!session) {
      throw new Error(`Unknown sessionId '${body.sessionId}'`);
    }
    const result = session.swipe(body.direction);
    return sendJson(res, {
      sessionId: body.sessionId,
      turn: session.turn,
      factions: result.factions,
      gauges: projectFactionGauges(result.factions, store.editor.metadata?.presentation),
      currentCard: result.nextCard,
      gameOver: result.gameOver
    });
  }

  if (path === "/api/build/prepare" && req.method === "POST") {
    const build = prepareGameBuild({
      editor: store.editor,
      config: body?.config ?? null,
      buildId: body?.buildId ?? null
    });
    return sendJson(res, { build });
  }

  if (path === "/api/build/export" && req.method === "POST") {
    const build = prepareGameBuild({
      editor: store.editor,
      config: body?.config ?? null,
      buildId: body?.buildId ?? null
    });
    const outputPath = body?.outputPath ?? join(defaultBuildOutputDir, `${build.buildId}.game.json`);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, serializeBuild(build), "utf8");
    return sendJson(res, { exported: true, outputPath, buildId: build.buildId });
  }

  if (path === "/api/releases" && req.method === "GET") {
    return sendJson(res, {
      capability: await windowsReleaseCapability({ enabled: enableWindowsRelease, playerHostPath: resolvedWindowsPlayerHostPath }),
      releases: (await workspace.listReleases()).map((release) => ({
        ...release,
        downloadUrl: releaseArtifactUrl(release.id)
      }))
    });
  }

  if (path === "/api/releases/windows-x64" && req.method === "POST") {
    const capability = await windowsReleaseCapability({ enabled: enableWindowsRelease, playerHostPath: resolvedWindowsPlayerHostPath });
    if (!capability.windowsX64) {
      const error = new Error(`Windows release is unavailable: ${capability.reason}`);
      error.code = capability.reason;
      throw error;
    }
    const release = await buildWindowsPlayerRelease({
      editor: store.editor,
      interfaceWebRoot: resolvedInterfaceWebRoot,
      coreSourcePath: join(rootDir, "packages/core/src/index.js"),
      playerHostPath: resolvedWindowsPlayerHostPath,
      workspace
    });
    return sendJson(res, { released: true, release });
  }

  const releaseRoute = matchReleasePath(path);
  if (releaseRoute?.action === "artifact" && req.method === "GET") {
    const { record, artifactPath } = await workspace.resolveReleaseArtifact(releaseRoute.id);
    return sendArtifact(req, res, artifactPath, basename(record.artifactRelativePath));
  }
  if (releaseRoute?.action === null && req.method === "DELETE") {
    return sendJson(res, await workspace.deleteRelease(releaseRoute.id));
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { message: `Unknown API route: ${req.method} ${path}` } }));
}

/**
 * isCardRootPath returns true only when the path targets a whole card
 * (a single segment after /api/editor/cards/), so granular choice routes
 * like /api/editor/cards/:id/choices/:cid/... are not shadowed.
 */
function isCardRootPath(path) {
  const rest = path.slice("/api/editor/cards/".length);
  return rest.length > 0 && !rest.includes("/");
}

/**
 * matchChoicePath recognizes the granular choice-editing routes:
 *   PATCH  /api/editor/cards/:cardId/choices/:choiceId          { label?, effects? }
 *   POST   /api/editor/cards/:cardId/choices/:choiceId/effects/faction/:faction  { delta }
 *   POST   /api/editor/cards/:cardId/choices/:choiceId/effects/tag/:tag          { value }
 *   POST   /api/editor/cards/:cardId/choices/:choiceId/effects/variable/:variable { value }
 *   DELETE /api/editor/cards/:cardId/choices/:choiceId/effects/faction/:faction
 *   DELETE /api/editor/cards/:cardId/choices/:choiceId/effects/tag/:tag
 *   DELETE /api/editor/cards/:cardId/choices/:choiceId/effects/variable/:variable
 * Returns a descriptor object or null when the path is not a choice route.
 */
function matchChoicePath(path) {
  const prefix = "/api/editor/cards/";
  if (!path.startsWith(prefix)) {
    return null;
  }

  const rest = path.slice(prefix.length);
  const segments = rest.split("/").map(decodeURIComponent);
  const [cardId, choicesSegment, choiceId, effectsSegment, kind, target] = segments;

  if (choicesSegment !== "choices" || !cardId || !choiceId) {
    return null;
  }

  if (effectsSegment === undefined) {
    return { route: "choice", cardId, choiceId };
  }

  if (effectsSegment !== "effects" || !kind || !target) {
    return null;
  }

  if (!["faction", "tag", "variable"].includes(kind)) {
    return null;
  }

  return { route: "effect", cardId, choiceId, kind, target };
}

async function handleChoiceRoute(req, res, match, body) {
  if (match.route === "choice") {
    if (req.method !== "PATCH") {
      throw new Error(`Choice route requires PATCH, got ${req.method}`);
    }
    let card;
    if (body?.label !== undefined) {
      card = store.editor.setChoiceLabel(match.cardId, match.choiceId, body.label);
    }
    if (body?.effects !== undefined) {
      card = store.editor.setChoiceEffects(match.cardId, match.choiceId, body.effects);
    }
    store.markEdited();
    await persistEditor();
    return sendJson(res, { card, validation: store.editor.validate() });
  }

  if (req.method !== "POST" && req.method !== "DELETE") {
    throw new Error(`Effect route requires POST or DELETE, got ${req.method}`);
  }

  const card = store.editor.findCard(match.cardId);
  if (!card) {
    throw new Error(`Card '${match.cardId}' was not found`);
  }
  const choice = card.choices?.find((candidate) => candidate.id === match.choiceId);
  if (!choice) {
    throw new Error(`Choice '${match.choiceId}' was not found on card '${match.cardId}'`);
  }

  const effects = { ...(choice.effects ?? {}) };
  const bucket = match.kind === "faction" ? "factions" : `${match.kind}s`;

  if (req.method === "DELETE") {
    delete effects[bucket]?.[match.target];
  } else {
    const value = body?.value;
    if (value === undefined) {
      throw new Error(`Effect route requires a 'value' field for ${match.kind}`);
    }
    if (value === null || (match.kind !== "variable" && value === false)) {
      delete effects[bucket]?.[match.target];
    } else {
      effects[bucket] = { ...(effects[bucket] ?? {}), [match.target]: value };
    }
  }

  // Clean up emptied sub-objects so the stored effects stay tidy.
  for (const key of ["factions", "tags", "variables"]) {
    if (effects[key] !== undefined && Object.keys(effects[key]).length === 0) {
      delete effects[key];
    }
  }

  const updated = store.editor.setChoiceEffects(match.cardId, match.choiceId, effects);
  store.markEdited();
  await persistEditor();
  return sendJson(res, { card: updated, validation: store.editor.validate() });
}

async function readJsonBody(req) {
  if (req.method === "GET" || req.method === "DELETE") {
    return null;
  }
  const bytes = await readBodyBytes(req, MAX_JSON_BODY_BYTES, {
    message: "Request body exceeds the 10 MiB JSON limit",
    code: "request_body_too_large",
    statusCode: 413
  });
  const text = bytes.toString("utf8").trim();
  if (text === "") {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Request body is not valid JSON: ${error.message}`);
  }
}

function signPlan(plan) {
  const { planToken: _ignored, ...content } = plan ?? {};
  return { ...content, planToken: planDigest(content) };
}

function assertSignedPlan(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return; // applyAiEditPlan reports the shape error
  const { planToken, ...content } = plan;
  const expected = planDigest(content);
  if (typeof planToken !== "string" || !safeTokenEqual(planToken, expected)) {
    throw apiError("This AI edit plan was not issued by this Creator session or was changed after it was issued; build the draft again", "ai_plan_untrusted", 409);
  }
}

function planDigest(content) {
  return createHmac("sha256", planSigningKey).update(canonicalJson(content)).digest("base64url");
}

// countedFetch counts every AI endpoint request against the session limit before sending it.
async function countedFetch() {
  const limit = (await workspace.getConfig()).ai.sessionRequestLimit ?? 0;
  return async (input, init) => {
    if (limit > 0 && aiRequestsUsed >= limit) {
      throw apiError(`This Creator session reached its AI request limit (${limit}). Raise it in Settings or restart the Creator.`, "ai_session_budget", 429);
    }
    aiRequestsUsed += 1;
    return fetch(input, init);
  };
}

// Blocked proposals from the last runs on the same issue, so round 1 does not repeat them.
async function priorRepairAttempts(repairTarget) {
  if (!repairTarget?.code) return [];
  try {
    const wanted = new Set((Array.isArray(repairTarget.cardIds) ? repairTarget.cardIds : []).map((cardId) => `card:${cardId}`));
    const matches = (await workspace.listRepairHistory())
      .filter((entry) => entry.kind === "repair_loop" && entry.targets.some((target) => target.code === repairTarget.code && (wanted.size === 0 || wanted.has(target.entity))))
      .slice(0, 2);
    const attempts = [];
    for (const entry of matches) {
      const stored = await workspace.readRepairHistoryRecord(entry.id);
      for (const round of stored.rounds ?? []) {
        for (const proposal of round.proposals ?? []) {
          if (!proposal.passed && attempts.length < 4) attempts.push({ proposalId: proposal.id, title: proposal.title, failedChecks: (proposal.failedDetails ?? []).length ? proposal.failedDetails : (proposal.failedChecks ?? []).map((id) => ({ id })) });
        }
      }
    }
    return attempts;
  } catch {
    return [];
  }
}

async function recordAiActivity({ kind, plan = null, error = null, image = null, body = {}, credentials = {}, projectId = null, durationMs = null }) {
  try {
    const record = createAiActivityRecord({
      kind,
      plan,
      error,
      image,
      request: { source: body?.source, mode: body?.mode, instruction: body?.instruction, selection: body?.selection },
      id: `rh-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`,
      durationMs,
      secrets: [credentials?.apiKey, body?.credentials?.apiKey]
    });
    const stored = await workspace.appendRepairHistoryRecord(record, { projectId });
    return stored.record.id;
  } catch (historyError) {
    console.warn(`AI activity was not saved: ${historyError?.message ?? historyError}`);
    return null;
  }
}

async function recordRepairHistory({ plan = null, error = null, body = {}, credentials = {}, projectId = null }) {
  try {
    const record = createRepairHistoryRecord({
      plan,
      error,
      request: { instruction: body?.instruction, repairTarget: body?.repairTarget, source: body?.source },
      id: `rh-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`,
      secrets: [credentials?.apiKey, body?.credentials?.apiKey]
    });
    const stored = await workspace.appendRepairHistoryRecord(record, { projectId });
    return stored.record.id;
  } catch (historyError) {
    // History is an audit aid; failing to write it must never break drafting.
    console.warn(`Repair history was not saved: ${historyError?.message ?? historyError}`);
    return null;
  }
}

async function markRepairHistory(historyId, proposalIds, projectId = null) {
  if (typeof historyId !== "string" || !historyId.startsWith("rh-")) return null;
  try {
    await workspace.updateRepairHistoryRecord(historyId, (record) => markRepairHistoryApplied(record, { proposalIds }), { projectId });
    return historyId;
  } catch {
    return null;
  }
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((entry) => (entry === undefined ? "null" : canonicalJson(entry))).join(",")}]`;
  return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function wantsProgressStream(req) {
  return String(req.headers.accept ?? "").includes("application/x-ndjson");
}

/**
 * streamWithProgress answers with NDJSON: `{"type":"progress",...}` lines while `work`
 * runs, then one `{"type":"result","result":...}` or `{"type":"error","error":...}` line.
 * Errors after the header keep the 200 status; the client reads the error line.
 */
async function streamWithProgress(res, work) {
  res.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  let lastStage = null;
  const progress = (event) => {
    if (event?.stage) lastStage = event.stage;
    if (!res.writableEnded && !res.destroyed) res.write(`${JSON.stringify({ type: "progress", ...event })}\n`);
  };
  try {
    const result = await work(progress);
    if (!res.destroyed) res.end(`${JSON.stringify({ type: "result", result })}\n`);
  } catch (error) {
    const payload = { name: error?.name, message: error?.message ?? String(error), code: error?.code ?? "internal_error", stage: error?.stage ?? lastStage };
    if (!res.writableEnded && !res.destroyed) res.end(`${JSON.stringify({ type: "error", error: payload })}\n`);
  }
}

function sendJson(res, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  res.end(body);
}

async function readSample(id) {
  const file = id === DEFAULT_SAMPLE_ID ? samplePath : (Object.hasOwn(BUNDLED_SAMPLE_FILES, id) ? BUNDLED_SAMPLE_FILES[id] : null);
  if (!file) return null;
  try {
    return JSON.parse(await readFile(id === DEFAULT_SAMPLE_ID ? file : join(rootDir, file), "utf8"));
  } catch {
    return id === DEFAULT_SAMPLE_ID ? { cards: [] } : null;
  }
}

async function listSamples() {
  const samples = [];
  for (const id of [DEFAULT_SAMPLE_ID, ...Object.keys(BUNDLED_SAMPLE_FILES)]) {
    const bundle = await readSample(id);
    if (bundle) samples.push({ id, title: bundle.metadata?.title ?? id, description: bundle.metadata?.description ?? "", cardCount: bundle.cards?.length ?? 0 });
  }
  return samples;
}

function matchProjectPath(path) {
  const match = path.match(/^\/api\/projects\/([^/]+)(?:\/(open))?$/);
  return match ? { id: decodeURIComponent(match[1]), action: match[2] ?? null } : null;
}

function matchReleasePath(path) {
  const match = path.match(/^\/api\/releases\/([^/]+)(?:\/(artifact))?$/);
  return match ? { id: decodeURIComponent(match[1]), action: match[2] ?? null } : null;
}

function sendArtifact(req, res, path, fileName) {
  return new Promise((resolveSend, rejectSend) => {
    const stream = createReadStream(path);
    stream.once("error", (error) => {
      if (res.headersSent) {
        res.destroy(error);
        resolveSend();
      } else {
        rejectSend(error);
      }
    });
    res.writeHead(200, {
      "content-type": "application/vnd.microsoft.portable-executable",
      "content-disposition": `attachment; filename="${fileName.replace(/["\\\r\n]/g, "-")}"`,
      "cache-control": "no-store"
    });
    if (req.method === "HEAD") {
      stream.destroy();
      res.end();
      resolveSend();
      return;
    }
    stream.once("end", resolveSend);
    stream.pipe(res);
  });
}

async function persistEditor() {
  return workspace.saveActiveBundle(store.editor.toBundle());
}

async function resolveCredentials(credentials, config) {
  if (typeof credentials?.apiKey === "string" && credentials.apiKey.trim()) return credentials;
  const persisted = await workspace.getConfig();
  if (!sameEndpoint(config?.endpoint, persisted.ai.endpoint)) return credentials ?? {};
  const storedApiKey = await workspace.getStoredApiKey();
  return storedApiKey ? { ...(credentials ?? {}), apiKey: storedApiKey } : (credentials ?? {});
}

async function resolveImageCredentials(credentials, config) {
  if (typeof credentials?.apiKey === "string" && credentials.apiKey.trim()) return credentials;
  const persisted = await workspace.getConfig();
  const trustedEndpoint = config?.credentialMode === "inherit_text"
    ? persisted.ai.endpoint
    : persisted.ai.image.endpoint;
  if (!sameEndpoint(config?.endpoint, trustedEndpoint)) return credentials ?? {};
  const storedApiKey = config?.credentialMode === "inherit_text"
    ? await workspace.getStoredApiKey()
    : await workspace.getStoredImageApiKey();
  return storedApiKey ? { ...(credentials ?? {}), apiKey: storedApiKey } : (credentials ?? {});
}

async function sendProjectAsset(res, uri) {
  let bytes = await workspace.readActiveProjectAsset(uri);
  if (!bytes && /^assets\/sample\/[A-Za-z0-9._-]+$/.test(uri) && !uri.includes("..")) {
    // Bundled sample art ships with the interface, not with each project copy.
    bytes = await readFile(join(resolvedInterfaceWebRoot, uri)).catch(() => null);
  }
  if (!bytes) throw apiError("Project asset was not found", "project_asset_not_found");
  const extension = extname(uri).toLowerCase();
  res.writeHead(200, {
    "content-type": MIME_TYPES[extension] ?? "application/octet-stream",
    "content-length": bytes.byteLength,
    "cache-control": uri.includes("/.drafts/") ? "no-store" : "public, max-age=31536000, immutable"
  });
  res.end(bytes);
}

async function readBinaryBody(req, limit) {
  const bytes = await readBodyBytes(req, limit, {
    message: "Request body exceeds the image size limit",
    code: "image_input_limit",
    statusCode: 413
  });
  if (!bytes.byteLength) throw apiError("Image upload is empty", "image_input_required");
  return bytes;
}

async function readBodyBytes(req, limit, { message, code, statusCode }) {
  const declaredLength = String(req.headers["content-length"] ?? "").trim();
  if (/^\d+$/.test(declaredLength) && Number(declaredLength) > limit) {
    req.resume();
    throw apiError(message, code, statusCode);
  }
  return new Promise((resolve, reject) => {
    let chunks = [];
    let size = 0;
    let failure = null;
    req.on("data", (chunk) => {
      if (failure) return;
      size += chunk.byteLength;
      if (size > limit) {
        chunks = [];
        failure = apiError(message, code, statusCode);
        reject(failure);
        return;
      }
      chunks.push(chunk);
    });
    req.once("end", () => {
      if (!failure) resolve(Buffer.concat(chunks, size));
    });
    req.once("aborted", () => {
      if (!failure) reject(apiError("Request body was aborted", "request_body_aborted", 400));
    });
    req.once("error", (error) => {
      if (!failure) reject(error);
    });
  });
}

function normalizeDiagnosticLimit(value, name, limit) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw apiError(`Diagnostics ${name} must be a positive integer`, "diagnostics_option_invalid", 400);
  }
  if (normalized > limit) {
    throw apiError(`Diagnostics ${name} must not exceed ${limit}`, "diagnostics_limit_exceeded", 400);
  }
  return normalized;
}

function randomId() {
  return `img-${crypto.randomUUID()}`;
}

function projectAssetUrl(uri) {
  const query = new URLSearchParams({ [API_CAPABILITY_QUERY]: apiCapability });
  return `/api/project-assets/${encodeURIComponent(uri)}?${query}`;
}

function releaseArtifactUrl(releaseId) {
  const query = new URLSearchParams({ [API_CAPABILITY_QUERY]: apiCapability });
  return `/api/releases/${encodeURIComponent(releaseId)}/artifact?${query}`;
}

function assertTrustedHost(hostHeader) {
  if (typeof hostHeader !== "string" || !trustedRequestHosts.has(hostHeader.toLowerCase())) {
    throw apiError("Request Host is not allowed", "request_host_forbidden", 403);
  }
}

function assertLocalOrigin(originHeader) {
  if (originHeader === undefined) return;
  let origin;
  try {
    origin = new URL(originHeader);
  } catch {
    throw apiError("Request Origin is not allowed", "request_origin_forbidden", 403);
  }
  if (origin.protocol !== "http:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash || !LOOPBACK_HOSTS.has(origin.hostname.toLowerCase())) {
    throw apiError("Request Origin is not allowed", "request_origin_forbidden", 403);
  }
}

function assertApiCapability(req, url) {
  const header = req.headers[API_CAPABILITY_HEADER];
  const queryAllowed = url.pathname.startsWith("/api/project-assets/")
    || /^\/api\/releases\/[^/]+\/artifact$/.test(url.pathname);
  const query = queryAllowed
    ? url.searchParams.get(API_CAPABILITY_QUERY)
    : null;
  const supplied = typeof header === "string" ? header : query;
  if (!safeTokenEqual(supplied, apiCapability)) {
    throw apiError("Creator API capability is missing or invalid", "api_capability_required", 401);
  }
}

function assertJsonContentType(req, path) {
  if (["GET", "HEAD", "DELETE"].includes(req.method) || path === "/api/ai/images/stage") return;
  const contentType = String(req.headers["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    throw apiError("Creator API mutation requests require application/json", "json_content_type_required", 415);
  }
}

function safeTokenEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
}

function sameEndpoint(left, right) {
  const normalizedLeft = normalizeEndpoint(left);
  const normalizedRight = normalizeEndpoint(right);
  return normalizedLeft !== null && normalizedLeft === normalizedRight;
}

function normalizeEndpoint(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    if (!url.protocol || !url.hostname || url.username || url.password) return null;
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function stagedInputDraftIds(request) {
  return [...new Set([...(request?.references ?? []), request?.mask]
    .filter((uri) => typeof uri === "string" && uri.startsWith("assets/.drafts/"))
    .map((uri) => uri.split("/")[2])
    .filter(Boolean))];
}

function apiError(message, code, statusCode) {
  const error = new Error(message);
  error.code = code;
  if (statusCode) error.statusCode = statusCode;
  return error;
}

async function handleReleaseAsset(req, res, url) {
  const pathname = decodeURIComponent(url.pathname);
  if (pathname.includes("\0")) {
    return false;
  }

  if (pathname === "/") {
    res.writeHead(302, { location: "/workbench" });
    res.end();
    return true;
  }

  if (pathname === "/play") {
    return sendFile(req, res, resolvedInterfaceWebRoot, "player.html");
  }

  const creatorRelativePath = pathname === "/workbench" || pathname.startsWith("/workbench/")
    ? "index.html"
    : pathname.replace(/^\/+/, "");
  if (await sendFile(req, res, resolvedStaticRoot, creatorRelativePath)) {
    return true;
  }

  if (pathname.startsWith("/assets/")) {
    return sendFile(req, res, resolvedInterfaceWebRoot, pathname.replace(/^\/+/, ""));
  }

  return false;
}

async function sendFile(req, res, root, relativePath) {
  const filePath = resolve(root, relativePath);
  const relativeFile = relative(resolve(root), filePath);
  if (relativeFile.startsWith("..") || relativeFile === "" || filePath.includes("\0")) {
    return false;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) return false;
    const body = req.method === "HEAD" ? null : await readFile(filePath);
    res.writeHead(200, {
      "content-type": MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream",
      "content-length": fileStat.size,
      "cache-control": extname(filePath) === ".html" ? "no-cache" : "public, max-age=3600"
    });
    res.end(body);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return false;
    }
    throw error;
  }
}

function start({ host = "127.0.0.1", port = 4321 } = {}) {
  if (!LOOPBACK_HOSTS.has(String(host).toLowerCase())) {
    return Promise.reject(apiError("Creator Server must bind to a loopback host", "creator_host_not_loopback"));
  }
  if (server.listening) {
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : port;
    return Promise.resolve({ host, port: actualPort, origin: formatOrigin(host, actualPort), capability: apiCapability });
  }
  return new Promise((resolveStart, rejectStart) => {
    const onError = (error) => rejectStart(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      const origin = formatOrigin(host, actualPort);
      trustedRequestHosts = trustedHostsForPort(actualPort);
      console.log(`ReignsAgent backend API: ${origin}/api/editor`);
      if (resolvedStaticRoot) {
        console.log(`ReignsAgent: ${origin}/workbench`);
      }
      resolveStart({ host, port: actualPort, origin, capability: apiCapability });
    });
  });
}

function close() {
  if (!server.listening) return cleanupTemporaryRoot();
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error) rejectClose(error);
      else cleanupTemporaryRoot().then(resolveClose, rejectClose);
    });
  });
}

function cleanupTemporaryRoot() {
  return temporaryDataRoot ? rm(temporaryDataRoot, { recursive: true, force: true }) : Promise.resolve();
}

return { server, start, close };
}

function formatOrigin(host, port) {
  const displayHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${displayHost}:${port}`;
}

function trustedHostsForPort(port) {
  const suffix = port === 80 ? "" : `:${port}`;
  return new Set([`127.0.0.1${suffix}`, `localhost${suffix}`, `[::1]${suffix}`]);
}
