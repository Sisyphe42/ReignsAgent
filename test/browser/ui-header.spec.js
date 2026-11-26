import { expect, test } from "@playwright/test";

import { scanContrast } from "./contrast-scan.js";

/**
 * Creator top bar at tablet (834 px), phone (390 px) and desktop (1440 px) widths, for every skin.
 * Before this pass the bar was 133-140 px tall at 834 and 347-373 px at 390, and the Project /
 * Skin controls were wider than what they showed. Heights here are the measured result plus a
 * little headroom for skin type (834: 53-57 px; 390: 103-109 px).
 */
const ONBOARDING_COMPLETED_KEY = "reigns-agent.creator-web.onboarding-completed";
const SKINS = ["github-light", "catppuccin-latte", "famicom", "classic", "arcade", "phantom", "terminal"];
const TABLET_MAX_HEIGHT = 64;
const PHONE_MAX_HEIGHT = 116;
// Controls may be wider than their text by padding, border and chevron (about 42-54 px per skin).
const CONTROL_SLACK = 60;
const shot = (locator, name) => (process.env.POLISH_SHOTS ? locator.screenshot({ path: `${process.env.POLISH_SHOTS}/${name}.png` }) : null);

async function openHosted(page, query = "locale=en") {
  await page.addInitScript((key) => {
    try { window.localStorage.setItem(key, "true"); } catch { /* storage may be unavailable */ }
  }, ONBOARDING_COMPLETED_KEY);
  await page.goto(`workbench?${query}`);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await expect(page.locator(".stage__status strong")).toContainText("cards loaded");
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
}

async function useSkin(page, skin) {
  await page.locator(".skin-select select").selectOption(skin);
  await expect(page.locator("html")).toHaveAttribute("data-skin", skin);
  await page.mouse.move(0, 400);
}

// Geometry of the top bar and its controls, plus the drawn width of the text each control shows.
function measureTopbar() {
  const box = (element) => {
    const { left, right, top, bottom, width, height } = element.getBoundingClientRect();
    return { left, right, top, bottom, width, height, middle: top + height / 2 };
  };
  const topbar = document.querySelector(".topbar");
  const strong = topbar.querySelector(".project-menu__trigger strong");
  const select = topbar.querySelector(".skin-select select");
  const context = document.createElement("canvas").getContext("2d");
  const style = getComputedStyle(select);
  context.font = style.font || `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const rail = document.querySelector(".rail");
  return {
    topbar: box(topbar),
    brand: box(topbar.querySelector(".brand h1")),
    field: box(topbar.querySelector(".project-menu-field")),
    trigger: box(topbar.querySelector(".project-menu__trigger")),
    triggerTitle: topbar.querySelector(".project-menu__trigger").getAttribute("title"),
    projectText: { full: strong.scrollWidth, shown: strong.clientWidth },
    select: box(select),
    selectText: context.measureText(select.selectedOptions[0].textContent).width,
    ai: box(topbar.querySelector(".ai-presence")),
    player: box(topbar.querySelector(".player-launch")),
    rail: box(rail),
    railItems: [...rail.querySelectorAll(".rail__item")].slice(0, 2).map(box),
    pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
    outside: [...topbar.querySelectorAll("*")]
      .filter((element) => { const rect = element.getBoundingClientRect(); return rect.width > 1 && (rect.right > window.innerWidth + 1 || rect.left < -1); })
      .map((element) => `${element.tagName.toLowerCase()}.${[...element.classList].join(".")}`)
  };
}

function expectContentSizedControls(m, label) {
  // The trigger never exceeds its cap and, below the cap, is as wide as the name plus chrome.
  expect(m.trigger.width, `${label}: project trigger is wider than its name`).toBeLessThanOrEqual(Math.max(120, m.projectText.full + CONTROL_SLACK));
  expect(m.select.width, `${label}: skin select is wider than the skin it shows`).toBeLessThanOrEqual(m.selectText + CONTROL_SLACK);
  expect(m.pageOverflow, `${label}: page scrolls sideways`).toBeLessThanOrEqual(0);
  expect(m.outside, `${label}: ${m.outside.join(", ")}`).toEqual([]);
}

test("puts the tablet top bar on one short row for every skin (834 px)", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 834, height: 1194 });
  await openHosted(page);
  for (const skin of SKINS) {
    await useSkin(page, skin);
    const m = await page.evaluate(measureTopbar);
    expect(m.topbar.height, `${skin}: top bar height`).toBeLessThanOrEqual(TABLET_MAX_HEIGHT);
    // Brand, project, AI, skin and Player share one row.
    for (const [name, control] of [["project", m.trigger], ["AI", m.ai], ["skin", m.select], ["Player", m.player]]) {
      expect(Math.abs(control.middle - m.brand.middle), `${skin}: ${name} is not on the brand row`).toBeLessThan(8);
    }
    expect(m.trigger.right, `${skin}: project trigger overlaps the tools`).toBeLessThan(m.ai.left);
    expectContentSizedControls(m, skin);
    // The rail column starts under the bar.
    expect(m.rail.top).toBeGreaterThanOrEqual(m.topbar.bottom - 1);
    expect(await page.evaluate(scanContrast, { root: ".topbar" }), `${skin}: top bar contrast`).toEqual([]);
    if (["github-light", "famicom", "catppuccin-latte"].includes(skin)) await shot(page.locator(".topbar"), `topbar-834-${skin}`);
  }
  // Secondary information leaves the tablet bar; it stays available elsewhere.
  await expect(page.locator(".brand p")).toBeHidden();
  await expect(page.locator(".topbar__readout")).toBeHidden();
  await expect(page.locator(".skin-select__label")).toBeVisible();
  await expect(page.locator(".ai-presence__copy")).toBeVisible();
});

test("fits the phone top bar into two short rows for every skin (390 px)", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await openHosted(page);
  for (const skin of SKINS) {
    await useSkin(page, skin);
    const m = await page.evaluate(measureTopbar);
    expect(m.topbar.height, `${skin}: top bar height`).toBeLessThanOrEqual(PHONE_MAX_HEIGHT);
    // Row 1: brand, AI orb, Player. Row 2: project and skin.
    for (const [name, control] of [["AI", m.ai], ["Player", m.player]]) {
      expect(Math.abs(control.middle - m.brand.middle), `${skin}: ${name} is not on the brand row`).toBeLessThan(8);
    }
    expect(Math.abs(m.trigger.middle - m.select.middle), `${skin}: project and skin are not on one row`).toBeLessThan(4);
    expect(m.trigger.top, `${skin}: project row overlaps the brand row`).toBeGreaterThan(m.ai.bottom);
    expect(m.trigger.right, `${skin}: project trigger overlaps the skin select`).toBeLessThan(m.select.left);
    // Player is a compact button and the AI capsule is just its orb.
    expect(m.player.width, `${skin}: Player width`).toBeLessThanOrEqual(100);
    expect(m.player.height, `${skin}: Player height`).toBeLessThanOrEqual(40);
    expect(m.ai.width, `${skin}: AI width`).toBeLessThanOrEqual(40);
    expectContentSizedControls(m, skin);
    // The navigation tab strip stays a horizontal strip under the bar.
    expect(m.rail.top).toBeGreaterThanOrEqual(m.topbar.bottom - 1);
    expect(Math.abs(m.railItems[0].top - m.railItems[1].top)).toBeLessThan(2);
    expect(await page.evaluate(scanContrast, { root: ".topbar" }), `${skin}: top bar contrast`).toEqual([]);
    if (["github-light", "famicom", "catppuccin-latte"].includes(skin)) await shot(page.locator(".topbar"), `topbar-390-${skin}`);
  }
  // Undrawn labels keep naming their controls.
  await expect(page.getByRole("combobox", { name: "Skin" })).toBeVisible();
  await expect(page.getByRole("button", { name: "AI Off", exact: true })).toBeVisible();
  await expect(page.locator(".project-menu__trigger")).toHaveAccessibleName("Manage project");
});

test("keeps the desktop top bar and sizes its controls to their content (1440 px)", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openHosted(page);
  for (const skin of SKINS) {
    await useSkin(page, skin);
    const m = await page.evaluate(measureTopbar);
    expect(m.topbar.height, `${skin}: top bar height`).toBeLessThanOrEqual(92);
    expectContentSizedControls(m, skin);
    if (["github-light", "famicom", "catppuccin-latte"].includes(skin)) await shot(page.locator(".topbar"), `topbar-1440-${skin}`);
  }
  await expect(page.locator(".brand p")).toBeVisible();
  await expect(page.locator(".topbar__readout")).toBeVisible();
});

test("ends a long project name in an ellipsis with the full name as a tooltip", async ({ page }) => {
  const longTitle = "The Very Long Chronicle of the Fog Harbor Customs House and Its Night Shift";
  await page.setViewportSize({ width: 1440, height: 900 });
  await openHosted(page);
  await page.getByRole("button", { name: /Settings/ }).click();
  await page.getByPlaceholder("Deck title").fill(longTitle);
  await page.getByRole("button", { name: "Save project details" }).click();
  await expect(page.locator(".brand p")).toHaveText(longTitle);
  await page.reload();
  await expect(page.locator(".project-menu__trigger strong")).toHaveText(longTitle);
  for (const [width, cap] of [[1440, 240], [834, 200], [390, 220]]) {
    await page.setViewportSize({ width, height: 900 });
    const m = await page.evaluate(measureTopbar);
    expect(m.trigger.width, `${width}: trigger width`).toBeLessThanOrEqual(cap + 1);
    // The whole field (label + trigger) is capped too, so the name cannot widen the bar's layout.
    expect(m.field.width, `${width}: project field width`).toBeLessThanOrEqual(cap + 70);
    expect(m.projectText.full, `${width}: long name is not cut`).toBeGreaterThan(m.projectText.shown);
    expect(await page.locator(".project-menu__trigger strong").evaluate((element) => getComputedStyle(element).textOverflow)).toBe("ellipsis");
    expect(m.triggerTitle).toBe(longTitle);
    expect(m.pageOverflow, `${width}: page scrolls sideways`).toBeLessThanOrEqual(0);
    expect(m.outside, `${width}: ${m.outside.join(", ")}`).toEqual([]);
    if (width === 834) expect(m.topbar.height).toBeLessThanOrEqual(TABLET_MAX_HEIGHT);
    if (width === 390) expect(m.topbar.height).toBeLessThanOrEqual(PHONE_MAX_HEIGHT);
  }
});

test("keeps the Chinese top bar as short at 834 and 390 px", async ({ page }) => {
  for (const [width, cap] of [[834, TABLET_MAX_HEIGHT], [390, PHONE_MAX_HEIGHT]]) {
    await page.setViewportSize({ width, height: 900 });
    await openHosted(page, "locale=zh-CN&skin=github-light");
    const m = await page.evaluate(measureTopbar);
    expect(m.topbar.height, `${width}: zh-CN top bar height`).toBeLessThanOrEqual(cap);
    expectContentSizedControls(m, `zh-CN ${width}`);
    await shot(page.locator(".topbar"), `topbar-${width}-zh-CN`);
  }
});
