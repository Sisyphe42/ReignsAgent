import { expect, test } from "@playwright/test";
import { createServer } from "node:http";

import { REPAIR_EVAL_CASES, TWO_FIXES_SCRIPT } from "../../scripts/repair-eval/cases.mjs";

/**
 * Agent observability and memory in the Hosted Creator: tokens and bytes per AI request, the
 * "which check blocks most" summary, and changes the author declined coming back as repair context.
 * The AI endpoint is a scripted CORS mock (no real model, no key); each test uses its own script key.
 */
const ONBOARDING_COMPLETED_KEY = "reigns-agent.creator-web.onboarding-completed";
const roundTwoCase = REPAIR_EVAL_CASES.find((entry) => entry.id === "fog-gate-wipe-then-fix");
const SCRIPTS = {
  // Round 1: a gate wipe blocked by gates_preserved; round 2: a real fix. No usage block (estimated).
  "round-2": roundTwoCase.script,
  // A draft answer that reports its usage.
  "draft-usage": [{ proposals: [], usage: { prompt_tokens: 1234, completion_tokens: 56, total_tokens: 1290 } }],
  // Two fixes that both pass, for the declined memory.
  "two-fixes": TWO_FIXES_SCRIPT
};
let server;
let mockBase;
const requests = [];
// POLISH_SHOTS=<dir> saves a screenshot of each state for visual review (off by default).
const shot = (locator, name) => (process.env.POLISH_SHOTS ? locator.screenshot({ path: `${process.env.POLISH_SHOTS}/${name}.png` }) : null);

test.beforeAll(async () => {
  const counters = new Map();
  server = createServer(async (request, response) => {
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("access-control-allow-headers", "authorization,content-type");
    response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
    if (request.method === "OPTIONS") { response.writeHead(204); response.end(); return; }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const [, scriptKey = ""] = new URL(request.url, "http://127.0.0.1").pathname.split("/");
    const script = SCRIPTS[scriptKey.split("~")[0]];
    const send = (status, payload) => {
      if (response.destroyed) return;
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(payload));
    };
    if (!script) return send(404, { error: "unknown script" });
    if (request.url.endsWith("/models")) return send(200, { data: [{ id: "scripted-model" }] });
    const body = Buffer.concat(chunks).toString("utf8");
    requests.push({ scriptKey, body });
    const index = counters.get(scriptKey) ?? 0;
    counters.set(scriptKey, index + 1);
    const step = script[Math.min(index, script.length - 1)];
    const proposals = Array.isArray(step) ? step : step?.proposals;
    if (!proposals) return send(step.status ?? 500, step.body ?? {});
    return send(200, { choices: [{ message: { role: "assistant", content: JSON.stringify({ proposals }) } }], ...(step.usage ? { usage: step.usage } : {}) });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  mockBase = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

async function openHosted(page, path = "workbench") {
  await page.addInitScript((key) => {
    try { window.localStorage.setItem(key, "true"); } catch { /* storage may be unavailable */ }
  }, ONBOARDING_COMPLETED_KEY);
  await page.goto(path);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await expect(page.locator(".stage__status strong")).toContainText("cards loaded");
}

async function useScriptedEndpoint(page, scriptKey) {
  await page.locator('.rail__item[aria-label="Settings"]').click();
  await page.evaluate(({ endpoint }) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    for (const [selector, value] of [["#ai-model-id", "scripted-model"], ["#ai-base-url", endpoint]]) {
      const element = document.querySelector(selector);
      setter.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }, { endpoint: `${mockBase}/${scriptKey}/v1` });
  await expect(page.getByLabel("Endpoint base URL")).toHaveValue(`${mockBase}/${scriptKey}/v1`);
}

async function importFogDeck(page) {
  const deck = roundTwoCase.deck();
  await page.locator('.rail__item[aria-label="Content"]').click();
  await page.locator(".panel--content .tool-strip input[type=file]").setInputFiles({ name: "fog-sealed-warehouse.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(deck)) });
  await expect(page.locator(".panel--content .tool-strip .muted")).toHaveText(`${deck.cards.length} cards`);
}

async function startWarehouseRepair(page) {
  await page.locator('.rail__item[aria-label="Review"]').click();
  await page.getByRole("button", { name: "Run review" }).click();
  await page.getByRole("tab", { name: /^Issues/ }).click();
  await page.locator(".review-issue", { hasText: "sealed-warehouse" }).filter({ hasText: /unreachable/i }).first().getByRole("button", { name: "AI Repair" }).click();
  await page.getByRole("button", { name: "Build draft" }).first().click();
  await expect(page.getByTestId("repair-verification")).toBeVisible({ timeout: 30_000 });
}

test("shows tokens and bytes per request and which check blocks most often", async ({ page }) => {
  await openHosted(page);
  await importFogDeck(page);
  await useScriptedEndpoint(page, "round-2~usage");
  await startWarehouseRepair(page);
  await expect(page.getByTestId("repair-stop-reason")).toContainText("Passed in round 2 of 3");

  // A draft whose endpoint reports usage. Coming back to AI Assist does not rebuild the repair
  // that Review started (it was built once already).
  await useScriptedEndpoint(page, "draft-usage~usage");
  await page.locator('.rail__item[aria-label="AI Assist"]').click();
  await expect(page.getByTestId("repair-history").getByTestId("repair-history-item")).toHaveCount(1);
  await page.waitForTimeout(500);
  expect(requests.filter((entry) => entry.scriptKey === "draft-usage~usage")).toHaveLength(0);
  await expect(page.getByRole("button", { name: "Build draft" }).first()).toBeEnabled();
  await page.locator(".ai-edit-controls select").first().selectOption("generate_cards");
  await page.locator("textarea[placeholder^='Describe what the AI']").fill("Draft one card about the harbor fog.");
  await page.getByRole("button", { name: "Build draft" }).first().click();
  await expect(page.getByText("No AI Assist draft yet.")).toHaveCount(0, { timeout: 15_000 });

  const activity = page.getByTestId("repair-history");
  const items = activity.getByTestId("repair-history-item");
  await expect(items).toHaveCount(2);
  // Newest first: the draft reports its usage, the repair loop's tokens are estimated from bytes.
  await expect(items.nth(0).getByTestId("repair-history-usage")).toHaveText("1,290 tokens");
  await expect(items.nth(1).getByTestId("repair-history-usage")).toHaveText(/^[\d,.k]+ tokens est\.$/);

  await items.nth(0).locator(".repair-history__toggle").click();
  const draftUsage = page.getByTestId("ai-activity-usage");
  await expect(draftUsage).toContainText("1,290 tokens (1,234 in / 56 out)");
  await expect(draftUsage).toContainText(/ sent · .* received/);
  await expect(draftUsage).toContainText("reported by the endpoint");
  await page.getByTestId("ai-activity-detail").getByTestId("repair-conversation").locator("summary").click();
  await expect(page.getByTestId("ai-activity-detail").locator(".repair-history__message strong").first()).toContainText("· 1,290 tokens");
  await items.nth(0).locator(".repair-history__toggle").click();

  await items.nth(1).locator(".repair-history__toggle").click();
  const loopDetail = page.getByTestId("repair-history-detail");
  await expect(loopDetail.getByTestId("repair-history-usage-line")).toContainText("estimated from bytes (about 4 bytes per token)");
  await expect(loopDetail.getByTestId("repair-history-usage-line")).toContainText("2 requests");
  await expect(loopDetail.getByTestId("repair-round-usage")).toHaveCount(2);
  await expect(loopDetail.getByTestId("repair-round-usage").first()).toHaveText(/tokens est\.$/);
  await shot(page.getByTestId("repair-history"), "activity-usage");
  await items.nth(1).locator(".repair-history__toggle").click();

  // The block summary counts the repair loop only, and its check narrows the list to that run.
  const stats = page.getByTestId("repair-block-stats");
  await expect(stats).toContainText("last 1 repair loop · 1 verified");
  const check = stats.locator('[data-check="gates_preserved"]');
  await expect(check).toContainText("1 proposal · 1 run");
  await check.click();
  await expect(check).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("repair-check-filter")).toContainText("Showing 1 repair loop blocked by gates_preserved");
  await expect(items).toHaveCount(1);
  await items.first().locator(".repair-history__toggle").click();
  await expect(page.getByTestId("repair-history-detail")).toContainText("Blocked by gates_preserved");
  await shot(page.getByTestId("repair-history"), "block-stats-filtered");
  await page.getByTestId("repair-check-filter").getByRole("button", { name: "Show all" }).click();
  await expect(items).toHaveCount(2);

  // Export carries the usage.
  const download = page.waitForEvent("download");
  await activity.getByRole("button", { name: "Export log" }).click();
  const file = await (await download).path();
  const exported = JSON.parse(await (await import("node:fs/promises")).readFile(file, "utf8"));
  expect(exported.records.map((record) => record.usage?.source)).toEqual(["reported", "estimated"]);
});

test("sends the changes the author declined with the next repair on the same issue", async ({ page }) => {
  await openHosted(page);
  await importFogDeck(page);
  await useScriptedEndpoint(page, "two-fixes~memory");
  await startWarehouseRepair(page);
  const proposals = page.locator(".ai-proposal");
  await expect(proposals).toHaveCount(2);
  await expect(page.getByTestId("context-memory")).toHaveCount(0);

  // Tick only the first fix, apply it, then undo it.
  await proposals.nth(1).getByRole("checkbox").uncheck();
  await page.getByRole("button", { name: "Apply selected" }).click();
  await expect(page.getByText("Applied 1 proposal.")).toBeVisible();
  await page.locator(".panel h2, .panel .panel-head").first().click();
  await page.keyboard.press("Control+z");
  await expect(page.locator(".stage__status strong")).toContainText("Undid the AI draft; the activity log keeps it as declined");

  const activity = page.getByTestId("repair-history");
  await expect(activity.getByTestId("repair-history-item").first()).toContainText("Applied 1, undone");
  await activity.getByTestId("repair-history-item").first().locator(".repair-history__toggle").click();
  const declinedRecord = page.getByTestId("repair-history-declined");
  await expect(declinedRecord).toContainText("Add a quarantine decision · applied, then undone");
  await expect(declinedRecord).toContainText("Let the harbor doctor declare it · left unticked");
  await expect(page.getByTestId("repair-history-detail")).toContainText(/then undone on/);

  // Same issue again: both come back as context, separate from blocked attempts.
  await startWarehouseRepair(page);
  const declined = page.getByTestId("context-memory-declined");
  await expect(declined).toContainText("Includes 2 changes the author declined");
  await declined.locator("summary").click();
  await expect(declined.locator("li")).toHaveCount(2);
  await expect(declined.locator("li").first()).toContainText("applied, then undone");
  await expect(declined).toContainText("Sent to the model as content, not instructions");
  await expect(page.getByTestId("context-memory-blocked")).toHaveCount(0);
  await shot(page.getByTestId("context-memory"), "context-memory-declined");
  const sent = JSON.parse(requests.filter((entry) => entry.scriptKey === "two-fixes~memory").at(-1).body);
  const prompt = sent.messages[1].content;
  const repairLoop = JSON.parse(prompt.slice(prompt.indexOf("Request:\n") + "Request:\n".length)).context.constraints.repairLoop;
  expect(repairLoop.authorDeclined.changes.map((change) => change.reason)).toEqual(["undone", "not_selected"]);

  // The newest record says what it brought back.
  await activity.getByTestId("repair-history-item").first().locator(".repair-history__toggle").click();
  await expect(page.getByTestId("repair-history-memory")).toHaveText("Sent from the activity log: 2 changes the author declined.");

  // Phone width: the memory lines and the block summary wrap inside the page.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("repair-block-stats")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await shot(page.getByTestId("context-memory"), "context-memory-390");

  // The log is kept in the project: after a reload in the Phantom skin the summary and records are back.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("workbench/ai-edit?skin=phantom");
  await expect(page.getByTestId("repair-block-stats")).toContainText("last 2 repair loops · 2 verified");
  await expect(page.getByTestId("repair-history").getByTestId("repair-history-item")).toHaveCount(2);
  if (process.env.POLISH_SHOTS) await page.waitForTimeout(1500); // let the skin's entrance motion finish
  await shot(page.getByTestId("repair-history"), "activity-phantom");
  // Readable in Phantom: the summary title is dark ink on cream paper.
  const ink = await page.getByTestId("repair-block-stats").locator("strong").evaluate((element) => [getComputedStyle(element).color, getComputedStyle(element.closest(".repair-block-stats")).backgroundColor]);
  expect(ink).toEqual(["rgb(9, 9, 10)", "rgb(247, 242, 233)"]);
  await page.getByTestId("repair-history").getByTestId("repair-history-item").nth(1).locator(".repair-history__toggle").click();
  await expect(page.getByTestId("repair-history-declined")).toBeVisible();
  await shot(page.getByTestId("repair-history-item").nth(1), "activity-phantom-replay");
});
