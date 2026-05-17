import { describe, expect, it } from "vitest";
import { buildLineageAtlas, selectLineageRepresentative } from "./lineage";
import { runWorld } from "./world";
import type { Creature, Genome } from "./types";

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

  it("selects representatives from the provided current living set", () => {
    const currentParent = creature({ id: "current-parent", lineageId: "l-7", fitness: 0.76, births: 4 });
    const staleParent = creature({ id: "stale-parent", lineageId: "l-7", fitness: 0.95, births: 0 });
    const otherLineage = creature({ id: "other", lineageId: "l-9", fitness: 1, births: 8 });

    expect(selectLineageRepresentative([staleParent, currentParent, otherLineage], "l-7")?.id).toBe("current-parent");
    expect(selectLineageRepresentative([otherLineage], "l-7")).toBeUndefined();
  });
});

const genome: Genome = {
  speed: 0.5,
  vision: 0.5,
  metabolism: 0.5,
  fertility: 0.5,
  aggression: 0.5,
  sociality: 0.5,
  foraging: 0.5,
  immunity: 0.5,
  heatTolerance: 0.5,
  coldTolerance: 0.5,
  predatorSense: 0.5,
  migrationDrive: 0.5,
  mutationRate: 0.05
};

function creature(overrides: Partial<Creature>): Creature {
  return {
    id: "creature",
    name: "Test",
    x: 0,
    y: 0,
    age: 4,
    energy: 0.8,
    generation: 0,
    genome,
    speciesId: "species",
    lineageId: "lineage",
    parentIds: [],
    ancestorIds: [],
    mutations: [],
    births: 0,
    kills: 0,
    fitness: 0.5,
    ...overrides
  };
}
