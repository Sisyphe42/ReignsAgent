import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { strFromU8, unzipSync } from "fflate";

let aiServer;
let aiEndpoint;

test.beforeAll(async () => {
  aiServer = createServer((request, response) => {
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("access-control-allow-headers", "authorization,content-type");
    response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
    if (request.method === "OPTIONS") { response.writeHead(204); response.end(); return; }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ proposals: [] }) } }] }));
  });
  await new Promise((resolve) => aiServer.listen(0, "127.0.0.1", resolve));
  aiEndpoint = `http://127.0.0.1:${aiServer.address().port}/v1`;
});

test.afterAll(async () => new Promise((resolve) => aiServer.close(resolve)));

test("persists an OPFS project and reopens the PWA offline", async ({ page, context }) => {
  await openHosted(page);
  await expect(page.getByRole("heading", { name: "ReignsAgent" })).toBeVisible();
  await page.getByRole("button", { name: /Settings/ }).click();
  const title = page.getByPlaceholder("Deck title");
  await title.fill("Hosted persistence smoke");
  await page.getByRole("button", { name: "Save title" }).click();
  await expect(page.locator(".brand p")).toHaveText("Hosted persistence smoke");
  await page.reload();
  await expect(page.locator(".brand p")).toHaveText("Hosted persistence smoke");
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "ReignsAgent" })).toBeVisible();
  await expect(page.locator(".brand p")).toHaveText("Hosted persistence smoke");
});

test("honors a direct panel URL over the persisted workspace panel", async ({ page }) => {
  await openHosted(page);
  await page.getByRole("button", { name: /Review/ }).click();
  await expect(page).toHaveURL(/\/workbench\/review(?:\?|$)/);
  await expect.poll(() => workspaceContains(page, 'activePanel = "review"')).toBe(true);

  await page.goto("workbench/content");
  await expect(page.locator(".stage__status strong")).toContainText("cards loaded");
  await expect(page.getByRole("button", { name: /Content/ })).toHaveClass(/rail__item--active/);
  await expect(page).toHaveURL(/\/workbench\/content(?:\?|$)/);
});

test("persists navigation density and shared interface language", async ({ page }) => {
  await openHosted(page);

  await expect(page.locator(".project-menu-field > .project-menu__label")).toHaveText("Project");
  await expect(page.locator(".project-menu__trigger")).not.toContainText("Project");
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
  const iconAfterReveal = await firstItem.locator(".rail__icon").boundingBox();
  expect(iconAfterReveal.height).toBe(iconBeforeReveal.height);
  expect(Math.abs(iconAfterReveal.x - iconBeforeReveal.x)).toBeLessThan(1);
  expect(Math.abs(iconAfterReveal.y - iconBeforeReveal.y)).toBeLessThan(1);
  await expect.poll(() => page.locator(".rail").evaluate((rail) => rail.scrollTop)).toBe(0);
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
  await page.locator(".rail").evaluate((rail) => { rail.scrollTop = 0; });
  const phantomIconCollapsed = await firstItem.locator(".rail__icon").boundingBox();
  const phantomHoverIcon = await hoverItem.locator(".rail__icon").boundingBox();
  await page.mouse.move(phantomHoverIcon.x + phantomHoverIcon.width / 2, phantomHoverIcon.y + phantomHoverIcon.height / 2);
  await expect(page.locator(".rail")).toHaveCSS("width", "236px");
  const phantomIconRevealed = await firstItem.locator(".rail__icon").boundingBox();
  expect(Math.abs(phantomIconRevealed.x - phantomIconCollapsed.x)).toBeLessThan(1);
  expect(Math.abs(phantomIconRevealed.y - phantomIconCollapsed.y)).toBeLessThan(1);
  await expect.poll(() => page.locator(".rail").evaluate((rail) => rail.scrollTop)).toBe(0);
  await page.getByRole("button", { name: "Pin navigation" }).click();
  await page.getByRole("button", { name: "Collapse navigation" }).click();
  await page.locator(".skin-select select").selectOption("github-light");

  await page.getByRole("button", { name: "Expand navigation" }).click();
  await page.getByRole("button", { name: "Unpin navigation" }).click();
  await page.locator(".rail__item").last().hover();
  await expect(page.locator(".rail")).toHaveCSS("width", "236px");
  await expect(page.locator('.rail__item[aria-label="Settings"] .rail__label')).toBeVisible();

  await page.locator('.rail__item[aria-label="Settings"]').click();
  await expect(page.getByRole("heading", { name: "Settings / Pipeline" })).toBeVisible();
  await expect(page.getByLabel("Language")).toHaveValue("system");
  await expect(page.getByLabel("Language").locator('option[value="system"]')).toHaveText("Follow browser");
  await page.getByPlaceholder("Deck title").fill("Ready");
  await page.getByRole("button", { name: "Save title" }).click();
  await page.getByLabel("Language").selectOption("zh-Hans");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hans");
  await expect(page.getByRole("heading", { name: "设置 / 流水线" })).toBeVisible();
  await expect(page.getByRole("link", { name: "打开玩家端预览" })).toBeVisible();
  await expect(page.getByRole("link", { name: "打开玩家端预览" })).toHaveAttribute("href", /locale=zh-Hans/);
  await page.getByRole("button", { name: "概览" }).click();
  await expect(page.locator('.metric[data-ai-label="Project"] strong')).toHaveText("Ready");
  await expect.poll(() => workspaceContains(page, 'activePanel = "overview"')).toBe(true);
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
  await page.getByRole("button", { name: "Save title" }).click();

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

async function openHosted(page) {
  await page.goto("workbench");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page.waitForLoadState("load");
  await expect(page.locator(".stage__status strong")).toContainText("cards loaded");
}

async function workspaceContains(page, expected) {
  return page.evaluate(async (text) => {
    const root = await navigator.storage.getDirectory();
    const dataRoot = await root.getDirectoryHandle("ReignsAgentData");
    const projects = await dataRoot.getDirectoryHandle("projects");
    for await (const [, project] of projects.entries()) {
      if (project.kind !== "directory") continue;
      try {
        const handle = await project.getFileHandle("workspace.toml");
        if ((await (await handle.getFile()).text()).includes(text)) return true;
      } catch (error) {
        if (error?.name !== "NotFoundError") throw error;
      }
    }
    return false;
  }, expected);
}
