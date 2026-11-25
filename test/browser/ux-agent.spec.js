import { expect, test } from "@playwright/test";

const ONBOARDING_COMPLETED_KEY = "reigns-agent.creator-web.onboarding-completed";

async function openHosted(page, path = "workbench") {
  await page.addInitScript((key) => {
    try { window.localStorage.setItem(key, "true"); } catch { /* storage may be unavailable */ }
  }, ONBOARDING_COMPLETED_KEY);
  await page.goto(path);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page.waitForLoadState("load");
  await expect(page.locator(".stage__status strong")).toContainText("cards loaded");
}

test("shows real review progress and blocks a second run while the worker simulates", async ({ page }) => {
  await openHosted(page);
  await page.locator('.rail__item[aria-label="Review"]').click();
  await page.locator(".review-run-row input").first().fill("10000");
  const run = page.getByRole("button", { name: "Run review" });
  await run.click();
  const progress = page.getByTestId("review-progress");
  await expect(progress).toBeVisible();
  await expect(page.getByRole("button", { name: "Running review..." })).toBeDisabled();
  await expect(progress).toContainText(/Simulated [\d,]+ \/ 10,000 cycles|Summarizing 10,000/);
  // A remaining-time estimate appears once throughput has been measured.
  await expect(page.getByTestId("review-eta")).toContainText(/about \d+s left/, { timeout: 10_000 });
  await expect(progress).toBeHidden({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Run review" })).toBeEnabled();
  await expect(page.locator(".review-score")).toBeVisible();
});

test("shows the AI context cards, real loop stages, and replays the stored repair history", async ({ page }) => {
  await openHosted(page);
  await page.locator('.rail__item[aria-label="Review"]').click();
  await page.getByRole("button", { name: "Run review" }).click();
  await page.getByRole("tab", { name: /^Issues/ }).click();
  await page.locator(".review-issue").first().getByRole("button", { name: "AI Repair" }).click();
  await page.getByRole("button", { name: "Build draft" }).first().click();
  await expect(page.getByTestId("repair-verification")).toBeVisible({ timeout: 30_000 });

  // Hosted runs the loop in a dedicated worker, not on the page's main thread.
  expect(await page.evaluate(() => performance.getEntriesByType("resource").some((entry) => /repair-worker/.test(entry.name)))).toBe(true);
  const progress = page.getByTestId("ai-progress");
  await expect(progress).toHaveAttribute("data-status", "ready");
  await expect(progress).toHaveAttribute("data-stage", "done");

  const selection = page.getByTestId("context-selection").first();
  await expect(selection).toContainText(/AI saw \d+ of \d+ cards/);
  await selection.locator("summary").click();
  await expect(selection.locator(".context-selection__table tbody tr").first()).toBeVisible();
  await expect(selection.locator(".context-tier").first()).toBeVisible();

  const history = page.getByTestId("repair-history");
  await expect(history.getByTestId("repair-history-item")).toHaveCount(1);
  await expect(history.getByTestId("repair-history-item").first()).toContainText("Not applied");
  await page.getByRole("button", { name: "Apply selected" }).click();
  await expect(history.getByTestId("repair-history-item").first()).toContainText(/Applied \d/);
  await history.getByTestId("repair-history-item").first().locator(".repair-history__toggle").click();
  const detail = page.getByTestId("repair-history-detail");
  await expect(detail).toContainText("Round 1");
  await expect(detail).toContainText("Local rules");
  await expect(detail).toContainText("Author's choice");
  await expect(detail.locator(".repair-history__proposal").first()).toBeVisible();

  // A second run on the same issue can be compared side by side with the first.
  await page.locator('.rail__item[aria-label="Review"]').click();
  await page.getByRole("button", { name: "Run review" }).click();
  await page.getByRole("tab", { name: /^Issues/ }).click();
  await page.locator(".review-issue").first().getByRole("button", { name: "AI Repair" }).click();
  await page.getByRole("button", { name: "Build draft" }).first().click();
  await expect(page.getByTestId("repair-verification")).toBeVisible({ timeout: 30_000 });
  await expect(history.getByTestId("repair-history-item")).toHaveCount(2);
  await history.getByRole("checkbox", { name: "Compare" }).nth(0).check();
  await history.getByRole("checkbox", { name: "Compare" }).nth(1).check();
  const compare = page.getByTestId("repair-history-compare");
  await expect(compare).toContainText("Earlier");
  await expect(compare).toContainText("Round 1");
  await expect(compare).toContainText("Author applied");

  // The record survives a reload because it lives in the project's OPFS data.
  await page.reload();
  await page.locator('.rail__item[aria-label="AI Assist"]').click();
  await expect(page.getByTestId("repair-history-item")).toHaveCount(2);
  await page.getByTestId("repair-history-item").first().locator(".repair-history__toggle").click();
  await page.getByRole("button", { name: "Delete record" }).click();
  await expect(page.getByTestId("repair-history-item")).toHaveCount(1);
});

test("separates the empty-deck guide from the no-filter-match message", async ({ page }) => {
  await openHosted(page);
  await page.locator('.rail__item[aria-label="Content"]').click();
  await page.locator(".editor-controls input").fill("no-such-card-anywhere");
  await expect(page.getByTestId("filter-empty")).toContainText("No cards match the current filters.");
  await page.getByTestId("filter-empty").getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByTestId("filter-empty")).toHaveCount(0);

  await page.locator(".project-menu > summary").click();
  await page.getByRole("button", { name: "New blank project" }).click();
  await expect(page.locator(".brand p")).toHaveText("Untitled");
  // An empty deck is neither "Valid" nor "Ready": the Overview says there is nothing yet.
  await page.locator('.rail__item[aria-label="Overview"]').click();
  await expect(page.locator(".metric", { hasText: "Validation" })).toContainText("No cards");
  await expect(page.locator(".metric", { hasText: "Player-ready" })).toContainText("No cards");
  await expect(page.locator(".topbar__readout")).toContainText("no cards");
  await page.locator('.rail__item[aria-label="Content"]').click();
  const empty = page.getByTestId("empty-deck");
  await expect(empty).toContainText("This project has no cards yet");
  await expect(page.getByText("No cards match the current filters.")).toHaveCount(0);
  await expect(empty.locator(".btn--primary")).toHaveCount(1);
  await empty.getByRole("button", { name: "Write the first card" }).click();
  await empty.locator("input").nth(1).fill("A messenger waits at the gate.");
  await empty.getByRole("button", { name: "Create card" }).click();
  await expect(page.getByTestId("empty-deck")).toHaveCount(0);
  await expect(page.locator(".card-switcher__item")).toHaveCount(1);
});

test("keeps the tablet layout readable at 834 px", async ({ page }) => {
  await page.setViewportSize({ width: 834, height: 1194 });
  await openHosted(page);
  const topbar = await page.locator(".topbar").boundingBox();
  expect(topbar.height).toBeLessThan(150);
  await page.locator('.rail__item[aria-label="Review"]').click();
  await page.getByRole("button", { name: "Run review" }).click();
  const risk = page.locator(".review-risk").first();
  await expect(risk).toBeVisible();
  const text = await risk.locator("span").last().boundingBox();
  expect(text.width).toBeGreaterThan(300);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test("keeps short metric values in the repair popover on one line", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openHosted(page);
  await page.locator('.rail__item[aria-label="Review"]').click();
  await page.getByRole("button", { name: "Run review" }).click();
  await page.getByRole("tab", { name: /^Issues/ }).click();
  await page.locator(".review-issue").first().getByRole("button", { name: "AI Repair" }).click();
  const values = page.locator(".ai-preflight__summary .metric strong");
  await expect(values.first()).toBeVisible();
  for (const handle of await values.all()) {
    const lines = await handle.evaluate((element) => Math.round(element.getBoundingClientRect().height / parseFloat(getComputedStyle(element).lineHeight)));
    const words = (await handle.textContent()).trim().split(/\s+/).length;
    expect(lines).toBeLessThanOrEqual(words);
  }
});

test("explains a selected card through the AI layer and logs it as selection activity", async ({ page }) => {
  await openHosted(page, "workbench/content?ai=1");
  await expect(page.getByTestId("ai-ambient-status")).toContainText(/Local planner · no endpoint configured · \d+ cards/);
  // The status pill collapses to a corner chip (so it never covers page content) and comes back.
  await page.getByRole("button", { name: "Collapse AI status" }).click();
  await expect(page.getByTestId("ai-ambient-status")).toHaveCount(0);
  await page.getByRole("button", { name: "Show AI status" }).click();
  await expect(page.getByTestId("ai-ambient-status")).toBeVisible();
  const card = page.locator(".card-switcher__item").nth(1);
  const cardId = await card.getAttribute("data-ai-card-id");
  await card.click();
  await page.locator(".ai-selection-handle").click();
  await page.getByRole("button", { name: "Explain", exact: true }).click();
  const preflight = page.getByRole("dialog", { name: "AI Assist preflight" });
  await expect(preflight.getByTestId("ai-selection-chip")).toContainText(cardId);
  await expect(preflight.getByTestId("ai-capability-card")).toContainText("What this request can do");
  await preflight.getByRole("button", { name: "Build draft" }).click();
  await expect(page.getByTestId("ai-answer")).toContainText(`Card ${cardId} appears`);
  await expect(page.getByTestId("context-extras")).toContainText(`Selection sent as content: card on ${cardId}`);

  const activity = page.getByTestId("repair-history");
  await activity.getByRole("button", { name: /^Selection 1/ }).click();
  await activity.getByTestId("repair-history-item").first().locator(".repair-history__toggle").click();
  await expect(page.getByTestId("ai-activity-detail")).toContainText(`Selection: card on ${cardId}`);
  await expect(activity.getByRole("button", { name: "Export log" })).toBeVisible();
  await expect(page.getByTestId("ai-session-usage")).toContainText("AI requests this session: 0");
});

test("saves an author brief that is sent with requests", async ({ page }) => {
  await openHosted(page, "workbench/ai-edit");
  const brief = page.getByTestId("ai-author-brief");
  await brief.locator("summary").click();
  await brief.locator("textarea").fill("Fog-bound port, terse tone.");
  await brief.getByRole("button", { name: "Save brief" }).click();
  await expect(brief).toContainText("Saved.");
  await page.locator("textarea[placeholder^='Describe what the AI']").fill("Draft one card.");
  await page.getByRole("button", { name: "Build draft" }).first().click();
  await expect(page.getByTestId("context-extras")).toContainText("Author brief included (27 characters)");
});
