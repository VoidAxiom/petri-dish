import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const storageKey = "petri-dish:persisted-run:v1";
const manifestKey = "petri-dish:persisted-run:manifest:v1";

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
  await expect(page.getByTestId("persistence-status")).toHaveAttribute("data-backend", "indexeddb");
  expect(Number(await page.getByTestId("persistence-status").getAttribute("data-bytes"))).toBeLessThan(3_700_000);
  const savedGeneration = Number(await page.getByTestId("persistence-status").getAttribute("data-generation"));
  expect(savedGeneration).toBe(50);

  const storedBeforeReload = await readIndexedDbRun(page);
  expect(storedBeforeReload.world.generation).toBe(50);
  expect(storedBeforeReload.snapshots.length).toBeLessThanOrEqual(2);
  expect(await page.evaluate((key) => window.localStorage.getItem(key), storageKey)).toBeNull();
  expect(await page.evaluate((key) => window.localStorage.getItem(key), manifestKey)).toContain('"backend":"indexeddb"');
  await page.evaluate(async () => {
    const requestToPromise = <T,>(request: IDBRequest<T>) =>
      new Promise<T>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("petri-dish", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const record = await requestToPromise(database.transaction("persisted-runs", "readonly").objectStore("persisted-runs").get("default-run"));
    const payload = record.payload;
    payload.savedAt = new Date(Date.now() - 15 * 60_000).toISOString();
    await requestToPromise(
      database.transaction("persisted-runs", "readwrite").objectStore("persisted-runs").put({
        id: "default-run",
        schema: "petri-dish.persisted-run-manifest",
        version: 1,
        savedAt: payload.savedAt,
        bytes: JSON.stringify(payload).length,
        payload
      })
    );
    database.close();
  });

  await page.reload();
  await page.getByRole("button", { name: "Pause" }).click({ timeout: 2_000 });
  await expect(page.getByTestId("persistence-status")).toHaveAttribute("data-generation", String(savedGeneration + 15));
  await expect(page.getByTestId("persistence-status")).toHaveAttribute("data-catch-up-generations", "15");
  await expect(page.getByTestId("persistence-status")).toHaveAttribute("data-status", "saved");
  await expect(page.getByTestId("persistence-status")).toHaveAttribute("data-backend", "indexeddb");
  await expect(generationBadge).toHaveText(`Generation ${savedGeneration + 15}`);
  await expect(page.getByTestId("world-map")).toHaveAttribute("data-live-generation", String(savedGeneration + 15));
  const storedAfterCatchUp = await readIndexedDbRun(page);
  expect(storedAfterCatchUp.world.generation).toBe(savedGeneration + 15);
  expect(storedAfterCatchUp.snapshots.length).toBeLessThanOrEqual(2);
  expect(JSON.stringify(storedAfterCatchUp).length).toBeLessThan(3_900_000);

  await page.getByRole("button", { name: "Clear save" }).click({ timeout: 2_000 });
  await expect(page.getByTestId("persistence-status")).toHaveAttribute("data-status", "cleared");
  await expect(page.getByTestId("persistence-status")).toHaveAttribute("data-autosave", "paused");
  expect(await page.evaluate((key) => window.localStorage.getItem(key), storageKey)).toBeNull();
  expect(await readIndexedDbRun(page)).toBeNull();
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

async function readIndexedDbRun(page: Page) {
  return page.evaluate(async () => {
    const requestToPromise = <T,>(request: IDBRequest<T>) =>
      new Promise<T>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("petri-dish", 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains("persisted-runs")) {
          database.createObjectStore("persisted-runs", { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const record = await requestToPromise(database.transaction("persisted-runs", "readonly").objectStore("persisted-runs").get("default-run"));
    const payload = record?.payload ?? null;
    database.close();
    return payload;
  });
}
