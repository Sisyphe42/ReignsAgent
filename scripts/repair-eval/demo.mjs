#!/usr/bin/env node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createCreatorServer } from "../../apps/creator-server/src/server.mjs";
import { REPAIR_EVAL_CASES } from "./cases.mjs";
import { startRepairMockEndpoint } from "./mock-endpoint.mjs";

/**
 * Local repair-loop demo: a Creator Server on a throwaway data root (never the
 * real workspace or its saved keys), the scripted mock endpoint, and one eval
 * case's broken deck imported. Usage:
 *   node scripts/repair-eval/demo.mjs [case-id] [creator-port] [mock-port]
 * Requires a built dashboard (npm run build:dashboard).
 */
const caseId = process.argv[2] ?? "fog-gate-wipe-then-fix";
const creatorPort = Number(process.argv[3] ?? 4331);
const mockPort = Number(process.argv[4] ?? 4393);
const entry = REPAIR_EVAL_CASES.find((candidate) => candidate.id === caseId);
if (!entry) {
  console.error(`Unknown case '${caseId}'. Known: ${REPAIR_EVAL_CASES.map((candidate) => candidate.id).join(", ")}`);
  process.exit(1);
}

const rootDir = fileURLToPath(new URL("../..", import.meta.url));
const dataRoot = await mkdtemp(join(tmpdir(), "reigns-repair-demo-"));
const mock = await startRepairMockEndpoint({ scripts: Object.fromEntries(REPAIR_EVAL_CASES.map((candidate) => [candidate.id, candidate.script])), port: mockPort });
const creator = await createCreatorServer({ rootDir, dataRoot, staticRoot: join(rootDir, "apps/creator-web/dist") });
await creator.start({ host: "127.0.0.1", port: creatorPort });

const base = `http://127.0.0.1:${creatorPort}`;
const { capability } = await (await fetch(`${base}/api/session`)).json();
const call = async (path, body, method = "POST") => {
  const response = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", "x-reigns-agent-capability": capability }, body: JSON.stringify(body) });
  const json = await response.json();
  if (!response.ok || json?.error) throw new Error(json?.error?.message ?? `HTTP ${response.status}`);
  return json;
};
await call("/api/editor/import", { bundle: entry.deck() });
await call("/api/config", {
  aiAssistEnabled: true,
  ai: { endpoint: `http://127.0.0.1:${mock.port}/${entry.id}/v1`, protocol: "openai_chat", endpointPresetId: "custom", compatibilityFamily: "custom", modelId: "scripted-repair-model", routeMode: "auto", jsonMode: "auto", capabilities: ["structuredJson"] }
}, "PATCH");

console.log(`Repair demo '${entry.id}': ${entry.description}`);
console.log(`Creator: ${base}/workbench/review   (data root ${dataRoot}, deleted on exit)`);
console.log(`Mock endpoint: http://127.0.0.1:${mock.port}/${entry.id}/v1 (scripted, no key)`);
console.log("Steps: Run review -> Issues -> AI Repair on the issue -> Build draft -> inspect Repair loop evidence -> tick -> Apply selected.");

const shutdown = async () => {
  await creator.close();
  await mock.close();
  await rm(dataRoot, { recursive: true, force: true });
  process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
