import { describe, expect, it } from "vitest";
import { createWorld, runWorld, stepWorld } from "./world";

function signature(seed: string, generations: number) {
  const world = runWorld(seed, generations, { width: 22, height: 14, initialPopulation: 70 });
  const latest = world.summaries.at(-1)!;
  return {
    generation: latest.generation,
    population: latest.population,
    species: latest.species,
    births: latest.births,
    deaths: latest.deaths,
    food: latest.averageFood,
    disease: latest.averageDisease,
    predatorPressure: latest.averagePredatorPressure,
    dominantTrait: latest.dominantTrait,
    firstSpecies: world.species[0]?.id,
    firstCreature: world.creatures[0]
      ? {
          x: world.creatures[0].x,
          y: world.creatures[0].y,
          lineage: world.creatures[0].lineageId,
          energy: world.creatures[0].energy
        }
      : undefined
  };
}

describe("deterministic world simulation", () => {
  it("replays the same seed into the same ecological summary", () => {
    expect(signature("mythic-lagoon-17", 36)).toEqual(signature("mythic-lagoon-17", 36));
  });

  it("lets different seeds create different evolutionary histories", () => {
    expect(signature("mythic-lagoon-17", 42)).not.toEqual(signature("glass-drought-41", 42));
  });

  it("derives births, deaths, and terrain pressure from real state transitions", () => {
    let world = createWorld("pressure-check", { width: 20, height: 12, initialPopulation: 64 });
    const initialFood = world.summaries.at(-1)!.averageFood;

    for (let index = 0; index < 24; index += 1) {
      world = stepWorld(world);
    }

    const latest = world.summaries.at(-1)!;
    const totalBirths = world.summaries.reduce((sum, summary) => sum + summary.births, 0);
    const totalDeaths = world.summaries.reduce((sum, summary) => sum + summary.deaths, 0);

    expect(latest.generation).toBe(24);
    expect(totalBirths + totalDeaths).toBeGreaterThan(0);
    expect(latest.averageFood).not.toBe(initialFood);
    expect(world.creatures.every((creature) => creature.speciesId.length > 0)).toBe(true);
  });

  it("records causal birth events with ancestry and lineage references", () => {
    let world = createWorld("lineage-ledger", { width: 24, height: 14, initialPopulation: 90 });

    for (let index = 0; index < 80; index += 1) {
      world = stepWorld(world);
    }

    const birthEvent = world.events.find((event) => event.kind === "birth");
    const child = world.creatures.find((creature) => creature.parentIds.length > 0);

    expect(birthEvent?.creatureId).toBeTruthy();
    expect(birthEvent?.lineageId).toBeTruthy();
    expect(birthEvent?.parentIds?.length).toBe(2);
    expect(child?.ancestorIds.length).toBeGreaterThan(0);
  });

  it("keeps living agents moving in a long-running demo world", () => {
    let world = createWorld("mythic-lagoon-17");

    for (let index = 0; index < 450; index += 1) {
      world = stepWorld(world);
    }

    const before = new Map(world.creatures.map((creature) => [creature.id, `${creature.x},${creature.y}`]));

    for (let index = 0; index < 12; index += 1) {
      world = stepWorld(world);
    }

    const survivors = world.creatures.filter((creature) => before.has(creature.id));
    const moved = survivors.filter((creature) => before.get(creature.id) !== `${creature.x},${creature.y}`);

    expect(world.creatures.length).toBeGreaterThan(100);
    expect(moved.length / Math.max(1, survivors.length)).toBeGreaterThan(0.5);
  });
});
