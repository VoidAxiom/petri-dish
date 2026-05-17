import { createWorld, stepWorld } from "./world";
import type { Creature, GenerationSummary, SimulationEvent, SpeciesSummary, TerrainCell, World, WorldOptions } from "./types";

export const defaultSnapshotInterval = 10;
export const defaultMaxSnapshots = 80;

export interface GenerationSnapshot {
  seed: string;
  generation: number;
  world: World;
  summary: GenerationSummary;
  population: number;
  speciesCount: number;
  eventCount: number;
}

export function createGenerationSnapshot(world: World): GenerationSnapshot {
  const snapshotWorld = cloneWorldForSnapshot(world);
  const summary = snapshotWorld.summaries.at(-1)!;

  return {
    seed: snapshotWorld.seed,
    generation: snapshotWorld.generation,
    world: snapshotWorld,
    summary,
    population: snapshotWorld.creatures.length,
    speciesCount: snapshotWorld.species.length,
    eventCount: snapshotWorld.events.length
  };
}

export function upsertGenerationSnapshot(
  snapshots: GenerationSnapshot[],
  world: World,
  interval = defaultSnapshotInterval,
  maxSnapshots = defaultMaxSnapshots
): GenerationSnapshot[] {
  if (snapshots.length > 0 && (snapshots[0].seed !== world.seed || world.generation < snapshots.at(-1)!.generation)) {
    return [createGenerationSnapshot(world)];
  }

  if (world.generation !== 0 && world.generation % interval !== 0) {
    return snapshots;
  }

  const snapshot = createGenerationSnapshot(world);
  const next = [...snapshots.filter((item) => item.generation !== snapshot.generation), snapshot].sort((left, right) => left.generation - right.generation);
  return next.slice(-maxSnapshots);
}

export function snapshotWorld(snapshot: GenerationSnapshot): World {
  return cloneWorldForSnapshot(snapshot.world);
}

export function nearestGenerationSnapshot(snapshots: GenerationSnapshot[], generation: number): GenerationSnapshot | undefined {
  return snapshots.reduce<GenerationSnapshot | undefined>((nearest, snapshot) => {
    if (!nearest) return snapshot;
    return Math.abs(snapshot.generation - generation) < Math.abs(nearest.generation - generation) ? snapshot : nearest;
  }, undefined);
}

export function buildGenerationSnapshots(
  seed: string,
  generations: number,
  options: WorldOptions = {},
  interval = defaultSnapshotInterval
): GenerationSnapshot[] {
  let world = createWorld(seed, options);
  let snapshots = [createGenerationSnapshot(world)];

  for (let index = 0; index < generations; index += 1) {
    world = stepWorld(world);
    snapshots = upsertGenerationSnapshot(snapshots, world, interval, Number.MAX_SAFE_INTEGER);
  }

  return snapshots;
}

export function snapshotSignature(world: World): object {
  const summary = world.summaries.at(-1)!;
  return {
    seed: world.seed,
    generation: world.generation,
    population: world.creatures.length,
    species: world.species.length,
    summaryPopulation: summary.population,
    averageFood: summary.averageFood,
    averageDisease: summary.averageDisease,
    averagePredatorPressure: summary.averagePredatorPressure,
    dominantTrait: summary.dominantTrait,
    firstCreature: world.creatures[0]
      ? {
          id: world.creatures[0].id,
          x: world.creatures[0].x,
          y: world.creatures[0].y,
          energy: world.creatures[0].energy,
          lineageId: world.creatures[0].lineageId,
          speciesId: world.creatures[0].speciesId
        }
      : undefined,
    firstCell: world.cells[0]
      ? {
          food: world.cells[0].food,
          disease: world.cells[0].disease,
          predatorPressure: world.cells[0].predatorPressure
        }
      : undefined,
    currentEvent: world.currentEvent
      ? {
          kind: world.currentEvent.kind,
          remaining: world.currentEvent.remaining,
          startedAt: world.currentEvent.startedAt
        }
      : undefined
  };
}

function cloneWorldForSnapshot(world: World): World {
  return {
    ...world,
    cells: world.cells.map(cloneTerrainCell),
    creatures: world.creatures.map(cloneCreature),
    graveyard: world.graveyard.slice(-320).map(cloneCreature),
    summaries: world.summaries.slice(-140).map(cloneSummary),
    species: world.species.map(cloneSpecies),
    events: world.events.slice(-640).map(cloneEvent),
    currentEvent: world.currentEvent ? { ...world.currentEvent } : undefined
  };
}

function cloneTerrainCell(cell: TerrainCell): TerrainCell {
  return { ...cell };
}

function cloneCreature(creature: Creature): Creature {
  return {
    ...creature,
    genome: { ...creature.genome },
    parentIds: [...creature.parentIds],
    ancestorIds: [...creature.ancestorIds],
    mutations: creature.mutations.map((mutation) => ({ ...mutation }))
  };
}

function cloneSummary(summary: GenerationSummary): GenerationSummary {
  return {
    ...summary,
    extinctions: [...summary.extinctions],
    event: summary.event ? { ...summary.event } : undefined
  };
}

function cloneSpecies(species: SpeciesSummary): SpeciesSummary {
  return {
    ...species,
    averageGenome: { ...species.averageGenome }
  };
}

function cloneEvent(event: SimulationEvent): SimulationEvent {
  return {
    ...event,
    parentIds: event.parentIds ? [...event.parentIds] : undefined
  };
}
