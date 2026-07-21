import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("Phase 4 interface integration", () => {
  it("runs the local creator API from ingest through preview, diagnostics, and build preparation", async () => {
    const port = await reservePort();
    const dataRoot = await mkdtemp(join(tmpdir(), "reigns-phase4-"));
    const server = spawn(process.execPath, ["scripts/dev-server.mjs"], {
      env: { ...process.env, PORT: String(port), REIGNS_AGENT_DATA_ROOT: dataRoot },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stderr = "";
    server.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    try {
      await waitForServer(port, server);
      const initialEditor = await api(port, "/api/editor");
      assert.equal(initialEditor.cards.length, 23);
      assert.equal(initialEditor.assets.length > 0, true);

      const bundle = await api(port, "/api/samples/oss-court");
      assert.equal(bundle.assets.length > 0, true);
      assert.equal(bundle.metadata.i18n.supportedLocales.includes("zh-Hans"), true);

      const imported = await api(port, "/api/editor/import", {
        method: "POST",
        body: { bundle }
      });
      assert.equal(imported.imported, true);
      assert.equal(imported.cardCount, 23);

      const editor = await api(port, "/api/editor");
      assert.equal(editor.playerValidation.valid, true);

      const started = await api(port, "/api/play/start", { method: "POST", body: { locale: "zh-Hans" } });
      assert.match(started.sessionId, /^s_/);
      assert.equal(started.currentCard.choices.some((choice) => choice.id === "left"), true);
      assert.match(started.currentCard.text, /请愿/);
      assert.equal(started.gauges.gauge1.label, "Crowd");
      assert.equal(started.gauges.gauge3.label, "Coin");
      assert.equal(started.turn, 0);

      const swiped = await api(port, "/api/play/swipe", {
        method: "POST",
        body: { sessionId: started.sessionId, direction: "left" }
      });
      assert.equal(swiped.turn, 1);
      assert.equal(Object.keys(swiped.factions).length, 4);

      const diagnostics = await api(port, "/api/diagnostics/run", {
        method: "POST",
        body: { cycles: 6, maxTurns: 4, seed: 4 }
      });
      assert.equal(diagnostics.module, "ReignsAgent-Reviewer");
      assert.equal(diagnostics.sampleSize, 6);
      assert.equal(diagnostics.narrative.summary.groupCount, 9);
      assert.equal(diagnostics.narrative.storyGroups.some((group) => group.id === "gate-endings"), true);

      const connectorPlan = await api(port, "/api/connector/plan", {
        method: "POST",
        body: { config: { provider: "stub", theme: "small kingdom", cardCount: 2 } }
      });
      assert.equal(connectorPlan.request.purpose, "card_generation");
      assert.equal(connectorPlan.config.provider, "stub");

      const aiPlan = await api(port, "/api/ai/edit/plan", {
        method: "POST",
        body: {
          mode: "generate_cards",
          config: { provider: "stub", theme: "court repair", cardCount: 1 },
          instruction: "Add one restrained hearing."
        }
      });
      assert.equal(aiPlan.mode, "generate_cards");
      assert.equal(aiPlan.proposals.length, 1);
      assert.equal(aiPlan.proposals[0].patches[0].op, "addCard");

      const appliedAi = await api(port, "/api/ai/edit/apply", {
        method: "POST",
        body: { plan: aiPlan, proposalIds: [aiPlan.proposals[0].id] }
      });
      assert.equal(appliedAi.applied, true);
      assert.equal(appliedAi.bundle.cards.length, 24);

      const staleError = await apiError(port, "/api/ai/edit/apply", {
        method: "POST",
        body: { plan: aiPlan, proposalIds: [aiPlan.proposals[0].id] }
      });
      assert.match(staleError.message, /stale/);

      const repairWithoutReview = await apiError(port, "/api/ai/edit/plan", {
        method: "POST",
        body: { mode: "repair_diagnostics", config: { provider: "stub" } }
      });
      assert.match(repairWithoutReview.message, /Run Review/);

      const freshDiagnostics = await api(port, "/api/diagnostics/run", {
        method: "POST",
        body: { cycles: 6, maxTurns: 4, seed: 5 }
      });
      assert.equal(freshDiagnostics.module, "ReignsAgent-Reviewer");
      const repairPlan = await api(port, "/api/ai/edit/plan", {
        method: "POST",
        body: {
          mode: "repair_diagnostics",
          config: { provider: "stub" },
          targetCardId: "gate-petition"
        }
      });
      assert.equal(repairPlan.mode, "repair_diagnostics");
      assert.equal(Array.isArray(repairPlan.proposals), true);

      const mediaPlan = await api(port, "/api/ai/edit/plan", {
        method: "POST",
        body: {
          mode: "generate_asset",
          config: { provider: "stub", style: "ink wash" },
          targetCardId: "gate-petition",
          instruction: "Prepare a spare monochrome portrait."
        }
      });
      assert.equal(mediaPlan.request.purpose, "card_asset_generation");
      assert.equal(mediaPlan.proposals[0].source.mode, "generate_asset");

      const analysisPlan = await api(port, "/api/ai/edit/plan", {
        method: "POST",
        body: {
          mode: "analyze_asset",
          config: { provider: "stub" },
          targetCardId: "gate-petition",
          assetId: editor.assets[0].id,
          instruction: "Check whether the image fits."
        }
      });
      assert.equal(analysisPlan.request.purpose, "card_asset_analysis");
      assert.equal(analysisPlan.proposals[0].patches.length, 0);

      const buildResult = await api(port, "/api/build/prepare", { method: "POST", body: {} });
      assert.equal(buildResult.build.player.choiceModel, "binary");
      assert.equal(buildResult.build.content.cards.length, 24);
      assert.equal(buildResult.build.content.assets.length > 0, true);

      // Granular choice editing: set a label, then patch a single faction delta.
      const firstCardId = editor.cards[0].id;
      const firstChoiceId = editor.cards[0].choices[0].id;
      const labeled = await api(port, `/api/editor/cards/${firstCardId}/choices/${firstChoiceId}`, {
        method: "PATCH",
        body: { label: "Tuned label" }
      });
      assert.equal(labeled.card.choices.find((c) => c.id === firstChoiceId).label, "Tuned label");

      const factionSet = await api(
        port,
        `/api/editor/cards/${firstCardId}/choices/${firstChoiceId}/effects/faction/gauge1`,
        { method: "POST", body: { value: -7 } }
      );
      assert.equal(
        factionSet.card.choices.find((c) => c.id === firstChoiceId).effects.factions.gauge1,
        -7
      );

      const factionCleared = await api(
        port,
        `/api/editor/cards/${firstCardId}/choices/${firstChoiceId}/effects/faction/gauge1`,
        { method: "DELETE" }
      );
      const clearedEffects = factionCleared.card.choices.find((c) => c.id === firstChoiceId).effects;
      assert.equal(clearedEffects.factions?.gauge1 === undefined, true);

      const tagSet = await api(
        port,
        `/api/editor/cards/${firstCardId}/choices/${firstChoiceId}/effects/tag/inspected`,
        { method: "POST", body: { value: true } }
      );
      assert.equal(
        tagSet.card.choices.find((c) => c.id === firstChoiceId).effects.tags.inspected,
        true
      );

      const tagCleared = await api(
        port,
        `/api/editor/cards/${firstCardId}/choices/${firstChoiceId}/effects/tag/inspected`,
        { method: "DELETE" }
      );
      assert.equal(
        tagCleared.card.choices.find((c) => c.id === firstChoiceId).effects.tags?.inspected === undefined,
        true
      );

      const variableSet = await api(
        port,
        `/api/editor/cards/${firstCardId}/choices/${firstChoiceId}/effects/variable/reputation`,
        { method: "POST", body: { value: 12 } }
      );
      assert.equal(
        variableSet.card.choices.find((c) => c.id === firstChoiceId).effects.variables.reputation,
        12
      );

      const variableFalse = await api(
        port,
        `/api/editor/cards/${firstCardId}/choices/${firstChoiceId}/effects/variable/flagged`,
        { method: "POST", body: { value: false } }
      );
      assert.equal(
        variableFalse.card.choices.find((c) => c.id === firstChoiceId).effects.variables.flagged,
        false
      );

      const variableCleared = await api(
        port,
        `/api/editor/cards/${firstCardId}/choices/${firstChoiceId}/effects/variable/reputation`,
        { method: "DELETE" }
      );
      assert.equal(
        variableCleared.card.choices.find((c) => c.id === firstChoiceId).effects.variables?.reputation === undefined,
        true
      );

      // Snapshot/restore round-trips the working bundle through the server.
      const snapshot = await api(port, "/api/editor/snapshot");
      assert.equal(snapshot.bundle.cards.length, appliedAi.bundle.cards.length);
      assert.equal(snapshot.validation.valid, true);

      const restored = await api(port, "/api/editor/restore", {
        method: "POST",
        body: { bundle: snapshot.bundle }
      });
      assert.equal(restored.restored, true);
      assert.equal(restored.cardCount, snapshot.bundle.cards.length);
      assert.equal(restored.playerValidation.valid, true);
    } finally {
      await stopServer(server);
      await rm(dataRoot, { recursive: true, force: true });
    }

    assert.equal(server.exitCode === null || server.exitCode === 0 || server.signalCode === "SIGTERM", true, stderr);
  });

  it("builds AI Assist plans through configured text endpoints", async () => {
    const port = await reservePort();
    const dataRoot = await mkdtemp(join(tmpdir(), "reigns-phase4-ai-"));
    const mock = await startMockAiEndpoint();
    const server = spawn(process.execPath, ["scripts/dev-server.mjs"], {
      env: { ...process.env, PORT: String(port), REIGNS_AGENT_DATA_ROOT: dataRoot },
      stdio: ["ignore", "pipe", "pipe"]
    });

    try {
      await waitForServer(port, server);
      const endpoint = `http://127.0.0.1:${mock.port}/v1`;
      const storedConfig = await api(port, "/api/config", {
        method: "PATCH",
        body: { ai: { apiKey: "stored-integration-key" } }
      });
      assert.equal(storedConfig.ai.hasApiKey, true);
      assert.equal(JSON.stringify(storedConfig).includes("stored-integration-key"), false);
      const models = await api(port, "/api/ai/edit/models", {
        method: "POST",
        body: {
          config: { provider: "openai_chat", endpoint: `${endpoint}/chat/completions`, apiKeyRef: "config.toml" }
        }
      });
      assert.deepEqual(models.models.map((model) => model.id), ["mock-chat", "mock-vision"]);
      assert.equal(models.provider.endpoint, `${endpoint}/models`);
      assert.equal(JSON.stringify(models).includes("secret-integration-key"), false);

      const beforeValidation = await api(port, "/api/editor");
      const validation = await api(port, "/api/ai/edit/validate", {
        method: "POST",
        body: {
          config: { provider: "openai_chat", endpoint, modelId: "validation-model", apiKeyRef: "browser-local" },
          credentials: { apiKey: "secret-integration-key" }
        }
      });
      const afterValidation = await api(port, "/api/editor");
      assert.equal(validation.ok, true);
      assert.equal(validation.provider.protocol, "openai_chat");
      assert.equal(validation.provider.model, "validation-model");
      assert.equal(JSON.stringify(validation).includes("secret-integration-key"), false);
      assert.deepEqual(afterValidation.cards, beforeValidation.cards);

      const plans = [];
      for (const provider of ["responses", "messages", "openai_chat", "completions"]) {
        plans.push(await api(port, "/api/ai/edit/plan", {
          method: "POST",
          body: {
            mode: "generate_cards",
            config: { provider, endpoint, modelId: `${provider}-model`, apiKeyRef: "browser-local" },
            credentials: { apiKey: "secret-integration-key" },
            instruction: `Build with ${provider}.`
          }
        }));
      }

      assert.deepEqual(mock.requests.map((request) => request.path), ["/v1/models", "/v1/chat/completions", "/v1/responses", "/v1/chat/completions", "/v1/chat/completions", "/v1/completions"]);
      assert.equal(mock.requests[0].authorization, "Bearer stored-integration-key");
      assert.equal(mock.requests.slice(1).every((request) => request.authorization === "Bearer secret-integration-key"), true);
      assert.equal(mock.requests[0].body, null);
      assert.equal(mock.requests[1].body.model, "validation-model");
      assert.match(mock.requests[1].body.messages[1].content, /connectivity and protocol validation request/);
      assert.equal(mock.requests[2].body.model, "responses-model");
      assert.equal(mock.requests[3].body.messages[0].role, "system");
      assert.equal(mock.requests[4].body.messages[0].role, "system");
      assert.match(mock.requests[5].body.prompt, /Return only valid JSON/);
      assert.equal(plans.every((plan) => JSON.stringify(plan).includes("secret-integration-key") === false), true);
      assert.deepEqual(plans.map((plan) => plan.proposals[0].patches[0].op), ["setMetadata", "setChoiceLabel", "setChoiceLabel", "setChoiceLabel"]);

      const failed = await apiError(port, "/api/ai/edit/plan", {
        method: "POST",
        body: {
          config: { provider: "responses", endpoint: `http://127.0.0.1:${mock.port}/fail`, modelId: "bad-model" },
          credentials: { apiKey: "secret-integration-key" }
        }
      });
      assert.equal(failed.code, "endpoint_http_error");

      const malformed = await apiError(port, "/api/ai/edit/plan", {
        method: "POST",
        body: {
          config: { provider: "responses", endpoint: `http://127.0.0.1:${mock.port}/malformed`, modelId: "bad-model" },
          credentials: { apiKey: "secret-integration-key" }
        }
      });
      assert.equal(malformed.code, "endpoint_invalid_response");

      const applied = await api(port, "/api/ai/edit/apply", {
        method: "POST",
        body: { plan: plans[0], proposalIds: [plans[0].proposals[0].id] }
      });
      assert.equal(applied.applied, true);
      assert.equal(applied.bundle.metadata.title, "Endpoint Court");
    } finally {
      await stopServer(server);
      await mock.close();
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  it("generates, stages, applies, and serves image endpoint results", async () => {
    const port = await reservePort();
    const dataRoot = await mkdtemp(join(tmpdir(), "reigns-phase4-images-"));
    const mock = await startMockImageEndpoint();
    const server = spawn(process.execPath, ["scripts/dev-server.mjs"], { env: { ...process.env, PORT: String(port), REIGNS_AGENT_DATA_ROOT: dataRoot }, stdio: ["ignore", "pipe", "pipe"] });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    try {
      await waitForServer(port, server);
      const validation = await api(port, "/api/ai/images/validate", { method: "POST", body: { config: { protocol: "openai_images", endpoint: `http://127.0.0.1:${mock.port}/v1`, modelId: "mock-image" } } });
      assert.equal(validation.valid, true);
      assert.equal(validation.capabilities.supportsMask, true);
      await api(port, "/api/config", { method: "PATCH", body: { ai: { apiKey: "inherited-image-secret" } } });
      const editorBefore = await api(port, "/api/editor");
      const targetAsset = editorBefore.assets.find((asset) => asset.cardId);
      assert.ok(targetAsset, "fixture must contain an existing card asset");

      const stagedResponse = await fetch(`http://127.0.0.1:${port}/api/ai/images/stage?fileName=source.png`, { method: "POST", headers: { "content-type": "image/png" }, body: png });
      assert.equal(stagedResponse.ok, true);
      const staged = await stagedResponse.json();

      const drafts = [];
      for (const operation of ["generate", "edit", "inpaint", "outpaint"]) {
        drafts.push(await api(port, "/api/ai/images/run", { method: "POST", body: { config: { protocol: "openai_images", endpoint: `http://127.0.0.1:${mock.port}/v1`, modelId: "mock-image", credentialMode: operation === "generate" ? "inherit_text" : "dedicated" }, ...(operation === "generate" ? {} : { credentials: { apiKey: "image-secret" } }), request: { operation, prompt: `${operation} the court`, references: operation === "generate" ? [] : [staged.uri], mask: ["inpaint", "outpaint"].includes(operation) ? staged.uri : null, targetCardId: targetAsset.cardId, targetAssetId: operation === "generate" ? null : targetAsset.id, output: { format: "png", count: 1 }, outpaint: { left: 64 } } } }));
      }
      assert.deepEqual(mock.requests.map((entry) => entry.path), ["/v1/images/generations", "/v1/images/edits", "/v1/images/edits", "/v1/images/edits"]);
      assert.equal(mock.requests[0].authorization, "Bearer inherited-image-secret");
      assert.equal(mock.requests.slice(1).every((entry) => entry.authorization === "Bearer image-secret"), true);
      assert.equal(drafts.every((draft) => !JSON.stringify(draft).includes("image-secret")), true);
      assert.equal(drafts.every((draft) => draft.outputs[0].previewUrl.startsWith("/api/project-assets/")), true);

      for (const draft of drafts.slice(0, -1)) await api(port, `/api/ai/images/drafts/${draft.draftId}`, { method: "DELETE" });
      const applied = await api(port, "/api/ai/images/apply", { method: "POST", body: { draftId: drafts.at(-1).draftId, outputId: drafts.at(-1).outputs[0].id, cardId: targetAsset.cardId } });
      assert.equal(applied.applied, true);
      assert.equal(applied.asset.id, targetAsset.id);
      assert.match(applied.asset.uri, /^assets\/generated\/[a-f0-9]{64}\.png$/);
      const assetResponse = await fetch(`http://127.0.0.1:${port}/api/project-assets/${encodeURIComponent(applied.asset.uri)}`);
      assert.equal(assetResponse.headers.get("content-type"), "image/png");
      assert.deepEqual(new Uint8Array(await assetResponse.arrayBuffer()), png);
      const editor = await api(port, "/api/editor");
      assert.equal(editor.assets.length, editorBefore.assets.length);
      assert.equal(editor.assets.filter((asset) => asset.id === targetAsset.id && asset.cardId === targetAsset.cardId).length, 1);
      const build = await api(port, "/api/build/prepare", { method: "POST", body: {} });
      assert.equal(build.build.content.assets.some((asset) => asset.uri === applied.asset.uri), true);
    } finally {
      await stopServer(server);
      await mock.close();
      await rm(dataRoot, { recursive: true, force: true });
    }
  });
});

async function api(port, path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: options.method ?? "GET",
    headers: { "content-type": "application/json" },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;

  if (!response.ok || json?.error) {
    throw new Error(json?.error?.message ?? `Request failed: ${response.status}`);
  }

  return json;
}

async function apiError(port, path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: options.method ?? "GET",
    headers: { "content-type": "application/json" },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  if (response.ok && !json?.error) {
    throw new Error("Expected API error");
  }
  return json.error;
}

async function text(port, path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return body;
}

async function reservePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function startMockAiEndpoint() {
  const requests = [];
  const server = createServer(async (req, res) => {
    const body = await readRequestJson(req);
    requests.push({
      path: new URL(req.url, "http://127.0.0.1").pathname,
      authorization: req.headers.authorization,
      body
    });

    if (req.url.startsWith("/fail")) {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "offline" }));
      return;
    }

    if (req.url.startsWith("/malformed")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ nope: [] }));
      return;
    }

    res.writeHead(200, { "content-type": "application/json" });
    if (req.url.endsWith("/models")) {
      res.end(JSON.stringify({
        data: [
          { id: "mock-chat" },
          { id: "mock-vision", display_name: "Mock Vision" }
        ]
      }));
      return;
    }
    if (req.url.endsWith("/responses")) {
      res.end(JSON.stringify({
        output_text: JSON.stringify({
          proposals: [{
            id: "endpoint-title",
            title: "Endpoint title",
            summary: "Renames the project.",
            patches: [{ op: "setMetadata", metadata: { title: "Endpoint Court" } }]
          }]
        })
      }));
      return;
    }
    if (req.url.endsWith("/chat/completions")) {
      res.end(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              proposals: [{
                id: "endpoint-chat-label",
                title: "Endpoint chat label",
                summary: "Renames the left choice.",
                patches: [{ op: "setChoiceLabel", cardId: "gate-audience", choiceId: "left", label: "Hear" }]
              }]
            })
          }
        }]
      }));
      return;
    }
    res.end(JSON.stringify({
      choices: [{
        text: JSON.stringify({
          proposals: [{
            id: "endpoint-completion-label",
            title: "Endpoint completion label",
            summary: "Renames the right choice.",
            patches: [{ op: "setChoiceLabel", cardId: "gate-audience", choiceId: "right", label: "Wait" }]
          }]
        })
      }]
    }));
  });

  await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    port: server.address().port,
    requests,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function startMockImageEndpoint() {
  const requests = [];
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const server = createServer(async (req, res) => {
    for await (const _chunk of req) { /* drain request */ }
    requests.push({ path: new URL(req.url, "http://127.0.0.1").pathname, authorization: req.headers.authorization, contentType: req.headers["content-type"] });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [{ b64_json: Buffer.from(png).toString("base64") }] }));
  });
  const port = await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
  return { port, requests, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function readRequestJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : null;
}

async function waitForServer(port, child) {
  const deadline = Date.now() + 5000;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`dev server exited early with code ${child.exitCode}`);
    }

    try {
      await api(port, "/api/editor");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  throw new Error("dev server did not become ready");
}

async function stopServer(child) {
  if (child.exitCode !== null) {
    return;
  }

  await new Promise((resolve) => {
    child.once("exit", resolve);
    child.kill();
    setTimeout(resolve, 1000);
  });
}
