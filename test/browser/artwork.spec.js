import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { createCreatorServer } from "../../apps/creator-server/src/server.mjs";

test.use({ serviceWorkers: "block" });
let outputDir;
let standaloneUrl;
let standaloneServer;
let build;
let creatorServer;
let creatorUrl;

test.beforeAll(async () => {
  outputDir = await mkdtemp(join(tmpdir(), "reigns-artwork-browser-"));
  execFileSync(process.execPath, ["scripts/build-game.mjs", "fixtures/content/oss-court.cards.json", outputDir]);
  const buildFile = (await readdir(outputDir)).find((name) => name.endsWith(".game.json"));
  build = JSON.parse(await readFile(join(outputDir, buildFile), "utf8"));
  creatorServer = await createCreatorServer({ staticRoot: "apps/creator-web/dist", dataRoot: join(outputDir, "creator-data"), initialBundle: build.content });
  const projectsPath = join(outputDir, "creator-data/projects");
  for (const project of await readdir(projectsPath, { withFileTypes: true })) {
    if (project.isDirectory()) await cp(join(outputDir, "assets"), join(projectsPath, project.name, "assets"), { recursive: true });
  }
  creatorUrl = (await creatorServer.start({ port: 0 })).origin;
  for (const uri of new Set(build.content.assets.map((asset) => asset.uri))) {
    if (!uri.startsWith("assets/")) continue;
    expect(await readFile(join(outputDir, uri))).toEqual(await readFile(join("packages/interface/web", uri)));
  }
  standaloneServer = createServer(async (request, response) => {
    const path = new URL(request.url, "http://localhost").pathname.slice(1);
    if (path.includes("..") || !/^[\w./-]+$/.test(path)) { response.writeHead(400).end(); return; }
    try {
      response.setHeader("Content-Type", path.endsWith(".html") ? "text/html" : path.endsWith(".js") ? "text/javascript" : path.endsWith(".svg") ? "image/svg+xml" : "application/json");
      response.end(await readFile(join(outputDir, path)));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolve) => standaloneServer.listen(0, "127.0.0.1", resolve));
  standaloneUrl = `http://127.0.0.1:${standaloneServer.address().port}/player.html`;
});

test.afterAll(async () => {
  if (creatorServer) await creatorServer.close();
  if (standaloneServer) await new Promise((resolve) => standaloneServer.close(resolve));
  if (outputDir) await rm(outputDir, { recursive: true, force: true });
});

test("local display saves reject overlap, expose errors, and persist a retry", async ({ page }) => {
  await openCreator(page);
  await page.goto(`${creatorUrl}/workbench/content?locale=en`);
  await expect(page.locator(".card-artwork--editor")).toHaveAttribute("data-fit", "adaptive");
  let release;
  let intercepted;
  const received = new Promise((resolve) => { intercepted = resolve; });
  await page.route("**/api/editor/assets/*", async (route) => {
    intercepted();
    await new Promise((resolve) => { release = resolve; });
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { message: "Save unavailable" } }) });
  });
  await page.getByRole("button", { name: "Fill frame", exact: true }).click();
  await received;
  await expect(page.getByRole("button", { name: "Full image", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Top right", exact: true })).toBeDisabled();
  release();
  await expect(page.locator(".art-display-controls [role=alert]")).toContainText("Could not save");
  await expect(page.locator(".card-artwork--editor")).toHaveAttribute("data-fit", "adaptive");
  await page.unroute("**/api/editor/assets/*");
  await page.getByRole("button", { name: "Fill frame", exact: true }).click();
  await expect(page.locator(".card-artwork--editor")).toHaveAttribute("data-fit", "cover");
  await page.getByRole("button", { name: "Top right", exact: true }).click();
  await expect(page.getByRole("button", { name: "Top right", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.locator(".card-artwork--editor")).toHaveAttribute("data-fit", "cover");
  await expect(page.getByRole("button", { name: "Top right", exact: true })).toHaveAttribute("aria-pressed", "true");
});

async function openCreator(page, locale = "en") {
  await page.addInitScript(() => localStorage.setItem("reigns-agent.creator-web.onboarding-completed", "true"));
  await page.goto(`workbench/content?locale=${locale}`);
  await expect(page.locator(".card-editor")).toBeVisible();
}

async function setDisplay(page, display) {
  await page.evaluate(async (value) => {
    const root = await navigator.storage.getDirectory();
    const data = await root.getDirectoryHandle("ReignsAgentData");
    const projects = await data.getDirectoryHandle("projects");
    for await (const [, project] of projects.entries()) {
      if (project.kind !== "directory") continue;
      const file = await project.getFileHandle("content.json");
      const content = JSON.parse(await (await file.getFile()).text());
      content.assets.forEach((asset) => { if (asset.cardId) asset.metadata = { ...asset.metadata, display: value }; });
      const writer = await file.createWritable();
      await writer.write(JSON.stringify(content));
      await writer.close();
    }
  }, display);
}

async function assertArtwork(frame, fit, width, height) {
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute("data-fit", fit);
  await expect.poll(() => frame.evaluate((element) => {
    const foreground = element.querySelector("img:last-child");
    const backdrop = element.querySelector("img:first-child");
    const rect = element.getBoundingClientRect();
    return {
      square: Math.abs(rect.width - rect.height) < 1,
      dimensions: [foreground.naturalWidth, foreground.naturalHeight],
      fit: getComputedStyle(foreground).objectFit,
      position: getComputedStyle(foreground).objectPosition,
      backdrop: getComputedStyle(backdrop).display !== "none",
      hidden: backdrop.getAttribute("aria-hidden")
    };
  })).toMatchObject({
    square: true, dimensions: [width, height], fit: fit === "cover" ? "cover" : "contain",
    position: fit === "cover" ? "100% 0%" : "50% 50%",
    backdrop: fit === "adaptive", hidden: "true"
  });
}

for (const [shape, width, height] of [["landscape", 320, 120], ["portrait", 120, 320], ["square", 200, 200]]) {
  for (const fit of ["adaptive", "contain", "cover"]) {
    test(`${shape} ${fit} in Creator and both Players`, async ({ page }, testInfo) => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#167d9a"/><circle cx="${width * .8}" cy="${height * .2}" r="24" fill="#ffd578"/></svg>`;
      await page.route("**/assets/sample/*.svg", (route) => route.fulfill({ contentType: "image/svg+xml", body: svg }));
      await openCreator(page);
      const display = { fit, focalPoint: { x: 1, y: 0 } };
      await setDisplay(page, display);
      await page.reload();
      await assertArtwork(page.locator(".card-artwork--editor"), fit, width, height);
      await page.locator(".art-display-controls").screenshot({ path: testInfo.outputPath("creator.png") });
      await page.goto("play.html?locale=en");
      await page.getByRole("button", { name: "Start reign" }).click();
      for (let turn = 0; turn < 12 && !await page.locator("#art-frame").isVisible(); turn++) {
        await page.getByRole("button", { name: "Swipe left" }).click();
      }
      await assertArtwork(page.locator("#art-frame"), fit, width, height);
      const customized = structuredClone(build);
      customized.content.assets.forEach((asset) => { asset.metadata = { ...asset.metadata, display }; });
      await page.goto(standaloneUrl);
      await page.locator("#file").setInputFiles({ name: "artwork.game.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(customized)) });
      await assertArtwork(page.locator("#art-frame"), fit, width, height);
      await page.setViewportSize({ width: 390, height: 844 });
      await assertArtwork(page.locator("#art-frame"), fit, width, height);
      await page.screenshot({ path: testInfo.outputPath("standalone-mobile.png"), fullPage: true });
    });
  }
}

test("localized editor preview fits mobile and recovers after a failed image", async ({ page }, testInfo) => {
  await page.route("**/assets/sample/*.svg", (route) => route.fulfill({ status: 404, body: "missing" }));
  await openCreator(page, "zh-Hans");
  await expect(page.locator(".art-display-preview .art-placeholder")).toBeVisible();
  await expect(page.getByRole("button", { name: "自适应", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "完整图片", exact: true }).click();
  await expect(page.getByRole("button", { name: "居中", exact: true })).toBeDisabled();
  await page.unroute("**/assets/sample/*.svg");
  await page.reload();
  await expect(page.locator(".card-artwork--editor img:last-child")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".art-display-preview").scrollIntoViewIfNeeded();
  const bounds = await page.locator(".card-artwork--editor").boundingBox();
  expect(bounds.width).toBeGreaterThan(140);
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await page.locator(".art-display-controls").screenshot({ path: testInfo.outputPath("creator-chinese-mobile.png") });
});

test("Players recover from a missing image when a valid build is loaded", async ({ page }) => {
  await page.route("**/assets/sample/*.svg", (route) => route.fulfill({ status: 404, body: "missing" }));
  await openCreator(page);
  await page.goto("play.html?locale=en");
  await page.getByRole("button", { name: "Start reign" }).click();
  await expect(page.locator("#art-frame")).toBeHidden();
  await page.unroute("**/assets/sample/*.svg");
  await page.reload();
  await page.getByRole("button", { name: "Start reign" }).click();
  await expect(page.locator("#art-frame")).toBeVisible();
  await page.goto(standaloneUrl);
  const broken = structuredClone(build);
  broken.content.assets.forEach((asset) => { asset.uri = "missing.svg"; });
  const load = (value) => page.locator("#file").setInputFiles({ name: "test.game.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(value)) });
  await load(broken);
  await expect(page.locator("#art-frame")).toBeHidden();
  await load(build);
  await expect(page.locator("#art-frame")).toBeVisible();
  await expect.poll(() => page.locator("#art").evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
});
