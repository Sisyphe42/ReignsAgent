import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { describe, it } from "node:test";

describe("Phase 4 interface integration", () => {
  it("runs the local creator API from ingest through preview, diagnostics, and build preparation", async () => {
    const port = await reservePort();
    const server = spawn(process.execPath, ["scripts/dev-server.mjs"], {
      env: { ...process.env, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stderr = "";
    server.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    try {
      await waitForServer(port, server);
      const initialEditor = await api(port, "/api/editor");
      assert.equal(initialEditor.cards.length, 9);
      assert.equal(initialEditor.assets.length > 0, true);

      const bundle = await api(port, "/api/samples/oss-court");
      assert.equal(bundle.assets.length > 0, true);
      assert.equal(bundle.metadata.i18n.supportedLocales.includes("zh-Hans"), true);

      const imported = await api(port, "/api/editor/import", {
        method: "POST",
        body: { bundle }
      });
      assert.equal(imported.imported, true);
      assert.equal(imported.cardCount, 9);

      const editor = await api(port, "/api/editor");
      assert.equal(editor.playerValidation.valid, true);

      const started = await api(port, "/api/play/start", { method: "POST", body: { locale: "zh-Hans" } });
      assert.match(started.sessionId, /^s_/);
      assert.equal(started.currentCard.choices.some((choice) => choice.id === "left"), true);
      assert.match(started.currentCard.text, /请愿/);
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

      const buildResult = await api(port, "/api/build/prepare", { method: "POST", body: {} });
      assert.equal(buildResult.build.player.choiceModel, "binary");
      assert.equal(buildResult.build.content.cards.length, 9);
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
        `/api/editor/cards/${firstCardId}/choices/${firstChoiceId}/effects/faction/people`,
        { method: "POST", body: { value: -7 } }
      );
      assert.equal(
        factionSet.card.choices.find((c) => c.id === firstChoiceId).effects.factions.people,
        -7
      );

      const factionCleared = await api(
        port,
        `/api/editor/cards/${firstCardId}/choices/${firstChoiceId}/effects/faction/people`,
        { method: "DELETE" }
      );
      const clearedEffects = factionCleared.card.choices.find((c) => c.id === firstChoiceId).effects;
      assert.equal(clearedEffects.factions?.people === undefined, true);

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
      assert.equal(snapshot.bundle.cards.length, editor.cards.length);
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
    }

    assert.equal(server.exitCode === null || server.exitCode === 0 || server.signalCode === "SIGTERM", true, stderr);
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
