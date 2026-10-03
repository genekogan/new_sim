# Body probe repair — 2026-09-30

Branch `codex/body-probe-repair`, base `9b2cc83`; local Git only. Work is bounded to the selectable synthetic reach-measurement scene and focused regression evidence.

## Cause and authoritative boundary

Fresh selection/reset constructs six idle humans at tick zero, without component support records or active actions. Tick zero has no violation log because the normal runtime checks execute at end of tick. First Step correctly reports four `collision.human-static` violations:

| Actor | Original feet | Diagnosis |
| --- | --- | --- |
| b0 | (13.8, 3, 11.5) | floor-edge grid clearance 0.15 m < 0.28 m human radius |
| b1 | (13.8, 3, 8.5) | floor-edge grid clearance 0.15 m < 0.28 m human radius |
| b2 | (13.8, 3, 10) | floor-edge grid clearance 0.15 m < 0.28 m human radius |
| g2 | (15.2, 0, 10) | stairs-b-body clearance 0.00 m < 0.28 m human radius |

The original preset immediately declared completion (`done: () => true`), so normal Play never validated even one tick; manual Step did. There are no components requiring a support overwrite, no carried entities and no movement action.

The separate `probe()` hook in `app/lab/hook.ts` was documented renderer-only but wrote synthetic activity/hands into `sim.rt.world`. Shared hook integration belongs to the lead: root commit `84c0f5a`, cherry-picked as `bc82b95`, detaches the renderer snapshot, preserves synthetic poses across probe calls, starts a fresh snapshot after authoritative Step/reset, and preserves authoritative hashes. This branch does not author hook changes.

## Smallest scenario repair

`app/lab/body.ts`: initial deck feet are 0.4 m inside the deck (x13.6); g2 starts at z10.8 clear of the east stairs and its neighbors. These are safe initial placements, with no post-load repositioning, geometry removal, support rewrite or invariant exemption. The normal fixed-DT transport now rehearses one second of this still scene (`continuous`, 20-tick budget) and reports its invariant count as an expectation.

`engine/test/body-probe-safety.test.ts`: fresh setup/first tick leaves entities unchanged, real-time advance validates 20 ticks then reset repeats setup/first tick, and the original invalid positions still report all four exact named collision failures.

`e2e/body-probe-safety.spec.ts`: visible picker, first Step, Reset, subsequent Step and Play proof, with actual non-baseline captures; synthetic probe isolation regression verifies the integrated lead hook snapshot fix.

## Validation and captures

Main and merge base remain `9b2cc834de0ccd0012e12ce659f4aab85e0ee38a`. Root authorized candidate commitment after focused green tests/typecheck; the combined full engine/release gate belongs to the root before integration. No deployment or full gate was run here.

Exact validation command from `viewer/`:

```sh
node --test engine/test/body-probe-safety.test.ts
npx tsc --noEmit -p .
E2E_VITE_PORT=5491 E2E_RUN=codex-body-probe-repair-1 npx playwright test -c e2e/playwright.config.ts body-probe-safety.spec.ts poses.spec.ts -g 'body probe|body model: the loaded'
```

Results: focused Node 3 passed / 0 failed / 0 skipped; TypeScript clean; browser 3 passed / 0 failed in 12.3 seconds (two new safety tests and the existing loaded-rig body measurement sweep). No pins, numeric pose expectations or goldens were changed. Full pinned suite is awaiting the root's combined gate; no claim of full-pin validation is made.

Inspected captures, under this worktree's `viewer/e2e/artifacts/codex-body-probe-repair-1/`:

- `body-probe-first-step.png`: visible body scenario, tick1 paused, six safe standing actors and green zero-violation expectation; no failure banner.
- `body-probe-play.png`: same six positions, tick20/1.00seconds done, green zero-violation expectation; no failure banner.
- `poses-body-kneel-edge.png`: detached synthetic kneel/reach poses still render across all six rigs for the existing measuring test. These targets measure renderer reach rather than certify authoritative construction/support/clearance.
- `diagnostics.json`: read-only reconstructed original setup/first-tick diagnostics and repaired setup/first-tick diagnostics.

Existing body sweep stays within its numerical reach/arm bounds and honestly retains its existing engine mismatch notice: engine reach-down cap 0.5 m, rendered woman reaches 0.35 m below feet (others 0.54 m). This bounded repair does not redefine the anatomical model or hide that deferred discrepancy.

All authored changes are limited to `app/lab/body.ts`, the new focused Node/browser tests and this report. Main's dirty historical work and other agents' ownership were preserved. Approximately 20 minutes active implementation/inspection plus 10 minutes waiting for the shared heavy slot; no scope expansion, dependency changes or external calls.
