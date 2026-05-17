import { round } from "./rng";
import { averageGenome, dominantTrait } from "./species";
import type { Creature, Genome, World } from "./types";

export interface LineageAtlasEntry {
  lineageId: string;
  status: "surviving" | "collapsed";
  living: number;
  dead: number;
  total: number;
  births: number;
  bestFitness: number;
  speciesCount: number;
  averageFitness: number;
  mutationCount: number;
  dominantTrait: keyof Genome;
  founderGeneration: number;
  latestGeneration: number;
  representativeCreatureId?: string;
  representativeName?: string;
  survivalScore: number;
}

export function buildLineageAtlas(world: World, options: { limit?: number } = {}): LineageAtlasEntry[] {
  const limit = options.limit ?? 8;
  const groups = new Map<string, { living: Creature[]; dead: Creature[] }>();

  for (const creature of world.creatures) {
    const group = groups.get(creature.lineageId) ?? { living: [], dead: [] };
    group.living.push(creature);
    groups.set(creature.lineageId, group);
  }

  for (const creature of world.graveyard) {
    const group = groups.get(creature.lineageId) ?? { living: [], dead: [] };
    group.dead.push(creature);
    groups.set(creature.lineageId, group);
  }

  return [...groups.entries()]
    .map(([lineageId, group]) => lineageAtlasEntry(lineageId, group.living, group.dead))
    .sort(
      (left, right) =>
        right.survivalScore - left.survivalScore ||
        right.living - left.living ||
        right.total - left.total ||
        right.averageFitness - left.averageFitness ||
        left.lineageId.localeCompare(right.lineageId)
    )
    .slice(0, limit);
}

export function selectLineageRepresentative(creatures: Creature[], lineageId: string): Creature | undefined {
  return creatures
    .filter((creature) => creature.lineageId === lineageId)
    .sort((left, right) => representativeScore(right) - representativeScore(left))[0];
}

function lineageAtlasEntry(lineageId: string, living: Creature[], dead: Creature[]): LineageAtlasEntry {
  const all = [...living, ...dead];
  const fitnessSource = living.length ? living : all;
  const averageFitness = round(fitnessSource.reduce((sum, creature) => sum + creature.fitness, 0) / Math.max(1, fitnessSource.length));
  const bestFitness = round(Math.max(...fitnessSource.map((creature) => creature.fitness)));
  const representative = selectLineageRepresentative(living, lineageId);
  const average = averageGenome(all);
  const mutationCount = all.reduce((sum, creature) => sum + creature.mutations.length, 0);
  const births = all.reduce((sum, creature) => sum + creature.births, 0);
  const speciesCount = new Set(all.map((creature) => creature.speciesId)).size;
  const founderGeneration = Math.min(...all.map((creature) => creature.generation));
  const latestGeneration = Math.max(...all.map((creature) => creature.generation + creature.age));
  const survivalScore = round(living.length * 4 + all.length + births * 0.5 + speciesCount * 2 + averageFitness * 3);

  return {
    lineageId,
    status: living.length ? "surviving" : "collapsed",
    living: living.length,
    dead: dead.length,
    total: all.length,
    births,
    bestFitness,
    speciesCount,
    averageFitness,
    mutationCount,
    dominantTrait: dominantTrait(average),
    founderGeneration,
    latestGeneration,
    representativeCreatureId: representative?.id,
    representativeName: representative?.name,
    survivalScore
  };
}

function representativeScore(creature: Creature): number {
  return creature.fitness + creature.births * 0.08;
}
