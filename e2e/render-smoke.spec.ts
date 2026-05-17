import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

test("renders a nonblank living lab and captures a screenshot", async ({ page }, testInfo) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Pause" }).click();
  await page.getByRole("button", { name: "Reset" }).click();
  const generationBadge = page.locator(".event-strip > div:first-child strong");
  await expect(generationBadge).toHaveText("Generation 0");

  await expect(page.getByRole("heading", { name: "Petri Dish" })).toBeVisible();
  await expect(page.getByText("Survival pressures")).toBeVisible();
  await expect(page.getByLabel("Hunger pressure")).toBeVisible();
  await expect(page.getByText("Dynasty")).toBeVisible();
  await expect(page.getByText("Lineage lens")).toBeVisible();
  await expect(page.getByText("World memory")).toBeVisible();
  await expect(page.getByTestId("snapshot-panel")).toBeVisible();
  await expect(page.getByTestId("snapshot-generation")).toHaveText("Live");
  await page.getByRole("button", { name: "disease" }).click();
  await expect(page.getByRole("button", { name: "disease" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("disease legend")).toBeVisible();

  await page.getByRole("button", { name: "Step" }).click();
  await expect(generationBadge).toHaveText("Generation 1");

  const mapStats = await page.getByTestId("world-map").evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext("2d");
    const image = context?.getImageData(0, 0, canvas.width, canvas.height);
    const swatches = new Set<string>();
    let paintedPixels = 0;

    if (image) {
      const step = Math.max(4, Math.floor(image.data.length / 4 / 1_200) * 4);
      for (let index = 0; index < image.data.length; index += step) {
        const alpha = image.data[index + 3];
        if (alpha > 0) {
          paintedPixels += 1;
          swatches.add(`${image.data[index]}-${image.data[index + 1]}-${image.data[index + 2]}`);
        }
      }
    }

    return {
      width: canvas.width,
      height: canvas.height,
      terrainCells: Number(canvas.dataset.terrainCells),
      renderedCreatures: Number(canvas.dataset.creaturesRendered),
      selectedLineageCount: Number(canvas.dataset.selectedLineageCount),
      replayMode: canvas.dataset.replayMode,
      svgMapNodes: document.querySelectorAll(".world-map rect, .world-map circle").length,
      paintedPixels,
      swatches: swatches.size
    };
  });
  expect(mapStats.terrainCells).toBeGreaterThan(1_000);
  expect(mapStats.renderedCreatures).toBeGreaterThan(80);
  expect(mapStats.selectedLineageCount).toBeGreaterThan(0);
  expect(mapStats.replayMode).toBe("live");
  expect(mapStats.svgMapNodes).toBe(0);
  expect(mapStats.paintedPixels).toBeGreaterThan(600);
  expect(mapStats.swatches).toBeGreaterThan(8);

  const mapBox = await page.locator(".world-map").boundingBox();
  expect(mapBox?.width).toBeGreaterThan(600);
  expect(mapBox?.height).toBeGreaterThan(300);
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(horizontalOverflow).toBeLessThanOrEqual(2);

  const screenshotDir = path.join(process.cwd(), "artifacts", "screenshots");
  await mkdir(screenshotDir, { recursive: true });
  const screenshotPath = path.join(screenshotDir, "petri-dish-living-map.png");
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach("petri-dish-living-map", { path: screenshotPath, contentType: "image/png" });
});
