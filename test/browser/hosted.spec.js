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

  await page.getByRole("button", { name: "New", exact: true }).click();
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
