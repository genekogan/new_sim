# Mars MVP handoff — DRAFT, acceptance pending

**Not a completion or publication receipt.** Root must finish the final clean gate,
public acceptance review and website publication/verification before finalizing
this handoff. Production remains **release 34**. This draft is authored from the
closing documentation/UI worktree at `9958ed4`; that candidate is not a published
release. The separately frozen sleep/day gate candidate was `fafdb72`; neither
identifier substitutes for the final verified source or release.

Authority: [closing scope/deadline](briefs/mars-mvp-closing-sprint.md),
[family/disruption acceptance matrix](briefs/mars-mvp-acceptance-review.md),
[current roadmap](ACTIVE_ROADMAP.md), [release receipts](RELEASE_CHECKLIST.md).
Focused evidence and limits: [prepared day](briefs/prepared-day-play.REPORT.md),
[supported sleep](briefs/sleep-play.REPORT.md), [prepared-day core](briefs/prepared-day-core.REPORT.md).
[Backlog](RAINY_DAY_BACKLOG.md) retains deferred dispositions; this is not a new
inventory audit or planning tranche.

## Final verified receipts — root fills after proof

| Field | Value |
| --- | --- |
| Final release / publication time / deployed version | **PENDING** |
| Exact final functional source / rule version / clean gate receipt | **PENDING** |
| Idle performance and exact-source evidence reuse receipts | **PENDING** |
| Public website entry and verification receipts for all three day presets | **PENDING** |
| Final critical family/disruption review and owner acceptance | **PENDING** |
| Inspected final public captures / logs / retained failures | **PENDING** |
| Verified rollback target and procedure | **PENDING** |

## Supported scope and persistence boundary

Use the acceptance matrix's authored gathering/learning, room setup, work/reading,
paired walking, chess, music/listening, cold preparation/sharing, sleep/wake and
connected-day examples. Prepared day has Mars4, physically prepared Mars8 side
layout and an independent hypothetical studio; retained notes, finite cold food,
one grounded mat and independent attendee commitments. No arbitrary capacity or
room-layout guarantee follows. These are hypothetical participants/arrangements,
not historical recipes or autonomous daily needs.

Keep current rigs and existing bounded pose adapters. Physical movement, support,
claims, cleanup, conserved effects and named refusal/waiting remain authoritative.
Live Pause/Resume retains the same unfinished intention and partial recipe/sleep
progress; Reset replaces the world. Quiescent object JSON and recorded take replay
are distinct from active logical restoration. Sleep/preparation/routine active
reload restoration is outside the supported contract; do not infer it from replay
or opt-in snapshot support for other verbs. Fine fingers/clothing/contact, heat/
chopping, arbitrary beds/terrain, broad autonomy and universal planning are deferred.

## Existing extension points — preserve one execution path

Paths below are implemented seams to inspect for future authorized work, not
promises of general-purpose APIs or instructions to begin Eden.

| Seam | Real source and boundary |
| --- | --- |
| Action lifecycle and admission | [ActionDef](../../viewer/engine/actions/types.ts), [Runtime](../../viewer/engine/runtime/runtime.ts), [registry/services](../../viewer/engine/api/registry.ts): schema, plan, hierarchical claims, fixed steps, cancel/yield/directive; retain one registry and mover. |
| Activity coordination/readouts | [activity exports](../../viewer/engine/activities/index.ts), [purposeful routine](../../viewer/engine/activities/purposeful-routine.ts), [independent continuations](../../viewer/engine/activities/gathering-continuation.ts): bind existing roles/purposes to ordinary child actions; readouts observe authority. |
| Object affordances and durable progress | [catalog](../../viewer/engine/world/catalog.ts), [world state](../../viewer/engine/world/types.ts), [workstation](../../viewer/engine/objects/workstation.ts), [reading](../../viewer/engine/objects/reading.ts), [chess](../../viewer/engine/objects/chess.ts): authored interaction slots, capabilities and retained object state; a mesh alone is not a usable capability. |
| Physical food and support | [item model](../../viewer/engine/items/model.ts), [item actions](../../viewer/engine/items/actions.ts), [preparation](../../viewer/engine/activities/prepare-food.ts), [sleep](../../viewer/engine/activities/sleep.ts): existing takes/puts, supported hand expression, finite portions and ground-rest claims; no parallel controller. |
| Scenario reuse | [prepared-day factories/bindings](../../viewer/engine/scenarios/prepared-day.ts), [studio bindings](../../viewer/engine/scenarios/design-studio.ts): explicit bounded arrangements use the same actions/services rather than alternate simulation logic. |
| Safety and determinism | [invariants](../../viewer/engine/runtime/invariants.ts), [spatial service](../../viewer/engine/spatial/service.ts), [deterministic math](../../viewer/engine/core/math.ts), [guide](ENGINE_GUIDE.md): preserve support/collision/movement checks, DT 1/20 and named diagnostics. |
| Recording/restoration and visual boundary | [take recorder](../../viewer/engine/take/recorder.ts), [read-only replay](../../viewer/engine/take/replay.ts), [snapshot admission](../../viewer/engine/runtime/snapshot.ts), [human adapter](../../viewer/app/engine-view/humans.ts): replay is observation; snapshot admission enforces each verb’s restoration contract; rig expression does not move actors or rewrite support. |

A later, separately authorized Eden comparison may assess existing procedural
posing versus authored motions with constrained IK, as already scoped in the
[stair-descent pose report](briefs/stair-descent-pose.REPORT.md). Preserve anatomical
left/right and the authoritative activity/renderer boundary. No animation redesign,
camera work or Eden implementation is commissioned by this handoff.

## Final eight-disruption proof checklist — root records verified evidence

Existing test names below locate supported assertions, not proof of a new run or
public coverage. Fill exact inherited/current source receipts and the representative
runtime outcome required by the acceptance matrix for every row; passing totals or skipped cases do not close these boxes.

| Required disruption | Existing proof location/name; final receipt |
| --- | --- |
| Late arrival | [classroom-life.spec.ts](../../viewer/e2e/classroom-life.spec.ts): “worker interrupts notes, joins and leaves class, resumes; late visitor actually joins”. **PENDING final receipt**. |
| Occupied seat | [classroom-activity.test.ts](../../viewer/engine/test/classroom-activity.test.ts): “occupied seat uses spare eligible fixture, insufficient seats refuse”; [purposeful-routine.test.ts](../../viewer/engine/test/purposeful-routine.test.ts): “late foreign occupied rest seat waits without cancelling its occupant or repeating failed requests”. **PENDING understandable visible wait/refusal**. |
| Unavailable equipment | [design-studio.test.ts](../../viewer/engine/test/design-studio.test.ts): “occupied studio computer and foreign unfinished task refuse without overwriting them” and “unavailable required studio display refuses before claiming people; restoring it admits the same critique”. **PENDING actual public busy-computer branch, named refusal and preserved foreign work; still required**. |
| Blocked route | [classroom-activity.test.ts](../../viewer/engine/test/classroom-activity.test.ts): “failed arrival route names the obstruction and leaves no committed session claims”. **PENDING visible representative route refusal/wait and cleanup receipt**. |
| Moved furniture | [room-setup.test.ts](../../viewer/engine/test/room-setup.test.ts): “cancelled partial physical placement is visible without undo; later changed completed layout loses readiness”. **PENDING final inherited/current physical placement receipt**. |
| Departure | [classroom-activity.test.ts](../../viewer/engine/test/classroom-activity.test.ts): “registered departure and cancellation wait for safe seat stops”. **PENDING public safe release and remaining participants' continuation**. |
| Player precedence | [sleep.test.ts](../../viewer/engine/test/sleep.test.ts): “director movement waits for wake, then owns actor; unfinished rest/return needs explicit Resume”; [purposeful-routine.test.ts](../../viewer/engine/test/purposeful-routine.test.ts): “directing the companion during a routine trip preserves foreign movement and explicit regroup”. **PENDING final handoff receipt**. |
| Interruption/resumption | [prepared-day.spec.ts](../../viewer/e2e/prepared-day.spec.ts): each “prepared-day-4/8/studio: unfinished purpose through a real prepared meal and sleep” case; [sleep proof](briefs/sleep-play.REPORT.md). **PENDING final partial recipe/same-sleep/original-notes identity and Reset receipt**. |

After verified MVP acceptance and publication, **stop Mars feature expansion**.
Preserve this handoff, receipts and deferred work; do not start Eden automatically.
Further feature work requires a new explicit owner request.
