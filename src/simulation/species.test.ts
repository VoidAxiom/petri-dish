import { describe, expect, it } from "vitest";
import { buildSpeciesSummaries } from "./species";
import type { Creature, Genome, TerrainCell } from "./types";

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
  mutationRate: 0.02
};

function cell(x: number, y: number, biome: TerrainCell["biome"]): TerrainCell {
  return {
    x,
    y,
    biome,
    elevation: 0.5,
    moisture: 0.5,
    fertility: 0.5,
    food: 0.5,
    disease: 0,
    predatorPressure: 0,
    temperature: 0.5
  };
}

function creature(id: string, x: number, y: number): Creature {
  return {
    id,
    name: id,
    x,
    y,
    age: 1,
    energy: 1,
    generation: 0,
    genome,
    speciesId: "test-species",
    lineageId: id,
    parentIds: [],
    ancestorIds: [],
    mutations: [],
    births: 0,
    kills: 0,
    fitness: 0
  };
}

describe("species summaries", () => {
  it("uses explicit world width when locating member biomes", () => {
    const width = 3;
    const cells = [
      cell(0, 0, "steppe"),
      cell(1, 0, "steppe"),
      cell(2, 0, "steppe"),
      cell(0, 1, "reef"),
      cell(1, 1, "reef"),
      cell(2, 1, "basalt")
    ];

    const summaries = buildSpeciesSummaries([creature("a", 0, 1), creature("b", 1, 1), creature("c", 2, 1)], cells, width, []);

    expect(summaries[0].dominantBiome).toBe("reef");
  });
});
