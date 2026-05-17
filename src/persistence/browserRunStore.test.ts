import { describe, expect, it } from "vitest";
import { createBrowserPersistedRunStore } from "./browserRunStore";
import { buildGenerationSnapshots, defaultPersistedRunKey, runWorld, snapshotSignature, stepWorld } from "../simulation";

const config = { width: 24, height: 14, initialPopulation: 80 };

describe("browser persisted run store", () => {
  it("falls back to localStorage-compatible storage without changing deterministic payloads", async () => {
    const storage = new MemoryStorage();
    const store = createBrowserPersistedRunStore({ localStorage: storage })!;
    const world = runWorld("mythic-lagoon-17", 30, config);
    const snapshots = buildGenerationSnapshots("mythic-lagoon-17", 30, config, 15);

    const save = await store.save({ world, snapshots, savedAt: "2026-05-17T02:00:00.000Z" });
    const load = await store.load();

    expect(save).toMatchObject({ status: "saved", backend: "local-storage" });
    expect(load).toMatchObject({ status: "loaded", backend: "local-storage" });
    if (load.status !== "loaded") throw new Error("expected loaded run");
    expect(snapshotSignature(stepWorld(load.payload.world))).toEqual(snapshotSignature(stepWorld(world)));
  });

  it("keeps corrupt localStorage payloads visible until clear", async () => {
    const storage = new MemoryStorage();
    storage.setItem(defaultPersistedRunKey, "{not-json");
    const store = createBrowserPersistedRunStore({ localStorage: storage })!;

    expect(await store.load()).toMatchObject({ status: "invalid", reason: "invalid-json", backend: "local-storage" });
    expect(storage.getItem(defaultPersistedRunKey)).toBe("{not-json");

    expect(await store.clear()).toMatchObject({ status: "cleared" });
    expect(storage.getItem(defaultPersistedRunKey)).toBeNull();
  });
});

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}
