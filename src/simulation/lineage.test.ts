import { describe, expect, it } from "vitest";
import { buildLineageAtlas } from "./lineage";
import { runWorld } from "./world";

describe("lineage atlas", () => {
  it("ranks durable dynasties from living and graveyard state", () => {
    const world = runWorld("mythic-lagoon-17", 140, { width: 24, height: 14, initialPopulation: 80 });
    const atlas = buildLineageAtlas(world, { limit: 6 });

    expect(atlas.length).toBe(6);
    expect(atlas[0].living).toBeGreaterThan(0);
    expect(atlas[0].total).toBe(atlas[0].living + atlas[0].dead);
    expect(atlas[0].speciesCount).toBeGreaterThan(0);
    expect(atlas[0].dominantTrait).toBeTruthy();
    expect(atlas[0].survivalScore).toBeGreaterThanOrEqual(atlas[1].survivalScore);
    expect(atlas.some((entry) => entry.dead > 0 || entry.mutationCount > 0 || entry.speciesCount > 1)).toBe(true);
  });

  it("links surviving lineages to living representative creatures", () => {
    const world = runWorld("glass-drought-41", 120, { width: 24, height: 14, initialPopulation: 80 });
    const atlas = buildLineageAtlas(world, { limit: 10 });
    const surviving = atlas.find((entry) => entry.status === "surviving")!;

    expect(surviving.representativeCreatureId).toBeTruthy();
    expect(world.creatures.some((creature) => creature.id === surviving.representativeCreatureId)).toBe(true);
  });
});
