export type Biome = "mire" | "steppe" | "reef" | "fungal" | "basalt" | "ice";

export type WorldEventKind = "drought" | "plague" | "ashfall" | "migration" | "bloom";

export interface TerrainCell {
  x: number;
  y: number;
  biome: Biome;
  elevation: number;
  moisture: number;
  fertility: number;
  food: number;
  disease: number;
  predatorPressure: number;
  temperature: number;
}

export interface Genome {
  speed: number;
  vision: number;
  metabolism: number;
  fertility: number;
  aggression: number;
  sociality: number;
  foraging: number;
  immunity: number;
  heatTolerance: number;
  coldTolerance: number;
  predatorSense: number;
  migrationDrive: number;
  mutationRate: number;
}

export interface MutationRecord {
  generation: number;
  gene: keyof Genome;
  delta: number;
}

export interface Creature {
  id: string;
  name: string;
  x: number;
  y: number;
  age: number;
  energy: number;
  generation: number;
  genome: Genome;
  speciesId: string;
  lineageId: string;
  parentIds: string[];
  ancestorIds: string[];
  mutations: MutationRecord[];
  births: number;
  kills: number;
  causeOfDeath?: string;
  fitness: number;
}

export interface SpeciesSummary {
  id: string;
  color: string;
  population: number;
  averageGenome: Genome;
  lineageCount: number;
  dominantBiome: Biome;
  births: number;
  deaths: number;
}

export interface GenerationSummary {
  generation: number;
  population: number;
  species: number;
  births: number;
  deaths: number;
  extinctions: string[];
  averageFitness: number;
  averageFood: number;
  averageDisease: number;
  averagePredatorPressure: number;
  diversity: number;
  dominantTrait: keyof Genome;
  event?: WorldEvent;
}

export interface WorldEvent {
  kind: WorldEventKind;
  name: string;
  severity: number;
  remaining: number;
  startedAt: number;
}

export interface World {
  seed: string;
  width: number;
  height: number;
  generation: number;
  cells: TerrainCell[];
  creatures: Creature[];
  graveyard: Creature[];
  summaries: GenerationSummary[];
  species: SpeciesSummary[];
  currentEvent?: WorldEvent;
  nextId: number;
}

export interface WorldOptions {
  width?: number;
  height?: number;
  initialPopulation?: number;
}
