import { useEffect, useMemo, useRef, useState } from "react";
import {
  createWorld,
  explainCreaturePressure,
  genomeKeys,
  speciesColor,
  stepWorld,
  type Creature,
  type CreaturePressureReport,
  type Genome,
  type SimulationEvent,
  type World
} from "./simulation";

const demoSeeds = ["mythic-lagoon-17", "glass-drought-41", "ember-reef-93"];
const mapModes = ["terrain", "food", "disease", "predators", "temperature"] as const;
const simulationTickMs = 420;

type MapMode = (typeof mapModes)[number];

export default function App() {
  const [seed, setSeed] = useState(demoSeeds[0]);
  const [world, setWorld] = useState(() => createWorld(seed));
  const [running, setRunning] = useState(true);
  const [selectedId, setSelectedId] = useState<string | undefined>(world.creatures[0]?.id);
  const [debug, setDebug] = useState(false);
  const [mapMode, setMapMode] = useState<MapMode>("terrain");
  const lastFrameTick = useRef<number | undefined>(undefined);
  const selectedCreature = useMemo(
    () => world.creatures.find((creature) => creature.id === selectedId) ?? world.creatures[0],
    [selectedId, world.creatures]
  );
  const latest = world.summaries.at(-1)!;

  useEffect(() => {
    if (!running) {
      lastFrameTick.current = undefined;
      return;
    }

    let frameId = 0;
    const animate = (time: number) => {
      if (lastFrameTick.current === undefined) {
        lastFrameTick.current = time;
      }

      if (time - lastFrameTick.current >= simulationTickMs) {
        lastFrameTick.current = time;
        setWorld((current) => stepWorld(current));
      }
      frameId = window.requestAnimationFrame(animate);
    };

    frameId = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(frameId);
      lastFrameTick.current = undefined;
    };
  }, [running]);

  function reset(nextSeed = seed) {
    const nextWorld = createWorld(nextSeed);
    setSeed(nextSeed);
    setWorld(nextWorld);
    setSelectedId(nextWorld.creatures[0]?.id);
  }

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Deterministic civilization lab</p>
          <h1>Petri Dish</h1>
        </div>
        <div className="control-row">
          <select value={seed} onChange={(event) => reset(event.target.value)} aria-label="Seed">
            {demoSeeds.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => setRunning((value) => !value)}>
            {running ? "Pause" : "Run"}
          </button>
          <button type="button" onClick={() => setWorld((current) => stepWorld(current))}>
            Step
          </button>
          <button type="button" onClick={() => reset()}>
            Reset
          </button>
          <label className="toggle">
            <input type="checkbox" checked={debug} onChange={(event) => setDebug(event.target.checked)} />
            Debug
          </label>
        </div>
      </section>

      <section className="lab-grid">
        <div className="map-stage">
          <div className="map-toolbar" aria-label="Map mode">
            <div className="map-mode-buttons">
              {mapModes.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={mode === mapMode ? "active" : ""}
                  aria-pressed={mode === mapMode}
                  onClick={() => setMapMode(mode)}
                >
                  {mode}
                </button>
              ))}
            </div>
            <MapLegend mode={mapMode} />
          </div>
          <WorldMap
            world={world}
            selectedId={selectedCreature?.id}
            selectedLineageId={selectedCreature?.lineageId}
            debug={debug}
            mode={mapMode}
            onSelect={setSelectedId}
          />
          <div className="event-strip">
            <div>
              <strong>Generation {world.generation}</strong>
              <span>{world.currentEvent ? `${world.currentEvent.name} (${world.currentEvent.remaining})` : "No active catastrophe"}</span>
            </div>
            <div>
              <strong>{latest.population}</strong>
              <span>living agents</span>
            </div>
            <div>
              <strong>{latest.species}</strong>
              <span>species</span>
            </div>
            <div>
              <strong>{latest.dominantTrait}</strong>
              <span>dominant trait</span>
            </div>
          </div>

          <section className="dashboard-grid">
            <Metric label="Food" value={latest.averageFood} tone="green" />
            <Metric label="Disease" value={latest.averageDisease} tone="red" />
            <Metric label="Predators" value={latest.averagePredatorPressure} tone="amber" />
            <Metric label="Diversity" value={latest.diversity} tone="cyan" />
            <Metric label="Fitness" value={latest.averageFitness} tone="violet" />
          </section>

          <section className="lower-grid">
            <Timeline world={world} />
            <WorldMemory world={world} />
          </section>
        </div>

        <aside className="side-panel">
          <CreatureInspector creature={selectedCreature} world={world} />
          <DynastyPanel creature={selectedCreature} world={world} />
          <SpeciesPanel world={world} />
        </aside>
      </section>
    </main>
  );
}

function WorldMap({
  world,
  selectedId,
  selectedLineageId,
  debug,
  mode,
  onSelect
}: {
  world: World;
  selectedId?: string;
  selectedLineageId?: string;
  debug: boolean;
  mode: MapMode;
  onSelect: (id: string) => void;
}) {
  const viewBox = `0 0 ${world.width} ${world.height}`;

  function handleClick(event: React.MouseEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * world.width);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * world.height);
    const nearest = world.creatures
      .map((creature) => ({ creature, distance: Math.hypot(creature.x - x, creature.y - y) }))
      .sort((a, b) => a.distance - b.distance)[0]?.creature;

    if (nearest) {
      onSelect(nearest.id);
    }
  }

  return (
    <svg className="world-map" viewBox={viewBox} role="img" aria-label="Living simulation map" onClick={handleClick}>
      {world.cells.map((cell) => (
        <rect
          key={`${cell.x}-${cell.y}`}
          x={cell.x}
          y={cell.y}
          width="1"
          height="1"
          className={`terrain terrain-${cell.biome}`}
          style={{ fill: cellFill(cell, mode) }}
          opacity={cellOpacity(cell, mode)}
        />
      ))}
      {debug &&
        world.cells
          .filter((cell) => cell.disease > 0.55 || cell.predatorPressure > 0.55)
          .map((cell) => (
            <circle
              key={`debug-${cell.x}-${cell.y}`}
              cx={cell.x + 0.5}
              cy={cell.y + 0.5}
              r={cell.disease > cell.predatorPressure ? 0.22 : 0.32}
              fill={cell.disease > cell.predatorPressure ? "#ef4444" : "#f97316"}
              opacity="0.48"
            />
          ))}
      {world.creatures.map((creature) => {
        const isSelected = creature.id === selectedId;
        const isLineage = creature.lineageId === selectedLineageId;

        return (
          <circle
            key={creature.id}
            className={`creature-marker${isLineage ? " lineage-marker" : ""}${isSelected ? " selected-marker" : ""}`}
            cx={creature.x + 0.5}
            cy={creature.y + 0.5}
            r={isSelected ? 0.62 : isLineage ? 0.48 + creature.energy * 0.08 : 0.34 + creature.energy * 0.08}
            fill={speciesColor(creature.speciesId)}
            stroke={isSelected ? "#ffffff" : isLineage ? "#fde68a" : "rgba(255,255,255,0.18)"}
            strokeWidth={isSelected ? 0.24 : isLineage ? 0.16 : 0.06}
            opacity={selectedLineageId && !isLineage ? 0.72 : 1}
          />
        );
      })}
    </svg>
  );
}

function MapLegend({ mode }: { mode: MapMode }) {
  if (mode === "terrain") {
    return (
      <div className="map-legend terrain-legend" aria-label="Terrain legend">
        {["mire", "steppe", "reef", "fungal", "basalt", "ice"].map((biome) => (
          <span key={biome}>
            <i className={`terrain-${biome}`} />
            {biome}
          </span>
        ))}
      </div>
    );
  }

  const labels: Record<Exclude<MapMode, "terrain">, [string, string]> = {
    food: ["scarce", "abundant"],
    disease: ["clean", "infected"],
    predators: ["safe", "hunted"],
    temperature: ["cold", "hot"]
  };

  return (
    <div className={`map-legend pressure-legend pressure-legend-${mode}`} aria-label={`${mode} legend`}>
      <span>{labels[mode][0]}</span>
      <i />
      <span>{labels[mode][1]}</span>
    </div>
  );
}

function CreatureInspector({ creature, world }: { creature?: Creature; world: World }) {
  if (!creature) {
    return <section className="panel">No surviving creatures.</section>;
  }

  const cell = world.cells[creature.y * world.width + creature.x];
  const pressure = explainCreaturePressure(creature, cell, world.currentEvent, world.creatures.length);

  return (
    <section className="panel inspector">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Selected organism</p>
          <h2>{creature.name}</h2>
        </div>
        <span className="species-chip" style={{ borderColor: speciesColor(creature.speciesId), color: speciesColor(creature.speciesId) }}>
          {creature.speciesId}
        </span>
      </div>
      <div className="fact-grid">
        <Fact label="Energy" value={creature.energy.toFixed(2)} />
        <Fact label="Age" value={creature.age} />
        <Fact label="Fitness" value={creature.fitness.toFixed(2)} />
        <Fact label="Births" value={creature.births} />
        <Fact label="Biome" value={cell.biome} />
        <Fact label="Lineage" value={creature.lineageId} />
      </div>
      <SurvivalPressurePanel pressure={pressure} />
      <GenomeBars genome={creature.genome} />
      <div className="ancestry">
        <p className="eyebrow">Ancestry</p>
        <p>{creature.parentIds.length ? creature.parentIds.join(" x ") : "founder generation"}</p>
        <p>{creature.mutations.length ? `${creature.mutations.length} mutations in this genome` : "no recorded mutations"}</p>
      </div>
    </section>
  );
}

function SurvivalPressurePanel({ pressure }: { pressure: CreaturePressureReport }) {
  return (
    <div className="survival-pressure">
      <div className="survival-heading">
        <div>
          <p className="eyebrow">Survival pressures</p>
          <strong>Primary risk: {pressure.primaryRisk}</strong>
        </div>
        <span>fitness {pressure.estimatedFitness.toFixed(2)}</span>
      </div>
      <div className="survival-summary">
        <Fact label="Projected energy" value={pressure.projectedEnergy.toFixed(2)} />
        <Fact label="Stress cost" value={pressure.costs.total.toFixed(2)} />
        <Fact label="Breed ready" value={`${Math.round(pressure.reproductionReadiness * 100)}%`} />
      </div>
      <div className="pressure-list">
        {pressure.metrics.map((metric) => (
          <div key={metric.kind} className={`pressure-row pressure-row-${metric.kind}`}>
            <div className="pressure-row-top">
              <strong>{metric.label}</strong>
              <span>{Math.round(metric.value * 100)}%</span>
            </div>
            <div className="pressure-bar" aria-label={`${metric.label} pressure`}>
              <i style={{ width: `${Math.round(metric.value * 100)}%` }} />
            </div>
            <p>{metric.detail}</p>
            <small>
              {metric.trait}: {metric.traitValue.toFixed(2)}
            </small>
          </div>
        ))}
      </div>
    </div>
  );
}

function DynastyPanel({ creature, world }: { creature?: Creature; world: World }) {
  if (!creature) {
    return <section className="panel">No dynasty selected.</section>;
  }

  const cell = world.cells[creature.y * world.width + creature.x];
  const livingLineage = world.creatures.filter((candidate) => candidate.lineageId === creature.lineageId);
  const archivedLineage = world.graveyard.filter((candidate) => candidate.lineageId === creature.lineageId);
  const allLineage = [...livingLineage, ...archivedLineage];
  const parentNames = creature.parentIds.map((id) => creatureName(id, world));
  const lineageEvents = world.events
    .filter((event) => event.lineageId === creature.lineageId || event.creatureId === creature.id || event.parentIds?.includes(creature.id))
    .slice(-6)
    .reverse();
  const mutationTrail = allLineage.flatMap((candidate) =>
    candidate.mutations.map((mutation) => ({
      creature: candidate.name,
      ...mutation
    }))
  );
  const averageFitness =
    livingLineage.reduce((sum, candidate) => sum + candidate.fitness, 0) / Math.max(1, livingLineage.length);
  const totalBirths = allLineage.reduce((sum, candidate) => sum + candidate.births, 0);
  const speciesTouched = new Set(allLineage.map((candidate) => candidate.speciesId)).size;

  return (
    <section className="panel dynasty-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Dynasty</p>
          <h2>{creature.lineageId}</h2>
        </div>
        <span className="lineage-badge">{livingLineage.length} living</span>
      </div>

      <div className="fact-grid dynasty-facts">
        <Fact label="Archived dead" value={archivedLineage.length} />
        <Fact label="Total births" value={totalBirths} />
        <Fact label="Avg fitness" value={averageFitness.toFixed(2)} />
        <Fact label="Species touched" value={speciesTouched} />
        <Fact label="Mutations" value={mutationTrail.length} />
        <Fact label="Ancestors" value={creature.ancestorIds.length || "founder"} />
      </div>

      <div className="lineage-thread">
        <p className="eyebrow">Parentage</p>
        <strong>{parentNames.length ? parentNames.join(" x ") : "founder generation"}</strong>
        <span>
          age {creature.age} · born generation {creature.generation} · {creature.births} direct births
        </span>
      </div>

      <LineageLens creature={creature} world={world} />

      <div className="pressure-grid">
        <div>
          <span>Food</span>
          <strong>{cell.food.toFixed(2)}</strong>
        </div>
        <div>
          <span>Disease</span>
          <strong>{cell.disease.toFixed(2)}</strong>
        </div>
        <div>
          <span>Predators</span>
          <strong>{cell.predatorPressure.toFixed(2)}</strong>
        </div>
      </div>

      <MiniLedger
        title="Mutation trail"
        empty="no inherited mutations recorded"
        items={mutationTrail.slice(-5).reverse().map((mutation) => ({
          key: `${mutation.creature}-${mutation.generation}-${mutation.gene}-${mutation.delta}`,
          label: `g${mutation.generation}`,
          text: `${mutation.creature} shifted ${mutation.gene} by ${mutation.delta}`
        }))}
      />

      <MiniLedger
        title="Recent lineage events"
        empty="no recent lineage events"
        items={lineageEvents.map((event) => ({
          key: event.id,
          label: `g${event.generation}`,
          text: event.message
        }))}
      />
    </section>
  );
}

function LineageLens({ creature, world }: { creature: Creature; world: World }) {
  const relatives = lineageRelatives(creature, world);
  const species = world.species.find((item) => item.id === creature.speciesId);
  const parentGenomes = creature.parentIds
    .map((id) => findCreatureRecord(id, world)?.creature.genome)
    .filter((genome): genome is Genome => Boolean(genome));
  const parentAverage = averageGenomes(parentGenomes);
  const speciesDeltas = species ? topGenomeDeltas(creature.genome, species.averageGenome, 4) : [];
  const parentDeltas = parentAverage ? topGenomeDeltas(creature.genome, parentAverage, 3) : [];

  return (
    <div className="lineage-lens">
      <div className="lineage-lens-heading">
        <div>
          <p className="eyebrow">Lineage lens</p>
          <strong>{relatives.length} tracked relatives</strong>
        </div>
        <span>{world.creatures.filter((candidate) => candidate.lineageId === creature.lineageId).length} alive on map</span>
      </div>
      <div className="family-thread" aria-label="Lineage family thread">
        {relatives.map((relative) => (
          <div key={`${relative.role}-${relative.creature.id}`} className={`family-node family-node-${relative.status}`}>
            <strong>{relative.creature.name}</strong>
            <span>
              {relative.role} · {relative.status} · g{relative.creature.generation}
            </span>
          </div>
        ))}
      </div>
      <div className="genome-compare">
        <GenomeDeltaList title="Species drift" items={speciesDeltas} empty="no species baseline yet" />
        <GenomeDeltaList title="Parent drift" items={parentDeltas} empty="founder genome has no parent baseline" />
      </div>
    </div>
  );
}

function GenomeDeltaList({
  title,
  items,
  empty
}: {
  title: string;
  items: Array<{ gene: keyof Genome; delta: number; value: number; baseline: number }>;
  empty: string;
}) {
  return (
    <div className="delta-list">
      <p className="eyebrow">{title}</p>
      {items.length ? (
        items.map((item) => (
          <div key={`${title}-${item.gene}`} className="delta-row">
            <strong>{item.gene}</strong>
            <span className={item.delta >= 0 ? "delta-positive" : "delta-negative"}>
              {item.delta >= 0 ? "+" : ""}
              {item.delta.toFixed(2)}
            </span>
            <small>
              {item.value.toFixed(2)} vs {item.baseline.toFixed(2)}
            </small>
          </div>
        ))
      ) : (
        <p className="quiet">{empty}</p>
      )}
    </div>
  );
}

function GenomeBars({ genome }: { genome: Genome }) {
  return (
    <div className="genome-bars">
      {genomeKeys.map((key) => (
        <div key={key} className="gene-row">
          <span>{key}</span>
          <div>
            <i style={{ width: `${Math.round(genome[key] * 100)}%` }} />
          </div>
          <b>{genome[key].toFixed(2)}</b>
        </div>
      ))}
    </div>
  );
}

function SpeciesPanel({ world }: { world: World }) {
  return (
    <section className="panel species-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Clans and species</p>
          <h2>Survivors</h2>
        </div>
      </div>
      <div className="species-list">
        {world.species.slice(0, 8).map((species) => (
          <div key={species.id} className="species-row">
            <span className="swatch" style={{ background: species.color }} />
            <div>
              <strong>{species.id}</strong>
              <small>
                {species.population} alive · {species.lineageCount} dynasties · {species.dominantBiome}
              </small>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`metric metric-${tone}`}>
      <span>{label}</span>
      <strong>{value.toFixed(2)}</strong>
    </div>
  );
}

function Timeline({ world }: { world: World }) {
  const points = world.summaries.slice(-80);
  const maxPopulation = Math.max(1, ...points.map((point) => point.population));
  const firstGeneration = points[0]?.generation ?? 0;
  const generationSpan = Math.max(1, (points.at(-1)?.generation ?? firstGeneration) - firstGeneration);
  const ledgerMarkers = world.events
    .filter((event) => event.kind === "catastrophe" || event.kind === "extinction" || event.kind === "speciation")
    .filter((event) => event.generation >= firstGeneration)
    .slice(-36);
  const path = points
    .map((point, index) => {
      const x = (index / Math.max(1, points.length - 1)) * 100;
      const y = 48 - (point.population / maxPopulation) * 42;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <section className="panel timeline-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Population curve</p>
          <h2>Selection pressure</h2>
        </div>
      </div>
      <svg className="timeline" viewBox="0 0 100 52" preserveAspectRatio="none">
        <path d={path} fill="none" stroke="#38bdf8" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
        {ledgerMarkers.map((event) => {
          const x = ((event.generation - firstGeneration) / generationSpan) * 100;
          return (
            <circle
              key={event.id}
              cx={x}
              cy={event.kind === "catastrophe" ? 8 : event.kind === "extinction" ? 44 : 18}
              r={event.kind === "catastrophe" ? 1.7 : 1.2}
              fill={eventColor(event.kind)}
              opacity="0.88"
            />
          );
        })}
        {points.map((point, index) =>
          point.event ? (
            <line
              key={`${point.generation}-${point.event.name}`}
              x1={(index / Math.max(1, points.length - 1)) * 100}
              x2={(index / Math.max(1, points.length - 1)) * 100}
              y1="4"
              y2="50"
              stroke="#f97316"
              strokeWidth="0.8"
              vectorEffect="non-scaling-stroke"
            />
          ) : null
        )}
      </svg>
    </section>
  );
}

function WorldMemory({ world }: { world: World }) {
  const events = world.events.slice(-10).reverse();

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Event ledger</p>
          <h2>World memory</h2>
        </div>
      </div>
      <div className="log-list">
        {events.length ? (
          events.map((event) => (
            <div key={event.id} className="log-row">
              <strong>Gen {event.generation}</strong>
              <span className={`event-kind event-kind-${event.kind}`}>{event.kind}</span>
              <span>{event.message}</span>
            </div>
          ))
        ) : (
          <p className="quiet">No causal events recorded yet.</p>
        )}
      </div>
    </section>
  );
}

function MiniLedger({
  title,
  empty,
  items
}: {
  title: string;
  empty: string;
  items: Array<{ key: string; label: string; text: string }>;
}) {
  return (
    <div className="mini-ledger">
      <p className="eyebrow">{title}</p>
      {items.length ? (
        items.map((item) => (
          <div key={item.key} className="mini-ledger-row">
            <strong>{item.label}</strong>
            <span>{item.text}</span>
          </div>
        ))
      ) : (
        <p className="quiet">{empty}</p>
      )}
    </div>
  );
}

function creatureName(id: string, world: World): string {
  return world.creatures.find((creature) => creature.id === id)?.name ?? world.graveyard.find((creature) => creature.id === id)?.name ?? id;
}

function findCreatureRecord(id: string, world: World): { creature: Creature; status: "living" | "dead" } | undefined {
  const living = world.creatures.find((creature) => creature.id === id);
  if (living) return { creature: living, status: "living" };
  const dead = world.graveyard.find((creature) => creature.id === id);
  if (dead) return { creature: dead, status: "dead" };
  return undefined;
}

function lineageRelatives(creature: Creature, world: World): Array<{ creature: Creature; role: string; status: "living" | "dead" }> {
  const records = [
    { creature, role: "selected", status: "living" as const },
    ...creature.parentIds
      .map((id) => findCreatureRecord(id, world))
      .filter((record): record is { creature: Creature; status: "living" | "dead" } => Boolean(record))
      .map((record) => ({ ...record, role: "parent" })),
    ...creature.ancestorIds
      .map((id) => findCreatureRecord(id, world))
      .filter((record): record is { creature: Creature; status: "living" | "dead" } => Boolean(record))
      .map((record) => ({ ...record, role: "ancestor" }))
  ];
  const seen = new Set<string>();

  return records.filter((record) => {
    if (seen.has(record.creature.id)) return false;
    seen.add(record.creature.id);
    return true;
  }).slice(0, 7);
}

function averageGenomes(genomes: Genome[]): Genome | undefined {
  if (genomes.length === 0) return undefined;
  const totals: Genome = {
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

  for (const genome of genomes) {
    for (const key of genomeKeys) {
      totals[key] += genome[key];
    }
  }

  return {
    speed: totals.speed / genomes.length,
    vision: totals.vision / genomes.length,
    metabolism: totals.metabolism / genomes.length,
    fertility: totals.fertility / genomes.length,
    aggression: totals.aggression / genomes.length,
    sociality: totals.sociality / genomes.length,
    foraging: totals.foraging / genomes.length,
    immunity: totals.immunity / genomes.length,
    heatTolerance: totals.heatTolerance / genomes.length,
    coldTolerance: totals.coldTolerance / genomes.length,
    predatorSense: totals.predatorSense / genomes.length,
    migrationDrive: totals.migrationDrive / genomes.length,
    mutationRate: totals.mutationRate / genomes.length
  };
}

function topGenomeDeltas(genome: Genome, baseline: Genome, count: number): Array<{ gene: keyof Genome; delta: number; value: number; baseline: number }> {
  return genomeKeys
    .map((gene) => ({
      gene,
      delta: genome[gene] - baseline[gene],
      value: genome[gene],
      baseline: baseline[gene]
    }))
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta))
    .slice(0, count);
}

function cellFill(cell: World["cells"][number], mode: MapMode): string | undefined {
  if (mode === "terrain") return undefined;
  if (mode === "food") return `hsl(${42 + cell.food * 82} 68% ${18 + cell.food * 28}%)`;
  if (mode === "disease") return `hsl(${355 - cell.disease * 25} 74% ${13 + cell.disease * 42}%)`;
  if (mode === "predators") return `hsl(${35 - cell.predatorPressure * 28} 82% ${15 + cell.predatorPressure * 38}%)`;
  return `hsl(${210 - cell.temperature * 180} 72% ${26 + cell.temperature * 18}%)`;
}

function cellOpacity(cell: World["cells"][number], mode: MapMode): number {
  if (mode === "terrain") return 0.54 + cell.food * 0.42;
  if (mode === "food") return 0.56 + cell.food * 0.42;
  if (mode === "disease") return 0.5 + cell.disease * 0.48;
  if (mode === "predators") return 0.5 + cell.predatorPressure * 0.48;
  return 0.74;
}

function eventColor(kind: SimulationEvent["kind"]): string {
  if (kind === "catastrophe") return "#f97316";
  if (kind === "extinction") return "#ef4444";
  if (kind === "speciation") return "#22c55e";
  return "#38bdf8";
}

function Fact({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="fact">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
