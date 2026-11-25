import { expect, test } from "@playwright/test";
import { createServer } from "node:http";

import { REPAIR_EVAL_CASES, SLOW_ROUND_2_SCRIPT } from "../../scripts/repair-eval/cases.mjs";

/**
 * Creator states found in the portfolio screenshot review: the author's cancel, an unavailable
 * endpoint, the repair-loop stop sentence, and the phone-width navigation. The AI endpoint is a
 * scripted CORS mock (no real model, no key); each test uses its own script id so counters never leak.
 */
const ONBOARDING_COMPLETED_KEY = "reigns-agent.creator-web.onboarding-completed";
const roundTwoCase = REPAIR_EVAL_CASES.find((entry) => entry.id === "fog-gate-wipe-then-fix");
const SCRIPTS = {
  // Same script as `DEMO_AI_CASE=slow-round-2`: round 1 answers at once (blocked), round 2 waits 60 s.
  "slow-round-2": SLOW_ROUND_2_SCRIPT,
  "down": [{ status: 503, body: { error: { message: "Service Unavailable (scripted)" } } }],
  "round-2": roundTwoCase.script
};
let server;
let mockBase;
// POLISH_SHOTS=<dir> saves a screenshot of each state for visual review (off by default).
const shot = (locator, name) => (process.env.POLISH_SHOTS ? locator.screenshot({ path: `${process.env.POLISH_SHOTS}/${name}.png` }) : null);

test.beforeAll(async () => {
  const counters = new Map();
  server = createServer(async (request, response) => {
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("access-control-allow-headers", "authorization,content-type");
    response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
    if (request.method === "OPTIONS") { response.writeHead(204); response.end(); return; }
    for await (const _chunk of request) { /* drain the body */ }
    const [, scriptKey = ""] = new URL(request.url, "http://127.0.0.1").pathname.split("/");
    const script = SCRIPTS[scriptKey.split("~")[0]];
    const send = (status, payload) => {
      if (response.destroyed) return;
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(payload));
    };
    if (!script) return send(404, { error: "unknown script" });
    if (request.url.endsWith("/models")) return send(200, { data: [{ id: "scripted-model" }] });
    const index = counters.get(scriptKey) ?? 0;
    counters.set(scriptKey, index + 1);
    const step = script[Math.min(index, script.length - 1)];
    if (step?.delayMs) await new Promise((resolve) => setTimeout(resolve, step.delayMs));
    const proposals = Array.isArray(step) ? step : step?.proposals;
    if (!proposals) return send(step.status ?? 500, step.body ?? {});
    return send(200, { choices: [{ message: { role: "assistant", content: JSON.stringify({ proposals }) } }] });
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
}

test("shows the author's cancel as a neutral state that keeps finished rounds", async ({ page }) => {
  await openHosted(page);
  await importFogDeck(page);
  await useScriptedEndpoint(page, "slow-round-2~cancel");
  await startWarehouseRepair(page);
  const loop = page.getByTestId("repair-loop-progress");
  await expect(loop).toContainText("Round 2/3", { timeout: 20_000 });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  const notice = page.getByTestId("ai-build-notice");
  await expect(notice).toHaveAttribute("data-kind", "cancelled", { timeout: 10_000 });
  await expect(notice).toHaveAttribute("role", "status");
  await expect(notice).toHaveClass(/ai-build-notice--neutral/);
  await expect(notice).not.toHaveClass(/ai-build-error/);
  await expect(notice.locator("strong")).toHaveText("Cancelled");
  await expect(notice).toContainText("during round 2 of 3");
  await expect(notice).toContainText("Round 1 had finished and is kept in the repair history below");
  await expect(notice).toContainText("No card was changed.");
  await expect(notice).not.toContainText(/fail/i);
  await expect(notice.getByRole("button", { name: "Build again" })).toBeEnabled();
  await expect(page.getByText("Draft failed")).toHaveCount(0);

  // Neither the progress step nor the loop phase that was interrupted turns error red.
  const danger = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--danger").trim());
  const titleColor = await notice.locator("strong").evaluate((element) => getComputedStyle(element).color);
  expect(titleColor).not.toBe(await page.evaluate((value) => { const probe = document.createElement("span"); probe.style.color = value; document.body.append(probe); const color = getComputedStyle(probe).color; probe.remove(); return color; }, danger));
  const progress = page.getByTestId("ai-progress");
  await expect(progress).toHaveAttribute("data-status", "cancelled");
  await expect(progress.locator(".ai-progress__step--failed")).toHaveCount(0);
  await expect(progress.locator(".ai-progress__step--cancelled")).toHaveCount(1);
  await expect(loop).toHaveAttribute("data-status", "cancelled");
  await expect(loop).not.toHaveClass(/repair-loop-progress--failed/);
  await expect(loop.locator(".repair-loop-progress__phase--failed")).toHaveCount(0);
  await expect(loop.locator(".repair-loop-progress__phase--cancelled")).toHaveCount(1);
  await expect(loop).toContainText("Cancelled during");
  await shot(page.locator(".ai-edit-controls"), "cancelled");

  // The cancelled run is logged with the round that finished.
  const history = page.getByTestId("repair-history");
  await expect(history.getByTestId("repair-history-item").first()).toContainText(/Cancelled/i);
});

test("asks to retry later, not to edit the prompt, when the endpoint answers 503", async ({ page }) => {
  await openHosted(page);
  await useScriptedEndpoint(page, "down~503");
  await page.locator('.rail__item[aria-label="AI Assist"]').click();
  await page.locator("textarea[placeholder^='Describe what the AI']").fill("Draft one card about the harbor fog.");
  await page.getByRole("button", { name: "Build draft" }).first().click();
  const notice = page.getByTestId("ai-build-notice");
  await expect(notice).toHaveAttribute("data-kind", "unavailable", { timeout: 15_000 });
  await expect(notice).toHaveAttribute("role", "alert");
  await expect(notice.locator("strong")).toHaveText("Endpoint unavailable");
  await expect(notice).toContainText("status 503");
  await expect(notice).toContainText("temporarily unavailable");
  await expect(notice).toContainText("wait a moment and retry");
  await expect(notice).not.toContainText(/Edit the prompt/i);
  await expect(notice.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(notice.getByRole("button", { name: "Edit prompt" })).toHaveCount(0);
  expect(await notice.textContent()).not.toMatch(/\.\./);
  await shot(page.locator(".ai-edit-controls"), "endpoint-503");
});

test("names the round in which the repair loop found a passing proposal", async ({ page }) => {
  await openHosted(page);
  await importFogDeck(page);
  await useScriptedEndpoint(page, "round-2~verified");
  await startWarehouseRepair(page);
  const verification = page.getByTestId("repair-verification");
  await expect(verification).toBeVisible({ timeout: 30_000 });
  await expect(verification).toContainText("Repair loop · 2/3 rounds");
  await expect(page.getByTestId("repair-stop-reason")).toHaveText("Passed in round 2 of 3: the first proposal that cleared every blocking check.");
  await expect(verification).not.toContainText("Stopped at the first round");
  await shot(verification, "repair-round-2");

  // The stored history record tells the same story.
  const history = page.getByTestId("repair-history");
  await history.getByTestId("repair-history-item").first().locator(".repair-history__toggle").click();
  await expect(page.getByTestId("repair-history-detail")).toContainText("Passed in round 2 of 3");
});

for (const skin of ["github-light", "phantom"]) {
  test(`keeps every navigation label readable at 390 px (${skin})`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openHosted(page, `workbench/content?skin=${skin}&locale=en`);
    const rail = page.locator("nav.rail");
    const labels = rail.locator(".rail__label");
    await expect(labels).toHaveCount(8);
    for (const label of await labels.all()) {
      const fit = await label.evaluate((element) => ({
        text: element.textContent,
        clipped: element.scrollWidth > element.clientWidth + 1,
        ellipsis: getComputedStyle(element).textOverflow === "ellipsis" && element.scrollWidth > element.clientWidth
      }));
      expect(fit.clipped, `${fit.text} is clipped`).toBe(false);
      expect(fit.ellipsis, `${fit.text} is ellipsized`).toBe(false);
      // Icon, label, and state badge all sit inside the tab (Phantom's decorative shapes may overhang).
      const parts = await label.locator("xpath=..").evaluate((tab) => {
        const box = tab.getBoundingClientRect();
        return [...tab.querySelectorAll(":scope > .rail__icon, :scope > .rail__label, :scope > small")]
          .map((part) => part.getBoundingClientRect())
          .every((rect) => rect.left >= box.left - 1 && rect.right <= box.right + 1);
      });
      expect(parts, `${fit.text} tab content overflows`).toBe(true);
    }
    // The strip scrolls sideways; the page never does.
    expect(await rail.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    await shot(rail, `nav-390-${skin}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // Opening a panel at the far end keeps its tab inside the strip.
    await rail.locator('.rail__item[aria-label="Settings"]').click();
    await expect(rail.locator(".rail__item--active")).toHaveAttribute("aria-label", "Settings");
    const [railBox, activeBox] = await Promise.all([rail.boundingBox(), rail.locator(".rail__item--active").boundingBox()]);
    expect(activeBox.x).toBeGreaterThanOrEqual(railBox.x - 1);
    expect(activeBox.x + activeBox.width).toBeLessThanOrEqual(railBox.x + railBox.width + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
