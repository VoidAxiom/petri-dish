import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { buildGenerationSnapshots, defaultPersistedRunKey, loadPersistedRun, runWorld, savePersistedRun } from "./simulation";

const persistenceTestConfig = { width: 24, height: 14, initialPopulation: 80 };

describe("Petri Dish app", () => {
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: new TestLocalStorage()
    });
  });

  it("renders the living lab dashboard from simulation state", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Petri Dish" })).toBeTruthy();
    expect(screen.getByText("living agents")).toBeTruthy();
    expect(screen.getByText("Selected organism")).toBeTruthy();
    expect(screen.getByText("Survival pressures")).toBeTruthy();
    expect(screen.getByText("Reproduction readiness")).toBeTruthy();
    expect(screen.getByText("Dynasty")).toBeTruthy();
    expect(screen.getByText("Lineage lens")).toBeTruthy();
    expect(screen.getByText("Species drift")).toBeTruthy();
    expect(screen.getByText("Lineage atlas")).toBeTruthy();
    expect(screen.getByText("Aftermath")).toBeTruthy();
    expect(screen.getByText("World memory")).toBeTruthy();
    expect(screen.getByText("Replay lens")).toBeTruthy();
    expect(screen.getByText("Local run")).toBeTruthy();
    expect(screen.getByTestId("snapshot-generation").textContent).toBe("Live");
    expect(screen.getByRole("button", { name: "disease" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Living simulation map" })).toBeTruthy();
  });

  it("advances the generation when stepped manually", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(screen.getByTestId("display-generation").textContent).toBe("Generation 0");

    fireEvent.click(screen.getByRole("button", { name: "Step" }));
    expect(screen.getByTestId("display-generation").textContent).toBe("Generation 1");
  });

  it("selects a lineage atlas representative", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    const row = screen.getAllByTestId("lineage-atlas-row").find((item) => !item.hasAttribute("disabled"))!;
    const lineageId = row.getAttribute("data-lineage-id");
    expect(Number(row.getAttribute("data-living"))).toBeGreaterThan(0);
    expect(Number(row.getAttribute("data-survival-score"))).toBeGreaterThan(0);

    fireEvent.click(row);

    expect(screen.getByTestId("creature-inspector").getAttribute("data-lineage-id")).toBe(lineageId);
    expect(screen.getByTestId("dynasty-panel").getAttribute("data-lineage-id")).toBe(lineageId);
  });

  it("restores a saved local world on startup", () => {
    const world = runWorld("glass-drought-41", 12, persistenceTestConfig);
    const snapshots = buildGenerationSnapshots("glass-drought-41", 12, persistenceTestConfig, 6);
    const selectedCreatureId = world.creatures[2]?.id;

    savePersistedRun(window.localStorage, {
      world,
      snapshots,
      selectedCreatureId,
      savedAt: "2026-05-17T01:00:00.000Z"
    });

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));

    expect(screen.getByLabelText("Seed")).toHaveProperty("value", "glass-drought-41");
    expect(screen.getByTestId("display-generation").textContent).toBe("Generation 12");
    expect(screen.getByTestId("persistence-status").getAttribute("data-status")).toBe("restored");
    expect(screen.getByTestId("persistence-status").getAttribute("data-generation")).toBe("12");
    expect(screen.getByTestId("creature-inspector").getAttribute("data-creature-id")).toBe(selectedCreatureId);
  });

  it("keeps corrupt local saves visible until the user clears them", () => {
    window.localStorage.setItem(defaultPersistedRunKey, "{not-json");

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));

    expect(screen.getByTestId("display-generation").textContent).toBe("Generation 0");
    expect(screen.getByTestId("persistence-status").getAttribute("data-status")).toBe("invalid");
    expect(loadPersistedRun(window.localStorage).status).toBe("invalid");

    fireEvent.click(screen.getByRole("button", { name: "Clear save" }));

    expect(screen.getByTestId("persistence-status").getAttribute("data-status")).toBe("cleared");
    expect(screen.getByTestId("persistence-status").getAttribute("data-autosave")).toBe("paused");
    expect(loadPersistedRun(window.localStorage).status).toBe("missing");
  });

  it("clears and resumes local saving intentionally", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));

    expect(loadPersistedRun(window.localStorage).status).toBe("loaded");

    fireEvent.click(screen.getByRole("button", { name: "Clear save" }));
    expect(loadPersistedRun(window.localStorage).status).toBe("missing");

    fireEvent.click(screen.getByRole("button", { name: "Save now" }));
    expect(loadPersistedRun(window.localStorage).status).toBe("loaded");
    expect(screen.getByTestId("persistence-status").getAttribute("data-status")).toBe("saved");
  });
});

class TestLocalStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}
