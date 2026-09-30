# Active roadmap

Owner direction: [SIMULATION_VISION.md](SIMULATION_VISION.md), 2026-09-29.
Current product milestone: **a playable classroom that becomes lightning talks,
questions and smaller conversations**. Preferences confirmed: semi-planned events with adaptable execution and live
intervention; advance complete experiences / activity-object breadth / social
believability together at approximately **50 /30 /20**. Continue in **/lab** with
simple configurable maps; historical Studio remains the museum side.

## Small active queue

Gene's next priority, confirmed after release17: **physical chair/table moving and usable room setup first**. Develop this alongside existing classroom continuity and visible social behavior; no universal furnishing language up front.

| Deliverable | Ownership / model | Acceptance | Dependency / stop condition |
|---|---|---|---|
| Bounded usable room setup | Lead app integration; GPT-6.1 Sol medium engine candidate | Explicit default/side layout runs registered table/chair actions; stop safely, preserve partial placements; two room sizes complete talks/questions/conversations after setup | Engine candidate24 focused checks and UI journeys2/2 green; inspected runtime captures; combined full gate pending. Stop if a layout optimizer or claims redesign becomes necessary |
| Classroom continuity and social use of the new layout | Lead alongside setup | Late arrival uses moved seat; questions/rotation and smaller conversations remain coherent; returned objects use relocated table | No automatic global restart or occupied furniture transport |
| Camera independent continuation | Separate camera owner | Camera-only policies/tests/MP4 on its branch; small read-only interfaces remain stable | Never a dependency of physical room setup; batch reviewed compatible commits at a convenient green boundary |

Physical design/provenance: `briefs/fixture-mover.PLAN.md`. Alternative seat-withdrawal analysis remains recoverable in `briefs/classroom-furniture-feasibility.PLAN.md`; it is deferred in favor of Gene's physical-movement choice, not implemented or completed.

## Bounded tranche exit criteria

1. Chair milestone: physical move/cancel and actual use at the new location in both classroom sizes; occupied/reserved/held-item refusal without state changes; inspected credible grips/body clearance; unchanged legacy outcomes; full green gate and release.
2. Table milestone: appropriate carriers move an empty table continuously and cancel safely; supported objects must first be explicitly removed; the relocated surface accepts ordinary placement/use. No fine-finger certification or occupied-load transport.
3. Usable setup milestone: a small authored layout choice arranges supported seats and equipment with a clear aisle through registered physical actions; start a session, admit a late arrival, ask/rotate, then converse and leave. A representative intervention remains coherent rather than restarting the whole event.

Initial remaining estimate after release17: **10–18 working hours** for these three stages, including inspected runtime proofs and full release gates, assuming shared carry remains compatible and no major routing failure appears. Reassess at each green milestone; this is not an estimate for the entire simulator. Do not exhaust furniture fidelity before advancing surrounding activities/social expression. Next sequence remains communal-day continuity, then reuse in a small non-Mars environment.

## First supported experience

Begin with existing camp chairs/benches and a clearly hypothetical gathering space.
Two presenters and a small audience should arrive, take usable places, attend a
presentation, ask/answer a question, rotate presenters and transition into small
conversations. A display has explicit available/active/content state, rather than
being a decorative mesh. Required equipment cannot silently be substituted.

Player/director commands use the same Runtime and resource rules. The player can
intervene during the session and see what was interrupted and whether someone plans
to return. Add one intervention at a time; do not promise a complete life simulator
from the first classroom. Constrained furniture arrangements are acceptable initially.

Representative checks: two layouts/audience sizes, occupied seats, a late arrival,
missing/unavailable display, blocked route, departure, directed interruption and
resumption. Feasible sessions finish; infeasible sessions wait with reason, refuse
before commitment, or end with coherent cleanup. No leaked resources, unsupported
objects, forced teleports or permanently stranded people. Inspect actual runtime
captures to assess shared attention and pacing.

## Current baseline and preserved work

Release18 source **b2928ef** passed the full clean-head gate and is merged/deployed as `4e77562e-9dc4-4f76-890b-22bc188d8ed7`. Production verification is recorded in RELEASE_CHECKLIST18. It adds physical spare-chair and cleared-table movement, discoverable classroom quick tour, reviewed camera policies and explicitly recorded six-scene comparison. Rollback is release17 `7b809dd0-7655-4192-b968-5eb35d83df40`. Original accounting remains38 fixed /36 reclassified /142 remaining; unrelated historical-agent changes remain preserved.

The old combined technical candidate remains on `codex/wave2-consolidation` at `ec3aa6f`, with unresolved baseline/construction failures; it is not a green release. The studio-integration checkout hosts the clean classroom branch. Useful compatible work is selected with explicit provenance rather than making specialized construction fidelity a classroom dependency.

Finished current row: LM-117 bounded step-and-turn dance candidate `2af7a67`
(integration `ec3aa6f`), five party checks, combined social checks, inspected browser
1/1, typecheck/lint. It remains awaiting release and is narrower than expressive
party animation. See `briefs/party.REPORT.md`.

Preserved exact item entry: `codex/item-entry-bridge`, `deadlock-tails`, HEAD52286a0
plus uncommitted files. See its `briefs/item-entry.REPORT.md`. Source-hold exit/guard
is incomplete: do not merge it merely because fine finger fidelity is deferred.
Existing standalone supported item placement is available for a constrained classroom.

Exact beam/joist contact, complex stair carrying, detailed vehicle recovery,
automatic cinematography refinements and broad evidence cleanup are deferred unless
a conspicuous failure in the featured experience makes them necessary. Their
individual dispositions and promotion triggers belong in RAINY_DAY_BACKLOG.

## Next increments

After the classroom is usable: communal day with rest/work/food/social continuity,
then reuse the activity/capability model in a gallery, workshop or office. Introduce
needs/interests/relationships and additional assets only as those experiences demand.

## Current implementation checkpoint

Two hypothetical /lab arrangements support audience joining/return, presenter questions/rotation, conversations/departure, usable computer work state and explicit interrupted-task return. Same user/task/30-second duration and elapsed progress persist. Actors physically return one or two held bowl/spoon items to approved table slots before explicitly resuming work or joining. Safe cancellation exposes remaining held objects; no automatic chaining, ground fallback or eating claim.

Release18 full gate: unit99/0, engine745/0 (6 documented skips/11 TODO), browser103 pass/7 documented skips, clean lint and both TypeScript configs, unchanged flagship/probe, all36 MCP tools. Original idle ceilings/outcomes pass. Published-entry production results are recorded in RELEASE_CHECKLIST18; dev-source provider failure injection remains local proof.

Ground floor, empty unreserved camp-chair/table movement is the released boundary. Table contents must be explicitly removed; two free carriers are required. Coordinated layout setup is a separate unreleased candidate. Max12 distinct lifetime audience members; quiet seated work, no typing animation. Active activity snapshots remain explicitly nonresumable, autonomy and take-replay gaze unvalidated. Previous refusals remain in the global failed-action banner after remedy. Optional Manual/Clear/Restrained camera affects the current world only as an observer; provider disabled in production. Conversation camera refinements stay camera-owned.

## Camera workstream coordination

Gene launched a separate autonomous-camera task owning live cinematography/editor policies, bounded Typesafe/Jev experiments, camera tests and periodic MP4 demos. This activity task retains world-engine and default integration/deployment ownership. Cross-task messages are authorized. Initial allocation proposed: one active activity helper, up to two camera helpers (combined maximum three); camera allocation confirmed (currently zero active camera helpers). Activity browser/gate ports5495/5491; camera5591 e2e /5593 manual /7393 optional Jev bridge agreed. Shared Lab hook edits need agreement; prefer separate modules and small read-only phase/role/attention/participant/state interfaces. Live camera work is not a prerequisite for the next playable classroom/workstation increment.

Camera brief/provenance: `<mars-worktrees>/autonomous-camera/docs/engineering/briefs/autonomous-camera.md`. Ownership: new `viewer/cinematography/**`, `viewer/app/camera-lab/**`, camera-specific spec/brief/report. Existing Lab hooks suffice for early demos; richer callback/FOV changes require a bounded shared agreement. Snapshot adapter/policy derivation stays camera-owned; activity task supplies small read-only hooks when needed.


Release17 integrates reviewed camera corrections through a6cc661 and root entry wiring d04271d at a convenient green boundary. Subsequent camera work stays isolated; experimental provider and ignored recorded replay data are not production capabilities.

## Bleeding-edge checkpoint (release18)

Owner requests one inspectable combined checkpoint: physical spare-chair carry/cancel/reseat, two-person cleared-table relocation and ordinary returned objects, reviewed camera policies through2591b9e plus production replay/player packagingbf24353, and top-panel quick tour of all these behaviors. Full combined gate is green and release18 is live; the six camera scenes are labeled recorded comparisons, while classroom4/8 remain live and playable. Fine furniture anatomy, active reserved-seat rearrangement and automated room-wide layout are deliberately outside this checkpoint.

After this checkpoint the next visible outcome is a bounded usable layout choice that invokes supported physical actions before a full classroom/talk/conversation journey. Estimated remaining **6–10 working hours** for that bounded setup tranche, including representative disruption, inspected captures and release validation, assuming shared routing/claims need no subsystem redesign. Communal-day intentions and reuse remain subsequent stages.


Next setup candidate: registered serial `setup_room` uses explicit crew/targets, readonly preflight, child replanning and safe draining on cancellation. It does not optimize arbitrary layouts or acquire tabletop contents automatically. Root two-room setup → late arrival → questions → conversations journeys pass2/2 with inspected captures; combined full gate pending; it is not in release18.
