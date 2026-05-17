import { genomeKeys } from "./species";
import type { GenerationSnapshot } from "./snapshots";
import type { Creature, GenerationSummary, Genome, SimulationEvent, SpeciesSummary, TerrainCell, World, WorldEvent } from "./types";

export const persistedRunSchema = "petri-dish.persisted-run";
export const persistedRunVersion = 1;
export const defaultPersistedRunKey = "petri-dish:persisted-run:v1";

export interface PersistenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PersistedRunPayload {
  schema: typeof persistedRunSchema;
  version: typeof persistedRunVersion;
  savedAt: string;
  world: World;
  snapshots: GenerationSnapshot[];
  selectedCreatureId?: string;
  replayGeneration?: number;
  metadata: {
    seed: string;
    generation: number;
    population: number;
    species: number;
    snapshots: number;
  };
}

export type PersistedRunInput = {
  world: World;
  snapshots: GenerationSnapshot[];
  selectedCreatureId?: string;
  replayGeneration?: number;
  savedAt?: string;
};

export type PersistedRunLoadResult =
  | { status: "missing"; key: string }
  | { status: "loaded"; key: string; payload: PersistedRunPayload; bytes: number }
  | { status: "unavailable"; key: string; reason: string; error?: unknown }
  | { status: "invalid"; key: string; reason: string; error?: unknown }
  | { status: "unsupported"; key: string; reason: string; schema?: unknown; version?: unknown };

export type PersistedRunSaveResult =
  | { status: "saved"; key: string; savedAt: string; bytes: number }
  | { status: "error"; key: string; reason: string; error?: unknown };

export type PersistedRunClearResult = { status: "cleared"; key: string } | { status: "error"; key: string; reason: string; error?: unknown };

export function createPersistedRunPayload({
  world,
  snapshots,
  selectedCreatureId,
  replayGeneration,
  savedAt = new Date().toISOString()
}: PersistedRunInput): PersistedRunPayload {
  return cloneJson({
    schema: persistedRunSchema,
    version: persistedRunVersion,
    savedAt,
    world,
    snapshots,
    selectedCreatureId,
    replayGeneration,
    metadata: {
      seed: world.seed,
      generation: world.generation,
      population: world.creatures.length,
      species: world.species.length,
      snapshots: snapshots.length
    }
  });
}

export function savePersistedRun(
  storage: PersistenceStorage,
  input: PersistedRunInput,
  key = defaultPersistedRunKey
): PersistedRunSaveResult {
  try {
    const payload = createPersistedRunPayload(input);
    if (!isPersistedRunPayload(payload)) {
      return { status: "error", key, reason: "payload-shape-invalid" };
    }
    const serialized = JSON.stringify(payload);
    storage.setItem(key, serialized);
    return { status: "saved", key, savedAt: payload.savedAt, bytes: byteLength(serialized) };
  } catch (error) {
    return { status: "error", key, reason: "storage-write-failed", error };
  }
}

export function loadPersistedRun(storage: PersistenceStorage, key = defaultPersistedRunKey): PersistedRunLoadResult {
  let serialized: string | null;

  try {
    serialized = storage.getItem(key);
  } catch (error) {
    return { status: "unavailable", key, reason: "storage-read-failed", error };
  }

  if (serialized === null) {
    return { status: "missing", key };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    return { status: "invalid", key, reason: "invalid-json", error };
  }

  return loadPersistedRunPayload(parsed, key, serialized);
}

export function loadPersistedRunPayload(value: unknown, key = defaultPersistedRunKey, serialized?: string): PersistedRunLoadResult {
  if (!isRecord(value)) {
    return { status: "invalid", key, reason: "payload-not-object" };
  }

  if (value.schema !== persistedRunSchema || value.version !== persistedRunVersion) {
    return {
      status: "unsupported",
      key,
      reason: "unsupported-schema-version",
      schema: value.schema,
      version: value.version
    };
  }

  if (!isPersistedRunPayload(value)) {
    return { status: "invalid", key, reason: "payload-shape-invalid" };
  }

  return { status: "loaded", key, payload: value, bytes: serialized ? byteLength(serialized) : measurePersistedRunPayload(value) };
}

export function measurePersistedRunPayload(payload: PersistedRunPayload): number {
  return byteLength(JSON.stringify(payload));
}

export function clearPersistedRun(storage: PersistenceStorage, key = defaultPersistedRunKey): PersistedRunClearResult {
  try {
    storage.removeItem(key);
    return { status: "cleared", key };
  } catch (error) {
    return { status: "error", key, reason: "storage-clear-failed", error };
  }
}

function isPersistedRunPayload(value: unknown): value is PersistedRunPayload {
  if (!isRecord(value)) return false;
  if (typeof value.savedAt !== "string" || !isWorld(value.world) || !Array.isArray(value.snapshots)) return false;

  const world = value.world;
  const snapshots = value.snapshots;

  return (
    snapshots.every(isGenerationSnapshot) &&
    snapshots.every((snapshot) => snapshot.seed === world.seed && snapshot.generation <= world.generation) &&
    (value.selectedCreatureId === undefined || typeof value.selectedCreatureId === "string") &&
    (value.replayGeneration === undefined || typeof value.replayGeneration === "number") &&
    isMetadata(value.metadata, world, snapshots)
  );
}

function isWorld(value: unknown): value is World {
  if (!isRecord(value)) return false;
  return (
    typeof value.seed === "string" &&
    typeof value.width === "number" &&
    typeof value.height === "number" &&
    typeof value.generation === "number" &&
    typeof value.nextId === "number" &&
    Array.isArray(value.cells) &&
    value.cells.every(isTerrainCell) &&
    Array.isArray(value.creatures) &&
    value.creatures.every(isCreature) &&
    Array.isArray(value.graveyard) &&
    value.graveyard.every(isCreature) &&
    Array.isArray(value.summaries) &&
    value.summaries.every(isGenerationSummary) &&
    Array.isArray(value.species) &&
    value.species.every(isSpeciesSummary) &&
    Array.isArray(value.events) &&
    value.events.every(isSimulationEvent) &&
    (value.currentEvent === undefined || isWorldEvent(value.currentEvent))
  );
}

function isGenerationSnapshot(value: unknown): value is GenerationSnapshot {
  if (!isRecord(value)) return false;
  if (
    !(
      typeof value.seed === "string" &&
      typeof value.generation === "number" &&
      isWorld(value.world) &&
      isGenerationSummary(value.summary) &&
      typeof value.population === "number" &&
      typeof value.speciesCount === "number" &&
      typeof value.eventCount === "number"
    )
  ) {
    return false;
  }

  return (
    value.seed === value.world.seed &&
    value.generation === value.world.generation &&
    value.summary.generation === value.world.generation &&
    value.population === value.world.creatures.length &&
    value.speciesCount === value.world.species.length &&
    value.eventCount === value.world.events.length
  );
}

function isTerrainCell(value: unknown): value is TerrainCell {
  if (!isRecord(value)) return false;
  return (
    typeof value.x === "number" &&
    typeof value.y === "number" &&
    isOneOf(value.biome, ["mire", "steppe", "reef", "fungal", "basalt", "ice"]) &&
    typeof value.elevation === "number" &&
    typeof value.moisture === "number" &&
    typeof value.fertility === "number" &&
    typeof value.food === "number" &&
    typeof value.disease === "number" &&
    typeof value.predatorPressure === "number" &&
    typeof value.temperature === "number"
  );
}

function isCreature(value: unknown): value is Creature {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.x === "number" &&
    typeof value.y === "number" &&
    typeof value.age === "number" &&
    typeof value.energy === "number" &&
    typeof value.generation === "number" &&
    isGenome(value.genome) &&
    typeof value.speciesId === "string" &&
    typeof value.lineageId === "string" &&
    isStringArray(value.parentIds) &&
    isStringArray(value.ancestorIds) &&
    Array.isArray(value.mutations) &&
    value.mutations.every(
      (mutation) =>
        isRecord(mutation) &&
        typeof mutation.generation === "number" &&
        isGenomeKey(mutation.gene) &&
        typeof mutation.delta === "number"
    ) &&
    typeof value.births === "number" &&
    typeof value.kills === "number" &&
    (value.causeOfDeath === undefined || typeof value.causeOfDeath === "string") &&
    typeof value.fitness === "number"
  );
}

function isGenerationSummary(value: unknown): value is GenerationSummary {
  if (!isRecord(value)) return false;
  return (
    typeof value.generation === "number" &&
    typeof value.population === "number" &&
    typeof value.species === "number" &&
    typeof value.births === "number" &&
    typeof value.deaths === "number" &&
    isStringArray(value.extinctions) &&
    typeof value.averageFitness === "number" &&
    typeof value.averageFood === "number" &&
    typeof value.averageDisease === "number" &&
    typeof value.averagePredatorPressure === "number" &&
    typeof value.diversity === "number" &&
    isGenomeKey(value.dominantTrait) &&
    (value.event === undefined || isWorldEvent(value.event))
  );
}

function isSpeciesSummary(value: unknown): value is SpeciesSummary {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.color === "string" &&
    typeof value.population === "number" &&
    isGenome(value.averageGenome) &&
    typeof value.lineageCount === "number" &&
    isOneOf(value.dominantBiome, ["mire", "steppe", "reef", "fungal", "basalt", "ice"]) &&
    typeof value.births === "number" &&
    typeof value.deaths === "number"
  );
}

function isSimulationEvent(value: unknown): value is SimulationEvent {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.generation === "number" &&
    isOneOf(value.kind, ["birth", "death", "mutation", "speciation", "extinction", "catastrophe"]) &&
    typeof value.message === "string" &&
    (value.creatureId === undefined || typeof value.creatureId === "string") &&
    (value.speciesId === undefined || typeof value.speciesId === "string") &&
    (value.lineageId === undefined || typeof value.lineageId === "string") &&
    (value.parentIds === undefined || isStringArray(value.parentIds)) &&
    (value.cause === undefined || typeof value.cause === "string") &&
    (value.gene === undefined || isGenomeKey(value.gene)) &&
    (value.delta === undefined || typeof value.delta === "number") &&
    (value.eventKind === undefined || isOneOf(value.eventKind, ["drought", "plague", "ashfall", "migration", "bloom"])) &&
    (value.severity === undefined || typeof value.severity === "number") &&
    (value.population === undefined || typeof value.population === "number")
  );
}

function isWorldEvent(value: unknown): value is WorldEvent {
  if (!isRecord(value)) return false;
  return (
    isOneOf(value.kind, ["drought", "plague", "ashfall", "migration", "bloom"]) &&
    typeof value.name === "string" &&
    typeof value.severity === "number" &&
    typeof value.remaining === "number" &&
    typeof value.startedAt === "number"
  );
}

function isGenome(value: unknown): value is Genome {
  if (!isRecord(value)) return false;
  return genomeKeys.every((key) => typeof value[key] === "number");
}

function isGenomeKey(value: unknown): value is keyof Genome {
  return typeof value === "string" && genomeKeys.includes(value as keyof Genome);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isOneOf<const Values extends readonly string[]>(value: unknown, values: Values): value is Values[number] {
  return typeof value === "string" && values.includes(value);
}

function isMetadata(value: unknown, world: World, snapshots: GenerationSnapshot[]): value is PersistedRunPayload["metadata"] {
  if (!isRecord(value)) return false;
  return (
    value.seed === world.seed &&
    value.generation === world.generation &&
    value.population === world.creatures.length &&
    value.species === world.species.length &&
    value.snapshots === snapshots.length
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}
