import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("Petri Dish app", () => {
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
    expect(screen.getByText("World memory")).toBeTruthy();
    expect(screen.getByText("Replay lens")).toBeTruthy();
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
});
