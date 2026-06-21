#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildGenerationPlan,
  createCardEditor,
  createConnectorConfig,
  createPlaySession,
  loadEditorFromContent,
  prepareGameBuild,
  projectFactionGauges,
  runDiagnostics,
  serializeBuild,
  summarizeDiagnostics,
  summarizeFeedback,
  validatePlayerCards
} from "../packages/interface/src/index.js";

const PORT = Number(process.env.PORT ?? 4321);
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WEB_ROOT = fileURLToPath(new URL("../packages/interface/web", import.meta.url));
const OSS_SAMPLE_PATH = join(ROOT, "fixtures/content/oss-court.cards.json");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml"
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
  }

  loadEditor(bundleLike) {
    this.editor = loadEditorFromContent(bundleLike);
    this.sessions.clear();
    return this.editor;
  }
}

const store = new SessionState(await readDefaultSample());

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  try {
    if (req.method === "GET" && (path === "/" || path === "/index.html")) {
      return sendFile(res, join(WEB_ROOT, "dashboard.html"));
    }

    if (req.method === "GET" && path === "/play") {
      return sendFile(res, join(WEB_ROOT, "player.html"));
    }

    if (req.method === "GET" && path.startsWith("/assets/")) {
      return sendFile(res, safeWebPath(path));
    }

    if (path.startsWith("/api/")) {
      return handleApi(req, res, url);
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: `Not found: ${path}` } }));
  } catch (error) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { name: error.name, message: error.message } }));
  }
});

async function handleApi(req, res, url) {
  const path = url.pathname;
  const body = await readJsonBody(req);

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
    return sendJson(res, JSON.parse(await readFile(OSS_SAMPLE_PATH, "utf8")));
  }

  if (path === "/api/editor/import" && req.method === "POST") {
    const editor = store.loadEditor(body?.bundle ?? body?.content ?? body);
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
    return sendJson(res, {
      imported: true,
      cardCount: editor.cardCount(),
      validation: editor.validate()
    });
  }

  if (path === "/api/editor/cards" && req.method === "POST") {
    const card = store.editor.addCard(body.card);
    return sendJson(res, { card, validation: store.editor.validate() });
  }

  if (path.startsWith("/api/editor/cards/") && req.method === "PUT" && isCardRootPath(path)) {
    const cardId = decodeURIComponent(path.slice("/api/editor/cards/".length));
    const card = store.editor.updateCard(cardId, body.changes ?? {});
    return sendJson(res, { card, validation: store.editor.validate() });
  }

  if (path.startsWith("/api/editor/cards/") && req.method === "DELETE" && isCardRootPath(path)) {
    const cardId = decodeURIComponent(path.slice("/api/editor/cards/".length));
    const removed = store.editor.removeCard(cardId);
    return sendJson(res, { removed, validation: store.editor.validate() });
  }

  if (path === "/api/editor/metadata" && req.method === "PATCH") {
    const metadata = store.editor.setMetadata(body.metadata ?? {});
    return sendJson(res, { metadata });
  }

  if (path === "/api/editor/snapshot" && req.method === "GET") {
    return sendJson(res, { bundle: store.editor.toBundle(), validation: store.editor.validate() });
  }

  if (path === "/api/editor/restore" && req.method === "POST") {
    const editor = store.loadEditor(body?.bundle ?? body);
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

  if (path === "/api/diagnostics/run" && req.method === "POST") {
    const cards = store.editor.toCards();
    const projection = runDiagnostics({
      cards,
      cycles: Number(body?.cycles ?? 1000),
      maxTurns: Number(body?.maxTurns ?? 50),
      seed: Number(body?.seed ?? 1)
    });
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
      gauges: projectFactionGauges(session.factions),
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
      gauges: projectFactionGauges(result.factions),
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
    const outputPath = body?.outputPath ?? join(process.cwd(), "dist", `${build.buildId}.game.json`);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, serializeBuild(build), "utf8");
    return sendJson(res, { exported: true, outputPath, buildId: build.buildId });
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

function handleChoiceRoute(req, res, match, body) {
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
    if (value === null || value === false) {
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

async function sendFile(res, filePath) {
  if (!existsSync(filePath)) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: `Asset not found: ${filePath}` } }));
    return;
  }
  const contents = await readFile(filePath);
  res.writeHead(200, { "content-type": MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream" });
  res.end(contents);
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
    return JSON.parse(await readFile(OSS_SAMPLE_PATH, "utf8"));
  } catch {
    return { cards: [] };
  }
}

function safeWebPath(requestPath) {
  const candidate = resolve(WEB_ROOT, requestPath.replace(/^\/+/, ""));
  const relativePath = relative(WEB_ROOT, candidate);
  if (relativePath.startsWith("..") || relativePath === "" || resolve(candidate).includes("\0")) {
    throw new Error(`Asset path escapes web root: ${requestPath}`);
  }
  return candidate;
}

server.listen(PORT, () => {
  console.log(`ReignsAgent creator dash:  http://localhost:${PORT}`);
  console.log(`ReignsAgent player preview: http://localhost:${PORT}/play`);
  console.log(`Web root: ${WEB_ROOT}`);
});
