import { expect, test } from "@playwright/test";

import { scanContrast } from "./contrast-scan.js";

/**
 * Creator top bar at desktop (1440 px), tablet (834 px) and phone (390 px) widths, for every skin.
 * History: the bar was 133-140 px tall at 834 and 347-373 px at 390 before the first header pass,
 * then 53-57 px at 834 and 103-109 px at 390 (two rows; three rows, 145 px, for Catppuccin Latte
 * at 360 px). From 600 px down the bar is one row of exactly four things — logo, Project, AI and
 * Player — measured at 57-60 px (Phantom's 4 px border is the tallest). Caps are those numbers plus
 * a little headroom for skin type.
 */
const ONBOARDING_COMPLETED_KEY = "reigns-agent.creator-web.onboarding-completed";
const SKINS = ["github-light", "catppuccin-latte", "famicom", "classic", "arcade", "phantom", "terminal"];
const TABLET_MAX_HEIGHT = 64;
const PHONE_MAX_HEIGHT = 64;
const TOUCH_TARGET = 44;
// Every width the bar changes at, both sides of each step, plus common phone/tablet widths.
const SWEEP_WIDTHS = [320, 360, 390, 430, 480, 481, 540, 600, 601, 680, 760, 800, 801, 834, 900, 980];
// Controls may be wider than their text by padding, border and chevron (about 42-54 px per skin).
const CONTROL_SLACK = 60;
const SHOT_SKINS = ["github-light", "catppuccin-latte", "famicom", "phantom"];
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

// The top bar's Skin select where it is drawn; on phones it lives only in Settings > Interface.
async function useSkin(page, skin) {
  const barSelect = page.locator(".topbar .skin-select select");
  if (await barSelect.isVisible()) {
    await barSelect.selectOption(skin);
  } else {
    const settingsSelect = page.locator(".interface-settings__skin select");
    if (!(await settingsSelect.isVisible())) await page.getByRole("button", { name: /Settings/ }).click();
    await settingsSelect.selectOption(skin);
  }
  await expect(page.locator("html")).toHaveAttribute("data-skin", skin);
  await page.mouse.move(0, 400);
}

// Geometry of the top bar and its controls, plus the drawn width of the text each control shows.
function measureTopbar() {
  const box = (element) => {
    const { left, right, top, bottom, width, height } = element.getBoundingClientRect();
    return { left, right, top, bottom, width, height, middle: top + height / 2 };
  };
  const drawn = (element) => {
    const rect = element.getBoundingClientRect();
    // checkVisibility() also drops the closed project <details>' popover, which keeps a layout box.
    return rect.width > 2 && rect.height > 2 && element.checkVisibility({ visibilityProperty: true });
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
    logo: box(topbar.querySelector(".brand__mark")),
    brand: box(topbar.querySelector(".brand h1")),
    wordmarkDrawn: drawn(topbar.querySelector(".brand h1")),
    field: box(topbar.querySelector(".project-menu-field")),
    trigger: box(topbar.querySelector(".project-menu__trigger")),
    triggerTitle: topbar.querySelector(".project-menu__trigger").getAttribute("title"),
    projectText: { full: strong.scrollWidth, shown: strong.clientWidth },
    select: box(select),
    selectDrawn: drawn(select),
    selectText: context.measureText(select.selectedOptions[0].textContent).width,
    ai: box(topbar.querySelector(".ai-presence")),
    player: box(topbar.querySelector(".player-launch")),
    playerText: topbar.querySelector(".player-launch span").getBoundingClientRect().width,
    // Drawn controls a pointer or keyboard can reach, in DOM (= focus) order.
    interactive: [...topbar.querySelectorAll("a[href], button, summary, select, input")]
      .filter(drawn)
      .map((element) => element.classList[0] ?? element.tagName.toLowerCase()),
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
  if (m.selectDrawn) expect(m.select.width, `${label}: skin select is wider than the skin it shows`).toBeLessThanOrEqual(m.selectText + CONTROL_SLACK);
  expect(m.pageOverflow, `${label}: page scrolls sideways`).toBeLessThanOrEqual(0);
  expect(m.outside, `${label}: ${m.outside.join(", ")}`).toEqual([]);
}

// One row: every drawn control's centre sits on the logo's centre line.
function expectOneRow(m, label) {
  const controls = [["project", m.trigger], ["AI", m.ai], ["Player", m.player]];
  if (m.selectDrawn) controls.push(["skin", m.select]);
  for (const [name, control] of controls) {
    expect(Math.abs(control.middle - m.logo.middle), `${label}: ${name} is not on the logo row`).toBeLessThan(8);
  }
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
    if (SHOT_SKINS.includes(skin)) await shot(page.locator(".topbar"), `topbar-834-${skin}`);
  }
  // Secondary information leaves the tablet bar; it stays available elsewhere.
  await expect(page.locator(".brand p")).toBeHidden();
  await expect(page.locator(".topbar__readout")).toBeHidden();
  await expect(page.locator(".skin-select__label")).toBeVisible();
  await expect(page.locator(".ai-presence__copy")).toBeVisible();
});

test("keeps only logo, Project, AI and Player on one phone row for every skin (390 px)", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await openHosted(page);
  for (const skin of SKINS) {
    await useSkin(page, skin);
    const m = await page.evaluate(measureTopbar);
    expect(m.topbar.height, `${skin}: top bar height`).toBeLessThanOrEqual(PHONE_MAX_HEIGHT);
    // Exactly three reachable controls after the logo, in reading order; Skin and the wordmark are not drawn.
    expect(m.interactive, `${skin}: drawn top bar controls`).toEqual(["project-menu__trigger", "ai-presence", "link-button"]);
    expect(m.logo.width, `${skin}: logo`).toBeGreaterThanOrEqual(32);
    expect(m.selectDrawn, `${skin}: skin select left the bar`).toBe(false);
    expect(m.wordmarkDrawn, `${skin}: wordmark left the bar`).toBe(false);
    expectOneRow(m, skin);
    expect(m.logo.right, `${skin}: logo overlaps the project`).toBeLessThanOrEqual(m.trigger.left);
    expect(m.trigger.right, `${skin}: project overlaps AI`).toBeLessThan(m.ai.left);
    expect(m.ai.right, `${skin}: AI overlaps Player`).toBeLessThan(m.player.left);
    // Touch targets.
    for (const [name, control] of [["project", m.trigger], ["AI", m.ai], ["Player", m.player]]) {
      expect(control.width, `${skin}: ${name} touch width`).toBeGreaterThanOrEqual(TOUCH_TARGET);
      expect(control.height, `${skin}: ${name} touch height`).toBeGreaterThanOrEqual(TOUCH_TARGET);
    }
    // Same 8 px gap between neighbours (Phantom tilts the brand, so allow a pixel).
    expect(Math.abs((m.player.left - m.ai.right) - 8), `${skin}: AI / Player gap`).toBeLessThan(1.5);
    // Player stays a compact labelled button (skins' type differs by OS) and the AI capsule is its orb.
    expect(m.player.width, `${skin}: Player is wider than its label`).toBeLessThanOrEqual(m.playerText + 40);
    expect(m.player.width, `${skin}: Player width`).toBeLessThanOrEqual(120);
    expect(m.ai.width, `${skin}: AI width`).toBeLessThanOrEqual(TOUCH_TARGET);
    expectContentSizedControls(m, skin);
    // The navigation tab strip stays a horizontal strip under the bar.
    expect(m.rail.top).toBeGreaterThanOrEqual(m.topbar.bottom - 1);
    expect(Math.abs(m.railItems[0].top - m.railItems[1].top)).toBeLessThan(2);
    expect(await page.evaluate(scanContrast, { root: ".topbar" }), `${skin}: top bar contrast`).toEqual([]);
    if (SHOT_SKINS.includes(skin)) await shot(page.locator(".topbar"), `topbar-390-${skin}`);
  }
  // Undrawn text keeps naming its controls, and the page keeps its heading.
  await expect(page.getByRole("heading", { level: 1, name: "ReignsAgent" })).toBeAttached();
  await expect(page.getByRole("button", { name: "AI Off", exact: true })).toBeVisible();
  await expect(page.locator(".project-menu__trigger")).toHaveAccessibleName("Manage project");
  await expect(page.getByRole("link", { name: "Open player preview" })).toBeVisible();
  // The hidden bar select is out of the accessibility tree, so only the Settings one is "Skin".
  await expect(page.getByRole("combobox", { name: "Skin" })).toHaveCount(1);
});

test("moves Skin to Settings > Interface on phones, reachable by keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openHosted(page, "locale=en&skin=github-light");
  await expect(page.locator(".topbar .skin-select")).toBeHidden();
  await page.getByRole("button", { name: /Settings/ }).click();
  const skinSelect = page.locator(".interface-settings").getByRole("combobox", { name: "Skin" });
  await expect(skinSelect).toBeVisible();
  await expect(skinSelect).toHaveAccessibleDescription("Also in the top bar on wider screens.");
  // Focus order: Language, then Skin.
  await page.locator(".interface-settings").getByRole("combobox", { name: "Language" }).focus();
  await page.keyboard.press("Tab");
  await expect(skinSelect).toBeFocused();
  await skinSelect.selectOption("famicom");
  await expect(page.locator("html")).toHaveAttribute("data-skin", "famicom");
  await expect(page).toHaveURL(/skin=famicom/);
  const box = await skinSelect.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(scanContrast, { root: ".interface-settings" })).toEqual([]);
  if (process.env.POLISH_SHOTS) await page.locator(".interface-settings").screenshot({ path: `${process.env.POLISH_SHOTS}/settings-skin-390.png` });
  // Widening the window brings the bar's own select back, in step with the Settings one.
  await page.setViewportSize({ width: 834, height: 900 });
  await expect(page.locator(".topbar .skin-select select")).toHaveValue("famicom");
  await page.locator(".topbar .skin-select select").selectOption("phantom");
  await expect(skinSelect).toHaveValue("phantom");
});

test("never wraps or scrolls the top bar sideways at any width from 320 to 980 px", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 834, height: 900 });
  await openHosted(page);
  for (const skin of SKINS) {
    await useSkin(page, skin);
    for (const width of SWEEP_WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      const m = await page.evaluate(measureTopbar);
      const label = `${skin} @ ${width}`;
      expectOneRow(m, label);
      expect(m.topbar.height, `${label}: top bar height`).toBeLessThanOrEqual(width <= 600 ? PHONE_MAX_HEIGHT : TABLET_MAX_HEIGHT);
      expect(m.selectDrawn, `${label}: skin select is drawn only above 600 px`).toBe(width > 600);
      expect(m.wordmarkDrawn, `${label}: wordmark is drawn only above 480 px`).toBe(width > 480);
      expect(m.trigger.width, `${label}: project trigger floor`).toBeGreaterThanOrEqual(width <= 480 ? 72 : 96);
      expect(m.pageOverflow, `${label}: page scrolls sideways`).toBeLessThanOrEqual(0);
      expect(m.outside, `${label}: ${m.outside.join(", ")}`).toEqual([]);
    }
  }
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
    expect(await page.evaluate(scanContrast, { root: ".topbar" }), `${skin}: top bar contrast`).toEqual([]);
    if (SHOT_SKINS.includes(skin)) await shot(page.locator(".topbar"), `topbar-1440-${skin}`);
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
  for (const [width, cap] of [[1440, 240], [834, 200], [390, 220], [320, 220]]) {
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
    if (width <= 390) {
      expect(m.topbar.height).toBeLessThanOrEqual(PHONE_MAX_HEIGHT);
      expectOneRow(m, `long name @ ${width}`);
    }
  }
  // On a phone the project list opens as a sheet inside the screen.
  await page.setViewportSize({ width: 320, height: 700 });
  await page.locator(".project-menu__trigger").click();
  const sheet = await page.locator(".project-menu__popover").boundingBox();
  expect(sheet.x).toBeGreaterThanOrEqual(0);
  expect(sheet.x + sheet.width).toBeLessThanOrEqual(320);
});

test("keeps the Chinese top bar as short at 834 and 390 px", async ({ page }) => {
  for (const [width, cap] of [[834, TABLET_MAX_HEIGHT], [390, PHONE_MAX_HEIGHT]]) {
    await page.setViewportSize({ width, height: 900 });
    await openHosted(page, "locale=zh-CN&skin=github-light");
    const m = await page.evaluate(measureTopbar);
    expect(m.topbar.height, `${width}: zh-CN top bar height`).toBeLessThanOrEqual(cap);
    expectOneRow(m, `zh-CN ${width}`);
    expectContentSizedControls(m, `zh-CN ${width}`);
    await shot(page.locator(".topbar"), `topbar-${width}-zh-CN`);
  }
});
