#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { readFile, writeFile, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyAiEditPlan,
  buildAiEditPlanAsync,
  buildGenerationPlan,
  createCardEditor,
  createConnectorConfig,
  createPlaySession,
  deriveStoryGroups,
  deriveTagCatalog,
  getCardGraph,
  listAiEditEndpointModels,
  loadEditorFromContent,
  prepareGameBuild,
  projectFactionGauges,
  runDiagnostics,
  serializeBuild,
  summarizeDiagnostics,
  summarizeFeedback,
  validateAiEditEndpointConfig,
  validatePlayerCards
} from "../../../packages/interface/src/index.js";
import { createWorkspaceStore } from "../../../packages/workspace/src/index.js";
import { buildWindowsPlayerRelease, windowsReleaseCapability } from "./windows-release.mjs";

const DEFAULT_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
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
  initialBundle: initialBundle ?? await readDefaultSample()
});
const store = new SessionState(await workspace.readActiveBundle());

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  try {
    if (path.startsWith("/api/")) {
      return await handleApi(req, res, url);
    }

    if (resolvedStaticRoot && (req.method === "GET" || req.method === "HEAD")) {
      const served = await handleReleaseAsset(req, res, url);
      if (served) return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: `Not found: ${path}` } }));
  } catch (error) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { name: error.name, message: error.message, code: error.code ?? "internal_error" } }));
  }
});

async function handleApi(req, res, url) {
  const path = url.pathname;
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
    const bundle = body?.bundle ?? (source === "sample" ? await readDefaultSample() : undefined);
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

  if (path === "/api/samples/oss-court" && req.method === "GET") {
    return sendJson(res, JSON.parse(await readFile(samplePath, "utf8")));
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
    const projection = runDiagnostics({
      cards,
      metadata: store.editor.metadata,
      cycles: Number(body?.cycles ?? 1000),
      maxTurns: Number(body?.maxTurns ?? 50),
      seed: Number(body?.seed ?? 1)
    });
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
    const plan = await buildAiEditPlanAsync({
      editor: store.editor,
      config: body?.config ?? {},
      credentials: await resolveCredentials(body?.credentials),
      mode,
      instruction: body?.instruction ?? "",
      targetCardId: body?.targetCardId ?? null,
      assetId: body?.assetId ?? null,
      diagnostics
    });
    return sendJson(res, plan);
  }

  if (path === "/api/ai/edit/validate" && req.method === "POST") {
    const result = await validateAiEditEndpointConfig({
      editor: store.editor,
      config: body?.config ?? {},
      credentials: await resolveCredentials(body?.credentials)
    });
    return sendJson(res, result);
  }

  if (path === "/api/ai/edit/models" && req.method === "POST") {
    const result = await listAiEditEndpointModels({
      config: body?.config ?? {},
      credentials: await resolveCredentials(body?.credentials)
    });
    return sendJson(res, result);
  }

  if (path === "/api/ai/edit/apply" && req.method === "POST") {
    const result = applyAiEditPlan({
      editor: store.editor,
      plan: body?.plan,
      proposalIds: body?.proposalIds ?? []
    });
    store.replaceEditor(result.editor);
    await persistEditor();
    return sendJson(res, {
      applied: result.applied,
      proposalIds: result.proposalIds,
      patchCount: result.patchCount,
      bundle: result.bundle,
      validation: result.validation,
      playerValidation: result.playerValidation
    });
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
      releases: await workspace.listReleases()
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
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (text === "") {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Request body is not valid JSON: ${error.message}`);
  }
}

function sendJson(res, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

async function readDefaultSample() {
  try {
    return JSON.parse(await readFile(samplePath, "utf8"));
  } catch {
    return { cards: [] };
  }
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

async function resolveCredentials(credentials) {
  if (typeof credentials?.apiKey === "string" && credentials.apiKey.trim()) return credentials;
  const storedApiKey = await workspace.getStoredApiKey();
  return storedApiKey ? { ...(credentials ?? {}), apiKey: storedApiKey } : (credentials ?? {});
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
  if (server.listening) {
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : port;
    return Promise.resolve({ host, port: actualPort, origin: formatOrigin(host, actualPort) });
  }
  return new Promise((resolveStart, rejectStart) => {
    const onError = (error) => rejectStart(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      const origin = formatOrigin(host, actualPort);
      console.log(`ReignsAgent backend API: ${origin}/api/editor`);
      if (resolvedStaticRoot) {
        console.log(`ReignsAgent: ${origin}/workbench`);
      }
      resolveStart({ host, port: actualPort, origin });
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
