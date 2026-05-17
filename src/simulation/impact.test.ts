import { describe, expect, it } from "vitest";
import { buildEventImpactReports } from "./impact";
import { runWorld } from "./world";

describe("event impact reports", () => {
  it("derives catastrophe impact from real before and after generation summaries", () => {
    const world = runWorld("mythic-lagoon-17", 130, { width: 24, height: 14, initialPopulation: 80 });
    const impacts = buildEventImpactReports(world);
    const catastrophe = impacts.find((impact) => impact.kind === "catastrophe");

    expect(catastrophe).toBeTruthy();
    expect(catastrophe?.generation).toBe(90);
    expect(catastrophe?.beforeGeneration).toBeLessThan(catastrophe?.generation ?? 0);
    expect(catastrophe?.afterGeneration).toBeGreaterThan(catastrophe?.generation ?? 0);
    expect(catastrophe?.windowBirths).toBeGreaterThanOrEqual(0);
    expect(catastrophe?.windowDeaths).toBeGreaterThanOrEqual(0);
    expect(catastrophe?.headline.length).toBeGreaterThan(12);

    const before = world.summaries.find((summary) => summary.generation === catastrophe?.beforeGeneration)!;
    const after = world.summaries.find((summary) => summary.generation === catastrophe?.afterGeneration)!;
    const population = catastrophe?.metrics.find((metric) => metric.key === "population");

    expect(population?.before).toBe(before.population);
    expect(population?.after).toBe(after.population);
    expect(population?.delta).toBe(after.population - before.population);
  });

  it("groups extinction aftermath into measurable shock windows", () => {
    const world = runWorld("glass-drought-41", 180, { width: 28, height: 16, initialPopulation: 90 });
    const impacts = buildEventImpactReports(world);
    const extinction = impacts.find((impact) => impact.kind === "extinction");
    const expectedWindowExtinctions = [
      ...new Set(
        world.events
          .filter(
            (event) =>
              event.kind === "extinction" &&
              event.generation > (extinction?.beforeGeneration ?? 0) &&
              event.generation <= (extinction?.afterGeneration ?? 0)
          )
          .map((event) => event.speciesId)
          .filter((id): id is string => Boolean(id))
      )
    ];

    expect(extinction).toBeTruthy();
    expect(extinction?.extinctionCount).toBeGreaterThan(0);
    expect(extinction?.extinctions.length).toBe(extinction?.extinctionCount);
    expect(extinction?.extinctions).toEqual(expectedWindowExtinctions);
    expect(extinction?.metrics.some((metric) => metric.delta !== 0)).toBe(true);
  });
});
