# Petri Dish

Petri Dish is a deterministic genetic algorithm civilization lab. Tiny creatures move across a living terrain, consume food, survive disease and predators, reproduce, mutate, split into species, and leave inspectable ancestry behind.

The project is built as a portfolio-grade simulation package: real state transitions first, visual storytelling second, and verification loops throughout.

## Current Capabilities

- Seeded deterministic world generation.
- Terrain biomes with food, disease, predator pressure, fertility, temperature, and seasonal regeneration.
- Inspectable creatures with genomes, species, lineages, ancestry, mutations, energy, fitness, and births.
- Selection pressure through starvation, climate mismatch, disease, predators, crowding, and catastrophe events.
- Species coloring, population curve, extinction report, world health metrics, and a clickable SVG living map.
- Tests proving same-seed replay and real ecological state transitions.

## Local Development

```bash
npm install
npm run dev
```

Default verification:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Generate a deterministic long-horizon evidence report:

```bash
npm run sim:report -- --seed mythic-lagoon-17 --generations 240
```

## Design Principles

- No fake demo stats. UI metrics must derive from simulation state.
- Simulation core stays independent of React.
- Seeds and generation counts should make runs reproducible.
- Every new system should expose enough state to debug why a lineage survived or collapsed.
