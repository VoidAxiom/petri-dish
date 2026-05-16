import { clamp, round } from "./rng";
import type { Creature, Genome, TerrainCell, WorldEvent } from "./types";

export type PressureKind = "hunger" | "disease" | "predation" | "climate" | "catastrophe" | "reproduction";

export interface PressureCosts {
  metabolic: number;
  climate: number;
  disease: number;
  predator: number;
  event: number;
  total: number;
}

export interface CreaturePressureMetric {
  kind: PressureKind;
  label: string;
  value: number;
  detail: string;
  trait: keyof Genome;
  traitValue: number;
}

export interface CreaturePressureReport {
  costs: PressureCosts;
  projectedEnergy: number;
  estimatedFitness: number;
  primaryRisk: Exclude<PressureKind, "reproduction">;
  reproductionReadiness: number;
  reproductionBlockers: string[];
  metrics: CreaturePressureMetric[];
}

export function explainCreaturePressure(
  creature: Creature,
  cell: TerrainCell,
  event: WorldEvent | undefined,
  population: number
): CreaturePressureReport {
  const costs = pressureCostsFor(creature, cell, event);
  const projectedEnergy = round(creature.energy - costs.total);
  const diseaseLethality = diseaseLethalityFor(creature, cell);
  const predatorLethality = predatorLethalityFor(creature, cell);
  const mismatch = climateMismatch(creature.genome, cell);
  const reproduction = reproductionStateFor(creature, population);
  const hungerRisk = clamp(1 - projectedEnergy / 0.78);
  const diseaseRisk = clamp(Math.max(0, cell.disease - creature.genome.immunity * 0.65) * 0.9 + diseaseLethality * 2.2);
  const predatorRisk = clamp(
    Math.max(0, cell.predatorPressure - creature.genome.predatorSense * 0.7 - creature.genome.aggression * 0.18) * 0.9 +
      predatorLethality * 2.2
  );
  const climateRisk = clamp(mismatch * 1.35);
  const eventRisk = clamp(costs.event * 9);

  const riskCandidates = [
    ["hunger", hungerRisk],
    ["disease", diseaseRisk],
    ["predation", predatorRisk],
    ["climate", climateRisk],
    ["catastrophe", eventRisk]
  ] as Array<[CreaturePressureReport["primaryRisk"], number]>;
  const primaryRisk = riskCandidates.sort((a, b) => b[1] - a[1])[0][0];

  return {
    costs,
    projectedEnergy,
    estimatedFitness: calculateCreatureFitness(creature, cell),
    primaryRisk,
    reproductionReadiness: reproduction.readiness,
    reproductionBlockers: reproduction.blockers,
    metrics: [
      {
        kind: "hunger",
        label: "Hunger",
        value: round(hungerRisk),
        detail: `energy ${creature.energy.toFixed(2)} -> ${projectedEnergy.toFixed(2)} after ${round(costs.total).toFixed(2)} stress`,
        trait: "foraging",
        traitValue: creature.genome.foraging
      },
      {
        kind: "disease",
        label: "Disease",
        value: round(diseaseRisk),
        detail: `cell ${cell.disease.toFixed(2)} against immunity ${creature.genome.immunity.toFixed(2)}`,
        trait: "immunity",
        traitValue: creature.genome.immunity
      },
      {
        kind: "predation",
        label: "Predation",
        value: round(predatorRisk),
        detail: `pressure ${cell.predatorPressure.toFixed(2)} against sense ${creature.genome.predatorSense.toFixed(2)}`,
        trait: "predatorSense",
        traitValue: creature.genome.predatorSense
      },
      {
        kind: "climate",
        label: "Climate",
        value: round(climateRisk),
        detail: `temperature ${cell.temperature.toFixed(2)}, mismatch ${mismatch.toFixed(2)}`,
        trait: cell.temperature > 0.58 ? "heatTolerance" : "coldTolerance",
        traitValue: cell.temperature > 0.58 ? creature.genome.heatTolerance : creature.genome.coldTolerance
      },
      {
        kind: "catastrophe",
        label: "Event",
        value: round(eventRisk),
        detail: event ? `${event.name} severity ${event.severity.toFixed(2)} for ${event.remaining} generations` : "no active catastrophe",
        trait: "migrationDrive",
        traitValue: creature.genome.migrationDrive
      },
      {
        kind: "reproduction",
        label: "Reproduction readiness",
        value: reproduction.readiness,
        detail: reproduction.blockers.length ? reproduction.blockers.join(", ") : "ready if a compatible mate is nearby",
        trait: "fertility",
        traitValue: creature.genome.fertility
      }
    ]
  };
}

export function pressureCostsFor(creature: Creature, cell: TerrainCell, event?: WorldEvent): PressureCosts {
  const metabolic = 0.034 + creature.genome.metabolism * 0.045 + creature.genome.speed * 0.01;
  const climate = climateMismatch(creature.genome, cell) * 0.038;
  const disease = Math.max(0, cell.disease - creature.genome.immunity * 0.65) * 0.055;
  const predator = Math.max(0, cell.predatorPressure - creature.genome.predatorSense * 0.7 - creature.genome.aggression * 0.18) * 0.045;
  const eventCost = eventStressCostFor(creature, event);

  return {
    metabolic,
    climate,
    disease,
    predator,
    event: eventCost,
    total: metabolic + climate + disease + predator + eventCost
  };
}

export function eventStressCostFor(creature: Creature, event?: WorldEvent): number {
  if (event?.kind === "ashfall") {
    return event.severity * (0.035 - creature.genome.migrationDrive * 0.014);
  }

  if (event?.kind === "drought") {
    return event.severity * (0.028 - creature.genome.foraging * 0.01);
  }

  return 0;
}

export function climateMismatch(genome: Genome, cell: TerrainCell): number {
  if (cell.temperature > 0.58) {
    return Math.max(0, cell.temperature - genome.heatTolerance);
  }
  return Math.max(0, 1 - cell.temperature - genome.coldTolerance);
}

export function diseaseLethalityFor(creature: Creature, cell: TerrainCell): number {
  return cell.disease > creature.genome.immunity + 0.24 ? (cell.disease - creature.genome.immunity) * 0.22 : 0;
}

export function predatorLethalityFor(creature: Creature, cell: TerrainCell): number {
  return cell.predatorPressure > creature.genome.predatorSense + creature.genome.aggression * 0.35
    ? (cell.predatorPressure - creature.genome.predatorSense) * 0.18
    : 0;
}

export function calculateCreatureFitness(creature: Creature, cell: TerrainCell): number {
  const youth = Math.max(0, 1 - creature.age / 95);
  const survival = creature.energy * 0.5 + creature.births * 0.18 + youth * 0.1;
  const adaptation =
    1 -
    climateMismatch(creature.genome, cell) -
    cell.disease * (1 - creature.genome.immunity) * 0.25 -
    cell.predatorPressure * (1 - creature.genome.predatorSense) * 0.2;
  return round(clamp(survival * 0.62 + adaptation * 0.38));
}

function reproductionStateFor(creature: Creature, population: number): { readiness: number; blockers: string[] } {
  const crowding = clamp(population / 720);
  const carryingRoom = clamp(1 - crowding * 0.72);
  const energyScore = clamp(creature.energy / 0.78);
  const ageScore = clamp(creature.age / 4);
  const readiness = round(clamp(energyScore * 0.38 + ageScore * 0.18 + creature.genome.fertility * 0.28 + carryingRoom * 0.16));
  const blockers: string[] = [];

  if (creature.energy < 0.78) blockers.push("needs more energy");
  if (creature.age < 4) blockers.push("juvenile");
  if (creature.genome.fertility < 0.34) blockers.push("low fertility");
  if (carryingRoom < 0.35) blockers.push("crowded biome");

  return { readiness, blockers };
}
