import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import {
  buildGenerationSnapshots,
  defaultPersistedRunKey,
  loadPersistedRun,
  maxOfflineCatchUpGenerations,
  offlineCatchUpMsPerGeneration,
  runWorld,
  savePersistedRun
} from "./simulation";

const persistenceTestConfig = { width: 24, height: 14, initialPopulation: 80 };

describe("Petri Dish app", () => {
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: new TestLocalStorage()
    });
  });

  it("renders the living lab dashboard from simulation state", async () => {
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
    await waitFor(() => expect(screen.getByTestId("persistence-status").getAttribute("data-status")).toBe("saved"));
  });

  it("advances the generation when stepped manually", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(screen.getByTestId("display-generation").textContent).toBe("Generation 0");
    await waitFor(() => expect(screen.getByTestId("persistence-status").getAttribute("data-status")).toBe("saved"));

    fireEvent.click(screen.getByRole("button", { name: "Step" }));
    expect(screen.getByTestId("display-generation").textContent).toBe("Generation 1");
  });

  it("selects a lineage atlas representative", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(screen.getByTestId("persistence-status").getAttribute("data-status")).toBe("saved"));
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
      savedAt: new Date().toISOString()
    });

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));

    expect(screen.getByLabelText("Seed")).toHaveProperty("value", "glass-drought-41");
    expect(screen.getByTestId("display-generation").textContent).toBe("Generation 12");
    expect(screen.getByTestId("persistence-status").getAttribute("data-status")).toBe("restored");
    expect(screen.getByTestId("persistence-status").getAttribute("data-generation")).toBe("12");
    expect(screen.getByTestId("creature-inspector").getAttribute("data-creature-id")).toBe(selectedCreatureId);
  });

  it("catches up a restored local world from elapsed saved time", async () => {
    const world = runWorld("glass-drought-41", 12, persistenceTestConfig);
    const snapshots = buildGenerationSnapshots("glass-drought-41", 12, persistenceTestConfig, 6);
    const savedAt = new Date(Date.now() - offlineCatchUpMsPerGeneration * 3).toISOString();

    savePersistedRun(window.localStorage, { world, snapshots, savedAt });

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));

    expect(screen.getByTestId("display-generation").textContent).toBe("Generation 15");
    expect(screen.getByTestId("persistence-status").getAttribute("data-generation")).toBe("15");
    expect(screen.getByTestId("persistence-status").getAttribute("data-catch-up-generations")).toBe("3");
    expect(screen.getByText(/caught up 3g/)).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("persistence-status").getAttribute("data-status")).toBe("saved"));
  });

  it("caps restored local world catch-up for long absences", async () => {
    const world = runWorld("glass-drought-41", 12, persistenceTestConfig);
    const snapshots = buildGenerationSnapshots("glass-drought-41", 12, persistenceTestConfig, 6);
    const savedAt = new Date(Date.now() - offlineCatchUpMsPerGeneration * (maxOfflineCatchUpGenerations + 20)).toISOString();

    savePersistedRun(window.localStorage, { world, snapshots, savedAt });

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));

    expect(screen.getByTestId("display-generation").textContent).toBe(`Generation ${12 + maxOfflineCatchUpGenerations}`);
    expect(screen.getByTestId("persistence-status").getAttribute("data-catch-up-generations")).toBe(String(maxOfflineCatchUpGenerations));
    expect(screen.getByTestId("persistence-status").getAttribute("data-catch-up-capped")).toBe("true");
    expect(screen.getByText(/caught up 60g capped/)).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("persistence-status").getAttribute("data-status")).toBe("saved"));
  });

  it("keeps corrupt local saves visible until the user clears them", async () => {
    window.localStorage.setItem(defaultPersistedRunKey, "{not-json");

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));

    expect(screen.getByTestId("display-generation").textContent).toBe("Generation 0");
    expect(screen.getByTestId("persistence-status").getAttribute("data-status")).toBe("invalid");
    expect(loadPersistedRun(window.localStorage).status).toBe("invalid");

    fireEvent.click(screen.getByRole("button", { name: "Clear save" }));

    await waitFor(() => {
      expect(screen.getByTestId("persistence-status").getAttribute("data-status")).toBe("cleared");
      expect(screen.getByTestId("persistence-status").getAttribute("data-autosave")).toBe("paused");
      expect(loadPersistedRun(window.localStorage).status).toBe("missing");
    });
  });

  it("clears and resumes local saving intentionally", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));

    await waitFor(() => expect(loadPersistedRun(window.localStorage).status).toBe("loaded"));

    fireEvent.click(screen.getByRole("button", { name: "Clear save" }));
    await waitFor(() => expect(loadPersistedRun(window.localStorage).status).toBe("missing"));

    fireEvent.click(screen.getByRole("button", { name: "Save now" }));
    await waitFor(() => {
      expect(loadPersistedRun(window.localStorage).status).toBe("loaded");
      expect(screen.getByTestId("persistence-status").getAttribute("data-status")).toBe("saved");
    });
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
