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
 */
export async function startRepairMockEndpoint({ scripts, port = 0, host = "127.0.0.1" }) {
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
    if (!Array.isArray(step)) return send(res, step.status ?? 500, step.body ?? { error: "scripted failure" });
    return send(res, 200, { choices: [{ message: { role: "assistant", content: JSON.stringify({ proposals: step }) } }] });
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
  const scripts = Object.fromEntries(REPAIR_EVAL_CASES.map((entry) => [entry.id, entry.script]));
  const mock = await startRepairMockEndpoint({ scripts, port });
  console.log(`Scripted repair mock on http://127.0.0.1:${mock.port}/<case-id>/v1 (no real model, no key needed)`);
  for (const entry of REPAIR_EVAL_CASES) console.log(`  ${entry.id}: http://127.0.0.1:${mock.port}/${entry.id}/v1`);
}
