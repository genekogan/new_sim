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
| Physical empty-chair relocation | Existing GPT-6.1 Sol medium engine worker; lead renderer/Lab/review | One free standing person lifts, carries and sets an upright camp-chair on ground; cancel safely; occupied/reserved/hands-full refuse; ordinary seating uses its new pose | Share validated carry execution and load invariants with unchanged construction defaults; stop if broad redesign or baseline change is required |
| Visible usable room setup | Lead app mechanics after chair checkpoint | Explicit authored room target, credible grip/interpolation, actual runtime captures and reseating; explain unsupported interventions | First empty unreserved chair before event; active reserved-seat rebind is a separate increment |
| Table movement and relational arrangement | Bounded follow-up after chair proof | Appropriate crew/support, explicit removal of tabletop contents, usable seats/display/aisle | Do not move occupied furniture or silently migrate supported objects; validate larger load envelope |
| Camera independent continuation | Separate camera owner | Camera-only policies/tests/MP4 on its branch; small read-only interfaces remain stable | Never a dependency of physical room setup; select reviewed compatible commits at a convenient green boundary |

Physical design/provenance: `briefs/fixture-mover.PLAN.md`. Alternative seat-withdrawal analysis remains recoverable in `briefs/classroom-furniture-feasibility.PLAN.md`; it is deferred in favor of Gene's physical-movement choice, not implemented or completed.

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

Release17 source **d04271d** passed the full clean-head gate and is merged/deployed as `7b809dd0-7655-4192-b968-5eb35d83df40`; production verification is recorded in RELEASE_CHECKLIST17. It adds explicit physical surface stow and optional same-world camera coverage to release16's stable group floors, admission and read-only hooks. Rollback is release16 `7f910ca6-a3b6-4309-bb25-de9cb330fb56`. Original accounting remains38 fixed /36 reclassified /142 remaining; unrelated historical-agent changes remain preserved.

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

Release17 full gate: unit96/0, engine670/0 (6 documented skips/11 TODO), browser97 pass/7 documented skips, clean lint and both TypeScript configs, unchanged flagship/probe, all36 MCP tools. Original idle ceilings/outcomes pass. Production14 browser checks plus a separate public-entry camera runtime proof pass; the dev-source URL injection test's production failure is retained and explained in RELEASE_CHECKLIST17.

Ground floor/fixed furniture is the released boundary; physical chair movement is an isolated candidate, not live. Max12 distinct lifetime audience members; quiet seated work, no typing animation. Active activity snapshots remain explicitly nonresumable, autonomy and take-replay gaze unvalidated. Previous refusals remain in the global failed-action banner after remedy. Optional Manual/Clear/Restrained camera affects the current world only as an observer; provider disabled in production. Conversation camera refinements stay camera-owned.

## Camera workstream coordination

Gene launched a separate autonomous-camera task owning live cinematography/editor policies, bounded Typesafe/Jev experiments, camera tests and periodic MP4 demos. This activity task retains world-engine and default integration/deployment ownership. Cross-task messages are authorized. Initial allocation proposed: one active activity helper, up to two camera helpers (combined maximum three); camera allocation confirmed (currently zero active camera helpers). Activity browser/gate ports5495/5491; camera5591 e2e /5593 manual /7393 optional Jev bridge agreed. Shared Lab hook edits need agreement; prefer separate modules and small read-only phase/role/attention/participant/state interfaces. Live camera work is not a prerequisite for the next playable classroom/workstation increment.

Camera brief/provenance: `<mars-worktrees>/autonomous-camera/docs/engineering/briefs/autonomous-camera.md`. Ownership: new `viewer/cinematography/**`, `viewer/app/camera-lab/**`, camera-specific spec/brief/report. Existing Lab hooks suffice for early demos; richer callback/FOV changes require a bounded shared agreement. Snapshot adapter/policy derivation stays camera-owned; activity task supplies small read-only hooks when needed.


Release17 integrates reviewed camera corrections through a6cc661 and root entry wiring d04271d at a convenient green boundary. Subsequent camera work stays isolated; experimental provider and ignored recorded replay data are not production capabilities.
