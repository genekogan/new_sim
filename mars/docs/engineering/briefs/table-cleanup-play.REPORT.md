> Parent verification update2026-10-02: actualPlay on61b236e passes all6
> combined sharing/creative/cleanup cases in2.0min; all30PNG and matching JSON/a11y
> inspected by helper, root personally inspects13representative images. No major
> support/continuity/clipping failure; sparse gestures/finefingers/off-frame events
> remain explicit. Read-only End label fix11cb5d6 passes stricter3/3Play recheck26.6s;
> root inspects all3new early-End readouts. Full combinedgate/publication pending.
> Music history readout inconsistency is being repaired separately before freeze.
> The original authoring-only statements below are dated provenance, superseded
> by this parent execution receipt, not claims of current missing evidence.

# Table cleanup Play regressions — authored, not browser-verified

New `viewer/e2e/table-cleanup.spec.ts` is authored from integrated candidate `9c97618` in isolated branch `codex/table-cleanup-play`. Only this spec and report are owned here. No browser/performance/full gate ran: the parent retains the serialized release gate/public-proof slot. Runtime, shared hooks, HUD, registry, scenarios and physical actions are unchanged.

Four tests cover both selectable `table-cleanup` and `table-cleanup-rotated` orientations:

- Actual Play reaches a physically held book after the first same-ID meal bowl is placed at its exact declared destination. Activity Pause safely returns the held book to its declared source, retains the first placement, and explicit Resume continues the same task. A later held water bowl receives an ordinary player walking direction; safe source return precedes the top-level walk to [-5,0,-5] or rotated [5,0,-5]. Another explicit Resume completes all three actual destination supports.
- Actual Play reaches the first held meal bowl before any completed placement. End returns it to its declared source and releases principal claims/physical actions. Start with the exact original binding must then admit a new task, proving logical task and approved surface-slot release in this specific all-items-at-sources case. Reset removes that new task, advances the world epoch, restores original component identities/poses/support and fixture geometry, and disables controls for old tasks. This test does not expect End after completed placements to repatriate them.

Exact initial bindings name `meal-bowl`, `work-book`, `water-bowl`, source slots `source-table#r1c1/2/3`, and destination slots `destination-table#r1c1/2/3`. Initial payload assertions require bowl definitions and `{food: 'hypothetical meal remainder', fraction: 0.25}` / `{food: 'water', fraction: 0.25}`, plus the existing reading-book. Every retained journey compares same IDs/definitions and unchanged contents. Initial, retained, completed and End supports are checked as actual full support objects; no replacement or inferred support passes. Held captures require actual tidier/right-hand ownership, rendered item origin/palm, supported human soles and real hand points. Ordinary completed take/put/child walking records, no failures, invariant violations, physical task/hand/hold/principal claims or active action leaks remain required.

The actual installed hook is `window.__marsEngine`, not `__lab`. Existing `tableCleanup`, `heldItems`, `components`, `fixtures`, `garden().claims`, `humanFields`, `bones`, records and slot hooks suffice. The generic principal-claim hook covers actor/entity/hand/hold ownership; it does not expose `tidy-task` or individual `surface-slot` claims directly. Same-binding Start admission after first-item End supplements those observations only while every item still has its authored source support.

Fresh scenario load is programmatic only to establish paused speed2 readiness. Both options must exist in the actual Scenario select and are selected through the UI. Reset and a single Step establish the first tick; all subsequent activity execution proceeds through ordinary Play and HUD buttons. Global Pause freezes exact held/retained moments for capture, and two animation frames settle rendered evidence without advancing engine execution. Existing serial harness limits remain: one worker, no retries, 120-second test budget and unchanged assertion/wait limits.

At runtime the spec writes screenshots, full accessibility snapshots and detached JSON at `viewer/e2e/artifacts/$E2E_RUN/`. Each receipt includes actual `git rev-parse HEAD`, tracked differences against HEAD, the run ID, physical evidence and final test/page-error verdict. Capture names distinguish base/rotated real-held-book, safe-pause-retained-transfer, real-held-water-bowl, directed-safe-return, completed-same-objects, end-held-meal-bowl, end-supported-clean and reset-original-supports. Failure states receive their own capture. Evidence has not yet been generated or inspected, so no browser pass or visual correctness is claimed.

Authoring checks pass: viewer `npm run typecheck`, focused `oxlint e2e/table-cleanup.spec.ts`, `oxfmt`, and standalone strict TypeScript checking of the spec (viewer tsconfig excludes e2e). The authoring workflow follows the e2e skill's evidence, unchanged-expectation and bounded-run guidance using this repository's existing Playwright harness, as the parent requested; it creates no alternate harness, helpers or generic scaffolding. Parent may run `E2E_RUN=<unique-receipt> E2E_VITE_PORT=<reserved-port> npm run e2e -- e2e/table-cleanup.spec.ts` after granting the slot, then inspect captured physical interactions and report original assertions. Do not weaken them to obtain a pass.
