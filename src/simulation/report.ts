import { genomeKeys } from "./species";
import { createWorld, stepWorld } from "./world";
import type { Genome, GenerationSummary, SimulationEvent, SimulationEventKind, SpeciesSummary, WorldOptions } from "./types";

export interface SimulationReportOptions extends WorldOptions {
  seed: string;
  generations: number;
  maxEvents?: number;
}

export interface SimulationReport {
  config: Required<Pick<SimulationReportOptions, "seed" | "generations">> & Required<WorldOptions>;
  signature: string;
  final: {
    generation: number;
    population: number;
    species: number;
    averageFitness: number;
    diversity: number;
    dominantTrait: keyof Genome;
  };
  totals: {
    births: number;
    deaths: number;
    mutations: number;
    extinctions: number;
    catastrophes: number;
  };
  pressure: {
    foodDelta: number;
    finalFood: number;
    finalDisease: number;
    finalPredatorPressure: number;
  };
  eventCounts: Record<SimulationEventKind, number>;
  populationCurve: Array<Pick<GenerationSummary, "generation" | "population" | "species" | "births" | "deaths" | "diversity">>;
  traitDrift: {
    firstDominantTrait: keyof Genome;
    finalDominantTrait: keyof Genome;
    finalAverageGenome: Genome;
  };
  topSpecies: Array<Pick<SpeciesSummary, "id" | "population" | "lineageCount" | "dominantBiome" | "births" | "deaths"> & { dominantTrait: keyof Genome }>;
  lineageSurvival: Array<{ lineageId: string; living: number; averageFitness: number }>;
  catastrophes: SimulationEvent[];
  extinctions: SimulationEvent[];
  recentEvents: SimulationEvent[];
}

export function createSimulationReport(options: SimulationReportOptions): SimulationReport {
  const config = {
    seed: options.seed,
    generations: options.generations,
    width: options.width ?? 56,
    height: options.height ?? 34,
    initialPopulation: options.initialPopulation ?? 160
  };
  const maxEvents = options.maxEvents ?? 700;
  let world = createWorld(config.seed, config);
  const summaries: GenerationSummary[] = [world.summaries.at(-1)!];
  const eventCounts = emptyEventCounts();
  let reportEvents: SimulationEvent[] = [];

  for (let index = 0; index < config.generations; index += 1) {
    world = stepWorld(world);
    const latest = world.summaries.at(-1)!;
    summaries.push(latest);

    const stepEvents = world.events.filter((event) => event.generation === world.generation);
    for (const event of stepEvents) {
      eventCounts[event.kind] += 1;
    }
    reportEvents = [...reportEvents, ...stepEvents].slice(-maxEvents);
  }

  const first = summaries[0];
  const final = summaries.at(-1)!;
  const finalAverageGenome = averageGenomeFromSpecies(world.species);
  const reportWithoutSignature = {
    config,
    final: {
      generation: final.generation,
      population: final.population,
      species: final.species,
      averageFitness: final.averageFitness,
      diversity: final.diversity,
      dominantTrait: final.dominantTrait
    },
    totals: {
      births: summaries.reduce((sum, summary) => sum + summary.births, 0),
      deaths: summaries.reduce((sum, summary) => sum + summary.deaths, 0),
      mutations: eventCounts.mutation,
      extinctions: eventCounts.extinction,
      catastrophes: eventCounts.catastrophe
    },
    pressure: {
      foodDelta: round(final.averageFood - first.averageFood),
      finalFood: final.averageFood,
      finalDisease: final.averageDisease,
      finalPredatorPressure: final.averagePredatorPressure
    },
    eventCounts,
    populationCurve: sampleCurve(summaries, 28),
    traitDrift: {
      firstDominantTrait: first.dominantTrait,
      finalDominantTrait: final.dominantTrait,
      finalAverageGenome
    },
    topSpecies: world.species.slice(0, 8).map((species) => ({
      id: species.id,
      population: species.population,
      lineageCount: species.lineageCount,
      dominantBiome: species.dominantBiome,
      births: species.births,
      deaths: species.deaths,
      dominantTrait: dominantGenomeTrait(species.averageGenome)
    })),
    lineageSurvival: topLineages(world.creatures),
    catastrophes: reportEvents.filter((event) => event.kind === "catastrophe"),
    extinctions: reportEvents.filter((event) => event.kind === "extinction"),
    recentEvents: reportEvents.slice(-18)
  };

  return {
    ...reportWithoutSignature,
    signature: digestReport(reportWithoutSignature)
  };
}

export function formatSimulationReport(report: SimulationReport): string {
  const lines = [
    `Petri Dish simulation report`,
    `Seed: ${report.config.seed}`,
    `Config: ${report.config.generations} generations, ${report.config.width}x${report.config.height}, ${report.config.initialPopulation} founders`,
    `Signature: ${report.signature}`,
    ``,
    `Final ecology`,
    `- generation: ${report.final.generation}`,
    `- population: ${report.final.population}`,
    `- species: ${report.final.species}`,
    `- average fitness: ${report.final.averageFitness}`,
    `- diversity: ${report.final.diversity}`,
    `- dominant trait: ${report.final.dominantTrait}`,
    ``,
    `Selection pressure`,
    `- births: ${report.totals.births}`,
    `- deaths: ${report.totals.deaths}`,
    `- mutations: ${report.totals.mutations}`,
    `- extinctions: ${report.totals.extinctions}`,
    `- catastrophes: ${report.totals.catastrophes}`,
    `- food delta: ${report.pressure.foodDelta}`,
    `- final disease: ${report.pressure.finalDisease}`,
    `- final predators: ${report.pressure.finalPredatorPressure}`,
    ``,
    `Dominant species`,
    ...report.topSpecies.slice(0, 5).map((species) => `- ${species.id}: ${species.population} alive, ${species.lineageCount} lineages, ${species.dominantBiome}, trait ${species.dominantTrait}`),
    ``,
    `Surviving dynasties`,
    ...report.lineageSurvival.slice(0, 5).map((lineage) => `- ${lineage.lineageId}: ${lineage.living} living, avg fitness ${lineage.averageFitness}`),
    ``,
    `Recent event ledger`,
    ...(report.recentEvents.length ? report.recentEvents.map((event) => `- g${event.generation} ${event.kind}: ${event.message}`) : ["- no recorded events"])
  ];

  return lines.join("\n");
}

function emptyEventCounts(): Record<SimulationEventKind, number> {
  return {
    birth: 0,
    death: 0,
    mutation: 0,
    speciation: 0,
    extinction: 0,
    catastrophe: 0
  };
}

function sampleCurve(summaries: GenerationSummary[], maxPoints: number): SimulationReport["populationCurve"] {
  if (summaries.length <= maxPoints) {
    return summaries.map(curvePoint);
  }

  const sampled: GenerationSummary[] = [];
  for (let index = 0; index < maxPoints; index += 1) {
    const sourceIndex = Math.round((index / (maxPoints - 1)) * (summaries.length - 1));
    sampled.push(summaries[sourceIndex]);
  }
  return sampled.map(curvePoint);
}

function curvePoint(summary: GenerationSummary): SimulationReport["populationCurve"][number] {
  return {
    generation: summary.generation,
    population: summary.population,
    species: summary.species,
    births: summary.births,
    deaths: summary.deaths,
    diversity: summary.diversity
  };
}

function topLineages(creatures: Array<{ lineageId: string; fitness: number }>): SimulationReport["lineageSurvival"] {
  const groups = new Map<string, { living: number; totalFitness: number }>();

  for (const creature of creatures) {
    const current = groups.get(creature.lineageId) ?? { living: 0, totalFitness: 0 };
    current.living += 1;
    current.totalFitness += creature.fitness;
    groups.set(creature.lineageId, current);
  }

  return [...groups.entries()]
    .map(([lineageId, value]) => ({
      lineageId,
      living: value.living,
      averageFitness: round(value.totalFitness / Math.max(1, value.living))
    }))
    .sort((a, b) => b.living - a.living || b.averageFitness - a.averageFitness)
    .slice(0, 10);
}

function averageGenomeFromSpecies(species: SpeciesSummary[]): Genome {
  const total: Record<keyof Genome, number> = {
    speed: 0,
    vision: 0,
    metabolism: 0,
    fertility: 0,
    aggression: 0,
    sociality: 0,
    foraging: 0,
    immunity: 0,
    heatTolerance: 0,
    coldTolerance: 0,
    predatorSense: 0,
    migrationDrive: 0,
    mutationRate: 0
  };
  let members = 0;

  for (const item of species) {
    members += item.population;
    for (const key of genomeKeys) {
      total[key] += item.averageGenome[key] * item.population;
    }
  }

  return {
    speed: round(total.speed / Math.max(1, members)),
    vision: round(total.vision / Math.max(1, members)),
    metabolism: round(total.metabolism / Math.max(1, members)),
    fertility: round(total.fertility / Math.max(1, members)),
    aggression: round(total.aggression / Math.max(1, members)),
    sociality: round(total.sociality / Math.max(1, members)),
    foraging: round(total.foraging / Math.max(1, members)),
    immunity: round(total.immunity / Math.max(1, members)),
    heatTolerance: round(total.heatTolerance / Math.max(1, members)),
    coldTolerance: round(total.coldTolerance / Math.max(1, members)),
    predatorSense: round(total.predatorSense / Math.max(1, members)),
    migrationDrive: round(total.migrationDrive / Math.max(1, members)),
    mutationRate: round(total.mutationRate / Math.max(1, members))
  };
}

function dominantGenomeTrait(genome: Genome): keyof Genome {
  return genomeKeys.reduce((best, key) => (genome[key] > genome[best] ? key : best), "foraging" as keyof Genome);
}

function digestReport(report: Omit<SimulationReport, "signature">): string {
  const payload = JSON.stringify({
    config: report.config,
    final: report.final,
    totals: report.totals,
    pressure: report.pressure,
    topSpecies: report.topSpecies.slice(0, 4),
    curve: report.populationCurve
  });
  let hash = 2166136261;
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `pd-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
