import { describe, expect, it } from "vitest";
import { createSimulationReport, formatSimulationReport } from "./report";

const config = {
  seed: "mythic-lagoon-17",
  generations: 180,
  width: 28,
  height: 16,
  initialPopulation: 90
};

describe("simulation reports", () => {
  it("creates stable signatures for the same long-horizon run", () => {
    const first = createSimulationReport(config);
    const second = createSimulationReport(config);

    expect(first.signature).toBe(second.signature);
    expect(first.final).toEqual(second.final);
    expect(first.totals).toEqual(second.totals);
  });

  it("captures real long-run pressure and event chronology", () => {
    const report = createSimulationReport(config);

    expect(report.final.generation).toBe(180);
    expect(report.populationCurve.length).toBeLessThanOrEqual(28);
    expect(report.totals.births + report.totals.deaths).toBeGreaterThan(0);
    expect(report.totals.catastrophes).toBeGreaterThan(0);
    expect(report.recentEvents.length).toBeGreaterThan(0);
    expect(report.eventImpacts.length).toBeGreaterThan(0);
    expect(report.eventImpacts[0].metrics.some((metric) => metric.delta !== 0)).toBe(true);
    expect(report.topSpecies[0].population).toBeGreaterThan(0);
  });

  it("formats reports as readable project evidence", () => {
    const output = formatSimulationReport(createSimulationReport({ ...config, generations: 120 }));

    expect(output).toContain("Petri Dish simulation report");
    expect(output).toContain("Selection pressure");
    expect(output).toContain("Aftermath");
    expect(output).toContain("Recent event ledger");
    expect(output).toContain("Signature: pd-");
  });
});
