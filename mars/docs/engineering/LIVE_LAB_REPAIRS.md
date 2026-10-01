# Exposed Lab repair milestone

Owner report: 2026-09-30. This bounded correctness/usability milestone precedes
purposeful communal-day routines; it does not restore LAST_MILE queue ordering.

| ID | Reproduced cause | Repair and coverage contract | Status |
| --- | --- | --- | --- |
| PROBE-01 | Tick1: b0/b1/b2 at x13.8 overlap deck edge (0.15m clearance); g2 at15.2,10 overlaps stairs-b-body (0m). Initial tick0 never ran invariants. Existing pose sweeps never pressed Step. | Valid initial placements; normal Step/Play/reset; detached synthetic measurement poses must not mutate authoritative world. | Released in 23 |
| BUILD-01 | Planner emits beam take/climbs before staging feasibility; rejected beam leaves m4/m5 on orphan stances, then s0021 attempts another climb. | Preflight before any acquisition/climb. Current layout has9 blocked whole-house beams /3 first-bay beams. Preserve admission and collision checks; expose named unsupported-layout diagnostic if no supported choreography exists. | Released orphan-climb repair; current layout unsupported |
| PILE-01 | Aggregate uprights use catalog blue, extracted components use shared renderer frame palette. Count decreases when extraction completes and individual identity begins; no evidence of duplicate authoritative stock. | Shared renderer palette without historical-value edits. Validate count conservation, provenance and persistent identity/support through pickup/install. Extraction is currently an unanimated aggregate-to-individual transition, not individual pre-existing stack entities. | Released palette/identity proof; pull animation deferred |

Original production reproduction: release22, viewer/e2e/artifacts/live-reported-original
(ignored proof bundle). Body fresh/reset/first-Step and house s0021 captured.
Exact diagnostics and preceding action/support snapshots are retained as JSON.
Automatic Play reproduction and deployed control verification are recorded below, separately from programmatic stepping.

## Reviewed-source checkpoint — 2026-10-01

The release23/older7648 layout findings below remain historical evidence. The
selected reviewed museum replaces that source: current2022 contentHash
`2be1325ea2cee602b86243116a9f365991686e1751fffdf36472df484970831c`
now admits and completes both skeletons in Node:24/66 canonical parts, zero
violations, s0021 completed, ordinary descent/stance release and clean crew.
See [current source verification](briefs/current-2022-construction-verification.REPORT.md).
Current browser Play and clean combined release verification remain pending; no
new online-supported claim yet. Old3/9 refusal tests use the SHA-verified7648
fixture; their assertions and original fine-pose browser FIXMEs remain intact.
Admission stays source-sensitive and never bypasses collision checks. PhaseB and
continuous aggregate extraction remain unproved/deferred respectively.

## Coverage honesty (release23 source)

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
exact sources, tests and limitations. The release-23 verification below is the current checkpoint.

## Source-era bounded limitation retained

BUILD-02: current east-house full completion remains wanted but unsupported by
the two existing aisle-end staging positions. Both overlap Chiba beam0684c6e5 /
kitchen beam11ad38b2. Nine whole-house /three first-bay beams require a new feasible
staging-and-delivery choreography; this is an engine capability dependency on the
reconciled layout, not permission to alter historical placements. Keep this item
recoverable via the linked east-house report. Promote when a playable construction
scenario requires it; bound the task to one off-axis supported delivery before
broadening. Current production should refuse before any actions, retaining crew
and materials. Full historical-source completion remains separately mandatory.

Original automatic-play reproduction script had a reset wait race because Reset
retains the running transport state. The original failure artifacts are preserved;
a paused reset via runScenario followed by the actual Play button is separately
recorded. No test threshold or expected outcome changed to conceal that harness error.

## Focused inspected checkpoint (before full gate)

Reach3Node +3browser checks pass, including unchanged body measurement sweep;
root inspected fresh first-Step and synthetic measurement PNGs. Pile4browser checks
pass, currentcatalog shared palette plus explicitly historical extraction and
supported build-bay identity/support handoff; root inspected before/extracted/carried
captures. Original automatic production Play starts from paused reset tick0 and
reproduces s0021 at tick2865; programmatic exact sequence failed at2815. The same
orphan stance causes both; dispatch timing is not an admission excuse. Captures
and complete state/records are retained, including the initial reset-wait harness
timeout. New required Node full historical completion117277ticks/d382e461…0617
passes with all66parts/zero violations/clean crew; full gate and release pending.

Combined focused source check: **10 browser passes /2 retained historical fidelity
FIXMEs**, 1.5min, including actual Play/Step/Reset for both current unsupported
presets and full supported historical completion55.9s. Root inspected combined
current-house capture after narrowing only diagnostic scroll areas: all details and
negative status remain visible/accessible while crew/piles/controls remain usable.
App TypeScript/lint clean; focused Node5passes/1existing historical-stock TODO
(the solar dimensions mismatch still fails its TODO assertion and is not a pass).
A compiler command mistakenly invoked npx from repository root instead of viewer
and failed before running TypeScript; the correct viewer compiler subsequently
passed. No dependencies or project files were installed/changed by that invocation.

## First full gate — retained red result

Clean bde7e3f gate14-47-45 passed lint/unit99/engine796(6skip11TODO)/bothTSc,
then exposed renderer colour test relying on current house partial execution.
Root stopped owned gate withSIGINT; cleanupError: null, red report preserved.
Colour proof now explicitly uses the exact supported historical source while
retaining the16ft kit, actual raise and unchanged colour/pixel tolerances.
Current refusal tests remain mandatory. Its one full-page baseline requires an
intentional fixture/UI/palette update; original image is preserved before updating,
with inspected evidence and reason recorded in PLANNING_BUDGET. Titles/descriptions
now reflect actual loaded feasibility, avoiding contradictory unsupported text in
historical validation fixtures or future supported source. Internal legacy scene
IDs identify blockers; no new historical naming facts are asserted.

The colour comparison exposed37.43% full-page difference after explicit source/UI
change. Root inspected old/new captures before recording one separately named
supported-historical baseline; the original render-polish-green-frame.png stays
unchanged. Same16ft kit/actual raise/0violations/green palette, unchanged pixel
tolerances. A transient cold-title null guard failure was preserved; the corrected
guard has a focused cold-selector regression. No release occurred from either red
run. No-tests-found from an initial wrong-directory edit attempt is retained as a
harness mistake; source was unchanged by that failed attempt.

## Full gate watchdog evidence

The clean `3108f08` full gate report `viewer/.cloudflare/gate/2026-09-30T15-56-10-034Z/report.json` remains RED: lint, 99 unit tests, 797 engine tests (6 documented skips, 11 TODO), and both TypeScript configurations passed; E2E timed out after exactly 1,200 seconds after passing case 116, with no test failure logged. Later flagship/probe/MCP stages did not execute; cleanupError: null. The suite now has 133 cases versus 123 at release 22, including the required full historical build. Raise only the whole serialized-suite watchdog from 20 to 25 minutes so all required checks can execute. Individual test deadlines, performance ceilings, assertions, pixel tolerances, expected outcomes and original baselines are unchanged. This is validation-capacity maintenance, not proof of a green result; repeat the entire clean gate before integration. No engine pin movement.


## Release 23 — deployed and verified

Live version `d88e1112-a018-4f08-9ed0-350c6f0b63ee`, source `cb376037d3b63173cda30a9642ad18e8d9076cff`; rollback release 22. Clean full gate `viewer/.cloudflare/gate/2026-09-30T16-20-40-253Z/report.json`: 99 unit /797 engine passes, 6 engine skips and 11 TODO; 126 browser passes /7 skips; lint, both TypeScript configurations, flagship, unchanged determinism probe and all 36 MCP tools pass. Required historical full build completes all 66 parts in 117277 ticks with unchanged hash and clean crew. This does not establish current-layout completion. Browser suite took 1225.6 seconds (20.4 minutes), exceeding the original 1200-second aggregate watchdog while preserving every individual deadline/assertion/performance ceiling. Both prior red reports are retained. Original idle performance ceilings pass; evidence records 17 rows /8 milestones proven with existing exclusions, not all selectable scenarios supported.

Production focused browser checks: **5 passed in 34.4 seconds**, including Reach Step/Reset/Play and synthetic state nonmutation, supported rack-bay identity/support lifecycle, and actual controls on both current declined house layouts. Fresh direct-URL audit: **3 journeys passed**, zero violations and console/page errors; body initially auto-validates the still world, Reset gives tick 0, first Step tick 1 and Play tick 20. House initial/reset tick 0; **manual Step validates tick 1 without dispatching construction**, and Play leaves the declined world at that tick. Actors, stock and empty action records remain unchanged; all 3/9 named staging exclusions remain visible. Do not describe manual Step as freezing the clock at zero.

An extra audit initially asserted the wrong clock contract (0 rather than 1 after manual Step); its script/log and partial captures are preserved under `viewer/.cloudflare/repair-failures/prod-fresh-clock-assumption`. No source behavior or existing regression changed. Final captures wait for the rendered HUD tick after backend completion, avoiding a stale-frame screenshot. Root personally inspected 12 production PNGs covering repaired Reach, current refusal/pile appearance, rack-bay lifecycle and existing compiled camera/bay. Proof bundles: `viewer/e2e/artifacts/prod-repair-23`, `prod-repair-23-fresh-3` and release helper `prod-smoke-23`. All earlier attempts and original worktree copies remain.

BUILD-02 off-axis staging/delivery and continuous aggregate extraction remain explicit unfinished limitations. No historical placement/color values, engine state pins, tolerances or original image baselines changed. Purposeful communal-day routines resume after this milestone; no further priority interview is pending.
