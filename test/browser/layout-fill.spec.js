import { expect, test } from "@playwright/test";

// The top bar's height depends on its content, font, and skin. The workspace and the sticky rail
// must follow the measured height: no phantom page scroll when the panel fits, and the rail never
// moves (or slides under the bar) while the page scrolls.
const SKINS = ["github-light", "catppuccin-latte", "famicom", "classic", "arcade", "phantom", "terminal"];
const ONBOARDING_COMPLETED_KEY = "reigns-agent.creator-web.onboarding-completed";

for (const skin of SKINS) {
  test(`${skin}: workspace and rail fill the space below the top bar`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript((key) => {
      try { window.localStorage.setItem(key, "true"); } catch { /* covered elsewhere */ }
    }, ONBOARDING_COMPLETED_KEY);
    await page.goto(`workbench/overview?skin=${skin}`);
    await expect(page.locator(".stage__status strong")).toContainText("cards loaded");
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.skin)).toBe(skin);
    await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
    await page.evaluate(() => document.fonts.ready);

    const measure = () => page.evaluate(() => {
      const topbar = document.querySelector(".topbar").getBoundingClientRect();
      const rail = document.querySelector(".rail").getBoundingClientRect();
      const stage = document.querySelector(".stage");
      const stageStyle = getComputedStyle(stage);
      // Height the stage's own content needs, independent of the min-height it is stretched to.
      const contentHeight = [...stage.children].reduce((bottom, child) => Math.max(bottom, child.getBoundingClientRect().bottom + window.scrollY), 0)
        - (stage.getBoundingClientRect().top + window.scrollY)
        + parseFloat(stageStyle.paddingBottom);
      return {
        topbarBottom: topbar.bottom,
        railTop: rail.top,
        railBottom: rail.bottom,
        viewport: window.innerHeight,
        overflow: document.scrollingElement.scrollHeight - window.innerHeight,
        contentOverflow: Math.max(0, Math.ceil(topbar.height + contentHeight - window.innerHeight)),
        scrollY: window.scrollY
      };
    });

    const before = await measure();
    expect(Math.abs(before.railTop - before.topbarBottom), "rail starts right below the top bar").toBeLessThanOrEqual(1);
    expect(Math.abs(before.railBottom - before.viewport), "rail reaches the bottom of the viewport").toBeLessThanOrEqual(1);
    // Any page scroll must come from the panel's own content, never from a fixed top-bar height.
    expect(before.overflow, "no phantom page scroll").toBeLessThanOrEqual(before.contentOverflow + 1);

    await page.evaluate(() => window.scrollTo(0, 10_000));
    const after = await measure();
    expect(Math.abs(after.railTop - before.railTop), "rail does not move while the page scrolls").toBeLessThanOrEqual(1);
  });
}
