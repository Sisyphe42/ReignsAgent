import { expect, test } from "@playwright/test";

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

function scanContrast() {
  const parse = (value) => {
    const rgb = value.match(/rgba?\(([^)]+)\)/);
    if (rgb) {
      const [r, g, b, a = 1] = rgb[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return { r, g, b, a };
    }
    const srgb = value.match(/color\(srgb ([^)]+)\)/);
    if (srgb) {
      const [r, g, b, a = 1] = srgb[1].split(/[ /]+/).filter(Boolean).map(Number);
      return { r: r * 255, g: g * 255, b: b * 255, a };
    }
    return null;
  };
  const luminance = ({ r, g, b }) => {
    const channel = (v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const backgroundOf = (element) => {
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      const color = parse(style.backgroundColor);
      if (color && color.a > 0.9) return color;
      if (style.backgroundImage && style.backgroundImage !== "none") return null;
      const after = getComputedStyle(node, "::after");
      const paper = parse(after.backgroundColor);
      if (paper && paper.a > 0.9 && after.content !== "none") return paper;
    }
    return parse(getComputedStyle(document.body).backgroundColor);
  };
  const failures = [];
  for (const element of document.querySelectorAll(".app-shell *:not(.ai-ambient *)")) {
    if (![...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim())) continue;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    const style = getComputedStyle(element);
    if (style.visibility === "hidden" || Number(style.opacity) === 0 || element.closest("[aria-hidden='true']")) continue;
    const foreground = parse(style.color);
    const background = backgroundOf(element);
    if (!foreground || !background) continue;
    const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    const ratio = (light + 0.05) / (dark + 0.05);
    if (ratio < 4.5) failures.push(`${ratio.toFixed(2)} ${element.tagName.toLowerCase()}.${[...element.classList].join(".")} "${element.textContent.trim().slice(0, 32)}"`);
  }
  return [...new Set(failures)];
}
