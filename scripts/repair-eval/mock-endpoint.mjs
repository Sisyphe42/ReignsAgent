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
 * `usage: true` (or a step `{ usage: true }`) adds an OpenAI-style `usage` block with synthetic
 * token counts (bytes / 3.7, rounded), so the activity log shows "reported" tokens instead of an estimate.
 */
export async function startRepairMockEndpoint({ scripts, port = 0, host = "127.0.0.1", delayMs = 0, usage = false }) {
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
    // Optional loop directives a model may add: contextRequests (cards to read next) and stop.
    const directives = Array.isArray(step) ? {} : { ...(step.contextRequests ? { contextRequests: step.contextRequests } : {}), ...(step.stop ? { stop: step.stop } : {}) };
    const content = JSON.stringify({ proposals, ...directives });
    const withUsage = Array.isArray(step) ? usage : step.usage ?? usage;
    const tokens = (bytes) => Math.round(bytes / 3.7);
    const usageBlock = withUsage ? { usage: { prompt_tokens: tokens(Buffer.byteLength(raw)), completion_tokens: tokens(Buffer.byteLength(content)), total_tokens: tokens(Buffer.byteLength(raw)) + tokens(Buffer.byteLength(content)) } } : {};
    return send(res, 200, { choices: [{ message: { role: "assistant", content } }], ...usageBlock });
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
  const { REPAIR_EVAL_CASES, SLOW_ROUND_2_SCRIPT, TWO_FIXES_SCRIPT } = await import("./cases.mjs");
  const port = Number(process.env.PORT ?? process.argv[2] ?? 4393);
  const delayMs = Number(process.env.MOCK_DELAY_MS ?? process.argv[3] ?? 0);
  const scripts = Object.fromEntries(REPAIR_EVAL_CASES.map((entry) => [entry.id, entry.script]));
  scripts["endpoint-503"] = [{ status: 503, body: { error: { message: "Service Unavailable (scripted)" } } }];
  scripts["slow-round-2"] = SLOW_ROUND_2_SCRIPT;
  scripts["two-fixes"] = TWO_FIXES_SCRIPT;
  const mock = await startRepairMockEndpoint({ scripts, port, delayMs, usage: process.env.MOCK_USAGE === "1" });
  console.log(`Scripted repair mock on http://127.0.0.1:${mock.port}/<case-id>/v1 (no real model, no key needed)`);
  for (const entry of REPAIR_EVAL_CASES) console.log(`  ${entry.id}: http://127.0.0.1:${mock.port}/${entry.id}/v1`);
}
