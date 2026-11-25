#!/usr/bin/env node
/**
 * MVP walkthrough: drives the real Creator UI (Creator Server build, one Chromium) through
 * every author-facing AI Assist capability against scripted mock endpoints, asserts each
 * outcome, and saves screenshots plus a JSON report. No real model, no real key.
 *
 *   npm run build:dashboard
 *   node scripts/repair-eval/mvp-walkthrough.mjs --out <dir>
 *
 * Uses a throwaway data root; a dummy key ("mvp-dummy-key-not-secret") checks redaction.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { chromium } from "@playwright/test";
import { createCreatorServer } from "../../apps/creator-server/src/server.mjs";
import { REPAIR_EVAL_CASES } from "./cases.mjs";
import { startRepairMockEndpoint } from "./mock-endpoint.mjs";

const { values } = parseArgs({ options: { out: { type: "string" } } });
if (!values.out) {
  console.error("Usage: node scripts/repair-eval/mvp-walkthrough.mjs --out <dir>");
  process.exit(1);
}
const OUT = values.out;
const REPO = fileURLToPath(new URL("../..", import.meta.url));
const DUMMY_KEY = "mvp-dummy-key-not-secret";
const ONBOARDING_KEY = "reigns-agent.creator-web.onboarding-completed";

const loopCase = REPAIR_EVAL_CASES.find((entry) => entry.id === "fog-gate-wipe-then-fix");
const deck = loopCase.deck();
const selectedCard = deck.cards[1];
const otherCard = deck.cards[2];
const scripts = {
  loop: loopCase.script.map((step) => ({ proposals: step, delayMs: 1500 })),
  explain: [{ answer: `MVP: ${selectedCard.id} is an early fog-watch card; its choices move the harbour gauges.`, proposals: [] }],
  edit: [{ proposals: [
    { id: "translate", title: "Translate the card text", summary: "Rewrites only the selected card's text.", patches: [{ op: "updateCard", cardId: selectedCard.id, changes: { text: "MVP translated text for the selected card." } }] },
    { id: "sneak", title: "Also rewrite another card", summary: "Out of scope on purpose.", patches: [{ op: "updateCard", cardId: otherCard.id, changes: { text: "Should be discarded." } }] }
  ] }],
  draft: [[]],
  slow: [{ proposals: [], delayMs: 15000 }]
};

const results = [];
async function step(name, run) {
  const startedAt = Date.now();
  try {
    const detail = await run();
    results.push({ name, ok: true, ms: Date.now() - startedAt, ...(detail ? { detail } : {}) });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, ok: false, ms: Date.now() - startedAt, error: String(error?.message ?? error).slice(0, 400) });
    console.log(`FAIL ${name}: ${String(error?.message ?? error).split("\n")[0]}`);
  }
}
function expect(condition, message) {
  if (!condition) throw new Error(message);
}

await mkdir(OUT, { recursive: true });
const mock = await startRepairMockEndpoint({ scripts });
const dataRoot = await mkdtemp(join(tmpdir(), "reigns-mvp-"));
const creator = await createCreatorServer({ rootDir: REPO, dataRoot, staticRoot: join(REPO, "apps/creator-web/dist") });
const { origin } = await creator.start({ host: "127.0.0.1", port: 0 });
const { capability } = await (await fetch(`${origin}/api/session`)).json();
const api = async (method, path, body) => {
  const response = await fetch(`${origin}${path}`, { method, headers: { "content-type": "application/json", "x-reigns-agent-capability": capability }, body: body === undefined ? undefined : JSON.stringify(body) });
  return response.json();
};
const useScript = (scriptId) => api("PATCH", "/api/config", { ai: { endpoint: `http://127.0.0.1:${mock.port}/${scriptId}/v1`, protocol: "openai_chat", endpointPresetId: "custom", compatibilityFamily: "custom", modelId: "scripted-mvp-model", routeMode: "auto", jsonMode: "auto", capabilities: ["structuredJson"], apiKey: DUMMY_KEY } });
await api("POST", "/api/editor/import", { bundle: deck });
await api("PATCH", "/api/config", { aiAssistEnabled: true, locale: "en", theme: "github-light" });
await useScript("loop");

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
await context.addInitScript((key) => { try { localStorage.setItem(key, "true"); } catch { /* storage optional */ } }, ONBOARDING_KEY);
const page = await context.newPage();
const shot = (name, locator = null) => (locator ?? page).screenshot({ path: join(OUT, `${name}.png`), ...(locator ? {} : { fullPage: false }) });
const open = async (path) => {
  await page.goto(`${origin}${path}`);
  await page.locator(".stage__status strong").filter({ hasText: /cards loaded|loaded|ready/i }).first().waitFor({ timeout: 15000 }).catch(() => {});
};

try {
  await step("AI layer shows a real status instead of a fake loader", async () => {
    await open("/workbench/overview?ai=1");
    const status = page.getByTestId("ai-ambient-status");
    await status.waitFor();
    const text = await status.textContent();
    expect(/AI ready · scripted-mvp-model · \d+ cards · review not run/.test(text), `status: ${text}`);
    expect(await page.getByText("Preparing AI context").count() === 0, "fake loader still shown");
    await shot("01-ai-layer-status");
    return text;
  });

  await step("Author brief is saved", async () => {
    await open("/workbench/ai-edit");
    const brief = page.getByTestId("ai-author-brief");
    await brief.locator("summary").click();
    await brief.locator("textarea").fill("Fog-bound port city. Terse, ominous tone. Never use gore.");
    await brief.getByRole("button", { name: "Save brief" }).click();
    await brief.getByText("Saved.").waitFor();
    await shot("02-author-brief", brief);
  });

  await step("Review shows real progress, ETA, and blocks a second run", async () => {
    await open("/workbench/review");
    await page.locator(".review-run-row input").first().fill("10000");
    await page.getByRole("button", { name: "Run review" }).click();
    await page.getByTestId("review-progress").waitFor();
    expect(await page.getByRole("button", { name: "Running review..." }).isDisabled(), "Run review not disabled");
    await page.getByTestId("review-eta").waitFor({ timeout: 10000 });
    await shot("03-review-progress", page.locator(".panel").first());
    await page.getByTestId("review-progress").waitFor({ state: "hidden", timeout: 60000 });
    const score = await page.locator(".review-score").textContent();
    return score.replace(/\s+/g, " ").trim().slice(0, 60);
  });

  await step("Repair preflight shows the capability card", async () => {
    await page.locator(".review-run-row input").first().fill("500");
    await page.getByRole("button", { name: "Run review" }).click();
    await page.getByTestId("review-progress").waitFor({ state: "hidden", timeout: 30000 });
    await page.getByRole("tab", { name: /^Issues/ }).click();
    await page.locator(".review-issue", { hasText: "unreachable_cards" }).first().getByRole("button", { name: "AI Repair" }).click();
    const preflight = page.getByRole("dialog", { name: "AI Assist preflight" });
    await preflight.getByTestId("ai-capability-card").locator("summary").click();
    const text = await preflight.getByTestId("ai-capability-card").textContent();
    expect(/Up to 3 rounds/.test(text) && /never written to the activity log/.test(text), "capability rules missing");
    await shot("04-repair-preflight", preflight);
    await preflight.getByRole("button", { name: "Build draft" }).click();
  });

  await step("Repair loop shows Round r/3 with real stages, then verifies in round 2", async () => {
    const loop = page.getByTestId("repair-loop-progress");
    await loop.waitFor({ timeout: 15000 });
    await page.getByText(/Round 1\/3/).first().waitFor({ timeout: 10000 });
    await shot("05-loop-round1-request", page.locator(".ai-edit-controls"));
    await page.getByText(/Round 2\/3/).first().waitFor({ timeout: 30000 });
    await page.getByTestId("repair-verification").waitFor({ timeout: 60000 });
    const summary = await page.getByTestId("repair-verification").textContent();
    expect(/Repair loop · 2\/3 rounds/.test(summary), `summary: ${summary.slice(0, 120)}`);
    expect(/gates_preserved/.test(summary), "round 1 block reason missing");
    await shot("06-loop-verified", page.locator(".ai-edit-layout"));
  });

  await step("Context shows which cards the AI saw, the brief, and why", async () => {
    const selection = page.getByTestId("context-selection").first();
    expect(/AI saw \d+ of \d+ cards/.test(await selection.textContent()), "context selection missing");
    await selection.locator("summary").click();
    expect(await selection.locator(".context-selection__table tbody tr").count() > 0, "no context rows");
    const extras = await page.getByTestId("context-extras").textContent();
    expect(/Author brief included/.test(extras), `extras: ${extras}`);
    await shot("07-context-cards", selection);
    return extras.trim();
  });

  await step("Apply marks the activity record as applied", async () => {
    await page.getByRole("button", { name: "Apply selected" }).click();
    const item = page.getByTestId("repair-history-item").first();
    await item.getByText(/Applied \d/).waitFor({ timeout: 10000 });
  });

  await step("Selection Explain answers only, with the selection sent as content", async () => {
    await useScript("explain");
    await open("/workbench/content?ai=1");
    await page.locator(".card-switcher__item").nth(1).click();
    await page.locator(".ai-selection-handle").click();
    await page.getByRole("button", { name: "Explain", exact: true }).click();
    const preflight = page.getByRole("dialog", { name: "AI Assist preflight" });
    expect((await preflight.getByTestId("ai-selection-chip").textContent()).includes(selectedCard.id), "selection chip missing");
    await shot("08-selection-preflight", preflight);
    await preflight.getByRole("button", { name: "Build draft" }).click();
    const answer = page.getByTestId("ai-answer");
    await answer.waitFor({ timeout: 15000 });
    expect((await answer.textContent()).includes("MVP:"), "answer missing");
    expect(await page.locator(".ai-proposal").count() === 0, "explain produced proposals");
    await shot("09-selection-explain-answer", page.locator(".subsection", { has: answer }).first());
  });

  await step("Selection Translate keeps only edits to the selected card", async () => {
    await useScript("edit");
    await open("/workbench/content?ai=1");
    await page.locator(".card-switcher__item").nth(1).click();
    await page.locator(".ai-selection-handle").click();
    await page.getByRole("button", { name: "Translate", exact: true }).click();
    await page.getByRole("dialog", { name: "AI Assist preflight" }).getByRole("button", { name: "Build draft" }).click();
    const rejected = page.getByTestId("ai-scope-rejected");
    await rejected.waitFor({ timeout: 15000 });
    expect((await rejected.textContent()).includes(otherCard.id), "out-of-scope proposal not reported");
    expect(await page.locator(".ai-proposal").count() === 1, "expected exactly one kept proposal");
    await shot("10-selection-edit-scope", page.locator(".subsection", { has: rejected }).first());
  });

  await step("Cancel stops a slow request and is logged", async () => {
    await useScript("slow");
    await open("/workbench/ai-edit");
    await page.locator("textarea[placeholder^='Describe what the AI']").fill("Draft one card.");
    await page.getByRole("button", { name: "Build draft" }).first().click();
    await page.waitForTimeout(1200);
    await page.locator(".ai-edit-controls .btn--danger", { hasText: "Cancel" }).click();
    await page.locator(".ai-build-error", { hasText: "Cancelled" }).waitFor({ timeout: 10000 });
    await shot("11-cancelled", page.locator(".ai-edit-controls"));
    const records = (await api("GET", "/api/ai/repair-history")).records;
    await new Promise((resolve) => setTimeout(resolve, 500));
    const after = (await api("GET", "/api/ai/repair-history")).records;
    expect([...records, ...after].some((entry) => entry.status === "cancelled"), "no cancelled record");
  });

  await step("Session request limit blocks requests before they are sent", async () => {
    await useScript("draft");
    const before = await api("GET", "/api/ai/session-usage");
    await api("PATCH", "/api/config", { ai: { sessionRequestLimit: before.used + 1 } });
    const sentBefore = mock.requests.length;
    await open("/workbench/ai-edit");
    await page.locator("textarea[placeholder^='Describe what the AI']").fill("Draft one card.");
    await page.getByRole("button", { name: "Build draft" }).first().click();
    await page.getByTestId("ai-progress").and(page.locator("[data-status='ready']")).waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: "Build draft" }).first().click();
    await page.locator(".ai-build-error", { hasText: "AI request limit" }).waitFor({ timeout: 10000 });
    expect(mock.requests.length === sentBefore + 1, `endpoint saw ${mock.requests.length - sentBefore} requests (expected 1)`);
    await shot("12-session-limit", page.locator(".ai-edit-controls"));
    await api("PATCH", "/api/config", { ai: { sessionRequestLimit: 60 } });
    return `limit ${before.used + 1}, endpoint requests ${mock.requests.length - sentBefore}`;
  });

  await step("Activity log: kinds, replay with conversation, compare, export without secrets", async () => {
    await open("/workbench/ai-edit");
    const activity = page.getByTestId("repair-history");
    await activity.getByRole("button", { name: /^All \d+/ }).waitFor();
    const filters = await activity.locator(".repair-history__filters").textContent();
    await activity.getByRole("button", { name: /^Repair loops/ }).click();
    await activity.getByTestId("repair-history-item").first().locator(".repair-history__toggle").click();
    const detail = page.getByTestId("repair-history-detail");
    await detail.getByTestId("repair-conversation").first().locator("summary").click();
    expect(/Round 1[\s\S]*Round 2/.test(await detail.textContent()), "rounds not replayed");
    await shot("13-activity-replay", activity);
    // Compare the repair loop with the selection Translate run (different kinds, same project).
    await activity.getByRole("checkbox", { name: "Compare" }).first().check();
    await activity.getByRole("button", { name: /^Selection/ }).click();
    await activity.getByRole("checkbox", { name: "Compare" }).first().check();
    await page.getByTestId("repair-history-compare").waitFor();
    await shot("14-activity-compare", page.getByTestId("repair-history-compare"));
    const downloadPromise = page.waitForEvent("download");
    await activity.getByRole("button", { name: "Export log" }).click();
    const exported = await readFile(await (await downloadPromise).path(), "utf8");
    expect(!exported.includes(DUMMY_KEY), "export contains the key");
    expect(!exported.includes(`127.0.0.1:${mock.port}`), "export contains the endpoint address");
    await writeFile(join(OUT, "activity-export.json"), exported);
    return filters.replace(/\s+/g, " ").trim();
  });

  await step("Server refuses a tampered plan", async () => {
    await useScript("draft");
    const plan = await api("POST", "/api/ai/edit/plan", { mode: "generate_cards", config: { provider: "openai_chat", endpoint: `http://127.0.0.1:${mock.port}/draft/v1`, modelId: "scripted-mvp-model" }, instruction: "Draft one card." });
    const tampered = { ...plan, proposals: [{ id: "x", title: "Injected", patches: [{ op: "updateCard", cardId: selectedCard.id, changes: { text: "tampered" } }] }] };
    const result = await api("POST", "/api/ai/edit/apply", { plan: tampered, proposalIds: ["x"] });
    expect(result?.error?.code === "ai_plan_untrusted", `apply answered ${JSON.stringify(result).slice(0, 120)}`);
  });

  await step("Player build excludes the author brief", async () => {
    const { build } = await api("POST", "/api/build/prepare", {});
    expect(!JSON.stringify(build).includes("Never use gore"), "author brief leaked into the build");
  });

  await step("Tablet 834 px and Phantom skin render the AI Assist panel", async () => {
    await page.setViewportSize({ width: 834, height: 1194 });
    await open("/workbench/review");
    await page.getByRole("button", { name: "Run review" }).click();
    await page.locator(".review-score").waitFor();
    await shot("15-tablet-834-review");
    await page.setViewportSize({ width: 1440, height: 900 });
    await open("/workbench/ai-edit?skin=phantom");
    await shot("16-phantom-ai-assist");
  });
} finally {
  await browser.close();
  await creator.close();
  await mock.close();
  await rm(dataRoot, { recursive: true, force: true });
}

const passed = results.filter((entry) => entry.ok).length;
await writeFile(join(OUT, "report.json"), `${JSON.stringify({ ranAt: new Date().toISOString(), passed, total: results.length, results, endpointRequests: mock.requests.length }, null, 2)}\n`);
console.log(`\n${passed}/${results.length} steps passed; mock endpoint received ${mock.requests.length} requests; report in ${OUT}`);
process.exit(passed === results.length ? 0 : 1);
