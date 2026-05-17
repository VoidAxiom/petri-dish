import { describe, expect, it } from "vitest";
import {
  clearPersistedRun,
  createPersistedRunPayload,
  loadPersistedRun,
  persistedRunSchema,
  persistedRunVersion,
  savePersistedRun
} from "./persistence";
import { buildGenerationSnapshots, snapshotSignature } from "./snapshots";
import { runWorld, stepWorld } from "./world";

const config = { width: 24, height: 14, initialPopulation: 80 };

describe("persisted runs", () => {
  it("round-trips a deterministic world, snapshots, and selection metadata", () => {
    const world = runWorld("mythic-lagoon-17", 80, config);
    const snapshots = buildGenerationSnapshots("mythic-lagoon-17", 80, config, 20);
    const selectedCreatureId = world.creatures[4]?.id;
    const storage = new MemoryStorage();

    const saveResult = savePersistedRun(storage, {
      world,
      snapshots,
      selectedCreatureId,
      replayGeneration: 60,
      savedAt: "2026-05-17T01:00:00.000Z"
    });

    expect(saveResult.status).toBe("saved");
    if (saveResult.status !== "saved") return;
    expect(saveResult.bytes).toBeGreaterThan(1000);

    const loadResult = loadPersistedRun(storage);

    expect(loadResult.status).toBe("loaded");
    if (loadResult.status !== "loaded") return;
    expect(loadResult.bytes).toBe(saveResult.bytes);
    expect(loadResult.payload.schema).toBe(persistedRunSchema);
    expect(loadResult.payload.version).toBe(persistedRunVersion);
    expect(loadResult.payload.savedAt).toBe("2026-05-17T01:00:00.000Z");
    expect(loadResult.payload.selectedCreatureId).toBe(selectedCreatureId);
    expect(loadResult.payload.replayGeneration).toBe(60);
    expect(loadResult.payload.metadata).toEqual({
      seed: world.seed,
      generation: world.generation,
      population: world.creatures.length,
      species: world.species.length,
      snapshots: snapshots.length
    });
    expect(snapshotSignature(loadResult.payload.world)).toEqual(snapshotSignature(world));
    expect(loadResult.payload.snapshots.map((snapshot) => snapshot.generation)).toEqual([0, 20, 40, 60, 80]);
    expect(JSON.stringify(loadResult.payload)).toContain("mythic-lagoon-17");
  });

  it("continues deterministically after loading a saved world", () => {
    const world = runWorld("glass-drought-41", 96, config);
    const snapshots = buildGenerationSnapshots("glass-drought-41", 96, config, 24);
    const storage = new MemoryStorage();

    savePersistedRun(storage, { world, snapshots, savedAt: "2026-05-17T01:00:00.000Z" });
    const loadResult = loadPersistedRun(storage);

    expect(loadResult.status).toBe("loaded");
    if (loadResult.status !== "loaded") return;
    expect(snapshotSignature(stepWorld(loadResult.payload.world))).toEqual(snapshotSignature(stepWorld(world)));
  });

  it("reports missing and clears saved runs without throwing", () => {
    const storage = new MemoryStorage();

    expect(loadPersistedRun(storage)).toEqual({ status: "missing", key: "petri-dish:persisted-run:v1" });
    expect(clearPersistedRun(storage)).toEqual({ status: "cleared", key: "petri-dish:persisted-run:v1" });
  });

  it("rejects malformed JSON and unsupported schema versions", () => {
    const storage = new MemoryStorage();

    storage.setItem("petri-dish:persisted-run:v1", "{not-json");
    expect(loadPersistedRun(storage)).toMatchObject({ status: "invalid", reason: "invalid-json" });

    storage.setItem(
      "petri-dish:persisted-run:v1",
      JSON.stringify({ schema: "petri-dish.persisted-run", version: 999, savedAt: "2026-05-17T01:00:00.000Z" })
    );
    expect(loadPersistedRun(storage)).toMatchObject({ status: "unsupported", reason: "unsupported-schema-version", version: 999 });
  });

  it("rejects corrupt world fields, genomes, and snapshot counters", () => {
    const world = runWorld("ember-reef-93", 40, config);
    const snapshots = buildGenerationSnapshots("ember-reef-93", 40, config, 20);
    const storage = new MemoryStorage();
    const payload = createPersistedRunPayload({ world, snapshots, savedAt: "2026-05-17T01:00:00.000Z" });

    storage.setItem("petri-dish:persisted-run:v1", JSON.stringify({ ...payload, world: { ...payload.world, cells: undefined } }));
    expect(loadPersistedRun(storage)).toMatchObject({ status: "invalid", reason: "payload-shape-invalid" });

    const worldWithBadGenome = {
      ...payload.world,
      creatures: payload.world.creatures.map((creature, index) =>
        index === 0 ? { ...creature, genome: { ...creature.genome, speed: "fast" } } : creature
      )
    };
    storage.setItem("petri-dish:persisted-run:v1", JSON.stringify({ ...payload, world: worldWithBadGenome }));
    expect(loadPersistedRun(storage)).toMatchObject({ status: "invalid", reason: "payload-shape-invalid" });

    const snapshotsWithBadPopulation = payload.snapshots.map((snapshot, index) =>
      index === 1 ? { ...snapshot, population: snapshot.population + 1 } : snapshot
    );
    storage.setItem("petri-dish:persisted-run:v1", JSON.stringify({ ...payload, snapshots: snapshotsWithBadPopulation }));
    expect(loadPersistedRun(storage)).toMatchObject({ status: "invalid", reason: "payload-shape-invalid" });

    const snapshotsWithWrongSeed = payload.snapshots.map((snapshot, index) => (index === 1 ? { ...snapshot, seed: "other-seed" } : snapshot));
    storage.setItem("petri-dish:persisted-run:v1", JSON.stringify({ ...payload, snapshots: snapshotsWithWrongSeed }));
    expect(loadPersistedRun(storage)).toMatchObject({ status: "invalid", reason: "payload-shape-invalid" });
  });

  it("does not save inconsistent snapshot sets", () => {
    const world = runWorld("mythic-lagoon-17", 40, config);
    const snapshots = buildGenerationSnapshots("glass-drought-41", 40, config, 20);

    expect(savePersistedRun(new MemoryStorage(), { world, snapshots })).toMatchObject({ status: "error", reason: "payload-shape-invalid" });
  });

  it("returns explicit statuses when storage operations fail", () => {
    const world = runWorld("mythic-lagoon-17", 10, config);
    const snapshots = buildGenerationSnapshots("mythic-lagoon-17", 10, config, 10);

    expect(loadPersistedRun(new ThrowingStorage("read"))).toMatchObject({ status: "unavailable", reason: "storage-read-failed" });
    expect(savePersistedRun(new ThrowingStorage("write"), { world, snapshots })).toMatchObject({
      status: "error",
      reason: "storage-write-failed"
    });
    expect(clearPersistedRun(new ThrowingStorage("clear"))).toMatchObject({ status: "error", reason: "storage-clear-failed" });
  });

  it("clones payload data so later mutations do not leak into saved state", () => {
    const world = runWorld("glass-drought-41", 20, config);
    const snapshots = buildGenerationSnapshots("glass-drought-41", 20, config, 10);
    const payload = createPersistedRunPayload({ world, snapshots, savedAt: "2026-05-17T01:00:00.000Z" });
    const originalSignature = snapshotSignature(payload.world);

    world.creatures[0].energy = 0;
    snapshots[0].world.creatures[0].energy = 0;

    expect(snapshotSignature(payload.world)).toEqual(originalSignature);
    expect(payload.snapshots[0].world.creatures[0].energy).not.toBe(0);
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

class ThrowingStorage extends MemoryStorage {
  constructor(private readonly operation: "read" | "write" | "clear") {
    super();
  }

  override getItem(key: string): string | null {
    if (this.operation === "read") {
      throw new Error("storage unavailable");
    }
    return super.getItem(key);
  }

  override setItem(key: string, value: string): void {
    if (this.operation === "write") {
      throw new Error("quota exceeded");
    }
    super.setItem(key, value);
  }

  override removeItem(key: string): void {
    if (this.operation === "clear") {
      throw new Error("storage unavailable");
    }
    super.removeItem(key);
  }
}
