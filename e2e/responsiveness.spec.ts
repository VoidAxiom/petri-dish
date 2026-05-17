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
    await expect(generationBadge).toHaveText(`Generation ${(index + 1) * 50}`, { timeout: 8_000 });
  }

  await page.getByRole("button", { name: "Run" }).click({ timeout: 2_000 });
  await expect(generationBadge).not.toHaveText("Generation 300", { timeout: 7_000 });

  await page.getByRole("button", { name: "Pause" }).click({ timeout: longRunInteractionTimeoutMs });
  await expect(page.getByRole("button", { name: "Run" })).toBeVisible();
  const pausedGeneration = await generationBadge.textContent();

  await page.waitForTimeout(1_000);
  await expect(generationBadge).toHaveText(pausedGeneration ?? "");

  await page.getByTestId("snapshot-scrubber").evaluate((element) => {
    const input = element as HTMLInputElement;
    const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    valueSetter?.call(input, "120");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(page.getByTestId("live-generation")).toHaveText(pausedGeneration ?? "");
  await expect(page.getByTestId("snapshot-generation")).toHaveText(/Generation \d+/);
  const replayGeneration = ((await page.getByTestId("snapshot-generation").textContent()) ?? "").replace("Generation ", "");
  expect(Number(replayGeneration)).toBeGreaterThan(0);
  expect(Number(replayGeneration)).toBeLessThan(Number((pausedGeneration ?? "").replace("Generation ", "")));
  await expect(generationBadge).toHaveText(`Generation ${replayGeneration}`);
  await expect(page.getByTestId("world-map")).toHaveAttribute("data-replay-mode", "snapshot");
  await expect(page.getByTestId("world-map")).toHaveAttribute("data-generation", replayGeneration);
  await expect(page.getByTestId("world-map")).toHaveAttribute("data-live-generation", (pausedGeneration ?? "").replace("Generation ", ""));
  await expect(page.getByTestId("creature-inspector")).toHaveAttribute("data-generation", replayGeneration);
  await expect(page.getByTestId("world-memory")).toHaveAttribute("data-generation", replayGeneration);
  await expect(page.getByTestId("population-timeline")).toHaveAttribute("data-generation-max", replayGeneration);

  await page.getByTestId("replay-live-toggle").click({ timeout: 2_000 });
  await expect(page.getByTestId("snapshot-generation")).toHaveText("Live");
  await expect(generationBadge).toHaveText(pausedGeneration ?? "");
  await expect(page.getByTestId("world-map")).toHaveAttribute("data-replay-mode", "live");

  const terrainSignature = await page.locator("canvas.world-map").evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext("2d");
    if (!context) return "";

    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const components: number[] = [];
    const step = Math.max(4, Math.floor(image.data.length / 4 / 64) * 4);
    for (let index = 0; index < image.data.length; index += step) {
      components.push(image.data[index], image.data[index + 1], image.data[index + 2], image.data[index + 3]);
    }
    return components.join("-");
  });
  await page.getByRole("button", { name: "Step" }).click({ timeout: 2_000 });
  await expect(generationBadge).not.toHaveText(pausedGeneration ?? "");
  const nextTerrainSignature = await page.locator("canvas.world-map").evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext("2d");
    if (!context) return "";

    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const components: number[] = [];
    const step = Math.max(4, Math.floor(image.data.length / 4 / 64) * 4);
    for (let index = 0; index < image.data.length; index += step) {
      components.push(image.data[index], image.data[index + 1], image.data[index + 2], image.data[index + 3]);
    }
    return components.join("-");
  });
  expect(nextTerrainSignature).not.toBe(terrainSignature);

  const renderBudget = await page.locator("canvas.world-map").evaluate((canvas) => ({
    terrainCells: Number(canvas.dataset.terrainCells),
    renderedCreatures: Number(canvas.dataset.creaturesRendered),
    selectedLineageCount: Number(canvas.dataset.selectedLineageCount),
    svgMapNodes: document.querySelectorAll(".world-map rect, .world-map circle").length,
    totalDomNodes: document.querySelectorAll("*").length
  }));
  expect(renderBudget.terrainCells).toBeGreaterThan(1_000);
  expect(renderBudget.renderedCreatures).toBeGreaterThan(100);
  expect(renderBudget.selectedLineageCount).toBeGreaterThan(0);
  expect(renderBudget.svgMapNodes).toBe(0);
  expect(renderBudget.totalDomNodes).toBeLessThan(850);

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
  await expect(page.getByTestId("snapshot-scrubber")).toBeVisible();

  const mapBox = await page.locator(".world-map").boundingBox();
  expect(mapBox?.width).toBeGreaterThan(340);
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(horizontalOverflow).toBeLessThanOrEqual(2);
  const domNodes = await page.evaluate(() => document.querySelectorAll("*").length);
  expect(domNodes).toBeLessThan(950);
});
