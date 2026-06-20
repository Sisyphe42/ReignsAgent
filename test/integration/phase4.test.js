import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
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
      const bundle = JSON.parse(await readFile("fixtures/content/player.cards.json", "utf8"));

      const imported = await api(port, "/api/editor/import", {
        method: "POST",
        body: { bundle }
      });
      assert.equal(imported.imported, true);
      assert.equal(imported.cardCount, 3);

      const editor = await api(port, "/api/editor");
      assert.equal(editor.playerValidation.valid, true);

      const started = await api(port, "/api/play/start", { method: "POST", body: {} });
      assert.match(started.sessionId, /^s_/);
      assert.equal(started.currentCard.choices.some((choice) => choice.id === "left"), true);

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
      assert.equal(buildResult.build.content.cards.length, 3);
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
