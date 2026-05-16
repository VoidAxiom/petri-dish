import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

test("renders a nonblank living lab and captures a screenshot", async ({ page }, testInfo) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Petri Dish" })).toBeVisible();
  await expect(page.getByText("Dynasty")).toBeVisible();
  await expect(page.getByText("World memory")).toBeVisible();
  await page.getByRole("button", { name: "disease" }).click();
  await expect(page.getByRole("button", { name: "disease" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("disease legend")).toBeVisible();

  await page.getByRole("button", { name: "Pause" }).click();
  const generationBadge = page.locator(".event-strip > div:first-child strong");
  await expect(generationBadge).toHaveText("Generation 0");
  await page.getByRole("button", { name: "Step" }).click();
  await expect(generationBadge).toHaveText("Generation 1");

  const terrainTiles = await page.locator(".world-map rect").count();
  const renderedCreatures = await page.locator(".world-map circle").count();
  expect(terrainTiles).toBeGreaterThan(1_000);
  expect(renderedCreatures).toBeGreaterThan(80);

  const mapBox = await page.locator(".world-map").boundingBox();
  expect(mapBox?.width).toBeGreaterThan(600);
  expect(mapBox?.height).toBeGreaterThan(300);

  const screenshotDir = path.join(process.cwd(), "artifacts", "screenshots");
  await mkdir(screenshotDir, { recursive: true });
  const screenshotPath = path.join(screenshotDir, "petri-dish-living-map.png");
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach("petri-dish-living-map", { path: screenshotPath, contentType: "image/png" });
});
