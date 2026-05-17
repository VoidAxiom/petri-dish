import { describe, expect, it } from "vitest";
import { applyOfflineCatchUp, maxOfflineCatchUpGenerations, offlineCatchUpMsPerGeneration, planOfflineCatchUp } from "./offline";
import { snapshotSignature } from "./snapshots";
import { runWorld } from "./world";

const config = { width: 24, height: 14, initialPopulation: 80 };

describe("offline catch-up", () => {
  it("plans deterministic generations from elapsed wall time", () => {
    const savedAt = "2026-05-17T01:00:00.000Z";
    const now = Date.parse(savedAt) + offlineCatchUpMsPerGeneration * 12 + 999;

    expect(planOfflineCatchUp(savedAt, now)).toEqual({
      generations: 12,
      elapsedMs: offlineCatchUpMsPerGeneration * 12 + 999,
      capped: false
    });
  });

  it("skips invalid, future, and too-recent saves", () => {
    expect(planOfflineCatchUp("not-a-date", Date.now())).toMatchObject({ generations: 0, skippedReason: "invalid-saved-at" });
    expect(planOfflineCatchUp("2026-05-17T01:10:00.000Z", Date.parse("2026-05-17T01:00:00.000Z"))).toMatchObject({
      generations: 0,
      skippedReason: "clock-skew"
    });
    expect(planOfflineCatchUp("2026-05-17T01:00:00.000Z", Date.parse("2026-05-17T01:00:30.000Z"))).toMatchObject({
      generations: 0,
      skippedReason: "not-enough-elapsed"
    });
  });

  it("caps long absences to protect startup responsiveness", () => {
    const savedAt = "2026-05-17T01:00:00.000Z";
    const now = Date.parse(savedAt) + offlineCatchUpMsPerGeneration * (maxOfflineCatchUpGenerations + 500);

    expect(planOfflineCatchUp(savedAt, now)).toEqual({
      generations: maxOfflineCatchUpGenerations,
      elapsedMs: offlineCatchUpMsPerGeneration * (maxOfflineCatchUpGenerations + 500),
      capped: true
    });
  });

  it("continues the real simulation when applying catch-up", () => {
    const saved = runWorld("mythic-lagoon-17", 20, config);
    const plan = { generations: 7, elapsedMs: offlineCatchUpMsPerGeneration * 7, capped: false };
    const caughtUp = applyOfflineCatchUp(saved, plan);
    const direct = runWorld("mythic-lagoon-17", 27, config);

    expect(snapshotSignature(caughtUp)).toEqual(snapshotSignature(direct));
  });
});
