import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

import { scanContrast } from "./contrast-scan.js";

/**
 * Second batch of Creator states from the portfolio screenshot review: AI progress steps at phone
 * width, the selection preflight eyebrow and quote, and the card text editor. (The review progress
 * sentence is covered in ux-agent.spec.js, next to the review run it measures.) No AI endpoint is
 * configured: every request here runs the local planner.
 */
const ONBOARDING_COMPLETED_KEY = "reigns-agent.creator-web.onboarding-completed";
const SKINS = ["github-light", "catppuccin-latte", "famicom", "classic", "arcade", "phantom", "terminal"];
const FOG_HARBOR = readFileSync(new URL("../../fixtures/content/fog-harbor.cards.json", import.meta.url));
// fog-harbor card whose text ends in a full-width period: "…要看过去一个月的进港记录。"
const CJK_CARD_ID = "customs-inspector";
const shot = (locator, name) => (process.env.POLISH_SHOTS ? locator.screenshot({ path: `${process.env.POLISH_SHOTS}/${name}.png` }) : null);

async function openHosted(page, path = "workbench") {
  await page.addInitScript((key) => {
    try { window.localStorage.setItem(key, "true"); } catch { /* storage may be unavailable */ }
  }, ONBOARDING_COMPLETED_KEY);
  await page.goto(path);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await expect(page.locator(".stage__status strong")).not.toBeEmpty();
}

async function importFogHarbor(page) {
  await page.locator(".panel--content .tool-strip input[type=file]").setInputFiles({ name: "fog-harbor.cards.json", mimeType: "application/json", buffer: FOG_HARBOR });
  await expect(page.locator(`.card-switcher__item[data-ai-card-id="${CJK_CARD_ID}"]`)).toHaveCount(1);
}

for (const skin of SKINS) {
  test(`keeps every AI progress step label whole at 390 px (${skin})`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openHosted(page, `workbench/ai-edit?skin=${skin}&locale=en`);
    await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
    await page.locator("textarea[placeholder^='Describe what the AI']").fill("Draft one card.");
    await page.getByRole("button", { name: "Build draft" }).first().click();
    const progress = page.getByTestId("ai-progress");
    await expect(progress).toHaveAttribute("data-status", "ready", { timeout: 15_000 });
    const steps = progress.locator(".ai-progress__step");
    await expect(steps).toHaveCount(6);
    const box = await progress.boundingBox();
    for (const step of await steps.all()) {
      const fit = await step.evaluate((element) => ({
        text: element.textContent,
        clipped: element.scrollWidth > element.clientWidth + 1
      }));
      expect(fit.clipped, `${skin}: "${fit.text}" is clipped`).toBe(false);
      const stepBox = await step.boundingBox();
      expect(stepBox.x, `${skin}: "${fit.text}" starts outside the progress row`).toBeGreaterThanOrEqual(box.x - 1);
      expect(stepBox.x + stepBox.width, `${skin}: "${fit.text}" ends outside the progress row`).toBeLessThanOrEqual(box.x + box.width + 1);
    }
    // The draft's long JSON lines scroll inside their own box: neither the page nor any panel box
    // grows past the screen (that used to widen the navigation strip to ~1,200 px).
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const outside = await page.evaluate(() => [...document.querySelectorAll(".stage *")]
      .filter((element) => { const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.right > window.innerWidth + 1; })
      .map((element) => `${element.tagName.toLowerCase()}.${[...element.classList].join(".")}`));
    expect(outside, outside.join(", ")).toEqual([]);
    // Steps sit on translucent tints: blend them onto the paper below, as the eye sees them.
    expect(await page.evaluate(scanContrast, { root: "[data-testid=ai-progress]", composite: true })).toEqual([]);
    await shot(progress, `ai-progress-390-${skin}`);
  });
}

test("keeps the six AI progress steps on one even row on a desktop screen", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openHosted(page, "workbench/ai-edit?skin=phantom&locale=en");
  await page.locator("textarea[placeholder^='Describe what the AI']").fill("Draft one card.");
  await page.getByRole("button", { name: "Build draft" }).first().click();
  const progress = page.getByTestId("ai-progress");
  await expect(progress).toHaveAttribute("data-status", "ready", { timeout: 15_000 });
  const boxes = await progress.locator(".ai-progress__step").evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect()).map(({ top, width }) => ({ top, width })));
  expect(new Set(boxes.map(({ top }) => Math.round(top))).size).toBe(1);
  expect(Math.max(...boxes.map(({ width }) => width)) - Math.min(...boxes.map(({ width }) => width))).toBeLessThan(2);
});

// Width of the final "。" inside the quoted selection, and whether the quote is tagged as Chinese.
async function measureSelectionQuote(page, locale) {
  await openHosted(page, `workbench/content?ai=1&locale=${locale}`);
  await importFogHarbor(page);
  const card = page.locator(`.card-switcher__item[data-ai-card-id="${CJK_CARD_ID}"]`);
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await page.locator(".ai-selection-handle").click();
  await page.getByRole("button", { name: "Explain", exact: true }).click();
  const preflight = page.getByRole("dialog", { name: "AI Assist preflight" });
  const quote = preflight.getByTestId("ai-selection-chip").getByTestId("quoted-text");
  await expect(quote).toHaveText(/记录。$/);
  return {
    preflight,
    ...(await quote.evaluate((element) => {
      const node = element.firstChild;
      const range = document.createRange();
      range.setStart(node, node.length - 1);
      range.setEnd(node, node.length);
      return { lang: element.getAttribute("lang"), font: getComputedStyle(element).fontFamily, periodWidth: range.getBoundingClientRect().width };
    }))
  };
}

test("calls the floating selection layer Selection and closes the quote right after 。", async ({ page, browser }) => {
  const english = await measureSelectionQuote(page, "en");
  const { preflight } = english;
  await expect(preflight.getByTestId("ai-preflight-source")).toHaveText("Selection");
  await expect(preflight).not.toContainText(/ambient/i);
  await expect(preflight.getByTestId("quoted-text")).not.toHaveText(/\s$/);
  // Chinese card text is typeset like the Chinese UI even when the UI is English: the closing quote
  // shares the CJK font with "。", so the period is not followed by a blank half-em before "”".
  expect(english.lang).toBe("zh-Hans");
  const chinesePage = await browser.newPage();
  try {
    const chinese = await measureSelectionQuote(chinesePage, "zh-CN");
    expect(chinese.font).toBe(english.font);
    expect(english.periodWidth).toBeCloseTo(chinese.periodWidth, 1);
  } finally {
    await chinesePage.close();
  }
  await shot(preflight.getByTestId("ai-selection-chip"), "selection-chip-en");

  // The request and its history entry say "Selection" too, never the internal source name.
  await preflight.getByRole("button", { name: "Build draft" }).click();
  await expect(page.getByTestId("ai-answer")).toBeVisible();
  await expect(page.locator(".ai-request-source > span")).toHaveText("Selection");
  const activity = page.getByTestId("repair-history");
  await activity.getByTestId("repair-history-item").first().locator(".repair-history__toggle").click();
  const detail = page.getByTestId("ai-activity-detail");
  await expect(detail.locator("dd").first()).not.toBeEmpty();
  await expect(detail).toContainText(`Selection: card on ${CJK_CARD_ID}`);
  await expect(page.locator(".app-shell")).not.toContainText(/ambient/i);
});

test("grows the card text editor with long text and saves on Enter", async ({ page }) => {
  await openHosted(page, "workbench/content?locale=en");
  const field = page.getByTestId("card-text-field");
  await expect(field).toHaveCount(1);
  expect(await field.evaluate((element) => element.tagName)).toBe("TEXTAREA");
  const save = page.getByRole("button", { name: "Save text" });
  const shortHeight = (await field.boundingBox()).height;

  const longText = "The harbor master arrives before dawn with a ledger, a lantern, and a list of every ship that slipped past the chain last month; "
    + "she asks the crown to choose between closing the port to all foreign hulls until the fog lifts, or quietly taxing the smugglers who keep the markets fed.";
  await field.fill(longText);
  // Every line is visible: the box grew and nothing scrolls inside it.
  const fit = await field.evaluate((element) => ({ scroll: element.scrollHeight, client: element.clientHeight, overflow: getComputedStyle(element).overflowY }));
  expect(fit.scroll).toBeLessThanOrEqual(fit.client + 1);
  expect((await field.boundingBox()).height).toBeGreaterThan(shortHeight * 1.5);
  await expect(save).toBeEnabled();

  // Shift+Enter breaks a line and an IME's confirming Enter is left to the IME: neither saves.
  await field.press("Control+End");
  await field.press("Shift+Enter");
  await expect(field).toHaveValue(`${longText}\n`);
  await field.evaluate((element) => element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true })));
  await expect(save).toBeEnabled();
  await field.press("Backspace");
  await expect(field).toHaveValue(longText);

  // Enter saves, exactly like the Save text button.
  await field.press("Enter");
  await expect(save).toBeDisabled();
  await expect(field).toHaveValue(longText);
  await expect(page.locator(".stage__status")).toContainText("Saved");
  // The saved text survives a reload and the editor grows to it again.
  await page.reload();
  await expect(page.getByTestId("card-text-field")).toHaveValue(longText);
  const reloaded = await page.getByTestId("card-text-field").evaluate((element) => ({ scroll: element.scrollHeight, client: element.clientHeight }));
  expect(reloaded.scroll).toBeLessThanOrEqual(reloaded.client + 1);
  await shot(page.locator(".card-text-row"), "card-text-long");
});
