import { expect, test } from "@playwright/test";

test("persists an OPFS project and reopens the PWA offline", async ({ page, context }) => {
  await page.goto("workbench");
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
