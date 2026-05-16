import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

test("keeps controls responsive while the world is running", async ({ page }, testInfo) => {
  await page.goto("/");

  const generationBadge = page.locator(".event-strip > div:first-child strong");
  const longRunInteractionTimeoutMs = 8_000;
  await page.getByRole("button", { name: "Pause" }).click({ timeout: 2_000 });
  await page.getByRole("button", { name: "Reset" }).click({ timeout: 2_000 });
  await expect(page.getByRole("button", { name: "Run" })).toBeVisible();
  await expect(generationBadge).toHaveText("Generation 0");

  for (let index = 0; index < 6; index += 1) {
    await page.getByRole("button", { name: "Epoch" }).click({ timeout: 3_000 });
  }

  await expect(generationBadge).toHaveText("Generation 300");
  await page.getByRole("button", { name: "Run" }).click({ timeout: 2_000 });
  await expect(generationBadge).not.toHaveText("Generation 300", { timeout: 7_000 });

  await page.getByRole("button", { name: "Pause" }).click({ timeout: longRunInteractionTimeoutMs });
  await expect(page.getByRole("button", { name: "Run" })).toBeVisible();
  const pausedGeneration = await generationBadge.textContent();

  await page.waitForTimeout(1_000);
  await expect(generationBadge).toHaveText(pausedGeneration ?? "");

  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(horizontalOverflow).toBeLessThanOrEqual(2);

  const screenshotDir = path.join(process.cwd(), "artifacts", "screenshots");
  await mkdir(screenshotDir, { recursive: true });
  const screenshotPath = path.join(screenshotDir, "petri-dish-long-run-responsive.png");
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach("petri-dish-long-run-responsive", { path: screenshotPath, contentType: "image/png" });
});

test("fits the mobile viewport without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Pause" }).click();

  await expect(page.getByRole("heading", { name: "Petri Dish" })).toBeVisible();
  await expect(page.getByText("Survival pressures")).toBeVisible();
  await expect(page.getByText("Lineage lens")).toBeVisible();

  const mapBox = await page.locator(".world-map").boundingBox();
  expect(mapBox?.width).toBeGreaterThan(340);
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(horizontalOverflow).toBeLessThanOrEqual(2);
});
