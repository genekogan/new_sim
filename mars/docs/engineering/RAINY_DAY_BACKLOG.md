# Rainy-day backlog

This is the authoritative **current disposition** ledger for all 216 original LAST_MILE IDs. Original requirements and source abbreviations remain in [LAST_MILE.md](LAST_MILE.md). [ACTIVE_ROADMAP.md](ACTIVE_ROADMAP.md) selects current work; [SIMULATION_VISION.md](SIMULATION_VISION.md) explains why. Deferred does not mean completed.

Audit basis: main release13 `3bd40f2` (source `b0f7419`); unreleased candidate `codex/wave2-consolidation` at `ec3aa6f`. Release accounting remains **38 fixed /36 reclassified /142 remaining**. The remaining group contains 30 candidate evidence pointers, 10 explicit partial/deferred records and 102 rows without row-specific proof found. These are documentation-based classifications, **not independent verification of every implementation**. Candidate reports may cover only prerequisites or narrower behavior. Verify code, dependencies and current tests before promotion.

The old wave2 gate is not green. Its last full-engine checkpoint had 17 failures; subsequent fixes make that count stale. No clean combined gate/re-pin/release has been established. Classroom work starts from released main and does not erase deferred failing requirements.

## Resume instruction

> Read RAINY_DAY_BACKLOG.md, select a bounded item with no unmet dependencies, verify its current status, and implement it under the project’s normal safeguards.

Prefer GPT-6.1 Sol medium for ordinary implementation; Luna for clear metadata/mechanical work; Astra medium for difficult geometry/concurrency or ambiguous failures. A row is not an invitation to redesign a subsystem. Identify the visible capability, bounded acceptance check and stopping condition first.

## Preserved checkpoints

| Work | Recoverable location | Disposition |
|---|---|---|
| Old combined technical wave | `codex/wave2-consolidation` `ec3aa6f` (126 commits beyond released main) | Unreleased, combined gate pending; preserved branch |
| Step-and-turn dance LM-117 | `2af7a67`, integration `ec3aa6f`; `briefs/party.REPORT.md`; camera-corrections/viewer/e2e/artifacts/codex-party-2 | Bounded implementation tested/captures inspected; richer dancing deferred; release pending |
| Vehicle lanes / bounded loaded detour | `codex/forklift-traffic-recovery` `9531a3b`, `6a63934`; `briefs/vehicle-lanes.REPORT.md`, `forklift-detour.REPORT.md` | Focused candidate; late-arrival/reverse recovery still partial |
| Joist support articulation | `codex/support-transfer-articulation` `5dfe067`, install-cancel checkout | Opt-in candidate, not default registry; V3 actual-foot issue not claimed fixed |
| Exact item entry | `codex/item-entry-bridge` `52286a0` plus dirty deadlock-tails checkout; `briefs/item-entry.REPORT.md` | **Uncommitted WIP: source-hold exit/directive guard incomplete. Preserve; do not merge.** Fine fingers deferred separately from correctness |
| New classroom integration | `codex/classroom-integration`, studio-integration checkout, starts release13 | Active; gate/release pending |

Worktree directories are under `<mars-worktrees>/`. Branches and reports are evidence pointers, not a green release claim. Preserve ignored captures/scripts and other agents’ dirty work.

## New activity evidence (unreleased)

Classroom candidate `codex/classroom-integration` derives typed roles/requirements, seat binding, attention/questions, rotation, conversation and safe interruption from release13. Reports: [coordinator](briefs/classroom-activity.REPORT.md), [objects](briefs/classroom-objects.REPORT.md), [playable integration](briefs/classroom-playable.REPORT.md), [claim-aware nudges](briefs/classroom-make-way.REPORT.md). This narrows prerequisites associated with LM115/116/120/121 and selects only the actor-claim guard from432f05e/LM105; none of those broader original rows is declared fully fixed. Joining/resumption, moving-seat rebinding, gestures and conversation turn-taking remain gaps.

## Original row dispositions

### LM-001 — [C1] Stale plan is refused and the director must re-bind by hand; no automatic replan/rebind

- **Disposition:** Released fixed.
- **Why it matters / original intent:** controller; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 63; cited sources `EV:44,274,796,911; TP:225-227,243; DD:252-276; HO:639`.
- **Current implementation / remaining work:** **W58 FIXED** (`api.test.ts` "rebind (LM-001): execute/rehearse rebind:auto …"): `rebind:'auto'` on execute/rehearse → new plan_id + `plan.rebound` {diff, affected}; `plan.rebind-failed` names the step; default keeps `plan.stale`. Director-demo transcript step: W57. — api test: a physical edit after bind makes `execute` auto-rebind + re-rehearse (or one `rebind` op) and report the diff; `plan.stale` kept as the opt-out path
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Already shipped; retain regression safeguards. Promote only for a reproduced failure or needed extension.
- **Dependencies:** LM-003. **Likely baseline impact:** maybe — director-demo transcript ids only.
- **Bounded next task / model:** Verify the released behavior with its existing regression; no new work scheduled.

### LM-002 — [C2] Static geometry is not editable over MCP (no widen corridor / remove wall)

- **Disposition:** Released fixed.
- **Why it matters / original intent:** controller; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 64; cited sources `HO:521,639; DD:410-412`.
- **Current implementation / remaining work:** FIXED wave1: fork-local static_add/update/remove; support/collision refusals; effective camera/navigation scene. Six edit-static regressions (including symmetric ID/atomic-batch refusal), MCP stale/rebind route check, inspected static-edit captures. Supporting assembly changes refuse.
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Already shipped; retain regression safeguards. Promote only for a reproduced failure or needed extension.
- **Dependencies:** —. **Likely baseline impact:** maybe — planning budget if static hash enters baselines.
- **Bounded next task / model:** Verify the released behavior with its existing regression; no new work scheduled.

### LM-003 — [C2] Region layout edits don't stale plans (`layout` not in physicalView, world/types.ts:154-170)

- **Disposition:** Released fixed.
- **Why it matters / original intent:** controller; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 65; cited sources `HO:521,639; DD:418-419`.
- **Current implementation / remaining work:** **W58 FIXED** (`api.test.ts` "staleness (LM-003): a layout-only region edit stales a gather …"); pins unchanged (layout only hashed when present). — test: a layout-only region edit gives `plan.stale` with the region in `diff.regions`
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Already shipped; retain regression safeguards. Promote only for a reproduced failure or needed extension.
- **Dependencies:** —. **Likely baseline impact:** maybe — any state hash that includes physicalView regions.
- **Bounded next task / model:** Verify the released behavior with its existing regression; no new work scheduled.

### LM-004 — [C2] Staleness is conservative: any physicalHash diff stales a plan, relevant to its route or not

- **Disposition:** Released fixed.
- **Why it matters / original intent:** controller; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 66; cited sources `EV:44,274`.
- **Current implementation / remaining work:** **W58 FIXED** (`api.test.ts` "staleness (LM-004): an edit far from every step keeps the plan valid …" + "… an unrehearsed plan is scoped too …"; `rehearsal/envelope.ts`). — region-scoped staleness test: an edit far from every step's footprint keeps the plan valid, an edit on the route stales it
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Already shipped; retain regression safeguards. Promote only for a reproduced failure or needed extension.
- **Dependencies:** LM-003. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify the released behavior with its existing regression; no new work scheduled.

### LM-005 — [C2] `edit_world` refuses to move vehicles (api/edit.ts:159); tests stage overlaps by raw world edits

- **Disposition:** Released fixed.
- **Why it matters / original intent:** controller; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 67; cited sources `EV:321,785; HO:625; VE:134-135; PR W25`.
- **Current implementation / remaining work:** FIXED wave1 follow-up: valid parked vehicle setup uses edit_world; carried-load overlaps refuse edit.blocked without mutation. Raw overlap retained only as explicit invariant fault injection. vehicle-edit-tests.REPORT.md.
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Already shipped; retain regression safeguards. Promote only for a reproduced failure or needed extension.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify the released behavior with its existing regression; no new work scheduled.

### LM-006 — [C2] Reconstructed mars-2026 scene is not seeded into rooms (2026 rooms are synthetic only; seeds.ts:86)

- **Disposition:** Released fixed.
- **Why it matters / original intent:** controller; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 68; cited sources `DD:423-424`.
- **Current implementation / remaining work:** FIXED wave1: protected reconstructed mars-2026 plus idempotent migration; room.campus-conflict preserves colliding old workspace. room-campus-2026 tests + MCP query/protection checks. Source JSON unchanged.
- **Source/tests/evidence:** [docs/engineering/briefs/room-campus-2026.REPORT.md](briefs/room-campus-2026.REPORT.md)
- **Deferral / promotion trigger:** Already shipped; retain regression safeguards. Promote only for a reproduced failure or needed extension.
- **Dependencies:** —. **Likely baseline impact:** maybe — perf-walk campus if the scene file changes.
- **Bounded next task / model:** Verify the released behavior with its existing regression; no new work scheduled.

### LM-007 — [C3] NL camera parser not wired into the controller: not exported from camera/index.ts, no ParseVocab from SemanticWorld, used only by app/studio/direct-panel.tsx

- **Disposition:** Released fixed.
- **Why it matters / original intent:** controller; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 69; cited sources `HO:712; PR W45,W48; CX-nl:108; SR:343-353`.
- **Current implementation / remaining work:** FIXED wave1 complete: engine_parse_camera + direct_camera sentences share vocabulary/resolution with Studio Say-it. Fixture selector, active take/chapter guards, world-edit-aware cameras. API/unit/e2e coverage; camera reports in briefs.
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Already shipped; retain regression safeguards. Promote only for a reproduced failure or needed extension.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify the released behavior with its existing regression; no new work scheduled.

### LM-008 — [C3] "main pallet racks" only resolves through the take's "rack bay" structure (no alias / named asset)

- **Disposition:** Released fixed.
- **Why it matters / original intent:** controller; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 70; cited sources `EV:316,700; PR W16`.
- **Current implementation / remaining work:** **W58 FIXED** (`api.test.ts` "parse_camera (LM-007/008) …" + "… bare 2026 racks are a question with candidates …"): alias table in `api/camera-vocab.ts` (not in `direct.ts`). — SemanticWorld alias plus a direct-camera test resolving the phrase
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Already shipped; retain regression safeguards. Promote only for a reproduced failure or needed extension.
- **Dependencies:** LM-007. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify the released behavior with its existing regression; no new work scheduled.

### LM-009 — [C3] Camera direction schema has no fixture subject kind ("the sink" only via `context.lookAt`)

- **Disposition:** Released fixed.
- **Why it matters / original intent:** controller; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 71; cited sources `CX-nl:107`.
- **Current implementation / remaining work:** FIXED wave1: fixture schema approved in CODEX §7; clustered sink parsed/framed without dropping components. Four fixture tests and inspected real2024 sink capture. No pin changes.
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Already shipped; retain regression safeguards. Promote only for a reproduced failure or needed extension.
- **Dependencies:** LM-007. **Likely baseline impact:** maybe — camera ids.
- **Bounded next task / model:** Verify the released behavior with its existing regression; no new work scheduled.

### LM-010 — [C3] Bounded NL grammar: untested paraphrases refused ("zoom in", orbit without angle, "wide lens")

- **Disposition:** Released fixed.
- **Why it matters / original intent:** controller; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 72; cited sources `CX-nl:106,109`.
- **Current implementation / remaining work:** FIXED wave1: explicit bounded-grammar refusal contract and fixtures in camera-parse.test.ts. Unknown verb, missing orbit angle, deictic subject, ambiguity, wide-lens note.
- **Source/tests/evidence:** [docs/engineering/briefs/camera-fixtures.REPORT.md](briefs/camera-fixtures.REPORT.md)
- **Deferral / promotion trigger:** Already shipped; retain regression safeguards. Promote only for a reproduced failure or needed extension.
- **Dependencies:** LM-007. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify the released behavior with its existing regression; no new work scheduled.

### LM-011 — [C3] Director demo never calls `engine_direct_camera` or a sentence; DD/LG tool lists lag the registry (12/13 vs 14 engine tools)

- **Disposition:** Released fixed.
- **Why it matters / original intent:** controller; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 73; cited sources `DD:82-84,61; LG:49-57`.
- **Current implementation / remaining work:** FIXED wave1: director-demo step5b asserts sentence -> parse -> direct equals typed directions and unchanged take/head. Local workerd transcript passed; inventories derive engineTools(). Wider prose cleanup remains LM174.
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Already shipped; retain regression safeguards. Promote only for a reproduced failure or needed extension.
- **Dependencies:** LM-007. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify the released behavior with its existing regression; no new work scheduled.

### LM-012 — [C3] Direct compile blocks the page ≈ 5.6 s on a chapter take (D2)

- **Disposition:** Implemented candidate, awaiting verification/integration.
- **Why it matters / original intent:** controller; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 74; cited sources `SR:474-476; PR W48, lead 1333`.
- **Current implementation / remaining work:** PARTIAL wave1: file-take compile moved to cancellable browser worker; complete result/track identity, real UI frames during work and stale-result cleanup tested. Synthetic long-lead-in sampler proxy replaces parked historical D2 assertion (no false2424-call claim). Remaining Next steps: faster identical hash and per-id centre sampling; directOnYear/scene preparation still synchronous.
- **Source/tests/evidence:** [docs/engineering/briefs/camera-cache.REPORT.md](briefs/camera-cache.REPORT.md); [docs/engineering/briefs/camera-navmesh-cache.REPORT.md](briefs/camera-navmesh-cache.REPORT.md); [docs/engineering/briefs/wave1-integration.REPORT.md](briefs/wave1-integration.REPORT.md)
- **Deferral / promotion trigger:** Useful existing work is preserved. Review/select when needed by a playable milestone or inexpensive safe integration; do not expand into another research task.
- **Dependencies:** —. **Likely baseline impact:** no — must be output-identical.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-013 — [C4] Directed tracks are download-only; no room op stores a directed track beside its take

- **Disposition:** Released fixed.
- **Why it matters / original intent:** controller; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 75; cited sources `EV:318,737; HO:630-631; CD:413-415; SR:383-397,444-445; PR W19,W22,W24`.
- **Current implementation / remaining work:** **W58 FIXED** (`api.test.ts` "store_camera_track (LM-013) …"): op `engine_store_camera_track`; per-take camera byte cap `MAX_TAKE_CAMERA_BYTES` 4 MiB (see CAMERA_DIRECT §8.3). Studio call: lane S. — op (sibling of `attach_camera_track`) saves a compiled directed track next to a take; test: take hash unchanged and the track is listed and replayable
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Already shipped; retain regression safeguards. Promote only for a reproduced failure or needed extension.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify the released behavior with its existing regression; no new work scheduled.

### LM-014 — [C5] Two control paths: 20 legacy tools (18 in simulation/commands.ts + get_state, get_capabilities) sit beside the 14 `engine_*` tools

- **Disposition:** Released fixed.
- **Why it matters / original intent:** controller; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 76; cited sources `LG:49; OWNER_DECISIONS last entry`.
- **Current implementation / remaining work:** FIXED wave1 technical-scope ruling: one domain-aware registry/dispatcher in simulation/control.ts for MCP and REST; integration calls every20 viewer +16 engine tool. Engine/viewer state stays separate (LM202 OOS); no world-model unification claimed.
- **Source/tests/evidence:** [docs/engineering/briefs/wave1-integration.REPORT.md](briefs/wave1-integration.REPORT.md)
- **Deferral / promotion trigger:** Already shipped; retain regression safeguards. Promote only for a reproduced failure or needed extension.
- **Dependencies:** LM-015. **Likely baseline impact:** no — legacy room state only; integration transcript changes.
- **Bounded next task / model:** Verify the released behavior with its existing regression; no new work scheduled.

### LM-016 — Sequence steps have no step-level timeout and no cancel/mark step verbs; `at` cues only apply to registry verbs

- **Disposition:** Released fixed.
- **Why it matters / original intent:** controller; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 77; cited sources `TP:334`.
- **Current implementation / remaining work:** **W58 FIXED** (`sequence.test.ts` "runner (LM-016): a step timeout …", "… cancel stops a live step …", "bind (LM-016) …"; `api.test.ts` "sequence built-ins over the op API (LM-016) …"). — runner test: step timeout fires with a named reason; cancel/mark steps work
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Already shipped; retain regression safeguards. Promote only for a reproduced failure or needed extension.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify the released behavior with its existing regression; no new work scheduled.

### LM-017 — Deleting a workspace leaves checkpoints addressable whose takes may be evicted → `take.unknown`

- **Disposition:** Released fixed.
- **Why it matters / original intent:** controller; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 78; cited sources `DD:420-422`.
- **Current implementation / remaining work:** **W58 FIXED** (`api.test.ts` "get_take (LM-017): a take evicted after its workspace was deleted is take.evicted …"). — get_take gives a named `take.evicted` refusal (or eviction is blocked while reachable), with a test
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Already shipped; retain regression safeguards. Promote only for a reproduced failure or needed extension.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify the released behavior with its existing regression; no new work scheduled.

### LM-018 — DO storage: chunking splits UTF-16 surrogates; 512 Ki chars of 3-byte text exceed 2 MB; caps are counts (64 plans / 32 takes), not bytes (REVIEW L8)

- **Disposition:** Released fixed.
- **Why it matters / original intent:** controller; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 79; cited sources `RV:277-282; EV:302,469; HO:286-287`.
- **Current implementation / remaining work:** FIXED wave1: codepoint-safe512KiB chunks,8MiB blob/64MiB room-year byte caps and transactional rollback, tested emoji boundary/oversize/aggregate refusal. Count caps retained.
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Already shipped; retain regression safeguards. Promote only for a reproduced failure or needed extension.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify the released behavior with its existing regression; no new work scheduled.

### LM-019 — Year-build-sized takes in a DO room are untested against the 30 s CPU limit

- **Disposition:** Released fixed.
- **Why it matters / original intent:** controller; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 80; cited sources `HO:284-286`.
- **Current implementation / remaining work:** FIXED wave1 by named refusal: real185-step chapter exceeds32KiB request cap -> room.request-too-large; stored oversized chapter -> room.workload-limit. SQLite and workerd/MCP tests. Conservative96steps/128entities admission is not a30sCPU guarantee.
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Already shipped; retain regression safeguards. Promote only for a reproduced failure or needed extension.
- **Dependencies:** LM-015. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify the released behavior with its existing regression; no new work scheduled.

### LM-202 — [C5] Not one world model: the Studio component editor / saved layouts don't create engine design-edit checkpoints; the legacy people/EUC simulation is a parallel sim layer

- **Disposition:** Out of scope (existing ruling).
- **Why it matters / original intent:** controller; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 81; cited sources `SP:23,175,264`.
- **Current implementation / remaining work:** Studio edits go through `engine_edit_world` (e2e + api test); legacy people commands become engine verbs — lead may de-scope as a new feature (§9)
- **Source/tests/evidence:** [docs/engineering/briefs/wave1-integration.REPORT.md](briefs/wave1-integration.REPORT.md)
- **Deferral / promotion trigger:** Existing owner ruling excludes/replaces this requirement. Reopen only for an explicit scope decision; preserve original tests/meaning where applicable.
- **Dependencies:** LM-014. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-203 — Action contract not fully machine-readable: `list_verbs` gives description + input schema only (no preconditions, reservations, phases, completion, failure codes, cancel semantics, outputs)

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** controller; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 82; cited sources `SP:150`.
- **Current implementation / remaining work:** describeVerbs emits those fields per ActionDef; api.test asserts every verb has them
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-204 — No visual scene awareness over the API (no capture op from a requested viewpoint; director captures only via local Playwright)

- **Disposition:** Out of scope (existing ruling).
- **Why it matters / original intent:** controller; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 83; cited sources `SP:177`.
- **Current implementation / remaining work:** capture op backed by a render host, with a test — needs a rendering host (Browser Rendering / local service); lead may re-classify (§9)
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Existing owner ruling excludes/replaces this requirement. Reopen only for an explicit scope decision; preserve original tests/meaning where applicable.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-020 — [E1] No space-time reservations: simultaneous carries/formations are not co-planned (sequences order them with `after`); walker encounters have no time-to-collision model

- **Disposition:** Implemented candidate, awaiting verification/integration.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 89; cited sources `EV:38,184,857,313,646; HO:219-220,450; MV:222-225`.
- **Current implementation / remaining work:** two crossing carries with no `after` both complete with 0 violations, **or** a proven ordering rule plus a test that validate refuses an unordered overlap
- **Source/tests/evidence:** [docs/engineering/briefs/carry-ordering.REPORT.md](briefs/carry-ordering.REPORT.md)
- **Deferral / promotion trigger:** Useful existing work is preserved. Review/select when needed by a playable milestone or inexpensive safe integration; do not expand into another research task.
- **Dependencies:** LM-024. **Likely baseline impact:** yes — every walker/carry pin if behaviour changes; a pure ordering proof may be pin-neutral.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-021 — [E1] Head-on round a tight corner falls to the single-file rule, not the encounter logic

- **Disposition:** Implemented candidate, awaiting verification/integration.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 90; cited sources `EV:313,646; HO:627; PR W15; MV:222-225`.
- **Current implementation / remaining work:** movement test: a curved head-on meeting passes without single-file where width allows
- **Source/tests/evidence:** [docs/engineering/briefs/walk-paired-lanes.REPORT.md](briefs/walk-paired-lanes.REPORT.md)
- **Deferral / promotion trigger:** Useful existing work is preserved. Review/select when needed by a playable milestone or inexpensive safe integration; do not expand into another research task.
- **Dependencies:** LM-020. **Likely baseline impact:** yes — perf-walk.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-022 — [E1] Two climb links on one column face are not mutually exclusive

- **Disposition:** Released fixed.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 91; cited sources `EV:307,547; HU:272-273`.
- **Current implementation / remaining work:** FIXED wave1 follow-up: stable upright+column+local-face reservation spans seat heights/up/down and approach; named conflict before motion, opposite columns independent, safe cancel/completion release. climb-reservation.test.ts and inspected diagnostic JSON; no schema/pin changes.
- **Source/tests/evidence:** [docs/engineering/briefs/wave1-integration.REPORT.md](briefs/wave1-integration.REPORT.md)
- **Deferral / promotion trigger:** Already shipped; retain regression safeguards. Promote only for a reproduced failure or needed extension.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify the released behavior with its existing regression; no new work scheduled.

### LM-024 — [E2] No deadlock detector: mutual waits (head-on in a single-file passage, walled-in walker, two walkers arriving close, blocked mid-carry, forklift pull-over retry) show only as a runner timeout, not `blocked`

- **Disposition:** Implemented candidate, awaiting verification/integration.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 92; cited sources `EV:31,86,313,646,792,841; HO:221-226,243-244,450-451,627; TP:331-333; CA:169; MV:95-96,231-235; VE:107-108`.
- **Current implementation / remaining work:** detector names the wait cycle and turns it into `blocked` (+ replan); proving-ground passage test with 2 walkers and a forced 3-cycle; partial passage release exists (walk.ts:827, W38)
- **Source/tests/evidence:** [docs/engineering/briefs/deadlock-tails.REPORT.md](briefs/deadlock-tails.REPORT.md)
- **Deferral / promotion trigger:** Useful existing work is preserved. Review/select when needed by a playable milestone or inexpensive safe integration; do not expand into another research task.
- **Dependencies:** —. **Likely baseline impact:** maybe — pin-neutral if it only reports; replan-on-detect can move pins where a pinned run waits.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-025 — [E2] Dead-end corridor A: 21/252 layouts end with the crew waiting (`carry.path-occupied`); the walker would have to back out

- **Disposition:** Implemented candidate, awaiting verification/integration.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 93; cited sources `RV:77`.
- **Current implementation / remaining work:** the corridor-A sweep ends with 0 waiting layouts
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Useful existing work is preserved. Review/select when needed by a playable milestone or inexpensive safe integration; do not expand into another research task.
- **Dependencies:** LM-024. **Likely baseline impact:** maybe — carry gather routes G.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-029 — [E3] `snapshot()` refuses while a directive waits for a stand-up

- **Disposition:** Released fixed.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 94; cited sources `EV:320,768`.
- **Current implementation / remaining work:** FIXED release12: queued directive intent survives before/mid-stand-up snapshots with exact world/event/record continuation; missing dependencies and forged return/wait provenance refuse. Six inspected captures and full green gate; started carry remains explicitly non-resumable.
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Already shipped; retain regression safeguards. Promote only for a reproduced failure or needed extension.
- **Dependencies:** LM-026. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify the released behavior with its existing regression; no new work scheduled.

### LM-032 — [E4] Climb paths are three straight segments with no body check (frame stances, climb links)

- **Disposition:** Implemented candidate, awaiting verification/integration.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 95; cited sources `HO:637-638; PR W7; EV:307,547,605; HU:272-273; YB:181-182`.
- **Current implementation / remaining work:** climb path swept with the body envelope against structure and people; test with a member across the path
- **Source/tests/evidence:** [docs/engineering/briefs/live-link.REPORT.md](briefs/live-link.REPORT.md)
- **Deferral / promotion trigger:** Useful existing work is preserved. Review/select when needed by a playable milestone or inexpensive safe integration; do not expand into another research task.
- **Dependencies:** —. **Likely baseline impact:** maybe — year-build.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-035 — [E5] BOM solar ids differ from the catalog solar ids

- **Disposition:** Implemented candidate, awaiting verification/integration.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 96; cited sources `HO:638; PR W7`.
- **Current implementation / remaining work:** one id scheme plus a BOM ↔ catalog test
- **Source/tests/evidence:** [docs/engineering/briefs/bom-solar.REPORT.md](briefs/bom-solar.REPORT.md)
- **Deferral / promotion trigger:** Useful existing work is preserved. Review/select when needed by a playable milestone or inexpensive safe integration; do not expand into another research task.
- **Dependencies:** —. **Likely baseline impact:** maybe — year-build.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-041 — [E8] After a stair carry `stagedCheck` checks distance only (no support/surface or clearance)

- **Disposition:** Implemented candidate, awaiting verification/integration.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 97; cited sources `CA:125; EV:294,337`.
- **Current implementation / remaining work:** staged-on-deck check verifies surface and OBB clearance; test places a load half off the deck
- **Source/tests/evidence:** [docs/engineering/briefs/staged-layout.REPORT.md](briefs/staged-layout.REPORT.md); [docs/engineering/briefs/staged-support.REPORT.md](briefs/staged-support.REPORT.md)
- **Deferral / promotion trigger:** Useful existing work is preserved. Review/select when needed by a playable milestone or inexpensive safe integration; do not expand into another research task.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-043 — [E9] 3+-vehicle yield cycles undetected; vehicle traffic is heuristic, not proven deadlock-free

- **Disposition:** Released fixed.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 98; cited sources `EV:321,785; HO:625; VE:133-134,140-141; PR W25`.
- **Current implementation / remaining work:** FIXED release11: actual three-EUC cycle reports blocked with riders/load ownership retained;240continuation ticks across failed autonomous retries, independent future cancel and endpoint/progress/timeout controls. briefs/vehicle-deadlock.REPORT.md; no general deadlock-freedom claim.
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Already shipped; retain regression safeguards. Promote only for a reproduced failure or needed extension.
- **Dependencies:** LM-024. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify the released behavior with its existing regression; no new work scheduled.

### LM-045 — [E9] Vehicles are discs: the bicycle's 1.75 m is not swept; yield zones use the reach disc; walkers see a rider as a 0.28 m person; empty-fork height assumed ≤ 0.45 m; overhead clearance uses 1.8 m

- **Disposition:** Implemented candidate, awaiting verification/integration.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 99; cited sources `EV:296,376; VE:130-131,133,138,141-143`.
- **Current implementation / remaining work:** oriented vehicle footprint in curve planning, yield zones and walker avoidance; test: a walker keeps distance along the bicycle's length
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Useful existing work is preserved. Review/select when needed by a playable milestone or inexpensive safe integration; do not expand into another research task.
- **Dependencies:** —. **Likely baseline impact:** maybe — perf-walk if walker avoidance changes.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-046 — [E9] Vehicle lanes are a straight read of the planned curve (no replan/braking prediction); traffic engages only with ≥ 2 ridden vehicles

- **Disposition:** Partial, deferred.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 100; cited sources `VE:129-130; EV:321`.
- **Current implementation / remaining work:** Vehicle lane freshness/traffic evidence is a candidate only; no full-row close. See docs/engineering/briefs/vehicle-deadlock.REPORT.md (explicitly says LM046 lane replanning remains outside its fixture) and parent-cited 6a63934.
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-047 — [E9] `carryIntegrity` flags fork loads (scenario routes around it); forklift loads blanket-exempt from `carry.support`

- **Disposition:** Implemented candidate, awaiting verification/integration.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 101; cited sources `EV:315,674; HO:192; PR lead ~19:30`.
- **Current implementation / remaining work:** forks count as support; flagship v2 runs without the workaround at 0 violations
- **Source/tests/evidence:** [docs/engineering/briefs/fork-cradle.REPORT.md](briefs/fork-cradle.REPORT.md); [docs/engineering/briefs/oriented-vehicle.REPORT.md](briefs/oriented-vehicle.REPORT.md)
- **Deferral / promotion trigger:** Useful existing work is preserved. Review/select when needed by a playable milestone or inexpensive safe integration; do not expand into another research task.
- **Dependencies:** —. **Likely baseline impact:** maybe — flagship v2.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-049 — [E10] Walk look-ahead assumes 0.9 m/s lateral, not the shared per-tick budget, so walkers briefly slow while sidestepping

- **Disposition:** Implemented candidate, awaiting verification/integration.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 102; cited sources `EV:319,750; HO:626; MV:215-217,326-328; PR W21`.
- **Current implementation / remaining work:** movement test: sidestep speed does not drop and pushes = 0 where the prediction used to miss
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Useful existing work is preserved. Review/select when needed by a playable milestone or inexpensive safe integration; do not expand into another research task.
- **Dependencies:** —. **Likely baseline impact:** yes — all walker pins (perf-walk 5, year-build, takes).
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-050 — [E10] Stress-30 max tick ≈ 90 ms (tick 5 = 27–30 synchronous exact A*); the ≤ 60 ms target is unmet (corridor planner opt-in only)

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 103; cited sources `HO:238-239,281-282,436-437,632-633; PB:34-41,195-200,436-438; PR W11`.
- **Current implementation / remaining work:** perf-walk reports max tick ≤ 60 ms on stress-30 with a recorded re-pin reason
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** LM-049. **Likely baseline impact:** yes — stress-30 and every pin if submit planning is spread.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-051 — [E10] 1.08–1.5 m gaps between people are walkable but not plannable at 0.1 m cells

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 104; cited sources `EV:313,646; HO:626-627; PR W15; MV:95-96,231-235`.
- **Current implementation / remaining work:** planner test routes through a 1.2 m gap between two standing people
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** yes — perf-walk.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-053 — [E10] Look-ahead cache / arc memo not done

- **Disposition:** Partial, deferred.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 105; cited sources `PB:201-203`.
- **Current implementation / remaining work:** hash-identical cache with a perf assertion, or struck from PB as unneeded (hazardAhead 0.03 ms/tick)
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** LM-049. **Likely baseline impact:** no — must be hash-neutral.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-054 — [E11] Only walk_to publishes speed (walk.ts:233): carry, climb, stance, sit, vehicles and forklift don't, so they are bounded only by `motion.teleport` 0.15 m

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 106; cited sources `EV:319,750; HO:626; MV:229-230,329-332; TP:63; VE:67; PR W21`.
- **Current implementation / remaining work:** every mover sets `human.speed`; `motion.overspeed` caps per activity (carry 0.9, climb 0.35 …); a per-mover overspeed test
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** yes — takes with a speed field (take bytes/ids); state hash if speed is in state.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-055 — [E11] Emergency stop drops velocity to 0 in one tick

- **Disposition:** Superseded: struck as not an item.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 107; cited sources `EV:313,646; MV:226-228`.
- **Current implementation / remaining work:** decel-limited stop test (or cite the SPEC clause that asks for an instant stop and re-classify, see §9)
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Existing owner ruling excludes/replaces this requirement. Reopen only for an explicit scope decision; preserve original tests/meaning where applicable.
- **Dependencies:** LM-054. **Likely baseline impact:** yes — perf-walk, takes.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-056 — [E12] Camera phase 2 applies one correction per shot (first valid wins; raise ranks before swing); a shot needing raise + swing is refused

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 108; cited sources `CD:363-364,370-371; EV:317,722; HO:628; PR W18`.
- **Current implementation / remaining work:** fixture needing two strategies is corrected with both recorded; ranking prefers the least deviation from the ask
- **Source/tests/evidence:** [docs/engineering/briefs/camera-cache.REPORT.md](briefs/camera-cache.REPORT.md); [docs/engineering/briefs/camera-combined.REPORT.md](briefs/camera-combined.REPORT.md); [docs/engineering/briefs/camera-dynamic.REPORT.md](briefs/camera-dynamic.REPORT.md); [docs/engineering/briefs/camera-routed.REPORT.md](briefs/camera-routed.REPORT.md)
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** maybe — camera ids of corrected tracks.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-057 — [E12] Camera synthesis collides with static geometry only; take people/parts occlude but never block; people are not navmesh obstacles

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 109; cited sources `EV:316,700; HO:628-629; CD:353-355; PR W16`.
- **Current implementation / remaining work:** synthesis test avoids a moving person/part occluder
- **Source/tests/evidence:** [docs/engineering/briefs/camera-cache.REPORT.md](briefs/camera-cache.REPORT.md); [docs/engineering/briefs/camera-combined.REPORT.md](briefs/camera-combined.REPORT.md); [docs/engineering/briefs/camera-routed.REPORT.md](briefs/camera-routed.REPORT.md)
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** LM-056. **Likely baseline impact:** maybe — camera tracks.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-058 — [E12] Scene occlusion vs render mesh: prisms (pitched parts over-occlude), capsule people vs skinned bodies (≤ 0.15), 1 sample ≥ 0.2 in parity; static-subject readability from box points

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 110; cited sources `EV:40,41,215,228,299,425; HO:246,629; CM:144-147,159,189; CV:109-112; CD:356-357,368-369; SR:452-454`.
- **Current implementation / remaining work:** two-capsule person proxy plus pitched-part prisms; camera-verify parity with 0 samples ≥ 0.2
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** maybe — camera tracks.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-060 — [E12] Camera is a point with clearance, not a swept sphere (corners can be clipped ≈ 0.3 m between samples)

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 111; cited sources `CM:153-155`.
- **Current implementation / remaining work:** swept-capsule test: never crosses a corner
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** maybe — camera tracks.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-061 — [E12] Year-build/chapter readability low: bay-1 0.42, whole skeleton 0.31, bay-1/skeleton cameras 77 %, chapter min 0.60 on D0/D1/S; the rater scores the desired pose, not the corrected samples

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 112; cited sources `EV:317,722; HO:576-577,619; PR W39; YB:362-365; SR:442-443`.
- **Current implementation / remaining work:** rater scores final samples; readability floor ≥ 0.65 asserted on year-build takes; re-record
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** LM-056. **Likely baseline impact:** yes — take camera ids (re-record).
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-062 — [E12] Corrected hold still shows a bystander's head large in frame (foreground rule measures cover of the subject region only)

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 113; cited sources `SR:400-403,455-457`.
- **Current implementation / remaining work:** combined foreground-size + occlusion rule; test: no bystander > X % of frame in the carryA hold
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** LM-056. **Likely baseline impact:** maybe — corrected track ids.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-063 — [E12] `occluded` is off for fly-throughs and ignores co-subjects' bodies; flare not occluded by take parts/people; split re-times but does not recompute look-at for a moving subject

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 114; cited sources `CD:307,365-368,374-375,378-379`.
- **Current implementation / remaining work:** three fixture tests (fly-through occlusion, sun behind a sheet gives no flare fail, split on a walker stays centred)
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-064 — [E12] `shorten` and `cut` have no fixture where they win (exercised only via refusal lists)

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 115; cited sources `CD:372-373`.
- **Current implementation / remaining work:** camera-correct fixtures where each wins
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-065 — [E12] Director plans from stored thinned tracks (whole-house deltas 0.196 vs 0.2 threshold); planned cameras came from an exact 1 mm re-run, not the shipped tracks

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 116; cited sources `TP:173-180; EV:318,737`.
- **Current implementation / remaining work:** test: direct_camera on the shipped take equals the plan within margin, or it uses an exact re-run documented in TP
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-066 — [E12] Directed orbit heading search is marginal (a 5 mm tolerance flipped it)

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 117; cited sources `TP:151-153; PR W22,W23`.
- **Current implementation / remaining work:** tie margin; test perturbs tracks 1–5 mm and the choice is stable
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** maybe — flagship track.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-067 — Camera navmesh rebuilt per call (100–250 ms), not cached across calls

- **Disposition:** Implemented candidate, awaiting verification/integration.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 118; cited sources `EV:316,700; HO:629; CD:358-359; PR W16`.
- **Current implementation / remaining work:** cache keyed by scene hash; timing test (W54 left it: neither W54 case builds a navmesh; see CAMERA_DIRECT §9 next steps)
- **Source/tests/evidence:** [docs/engineering/briefs/camera-benchmark-plan.REPORT.md](briefs/camera-benchmark-plan.REPORT.md); [docs/engineering/briefs/camera-navmesh-cache.REPORT.md](briefs/camera-navmesh-cache.REPORT.md)
- **Deferral / promotion trigger:** Useful existing work is preserved. Review/select when needed by a playable milestone or inexpensive safe integration; do not expand into another research task.
- **Dependencies:** LM-012. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-068 — No hard minimum shot length in Viterbi; candidates local to the target (no global search / cross-subject grammar); hairpin fly-throughs slow; region box height from obstacle centres (3 m fallback)

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 119; cited sources `CM:156-158; CD:360-361,381-382`.
- **Current implementation / remaining work:** min-shot-length constraint test plus a hairpin fly-through time bound; global search stays out (the explicit ladder is SP §18 design)
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** maybe — camera tracks.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-069 — Camera safe area: top toolbars (≈ 0.18) not modelled; the canvas bar is really ≈ 0.22 vs the planned 0.17

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 120; cited sources `CM:160-165`.
- **Current implementation / remaining work:** quality.ts models top and bottom UI bands; test with the measured bar
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** yes — takes (camera track re-record).
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-070 — [E13] One reach-down cap (0.5 m) and one set of bands for templates reaching 0.35–0.54 m; the woman template's arms hang (ENGINE MISMATCH printed); deck-hand points set for one torso

- **Disposition:** Implemented candidate, awaiting verification/integration.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 121; cited sources `EV:314,662; HO:595-597,620-621; PR W9,W12,W14,W35; BM:169-174; PO:154-155,321`.
- **Current implementation / remaining work:** per-person body variant in body/model.ts used by station choice; test: a short template is refused a reach the tall one gets; no MISMATCH print
- **Source/tests/evidence:** [docs/engineering/briefs/body-variants.REPORT.md](briefs/body-variants.REPORT.md); [docs/engineering/briefs/flat-palm.REPORT.md](briefs/flat-palm.REPORT.md)
- **Deferral / promotion trigger:** Useful existing work is preserved. Review/select when needed by a playable milestone or inexpensive safe integration; do not expand into another research task.
- **Dependencies:** —. **Likely baseline impact:** yes — v3, handup tests, year-build maybe.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-071 — [E13] lowReach 0.5, tableReach 0.6, carryHand, seatedDrop are stated, not measured

- **Disposition:** Implemented candidate, awaiting verification/integration.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 122; cited sources `BM:26,30,36,40`.
- **Current implementation / remaining work:** measured from the rig in poses.spec and pinned in body-model.test
- **Source/tests/evidence:** [docs/engineering/briefs/body-variants.REPORT.md](briefs/body-variants.REPORT.md)
- **Deferral / promotion trigger:** Useful existing work is preserved. Review/select when needed by a playable milestone or inexpensive safe integration; do not expand into another research task.
- **Dependencies:** LM-070. **Likely baseline impact:** maybe — meal, paint.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-072 — [E14] setpart.ts:241 erasing op `(P.p[0] - final.p[0]) * 0`

- **Disposition:** Released fixed.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 123; cited sources `PR W45; CX-tool:41,73,111; lint`.
- **Current implementation / remaining work:** **W57 DONE, hash-neutral (57a80f4):** the `* 0` term was a dead store — `Up.p` is overwritten two lines later (`[C.p[0], floor + restHand.up + 0.3 − g, C.p[2]]`) before any read; the intent (tip up over where it was lifted = C's x/z) is what that overwrite does, so the term was removed. A+B `ddb634d6` re-run with `YEAR_BUILD_FULL=1`: unchanged. No re-pin needed. intent decided (term removed or restored) with the wall tip-up test; A+B stays or is re-pinned with a reason
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Already shipped; retain regression safeguards. Promote only for a reproduced failure or needed extension.
- **Dependencies:** LM-076. **Likely baseline impact:** maybe — yb-AB wall panels.
- **Bounded next task / model:** Verify the released behavior with its existing regression; no new work scheduled.

### LM-073 — [E14] core/math.ts:209,298 number literals lose precision at runtime (`no-loss-of-precision`)

- **Disposition:** Released fixed.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 124; cited sources `lint`.
- **Current implementation / remaining work:** **W57 DONE, hash-neutral (67c4698):** fdlibm `pi_lo` and the log 1/3 coefficient written at double precision (`1.2246467991473532e-16`, `0.3333333333333333`); ECMAScript number parsing is correctly rounded, so they are the same doubles as the long literals (`Object.is` checked). All pins unchanged. literals written at double precision; determinism probe + all pins unchanged (or re-pin with reason)
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Already shipped; retain regression safeguards. Promote only for a reproduced failure or needed extension.
- **Dependencies:** LM-076. **Likely baseline impact:** maybe — any hash through those constants.
- **Bounded next task / model:** Verify the released behavior with its existing regression; no new work scheduled.

### LM-074 — [E14] 14 host `**` sites allow-listed in source-scan; `contents.count` untyped

- **Disposition:** Implemented candidate, awaiting verification/integration.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 125; cited sources `HO:637,714; PR W7,W15,W33,W45; CX-tool:88-107,112`.
- **Current implementation / remaining work:** allowlist empty (core/math pow) and source-scan green; typed `contents.count` passes tsc
- **Source/tests/evidence:** [docs/engineering/briefs/integer-power.REPORT.md](briefs/integer-power.REPORT.md)
- **Deferral / promotion trigger:** Useful existing work is preserved. Review/select when needed by a playable milestone or inexpensive safe integration; do not expand into another research task.
- **Dependencies:** LM-076. **Likely baseline impact:** maybe — hashes by ulps (camera/quality, sun, social, path …).
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-075 — REVIEW L1 + L2: history objects exposed by reference (`publishCanonical` silently replaces, returns the internal Workspace; mutable checkpoints); `fromJSON` trusts stored hashes

- **Disposition:** Released fixed.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 126; cited sources `RV:242-253`.
- **Current implementation / remaining work:** FIXED release12: private history maps, copied/frozen values, atomic duplicate publication refusal, validated hashes/index/ancestry and lazy/cached blob provenance; 15 inspected corruption/isolation captures and full green gate
- **Source/tests/evidence:** [docs/engineering/briefs/history-integrity.REPORT.md](briefs/history-integrity.REPORT.md)
- **Deferral / promotion trigger:** Already shipped; retain regression safeguards. Promote only for a reproduced failure or needed extension.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify the released behavior with its existing regression; no new work scheduled.

### LM-076 — REVIEW L3 + L4: explicit action ids can collide (runtime.ts:87); stepLink checks the plan-time Link's `usable` (walk.ts:1272)

- **Disposition:** Released fixed.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 127; cited sources `RV:254-261`.
- **Current implementation / remaining work:** FIXED release13: explicit duplicate ids refuse action.duplicate-id before mutation; live link state is revalidated during traversal, and cancellation uses a supported clear landing or refuses route.landing-unavailable while retaining pose/claims. Full gate and inspected invalid-case captures; duplicate early link synchronization removed without moving pins.
- **Source/tests/evidence:** [docs/engineering/briefs/live-link.REPORT.md](briefs/live-link.REPORT.md)
- **Deferral / promotion trigger:** Already shipped; retain regression safeguards. Promote only for a reproduced failure or needed extension.
- **Dependencies:** —. **Likely baseline impact:** maybe — makeWay ids.
- **Bounded next task / model:** Verify the released behavior with its existing regression; no new work scheduled.

### LM-077 — REVIEW L5: decks within ±0.25 m share a level id (access.ts:30-31); people render up to 0.25 m sunk/floating; no foot-y invariant

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 128; cited sources `RV:262-267`.
- **Current implementation / remaining work:** foot-y vs surface invariant plus a two-close-decks test
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** maybe — year-build (many decks).
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-078 — REVIEW L7: a cancel-initiated carry set-down ignores bystanders

- **Disposition:** Implemented candidate, awaiting verification/integration.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 129; cited sources `RV:273-276`.
- **Current implementation / remaining work:** cancel with a person under the set-down footprint gives `carry.cancel-unsafe`
- **Source/tests/evidence:** [docs/engineering/briefs/carry-cancel-people.REPORT.md](briefs/carry-cancel-people.REPORT.md)
- **Deferral / promotion trigger:** Useful existing work is preserved. Review/select when needed by a playable milestone or inexpensive safe integration; do not expand into another research task.
- **Dependencies:** —. **Likely baseline impact:** maybe — carry pins.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-079 — REVIEW L9 + sampled sweeps: clearance margins (PLAN_MARGIN 0.06, tol 0.03) are thinner than the raster error (≈ 0.07); U-trap clearance per tick on the EDT grid; raise arc sampled; hand-up plan sweep every 5 cm

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 130; cited sources `RV:283-288; EV:30,35,68,142; HO:245-246; PR W30`.
- **Current implementation / remaining work:** a written bound (sample spacing ≤ margin) in ENGINE_GUIDE plus tests showing the invariant catches a ≥ X cm overlap and an arc clip between samples
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** no — documentation plus tests; a margin change would move all pins and is not proposed.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-080 — Mid-carry: carry height uses the 0.22–1.8 m body band (a hand-height load can't pass under a 1.7 m member; items < 0.22 m ignored while moving)

- **Disposition:** Implemented candidate, awaiting verification/integration.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 131; cited sources `CA:40-41,162-164`.
- **Current implementation / remaining work:** load swept at its own height: test passes under a 1.7 m member and flags a low stack
- **Source/tests/evidence:** [docs/engineering/briefs/carry-height.REPORT.md](briefs/carry-height.REPORT.md)
- **Deferral / promotion trigger:** Useful existing work is preserved. Review/select when needed by a playable milestone or inexpensive safe integration; do not expand into another research task.
- **Dependencies:** —. **Likely baseline impact:** maybe — carry pins.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-081 — Items: a carried item trails its hand by one tick (≤ 7 cm) while walking (hold_items steps before the walker)

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 132; cited sources `EV:308,562; HO:634; IT:96-97; PR W5`.
- **Current implementation / remaining work:** meal.test asserts item pose = hand every tick
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** yes — meal, any take with held items.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-082 — Items: reach over a table assumes a forward bend (shoulder→item ≈ 1.1 m); only eating is checked against the 0.62 m envelope

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 133; cited sources `EV:308,562; HO:634; IT:69,93-94; PR W5`.
- **Current implementation / remaining work:** take/put reach checked against a bent-over envelope; over-reach across the table is refused
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** LM-070. **Likely baseline impact:** maybe — meal.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-084 — Stance holders hold the beam 0.73–0.79 m beside the body (no facing turn); the rear hang_beam lifter carries the beam 0.35–0.65 m behind its back; climbing facing is renderer-only

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 134; cited sources `HO:614-615; PR W14 (f1,f2),W24; PO:156-162,170-172,183-185,327-329; SR:446-449`.
- **Current implementation / remaining work:** engine publishes a facing toward the held load / along the carry; test: hands in front of the body plane on every stance and hang_beam tick
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** yes — year-build pins, chapter takes.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-085 — No engine foot/hand holds on the bracing (which node a climber stands on); the renderer infers the ladder cycle

- **Disposition:** Partial, deferred.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 135; cited sources `HO:616; PR W14 f4; EV:307,547; PO:189-190,324-325`.
- **Current implementation / remaining work:** Frame bracing holds remain open; LM032 continuous climb sweep does not close published hand/foot node contact. See docs/engineering/briefs/climb-sweep.REPORT.md.
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** LM-032. **Likely baseline impact:** yes — year-build takes.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-086 — Bundles keep their full box until empty (engine); the pull off a bundle is not modelled (piece appears after 4 s)

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 136; cited sources `HO:638; PR W7; YB:89-90,185-186; EV:311,605`.
- **Current implementation / remaining work:** obstacle box shrinks with `contents.count` (test); pull phase with hands in the take
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** yes — year-build.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-087 — Beam walk-in checks static geometry only (partly addressed by W38's bystander rule)

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 137; cited sources `HO:638; PR W7,W38`.
- **Current implementation / remaining work:** test: a person in the walk-in path is asked to make way or the step waits
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** maybe — year-build.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-088 — Giver hands sit at 0 mm slack on the reach envelope

- **Disposition:** Implemented candidate, awaiting verification/integration.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 138; cited sources `HO:621; PR W12`.
- **Current implementation / remaining work:** explicit epsilon margin; test fails at the boundary
- **Source/tests/evidence:** [docs/engineering/briefs/handup-release.REPORT.md](briefs/handup-release.REPORT.md)
- **Deferral / promotion trigger:** Useful existing work is preserved. Review/select when needed by a playable milestone or inexpensive safe integration; do not expand into another research task.
- **Dependencies:** —. **Likely baseline impact:** maybe — v3.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-089 — liftcrew.ts keeps its own HAND_REACH 1.0 / LIFT_APEX_MAX 2.4 (stance.ts now uses BODY_MODEL)

- **Disposition:** Implemented candidate, awaiting verification/integration.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 139; cited sources `BM:103-105; LC:14`.
- **Current implementation / remaining work:** liftcrew reads body/model.ts; test that the constants agree
- **Source/tests/evidence:** [docs/engineering/briefs/body-variants.REPORT.md](briefs/body-variants.REPORT.md)
- **Deferral / promotion trigger:** Useful existing work is preserved. Review/select when needed by a playable milestone or inexpensive safe integration; do not expand into another research task.
- **Dependencies:** LM-070. **Likely baseline impact:** maybe — build-bay, year-build.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-090 — Release is not blended in the engine (hands clear when a holder lets go)

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 140; cited sources `EV:314,662; BM:183-184`.
- **Current implementation / remaining work:** release phase moves hands to restHands; `hands.teleport` test
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** yes — takes (hands field).
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-091 — postureGap treats the shoulders as one cylinder, not two joints ±0.15 m

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 141; cited sources `BM:175; HU:259-261`.
- **Current implementation / remaining work:** two-joint envelope with tests at one-arm-only reaches
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** LM-070. **Likely baseline impact:** maybe — handup, v3, solar.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-092 — Hand-up: balance checked for a single giver only (single receiver feeding end-first and sheets unchecked)

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 142; cited sources `EV:306,531; HU:262-263`.
- **Current implementation / remaining work:** single-receiver end-first slide/balance check with a refusal test
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** maybe — v3.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-093 — Hand-up: rise corridor only outward along the edge normal; station search only on the edge the load comes over; grip always nearest S; load always level, straight up

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 143; cited sources `HU:242-244,265-267; PR W28,W30,W32`.
- **Current implementation / remaining work:** fixture where only a lateral/other-edge station or a grip off-centre clears the joist ends
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** maybe — v3, handup-prone.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-094 — [R5] Prone rise checked with cylinders about S (bounding cylinder, no heading); the body beyond the lip is swept only at the take; arms are straight segments

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 144; cited sources `HU:238-241; BM:178-182; PR W28,W32`.
- **Current implementation / remaining work:** heading-aware per-tick invariant (proneYaw); proneBodyHit every push_up/kneel_up tick; a fixture where the rise hits a joist tail is refused
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** maybe — handup-prone.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-096 — [R5] Lying slide-back (≤ 0.16 m) is renderer-only; the engine deck hand stays put

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 145; cited sources `PR W35`.
- **Current implementation / remaining work:** engine deck-hand points per body variant; renderer slide 0
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** LM-070. **Likely baseline impact:** maybe — handup-prone.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-097 — Walk-back (walk started off its route) is a straight line not clearance-checked; the adversarial spline test never forces the sharp-vertex fallback

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 146; cited sources `MV:218-221,323-325`.
- **Current implementation / remaining work:** walk-back checked; a test forces the sharp fallback (caps 0.35 / 0)
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** maybe — perf-walk.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-098 — walk_to `face` may oscillate with turn-in-place

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 147; cited sources `CA:168`.
- **Current implementation / remaining work:** test: `face` converges without sign flips (may be closed by W4 splined turns)
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** maybe — perf-walk.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-099 — Stair flight rise fixed (±0.08 m); stair links need ≥ 0.7 m standable deck behind the exit (forced the 6 ft deck)

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 148; cited sources `PG:126-127`.
- **Current implementation / remaining work:** tests: a flight of another rise hooks on; a stair onto a 4 ft deck with a narrower exit zone
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** maybe — planning.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-100 — Sheets on rafters have no span rule (`RAFTER_SPACING_MAX` exported, unused)

- **Disposition:** Released fixed.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 149; cited sources `FR:87-88`.
- **Current implementation / remaining work:** FIXED release11: pure/mixed bearing rafters enforce exact24in (+1nm numerical tolerance), axis/rotated boundary and atomic-refusal tests; briefs/rafter-span.REPORT.md.
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Already shipped; retain regression safeguards. Promote only for a reproduced failure or needed extension.
- **Dependencies:** —. **Likely baseline impact:** no — unless sequenced.
- **Bounded next task / model:** Verify the released behavior with its existing regression; no new work scheduled.

### LM-101 — Mid-action resumability restore limits: events start empty, no teleport baseline on the first restored tick, the runner budget counts from resume; walk_to's detour closure is not codec-able

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 150; cited sources `EV:304,500; TP:284,293-296`.
- **Current implementation / remaining work:** tests: teleport on the first restored tick is flagged; detour stored as data
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-102 — Per-year north bearing mechanism: one global `NORTH_AZIMUTH_OFFSET` (−90) for every scene (sun.ts:42 "open follow-up"); the values are content (LM-186)

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 151; cited sources `OWNER_DECISIONS A3 entry; CD:159; CS:65-79; RC:384-397`.
- **Current implementation / remaining work:** `northOffset(year)` plumbing with a table defaulting to −90; env-sun.test per year
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** no — env is outside physicalView; studio/camera baselines yes.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-103 — Door metadata lives on the Kit mesh only; the year-file schema and engine have no door objects or state

- **Disposition:** Partial, deferred.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 152; cited sources `CS:213-217`.
- **Current implementation / remaining work:** door entity with an open/closed state that blocks walkers and camera, with a test (which doors existed is content)
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** maybe — year scene contentHash.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-104 — Incremental grids: sync equality not checked on the uncropped campus

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 153; cited sources `EV:300,440`.
- **Current implementation / remaining work:** campus-full test asserts incremental = full rebuild
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-205 — Rules version is a hand-kept string (`mars-engine/1+${ASSEMBLY_RULES}`); catalog/asset definitions are not hashed into plans/takes

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 154; cited sources `SP:226,254,274`.
- **Current implementation / remaining work:** rulesVersion derived from engine rule sources + catalog hash; test: editing a catalog def changes it and stales a bound plan
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** yes — stored plans go stale; take rulesVersion fields.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-206 — Inventory modes only hash-tested: nothing shows `unlimited` spawns parts under the same handling/collision rules, or `finite` refuses

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 155; cited sources `SP:218`.
- **Current implementation / remaining work:** api test for both modes
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-207 — No "installation close-up" semantic shot; subject-specific visibility (hands, beam end, receiving seat) untested for an installation

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** engine; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 156; cited sources `SP:202-203`.
- **Current implementation / remaining work:** shot kind (or direction framing) plus a connect_beam shot scored on hands + beam end + seat
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-023 — [E1] Social approach points and table standing points are not reserved (others make the sitter/taker yield or replan)

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** simulation; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 162; cited sources `EV:295,359; SO:148-149; IT:94`.
- **Current implementation / remaining work:** test: two people converging on one approach or standing point resolve without a push
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** maybe — meal.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-026 — [E3] A pre-empted sit/converse is not resumed; a converse loses all its members; no group re-forming

- **Disposition:** Released fixed.
- **Why it matters / original intent:** simulation; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 163; cited sources `EV:295,320,359,768,798,947; HO:623; SO:101-102,151-154; PR W25`.
- **Current implementation / remaining work:** FIXED release13: successful directed work physically returns a pre-empted sitter and re-forms three-person conversations without displacing untouched members; newer work, cancellation, failures, unavailable seats and ordinary held items skip return safely. Inspected captures, snapshot continuation and full green gate.
- **Source/tests/evidence:** [docs/engineering/briefs/converse-return.REPORT.md](briefs/converse-return.REPORT.md); [docs/engineering/briefs/preempt-snapshot.REPORT.md](briefs/preempt-snapshot.REPORT.md); [docs/engineering/briefs/social-resume.REPORT.md](briefs/social-resume.REPORT.md)
- **Deferral / promotion trigger:** Already shipped; retain regression safeguards. Promote only for a reproduced failure or needed extension.
- **Dependencies:** —. **Likely baseline impact:** no — no pinned scenario pre-empts.
- **Bounded next task / model:** Verify the released behavior with its existing regression; no new work scheduled.

### LM-027 — [E3] Ambient never re-adopts a released person

- **Disposition:** Released fixed.
- **Why it matters / original intent:** simulation; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 164; cited sources `EV:295,359; SO:152-154`.
- **Current implementation / remaining work:** FIXED release13: ambient re-adopts released actors after successful directed work and physically returns them to their prior activity; cancelled/failed/newer work and held items do not spuriously resume. Inspected 35/134/250-tick capture and full green gate.
- **Source/tests/evidence:** [docs/engineering/briefs/ambient-return.REPORT.md](briefs/ambient-return.REPORT.md)
- **Deferral / promotion trigger:** Already shipped; retain regression safeguards. Promote only for a reproduced failure or needed extension.
- **Dependencies:** LM-026. **Likely baseline impact:** maybe — takes with ambient.
- **Bounded next task / model:** Verify the released behavior with its existing regression; no new work scheduled.

### LM-028 — [E3] eat/serve overlay on a pre-empted sitter is not released (`eat.not-still`, `actor.holding`)

- **Disposition:** Partial, deferred.
- **Why it matters / original intent:** simulation; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 165; cited sources `SO:154-157`.
- **Current implementation / remaining work:** Storage/item-entry WIP is incomplete: source-held exit/guard remains required; preserve partial. Parent cites docs/engineering/briefs/item-entry.REPORT.md (not present at this checkout path); local related source evidence: docs/engineering/briefs/seated-contact.REPORT.md.
- **Source/tests/evidence:** [docs/engineering/briefs/seated-contact.REPORT.md](briefs/seated-contact.REPORT.md)
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** LM-026. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-030 — [E3] Holding social verbs (gather, campfire_circle, take_slot) run to the 1 800 s budget without explicit `stand`; a `sit` ended by `stand` (or on benches) reports `cancelled` → plan `partial`

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** simulation; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 166; cited sources `DD:413-417; HO:192`.
- **Current implementation / remaining work:** test: a deliberate stand completes the sit (plan `completed`); the timeout diagnostic names the holding step
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** maybe — takes/step statuses.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-031 — [E4] Nobody can stand on the top beams: mid-bay rafters refused (`out-of-reach`), the kitchen roof deck is not sequenced, full-height upper floors not reachable

- **Disposition:** Implemented candidate, awaiting verification/integration.
- **Why it matters / original intent:** simulation; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 167; cited sources `FR:106-108; PR W36; YB:435-437; PG:122-123`.
- **Current implementation / remaining work:** a stand-on-top-beams stance/verb; a framing test places a mid-bay rafter with 0 violations
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Useful existing work is preserved. Review/select when needed by a playable milestone or inexpensive safe integration; do not expand into another research task.
- **Dependencies:** LM-032. **Likely baseline impact:** maybe — year-build if sequenced; new tests otherwise.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-033 — [E5] install_panel stands its crew beyond both tilt-axis ends: only alternate panels mount in a contiguous row (no side stations; 14 solar parts unplaced in A+B)

- **Disposition:** Implemented candidate, awaiting verification/integration.
- **Why it matters / original intent:** simulation; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 168; cited sources `PR W13,W27; YB:251-254,305-306,372; RC:265-266; EV:309,575`.
- **Current implementation / remaining work:** side-access stations; a contiguous-row test mounts every panel; re-pin A+B with a PLANNING_BUDGET reason
- **Source/tests/evidence:** [docs/engineering/briefs/solar-side.REPORT.md](briefs/solar-side.REPORT.md)
- **Deferral / promotion trigger:** Useful existing work is preserved. Review/select when needed by a playable milestone or inexpensive safe integration; do not expand into another research task.
- **Dependencies:** —. **Likely baseline impact:** yes — yb-AB `ddb634d6`, P chapter take.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-034 — [E5] Solar tilt direction fixed (+pitch/+roll, no azimuth choice); legs/risers implied, not entities or BOM lines

- **Disposition:** Partial, deferred.
- **Why it matters / original intent:** simulation; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 169; cited sources `SPT:73-77; EV:309,575`.
- **Current implementation / remaining work:** install_panel takes an azimuth; test tilts south-facing on a deck of either orientation (45° frames are content, see LM-190)
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** LM-033. **Likely baseline impact:** maybe — year-build P.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-036 — [E6] Mid-raise cancel refused ("lowering is not yet modelled", raise.ts:386)

- **Disposition:** Released fixed.
- **Why it matters / original intent:** simulation; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 170; cited sources `EV:39,200; RV:328`.
- **Current implementation / remaining work:** **FIXED release 10**: supported reverse lowering, full-path/per-tick collision refusal, resource retention and snapshot proofs; gate `3881c91`, `briefs/raise-cancel.REPORT.md`
- **Source/tests/evidence:** [docs/engineering/briefs/raise-cancel.REPORT.md](briefs/raise-cancel.REPORT.md)
- **Deferral / promotion trigger:** Already shipped; retain regression safeguards. Promote only for a reproduced failure or needed extension.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify the released behavior with its existing regression; no new work scheduled.

### LM-037 — [E6] Carry on a stair flight: cancel refused, no mid-flight replan

- **Disposition:** Implemented candidate, awaiting verification/integration.
- **Why it matters / original intent:** simulation; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 171; cited sources `CA:129-130; EV:294,337`.
- **Current implementation / remaining work:** test: cancel mid-flight finishes to the nearer landing and sets down, 0 violations
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Useful existing work is preserved. Review/select when needed by a playable milestone or inexpensive safe integration; do not expand into another research task.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-038 — [E7] Mid-air install-lift cancels (connect_beam, joist, plywood, tread, flight) refused, with no cancel tests

- **Disposition:** Released fixed.
- **Why it matters / original intent:** simulation; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 172; cited sources `EV:39,200; RV:327-328`.
- **Current implementation / remaining work:** **FIXED release 10**: five per-verb cancel/refusal, reservation and safe completion regressions; gate `3881c91`, `briefs/install-cancel.REPORT.md`
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Already shipped; retain regression safeguards. Promote only for a reproduced failure or needed extension.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify the released behavior with its existing regression; no new work scheduled.

### LM-039 — [E8] Crews (> 1 carrier) cannot carry on stairs (`carry.level-change`, validate.ts:150)

- **Disposition:** Implemented candidate, awaiting verification/integration.
- **Why it matters / original intent:** simulation; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 173; cited sources `EV:34,124,294,337,793,857; HO:242,520,639; CA:95,130,157`.
- **Current implementation / remaining work:** test: 2 people carry a 12 ft beam up the proving-ground flight, load tilted, every carrier on a tread, 0 violations
- **Source/tests/evidence:** [docs/engineering/briefs/crew-stairs.REPORT.md](briefs/crew-stairs.REPORT.md)
- **Deferral / promotion trigger:** Useful existing work is preserved. Review/select when needed by a playable milestone or inexpensive safe integration; do not expand into another research task.
- **Dependencies:** —. **Likely baseline impact:** maybe — year-build if its sequences switch to crew stair carries.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-040 — [E8] Stair carries: one straight flight only (`carry.multi-flight`, no landings or turning flights); no pitched loads (plywood on edge); a 2x4 cannot go onto the 1.83 m deck (`carry.stairs-blocked`)

- **Disposition:** Implemented candidate, awaiting verification/integration.
- **Why it matters / original intent:** simulation; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 174; cited sources `CA:118-119,130; EV:32,98,294,337; HO:191`.
- **Current implementation / remaining work:** two-flight/landing fixture test plus a plywood-on-edge stair carry, or a named refusal per case
- **Source/tests/evidence:** [docs/engineering/briefs/crew-stairs.REPORT.md](briefs/crew-stairs.REPORT.md); [docs/engineering/briefs/stair-carry-limits.REPORT.md](briefs/stair-carry-limits.REPORT.md)
- **Deferral / promotion trigger:** Useful existing work is preserved. Review/select when needed by a playable milestone or inexpensive safe integration; do not expand into another research task.
- **Dependencies:** LM-039. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-042 — [E9] Forklift cannot swerve or reverse (it waits indefinitely behind a parked-but-ridden EUC); no three-point turns; `forklift_back` is a straight creep; fork height is not state after unloading

- **Disposition:** Implemented candidate, awaiting verification/integration.
- **Why it matters / original intent:** simulation; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 175; cited sources `EV:297,321,392,785; HO:624; VE:99-100,138-139,194-195; PR W25; HU:270-271`.
- **Current implementation / remaining work:** Forklift motion work has focused candidate evidence; row does not prove reverse/swerve plus persistent fork-height state. See docs/engineering/briefs/forklift-motion.REPORT.md and parent-cited raise-cancel checkpoint 9531a3b.
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Useful existing work is preserved. Review/select when needed by a playable milestone or inexpensive safe integration; do not expand into another research task.
- **Dependencies:** —. **Likely baseline impact:** maybe — probe / flagship if their forklift manoeuvres change.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-044 — [E9] Forklift reach / side-shift / fork-raise not checked against other vehicles; truck body not swept against people beyond the 1.5 m stop rule

- **Disposition:** Implemented candidate, awaiting verification/integration.
- **Why it matters / original intent:** simulation; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 176; cited sources `EV:297,321,392; HO:624-625; VE:131-133,195-196; PR W25`.
- **Current implementation / remaining work:** tests: side-shift into a parked EUC is refused; a person beside the pivoting truck body is flagged
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Useful existing work is preserved. Review/select when needed by a playable milestone or inexpensive safe integration; do not expand into another research task.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-048 — [E9] Forklift placements must be square to a deck edge

- **Disposition:** Implemented candidate, awaiting verification/integration.
- **Why it matters / original intent:** simulation; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 177; cited sources `VE:196`.
- **Current implementation / remaining work:** test: an angled deck placement succeeds or is refused by name
- **Source/tests/evidence:** [docs/engineering/briefs/angled-fork-placement.REPORT.md](briefs/angled-fork-placement.REPORT.md)
- **Deferral / promotion trigger:** Useful existing work is preserved. Review/select when needed by a playable milestone or inexpensive safe integration; do not expand into another research task.
- **Dependencies:** LM-042. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-208 — [R2] Carry transitions: no crouch/stand phase at carry pickup or set-down (carry publishes no crouch activity)

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** simulation; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 178; cited sources `SP:130; OF:85-87`.
- **Current implementation / remaining work:** carry publishes crouch/lift phases with hand points; hand check for carriers at pickup/set-down
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** LM-126. **Likely baseline impact:** yes — takes, baselines, carry pins if timing changes.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-083 — Items: cancelling hold_items leaves items in hand with a stale pose; `serve` ladles with whatever the other hand holds

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** simulation; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 179; cited sources `IT:98-100`.
- **Current implementation / remaining work:** cancel drops/rests or refuses; serve requires a spoon/ladle; refusal tests
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** maybe — meal.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-095 — [R5] Prone lying footprint checked against people only at plan time (spatial sees a disc at S)

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** simulation; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 180; cited sources `HU:241-242; PR W32`.
- **Current implementation / remaining work:** lying footprint published as an obstacle; a walker is routed round a prone receiver
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** maybe — handup-prone.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-105 — [E1] Ambient make-way walks submitted for people already reserved by a waiting step: 94–105 `reservation.conflict` refusals in the whole-skeleton / A+B replays (red FAILED banners)

- **Disposition:** Implemented candidate, awaiting verification/integration.
- **Why it matters / original intent:** simulation; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 181; cited sources `HO:617-618; PR W14 f3,W24; SR:128-129,290-293`.
- **Current implementation / remaining work:** makeWay (walk.ts:1030) skips reserved people; whole-skeleton test asserts 0 make-way conflicts
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Useful existing work is preserved. Review/select when needed by a playable milestone or inexpensive safe integration; do not expand into another research task.
- **Dependencies:** —. **Likely baseline impact:** yes — yb-skel, yb-AB, chapter takes (events).
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-106 — [E1] Idle crew parked with no regard to the next section's work (moved only by make-way); kitchen A+B red on `stringer.site-occupied`

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** simulation; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 182; cited sources `PR W27,W38; YB:370-371,465,471-472`.
- **Current implementation / remaining work:** parking rule avoids upcoming work zones; 0 make-way nudges in A+B; kitchen S no longer site-occupied
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** LM-105. **Likely baseline impact:** yes — yb-AB, chapter takes.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-107 — chiba / west-house A+B red in D1: `s0770-walk-to` receiver spot on the first-floor deck has no standing room beside frame 9172e067

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** simulation; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 183; cited sources `YB:464,466,470-472; PB:422-426; PR W38; year-build-houses.test.ts:126-129 (FULL_RED)`.
- **Current implementation / remaining work:** receiver-spot search avoids frame planes; YEAR_BUILD_FULL chiba/west-house green (then LM-156). **Coordinate with W47 (in flight)**
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** LM-106. **Likely baseline impact:** yes — adds full-house pins.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-108 — Framing: one person per frame face per height band; no runtime make-way for givers (feet checked vs bystanders at plan time only); sliding over something taller refused (no lift-over)

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** simulation; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 184; cited sources `PR W36; FR:169-171,176-177`.
- **Current implementation / remaining work:** tests: two people on one face at one band with separation; a walker entering the givers' path is asked to make way; a lift-over path
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** no — framing tests only.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-109 — Framing and beams: member balance in two hands unchecked beyond one holder ≤ 1.5 m; hand-offs are instantaneous grips

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** simulation; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 185; cited sources `FR:172-173; YB:183-184; EV:311,605`.
- **Current implementation / remaining work:** balance check plus blended hand-off, tested
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** maybe — year-build.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-110 — Set-part bystander rule looks 1.2 m ahead along the lift crew's feet, not the part's sweep through a body band

- **Disposition:** Implemented candidate, awaiting verification/integration.
- **Why it matters / original intent:** simulation; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 186; cited sources `PR W27`.
- **Current implementation / remaining work:** test: a person beside the path whom the part (not the feet) would hit is flagged
- **Source/tests/evidence:** [docs/engineering/briefs/setpart-load-bystander.REPORT.md](briefs/setpart-load-bystander.REPORT.md)
- **Deferral / promotion trigger:** Useful existing work is preserved. Review/select when needed by a playable milestone or inexpensive safe integration; do not expand into another research task.
- **Dependencies:** —. **Likely baseline impact:** maybe — yb-AB.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-111 — Hand-up: a sheet is never turned over the bay (forks deliver only sheets parallel to the edge)

- **Disposition:** Out of scope (existing ruling).
- **Why it matters / original intent:** simulation; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 187; cited sources `EV:306,531; HU:257-258`.
- **Current implementation / remaining work:** turned-sheet hand-up test, **or** re-classify (lead): a new manoeuvre, not a gap; see §9
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Existing owner ruling excludes/replaces this requirement. Reopen only for an explicit scope decision; preserve original tests/meaning where applicable.
- **Dependencies:** LM-093. **Likely baseline impact:** maybe — v3.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-112 — Hand-up: receivers > ≈ 2.55 m above the givers need the forklift; mixed prone + kneeling crew supported in code but never exercised

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** simulation; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 188; cited sources `EV:306,531; PR W28`.
- **Current implementation / remaining work:** forced mixed-crew fixture at 0 violations; the row note cites the prone 2.75 m reach (W29/W32)
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-113 — Hand-up v3 has no campus variant (the `onto_s2_4` beam_walk knife edge was fixed by W27, 17/17 origins; not re-proven at staging-east)

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** simulation; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 189; cited sources `EV:306,315,531,674; HO:580-581,612-613; PR W17,W27`.
- **Current implementation / remaining work:** v3 at 2026 staging-east with 0 violations and a margin ≥ 0.28 m, mapped to the row
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** yes — adds a campus v3 pin; takes.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-114 — Rigid carry formation: no re-grip, side change, shifting along the load or pivot round the rear carrier; loads stay level (no tilting over a rail)

- **Disposition:** Out of scope (existing ruling).
- **Why it matters / original intent:** simulation; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 190; cited sources `EV:34,124; HO:243; CA:156-159`.
- **Current implementation / remaining work:** a 2-person crew pivots a 12 ft beam round a corner that fails today, **or** re-classify (lead): SP §11 asks for whole-formation validation, not re-grip; see §9
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Existing owner ruling excludes/replaces this requirement. Reopen only for an explicit scope decision; preserve original tests/meaning where applicable.
- **Dependencies:** —. **Likely baseline impact:** maybe — carry routes G, flagship.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-115 — Social: seat collision by activity (`SEATED_ACTIVITIES`), not per fixture; fixture obstacle is its full catalog box (chair back included); mirrored approach steps over a chair back

- **Disposition:** Deferred, current implementation unverified; active classroom prerequisite under review.
- **Why it matters / original intent:** simulation; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 191; cited sources `EV:295,359,798; SO:50-53,146-150`.
- **Current implementation / remaining work:** per-fixture seat volumes; tests: a sitter off-seat is flagged; a front-walled chair uses a side approach
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Relevant to classroom seating/shared attention/interruption. Narrow to the next playable acceptance criteria; unrelated detail remains deferred.
- **Dependencies:** —. **Likely baseline impact:** maybe — meal, takes.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-116 — Social regions are single-level; audience layouts don't seat people on benches inside the region

- **Disposition:** Deferred, current implementation unverified; active classroom prerequisite under review.
- **Why it matters / original intent:** simulation; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 192; cited sources `SO:158`.
- **Current implementation / remaining work:** test: an audience region with benches seats people on them
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Relevant to classroom seating/shared attention/interruption. Narrow to the next playable acceptance criteria; unrelated detail remains deferred.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-117 — §30 H: no party/dance verbs; riding not composed into a social scene

- **Disposition:** Implemented candidate, awaiting verification/integration.
- **Why it matters / original intent:** simulation; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 193; cited sources `EV:798,947; SP:342`.
- **Current implementation / remaining work:** Implemented bounded step-and-turn dance with rider; live/replay proof exists, but row awaits combined gate/release and does not supply a speaking-turn feature. See docs/engineering/briefs/party.REPORT.md.
- **Source/tests/evidence:** [docs/engineering/briefs/party.REPORT.md](briefs/party.REPORT.md)
- **Deferral / promotion trigger:** Useful existing work is preserved. Review/select when needed by a playable milestone or inexpensive safe integration; do not expand into another research task.
- **Dependencies:** LM-026. **Likely baseline impact:** no — new scenarios.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-118 — Painting: the band below 0.5 m (crouching) is out of reach; painter goes idle between columns (W10 "bug found", fix unconfirmed)

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** simulation; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 194; cited sources `EV:310,587; SPT:81; BM:26; PR W10`.
- **Current implementation / remaining work:** crouch-paint posture paints the bottom band; test asserts continuous activity between columns
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** LM-070. **Likely baseline impact:** maybe — paint tests.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-209 — Doorway approach untested (only door: 2024 solarium)

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** simulation; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 195; cited sources `SP:117`.
- **Current implementation / remaining work:** walker through the solarium door approaches roughly square to it, no side-slide
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** LM-103. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-133 — [R4] Items don't collide with each other (a 0.32 m pot on the 0.3 m lattice overlaps its neighbours)

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** simulation; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 196; cited sources `EV:308,562; HO:634; IT:95; PR W5`.
- **Current implementation / remaining work:** item–item footprint invariant on surface slots; test: pot next to bowl is refused
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** maybe — meal.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-134 — [R4] Lap support (bowl on a seated person's knee) not implemented

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** simulation; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 197; cited sources `IT:32-33,99; PR W5`.
- **Current implementation / remaining work:** `put_item` to `lap` test with a seated eater
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** LM-133. **Likely baseline impact:** maybe — meal.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-135 — [R4] Prone grip is always the load point nearest S and lands beside a joist end (hands ≤ 1.9 cm inside j3/j6 ends)

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** simulation; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 198; cited sources `PR W32,W35`.
- **Current implementation / remaining work:** grip choice along the edge avoids members; prone.spec hand vertices 0 cm inside
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** LM-093. **Likely baseline impact:** maybe — handup-prone.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-059 — [E12] Parity measured on one take only; no campus-through take (Chiba, trailers) to validate thin-member/roof prisms

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** renderer; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 204; cited sources `CV:89-92,133-134; EV:299,425`.
- **Current implementation / remaining work:** camera-verify.spec on a campus-through take, 0 samples ≥ 0.2
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** LM-058. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-119 — Vehicles/forklift: no lean, wheel or balance kinematics for EUC/bicycle (visual)

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** renderer; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 205; cited sources `EV:296,376; VE:138-139`.
- **Current implementation / remaining work:** renderer lean from curvature × speed with a capture; engine stays kinematic (SP §32 excludes dynamics)
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** yes — baselines.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-120 — [R1] talk / watch / listen render as plain Idle (humans.ts has only sit/warm branches)

- **Disposition:** Deferred, current implementation unverified; active classroom prerequisite under review.
- **Why it matters / original intent:** renderer; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 206; cited sources `HO:216,520,639; SO:159-162; LG:31`.
- **Current implementation / remaining work:** distinct poses keyed on activity; pose-probe capture per activity in lab-social spec
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Relevant to classroom seating/shared attention/interruption. Narrow to the next playable acceptance criteria; unrelated detail remains deferred.
- **Dependencies:** —. **Likely baseline impact:** yes — baselines (lab-social, campfire).
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-121 — [R1] No conversation turn-taking, gaze or gestures

- **Disposition:** Deferred, current implementation unverified; active classroom prerequisite under review.
- **Why it matters / original intent:** renderer; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 207; cited sources `EV:295,359,798,947; SO:151`.
- **Current implementation / remaining work:** converse publishes the current speaker; heads turn to speaker/focus; spec asserts gaze direction
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Relevant to classroom seating/shared attention/interruption. Narrow to the next playable acceptance criteria; unrelated detail remains deferred.
- **Dependencies:** LM-120. **Likely baseline impact:** yes — baselines.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-122 — [R2] Rig reaches only 92.5 % (hand-up v3) / 76.6 % (year build) of engine hand points; a reach-down palm is 1.025 m off (t 2682.3 s); p4 stand_with_load 28/32 and 25/32; footers and the far arm

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** renderer; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 208; cited sources `HO:519-522,544,615-616,621-622; PR W6,W9,W14,W29,W35; PO:148-162,256-258; SR:446-449`.
- **Current implementation / remaining work:** the engine never publishes a rig-unreachable point (invariant) and the renderer reaches 100 % of reachable points; hands-check/prone.spec floors raised to 100 %
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** LM-084, LM-070. **Likely baseline impact:** yes — baselines (poses-*, year-build).
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-123 — [R2] Footer's arms hang until the column is within reach during a raise

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** renderer; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 209; cited sources `PR ~20:00 caveat`.
- **Current implementation / remaining work:** poses spec asserts footer hands on the upright every raise tick
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** LM-122. **Likely baseline impact:** yes — baselines (poses-raise-footer).
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-124 — [R2] Posture blend lags the engine's hand points by up to 0.4 s (crouch misses)

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** renderer; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 210; cited sources `PO:132-133,330`.
- **Current implementation / remaining work:** blend leads/limits so poses.spec crouch counts reach 100 %
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** yes — baselines.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-125 — [R2] Postures have no side lean, stepping or torso twist; 150° kneel puts the head below the deck; one closed-hand curl for every grip

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** renderer; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 211; cited sources `PO:316-320`.
- **Current implementation / remaining work:** side lean/twist in posture.ts (year-build reach numbers rise); per-grip hand shape, or accepted as a v1 rule by the lead
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** LM-122. **Likely baseline impact:** yes — baselines.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-126 — [R2] Carry/hold poses: carriers play Walk/Idle with a procedural lean; speed-matched walk while carrying unverified; lift/set-down interpolate Euler angles with no ground contact during the tilt

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** renderer; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 212; cited sources `EV:34,124,793,857; HO:449; CA:166-167`.
- **Current implementation / remaining work:** hands on grips every carry tick (hands-check); walk cadence matches speed; the plywood flat→edge tilt never penetrates the ground (pose audit)
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** yes — baselines.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-127 — [R2] Take replay seats default to 0.45 m (takes carry no fixtures); the seated drop is the engine's, not the rig's

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** renderer; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 213; cited sources `IT:101; PO:293-294,332`.
- **Current implementation / remaining work:** replay reads the seat height from entities0 fixtures; test: eater hips at the fixture seat
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-128 — [R3] Beam walking is the Walk clip at half weight, with no foot placement on the 0.1 m flange

- **Disposition:** Partial, deferred.
- **Why it matters / original intent:** renderer; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 214; cited sources `PO:186-187,325-326`.
- **Current implementation / remaining work:** Beam flange foot placement remains unproven; no row-specific release proof found.
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** yes — baselines (poses-beam-walk).
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-129 — [R3] Frame-climb rungs at 0.35 m pitch are not IK'd to the drawn bracing rods

- **Disposition:** Partial, deferred.
- **Why it matters / original intent:** renderer; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 215; cited sources `PO:189-190,324-325`.
- **Current implementation / remaining work:** Rendered rung/bracing-rod IK remains unproven; LM032 engine sweep is separate.
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** LM-085. **Likely baseline impact:** yes — baselines.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-130 — [R3] Climb-wait can keep a foot mid-swing; turning in place plays Idle

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** renderer; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 216; cited sources `PO:326; HO:217; EV:792,841`.
- **Current implementation / remaining work:** both feet planted on climb-wait (stairs.spec); a turn-step clip with a pose test
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** yes — baselines (stairs).
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-131 — [R3] Studio take host passes no base scene, so campus stairs in a take are not walked tread by tread

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** renderer; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 217; cited sources `PO:307-308`.
- **Current implementation / remaining work:** take-host passes the campus SpatialScene; test with a take on campus stairs
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-132 — [R4] Renderer body-vs-object collision: squatting foot overlaps parts, crossed knee touches the bowl, thighs clip chair arms; arm vertices ≤ 1.9 cm inside joist ends, fingers 4–7 cm below d0's top (logged, not asserted)

- **Disposition:** Partial, deferred.
- **Why it matters / original intent:** renderer; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 218; cited sources `PO:264-267,322-323; PR W32,W35`.
- **Current implementation / remaining work:** Body-vs-object rendered penetration assertions remain unproven; related seated-contact work is a bounded candidate, not global row completion. See docs/engineering/briefs/seated-contact.REPORT.md.
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** LM-133. **Likely baseline impact:** yes — baselines.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-136 — [R5] Prone replay is not exact: replay rises on smooth(phaseK) while live waits for the load (≤ 0.78–0.79 behind at p4 kneel-up); torso pitch search differs without the previous tick (≤ 0.6 rad, head 0.33 m)

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** renderer; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 219; cited sources `SR:236-240; PO:209-213,311-315; PR W35,W37`.
- **Current implementation / remaining work:** the engine publishes the torso tip / a rise the body can follow, so live == replay within tolerance; studio-take-prone.spec asserts it
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** LM-094. **Likely baseline impact:** yes — baselines (prone-*).
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-137 — [C4] `verifyCamera` cannot select a file-carried track (`{ track: { file } }`)

- **Disposition:** Released fixed.
- **Why it matters / original intent:** renderer; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 220; cited sources `CD:423-424`.
- **Current implementation / remaining work:** FIXED release11: actual save/download/reopen/file-track e2e verifies every sample; missing file returns null without state change. briefs/studio-file-track.REPORT.md.
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Already shipped; retain regression safeguards. Promote only for a reproduced failure or needed extension.
- **Dependencies:** LM-013. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify the released behavior with its existing regression; no new work scheduled.

### LM-138 — [C4] No camera picker for chapter sets; a directed track is not held; a saved track plays only through the panel

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** renderer; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 221; cited sources `SR:461-462,477-478; PR W48`.
- **Current implementation / remaining work:** studio-build.spec picks a saved directed track for a chapter
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** LM-013. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-139 — Chapter-set hold tails are locked off (workers walk out of frame, ≤ 84 set-s at 64×); single takes have no shot hold

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** renderer; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 222; cited sources `SR:190-191,466-467,471; PR W48`.
- **Current implementation / remaining work:** held tail tracks its subjects or cuts; hold applies to single takes; spec asserts subjects in frame
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-140 — Walk weight steps at a chapter seam (±0.15 s speed window clamped at the take edge)

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** renderer; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 223; cited sources `SR:468-470; PR W48`.
- **Current implementation / remaining work:** window reads across the seam; seams test asserts weight continuity
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-141 — Chapter panel covers the bottom ≈ 20 % of the frame (and its captures); the option text uses a head-noun rule tuned on A+B labels

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** renderer; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 224; cited sources `SR:460-461,463-464; PR W37`.
- **Current implementation / remaining work:** panel doesn't overlap the frame (layout test); captures with the panel closed; a label test on another set
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** yes — baselines (studio-build).
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-142 — Studio take loader checks only wrapper, camera/take id and final hash

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** renderer; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 225; cited sources `EV:318,737`.
- **Current implementation / remaining work:** the loader validates the full take (hash chain / schema), with a corrupted-file test
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-143 — 2021 central upright still drawn `#293c45` (scenes.ts:113); lab solar-paint pv2 rolled about the wrong axis (low edge 0.34 m in the ground)

- **Disposition:** Partial, deferred.
- **Why it matters / original intent:** renderer; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 226; cited sources `PR W50 (orphaned by the cancelled W53)`.
- **Current implementation / remaining work:** RACK_FRAME_GREEN; the lab scenario uses the engine's tiltedPose; spec asserts no vertex below ground
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** yes — baselines (studio-2021-*, solar-paint-*).
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-144 — Fire: smoke faint in the wide oblique preset, core saturates white, flat from overhead, small in the top preset

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** renderer; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 227; cited sources `HO:634-635,713; PR W3,W45; CX-fire:30,63`.
- **Current implementation / remaining work:** **[Codex]** fire.ts; smoke visibility metric in the oblique view in fire.spec
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** yes — baselines (fire-*).
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-145 — Paint coverage is colour + stripe / image, not a texture mask (incl. 2024 mural)

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** renderer; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 228; cited sources `EV:310,587; HO:546,635,713`.
- **Current implementation / remaining work:** **[Codex]** paint.ts; coverage mask from the engine's painted rectangles; the mural design is content (LM-188)
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** yes — baselines (render-polish, solar-paint).
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-146 — Replay independence: the browser renderer's camera path is not in the suite

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** renderer; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 229; cited sources `EV:42,241`.
- **Current implementation / remaining work:** e2e: switching camera tracks in studio leaves take hash and final state unchanged
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-147 — /studio takes ≈ 2 min to become ready (38.5 MB GLB at ≈ 310 KB/s); 2026 studio 1 083 draw calls / 957 k tris

- **Disposition:** Out of scope (existing ruling).
- **Why it matters / original intent:** renderer; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 230; cited sources `PR release 4; HO:282-283`.
- **Current implementation / remaining work:** meshopt-compressed GLB (the dependency is already present) plus a load-time bound; or the lead records it as a hosting note, not a spec gap
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Existing owner ruling excludes/replaces this requirement. Reopen only for an explicit scope decision; preserve original tests/meaning where applicable.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-210 — Weather/environment visuals (cloud, rain, wet ground, screens/projections) have no visual test; the control plane checks state only

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** renderer; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 231; cited sources `SP:210`.
- **Current implementation / remaining work:** studio capture under the rainy preset with a pixel assertion
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** yes — new baselines.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-211 — Sit exactness (pelvis on the seat surface, feet on the ground) not measured (lab-poses checks sit weight = 1 only); raise lifters' "hold high" not asserted (only footer low)

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** renderer; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 232; cited sources `OF:92-93,243-245`.
- **Current implementation / remaining work:** bone-height assertions in meal/lab-poses specs; lifter hands on grip slots in poses.spec
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** LM-123. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-212 — Firelight on nearby people at dusk not asserted (captures only); the Studio campfire (scenery.ts → createFire) has no studio test; tire ring / roof ballast tires have no numeric ground-contact test

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** renderer; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 233; cited sources `OF:10-13,285-289`.
- **Current implementation / remaining work:** **[Codex]** fire.spec firelight metric; a studio fire frame-diff check; history-geometry assertion for the ring + ballast
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-015 — [C6] Integration does not call every tool: `engine_direct_camera` is only name-listed (simulation-integration.mjs:63), never called; the gate runs integration only when `SIM_BASE` is set

- **Disposition:** Released fixed.
- **Why it matters / original intent:** tooling; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 239; cited sources `HO:398-400; DD:61; LG:49-57; W55 check`.
- **Current implementation / remaining work:** FIXED wave1: integration always runs in gate via isolated local Wrangler or explicit SIM_BASE; process-group cleanup. Registry-derived all-tool assertions plus sentences, tracks, invalid envelopes, static edit and canonical2026 coverage.
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Already shipped; retain regression safeguards. Promote only for a reproduced failure or needed extension.
- **Dependencies:** LM-007. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify the released behavior with its existing regression; no new work scheduled.

### LM-052 — [E10] The replan budget never binds in a pinned scenario (only the 10-walker unit test)

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** tooling; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 240; cited sources `PB:52`.
- **Current implementation / remaining work:** a pinned scenario (or perf-walk bench) where the budget binds, asserted
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-148 — [E14] Lint is red: **123** findings on HEAD (was 114 at W45) and there is no lint stage in `deploy/gate.mjs` or RELEASE_CHECKLIST

- **Disposition:** Released fixed.
- **Why it matters / original intent:** tooling; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 241; cited sources `HO:522-523,640,714; PR W33,W45; CX-tool:19,23,111; W55 run`.
- **Current implementation / remaining work:** FIXED wave1: zero-warning lint first in gate, documented RELEASE_CHECKLIST. No pins changed.
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Already shipped; retain regression safeguards. Promote only for a reproduced failure or needed extension.
- **Dependencies:** LM-149…151. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify the released behavior with its existing regression; no new work scheduled.

### LM-149 — [E14] Lint findings in `engine/**` excluding tests (60): unused-vars, no-new-array, require-array-sort-compare, no-useless-spread, prefer-const, no-explicit-any, no-useless-fallback-in-spread, no-this-alias (runtime.ts:270), no-base-to-string (framing.ts:164); includes LM-072/073

- **Disposition:** Released fixed.
- **Why it matters / original intent:** tooling; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 242; cited sources `lint (engine/camera 14, construction 12, campus 11, runtime 9, vehicles 4, locomotion 3, actions 3, + 1–2 each in scenarios, rehearsal, env, core, api, spatial, items, carry)`.
- **Current implementation / remaining work:** FIXED wave1: engine lint zero; mutation snapshots and sort order preserved; active pins unchanged. gate-foundations.REPORT.md.
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Already shipped; retain regression safeguards. Promote only for a reproduced failure or needed extension.
- **Dependencies:** LM-072, LM-073. **Likely baseline impact:** maybe — sort comparators on hashed collections; every pin re-checked.
- **Bounded next task / model:** Verify the released behavior with its existing regression; no new work scheduled.

### LM-150 — [E14] Lint findings in `engine/test/**` (22): unused imports (core.test.ts ×3 per CX-tool, take-chapters Runtime), unbound-method (grid-incremental ×2, walk-perf), prefer-string-starts-ends-with

- **Disposition:** Released fixed.
- **Why it matters / original intent:** tooling; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 243; cited sources `lint`.
- **Current implementation / remaining work:** FIXED wave1: engine test lint zero; source-scan bans unchanged. gate-foundations.REPORT.md.
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Already shipped; retain regression safeguards. Promote only for a reproduced failure or needed extension.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify the released behavior with its existing regression; no new work scheduled.

### LM-151 — [E14] Lint findings in app/deploy/simulation (26): app/lab 7, app/engine-view 7 (restrict-template components.ts:340), app/studio 2; simulation/worker.ts await-thenable ×2 (262, 383); deploy/group-2026-frames.mjs constant `??` ×2 **[Codex]** + 2; perf-walk 2, evidence-report 2, questions-html 2, record-campus-take, director-demo, gate.mjs control-regex (22)

- **Disposition:** Released fixed.
- **Why it matters / original intent:** tooling; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 244; cited sources `lint`.
- **Current implementation / remaining work:** FIXED wave1: app/deploy/simulation lint zero. photographic-corrections.ts only let-to-const mechanics; no historical values changed. gate-foundations.REPORT.md.
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Already shipped; retain regression safeguards. Promote only for a reproduced failure or needed extension.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify the released behavior with its existing regression; no new work scheduled.

### LM-152 — [E14] Wall-clock perf tests (bounds loosened to 250/120 ms) flake under worker load

- **Disposition:** Released fixed.
- **Why it matters / original intent:** tooling; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 245; cited sources `PR ~03:00, lead 13:55`.
- **Current implementation / remaining work:** FIXED wave1 follow-up: deterministic method-call totals/peaks gate unchanged stress outcome and zero violations; actual extra route/rebuild operations fail budgets. Original250/120ms peaks,3ms means and1000ms grids retained in serialized explicit release benchmark. Two focused tests+benchmark pass; no claim of N fullflake-freegates. PLANNING_BUDGET documents ceilings/limitations.
- **Source/tests/evidence:** [docs/engineering/briefs/wave1-integration.REPORT.md](briefs/wave1-integration.REPORT.md)
- **Deferral / promotion trigger:** Already shipped; retain regression safeguards. Promote only for a reproduced failure or needed extension.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify the released behavior with its existing regression; no new work scheduled.

### LM-153 — [E14] Gate reports `gitDirty: true` from the untracked `viewer/.pw-browsers` symlink; main's node_modules needed `npm ci` for oxlint-tsgolint

- **Disposition:** Released fixed.
- **Why it matters / original intent:** tooling; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 246; cited sources `PR W33,W45`.
- **Current implementation / remaining work:** FIXED wave1: .pw-browsers symlink ignored; clean-tree metadata verified by consolidated gate. Shared dependencies reused without installation.
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Already shipped; retain regression safeguards. Promote only for a reproduced failure or needed extension.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify the released behavior with its existing regression; no new work scheduled.

### LM-154 — [C6] Evidence report does not run or ingest proofs outside the node suite: simulation-integration (DO path), Playwright (poses, camera-verify, baselines), `record-campus-take --check`, `deploy/history-ids.test.mjs` (15 rows cite them)

- **Disposition:** Released fixed.
- **Why it matters / original intent:** tooling; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 247; cited sources `EV:42-45,257,274,288,299,301,302,314,317,318,469,737,791,820`.
- **Current implementation / remaining work:** FIXED wave1: latest clean same-revision gate proofs consumed per step; stale/missing/failed/skipped evidence cannot count PROVEN. Flagship recording --check now gated; historical recordings parked.
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Already shipped; retain regression safeguards. Promote only for a reproduced failure or needed extension.
- **Dependencies:** LM-015. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify the released behavior with its existing regression; no new work scheduled.

### LM-155 — Skipped tests: YEAR_BUILD_FULL (year-build.test.ts:93, year-build-b.test.ts:152, year-build-houses.test.ts:149, e2e/year-build.spec.ts:258) and CAMPUS_FULL (campus-extract.test.ts:77) never run in the gate

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** tooling; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 248; cited sources `EV:13,311,605,616,1007,1071; W55 rg`.
- **Current implementation / remaining work:** a `gate --full` (nightly) step runs them and the report records the result; "skips → documented" per OWNER_DECISIONS
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** no — they assert existing pins.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-156 — Full-house pins for chiba/kitchen/west-house empty (`PIN_FULL` ticks 0, year-build-houses.test.ts:131-135); `todo: FULL_RED`

- **Disposition:** Historical/content-dependent (existing ruling).
- **Why it matters / original intent:** tooling; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 249; cited sources `YB:469-470; year-build-houses.test.ts:126-135`.
- **Current implementation / remaining work:** fill PIN_FULL once green, **or** drop the todo tests and point at LM-189 if the lead parks the houses as content
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Requires factual reconstruction or owner input; historical-content agent owns it. Promote when sourced facts are available and the featured experience needs them.
- **Dependencies:** LM-107, LM-106. **Likely baseline impact:** yes — adds pins.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-157 — Manifest-guarded skips (`camera-chapter-shots.test.ts:105`, `take-labels.test.ts:35`) and capture-only e2e (`questions-captures.spec.ts:242`)

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** tooling; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 250; cited sources `W55 rg`.
- **Current implementation / remaining work:** manifest guards fail instead of skip (the manifest is committed); questions-captures documented as a capture tool, outside the test count
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-158 — `record-campus-take --check` repeats two 13-min rehearsals for the chapter set; studio-build.spec replays every year-build entry (long e2e)

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** tooling; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 251; cited sources `PR W27,W31`.
- **Current implementation / remaining work:** --check reuses one rehearsal or checks the chapter hash chain; spec samples chapters
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-159 — Concurrent e2e runs sharing test-results delete traces and fail teardown; take-fixture specs (meal, stairs, studio-take-prone) prove replay with a fixture, not real recorder output

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** tooling; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 252; cited sources `CV:22-23; PO:300-302`.
- **Current implementation / remaining work:** per-run output dir; specs load TakeRecorder output and drop take-fixture.ts
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-160 — Screenshot baselines with unexplained drift left unrefreshed (solar-paint ×2, poses-handup 1.24 %, poses-beam-walk, build-bay ×3, lab-narrow-passage, lab-social-t65, lab-stairs, meal-spoon, year-build ×2; poses-raise-footer 1.520 %)

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** tooling; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 253; cited sources `PR W45,W50; CX-fire:43-56`.
- **Current implementation / remaining work:** each inspected and refreshed or explained; full e2e drift 0 above threshold
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** yes — baselines.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-161 — Worst-sample captures of take-less tracks use the studio fov, not the track fov

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** tooling; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 254; cited sources `SR:479-480`.
- **Current implementation / remaining work:** captures use the track fov
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** yes — camera-verify captures.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-162 — Campus extraction: Chiba 2026 kitchen/café details and gallery screens are procedural in the studio, not in the engine scene; prisms are OBBs of render geometry (parts within 0.5 m merge)

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** tooling; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 255; cited sources `CS:133-136; HO:265-266`.
- **Current implementation / remaining work:** details extracted via the Kit path; thin-member extraction test vs mesh (materials/terrain stay content)
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** yes — campus `c56ea8da`, contentHash.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-163 — Duplicate kind+placement in one assembly would get order-dependent `-2/-3` suffixes (none today); `legacyKinds` kept in take-sampler.ts only for a regression test

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** tooling; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 256; cited sources `HI:18-19; CD:403`.
- **Current implementation / remaining work:** history-ids test asserts no duplicates; legacyKinds removed with its test retired
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-164 — Deterministic trig checked on one host; cross-host equality by hand; non-Chromium browsers unverified

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** tooling; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 257; cited sources `EV:303,485`.
- **Current implementation / remaining work:** automated check: workerd (wrangler) + Playwright chromium/firefox/webkit stateHash equal the probe
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-165 — No camera track rendered to video and reviewed; no committed campus-build video

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** tooling; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 258; cited sources `EV:41,228,797,929; HO:207-209,445-448`.
- **Current implementation / remaining work:** Playwright renders one directed track to video as an artifact; the review verdict is Gene's (content)
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-166 — Lab has no scenes for EUC/bicycle, forklift, single-carrier stairs, flagship v2

- **Disposition:** Out of scope (existing ruling).
- **Why it matters / original intent:** tooling; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 259; cited sources `LG:59-63`.
- **Current implementation / remaining work:** lab presets with expectations; the lead may treat this as out of the last mile (§9)
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Existing owner ruling excludes/replaces this requirement. Reopen only for an explicit scope decision; preserve original tests/meaning where applicable.
- **Dependencies:** —. **Likely baseline impact:** yes — new baselines.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-213 — Lab diagnostic overlays lack support relationships, general reservations (only slots + traffic), object ids and camera visibility rays

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** tooling; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 260; cited sources `SP:295,385`.
- **Current implementation / remaining work:** overlays toggled in a lab e2e with captures
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** maybe — lab baselines.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-167 — [V1] EVIDENCE.md is stale: generated at `d91057b` (HEAD `78cd157`), 58 vs 63 test files; unmapped: camera-chapter-shots, camera-parse, source-scan, take-labels, year-build-houses + 90 unmapped tests (framing, prone hand-up, kneeling rise, chapters, set-part bystander)

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** evidence; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 266; cited sources `EV:11-13,953-1071`.
- **Current implementation / remaining work:** `npm run evidence` regenerated with evidence-map.json covering every test (0 unmapped)
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-168 — [V1] Year build phase B row PARTIAL 3/4 though `PIN_FULL_AB` is now set (year-build-b.test.ts:150); no default-suite test executes the stair / wall / solar sections

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** evidence; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 267; cited sources `EV:15,312,616,620; HO:545,581,610-611; PR W17,W26,W40`.
- **Current implementation / remaining work:** per-section executed tests from chapter checkpoints (S, W, P) in the default suite; row PROVEN
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** LM-155. **Likely baseline impact:** no — new tests assert the existing pins.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-169 — [V1] Row notes contradicted by code: "no design-edit engine op" (edit_world exists), "19 ft only refused" (19 ft bay test), stair "root-motion only, no foot IK" (W6 IK), "reach-down ≤ 0.5 m" (prone 2.75 m), "v3 not a campus take", "B not recordable" (chapters), historical "no build" (2022 year build), carry "no replan yet"

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** evidence; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 268; cited sources `EV:32,33,35,43,44,98,294,298,306,311-318,409,737,794,874; CA:108-110,160-161,165; PG:77,124-125`.
- **Current implementation / remaining work:** notes rewritten from the regenerated report; each claim cites its test
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** LM-167. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-170 — [V1] Rows proven only on synthetic/proving ground: wall avoidance (one wall, no contact-duration metric), U-trap (one U, one start/goal), camera collision, pre-emption, vehicle traffic, EUC/forklift, 19 ft raise beside structures, construction-changes-navigation on campus, one bay only (milestone E)

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** evidence; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 269; cited sources `EV:29-31,35,36,40,57,68,142,157,215,296,297,320,321,376,392,768,785,795,894`.
- **Current implementation / remaining work:** campus or second-geometry variants per row (wall-contact metric, seeded U-trap sweep, campus traffic/pre-emption/raise, multi-bay run)
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** LM-113. **Likely baseline impact:** maybe — planning budget for campus runs.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-171 — [V1] Historical routes proven in 2021 and 2022 only

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** evidence; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 270; cited sources `EV:298,409`.
- **Current implementation / remaining work:** route test per year 2020–2025 on the published scenes
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-172 — [V1] No-walker-jumps bound measured on stress-30 and campfire only; kneeling rise past joist ends not in any pinned scenario; replan budget (LM-052)

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** evidence; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 271; cited sources `EV:319,750; PR W30`.
- **Current implementation / remaining work:** per-tick bound asserted on every pinned run; handup fixture cited by a row
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-173 — [V1] Stale numbers/claims in area docs: CAMERA.md 60–80 ms (measured 159; no perf test in camera.test), GPU picking "next step"; CAMERA_VERIFY fixes 1–4 and per-sample subjects done; CAMERA_DIRECT render verify done; CARRY measured table; MOVEMENT climb-wait Walk, `speed` not recorded, "+10–25 %"; POSES body-model table ("Open"), `contents` not recorded; BODY_MODEL crouch 0.55 vs 0.50, CARRY_Y 0.72/0.75/0.80; ITEMS meal pin `baf84de6`; HANDUP proneYaw/phaseK FIELDS; SOCIAL sit pose; PROGRESSIVE hand-up + swept lifts; CAMPUS_SCENE crop pins + seeds "not done"; TAKES_AND_PLANS flagship /2 + payload table; STUDIO_REPLAY:38-40 flagship /2; PLANNING_BUDGET old pin text + loaded-host perf; YEAR_BUILD "Phase B needs" list; LIFT_CREW_PLAN done

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** evidence; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 272; cited sources `CM:139,141,148-152; CV:30-32,114-132; CD:380; CA:153; MV:168-175,207-211; PO:43-56,331-332; BM:39,93,142,167-168; IT:85-87; HU:210-211; SO:144-145; PG:77,124; CS:124-130,168-170; TP:195-199,311-324; SR:38-40; PB:93-95,191-193,207-215,259,330-331,362-363; YB:190-196; LC:1`.
- **Current implementation / remaining work:** one doc-hygiene pass: each line fixed or struck, with a `Last verified: <sha>` stamp per doc
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** LM-167. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-174 — [V1] Stale top-level docs: HANDOFF headers ("engine not deployed", "DO timings unverified", 548 vs 565.6 s), LAB_GUIDE (release 5, tool counts), DIRECTOR_DEMO transcript ids (09-27 run) and tool lists, lab README perf table, LIB_EVAL experiment D (SE(2) planner) unmeasured, OWNER_DECISIONS 09:45 Codex ownership (scenes.ts, thinning), app/lab/solar-paint.ts "hashed stripes" text (4–5, 79), components.ts "blue" comment; flagship non-historical label needs an e2e check

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** evidence; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 273; cited sources `HO:80-81,155-156,161,166,172-173,260-262,322,433,703-705; LG:1-4,41-57; DD:33-35,366-390; PR W33,W45,W50`.
- **Current implementation / remaining work:** HANDOFF "Known shortcomings" reduced to pointers into this file; a re-run director-demo; an e2e asserting the hypothetical banner on every flagship view
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** LM-011. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-175 — [V1] Every EVIDENCE row carries an approximation note (53/53)

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** evidence; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 274; cited sources `EV (all rows)`.
- **Current implementation / remaining work:** final pass once the batches land: each note is either gone (fixed) or one sentence pointing at its LM re-classification
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** all fix rows. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-214 — [V1] The primary acceptance test (every person's and material's final state traced to action records, supports and the precondition that allowed the next action) has no test; no foot-sliding metric

- **Disposition:** Deferred, current implementation unverified.
- **Why it matters / original intent:** evidence; original proposal `fix`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 275; cited sources `SP:82,327`.
- **Current implementation / remaining work:** test over the flagship take traces every final entity state through the log; foot-slide metric asserted ≈ 0
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Does not currently block the first bounded classroom. Promote for a serious reproduced correctness/usability failure, direct experience dependency, substantial modest-effort visual improvement or demonstrated recurring cost reduction.
- **Dependencies:** —. **Likely baseline impact:** no.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-176 — Campus interiors, upper floors, decks, stairs and doors are not walkable/modelled (2026 ground level 0 only, 152 `interior:` blockers; 2026 has no kitchen/sink; doors exist only in the 2024 solarium)

- **Disposition:** Historical/content-dependent (existing ruling).
- **Why it matters / original intent:** content; original proposal `re-classify: content`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 281; cited sources `EV:33,37,110,170,316,700; HO:227-228,456,629,705; CS:82-89,159-161; CD:348-352`.
- **Current implementation / remaining work:** real floors/stairs/doors need Gene's photos; the engine supports them (progressive decks, stairs, LM-103 doors)
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Requires factual reconstruction or owner input; historical-content agent owns it. Promote when sourced facts are available and the featured experience needs them.
- **Dependencies:** —. **Likely baseline impact:** —.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-177 — Historical years are procedural hypotheses (2021–25 provisional); flat terrain; glass vs plexiglass; vehicles by CAD name; plexiglass glare

- **Disposition:** Historical/content-dependent (existing ruling).
- **Why it matters / original intent:** content; original proposal `re-classify: content`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 282; cited sources `EV:298,409; CS:46-47,92,137,155-157,239`.
- **Current implementation / remaining work:** survey/material data is Gene's
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Requires factual reconstruction or owner input; historical-content agent owns it. Promote when sourced facts are available and the featured experience needs them.
- **Dependencies:** —. **Likely baseline impact:** —.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-178 — 2026 rack members are CAD posts (4.29/4.88/5.97 m, 1.02 m deep, 81 frames `catalogDef` null; 12 beams miss posts by 0.21 m) and are not wired into assembly.ts

- **Disposition:** Historical/content-dependent (existing ruling).
- **Why it matters / original intent:** content; original proposal `re-classify: content`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 283; cited sources `HO:21-23,263,711; CS:140; PR W45; CX-2026:33,45-49`.
- **Current implementation / remaining work:** Codex's grouping tool is done; a 2026 year build is reconstruction work (Q5 open)
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Requires factual reconstruction or owner input; historical-content agent owns it. Promote when sourced facts are available and the featured experience needs them.
- **Dependencies:** —. **Likely baseline impact:** —.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-179 — 2020 Portal/Forest (364 parts) and 2025 (39) racks don't map to catalog frames; other years need rules (non-whole-foot decks, walls, 12–41-tread stairs, modules, roofs, doors, windows)

- **Disposition:** Historical/content-dependent (existing ruling).
- **Why it matters / original intent:** content; original proposal `re-classify: content`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 284; cited sources `HO:611; YB:31,35,308-319,375-376`.
- **Current implementation / remaining work:** per-year reconstruction data
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Requires factual reconstruction or owner input; historical-content agent owns it. Promote when sourced facts are available and the featured experience needs them.
- **Dependencies:** —. **Likely baseline impact:** —.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-180 — Catalog dimensions provisional: 9 ft frame, deck/stair/tread, plywood-4x6, stair-flight-10, upright-16ft-kit seats 0.22/2.48/4.757, bundle capacities, item sizes; plywood span ≤ 24 in vs 4 ft brief

- **Disposition:** Historical/content-dependent (existing ruling).
- **Why it matters / original intent:** content; original proposal `re-classify: content`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 285; cited sources `HO:231-233,264,269-270,522; EV:794,795,874,894; PG:44-46,109-112; YB:59-63,75-76; IT:8`.
- **Current implementation / remaining work:** owner dimensions and rules (QUESTIONS_FOR_GENE Q5 etc.)
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Requires factual reconstruction or owner input; historical-content agent owns it. Promote when sourced facts are available and the featured experience needs them.
- **Dependencies:** —. **Likely baseline impact:** yes if changed — year-build, flagship.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-181 — Build order, piles, crew, staging placement (algorithmic) and the campus flagship are hypothetical; composite v2 layouts tuned until refusals stopped; W13/W38 provisional rules (11 + 7); east-house yard v1 vs v2 re-pin

- **Disposition:** Historical/content-dependent (existing ruling).
- **Why it matters / original intent:** content; original proposal `re-classify: content`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 286; cited sources `EV:311,315,605,674,796,911; HO:190-191,270-271; CS:138-139; PR W13,W38,W46; YB:403-407`.
- **Current implementation / remaining work:** SP §32 non-goal "perfect inference of undocumented build sequences"; Gene decides the real order/yard
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Requires factual reconstruction or owner input; historical-content agent owns it. Promote when sourced facts are available and the featured experience needs them.
- **Dependencies:** —. **Likely baseline impact:** yes if changed — year-build, chapter takes.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-182 — 2022 reconciliation steps a–k (names, pinwheel, trailer train, stairs parallel, south solar on 45° frames, SW table, joists → plywood, roof 2x4 framing, 2023/24 trailers out of Chiba, sideways 3 ft row) incl. their engine parts (joist verb, retire beamDeckRule, stringer/tread across the depth, solar-frame-45 part, framing in yearBuildRegistryB, joist-crossed beam access)

- **Disposition:** Historical/content-dependent (existing ruling).
- **Why it matters / original intent:** content; original proposal `re-classify: content`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 287; cited sources `RC:57-441; FR:9-11,19,150-166,179; PR W36,W49,W51; YB:248-250,304-306,372-374`.
- **Current implementation / remaining work:** Gene parked reconstruction (OWNER_DECISIONS); W51 lands its green checkpoint; the engine parts are only needed for the reconstruction. HISTORICAL_CONTENT.md (W56) carries the recipe
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Requires factual reconstruction or owner input; historical-content agent owns it. Promote when sourced facts are available and the featured experience needs them.
- **Dependencies:** —. **Likely baseline impact:** yes — mars-2022/23/24 contentHash, every 2022 year-build pin, chapter takes.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-183 — Ground datum: the build ground is the Kit y = 0, 0.16 m above the studio ground, so rebuilt racks draw 0.16 m below the Kit's; 2026 GROUND_Y vs CAD rack feet

- **Disposition:** Historical/content-dependent (existing ruling).
- **Why it matters / original intent:** content; original proposal `re-classify: content`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 288; cited sources `EV:311,605; HO:630; PR W19; YB:187; SR:246-255,436-437; RC:57-89`.
- **Current implementation / remaining work:** Gene answered y = 0 (Q4); implementing it is W53's cancelled reconstruction step
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Requires factual reconstruction or owner input; historical-content agent owns it. Promote when sourced facts are available and the featured experience needs them.
- **Dependencies:** —. **Likely baseline impact:** yes — studio/lab year baselines; perf-walk if 2026 GROUND_Y moves.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-184 — Other 2022 houses (chiba, kitchen, west-house): full A+B runs and their W/P/END sections

- **Disposition:** Historical/content-dependent (existing ruling).
- **Why it matters / original intent:** content; original proposal `re-classify: content`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 289; cited sources `HO:611,720; PB:422-426; YB:472; PR W38,W47`.
- **Current implementation / remaining work:** which houses existed and how they were built is Gene's; the engine refusals they exposed stay as LM-106/107
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Requires factual reconstruction or owner input; historical-content agent owns it. Promote when sourced facts are available and the featured experience needs them.
- **Dependencies:** LM-107, LM-106. **Likely baseline impact:** —.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-185 — Stair parts unplaced (2 rail posts inside the end frame, 3 risers), kitOffsets stair 2.017 m, panels over frame lines (columns 5 cm above the roof deck), Kit roof rail posts / 36 ft railings, the long sloped 2x4 ramp

- **Disposition:** Historical/content-dependent (existing ruling).
- **Why it matters / original intent:** content; original proposal `re-classify: content`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 290; cited sources `PR W13,W27; YB:248-250,304-306,372-374; FR:150-155,179; HO:635-636`.
- **Current implementation / remaining work:** Kit geometry questions (Q19, Q29, Q30); the 2.017 m offset should be checked once to rule out an engine bug
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Requires factual reconstruction or owner input; historical-content agent owns it. Promote when sourced facts are available and the featured experience needs them.
- **Dependencies:** —. **Likely baseline impact:** —.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-186 — Per-year north bearing values: 2026 CAD ≈ −57° (33° off), 2025 ± 20°, 2024 kitchen/RV side, 2022 mirrored / "8 o'clock", 2021/2023 unverified

- **Disposition:** Historical/content-dependent (existing ruling).
- **Why it matters / original intent:** content; original proposal `re-classify: content`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 291; cited sources `HO:234-235,522; EV:316,700; CS:65-79; PR W42,W44,W49; RC:384-397,448-453; OWNER_DECISIONS A3`.
- **Current implementation / remaining work:** Gene's photos/answers (Q20–Q22); the mechanism is LM-102
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Requires factual reconstruction or owner input; historical-content agent owns it. Promote when sourced facts are available and the featured experience needs them.
- **Dependencies:** LM-102. **Likely baseline impact:** studio baselines when set.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-187 — Kit/prop and facade residuals: deck tops at y = 0 heights, fridge vs counter, 2020 counter legs through bins, rv-8/9 (2023) and rv-9/10 (2024) inside Chiba, café counter 19 % squash, 2026 details unseated, 2022 seating held; Chiba 2024 width 6 vs 7 bays, PV rows, flap 29.7°, doorway upright, solarium floor, end wall, no furniture, roof railings; lab scene findings (SW corner, trailers)

- **Disposition:** Historical/content-dependent (existing ruling).
- **Why it matters / original intent:** content; original proposal `re-classify: content`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 292; cited sources `PR W43,W46; CS:184-243; LG:34-35`.
- **Current implementation / remaining work:** photo reconciliation, parked; W51 is landing trailers-out-of-Chiba
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Requires factual reconstruction or owner input; historical-content agent owns it. Promote when sourced facts are available and the featured experience needs them.
- **Dependencies:** —. **Likely baseline impact:** —.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-188 — Camera thresholds chosen, not measured against footage (squeeze 1.2 m / 1.0 m / 0.3 m / 0.5 s, phase-2 readability); the 2024 flower mural placement/crop; frame colour per year; year-build crew generic (no fatigue, breaks, others on site)

- **Disposition:** Historical/content-dependent (existing ruling).
- **Why it matters / original intent:** content; original proposal `re-classify: content`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 293; cited sources `EV:317,722; CD:376-377; CX-fire:63; YB:188`.
- **Current implementation / remaining work:** owner taste and historical record, not engine behaviour
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Requires factual reconstruction or owner input; historical-content agent owns it. Promote when sourced facts are available and the featured experience needs them.
- **Dependencies:** —. **Likely baseline impact:** —.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-189 — Stable ids change when a piece moves ≈ 2.5 cm / 1° or changes kind (plans must pin names)

- **Disposition:** Historical/content-dependent (existing ruling).
- **Why it matters / original intent:** content; original proposal `re-classify: content`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 294; cited sources `EV:301,452; HI:25-26`.
- **Current implementation / remaining work:** by design: ids hash the placement, so an id change is a geometry (content) edit
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Requires factual reconstruction or owner input; historical-content agent owns it. Promote when sourced facts are available and the featured experience needs them.
- **Dependencies:** —. **Likely baseline impact:** —.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-190 — Rails assumed screwed to sheets; sloped roof decks not modelled; Q14 "the forklift must stay supported" ambiguous; 2022 trailer/solar/stair specifics

- **Disposition:** Historical/content-dependent (existing ruling).
- **Why it matters / original intent:** content; original proposal `re-classify: content`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 295; cited sources `EV:309,575; SPT:78-79; RC:444-447`.
- **Current implementation / remaining work:** roof slopes and forklift practice are Gene's answers
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Requires factual reconstruction or owner input; historical-content agent owns it. Promote when sourced facts are available and the featured experience needs them.
- **Dependencies:** —. **Likely baseline impact:** —.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-215 — Cross-year identity for named assets (which trailer/RV is which across 2020–2026); SketchUp proposals must not override photographic evidence; install verbs/material rules for doors, windows, roofs, railings, fixtures (bom.ts UNRESOLVED_WHY); OF §7 all seven years built and §9 every year's arrays

- **Disposition:** Historical/content-dependent (existing ruling).
- **Why it matters / original intent:** content; original proposal `re-classify: content`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 296; cited sources `SP:42,56,347; OF:120-142,160,213-217`.
- **Current implementation / remaining work:** per-year reconstruction data and process rules; the per-year verbs are new features only if a year needs them (lead, §9)
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Requires factual reconstruction or owner input; historical-content agent owns it. Promote when sourced facts are available and the featured experience needs them.
- **Dependencies:** —. **Likely baseline impact:** —.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-191 — Scanned representations of real Martians

- **Disposition:** Out of scope (existing ruling).
- **Why it matters / original intent:** out-of-scope; original proposal `re-classify: out-of-scope`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 302; cited sources `HO:252,640`.
- **Current implementation / remaining work:** SP §32 "photorealistic scanned representations of real Martians"
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Existing owner ruling excludes/replaces this requirement. Reopen only for an explicit scope decision; preserve original tests/meaning where applicable.
- **Dependencies:** —. **Likely baseline impact:** —.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-192 — Electrical: no wiring for solar/equipment, no electrical simulation for place_equipment, no EUC charging/battery/range

- **Disposition:** Out of scope (existing ruling).
- **Why it matters / original intent:** out-of-scope; original proposal `re-classify: out-of-scope`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 303; cited sources `EV:309,575; HO:251,640; SPT:36; VE:143`.
- **Current implementation / remaining work:** SP §32 electrical-grid simulation; SP §19 "not required now"
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Existing owner ruling excludes/replaces this requirement. Reopen only for an explicit scope decision; preserve original tests/meaning where applicable.
- **Dependencies:** —. **Likely baseline impact:** —.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-193 — Rule-based support / assembly model, not structural engineering: support predicate, frame load / clip-on, fasteners, toe-nails / hurricane ties, load/span/deflection, the "Mars assembly model v1, approximate" disclaimers

- **Disposition:** Out of scope (existing ruling).
- **Why it matters / original intent:** out-of-scope; original proposal `re-classify: out-of-scope`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 304; cited sources `EV:35,142,307,547,874; PG:5-6,126; FR:9,174-175; YB:8,182; HU:6; SPT:5`.
- **Current implementation / remaining work:** SP §32 "engineering-grade structural analysis … safety certification"; SP §6/§8 ask for believability, not certification
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Existing owner ruling excludes/replaces this requirement. Reopen only for an explicit scope decision; preserve original tests/meaning where applicable.
- **Dependencies:** —. **Likely baseline impact:** —.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-194 — No rigid-body / body dynamics: prone lie-down / push-up / kneel-up as timed pose phases; forklift without tilt, pallets, dunnage or a load-moment chart; vehicles without dynamics

- **Disposition:** Out of scope (existing ruling).
- **Why it matters / original intent:** out-of-scope; original proposal `re-classify: out-of-scope`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 305; cited sources `EV:297,392; HU:237; PR W28; VE:193-194`.
- **Current implementation / remaining work:** SP §32 "full dynamic rigid-body simulation"; SP §8 constraint-aware choreography
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Existing owner ruling excludes/replaces this requirement. Reopen only for an explicit scope decision; preserve original tests/meaning where applicable.
- **Dependencies:** —. **Likely baseline impact:** —.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-195 — Branch merge; timeline editor

- **Disposition:** Out of scope (existing ruling).
- **Why it matters / original intent:** out-of-scope; original proposal `re-classify: out-of-scope`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 306; cited sources `EV:43,257,797,929; HO:251-252; RV:303`.
- **Current implementation / remaining work:** SP §32 "automatic merging of arbitrary workspace branches", "Unity-like visual timeline editor"
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Existing owner ruling excludes/replaces this requirement. Reopen only for an explicit scope decision; preserve original tests/meaning where applicable.
- **Dependencies:** —. **Likely baseline impact:** —.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-196 — Mid-action resumability outside walking/social (carry, construction lifts, vehicles, ambient_wander; pause refuses them); `sampleTake(t)` is visual only

- **Disposition:** Out of scope (existing ruling).
- **Why it matters / original intent:** out-of-scope; original proposal `re-classify: out-of-scope`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 307; cited sources `EV:43,257,304,500,797,929; HO:236-237,252,457; TP:277-284; DD:319-322,357-359,405-406`.
- **Current implementation / remaining work:** SP §22 lines 248-249 permit "a defined subset" with limits stated; the subset is walking + social and is tested; the non-resumable verbs are refused by name (`snapshot.non-resumable`)
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Existing owner ruling excludes/replaces this requirement. Reopen only for an explicit scope decision; preserve original tests/meaning where applicable.
- **Dependencies:** LM-101. **Likely baseline impact:** —.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-197 — Painting drips/layers/drying, one rectangle per call; items without a drinking cycle, ladle, food geometry or spill

- **Disposition:** Out of scope (existing ruling).
- **Why it matters / original intent:** out-of-scope; original proposal `re-classify: out-of-scope`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 308; cited sources `EV:308,310,562,587; SPT:80-81; IT:99-100`.
- **Current implementation / remaining work:** SP §8 not full physics; OF §8/§12 ask for painting and eating together, which exist; the lead confirms (§9)
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Existing owner ruling excludes/replaces this requirement. Reopen only for an explicit scope decision; preserve original tests/meaning where applicable.
- **Dependencies:** —. **Likely baseline impact:** —.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-198 — Grid design choices: 0.1 m rasters with exact EDT (no navmesh); reordered/duplicate obstacle lists fall back to a full rebuild; Recast TileCache / Rapier sweeps not adopted; take replay within 5.5 mm / 8.5 mrad (thinning), not exact

- **Disposition:** Out of scope (existing ruling).
- **Why it matters / original intent:** out-of-scope; original proposal `re-classify: out-of-scope`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 309; cited sources `EV:300,314,318,440,662,737,919; HO:255`.
- **Current implementation / remaining work:** SP §9/§26 "evaluate, not blindly adopt" with the decision recorded (ENGINEERING.md); determinism (SP §23) is on state hashes, which are exact; thinning is a visual encoding
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Existing owner ruling excludes/replaces this requirement. Reopen only for an explicit scope decision; preserve original tests/meaning where applicable.
- **Dependencies:** —. **Likely baseline impact:** —.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-199 — No dismantling/removal verbs

- **Disposition:** Out of scope (existing ruling).
- **Why it matters / original intent:** out-of-scope; original proposal `re-classify: out-of-scope`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 310; cited sources `HO:247; PG:126`.
- **Current implementation / remaining work:** not in SP §12 recipes or OF §1–§15; the lead confirms (§9)
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Existing owner ruling excludes/replaces this requirement. Reopen only for an explicit scope decision; preserve original tests/meaning where applicable.
- **Dependencies:** —. **Likely baseline impact:** —.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-200 — Ladders / scaffold not modelled (`access.ts:91`); access above 2.1 m is by hand-up, pass-up, frame climbing and beam walks

- **Disposition:** Out of scope (existing ruling).
- **Why it matters / original intent:** out-of-scope; original proposal `re-classify: out-of-scope`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 311; cited sources `HO:229-230,455; CA:130,157; PG:90,122-123; EV:294,337,795`.
- **Current implementation / remaining work:** OF §5/§14 name the real Mars methods (by hand, forklift, frames, top beams) and those are modelled; SP §9 only lists ladders as a pattern to research. The lead confirms (§9)
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Existing owner ruling excludes/replaces this requirement. Reopen only for an explicit scope decision; preserve original tests/meaning where applicable.
- **Dependencies:** LM-031. **Likely baseline impact:** —.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-201 — Process notes: usage.py did not track a session; /studio p95 267 ms at 64× on a loaded host; take size +47 % before thinning

- **Disposition:** Out of scope (existing ruling).
- **Why it matters / original intent:** out-of-scope; original proposal `re-classify: out-of-scope`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 312; cited sources `HO:493-494; PR W24; BM:158-160`.
- **Current implementation / remaining work:** not engine behaviour (host load, tooling around the session, superseded by mars-take/3)
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Existing owner ruling excludes/replaces this requirement. Reopen only for an explicit scope decision; preserve original tests/meaning where applicable.
- **Dependencies:** —. **Likely baseline impact:** —.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.

### LM-216 — Selective import / cherry-pick between workspaces

- **Disposition:** Out of scope (existing ruling).
- **Why it matters / original intent:** out-of-scope; original proposal `re-classify: out-of-scope`. See the original requirement above for its concrete capability.
- **Provenance:** [LAST_MILE.md](LAST_MILE.md), original source line 313; cited sources `SP:244`.
- **Current implementation / remaining work:** SP §32 non-goal "automatic merging of arbitrary workspace branches"; SP:244 only says "prefer" — lead confirms (§9)
- **Source/tests/evidence:** No independent row-specific file/test audit in this pass; source/test pointers in the original status above must be checked before implementation.
- **Deferral / promotion trigger:** Existing owner ruling excludes/replaces this requirement. Reopen only for an explicit scope decision; preserve original tests/meaning where applicable.
- **Dependencies:** —. **Likely baseline impact:** —.
- **Bounded next task / model:** Verify current source and one representative valid/invalid case, then implement only the promoted gap. GPT-6.1 Sol medium by default; escalate hard geometry/concurrency, use Luna for factual catalog/documentation updates only.
