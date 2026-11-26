#!/usr/bin/env node
/**
 * Live repair-loop capture: one bounded repair loop through the real Creator UI against a
 * real, keyless loopback endpoint. A counting proxy forwards at most --max-requests chat
 * requests and answers 503 after that, so the run can never exceed its budget. Writes three
 * screenshots and the key-free history record (endpoint address replaced by <loopback>).
 *
 *   node scripts/repair-eval/live-capture.mjs --endpoint http://127.0.0.1:3425 --model <id> --out <dir> [--max-requests 3] [--case fog-direct-fix]
 *
 * Sends real model requests: run it only with an approved request budget. No API key is read or sent.
 * Requires a built dashboard (npm run build:dashboard).
 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { chromium } from "@playwright/test";
import { createCreatorServer } from "../../apps/creator-server/src/server.mjs";
import { REPAIR_EVAL_CASES } from "./cases.mjs";

const { values } = parseArgs({ options: { endpoint: { type: "string" }, model: { type: "string" }, out: { type: "string" }, "max-requests": { type: "string", default: "3" }, case: { type: "string", default: "fog-direct-fix" } } });
if (!values.endpoint || !values.model || !values.out) {
  console.error("Usage: node scripts/repair-eval/live-capture.mjs --endpoint <loopback root> --model <id> --out <dir> [--max-requests 3] [--case <id>]");
  process.exit(1);
}
const upstreamUrl = new URL(values.endpoint);
if (!["127.0.0.1", "localhost", "[::1]"].includes(upstreamUrl.hostname)) {
  console.error("live-capture only talks to a loopback endpoint.");
  process.exit(1);
}
const REPO = fileURLToPath(new URL("../..", import.meta.url));
const OUT = values.out;
const UPSTREAM = values.endpoint.replace(/\/+$/, "").replace(/\/v1$/, "");
const MODEL = values.model;
const MAX_REQUESTS = Math.max(1, Math.min(9, Number(values["max-requests"]) || 3));
await mkdir(OUT, { recursive: true });

let forwarded = 0;
const proxy = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (req.method === "POST" && req.url.includes("/chat/completions")) {
    if (forwarded >= MAX_REQUESTS) { res.writeHead(503, { "content-type": "application/json" }); res.end('{"error":"live capture request cap reached"}'); return; }
    forwarded += 1;
  }
  try {
    const upstream = await fetch(`${UPSTREAM}${req.url}`, { method: req.method, headers: { "content-type": "application/json" }, body: req.method === "POST" ? Buffer.concat(chunks) : undefined, signal: AbortSignal.timeout(150_000) });
    res.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/json" });
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    res.writeHead(502, { "content-type": "application/json" }); res.end(JSON.stringify({ error: String(error?.message ?? error) }));
  }
});
await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));

const dataRoot = await mkdtemp(join(tmpdir(), "ra-live-"));
const creator = await createCreatorServer({ rootDir: REPO, dataRoot, staticRoot: join(REPO, "apps/creator-web/dist") });
const { origin } = await creator.start({ host: "127.0.0.1", port: 0 });
const { capability } = await (await fetch(`${origin}/api/session`)).json();
const call = async (path, body, method = "POST") => {
  const response = await fetch(`${origin}${path}`, { method, headers: { "content-type": "application/json", "x-reigns-agent-capability": capability }, body: method === "GET" ? undefined : JSON.stringify(body) });
  return response.json();
};
await call("/api/editor/import", { bundle: REPAIR_EVAL_CASES.find((entry) => entry.id === values.case).deck() });
await call("/api/config", { aiAssistEnabled: true, locale: "en", theme: "github-light", ai: { endpoint: `http://127.0.0.1:${proxy.address().port}/v1`, protocol: "openai_chat", endpointPresetId: "custom", compatibilityFamily: "custom", modelId: MODEL, routeMode: "auto", jsonMode: "auto", capabilities: ["structuredJson"] } }, "PATCH");

const browser = await chromium.launch();
const startedAt = Date.now();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await page.addInitScript(() => { try { localStorage.setItem("reigns-agent.creator-web.onboarding-completed", "true"); } catch {} });
  await page.goto(`${origin}/workbench/review`);
  await page.getByRole("button", { name: "Run review" }).click();
  await page.getByRole("tab", { name: /^Issues/ }).click();
  await page.locator(".review-issue", { hasText: "unreachable_cards" }).first().getByRole("button", { name: "AI Repair" }).click();
  await page.getByRole("button", { name: "Build draft" }).first().click();
  await page.waitForTimeout(4000);
  await page.locator(".ai-edit-controls").screenshot({ path: `${OUT}/L1-live-request-in-flight.png` });
  await page.getByTestId("repair-verification").waitFor({ timeout: 320_000 }).catch(() => {});
  await page.getByTestId("ai-build-notice").waitFor({ timeout: 1000 }).catch(() => {});
  await page.locator(".ai-edit-layout").screenshot({ path: `${OUT}/L2-live-result.png` });
  const history = page.getByTestId("repair-history");
  await history.getByTestId("repair-history-item").first().locator(".repair-history__toggle").click();
  await page.getByTestId("repair-history-detail").waitFor();
  await page.getByTestId("repair-conversation").first().locator("summary").click().catch(() => {});
  await history.screenshot({ path: `${OUT}/L3-live-history-replay.png` });
  const list = await call("/api/ai/repair-history", undefined, "GET");
  const record = (await call(`/api/ai/repair-history/${list.records[0].id}`, undefined, "GET")).record;
  // Replace the per-run proxy port so the saved record carries no local addresses.
  const text = JSON.stringify(record, null, 2).replaceAll(`127.0.0.1:${proxy.address().port}`, "<loopback>");
  await writeFile(`${OUT}/live-record.json`, `${text}\n`);
  console.log(JSON.stringify({ forwarded, seconds: Math.round((Date.now() - startedAt) / 1000), status: record.status, stopReason: record.stopReason, rounds: record.rounds.length, scores: record.rounds.map((round) => round.bestScore), model: record.model }));
} finally {
  await browser.close();
  await creator.close();
  await new Promise((resolve) => proxy.close(resolve));
  await rm(dataRoot, { recursive: true, force: true });
}
