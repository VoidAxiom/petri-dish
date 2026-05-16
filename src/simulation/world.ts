import { clamp, createRng, round, type Rng } from "./rng";
import { averageGenome, buildSpeciesSummaries, dominantTrait, genomeKeys, speciesIdForGenome } from "./species";
import type { Biome, Creature, GenerationSummary, Genome, MutationRecord, TerrainCell, World, WorldEvent, WorldOptions } from "./types";

const biomeFertility: Record<Biome, number> = {
  mire: 0.72,
  steppe: 0.5,
  reef: 0.86,
  fungal: 0.62,
  basalt: 0.28,
  ice: 0.18
};

const biomeTemperature: Record<Biome, number> = {
  mire: 0.58,
  steppe: 0.64,
  reef: 0.7,
  fungal: 0.5,
  basalt: 0.78,
  ice: 0.18
};

const nameParts = ["Aster", "Brine", "Cinder", "Dusk", "Ember", "Fable", "Grove", "Helio", "Iris", "Juno", "Kelp", "Lumen"];

export function createWorld(seed: string, options: WorldOptions = {}): World {
  const width = options.width ?? 56;
  const height = options.height ?? 34;
  const rng = createRng(seed);
  const cells = createTerrain(width, height, rng);
  const initialPopulation = options.initialPopulation ?? 160;
  const creatures: Creature[] = [];

  for (let index = 0; index < initialPopulation; index += 1) {
    const cell = weightedCell(cells, rng, (candidate) => candidate.food + candidate.fertility - candidate.predatorPressure * 0.4);
    const genome = createGenome(rng);
    const speciesId = speciesIdForGenome(genome);
    creatures.push({
      id: `c-${index + 1}`,
      name: `${rng.pick(nameParts)}-${rng.int(10, 99)}`,
      x: cell.x,
      y: cell.y,
      age: rng.int(0, 12),
      energy: round(0.52 + rng.next() * 0.35),
      generation: 0,
      genome,
      speciesId,
      lineageId: `l-${index + 1}`,
      parentIds: [],
      ancestorIds: [],
      mutations: [],
      births: 0,
      kills: 0,
      fitness: 0
    });
  }

  const world: World = {
    seed,
    width,
    height,
    generation: 0,
    cells,
    creatures,
    graveyard: [],
    summaries: [],
    species: [],
    nextId: initialPopulation + 1
  };

  world.species = buildSpeciesSummaries(world.creatures, world.cells, world.width, []);
  world.summaries = [summarize(world, 0, 0, [])];

  return world;
}

export function stepWorld(input: World): World {
  const world = cloneWorld(input);
  const rng = createRng(`${world.seed}:generation:${world.generation + 1}`);
  world.generation += 1;
  world.currentEvent = updateEvent(world, rng);
  updateTerrain(world, rng);

  const deaths: Creature[] = [];
  const births: Creature[] = [];
  const occupied = new Map<string, Creature[]>();
  for (const creature of world.creatures) {
    const key = `${creature.x},${creature.y}`;
    const list = occupied.get(key) ?? [];
    list.push(creature);
    occupied.set(key, list);
  }

  for (const creature of world.creatures) {
    if (creature.causeOfDeath) {
      continue;
    }

    creature.age += 1;
    moveCreature(creature, world, rng);
    const cell = getCell(world, creature.x, creature.y);
    feedCreature(creature, cell);
    applyStress(creature, cell, world.currentEvent);
    creature.fitness = calculateFitness(creature, cell);

    const deathCause = deathCauseFor(creature, cell, rng);
    if (deathCause) {
      creature.causeOfDeath = deathCause;
      deaths.push(creature);
      continue;
    }

    const neighbors = nearbyCreatures(creature, world.creatures, 2).filter((mate) => !mate.causeOfDeath);
    const mate = chooseMate(creature, neighbors, rng);
    if (mate && shouldReproduce(creature, mate, world.creatures.length, rng)) {
      births.push(createChild(creature, mate, world, rng));
      creature.births += 1;
      mate.births += 1;
      creature.energy *= 0.64;
      mate.energy *= 0.72;
    }
  }

  const living = world.creatures.filter((creature) => !creature.causeOfDeath);
  world.creatures = [...living, ...births].slice(0, 720);
  world.graveyard = [...world.graveyard, ...deaths].slice(-900);

  const previousSpecies = new Map(world.species.map((item) => [item.id, item]));
  world.species = buildSpeciesSummaries(world.creatures, world.cells, world.width, world.species);
  const extinctions = [...previousSpecies.keys()].filter((id) => !world.species.some((item) => item.id === id));

  for (const species of world.species) {
    const previous = previousSpecies.get(species.id);
    species.births = (previous?.births ?? 0) + births.filter((creature) => creature.speciesId === species.id).length;
    species.deaths = (previous?.deaths ?? 0) + deaths.filter((creature) => creature.speciesId === species.id).length;
  }

  world.summaries = [...world.summaries, summarize(world, births.length, deaths.length, extinctions)].slice(-260);
  return world;
}

export function runWorld(seed: string, generations: number, options?: WorldOptions): World {
  let world = createWorld(seed, options);
  for (let index = 0; index < generations; index += 1) {
    world = stepWorld(world);
  }
  return world;
}

function cloneWorld(world: World): World {
  return {
    ...world,
    cells: world.cells.map((cell) => ({ ...cell })),
    creatures: world.creatures.map((creature) => ({
      ...creature,
      genome: { ...creature.genome },
      parentIds: [...creature.parentIds],
      ancestorIds: [...creature.ancestorIds],
      mutations: creature.mutations.map((mutation) => ({ ...mutation }))
    })),
    graveyard: world.graveyard.map((creature) => ({ ...creature, genome: { ...creature.genome } })),
    summaries: world.summaries.map((summary) => ({
      ...summary,
      extinctions: [...summary.extinctions],
      event: summary.event ? { ...summary.event } : undefined
    })),
    species: world.species.map((species) => ({
      ...species,
      averageGenome: { ...species.averageGenome }
    })),
    currentEvent: world.currentEvent ? { ...world.currentEvent } : undefined
  };
}

function createTerrain(width: number, height: number, rng: Rng): TerrainCell[] {
  const cells: TerrainCell[] = [];
  const centerX = width / 2;
  const centerY = height / 2;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const ridge = Math.sin((x + rng.next() * 3) * 0.21) * 0.18 + Math.cos((y - rng.next() * 4) * 0.27) * 0.16;
      const radial = Math.hypot(x - centerX, y - centerY) / Math.hypot(centerX, centerY);
      const moisture = clamp(0.58 + Math.sin(y * 0.33) * 0.2 - radial * 0.22 + rng.next() * 0.28 - 0.12);
      const elevation = clamp(0.46 + ridge + radial * 0.34 + rng.next() * 0.18 - 0.09);
      const temperature = clamp(0.76 - y / height * 0.55 + rng.next() * 0.16 - elevation * 0.16);
      const biome = biomeFor(elevation, moisture, temperature);
      const fertility = clamp(biomeFertility[biome] * (0.72 + moisture * 0.44) - elevation * 0.12);

      cells.push({
        x,
        y,
        biome,
        elevation,
        moisture,
        fertility,
        food: clamp(fertility * (0.65 + rng.next() * 0.35)),
        disease: clamp((moisture * 0.35 + fertility * 0.18) * rng.next()),
        predatorPressure: clamp((0.12 + elevation * 0.25 + (1 - fertility) * 0.24) * rng.next()),
        temperature: clamp((temperature + biomeTemperature[biome]) / 2)
      });
    }
  }

  return cells;
}

function biomeFor(elevation: number, moisture: number, temperature: number): Biome {
  if (temperature < 0.28) return "ice";
  if (elevation > 0.78) return "basalt";
  if (moisture > 0.72 && temperature > 0.6) return "reef";
  if (moisture > 0.66) return "mire";
  if (temperature < 0.52 && moisture > 0.44) return "fungal";
  return "steppe";
}

function createGenome(rng: Rng): Genome {
  return {
    speed: trait(rng, 0.5),
    vision: trait(rng, 0.54),
    metabolism: trait(rng, 0.44),
    fertility: trait(rng, 0.52),
    aggression: trait(rng, 0.38),
    sociality: trait(rng, 0.55),
    foraging: trait(rng, 0.6),
    immunity: trait(rng, 0.46),
    heatTolerance: trait(rng, 0.52),
    coldTolerance: trait(rng, 0.48),
    predatorSense: trait(rng, 0.46),
    migrationDrive: trait(rng, 0.42),
    mutationRate: clamp(0.018 + rng.next() * 0.055)
  };
}

function trait(rng: Rng, center: number): number {
  return clamp(center + (rng.next() - 0.5) * 0.5);
}

function weightedCell(cells: TerrainCell[], rng: Rng, score: (cell: TerrainCell) => number): TerrainCell {
  const candidates = [...cells].sort((a, b) => score(b) - score(a)).slice(0, Math.max(1, Math.floor(cells.length * 0.34)));
  return rng.pick(candidates);
}

function updateEvent(world: World, rng: Rng): WorldEvent | undefined {
  if (world.currentEvent && world.currentEvent.remaining > 1) {
    return { ...world.currentEvent, remaining: world.currentEvent.remaining - 1 };
  }

  if (world.generation > 0 && world.generation % 90 === 0) {
    const kind = rng.pick(["drought", "plague", "ashfall", "migration", "bloom"] as const);
    const severity = round(0.36 + rng.next() * 0.45);
    const names: Record<typeof kind, string> = {
      drought: "Glass Drought",
      plague: "Silver Fever",
      ashfall: "Black Sun Ashfall",
      migration: "Northern Pull",
      bloom: "Ancestor Bloom"
    };

    return {
      kind,
      name: names[kind],
      severity,
      remaining: rng.int(10, 18),
      startedAt: world.generation
    };
  }

  return undefined;
}

function updateTerrain(world: World, rng: Rng): void {
  const season = (Math.sin(world.generation / 11) + 1) / 2;
  for (const cell of world.cells) {
    const event = world.currentEvent;
    const drought = event?.kind === "drought" ? event.severity : 0;
    const bloom = event?.kind === "bloom" ? event.severity : 0;
    const ash = event?.kind === "ashfall" ? event.severity : 0;
    const plague = event?.kind === "plague" ? event.severity : 0;
    const growth = cell.fertility * (0.025 + season * 0.025 + bloom * 0.03) - drought * 0.03 - ash * 0.022;
    cell.food = clamp(cell.food + growth + (rng.next() - 0.5) * 0.018);
    cell.disease = clamp(cell.disease * 0.93 + cell.moisture * 0.012 + plague * 0.045 + (cell.food > 0.82 ? 0.01 : 0));
    cell.predatorPressure = clamp(cell.predatorPressure * 0.91 + (1 - cell.food) * 0.018 + cell.elevation * 0.008 + (rng.next() - 0.5) * 0.02);
  }
}

function moveCreature(creature: Creature, world: World, rng: Rng): void {
  const distance = Math.max(1, Math.round(1 + creature.genome.speed * 2));
  const options: TerrainCell[] = [];

  for (let y = creature.y - distance; y <= creature.y + distance; y += 1) {
    for (let x = creature.x - distance; x <= creature.x + distance; x += 1) {
      if (x >= 0 && x < world.width && y >= 0 && y < world.height) {
        options.push(getCell(world, x, y));
      }
    }
  }

  const currentCell = getCell(world, creature.x, creature.y);
  const migrationBonus = world.currentEvent?.kind === "migration" ? world.currentEvent.severity * creature.genome.migrationDrive : 0;
  const best = options
    .map((cell) => ({
      cell,
      score:
        cell.food * (0.8 + creature.genome.foraging) +
        cell.fertility * 0.16 +
        migrationBonus * (cell.x / world.width) -
        cell.disease * (1 - creature.genome.immunity) * 0.72 -
        cell.predatorPressure * (1 - creature.genome.predatorSense) * 0.9 -
        climateMismatch(creature.genome, cell) * 0.34 -
        Math.hypot(cell.x - currentCell.x, cell.y - currentCell.y) * 0.02 +
        rng.next() * 0.08
    }))
    .sort((a, b) => b.score - a.score)[0];

  if (best) {
    creature.x = best.cell.x;
    creature.y = best.cell.y;
  }
}

function feedCreature(creature: Creature, cell: TerrainCell): void {
  const appetite = 0.055 + creature.genome.foraging * 0.095;
  const eaten = Math.min(cell.food, appetite);
  cell.food = clamp(cell.food - eaten);
  creature.energy = clamp(creature.energy + eaten * (0.72 + creature.genome.foraging * 0.64), -1, 1.45);
}

function applyStress(creature: Creature, cell: TerrainCell, event?: WorldEvent): void {
  const metabolicCost = 0.034 + creature.genome.metabolism * 0.045 + creature.genome.speed * 0.01;
  const climateCost = climateMismatch(creature.genome, cell) * 0.038;
  const diseaseCost = Math.max(0, cell.disease - creature.genome.immunity * 0.65) * 0.055;
  const predatorCost = Math.max(0, cell.predatorPressure - creature.genome.predatorSense * 0.7 - creature.genome.aggression * 0.18) * 0.045;
  const eventCost =
    event?.kind === "ashfall"
      ? event.severity * (0.035 - creature.genome.migrationDrive * 0.014)
      : event?.kind === "drought"
        ? event.severity * (0.028 - creature.genome.foraging * 0.01)
        : 0;

  creature.energy = round(creature.energy - metabolicCost - climateCost - diseaseCost - predatorCost - eventCost);
}

function climateMismatch(genome: Genome, cell: TerrainCell): number {
  if (cell.temperature > 0.58) {
    return Math.max(0, cell.temperature - genome.heatTolerance);
  }
  return Math.max(0, 1 - cell.temperature - genome.coldTolerance);
}

function deathCauseFor(creature: Creature, cell: TerrainCell, rng: Rng): string | undefined {
  if (creature.energy <= 0) return "starvation";
  if (creature.age > 70 + creature.genome.metabolism * 35 && rng.chance(0.35)) return "old age";
  if (cell.disease > creature.genome.immunity + 0.24 && rng.chance((cell.disease - creature.genome.immunity) * 0.22)) return "disease";
  if (cell.predatorPressure > creature.genome.predatorSense + creature.genome.aggression * 0.35 && rng.chance((cell.predatorPressure - creature.genome.predatorSense) * 0.18)) {
    return "predation";
  }
  return undefined;
}

function nearbyCreatures(creature: Creature, creatures: Creature[], radius: number): Creature[] {
  return creatures.filter(
    (candidate) =>
      candidate.id !== creature.id &&
      Math.abs(candidate.x - creature.x) <= radius &&
      Math.abs(candidate.y - creature.y) <= radius
  );
}

function chooseMate(creature: Creature, candidates: Creature[], rng: Rng): Creature | undefined {
  const compatible = candidates.filter((candidate) => genomeDistance(creature.genome, candidate.genome) < 0.42);
  if (compatible.length === 0) {
    return undefined;
  }
  return compatible.sort((a, b) => b.energy + b.genome.fertility - (a.energy + a.genome.fertility))[rng.int(0, Math.min(2, compatible.length - 1))];
}

function shouldReproduce(creature: Creature, mate: Creature, population: number, rng: Rng): boolean {
  if (creature.energy < 0.78 || mate.energy < 0.58 || creature.age < 4 || mate.age < 4) {
    return false;
  }
  const crowding = clamp(population / 720);
  const probability = (creature.genome.fertility + mate.genome.fertility) * 0.08 * (1 - crowding * 0.72);
  return rng.chance(probability);
}

function createChild(parentA: Creature, parentB: Creature, world: World, rng: Rng): Creature {
  const genome = crossover(parentA.genome, parentB.genome, rng);
  const mutations = mutate(genome, world.generation, rng);
  const speciesId = speciesIdForGenome(genome);
  const lineageId = parentA.lineageId === parentB.lineageId || rng.chance(parentA.genome.sociality) ? parentA.lineageId : parentB.lineageId;
  const id = `c-${world.nextId}`;
  world.nextId += 1;

  return {
    id,
    name: `${rng.pick(nameParts)}-${rng.int(10, 99)}`,
    x: parentA.x,
    y: parentA.y,
    age: 0,
    energy: 0.46,
    generation: world.generation,
    genome,
    speciesId,
    lineageId,
    parentIds: [parentA.id, parentB.id],
    ancestorIds: [...new Set([parentA.id, parentB.id, ...parentA.ancestorIds.slice(0, 5), ...parentB.ancestorIds.slice(0, 5)])].slice(0, 12),
    mutations,
    births: 0,
    kills: 0,
    fitness: 0
  };
}

function crossover(parentA: Genome, parentB: Genome, rng: Rng): Genome {
  const child: Genome = { ...parentA };

  for (const key of genomeKeys) {
    const blended = rng.chance(0.5) ? parentA[key] : parentB[key];
    const average = (parentA[key] + parentB[key]) / 2;
    child[key] = clamp(blended * 0.68 + average * 0.32 + (rng.next() - 0.5) * 0.025);
  }

  return child;
}

function mutate(genome: Genome, generation: number, rng: Rng): MutationRecord[] {
  const records: MutationRecord[] = [];
  for (const key of genomeKeys) {
    const rate = key === "mutationRate" ? 0.018 : genome.mutationRate;
    if (rng.chance(rate)) {
      const delta = round((rng.next() - 0.5) * 0.18);
      genome[key] = clamp(genome[key] + delta, key === "mutationRate" ? 0.006 : 0, key === "mutationRate" ? 0.12 : 1);
      records.push({ generation, gene: key, delta });
    }
  }
  return records;
}

function genomeDistance(left: Genome, right: Genome): number {
  const total = genomeKeys.reduce((sum, key) => sum + Math.abs(left[key] - right[key]), 0);
  return total / genomeKeys.length;
}

function calculateFitness(creature: Creature, cell: TerrainCell): number {
  const youth = Math.max(0, 1 - creature.age / 95);
  const survival = creature.energy * 0.5 + creature.births * 0.18 + youth * 0.1;
  const adaptation = 1 - climateMismatch(creature.genome, cell) - cell.disease * (1 - creature.genome.immunity) * 0.25 - cell.predatorPressure * (1 - creature.genome.predatorSense) * 0.2;
  return round(clamp(survival * 0.62 + adaptation * 0.38));
}

function getCell(world: World, x: number, y: number): TerrainCell {
  return world.cells[y * world.width + x];
}

function summarize(world: World, births: number, deaths: number, extinctions: string[]): GenerationSummary {
  const average = (values: number[]) => round(values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length));
  const averageCreatureGenome = averageGenome(world.creatures);
  return {
    generation: world.generation,
    population: world.creatures.length,
    species: world.species.length,
    births,
    deaths,
    extinctions,
    averageFitness: average(world.creatures.map((creature) => creature.fitness)),
    averageFood: average(world.cells.map((cell) => cell.food)),
    averageDisease: average(world.cells.map((cell) => cell.disease)),
    averagePredatorPressure: average(world.cells.map((cell) => cell.predatorPressure)),
    diversity: round(world.species.length / Math.max(1, Math.sqrt(world.creatures.length))),
    dominantTrait: dominantTrait(averageCreatureGenome),
    event: world.currentEvent ? { ...world.currentEvent } : undefined
  };
}
