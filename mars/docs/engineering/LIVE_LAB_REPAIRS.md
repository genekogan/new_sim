# Exposed Lab repair milestone

Owner report: 2026-09-30. This bounded correctness/usability milestone precedes
purposeful communal-day routines; it does not restore LAST_MILE queue ordering.

| ID | Reproduced cause | Repair and coverage contract | Status |
| --- | --- | --- | --- |
| PROBE-01 | Tick1: b0/b1/b2 at x13.8 overlap deck edge (0.15m clearance); g2 at15.2,10 overlaps stairs-b-body (0m). Initial tick0 never ran invariants. Existing pose sweeps never pressed Step. | Valid initial placements; normal Step/Play/reset; detached synthetic measurement poses must not mutate authoritative world. | Candidate, unreleased |
| BUILD-01 | Planner emits beam take/climbs before staging feasibility; rejected beam leaves m4/m5 on orphan stances, then s0021 attempts another climb. | Preflight before any acquisition/climb. Current layout has9 blocked whole-house beams /3 first-bay beams. Preserve admission and collision checks; expose named unsupported-layout diagnostic if no supported choreography exists. | Candidate, unreleased |
| PILE-01 | Aggregate uprights use catalog blue, extracted components use shared renderer frame palette. Count decreases when extraction completes and individual identity begins; no evidence of duplicate authoritative stock. | Shared renderer palette without historical-value edits. Validate count conservation, provenance and persistent identity/support through pickup/install. Extraction is currently an unanimated aggregate-to-individual transition, not individual pre-existing stack entities. | Candidate, unreleased |

Original production reproduction: release22, viewer/e2e/artifacts/live-reported-original
(ignored proof bundle). Body fresh/reset/first-Step and house s0021 captured.
Exact diagnostics and preceding action/support snapshots are retained as JSON.
Automatic-play verification remains required, distinct from programmatic stepping.

## Coverage honesty

Release22 green gate executed116 browser cases but skipped7. Both 2022 first-bay
and whole-house completion cases have unconditional W51 FIXME markers;
YEAR_BUILD_FULL=1 does not activate them. The historical reconciliation moved
neighboring structures; current staging at both beam ends intersects concrete
Chiba/kitchen beams. Old captures/pins do not certify the present selectable scene.
Mandatory current-scene checks must test the refusal/clean-state contract; supported
historical-source full completion is separately labeled and cannot certify current
layout. Do not discard old fidelity requirements or silently repin them.

No historical colors/placement facts, golden tolerances or geometry admission rules
may change to conceal these failures. Worker reports under engineering briefs retain
exact sources, tests and limitations. Release verification will update this document.
