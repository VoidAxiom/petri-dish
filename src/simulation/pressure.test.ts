import { describe, expect, it } from "vitest";
import { explainCreaturePressure, pressureCostsFor } from "./pressure";
import type { Creature, Genome, TerrainCell, WorldEvent } from "./types";

const genome: Genome = {
  speed: 0.5,
  vision: 0.5,
  metabolism: 0.5,
  fertility: 0.72,
  aggression: 0.4,
  sociality: 0.5,
  foraging: 0.62,
  immunity: 0.5,
  heatTolerance: 0.55,
  coldTolerance: 0.55,
  predatorSense: 0.45,
  migrationDrive: 0.42,
  mutationRate: 0.02
};

function creature(overrides: Partial<Creature> = {}): Creature {
  return {
    id: "c-test",
    name: "Test-42",
    x: 0,
    y: 0,
    age: 8,
    energy: 1.05,
    generation: 0,
    genome: { ...genome },
    speciesId: "sun-grazer-2-1",
    lineageId: "l-test",
    parentIds: [],
    ancestorIds: [],
    mutations: [],
    births: 0,
    kills: 0,
    fitness: 0,
    ...overrides
  };
}

function cell(overrides: Partial<TerrainCell> = {}): TerrainCell {
  return {
    x: 0,
    y: 0,
    biome: "steppe",
    elevation: 0.4,
    moisture: 0.4,
    fertility: 0.55,
    food: 0.7,
    disease: 0.12,
    predatorPressure: 0.15,
    temperature: 0.55,
    ...overrides
  };
}

describe("creature pressure explanations", () => {
  it("identifies disease as the primary risk when infection outruns immunity", () => {
    const report = explainCreaturePressure(creature({ energy: 1.2, genome: { ...genome, immunity: 0.08 } }), cell({ disease: 0.96 }), undefined, 120);

    expect(report.primaryRisk).toBe("disease");
    expect(report.metrics.find((metric) => metric.kind === "disease")?.value).toBeGreaterThan(0.8);
    expect(report.estimatedFitness).toBeLessThan(0.8);
  });

  it("uses the same event cost inputs exposed to the world stress step", () => {
    const ashfall: WorldEvent = {
      kind: "ashfall",
      name: "Black Sun Ashfall",
      severity: 0.8,
      remaining: 12,
      startedAt: 90
    };
    const lowMigration = pressureCostsFor(creature({ genome: { ...genome, migrationDrive: 0.1 } }), cell(), ashfall);
    const highMigration = pressureCostsFor(creature({ genome: { ...genome, migrationDrive: 0.9 } }), cell(), ashfall);

    expect(lowMigration.event).toBeGreaterThan(highMigration.event);
    expect(lowMigration.total).toBeGreaterThan(highMigration.total);
  });

  it("reports reproduction readiness from real age, energy, fertility, and crowding gates", () => {
    const ready = explainCreaturePressure(creature({ age: 9, energy: 1.1, genome: { ...genome, fertility: 0.8 } }), cell(), undefined, 120);
    const juvenile = explainCreaturePressure(creature({ age: 1, energy: 0.4, genome: { ...genome, fertility: 0.2 } }), cell(), undefined, 690);

    expect(ready.reproductionReadiness).toBeGreaterThan(juvenile.reproductionReadiness);
    expect(juvenile.reproductionBlockers).toContain("juvenile");
    expect(juvenile.reproductionBlockers).toContain("needs more energy");
  });
});
