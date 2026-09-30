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
| Explicit late joining and audience return | Sol coordinator; lead review | Spare authored seat, speaker continues, busy/missing-seat refusal, safe cancellation | Tested checkpoint2fc68a6; browser/integration pending |
| Seated computer work and intention continuity | GPT-6.1 Sol; lead review | Real chair/desk binding; interrupted work remains unfinished, explicit return continues progress; coherent ownership | Tested checkpoint2a3e90f; Lab wiring and captures pending; no precision typing |
| Combined classroom/workstation play | GPT-6.1 Sol UI; lead release | Work → join → leave → resume in Lab; meaningful screen state and waiting reasons | No competing actor controller; inspect actual captures; full gate before merge |
| Visible social behavior | Lead, alongside the above | Shared attention remains legible while arrivals/interventions occur | Bounded head/gaze standard; richer gestures and spoken dialogue deferred |

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

First classroom source **f40f659** passed the full gate and was fast-forwarded into local main. Release14 is deployed as `c0522537-d4e4-4a64-9bd3-c52b711eecd4`; production verification passed. Rollback is release13 `3b93cbd2-bc84-4484-a3e8-21705a069b25`. Original-row accounting remains38 fixed /36 reclassified /142 remaining: the narrower classroom does not complete broader original requirements. Main's unrelated historical-agent changes are preserved.

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

Release14 implements two hypothetical /lab arrangements, typed activity controls/readout, owned display state and bounded head attention. Full gate: unit93/0, engine570/0 (6 documented skips/11 TODO), browser86 pass/7 documented skips, lint/tsc clean, unchanged flagship/probe, all36 MCP tools. Idle performance passes original limits. Ground-only fixed furniture, held-object refusal and explicit cancellation remain the supported boundary. Joining and resumable computer work are tested separate checkpoints, awaiting UI/visual integration and the next combined gate. Active classroom/workstation snapshots remain unsupported; attention is currently live-Lab behavior, not a validated take-replay feature.

## Camera workstream coordination

Gene launched a separate autonomous-camera task owning live cinematography/editor policies, bounded Typesafe/Jev experiments, camera tests and periodic MP4 demos. This activity task retains world-engine and default integration/deployment ownership. Cross-task messages are authorized. Initial allocation proposed: one active activity helper, up to two camera helpers (combined maximum three); camera allocation confirmed (currently zero active camera helpers). Activity browser/gate ports5495/5491; camera5591 e2e /5593 manual /7393 optional Jev bridge agreed. Shared Lab hook edits need agreement; prefer separate modules and small read-only phase/role/attention/participant/state interfaces. Live camera work is not a prerequisite for the next playable classroom/workstation increment.

Camera brief (pending its own commit/integration): `<mars-worktrees>/autonomous-camera/docs/engineering/briefs/autonomous-camera.md`. Ownership: new `viewer/cinematography/**`, `viewer/app/camera-lab/**`, camera-specific spec/brief/report. Existing Lab hooks suffice for early demos; richer callback/FOV changes require a bounded shared agreement. Snapshot adapter/policy derivation stays camera-owned; activity task supplies small read-only hooks when needed.

Joining/workstation combined candidate: branch `codex/classroom-life-integration`, coordinator2fc68a6 + workstation2a3e90f + UI fb36339 selected with provenance. Three browser journeys pass; lead inspected unobscured seated/resumed work and actual late visitor seating. Same task/user/30-second total duration survives interruption, no failed records, violations or leaked final claims. Activities rules revision2 explicitly invalidates old bound plans; physical goldens remain unchanged. Next step is the full combined gate, then release.
