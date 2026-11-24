import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

const FOG = JSON.parse(readFileSync(new URL("../../fixtures/content/fog-harbor.cards.json", import.meta.url), "utf8"));
const SECRET = "integration-secret-key";

function brokenFogHarbor() {
  const bundle = structuredClone(FOG);
  bundle.cards.push({
    id: "sealed-warehouse",
    text: "The quarantine is lifted. Warehouse seven can open.",
    weight: 1,
    requirements: { allTags: ["onWatch", "quarantineLifted"] },
    choices: [
      { id: "left", label: "Send the doctor first", effects: { factions: { gauge3: 5, gauge0: -5 } } },
      { id: "right", label: "Unload at once", effects: { factions: { gauge0: 9, gauge1: -6 } } }
    ]
  });
  return bundle;
}

const SCRIPT = [
  [{ id: "wipe-gate", title: "Open the warehouse", summary: "Remove the gate.", patches: [{ op: "updateCard", cardId: "sealed-warehouse", changes: { requirements: {} } }] }],
  [{
    id: "quarantine-board",
    title: "Add a quarantine decision",
    summary: "A health-board card can lift the quarantine.",
    patches: [{
      op: "addCard",
      card: {
        id: "quarantine-board",
        text: "The health board asks to end the quarantine.",
        weight: 1,
        requirements: { allTags: ["onWatch"] },
        choices: [
          { id: "left", label: "Lift it", effects: { factions: { gauge1: 4, gauge0: -3 }, tags: { quarantineLifted: true } } },
          { id: "right", label: "Keep it", effects: { factions: { gauge0: 3, gauge1: -4 } } }
        ]
      }
    }]
  }]
];

describe("verified repair loop through the Creator Server", () => {
  it("scores repair rounds against a mock endpoint and applies only what the author selects", async () => {
    const mock = await startScriptedEndpoint(SCRIPT);
    const port = await reservePort();
    const dataRoot = await mkdtemp(join(tmpdir(), "reigns-repair-loop-"));
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
      await api(port, "/api/editor/import", { method: "POST", body: { bundle: brokenFogHarbor() } });
      const review = await api(port, "/api/diagnostics/run", { method: "POST", body: { cycles: 500, maxTurns: 40, seed: 1 } });
      assert.equal(review.healthScore, 55);
      const before = await api(port, "/api/editor");

      const config = { provider: "openai_chat", endpoint: `http://127.0.0.1:${mock.port}/v1`, modelId: "mock-repair", apiKeyRef: "browser-local" };
      const plan = await api(port, "/api/ai/edit/plan", {
        method: "POST",
        body: {
          mode: "repair_diagnostics",
          config,
          credentials: { apiKey: SECRET },
          instruction: "Repair the unreachable sealed-warehouse card.",
          repairTarget: { code: "unreachable_cards", cardIds: ["sealed-warehouse"] }
        }
      });

      assert.equal(plan.verification.status, "verified");
      assert.equal(plan.verification.roundsUsed, 2);
      assert.deepEqual(plan.verification.rounds.map((round) => round.passedCount), [0, 1]);
      assert.deepEqual(plan.verification.rounds[0].blockedBy, { gates_preserved: 1 });
      assert.equal(plan.proposals[0].verification.score.before, 55);
      assert.ok(plan.proposals[0].verification.score.after > 55);
      assert.equal(mock.requests.length, 2);
      assert.equal(mock.requests[0].authorization, `Bearer ${SECRET}`);
      assert.ok(mock.requests.every((request) => !request.raw.includes(SECRET)), "key never enters a request body");
      assert.equal(JSON.stringify(plan).includes(SECRET), false, "key never returns to the UI");
      assert.match(mock.requests[1].raw, /gates_preserved/, "round 2 sees round 1's failed check");

      const unchanged = await api(port, "/api/editor");
      assert.deepEqual(unchanged.cards, before.cards, "planning never writes content");

      const applied = await api(port, "/api/ai/edit/apply", { method: "POST", body: { plan, proposalIds: ["quarantine-board"] } });
      assert.equal(applied.applied, true);
      assert.equal(applied.playerValidation.valid, true);
      const after = await api(port, "/api/diagnostics/run", { method: "POST", body: { cycles: 500, maxTurns: 40, seed: 1 } });
      assert.equal(after.warnings.filter((warning) => warning.severity === "error").length, 0);
      assert.equal(after.healthScore, plan.proposals[0].verification.score.after, "fixed seed reproduces the loop score");

      const stale = await apiError(port, "/api/ai/edit/apply", { method: "POST", body: { plan, proposalIds: ["quarantine-board"] } });
      assert.match(stale.message, /stale/);
    } finally {
      await stopServer(server);
      await mock.close();
      await rm(dataRoot, { recursive: true, force: true });
    }
    assert.equal(server.exitCode === null || server.exitCode === 0 || server.signalCode === "SIGTERM", true, stderr);
  });
});

async function startScriptedEndpoint(script) {
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    requests.push({ path: req.url, authorization: req.headers.authorization, raw });
    const proposals = script[Math.min(requests.length - 1, script.length - 1)];
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ proposals }) } }] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: server.address().port,
    requests,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

const capabilityByPort = new Map();
function apiCapability(port) {
  if (!capabilityByPort.has(port)) {
    capabilityByPort.set(port, fetch(`http://127.0.0.1:${port}/api/session`).then(async (response) => {
      const payload = await response.json();
      if (!response.ok || typeof payload?.capability !== "string") throw new Error("Creator API session could not be established");
      return payload.capability;
    }).catch((error) => {
      capabilityByPort.delete(port);
      throw error;
    }));
  }
  return capabilityByPort.get(port);
}

async function send(port, path, options = {}) {
  const capability = await apiCapability(port);
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: options.method ?? "GET",
    headers: { "content-type": "application/json", "x-reigns-agent-capability": capability },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  return { response, json: text ? JSON.parse(text) : null };
}

async function api(port, path, options) {
  const { response, json } = await send(port, path, options);
  if (!response.ok || json?.error) throw new Error(json?.error?.message ?? `Request failed: ${response.status}`);
  return json;
}

async function apiError(port, path, options) {
  const { response, json } = await send(port, path, options);
  if (response.ok && !json?.error) throw new Error("Expected API error");
  return json.error;
}

async function reservePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(port, child) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`dev server exited early with code ${child.exitCode}`);
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
  if (child.exitCode !== null) return;
  await new Promise((resolve) => {
    child.once("exit", resolve);
    child.kill();
    setTimeout(resolve, 1000);
  });
}
