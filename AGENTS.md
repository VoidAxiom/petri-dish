# Petri Dish Agent Guide

This repo follows the global autonomous development contract supplied by the user.

## Project North Star

Petri Dish is a genetic algorithm civilization lab: tiny autonomous creatures evolve in a simulated world with food, terrain, predators, weather, disease, scarcity, migration pressure, mutation, speciation, collapse, and adaptation.

The product is the cool: a living map, colored clans/species, clickable creatures, genome/ancestry/fitness/mutation views, timeline, extinction events, dashboards, emergent stats, dynasty lineages, and memorable visual storytelling.

## Operating Loop

- Use Linear as the planning ledger and GitHub as the delivery ledger.
- Prefer branches named with the Linear issue ID.
- Treat `main` as protected except for initial bootstrap work needed to make PR-based development usable.
- Keep changes small enough to verify.
- Do not fake simulation stats. UI metrics must come from deterministic world state.
- Every meaningful change needs evidence: tests, typecheck, build, lint, screenshot, manual browser inspection, or CI/review status.

## Architecture Bias

- Keep the simulation core framework-independent and deterministic.
- Keep rendering and controls in React components.
- Make seeded demo worlds reproducible.
- Make agents inspectable: genome, ancestry, lineage, species, fitness, mutations, and death/birth causes should be available from state.
- Prefer observable state and debug overlays over hidden magic.

## Verification

Default local checks:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

After meaningful UI work, run the app and inspect it in the browser with screenshots when possible.
