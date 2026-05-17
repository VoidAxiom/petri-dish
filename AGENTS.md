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

## GitHub Review Gate

Codex review is required for PRs to `main`, but `chatgpt-codex-connector`
posts review comments rather than formal approving reviews and cannot be
requested as a normal collaborator reviewer. Treat GitHub's conversation state
as the Codex review gate.

Before merging a PR:

- Trigger Codex review with `@codex review` after the PR is ready.
- Read Codex comments and inline review threads.
- Fix actionable feedback locally on the PR branch.
- Push the fix and request Codex re-review when the change is non-trivial.
- Resolve each fixed Codex review conversation in GitHub.
- Confirm CI is green with `gh pr checks`.
- Confirm review threads are resolved and `mergeStateStatus` is `CLEAN`.

Do not merge while GitHub reports unresolved conversations, failed checks, or a
blocked merge state. A clean Codex comment such as "Didn't find any major
issues" is acceptable review evidence only after any earlier Codex conversations
on the PR have been fixed and resolved.

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

Browser inspection hygiene:

- Use one active browser verification context per task unless parallel viewports are explicitly needed.
- Close stale localhost tabs and isolated contexts as soon as their evidence has been collected.
- Do not leave historical Petri Dish browser windows running after a verification pass.
