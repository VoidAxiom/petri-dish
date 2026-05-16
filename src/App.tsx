import { useEffect, useMemo, useState } from "react";
import { createWorld, genomeKeys, speciesColor, stepWorld, type Creature, type Genome, type World } from "./simulation";

const demoSeeds = ["mythic-lagoon-17", "glass-drought-41", "ember-reef-93"];

export default function App() {
  const [seed, setSeed] = useState(demoSeeds[0]);
  const [world, setWorld] = useState(() => createWorld(seed));
  const [running, setRunning] = useState(true);
  const [selectedId, setSelectedId] = useState<string | undefined>(world.creatures[0]?.id);
  const [debug, setDebug] = useState(false);
  const selectedCreature = useMemo(
    () => world.creatures.find((creature) => creature.id === selectedId) ?? world.creatures[0],
    [selectedId, world.creatures]
  );
  const latest = world.summaries.at(-1)!;

  useEffect(() => {
    if (!running) {
      return;
    }

    const timer = window.setInterval(() => {
      setWorld((current) => stepWorld(current));
    }, 420);

    return () => window.clearInterval(timer);
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
          <WorldMap world={world} selectedId={selectedCreature?.id} debug={debug} onSelect={setSelectedId} />
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
        </div>

        <aside className="side-panel">
          <CreatureInspector creature={selectedCreature} world={world} />
          <SpeciesPanel world={world} />
        </aside>
      </section>

      <section className="dashboard-grid">
        <Metric label="Food" value={latest.averageFood} tone="green" />
        <Metric label="Disease" value={latest.averageDisease} tone="red" />
        <Metric label="Predators" value={latest.averagePredatorPressure} tone="amber" />
        <Metric label="Diversity" value={latest.diversity} tone="cyan" />
        <Metric label="Fitness" value={latest.averageFitness} tone="violet" />
      </section>

      <section className="lower-grid">
        <Timeline world={world} />
        <ExtinctionLog world={world} />
      </section>
    </main>
  );
}

function WorldMap({
  world,
  selectedId,
  debug,
  onSelect
}: {
  world: World;
  selectedId?: string;
  debug: boolean;
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
          opacity={0.54 + cell.food * 0.42}
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
      {world.creatures.map((creature) => (
        <circle
          key={creature.id}
          cx={creature.x + 0.5}
          cy={creature.y + 0.5}
          r={creature.id === selectedId ? 0.58 : 0.34 + creature.energy * 0.08}
          fill={speciesColor(creature.speciesId)}
          stroke={creature.id === selectedId ? "#ffffff" : "rgba(255,255,255,0.18)"}
          strokeWidth={creature.id === selectedId ? 0.22 : 0.06}
        />
      ))}
    </svg>
  );
}

function CreatureInspector({ creature, world }: { creature?: Creature; world: World }) {
  if (!creature) {
    return <section className="panel">No surviving creatures.</section>;
  }

  const cell = world.cells[creature.y * world.width + creature.x];

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
      <GenomeBars genome={creature.genome} />
      <div className="ancestry">
        <p className="eyebrow">Ancestry</p>
        <p>{creature.parentIds.length ? creature.parentIds.join(" x ") : "founder generation"}</p>
        <p>{creature.mutations.length ? `${creature.mutations.length} mutations in this genome` : "no recorded mutations"}</p>
      </div>
    </section>
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

function ExtinctionLog({ world }: { world: World }) {
  const events = world.summaries
    .filter((summary) => summary.event || summary.extinctions.length > 0 || summary.deaths > summary.births * 2)
    .slice(-8)
    .reverse();

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Extinction report</p>
          <h2>World memory</h2>
        </div>
      </div>
      <div className="log-list">
        {events.length ? (
          events.map((event) => (
            <div key={`${event.generation}-${event.deaths}-${event.births}`} className="log-row">
              <strong>Gen {event.generation}</strong>
              <span>
                {event.event?.name ?? "mortality spike"} · births {event.births}, deaths {event.deaths}
                {event.extinctions.length ? ` · ${event.extinctions.length} species lost` : ""}
              </span>
            </div>
          ))
        ) : (
          <p className="quiet">No collapses recorded yet.</p>
        )}
      </div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="fact">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
