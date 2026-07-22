import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { strFromU8, unzipSync } from "fflate";

let aiServer;
let aiEndpoint;
const ONBOARDING_COMPLETED_KEY = "reigns-agent.creator-web.onboarding-completed";
const tinyPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
let productVersion;

test.beforeAll(async () => {
  productVersion = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")).version;
  aiServer = createServer((request, response) => {
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("access-control-allow-headers", "authorization,content-type");
    response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
    if (request.method === "OPTIONS") { response.writeHead(204); response.end(); return; }
    response.setHeader("content-type", "application/json");
    if (request.url.includes("/images/generations") || request.url.includes("/images/edits")) {
      response.end(JSON.stringify({ data: [{ b64_json: tinyPngBase64 }] }));
      return;
    }
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ proposals: [] }) } }] }));
  });
  await new Promise((resolve) => aiServer.listen(0, "127.0.0.1", resolve));
  aiEndpoint = `http://127.0.0.1:${aiServer.address().port}/v1`;
});

test.afterAll(async () => new Promise((resolve) => aiServer.close(resolve)));

test("guides the complete workflow once and replays it from Settings", async ({ page }) => {
  await openHosted(page, { onboarding: "fresh" });

  const tour = page.getByTestId("onboarding-tour");
  await expect(tour.getByRole("heading", { name: "Tell a story, one decision at a time" })).toBeVisible();
  await expect(tour.locator(".onboarding-tour__progress")).toHaveText("1/11");
  await expect(tour.locator(".onboarding-tour__skip kbd")).toHaveText("Esc");
  await tour.getByRole("button", { name: /Hear them out/ }).click();
  await expect(tour.locator(".onboarding-demo")).toHaveClass(/onboarding-demo--right/);
  await tour.getByRole("button", { name: /Turn them away/ }).click();
  await expect(tour.locator(".onboarding-demo")).toHaveClass(/onboarding-demo--left/);

  await page.keyboard.down("ArrowRight");
  await expect(tour.getByRole("button", { name: "Next" })).toHaveClass(/is-shortcut-active/);
  await page.keyboard.up("ArrowRight");
  await expect(tour.getByRole("heading", { name: "Start from the right project" })).toBeVisible();
  await expect(tour.locator(".onboarding-tour__spotlight")).toBeVisible();
  await page.keyboard.down("ArrowLeft");
  await expect(tour.getByRole("button", { name: "Back" })).toHaveClass(/is-shortcut-active/);
  await page.keyboard.up("ArrowLeft");
  await expect(tour.getByRole("heading", { name: "Tell a story, one decision at a time" })).toBeVisible();
  await page.keyboard.press("Space");
  await expect(tour.getByRole("heading", { name: "Start from the right project" })).toBeVisible();

  const titles = [
    "Write the decisions",
    "See how the story moves",
    "Find problems before players do",
    "Use AI without giving up control",
    "Play what you wrote",
    "Package the player experience",
    "See only what players see",
    "Keep exploring on GitHub",
    "Come back anytime"
  ];
  for (const title of titles) {
    await tour.getByRole("button", { name: "Next" }).click();
    await expect(tour.getByRole("heading", { name: title })).toBeVisible();
    const target = page.locator("[data-onboarding-active='true']");
    if (await target.count()) {
      await expect.poll(async () => {
        const rect = await target.boundingBox();
        return rect && rect.y >= 0 && rect.y + rect.height <= page.viewportSize().height;
      }).toBe(true);
    }
    if (title === "Write the decisions") {
      await expect(page.locator('.rail__item[aria-label="Content"]')).toHaveClass(/rail__item--active/);
      await expect.poll(() => workspaceContains(page, 'activePanel = "overview"')).toBe(true);
    }
    if (title === "Keep exploring on GitHub") {
      await expect(page.locator('[data-onboarding-target="about-github"]')).toHaveAttribute("data-onboarding-active", "true");
      await expect(page.locator('[data-onboarding-link="github"]')).toBeVisible();
      await expect(tour.getByRole("link", { name: /Open GitHub/ })).toHaveAttribute("href", "https://github.com/Sisyphe42/ReignsAgent");
      await expect(tour.locator(".onboarding-tour__target-blocker")).toHaveCount(0);
    }
  }

  await tour.getByRole("button", { name: "Finish" }).click();
  await expect(tour).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Overview" })).toHaveClass(/rail__item--active/);
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), ONBOARDING_COMPLETED_KEY)).toBe("true");

  await page.reload();
  await expect(page.locator(".stage__status strong")).toContainText("cards loaded");
  await expect(tour).toHaveCount(0);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Replay onboarding guide" }).click();
  await expect(tour.getByRole("heading", { name: "Tell a story, one decision at a time" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tour).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Settings" })).toHaveClass(/rail__item--active/);
});

test("treats skipping onboarding as completion", async ({ page }) => {
  await openHosted(page, { onboarding: "fresh" });
  await page.getByRole("button", { name: /Skip/ }).click();
  await expect(page.getByTestId("onboarding-tour")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".stage__status strong")).toContainText("cards loaded");
  await expect(page.getByTestId("onboarding-tour")).toHaveCount(0);
});

test("defers first-run onboarding on an explicit panel route", async ({ page }) => {
  await prepareOnboardingStorage(page, "fresh");
  await page.goto("workbench/content");
  await expect(page.locator(".stage__status strong")).toContainText("cards loaded");
  await expect(page.getByTestId("onboarding-tour")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Content" })).toHaveClass(/rail__item--active/);

  await page.goto("workbench");
  await expect(page.getByTestId("onboarding-tour").getByRole("heading", { name: "Tell a story, one decision at a time" })).toBeVisible();
});

test("keeps localized onboarding inside a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 720 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "languages", { configurable: true, get: () => ["zh-CN"] });
    Object.defineProperty(navigator, "language", { configurable: true, get: () => "zh-CN" });
  });
  await openHosted(page, { onboarding: "fresh" });
  const card = page.locator(".onboarding-tour__card");
  await expect(card.getByRole("heading", { name: "用一次次选择讲完一个故事" })).toBeVisible();
  await expect(card.locator(".onboarding-tour__progress")).toHaveText("1/11");
  await expect(card.getByRole("button", { name: "下一步" })).toBeVisible();
  const bounds = await card.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(720);
});

test("persists an OPFS project and reopens the PWA offline", async ({ page, context }) => {
  await openHosted(page);
  await expect(page.getByRole("heading", { name: "ReignsAgent", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Settings/ }).click();
  const title = page.getByPlaceholder("Deck title");
  await title.fill("Hosted persistence smoke");
  await page.getByRole("button", { name: "Save project details" }).click();
  await expect(page.locator(".brand p")).toHaveText("Hosted persistence smoke");
  await page.reload();
  await expect(page.locator(".brand p")).toHaveText("Hosted persistence smoke");
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "ReignsAgent", exact: true })).toBeVisible();
  await expect(page.locator(".brand p")).toHaveText("Hosted persistence smoke");
});

test("honors a direct panel URL over the persisted workspace panel", async ({ page }) => {
  await openHosted(page);
  await page.getByRole("button", { name: /Review/ }).click();
  await expect(page).toHaveURL(/\/workbench\/review(?:\?|$)/);
  await expect.poll(() => workspaceContains(page, 'activePanel = "review"'), { timeout: 15_000 }).toBe(true);

  await page.goto("workbench/content");
  await expect(page.locator(".stage__status strong")).toContainText("cards loaded");
  await expect(page.getByRole("button", { name: /Content/ })).toHaveClass(/rail__item--active/);
  await expect(page).toHaveURL(/\/workbench\/content(?:\?|$)/);
});

test("starts with default navigation when localStorage access is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Storage access denied", "SecurityError");
      }
    });
  });

  await openHosted(page);

  await expect(page.locator(".workspace")).toHaveClass(/workspace--rail-expanded.*workspace--rail-pinned|workspace--rail-pinned.*workspace--rail-expanded/);
  await expect(page.getByRole("button", { name: "Collapse navigation" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Unpin navigation" })).toBeVisible();
});

test("keeps navigation interactive when localStorage methods fail", async ({ page }) => {
  await page.addInitScript(() => {
    const fail = () => { throw new DOMException("Storage operation denied", "SecurityError"); };
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: { getItem: fail, setItem: fail, removeItem: fail }
    });
  });

  await openHosted(page);

  await expect(page.locator(".workspace")).toHaveClass(/workspace--rail-expanded.*workspace--rail-pinned|workspace--rail-pinned.*workspace--rail-expanded/);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Replay onboarding guide" }).click();
  await expect(page.getByTestId("onboarding-tour").getByRole("heading", { name: "Tell a story, one decision at a time" })).toBeVisible();
  await page.getByRole("button", { name: /Skip/ }).click();
  await expect(page.getByRole("button", { name: "Settings" })).toHaveClass(/rail__item--active/);
  await page.getByRole("button", { name: "Collapse navigation" }).click();
  await expect(page.locator(".workspace")).toHaveClass(/workspace--rail-collapsed.*workspace--rail-pinned|workspace--rail-pinned.*workspace--rail-collapsed/);
  await page.getByRole("button", { name: "Expand navigation" }).click();
  await page.getByRole("button", { name: "Unpin navigation" }).click();
  await expect(page.locator(".workspace")).toHaveClass(/workspace--rail-floating/);
  await expect(page.locator(".stage__status strong")).toContainText("cards loaded");
});

test("loads bundled project assets from the Hosted base path", async ({ page }) => {
  await openHosted(page);
  await page.locator('.rail__item[aria-label="Content"], .rail__item[aria-label="内容"]').click();
  const artwork = page.locator(".card-editor__head img").first();
  await expect(artwork).toBeVisible();
  const result = await artwork.evaluate((image) => ({ pathname: new URL(image.src).pathname, width: image.naturalWidth }));
  expect(result.pathname).toMatch(/\/assets\/sample\/.+\.svg$/);
  expect(result.width).toBeGreaterThan(0);
});

test("does not flash the device language before the saved language loads", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "languages", { configurable: true, get: () => ["zh-CN"] });
    Object.defineProperty(navigator, "language", { configurable: true, get: () => "zh-CN" });
  });
  await openHosted(page);
  await page.getByRole("button", { name: "设置" }).click();
  await page.getByLabel("语言").selectOption("en");
  await expect.poll(() => configContains(page, 'locale = "en"'), { timeout: 15_000 }).toBe(true);

  await page.addInitScript(() => {
    window.__reignsAgentSawChineseUi = false;
    new MutationObserver(() => {
      if (/项目概览|浏览器工作区|设置 \/ 流水线/.test(document.body?.innerText ?? "")) window.__reignsAgentSawChineseUi = true;
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Settings / Pipeline" })).toBeVisible();
  expect(await page.evaluate(() => window.__reignsAgentSawChineseUi)).toBe(false);
});

test("persists navigation density and shared interface language", async ({ page }) => {
  await openHosted(page);

  await expect(page.locator(".project-menu-field > .project-menu__label")).toHaveText("Project");
  await expect(page.locator(".project-menu__trigger")).not.toContainText("Project");
  const headerControlAlignment = await page.locator(".topbar").evaluate((topbar) => {
    const centerDelta = (labelBox, controlBox) => {
      return Math.abs((labelBox.top + labelBox.height / 2) - (controlBox.top + controlBox.height / 2));
    };
    const project = topbar.querySelector(".project-menu-field");
    const skin = topbar.querySelector(".topbar__tools .skin-select");
    const skinLabelRange = document.createRange();
    skinLabelRange.selectNode(skin.firstChild);
    return {
      project: centerDelta(project.querySelector(".project-menu__label").getBoundingClientRect(), project.querySelector(".project-menu__trigger").getBoundingClientRect()),
      skin: centerDelta(skinLabelRange.getBoundingClientRect(), skin.querySelector("select").getBoundingClientRect())
    };
  });
  expect(Math.abs(headerControlAlignment.project - headerControlAlignment.skin)).toBeLessThan(1);
  const projectChevronPath = await page.locator(".project-menu__chevron path").getAttribute("d");
  const skinChevronPath = await page.locator(".skin-select__chevron path").getAttribute("d");
  expect(projectChevronPath).toBe(skinChevronPath);
  const skinSelectGeometry = await page.locator(".skin-select").evaluate((label) => {
    const selectBox = label.querySelector("select").getBoundingClientRect();
    const chevronBox = label.querySelector(".skin-select__chevron").getBoundingClientRect();
    return { rightInset: selectBox.right - chevronBox.right };
  });
  expect(skinSelectGeometry.rightInset).toBeGreaterThanOrEqual(12);
  const readHeaderSurfaceColors = () => page.evaluate(() => ({
    project: getComputedStyle(document.querySelector(".project-menu__trigger")).backgroundColor,
    skin: getComputedStyle(document.querySelector(".skin-select select")).backgroundColor
  }));
  const githubSurfaces = await readHeaderSurfaceColors();
  expect(githubSurfaces.skin).toBe(githubSurfaces.project);
  await page.locator(".skin-select select").selectOption("catppuccin-latte");
  await expect(page.locator("html")).toHaveAttribute("data-skin", "catppuccin-latte");
  await expect.poll(async () => {
    const surfaces = await readHeaderSurfaceColors();
    return surfaces.skin === surfaces.project;
  }).toBe(true);
  await page.locator(".skin-select select").selectOption("github-light");
  await expect(page.locator("html")).toHaveAttribute("data-skin", "github-light");

  const firstItem = page.locator(".rail__item").first();
  const hoverItem = page.locator(".rail__item").nth(1);
  const aiAssistLabel = page.locator('.rail__item[aria-label="AI Assist"] .rail__label');
  const iconExpanded = await firstItem.locator(".rail__icon").boundingBox();
  const aiAssistExpanded = await aiAssistLabel.boundingBox();
  const toggleExpanded = await page.locator(".rail__toggle").boundingBox();
  await expect(page.getByRole("button", { name: "Unpin navigation" })).toBeVisible();
  expect(await firstItem.evaluate((item) => parseFloat(getComputedStyle(item, "::before").borderRadius))).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Collapse navigation" }).click();
  await expect(page.locator(".workspace")).toHaveClass(/workspace--rail-collapsed.*workspace--rail-pinned|workspace--rail-pinned.*workspace--rail-collapsed/);
  await expect(page.locator(".rail__toggle")).toHaveText("»");
  await expect(page.locator(".rail__icon")).toHaveCount(8);
  await page.mouse.move(600, 400);
  await expect(page.locator(".rail")).toHaveCSS("width", "79px");
  const toggleBox = await page.locator(".rail__toggle").boundingBox();
  expect(toggleBox.height).toBeGreaterThanOrEqual(42);
  expect(toggleBox.width).toBeGreaterThanOrEqual(50);
  expect(Math.abs(toggleBox.y - toggleExpanded.y)).toBeLessThan(1);
  await expect(page.getByRole("button", { name: "Unpin navigation" })).toBeHidden();
  const itemHeights = await page.locator(".rail__item").evaluateAll((items) => items.map((item) => item.getBoundingClientRect().height));
  expect(new Set(itemHeights).size).toBe(1);
  const railBox = await page.locator(".rail").boundingBox();
  const activeBox = await firstItem.boundingBox();
  const compactInsets = await firstItem.evaluate((item) => {
    const rail = item.closest(".rail");
    const railBox = rail.getBoundingClientRect();
    const itemBox = item.getBoundingClientRect();
    const divider = parseFloat(getComputedStyle(rail).borderRightWidth);
    return { left: itemBox.left - railBox.left, right: railBox.right - divider - itemBox.right };
  });
  expect(activeBox.width).toBe(54);
  expect(activeBox.x).toBeGreaterThanOrEqual(railBox.x);
  expect(activeBox.x + activeBox.width).toBeLessThanOrEqual(railBox.x + railBox.width);
  expect(Math.abs(compactInsets.left - compactInsets.right)).toBeLessThan(1);
  const iconCollapsed = await firstItem.locator(".rail__icon").boundingBox();
  expect(Math.abs(iconCollapsed.x - iconExpanded.x)).toBeLessThan(1);
  expect(Math.abs(iconCollapsed.y - iconExpanded.y)).toBeLessThan(1);
  const compactCenterDeltas = await page.locator(".rail__item").evaluateAll((items) => items.map((item) => {
    const itemBox = item.getBoundingClientRect();
    const iconBox = item.querySelector(".rail__icon").getBoundingClientRect();
    return {
      x: (iconBox.left + iconBox.width / 2) - (itemBox.left + itemBox.width / 2),
      y: (iconBox.top + iconBox.height / 2) - (itemBox.top + itemBox.height / 2)
    };
  }));
  expect(compactCenterDeltas.every(({ x, y }) => Math.abs(x) < 0.5 && Math.abs(y) < 0.5)).toBe(true);
  await expect(page.locator(".rail__meta")).toHaveText(["01", "02", "03", "04", "05", "06", "07", "08"]);

  // Fixed compact mode stays compact on hover.
  await hoverItem.hover();
  await expect(page.locator(".rail")).toHaveCSS("width", "79px");

  // Compact pinned mode exposes only Expand; Pin returns at the same footer position after expansion.
  await page.getByRole("button", { name: "Expand navigation" }).click();
  await expect(page.getByRole("button", { name: "Unpin navigation" })).toBeVisible();
  const toggleExpandedAgain = await page.locator(".rail__toggle").boundingBox();
  expect(Math.abs(toggleExpandedAgain.y - toggleBox.y)).toBeLessThan(1);

  // Unpinning changes anchoring; the compact rail now reveals a full overlay.
  await page.getByRole("button", { name: "Unpin navigation" }).click();
  await expect(page.locator(".workspace")).toHaveClass(/workspace--rail-floating/);
  await page.mouse.move(600, 400);
  await expect(page.locator(".rail")).toHaveCSS("width", "79px");
  await page.locator(".rail").evaluate((rail) => { rail.scrollTop = 0; });
  const iconBeforeReveal = await firstItem.locator(".rail__icon").boundingBox();
  const standardHoverIcon = await hoverItem.locator(".rail__icon").boundingBox();
  await page.mouse.move(standardHoverIcon.x + standardHoverIcon.width / 2, standardHoverIcon.y + standardHoverIcon.height / 2);
  await expect(page.locator(".rail")).toHaveCSS("width", "236px");
  await expect.poll(() => page.locator(".rail").evaluate((rail) => rail.scrollTop)).toBe(0);
  await expect.poll(async () => {
    const revealed = await firstItem.locator(".rail__icon").boundingBox();
    return Math.max(
      Math.abs(revealed.x - iconBeforeReveal.x),
      Math.abs(revealed.y - iconBeforeReveal.y)
    );
  }).toBeLessThan(1);
  const iconAfterReveal = await firstItem.locator(".rail__icon").boundingBox();
  expect(iconAfterReveal.height).toBe(iconBeforeReveal.height);
  expect(Math.abs(iconAfterReveal.x - iconBeforeReveal.x)).toBeLessThan(1);
  expect(Math.abs(iconAfterReveal.y - iconBeforeReveal.y)).toBeLessThan(1);
  await expect(aiAssistLabel).toHaveCSS("white-space", "nowrap");
  const aiAssistRevealed = await aiAssistLabel.boundingBox();
  expect(aiAssistRevealed.height).toBe(aiAssistExpanded.height);
  const floatingHoverStyle = await hoverItem.evaluate((item) => ({ background: getComputedStyle(item).backgroundColor, border: getComputedStyle(item).borderColor, height: getComputedStyle(item).height }));
  await page.getByRole("button", { name: "Pin navigation" }).click();
  await expect(page.locator(".workspace")).toHaveClass(/workspace--rail-expanded.*workspace--rail-pinned|workspace--rail-pinned.*workspace--rail-expanded/);
  await hoverItem.hover();
  await page.waitForTimeout(250);
  const pinnedHoverStyle = await hoverItem.evaluate((item) => ({ background: getComputedStyle(item).backgroundColor, border: getComputedStyle(item).borderColor, height: getComputedStyle(item).height }));
  expect(pinnedHoverStyle).toEqual(floatingHoverStyle);

  await page.getByRole("button", { name: "Collapse navigation" }).click();
  await page.mouse.move(600, 400);
  await expect(page.locator(".rail")).toHaveCSS("width", "79px");
  await page.reload();
  await expect(page.locator(".workspace")).toHaveClass(/workspace--rail-collapsed.*workspace--rail-pinned|workspace--rail-pinned.*workspace--rail-collapsed/);
  await expect(page.locator(".stage__status strong")).toContainText("cards loaded");

  await page.locator(".skin-select select").selectOption("phantom");
  await page.mouse.move(600, 400);
  await expect(page.locator(".rail")).toHaveCSS("width", "91px");
  await expect(page.locator(".rail__meta").first()).toBeHidden();
  const phantomHeights = await page.locator(".rail__item").evaluateAll((items) => items.map((item) => item.getBoundingClientRect().height));
  expect(new Set(phantomHeights)).toEqual(new Set([72]));
  const phantomCenterDeltas = await page.locator(".rail__item").evaluateAll((items) => items.map((item) => {
    const itemBox = item.getBoundingClientRect();
    const iconBox = item.querySelector(".rail__icon").getBoundingClientRect();
    return {
      x: (iconBox.left + iconBox.width / 2) - (itemBox.left + itemBox.width / 2),
      y: (iconBox.top + iconBox.height / 2) - (itemBox.top + itemBox.height / 2)
    };
  }));
  expect(phantomCenterDeltas.every(({ x, y }) => Math.abs(x) < 0.5 && Math.abs(y) < 0.5)).toBe(true);
  await page.getByRole("button", { name: "Expand navigation" }).click();
  await page.getByRole("button", { name: "Unpin navigation" }).click();
  await page.mouse.move(600, 400);
  await expect(page.locator(".rail")).toHaveCSS("width", "91px");
  await page.locator(".rail").evaluate((rail) => { rail.scrollTop = 0; });
  const phantomIconCollapsed = await firstItem.locator(".rail__icon").boundingBox();
  const phantomHoverIcon = await hoverItem.locator(".rail__icon").boundingBox();
  await page.mouse.move(phantomHoverIcon.x + phantomHoverIcon.width / 2, phantomHoverIcon.y + phantomHoverIcon.height / 2);
  await expect(page.locator(".rail")).toHaveCSS("width", "236px");
  await expect.poll(() => page.locator(".rail").evaluate((rail) => rail.scrollTop)).toBe(0);
  const phantomIconRevealed = await firstItem.locator(".rail__icon").boundingBox();
  expect(Math.abs(phantomIconRevealed.x - phantomIconCollapsed.x)).toBeLessThan(1);
  expect(Math.abs(phantomIconRevealed.y - phantomIconCollapsed.y)).toBeLessThan(1);
  await page.getByRole("button", { name: "Pin navigation" }).click();
  await page.getByRole("button", { name: "Collapse navigation" }).click();
  await page.locator(".skin-select select").selectOption("github-light");

  await page.getByRole("button", { name: "Expand navigation" }).click();
  await page.getByRole("button", { name: "Unpin navigation" }).click();
  await page.locator(".rail__item").last().hover();
  await expect(page.locator(".rail")).toHaveCSS("width", "236px");
  await expect(page.locator('.rail__item[aria-label="Settings"] .rail__label')).toBeVisible();

  await page.locator('.rail__item[aria-label="Settings"]').click();
  await page.mouse.move(600, 400);
  await expect(page.locator(".rail")).toHaveCSS("width", "79px");
  await expect(page.getByRole("heading", { name: "Settings / Pipeline" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "About ReignsAgent" })).toBeVisible();
  await expect(page.locator(".about-settings__meta-line")).toContainText(`v${productVersion}`);
  await expect(page.getByRole("link", { name: `Version ${productVersion} releases` })).toHaveAttribute("href", "https://github.com/Sisyphe42/ReignsAgent/releases");
  await expect(page.getByRole("link", { name: "GitHub repository sisyphe42/ReignsAgent" })).toHaveAttribute("href", "https://github.com/Sisyphe42/ReignsAgent");
  await expect(page.getByLabel("Language")).toHaveValue("system");
  await expect(page.getByLabel("Language").locator('option[value="system"]')).toHaveText("Follow browser");
  await expect(page.locator(".image-endpoint-settings").getByText("Protocol", { exact: true })).toHaveCount(1);
  const aiEndpointHeadingGap = await page.locator(".ai-endpoint-settings").evaluate((section) => {
    const heading = section.querySelector("h3").getBoundingClientRect();
    const form = section.querySelector(".ai-channel-form").getBoundingClientRect();
    return form.top - heading.bottom;
  });
  expect(aiEndpointHeadingGap).toBeGreaterThanOrEqual(10);
  await page.locator(".image-endpoint-settings").getByRole("button", { name: "Midjourney Proxy / NewAPI" }).click();
  await expect(page.locator(".image-endpoint-settings .capability-chip")).toHaveText(["Generate", "Edit / reference"]);
  await page.getByPlaceholder("Deck title").fill("Ready");
  await page.getByRole("button", { name: "Save project details" }).click();
  await page.getByLabel("Language").selectOption("zh-Hans");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hans");
  await expect(page.getByRole("heading", { name: "设置 / 流水线" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "关于 ReignsAgent" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "图像端点" })).toBeVisible();
  await expect(page.locator(".image-endpoint-settings").getByText("协议", { exact: true })).toHaveCount(1);
  await expect(page.locator(".image-endpoint-settings .capability-chip")).toHaveText(["生成", "编辑 / 参考图"]);
  await expect(page.getByRole("heading", { name: "浏览器工作区" })).toBeVisible();
  const hostedWorkspaceSpacing = await page.locator(".hosted-workspace-tools").evaluate((section) => {
    const next = section.nextElementSibling;
    return next.getBoundingClientRect().top - section.getBoundingClientRect().bottom;
  });
  expect(hostedWorkspaceSpacing).toBeGreaterThanOrEqual(20);
  await expect(page.getByRole("button", { name: "复制文本端点连接" })).toBeVisible();
  await expect(page.getByRole("button", { name: "验证图像配置" })).toBeVisible();
  await expect(page.getByRole("link", { name: "打开玩家端预览" })).toBeVisible();
  await expect(page.getByRole("link", { name: "打开玩家端预览" })).toHaveAttribute("href", /locale=zh-Hans/);
  await page.evaluate(() => { window.__reignsAgentFullPageMarker = true; });
  await page.getByRole("link", { name: "打开玩家端预览" }).click();
  await expect(page).toHaveURL(/\/play\.html(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "ReignsAgent Player" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to workbench" })).toBeVisible();
  await page.getByRole("button", { name: "Start reign" }).click();
  await expect(page.locator("#text")).not.toHaveText("The court is waiting.");
  expect(await page.evaluate(() => window.__reignsAgentFullPageMarker)).toBeUndefined();
  await page.getByRole("link", { name: "Back to workbench" }).click();
  await expect(page.getByRole("heading", { name: "设置 / 流水线" })).toBeVisible();
  await page.getByRole("button", { name: "概览" }).click();
  await expect(page.locator('.metric[data-ai-label="Project"] strong')).toHaveText("Ready");
  await expect.poll(() => workspaceContains(page, 'activePanel = "overview"'), { timeout: 15_000 }).toBe(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "项目概览" })).toBeVisible();
});

test("cycles panels only when the host marks the client as desktop", async ({ page }) => {
  await openHosted(page);
  await page.dispatchEvent("body", "keydown", { key: "Tab", ctrlKey: true });
  await expect(page.locator(".rail__item", { hasText: "Overview" })).toHaveClass(/rail__item--active/);

  await page.goto("workbench?client=desktop");
  await expect(page.locator(".stage__status strong")).toContainText("cards loaded");
  await expect(page.getByRole("link", { name: "Open player preview" })).toHaveAttribute("href", /client=desktop/);
  await page.getByRole("button", { name: /Settings/ }).click();
  await expect(page.getByLabel("Language").locator('option[value="system"]')).toHaveText("Follow device");
  await page.dispatchEvent("body", "keydown", { key: "Tab", ctrlKey: true });
  await expect(page.locator(".rail__item", { hasText: "Overview" })).toHaveClass(/rail__item--active/);
});

test("exports a key-free workspace and restores mapped projects", async ({ page }) => {
  await openHosted(page);
  await page.getByRole("button", { name: /Settings/ }).click();
  await page.getByPlaceholder("Deck title").fill("Backup source");
  await page.getByRole("button", { name: "Save project details" }).click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export workspace backup" }).click();
  const download = await downloadPromise;
  const backupPath = await download.path();
  const archive = unzipSync(new Uint8Array(await readFile(backupPath)));
  const snapshot = JSON.parse(strFromU8(archive["workspace.json"]));
  expect(snapshot.config.ai).not.toHaveProperty("apiKey");

  const projectDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export active project" }).click();
  const projectArchive = unzipSync(new Uint8Array(await readFile(await (await projectDownloadPromise).path())));
  const project = JSON.parse(strFromU8(projectArchive["content.json"]));
  expect(project.metadata.title).toBe("Backup source");
  expect(JSON.stringify(project)).not.toContain("apiKey");

  await page.locator(".project-menu > summary").click();
  await page.getByRole("button", { name: "New blank project" }).click();
  await expect(page.locator(".brand p")).toHaveText("Untitled");
  await page.getByRole("button", { name: /Settings/ }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: "workspace.zip", mimeType: "application/zip", buffer: await readFile(backupPath) });
  await page.waitForLoadState("load");
  await expect(page.locator(".brand p")).toHaveText("Backup source");
  await page.reload();
  await expect(page.locator(".brand p")).toHaveText("Backup source");
});

test("validates a direct CORS AI endpoint through the browser backend", async ({ page }) => {
  await openHosted(page);
  await page.getByRole("button", { name: /Settings/ }).click();
  await page.evaluate(({ endpoint }) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    for (const [selector, value] of [["#ai-model-id", "cors-smoke-model"], ["#ai-api-key", "browser-test-key"], ["#ai-base-url", endpoint]]) {
      const element = document.querySelector(selector);
      setter.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }, { endpoint: aiEndpoint });
  await expect(page.getByLabel("Endpoint base URL")).toHaveValue(aiEndpoint);
  await expect(page.getByLabel("Model ID")).toHaveValue("cors-smoke-model");
  await page.getByRole("button", { name: "Validate endpoint" }).click();
  await expect(page.locator(".endpoint-check--success")).toContainText("validated", { timeout: 10_000 });
});

test("generates and applies an OPFS-backed image through the browser backend", async ({ page }) => {
  await openHosted(page);
  await page.getByRole("button", { name: /Settings/ }).click();
  await page.locator("#image-base-url").fill(aiEndpoint);
  await page.locator("#image-model-id").fill("cors-image-model");
  await page.getByRole("button", { name: "Validate image config" }).click();
  await expect(page.locator(".image-endpoint-settings .endpoint-check--success")).toContainText("Generate");

  await page.getByRole("button", { name: /AI Assist/ }).click();
  await page.locator(".ai-edit-controls select").first().selectOption("generate");
  await page.locator(".ai-edit-controls textarea").fill("A stark ink portrait for the opening court card");
  await page.getByRole("button", { name: "Build draft" }).click();
  await expect(page.getByRole("heading", { name: "Generated images" })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".image-result img")).toBeVisible();
  await page.getByRole("button", { name: "Apply selected image" }).click();
  await expect(page.locator(".stage__status strong")).toContainText("Image asset applied");
  await expect.poll(() => page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dataRoot = await root.getDirectoryHandle("ReignsAgentData");
    const config = await (await dataRoot.getFileHandle("config.toml")).getFile();
    const active = (await config.text()).match(/activeProjectId\s*=\s*"([^"]+)"/)?.[1];
    if (!active) return false;
    const project = await (await dataRoot.getDirectoryHandle("projects")).getDirectoryHandle(active);
    const content = await (await project.getFileHandle("content.json")).getFile();
    return /assets\/generated\/[a-f0-9]{64}\.png/.test(await content.text());
  })).toBe(true);
  const generatedUri = await activeGeneratedAssetUri(page);

  await page.locator(".ai-edit-controls select").first().selectOption("edit");
  const referenceInput = page.locator('.image-operation-controls input[type="file"]');
  await expect(referenceInput).toHaveCount(1);
  await referenceInput.setInputFiles([{ name: "court portrait 中文.png", mimeType: "image/png", buffer: Buffer.from(tinyPngBase64, "base64") }]);
  await expect(page.locator(".image-operation-controls")).toContainText("1 reference image staged");
  await page.locator(".ai-edit-controls select").first().selectOption("inpaint");
  await expect(page.getByLabel("Inpaint mask canvas")).toBeVisible();
  await expect.poll(() => page.getByLabel("Inpaint mask canvas").evaluate((canvas) => [canvas.width, canvas.height])).toEqual([1, 1]);
  await page.getByLabel("Inpaint mask canvas").click({ position: { x: 10, y: 10 } });
  await page.getByRole("button", { name: "Use mask" }).click();
  await expect(page.locator(".image-operation-controls")).toContainText("Mask ready");
  await expect.poll(() => activeMaskMetadata(page)).toEqual({ width: 1, height: 1, alpha: 0 });
  await page.locator(".ai-edit-controls select").first().selectOption("outpaint");
  await page.locator('.outpaint-grid label', { hasText: "left" }).locator("input").fill("32");
  await page.getByRole("button", { name: "Build draft" }).click();
  await expect(page.getByRole("heading", { name: "Generated images" })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Discard draft" }).click();
  await expect(page.locator(".stage__status strong")).toContainText("Image draft discarded");

  await page.locator(".rail__item", { hasText: "Build" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export player ZIP" }).click();
  const archive = unzipSync(new Uint8Array(await readFile(await (await downloadPromise).path())));
  expect(archive[generatedUri]).toBeDefined();
  expect([...archive[generatedUri]]).toEqual([...Buffer.from(tinyPngBase64, "base64")]);
});

async function activeGeneratedAssetUri(page) {
  return page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dataRoot = await root.getDirectoryHandle("ReignsAgentData");
    const config = await (await dataRoot.getFileHandle("config.toml")).getFile();
    const active = (await config.text()).match(/activeProjectId\s*=\s*"([^"]+)"/)?.[1];
    const project = await (await dataRoot.getDirectoryHandle("projects")).getDirectoryHandle(active);
    const content = JSON.parse(await (await project.getFileHandle("content.json")).getFile().then((file) => file.text()));
    return content.assets.findLast((asset) => /^assets\/generated\/[a-f0-9]{64}\.png$/.test(asset.uri))?.uri ?? "";
  });
}

async function activeMaskMetadata(page) {
  return page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dataRoot = await root.getDirectoryHandle("ReignsAgentData");
    const config = await (await dataRoot.getFileHandle("config.toml")).getFile();
    const active = (await config.text()).match(/activeProjectId\s*=\s*"([^"]+)"/)?.[1];
    const project = await (await dataRoot.getDirectoryHandle("projects")).getDirectoryHandle(active);
    const assets = await project.getDirectoryHandle("assets");
    const drafts = await assets.getDirectoryHandle(".drafts");
    for await (const [name, entry] of drafts.entries()) {
      if (entry.kind !== "directory" || !name.startsWith("mask-")) continue;
      const blob = await (await entry.getFileHandle("mask.png")).getFile();
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      return { width: canvas.width, height: canvas.height, alpha: context.getImageData(0, 0, 1, 1).data[3] };
    }
    return null;
  });
}

async function prepareOnboardingStorage(page, onboarding) {
  await page.addInitScript(({ key, mode }) => {
    try {
      if (mode === "complete") {
        window.localStorage.setItem(key, "true");
        return;
      }
      if (window.sessionStorage.getItem("reigns-agent.test.onboarding-initialized") !== "true") {
        window.localStorage.removeItem(key);
        window.sessionStorage.setItem("reigns-agent.test.onboarding-initialized", "true");
      }
    } catch {
      // Storage failure behavior is covered by dedicated tests.
    }
  }, { key: ONBOARDING_COMPLETED_KEY, mode: onboarding });
}

async function openHosted(page, { onboarding = "complete" } = {}) {
  await prepareOnboardingStorage(page, onboarding);
  await page.goto("workbench");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page.waitForLoadState("load");
  await expect(page.locator(".stage__status strong")).toContainText("cards loaded");
}

async function workspaceContains(page, expected) {
  return page.evaluate(async (text) => {
    try {
      const root = await navigator.storage.getDirectory();
      const dataRoot = await root.getDirectoryHandle("ReignsAgentData");
      const projects = await dataRoot.getDirectoryHandle("projects");
      for await (const [, project] of projects.entries()) {
        if (project.kind !== "directory") continue;
        try {
          const handle = await project.getFileHandle("workspace.toml");
          if ((await (await handle.getFile()).text()).includes(text)) return true;
        } catch (error) {
          if (error?.name !== "NotFoundError" && error?.name !== "NotReadableError") throw error;
        }
      }
    } catch (error) {
      if (error?.name === "NotFoundError" || error?.name === "NotReadableError") return false;
      throw error;
    }
    return false;
  }, expected);
}

async function configContains(page, expected) {
  return page.evaluate(async (text) => {
    const root = await navigator.storage.getDirectory();
    const dataRoot = await root.getDirectoryHandle("ReignsAgentData");
    const config = await (await dataRoot.getFileHandle("config.toml")).getFile();
    return (await config.text()).includes(text);
  }, expected);
}
