# mars/ — engine invariants

Repository-wide rules: [../AGENTS.md](../AGENTS.md). Engine docs: [../docs/mars/README.md](../docs/mars/README.md).
`mars/` is a vendored engine slated for deprecation; prefer generalizing what you need into Sim over growing it.

## Invariants

- **Deterministic core.** Fixed `DT = 1/20` (`viewer/engine/runtime/runtime.ts`); deterministic math (`core/math.ts`)
  and seeded RNG (`core/rng.ts`, state in `world.rng`); no `Date.now`, `Math.random`, DOM or three.js in the engine;
  `zod` is its only runtime dependency. Refusals are named `Diagnostic`s that cite concrete objects.
- **Physical honesty.** Never bypass support, ownership or admission; never move anything through forbidden geometry;
  never teleport or silently respawn an actor. A refusal or a wait with a named reason beats a fake success.
- **One movement path.** Renderers, pose adapters and cameras observe detached state and never own a second movement
  path or any world authority.
- **Failure isolation.** A local activity failure never stops the clock, the UI or unrelated actors. Serious invariant
  corruption stays visible and contained (quarantine with diagnostics), never stepped through.
- **Proof.** Skipped, FIXME and TODO checks count as unproved. Golden hashes and visual baselines change only with proof
  of an intended change (0 violations, the same discrete outcome, a recorded reason); never relax a tolerance, timeout
  or assertion to pass.

## Tests

From the repo root:

```sh
pnpm test:mars                                   # engine suite (node --test engine/test/*.test.ts)
pnpm --filter mars-campus-viewer test            # deploy/*.test.mjs
pnpm --filter mars-campus-viewer typecheck
pnpm --filter mars-campus-viewer lint
pnpm --filter mars-campus-viewer e2e             # Playwright; see viewer/e2e/README.md
pnpm test:mars:release                           # full gate (lint, tests, tsc, e2e, take and determinism checks)
```
