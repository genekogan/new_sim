# Active roadmap

Owner direction: [SIMULATION_VISION.md](SIMULATION_VISION.md), 2026-09-29.
Current product milestone: **a playable classroom that becomes lightning talks,
questions and smaller conversations**. Preferences confirmed: semi-planned events with adaptable execution and live
intervention; advance complete experiences / activity-object breadth / social
believability together at approximately **50 /30 /20**. Continue in **/lab** with
simple configurable maps; historical Studio remains the museum side.

## Small active queue

| Deliverable | Ownership / model | Acceptance | Dependency / stop condition |
|---|---|---|---|
| Shared floor and small-item admission | GPT-6.1 Sol bounded implementation; lead release | Formed groups have stable turns; departures/cancellation clear attention; classroom/work refuse small held items without changing support | Release16 deployed and verified; retain regression coverage |
| Frozen read-only camera interface | Lead hooks; camera task policies | Same-tick reset identity, detached cached geometry, atomic finite render pose/FOV | Release16 freezes hooks; camera readiness does not block engine releases |
| Explicit preparation for the next activity | GPT-6.1 Sol ordinary implementation after current gate | Approved item destinations, physical put_item children, coherent cancellation, clear remaining hands | Surface-slot reservation prerequisite; bounded plan in briefs/stow-activity.PLAN.md |
| Optional camera integration | Separate camera task; lead convenient integration boundary | Reviewed paused/aspect/provider corrections, same-world optional controls, offline and runtime proof | Preserved codex/classroom-social-camera; camera experiments/MP4 remain camera-owned |


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

Release16 source **3134294** passed the full clean-head gate and is merged/deployed as `7f910ca6-a3b6-4309-bb25-de9cb330fb56`; production checks passed. It adds stable group floors, correct questioner/presenter identity, small-item admission refusals and frozen read-only camera hooks. Rollback is release15 `284cdc8f-2d8c-4e73-a7f8-d058afe1727f`. Original accounting remains38 fixed /36 reclassified /142 remaining; unrelated historical-agent changes remain preserved.

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

Release15 implements two hypothetical /lab arrangements, audience joining/return, presenter questions/rotation, conversation/departure, usable computer workstation state and explicit interrupted-task return. Same user/task/30-second total duration and elapsed progress persist across work → join → leave → resume. Full gate: unit93/0, engine586/0 (6 documented skips/11 TODO), browser89 pass/7 documented skips, lint/tsc clean, unchanged flagship/probe, all36 MCP tools. Idle performance passes original limits. Ground-only fixed furniture, held-object refusal and safe stand-up/cancellation remain the boundary. One spare classroom seat; unfinished station task belongs to its user. Quiet seated reading/work, no typing animation. Live active snapshots unsupported, no autonomous routine selection, and attention replay unvalidated.

Next combined branch `codex/classroom-social-camera` at b3cb81e (lab-camera-hooks checkout) selects tested group-turn31d995c/question-floor correctione82d243 and camera-hooks d98d9e5. Forty focused node checks and separate actual browser proofs pass; inspected clear work/turn/camera captures. Activities revision3 records new semantic floors; no physical goldens. This is not main/released. Autonomous-camera task implementation awaits its reviewed checkpoint and deliberate production entry integration.

## Camera workstream coordination

Gene launched a separate autonomous-camera task owning live cinematography/editor policies, bounded Typesafe/Jev experiments, camera tests and periodic MP4 demos. This activity task retains world-engine and default integration/deployment ownership. Cross-task messages are authorized. Initial allocation proposed: one active activity helper, up to two camera helpers (combined maximum three); camera allocation confirmed (currently zero active camera helpers). Activity browser/gate ports5495/5491; camera5591 e2e /5593 manual /7393 optional Jev bridge agreed. Shared Lab hook edits need agreement; prefer separate modules and small read-only phase/role/attention/participant/state interfaces. Live camera work is not a prerequisite for the next playable classroom/workstation increment.

Camera brief (pending its own commit/integration): `<mars-worktrees>/autonomous-camera/docs/engineering/briefs/autonomous-camera.md`. Ownership: new `viewer/cinematography/**`, `viewer/app/camera-lab/**`, camera-specific spec/brief/report. Existing Lab hooks suffice for early demos; richer callback/FOV changes require a bounded shared agreement. Snapshot adapter/policy derivation stays camera-owned; activity task supplies small read-only hooks when needed.

Release15 selects coordinator2fc68a6 + workstation2a3e90f + UI fb36339 with provenance. Three focused browser journeys pass; lead inspected unobscured seated/resumed work and late visitor seating. Activities revision2 invalidates old bound plans through normal rebind rules; no physical golden change.

Current engine-only release candidate: `codex/classroom-floor-release`, based on verified
release15 metadata cb5ff57. It selects group floors/questioner readout and frozen camera
hooks without camera implementation/UI/build changes. Small held-item admission correction2835abb is selected and focused-tested; combined full gate is pending. Camera integration remains preserved separately
and will join a convenient green boundary after review; it is not a release dependency.
