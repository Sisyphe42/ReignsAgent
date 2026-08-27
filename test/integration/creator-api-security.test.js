import assert from "node:assert/strict";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";

import { createCreatorServer } from "../../apps/creator-server/src/server.mjs";
import { HttpCreatorBackend } from "../../apps/creator-web/src/backend.js";
import creatorWebConfig from "../../apps/creator-web/vite.config.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const cleanup = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).reverse().map((close) => close()));
});

describe("Creator API request trust boundary", () => {
  it("rejects untrusted Host, Origin, capability, and mutation content type before dispatch", async () => {
    const creator = await createCreatorServer({ rootDir: ROOT, initialBundle: { cards: [] } });
    cleanup.push(() => creator.close());
    const address = await creator.start({ port: 0 });

    const foreignOrigin = await fetch(`${address.origin}/api/session`, { headers: { origin: "https://attacker.example" } });
    assert.equal(foreignOrigin.status, 403);
    assert.equal((await foreignOrigin.json()).error.code, "request_origin_forbidden");

    const foreignHost = await rawRequest(address.port, "/api/session", { host: "attacker.example" });
    assert.equal(foreignHost.status, 403);
    assert.equal(foreignHost.body.error.code, "request_host_forbidden");

    const missingCapability = await fetch(`${address.origin}/api/editor`);
    assert.equal(missingCapability.status, 401);
    assert.equal((await missingCapability.json()).error.code, "api_capability_required");

    const wrongCapability = await fetch(`${address.origin}/api/editor`, { headers: { "x-reigns-agent-capability": "wrong" } });
    assert.equal(wrongCapability.status, 401);

    const textPlainMutation = await fetch(`${address.origin}/api/editor/metadata`, {
      method: "PATCH",
      headers: { "content-type": "text/plain", "x-reigns-agent-capability": address.capability },
      body: JSON.stringify({ metadata: { title: "must not apply" } })
    });
    assert.equal(textPlainMutation.status, 415);
    assert.equal((await textPlainMutation.json()).error.code, "json_content_type_required");

    const legitimate = await fetch(`${address.origin}/api/editor`, {
      headers: { origin: address.origin, "x-reigns-agent-capability": address.capability }
    });
    assert.equal(legitimate.status, 200);
    assert.equal(Array.isArray((await legitimate.json()).cards), true);

    await assert.rejects(
      () => creator.start({ host: "0.0.0.0", port: 0 }),
      { code: "creator_host_not_loopback" }
    );
  });

  it("uses stored credentials only for the matching persisted endpoint", async () => {
    const providerCalls = [];
    const provider = createHttpServer((req, res) => {
      providerCalls.push({ path: req.url, authorization: req.headers.authorization });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "safe-model" }] }));
    });
    const providerAddress = await listen(provider);
    cleanup.push(() => closeHttpServer(provider));

    const creator = await createCreatorServer({ rootDir: ROOT, initialBundle: { cards: [] } });
    cleanup.push(() => creator.close());
    const address = await creator.start({ port: 0 });
    const trustedEndpoint = `${providerAddress.origin}/trusted/`;
    const attackerEndpoint = `${providerAddress.origin}/attacker`;

    await apiRequest(address, "/api/config", {
      method: "PATCH",
      body: { ai: { endpoint: trustedEndpoint, apiKey: "stored-secret" } }
    });

    await apiRequest(address, "/api/ai/edit/models", {
      method: "POST",
      body: { config: { endpoint: attackerEndpoint, protocol: "openai_chat", routeMode: "api_root" } }
    });
    assert.equal(providerCalls.at(-1).authorization, undefined);

    await apiRequest(address, "/api/ai/edit/models", {
      method: "POST",
      body: {
        config: { endpoint: attackerEndpoint, protocol: "openai_chat", routeMode: "api_root" },
        credentials: { apiKey: "transient-secret" }
      }
    });
    assert.equal(providerCalls.at(-1).authorization, "Bearer transient-secret");

    await apiRequest(address, "/api/ai/edit/models", {
      method: "POST",
      body: { config: { endpoint: trustedEndpoint.slice(0, -1), protocol: "openai_chat", routeMode: "api_root" } }
    });
    assert.equal(providerCalls.at(-1).authorization, "Bearer stored-secret");
  });

  it("retries capability bootstrap after a transient client failure", async () => {
    const originalFetch = globalThis.fetch;
    let bootstrapCalls = 0;
    globalThis.fetch = async (input, options) => {
      if (input === "/api/session") {
        bootstrapCalls += 1;
        if (bootstrapCalls === 1) throw new Error("temporary bootstrap failure");
        return new Response(JSON.stringify({ capability: "session-capability" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      assert.equal(input, "/api/editor");
      assert.equal(options.headers["x-reigns-agent-capability"], "session-capability");
      return new Response(JSON.stringify({ cards: [] }), { status: 200, headers: { "content-type": "application/json" } });
    };
    try {
      const backend = new HttpCreatorBackend();
      await assert.rejects(() => backend.request("/api/editor"), /temporary bootstrap failure/);
      assert.deepEqual(await backend.request("/api/editor"), { cards: [] });
      assert.equal(bootstrapCalls, 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("allowlists only loopback Vite hosts, rejects attacker Host, and rewrites the proxy Host", async () => {
    const config = creatorWebConfig({ mode: "development" });
    assert.deepEqual(config.server.allowedHosts, ["127.0.0.1", "localhost", "::1"]);
    assert.equal(config.server.proxy["/api"].changeOrigin, true);

    const vite = await createViteServer({
      ...config,
      logLevel: "silent",
      server: { ...config.server, host: "127.0.0.1", port: 0, proxy: {} }
    });
    cleanup.push(() => vite.close());
    await vite.listen();
    const port = vite.httpServer.address().port;
    const rejected = await rawRequest(port, "/", { host: "attacker.example" }, false);
    assert.equal(rejected.status, 403);
    const allowed = await rawRequest(port, "/", { host: `127.0.0.1:${port}` }, false);
    assert.notEqual(allowed.status, 403);
  });
});

async function apiRequest(address, path, { method = "GET", body } = {}) {
  const response = await fetch(`${address.origin}${path}`, {
    method,
    headers: {
      "x-reigns-agent-capability": address.capability,
      ...(body === undefined ? {} : { "content-type": "application/json" })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return text ? JSON.parse(text) : null;
}

function rawRequest(port, path, headers, parseJson = true) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: "127.0.0.1", port, path, headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({ status: response.statusCode, body: parseJson ? JSON.parse(text) : text });
      });
    });
    request.on("error", reject);
    request.end();
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      resolve({ origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

function closeHttpServer(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
