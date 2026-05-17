import { expect, test } from "@playwright/test";

const storageKey = "petri-dish:persisted-run:v1";

test("resumes a saved civilization after reload and supports clearing it", async ({ page }) => {
  await page.goto("/");

  const generationBadge = page.locator(".event-strip > div:first-child strong");
  await page.getByRole("button", { name: "Pause" }).click({ timeout: 2_000 });
  await page.getByRole("button", { name: "Reset" }).click({ timeout: 2_000 });
  await expect(generationBadge).toHaveText("Generation 0");

  await page.getByRole("button", { name: "Epoch" }).click({ timeout: 3_000 });
  await expect(generationBadge).toHaveText("Generation 50", { timeout: 8_000 });
  await expect(page.getByTestId("persistence-status")).toHaveAttribute("data-status", "saved");
  await expect(page.getByTestId("persistence-status")).toHaveAttribute("data-generation", "50");
  expect(Number(await page.getByTestId("persistence-status").getAttribute("data-bytes"))).toBeLessThan(3_700_000);
  const savedGeneration = Number(await page.getByTestId("persistence-status").getAttribute("data-generation"));
  expect(savedGeneration).toBe(50);

  const storedBeforeReload = await page.evaluate((key) => window.localStorage.getItem(key), storageKey);
  expect(storedBeforeReload).toContain('"generation":50');
  expect(JSON.parse(storedBeforeReload ?? "{}").snapshots.length).toBeLessThanOrEqual(2);
  await page.evaluate((key) => {
    const payload = JSON.parse(window.localStorage.getItem(key) ?? "{}");
    payload.savedAt = new Date(Date.now() - 15 * 60_000).toISOString();
    window.localStorage.setItem(key, JSON.stringify(payload));
  }, storageKey);

  await page.reload();
  await page.getByRole("button", { name: "Pause" }).click({ timeout: 2_000 });
  await expect(page.getByTestId("persistence-status")).toHaveAttribute("data-generation", String(savedGeneration + 15));
  await expect(page.getByTestId("persistence-status")).toHaveAttribute("data-catch-up-generations", "15");
  await expect(page.getByTestId("persistence-status")).toHaveAttribute("data-status", "saved");
  await expect(generationBadge).toHaveText(`Generation ${savedGeneration + 15}`);
  await expect(page.getByTestId("world-map")).toHaveAttribute("data-live-generation", String(savedGeneration + 15));
  const storedAfterCatchUp = await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "{}"), storageKey);
  expect(storedAfterCatchUp.world.generation).toBe(savedGeneration + 15);
  expect(storedAfterCatchUp.snapshots.length).toBeLessThanOrEqual(2);
  expect(JSON.stringify(storedAfterCatchUp).length).toBeLessThan(3_900_000);

  await page.getByRole("button", { name: "Clear save" }).click({ timeout: 2_000 });
  await expect(page.getByTestId("persistence-status")).toHaveAttribute("data-status", "cleared");
  await expect(page.getByTestId("persistence-status")).toHaveAttribute("data-autosave", "paused");
  expect(await page.evaluate((key) => window.localStorage.getItem(key), storageKey)).toBeNull();
});

test("recovers visibly from corrupt local persistence", async ({ page }) => {
  await page.addInitScript(
    ({ key }) => {
      window.localStorage.setItem(key, "{not-json");
    },
    { key: storageKey }
  );

  await page.goto("/");
  await page.getByRole("button", { name: "Pause" }).click({ timeout: 2_000 });

  await expect(page.getByTestId("display-generation")).toHaveText("Generation 0");
  await expect(page.getByTestId("persistence-status")).toHaveAttribute("data-status", "invalid");
  expect(await page.evaluate((key) => window.localStorage.getItem(key), storageKey)).toBe("{not-json");

  await page.getByRole("button", { name: "Clear save" }).click({ timeout: 2_000 });
  await expect(page.getByTestId("persistence-status")).toHaveAttribute("data-status", "cleared");
  expect(await page.evaluate((key) => window.localStorage.getItem(key), storageKey)).toBeNull();
});
