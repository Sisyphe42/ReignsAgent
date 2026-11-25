#!/usr/bin/env node
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

/**
 * Scripted OpenAI-compatible chat endpoint for the repair-loop eval and demos.
 * It never calls a real model and ignores any Authorization header.
 *
 * Routes: POST /<scriptId>/v1/chat/completions -> the next scripted response
 * for that script (the last one repeats). GET /<scriptId>/v1/models lists one model.
 * POST /<scriptId>/reset restarts that script.
 * `delayMs` (or a step `{ delayMs, proposals }`) holds each answer back, so demos can show
 * the request stage of the progress UI. A step `{ status, body }` answers with an error.
 */
export async function startRepairMockEndpoint({ scripts, port = 0, host = "127.0.0.1", delayMs = 0 }) {
  const counters = new Map();
  const requests = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const [, scriptId, ...rest] = url.pathname.split("/");
    const route = `/${rest.join("/")}`;
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    const script = scripts[scriptId];
    if (!script) return send(res, 404, { error: `unknown script '${scriptId}'` });
    if (route === "/reset") {
      counters.set(scriptId, 0);
      return send(res, 200, { reset: scriptId });
    }
    if (route.endsWith("/models")) return send(res, 200, { data: [{ id: "scripted-repair-model" }] });
    if (!route.endsWith("/chat/completions") || req.method !== "POST") return send(res, 404, { error: "not found" });

    const index = counters.get(scriptId) ?? 0;
    counters.set(scriptId, index + 1);
    requests.push({ scriptId, round: index + 1, hasAuthorization: Boolean(req.headers.authorization), bodyBytes: Buffer.byteLength(raw) });
    const step = script[Math.min(index, script.length - 1)];
    const wait = Number(step?.delayMs ?? delayMs) || 0;
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    const proposals = Array.isArray(step) ? step : Array.isArray(step?.proposals) ? step.proposals : null;
    if (!proposals) return send(res, step.status ?? 500, step.body ?? { error: "scripted failure" });
    return send(res, 200, { choices: [{ message: { role: "assistant", content: JSON.stringify({ proposals }) } }] });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  return {
    port: server.address().port,
    requests,
    reset: () => counters.clear(),
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

function send(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { REPAIR_EVAL_CASES } = await import("./cases.mjs");
  const port = Number(process.env.PORT ?? process.argv[2] ?? 4393);
  const delayMs = Number(process.env.MOCK_DELAY_MS ?? process.argv[3] ?? 0);
  const scripts = Object.fromEntries(REPAIR_EVAL_CASES.map((entry) => [entry.id, entry.script]));
  scripts["endpoint-503"] = [{ status: 503, body: { error: { message: "Service Unavailable (scripted)" } } }];
  const mock = await startRepairMockEndpoint({ scripts, port, delayMs });
  console.log(`Scripted repair mock on http://127.0.0.1:${mock.port}/<case-id>/v1 (no real model, no key needed)`);
  for (const entry of REPAIR_EVAL_CASES) console.log(`  ${entry.id}: http://127.0.0.1:${mock.port}/${entry.id}/v1`);
}
