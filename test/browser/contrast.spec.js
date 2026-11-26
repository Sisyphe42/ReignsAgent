import { expect, test } from "@playwright/test";

import { scanContrast } from "./contrast-scan.js";

// WCAG 2.x AA text contrast (4.5:1) for every Creator skin and every workbench panel.
// The scan reads each visible text element's color and the nearest opaque background
// (including Phantom's painted ::after paper). Elements that sit on a gradient-only
// background are skipped because their effective color cannot be read reliably; those
// surfaces (primary buttons) use button ink tokens chosen for their gradients.
const SKINS = ["github-light", "catppuccin-latte", "famicom", "classic", "arcade", "phantom", "terminal"];
const PANELS = ["Overview", "Content", "Story", "Review", "AI Assist", "Preview", "Build", "Settings"];
const ONBOARDING_COMPLETED_KEY = "reigns-agent.creator-web.onboarding-completed";

for (const skin of SKINS) {
  test(`${skin}: every panel keeps text at WCAG AA contrast`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.addInitScript((key) => {
      try { window.localStorage.setItem(key, "true"); } catch { /* covered elsewhere */ }
    }, ONBOARDING_COMPLETED_KEY);
    await page.goto(`workbench?skin=${skin}`);
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await page.reload();
    await expect(page.locator(".stage__status strong")).toContainText("cards loaded");
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.skin)).toBe(skin);
    // Measure settled colors, not mid-transition frames after a rail click.
    await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });

    const failures = [];
    for (const panel of PANELS) {
      await page.locator(`.rail__item[aria-label="${panel}"]`).click();
      if (panel === "Review") {
        await page.getByRole("button", { name: "Run review" }).click();
        await expect(page.locator(".review-score")).toBeVisible();
      }
      // Scan the resting state: move the pointer off the clicked rail item.
      await page.mouse.move(0, 0);
      await page.waitForTimeout(150);
      for (const line of await page.evaluate(scanContrast)) failures.push(`${panel}: ${line}`);
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });
}
