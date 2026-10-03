> Parent verification update2026-10-02: actualPlay on61b236e passes all6
> combined sharing/creative/cleanup cases in2.0min; all30PNG and matching JSON/a11y
> inspected by helper, root personally inspects13representative images. No major
> support/continuity/clipping failure; sparse gestures/finefingers/off-frame events
> remain explicit. Read-only End label fix11cb5d6 passes stricter3/3Play recheck26.6s;
> root inspects all3new early-End readouts. Full combinedgate/publication pending.
> Music history readout inconsistency is being repaired separately before freeze.
> The original authoring-only statements below are dated provenance, superseded
> by this parent execution receipt, not claims of current missing evidence.

# Bounded communal table cleanup

Status: focused engine implementation complete; shared registry/Lab/render integration and browser proof belong to the parent task. Base `f095397`, branch `codex/table-cleanup`, isolated worktree `code/codex-wt/table-cleanup`.

## Physical behavior and API

`TABLE_CLEANUP_ACTIONS` exports `tidy_table`, `tidy_table_control`, and its internal physical unit `tidy_table_transfer`. Public types are `TidyTableParams`, `TableTransfer`, `TidyTableControlParams`, and `TidyTableReadout`.

```ts
rt.submit('tidy_table', {
  actor: 'person',
  transfers: [
    { item: 'bowl', from: 'source#r1c1', to: 'destination#r1c1' },
    { item: 'book', from: 'source#r1c2', to: 'destination#r1c2' },
  ],
});
rt.submit('tidy_table_control', { task, intent: 'pause' });
rt.submit('tidy_table_control', { task, intent: 'resume' });
rt.submit('tidy_table_control', { task, intent: 'end' });
readTidyTable(rt, task);
```

One free ground person moves 2–4 authored existing small one-hand items between two separately declared flat grounded surface fixtures. Admission checks real source slots/support/pose/footprints, destination occupancy/footprints and pairwise capacity, registered physical actions, and actual ground approach routes. Ordinary `take_item` and `put_item` children own their normal right-hand reach/grasp/withdrawal and `walk_to` approach; the coordinator never edits a person's pose, hand points, or item support. No deletion, replacement, spawned items, inferred storage plan, or animation rig changes.

The coordinator exclusively reserves its logical task, actual item IDs, and the approved source/destination slots; support fixture reservations are shared. Each physical unit exclusively owns the actor and right hand during its ordinary children. Immutable item payload and support-fixture fingerprints refuse silent replacement, changed contents/material/configuration, or changed support layout. Finished transfers are recognized from actual released destination support and remain retained. Readout is detached and exposes exact bindings, completed/remaining same-item transfers, physical child/phase, return slot, actual held/support/contents state, diagnostics and named waiting reason. `tidy_table.transferred` marks correspond to actual destination placements.

Pause and End drain the active physical unit. A held item is returned through ordinary `put_item` to its declared source, or its declared destination if the source refuses. If both supports are unavailable, `tidy_table.safe-return-unavailable` names the actor, held item, both permitted slots and conflicting resources; the action keeps true held ownership and required reservations. It does not drop, falsely release, search for another support, or claim End has completed. Restoring a declared support permits safe release. Ordinary player walking takes precedence through existing deferred cancellation and physical-unit yield; the parent remains waiting for explicit Resume. Resume in the same Runtime continues remaining actual objects and rejects changed completed placements or payloads.

## Fixture and integration

`tidyTableScene()`, `tidyTableWorld(yaw = 0, count = 3)`, `tidyTableBinding(count = 3)`, and `tidyTableRuntime(yaw = 0, count = 3)` are exported from `engine/scenarios/table-cleanup.ts`. Count accepts 2, 3 or 4. Scene has one ground floor and no access links. Two existing catalog `table-6ft` fixtures, existing bowls with retained finite contents, and existing reading books demonstrate the generic contract. Staging, participant, contents and labels are entirely hypothetical; no historical Mars facts or people are represented. Rotation applies to the full scene setup. Registry construction filters already-canonical actions to remain safe after parent wiring.

Only the four assigned new files are changed. No shared registry, catalog, renderer, Lab, runtime, physical-action or rig edits are required. Dependency directories are symlinked from the main checkout; no installation.

## Validation

- `node --test engine/test/table-cleanup.test.ts`: 19/19 passing.
- `npm run typecheck`: passing.
- Focused `oxlint` on the three new TypeScript files: passing.
- `oxfmt` applied to the new TypeScript files.

Cases cover 2/3/4 items at 0 and π/2 table orientation, same entity IDs/definitions/provenance/contents, actual destination support, ordinary walking/take/put records, detached readout, pause on the second held item with the first placement retained, explicit Resume, repeated End cancellation, player walk precedence, blocked source fallback, both return slots blocked during Pause and End, retained truthful ownership/no repeated child submissions, explicit restoration, missing/unsupported items or source table, occupied destination, blocked route, actual overhanging footprints, payload mutation refusal, logical exclusivity, rapid accepted controls before a tick without orphan children, pre-tick player direction plus End preserving the independent walk, deterministic replay, ordinary release cleanup and zero invariant violations. Browser, performance and full gate were deliberately not run because their serialized slot belongs to the parent release gate.

## Bounds

Only one source/destination fixture pair, a ground-only route under 30 m, and the existing supported right-hand small-item actions are admitted. This is authored tidying, not arbitrary room planning, stacking, washing, carrying large objects, seated or elevated manipulation, or precision placement beyond existing surface slots. Individual transfers have a 120-second bound. Safe-release refusal intentionally remains active while physically holding an item until a permitted support is restored. Same-Runtime Pause/Resume is supported; active checkpoint reload is not claimed. Existing deferred-cancellation behavior in base `f095397` is required for repeated cancellation to preserve the safe-release child.
