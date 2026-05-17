import { stepWorld } from "./world";
import type { World } from "./types";

export const offlineCatchUpMsPerGeneration = 60_000;
export const maxOfflineCatchUpGenerations = 60;

export interface OfflineCatchUpPlan {
  generations: number;
  elapsedMs: number;
  capped: boolean;
  skippedReason?: "invalid-saved-at" | "clock-skew" | "not-enough-elapsed";
}

export function planOfflineCatchUp(
  savedAt: string,
  nowMs = Date.now(),
  options: { msPerGeneration?: number; maxGenerations?: number } = {}
): OfflineCatchUpPlan {
  const savedAtMs = Date.parse(savedAt);
  const msPerGeneration = options.msPerGeneration ?? offlineCatchUpMsPerGeneration;
  const maxGenerations = options.maxGenerations ?? maxOfflineCatchUpGenerations;

  if (Number.isNaN(savedAtMs)) {
    return { generations: 0, elapsedMs: 0, capped: false, skippedReason: "invalid-saved-at" };
  }

  const elapsedMs = Math.max(0, nowMs - savedAtMs);
  if (elapsedMs === 0 && nowMs < savedAtMs) {
    return { generations: 0, elapsedMs, capped: false, skippedReason: "clock-skew" };
  }

  const rawGenerations = Math.floor(elapsedMs / msPerGeneration);
  if (rawGenerations <= 0) {
    return { generations: 0, elapsedMs, capped: false, skippedReason: "not-enough-elapsed" };
  }

  const generations = Math.min(rawGenerations, maxGenerations);
  return { generations, elapsedMs, capped: rawGenerations > maxGenerations };
}

export function applyOfflineCatchUp(world: World, plan: OfflineCatchUpPlan): World {
  let next = world;
  for (let index = 0; index < plan.generations; index += 1) {
    next = stepWorld(next);
  }
  return next;
}
