import type { Creature, Genome, SpeciesSummary, TerrainCell } from "./types";
import { round } from "./rng";

const palette = [
  "#ec4899",
  "#22c55e",
  "#38bdf8",
  "#f59e0b",
  "#a855f7",
  "#ef4444",
  "#14b8a6",
  "#eab308",
  "#f97316",
  "#84cc16",
  "#06b6d4",
  "#d946ef"
];

const geneKeys = [
  "speed",
  "vision",
  "metabolism",
  "fertility",
  "aggression",
  "sociality",
  "foraging",
  "immunity",
  "heatTolerance",
  "coldTolerance",
  "predatorSense",
  "migrationDrive",
  "mutationRate"
] as const;

export const genomeKeys = geneKeys;

export function speciesIdForGenome(genome: Genome): string {
  const mobility = Math.floor(((genome.speed + genome.vision + genome.migrationDrive) / 3) * 4);
  const survival = Math.floor(((genome.immunity + genome.predatorSense + genome.aggression) / 3) * 4);
  const climate = genome.heatTolerance > genome.coldTolerance ? "sun" : "frost";
  const forager = genome.foraging > 0.58 ? "grazer" : "gleaner";
  return `${climate}-${forager}-${mobility}-${survival}`;
}

export function speciesColor(speciesId: string): string {
  let hash = 0;
  for (let index = 0; index < speciesId.length; index += 1) {
    hash = (hash * 31 + speciesId.charCodeAt(index)) >>> 0;
  }
  return palette[hash % palette.length];
}

export function averageGenome(creatures: Creature[]): Genome {
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

  for (const creature of creatures) {
    for (const key of geneKeys) {
      total[key] += creature.genome[key];
    }
  }

  const divisor = Math.max(1, creatures.length);
  return {
    speed: round(total.speed / divisor),
    vision: round(total.vision / divisor),
    metabolism: round(total.metabolism / divisor),
    fertility: round(total.fertility / divisor),
    aggression: round(total.aggression / divisor),
    sociality: round(total.sociality / divisor),
    foraging: round(total.foraging / divisor),
    immunity: round(total.immunity / divisor),
    heatTolerance: round(total.heatTolerance / divisor),
    coldTolerance: round(total.coldTolerance / divisor),
    predatorSense: round(total.predatorSense / divisor),
    migrationDrive: round(total.migrationDrive / divisor),
    mutationRate: round(total.mutationRate / divisor)
  };
}

export function buildSpeciesSummaries(creatures: Creature[], cells: TerrainCell[], width: number, previous: SpeciesSummary[]): SpeciesSummary[] {
  const previousStats = new Map(previous.map((item) => [item.id, item]));
  const grouped = new Map<string, Creature[]>();

  for (const creature of creatures) {
    const list = grouped.get(creature.speciesId) ?? [];
    list.push(creature);
    grouped.set(creature.speciesId, list);
  }

  return [...grouped.entries()]
    .map(([id, members]) => {
      const biomeCounts = new Map<string, number>();
      for (const member of members) {
        const cell = cells[member.y * width + member.x];
        if (cell) {
          biomeCounts.set(cell.biome, (biomeCounts.get(cell.biome) ?? 0) + 1);
        }
      }

      const dominantBiome = [...biomeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "steppe";
      const previousEntry = previousStats.get(id);

      return {
        id,
        color: speciesColor(id),
        population: members.length,
        averageGenome: averageGenome(members),
        lineageCount: new Set(members.map((member) => member.lineageId)).size,
        dominantBiome: dominantBiome as SpeciesSummary["dominantBiome"],
        births: previousEntry?.births ?? 0,
        deaths: previousEntry?.deaths ?? 0
      };
    })
    .sort((a, b) => b.population - a.population);
}

export function dominantTrait(genome: Genome): keyof Genome {
  return geneKeys.reduce((best, key) => (genome[key] > genome[best] ? key : best), "foraging" as keyof Genome);
}
