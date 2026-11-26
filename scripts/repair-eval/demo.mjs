#!/usr/bin/env node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createCreatorServer } from "../../apps/creator-server/src/server.mjs";
import { REPAIR_EVAL_CASES, SLOW_ROUND_2_SCRIPT } from "./cases.mjs";
import { startRepairMockEndpoint } from "./mock-endpoint.mjs";

/**
 * Local repair-loop demo: a Creator Server on a throwaway data root (never the
 * real workspace or its saved keys), the scripted mock endpoint, and one eval
 * case's broken deck imported. Usage:
 *   node scripts/repair-eval/demo.mjs [case-id] [creator-port] [mock-port] [replay.json]
 * replay.json ({ id, deckCase, script }) replays recorded model answers (for
 * example from a real-endpoint eval run) on the deck of an existing case.
 * Requires a built dashboard (npm run build:dashboard).
 * Environment: MOCK_DELAY_MS=4000 delays every mock answer (shows "Round r/3 · Request"
 * progress); DEMO_DECK=blank opens an empty project instead (empty-deck state);
 * DEMO_AI_CASE=endpoint-503 makes every request fail with HTTP 503;
 * DEMO_AI_CASE=slow-round-2 answers round 1 at once (a blocked proposal) and holds round 2
 * for 60 s, so Cancel during round 2 shows the neutral "Cancelled" state with round 1 kept.
 * Add ?skin=<id> to the Creator URL for another skin (for example ?skin=phantom).
 */
const caseId = process.argv[2] ?? "fog-gate-wipe-then-fix";
const creatorPort = Number(process.argv[3] ?? 4331);
const mockPort = Number(process.argv[4] ?? 4393);
const replay = process.argv[5] ? JSON.parse(await readFile(process.argv[5], "utf8")) : null;
const cases = [...REPAIR_EVAL_CASES];
if (replay) {
  const deckCase = REPAIR_EVAL_CASES.find((candidate) => candidate.id === replay.deckCase);
  if (!deckCase) throw new Error(`Unknown replay deckCase '${replay.deckCase}'`);
  cases.push({ ...deckCase, id: replay.id, description: replay.description ?? `Replay of recorded answers on ${deckCase.id}`, script: replay.script });
}
const entry = cases.find((candidate) => candidate.id === (replay ? replay.id : caseId));
if (!entry) {
  console.error(`Unknown case '${caseId}'. Known: ${REPAIR_EVAL_CASES.map((candidate) => candidate.id).join(", ")}`);
  process.exit(1);
}

const rootDir = fileURLToPath(new URL("../..", import.meta.url));
const dataRoot = await mkdtemp(join(tmpdir(), "reigns-repair-demo-"));
const delayMs = Number(process.env.MOCK_DELAY_MS ?? 0) || 0;
const mockScripts = Object.fromEntries(cases.map((candidate) => [candidate.id, candidate.script]));
mockScripts["endpoint-503"] = [{ status: 503, body: { error: { message: "Service Unavailable (scripted)" } } }];
mockScripts["slow-round-2"] = SLOW_ROUND_2_SCRIPT;
const aiCase = process.env.DEMO_AI_CASE || entry.id;
const mock = await startRepairMockEndpoint({ scripts: mockScripts, port: mockPort, delayMs });
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
if (process.env.DEMO_DECK === "blank") await call("/api/projects", { source: "blank" });
else await call("/api/editor/import", { bundle: entry.deck() });
await call("/api/config", {
  aiAssistEnabled: true,
  locale: "en",
  theme: "github-light",
  ai: { endpoint: `http://127.0.0.1:${mock.port}/${aiCase}/v1`, protocol: "openai_chat", endpointPresetId: "custom", compatibilityFamily: "custom", modelId: "scripted-repair-model", routeMode: "auto", jsonMode: "auto", capabilities: ["structuredJson"] }
}, "PATCH");

console.log(`Repair demo '${entry.id}': ${entry.description}`);
console.log(`Creator: ${base}/workbench/review   (data root ${dataRoot}, deleted on exit)`);
console.log(`Mock endpoint: http://127.0.0.1:${mock.port}/${aiCase}/v1 (scripted, no key${delayMs ? `, ${delayMs} ms delay` : ""})`);
console.log("Steps: Run review -> Issues -> AI Repair on the issue -> Build draft -> inspect Repair loop evidence -> tick -> Apply selected.");

const shutdown = async () => {
  await creator.close();
  await mock.close();
  await rm(dataRoot, { recursive: true, force: true });
  process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
