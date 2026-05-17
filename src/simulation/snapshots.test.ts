import { describe, expect, it } from "vitest";
import { buildGenerationSnapshots, createGenerationSnapshot, snapshotSignature, snapshotWorld } from "./snapshots";
import { runWorld } from "./world";

describe("generation snapshots", () => {
  it("captures deterministic world checkpoints instead of summary-only placeholders", () => {
    const snapshots = buildGenerationSnapshots("mythic-lagoon-17", 60, { width: 22, height: 14, initialPopulation: 70 }, 10);

    expect(snapshots.map((snapshot) => snapshot.generation)).toEqual([0, 10, 20, 30, 40, 50, 60]);
    expect(snapshots[3].summary.generation).toBe(30);
    expect(snapshots[3].population).toBe(snapshots[3].world.creatures.length);
    expect(snapshots[3].summary.population).toBe(snapshots[3].world.creatures.length);
    expect(snapshots[3].speciesCount).toBe(snapshots[3].world.species.length);

    const replayed = runWorld("mythic-lagoon-17", 30, { width: 22, height: 14, initialPopulation: 70 });
    expect(snapshotSignature(snapshots[3].world)).toEqual(snapshotSignature(replayed));
  });

  it("returns deep cloned snapshot worlds that cannot mutate live state", () => {
    const live = runWorld("snapshot-isolation", 32, { width: 20, height: 12, initialPopulation: 72 });
    const before = snapshotSignature(live);
    const snapshot = createGenerationSnapshot(live);
    const cloned = snapshotWorld(snapshot);

    cloned.creatures[0].energy = -999;
    cloned.cells[0].food = -999;
    cloned.species[0].averageGenome.speed = -999;
    if (cloned.events[0]) {
      cloned.events[0].message = "corrupted";
    }

    expect(snapshotSignature(live)).toEqual(before);
    expect(snapshot.world.creatures[0].energy).not.toBe(-999);
    expect(snapshot.world.cells[0].food).not.toBe(-999);
  });
});
