import { round } from "./rng";
import type { GenerationSummary, SimulationEvent, World, WorldEventKind } from "./types";

export type EventImpactKind = "catastrophe" | "extinction";
export type ImpactMetricKey = "population" | "species" | "food" | "disease" | "predators" | "fitness" | "diversity";

export interface ImpactMetricDelta {
  key: ImpactMetricKey;
  label: string;
  before: number;
  after: number;
  delta: number;
}

export interface EventImpactReport {
  id: string;
  kind: EventImpactKind;
  title: string;
  generation: number;
  eventKind?: WorldEventKind;
  severity?: number;
  beforeGeneration: number;
  afterGeneration: number;
  windowBirths: number;
  windowDeaths: number;
  extinctions: string[];
  extinctionCount: number;
  metrics: ImpactMetricDelta[];
  headline: string;
}

export interface EventImpactOptions {
  beforeWindow?: number;
  afterWindow?: number;
  maxReports?: number;
}

const metricDefinitions: Array<{ key: ImpactMetricKey; label: string; value: (summary: GenerationSummary) => number }> = [
  { key: "population", label: "Population", value: (summary) => summary.population },
  { key: "species", label: "Species", value: (summary) => summary.species },
  { key: "food", label: "Food", value: (summary) => summary.averageFood },
  { key: "disease", label: "Disease", value: (summary) => summary.averageDisease },
  { key: "predators", label: "Predators", value: (summary) => summary.averagePredatorPressure },
  { key: "fitness", label: "Fitness", value: (summary) => summary.averageFitness },
  { key: "diversity", label: "Diversity", value: (summary) => summary.diversity }
];

export function buildEventImpactReports(world: World, options: EventImpactOptions = {}): EventImpactReport[] {
  const beforeWindow = options.beforeWindow ?? 8;
  const afterWindow = options.afterWindow ?? 14;
  const maxReports = options.maxReports ?? 8;
  const summaries = [...world.summaries].sort((left, right) => left.generation - right.generation);
  if (summaries.length === 0) {
    return [];
  }

  const catastropheReports = world.events
    .filter((event) => event.kind === "catastrophe")
    .map((event) => impactForEvent(event, summaries, world.events, beforeWindow, afterWindow));
  const extinctionReports = [...extinctionClusters(world.events).entries()].map(([generation, events]) =>
    impactForExtinctionCluster(generation, events, summaries, world.events, beforeWindow, afterWindow)
  );

  return [...catastropheReports, ...extinctionReports]
    .filter((report): report is EventImpactReport => Boolean(report))
    .sort((left, right) => right.generation - left.generation || (left.kind === "catastrophe" ? -1 : 1))
    .slice(0, maxReports);
}

function impactForEvent(
  event: SimulationEvent,
  summaries: GenerationSummary[],
  events: SimulationEvent[],
  beforeWindow: number,
  afterWindow: number
): EventImpactReport | undefined {
  const before = summaryAtOrBefore(summaries, event.generation - beforeWindow);
  const after = summaryAtOrAfter(summaries, Math.min(event.generation + afterWindow, summaries.at(-1)!.generation));
  if (!before || !after) return undefined;
  const window = windowStats(summaries, events, before.generation, after.generation);
  const metrics = metricDeltas(before, after);

  return {
    id: `impact-${event.id}`,
    kind: "catastrophe",
    title: event.message.replace(/\.$/, ""),
    generation: event.generation,
    eventKind: event.eventKind,
    severity: event.severity,
    beforeGeneration: before.generation,
    afterGeneration: after.generation,
    windowBirths: window.births,
    windowDeaths: window.deaths,
    extinctions: window.extinctions,
    extinctionCount: window.extinctions.length,
    metrics,
    headline: headlineFor(metrics, window.extinctions.length)
  };
}

function impactForExtinctionCluster(
  generation: number,
  extinctionEvents: SimulationEvent[],
  summaries: GenerationSummary[],
  events: SimulationEvent[],
  beforeWindow: number,
  afterWindow: number
): EventImpactReport | undefined {
  const before = summaryAtOrBefore(summaries, generation - beforeWindow);
  const after = summaryAtOrAfter(summaries, Math.min(generation + afterWindow, summaries.at(-1)!.generation));
  if (!before || !after) return undefined;
  const window = windowStats(summaries, events, before.generation, after.generation);
  const extinctions = [...new Set(extinctionEvents.map((event) => event.speciesId).filter((id): id is string => Boolean(id)))];
  const metrics = metricDeltas(before, after);

  return {
    id: `impact-extinction-${generation}`,
    kind: "extinction",
    title: `${extinctions.length} species disappeared near generation ${generation}`,
    generation,
    beforeGeneration: before.generation,
    afterGeneration: after.generation,
    windowBirths: window.births,
    windowDeaths: window.deaths,
    extinctions,
    extinctionCount: extinctions.length,
    metrics,
    headline: headlineFor(metrics, extinctions.length)
  };
}

function extinctionClusters(events: SimulationEvent[]): Map<number, SimulationEvent[]> {
  const clusters = new Map<number, SimulationEvent[]>();
  for (const event of events) {
    if (event.kind !== "extinction") continue;
    const current = clusters.get(event.generation) ?? [];
    current.push(event);
    clusters.set(event.generation, current);
  }
  return clusters;
}

function windowStats(summaries: GenerationSummary[], events: SimulationEvent[], beforeGeneration: number, afterGeneration: number) {
  const windowSummaries = summaries.filter((summary) => summary.generation > beforeGeneration && summary.generation <= afterGeneration);
  const extinctions = events
    .filter((event) => event.kind === "extinction" && event.generation > beforeGeneration && event.generation <= afterGeneration)
    .map((event) => event.speciesId)
    .filter((id): id is string => Boolean(id));

  return {
    births: windowSummaries.reduce((sum, summary) => sum + summary.births, 0),
    deaths: windowSummaries.reduce((sum, summary) => sum + summary.deaths, 0),
    extinctions: [...new Set(extinctions)]
  };
}

function metricDeltas(before: GenerationSummary, after: GenerationSummary): ImpactMetricDelta[] {
  return metricDefinitions.map((definition) => {
    const beforeValue = definition.value(before);
    const afterValue = definition.value(after);
    return {
      key: definition.key,
      label: definition.label,
      before: round(beforeValue),
      after: round(afterValue),
      delta: round(afterValue - beforeValue)
    };
  });
}

function summaryAtOrBefore(summaries: GenerationSummary[], generation: number): GenerationSummary | undefined {
  return [...summaries].reverse().find((summary) => summary.generation <= generation) ?? summaries[0];
}

function summaryAtOrAfter(summaries: GenerationSummary[], generation: number): GenerationSummary | undefined {
  return summaries.find((summary) => summary.generation >= generation) ?? summaries.at(-1);
}

function headlineFor(metrics: ImpactMetricDelta[], extinctionCount: number): string {
  const population = metrics.find((metric) => metric.key === "population")!;
  const species = metrics.find((metric) => metric.key === "species")!;
  const pressure = metrics
    .filter((metric) => metric.key === "food" || metric.key === "disease" || metric.key === "predators")
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta))[0];
  const populationPhrase =
    population.delta === 0 ? "population held steady" : `population ${population.delta > 0 ? "rose" : "fell"} by ${Math.abs(population.delta)}`;
  const extinctionPhrase = extinctionCount > 0 ? `, ${extinctionCount} species lost` : species.delta < 0 ? `, species fell by ${Math.abs(species.delta)}` : "";
  const pressurePhrase = pressure && pressure.delta !== 0 ? `, ${pressure.label.toLowerCase()} ${pressure.delta > 0 ? "up" : "down"} ${Math.abs(pressure.delta)}` : "";
  return `${populationPhrase}${extinctionPhrase}${pressurePhrase}`;
}
