# Live classroom furniture intervention: bounded feasibility

Read-only review, 2026-09-29. Released source inspected at main f0e3851 (release16 metadata), `<mars-campus-repo>`; existing activity branch stow-items ffc90e8 has the same relevant classroom/social mechanisms. Root's release17 candidate/gate is independent and untouched. No tests, browser, source edits or commits performed.

## Current behavior and evidence

- `viewer/engine/world/catalog.ts:247–255`: camp-chair is a hypothetical 0.55 ×0.85 ×0.55 m,4 kg obstacle fixture with one seat slot. It has no carry/grip handling capability. It is not a small held item.
- `viewer/engine/carry/validate.ts:124–142`: ordinary carry rejects any non-component with carry.not-carriable, then requires stored/staged ground support. `carry/formation.ts:123–140` builds from construction handling/grips. Reclassifying a chair as construction stock would change its meaning and is not a safe shortcut. Registry/source search found no registered fixture relocation action.
- `viewer/engine/activities/classroom.ts:451–466`: session owns actors, presenter slot, assigned `slot:<chair>#seat` and display. It does **not** reserve `entity:<chair>`. `social/actions.ts:119–123` similarly reserves actor and slot, not the fixture entity. work_at already reserves its station and seat owner entity (`objects/workstation.ts:209–215`), so a future mover must respect both kinds of ownership.
- `social/slots.ts:61–67` derives fresh world seat position/yaw from current fixture pose. `social/actions.ts:128–160,162–175` resolves a seat/approach into a detached program/exec, and `:190–209` walks/turns/sits using those captured coordinates. No ongoing fixture binding check refreshes or invalidates that cached slot. Moving a reserved chair directly would leave an arrival targeting old coordinates; an occupied person's hold also does not follow the moved chair.
- `spatial/service.ts:149–185` detects navigation geometry changes, rebuilds derived grids and advances epoch. `locomotion/walk.ts:538–563` can replan an invalid corridor, but this preserves the old walk destination; navigation invalidation does not retarget an admitted seat program.
- Classroom initially chooses free reachable authored seats (`activities/classroom.ts:593–656`). Existing test `engine/test/classroom-activity.test.ts:204` proves an occupied candidate is skipped for a spare. Admission occurs once; arrival children start immediately or after configured stagger (`classroom.ts:664–688,831–842`). Arrival completes only once participating holds are occupied (`:843–849`).
- A foreign cancellation excludes a member (`classroom.ts:751–780`); other failed holds invoke whole-session cleanup (`:755–762`). A successful seat-specific retry path does not exist. Join uses reachable authored spare seats (`:224–255`), but only presenting/question admit joining (`:171–177`), and its actor/role semantics are not a substitute for furniture intervention.
- Runtime supports parent-child inherited claims and actor reclaim (`runtime/runtime.ts:477–485`), not a public generic mid-session parent claim transfer/release API. Releasing an actor and rejoining would intentionally change participation; do not use that to simulate a chair correction.

## Smallest visible next deliverable

Recommend a **seat withdrawal and local reassignment**, explicitly described as "Close this empty chair to seating" rather than physical chair movement. One registered classroom_control intent, e.g. `{kind:'withdraw-seat',seat:'seat8#seat'}`, with an optional explicit replacement authored seat. Bound it to arriving, audience role only, and a participant who has not entered sit-down/occupied. Host/presenter furniture remains fixed. The first proof can use the staggered participant whose sit child has not yet started; a second bounded case can stop an existing ground approach child safely.

The coordinator marks the seat unavailable to this session, records the affected actor/old seat/replacement and a waiting reason, and uses an ordinary new sit child for that same participant after any prior approach child reaches a safe stop. Choose only from the session's existing authored candidate list, with the same free/compatible/reachable checks as admission; explicit replacement must be honored or refused. No pose writes, participant exclusion, whole-event restart or automatic move of occupied furniture. Suppress the expected old-child stop from the current foreign-cancellation exclusion path. Preserve host, presenters, other audience holds and question/floor state.

Old initial seat claims can remain held by the parent until session cleanup: the chair is deliberately closed for the rest of that session. New sit child can own the spare slot through normal child reservations. Do not promise the old chair becomes generally movable/unreserved, or that this mechanism dynamically changes arbitrary parent claims. A new late-join seat previously owned by its child needs careful cancellation-time ownership tracking; defer that variant initially.

HUD shows "seat8 closed; visitor approaching seat9" (actual authored participant IDs), and refusals name occupied/transitioning actor+chair. This gives visible local recovery and ownership behavior now, but it is **not yet physical furniture rearrangement**. The owner should choose this narrow foundation versus investing directly in the chair movement prerequisite.

## Actual chair relocation prerequisite / stopping point

A real "move empty reserved audience chair" cannot be delivered solely by the present activity coordinator plus existing physical actions. It needs either (a) a bounded fixture-carry executor/capability with actual supported pickup/route/set-down, or (b) owner-approved live layout editing semantics clearly presented as editing, not a person carrying furniture. No renderer/UI mutation of world.pose and no teleport disguised as carry.

A future registered mover must claim `entity:<chair>` **and every seat slot on that fixture**, recheck current human occupancy/transition at commit, and refuse while occupied. Empty does not mean unreserved. If moving the session's assigned empty chair, it must be an explicitly authorized session child inheriting the parent seat claim, with physical carrier claims checked normally. Cancel/stabilize the stale sit approach first; bind the replacement sit only after mover completion. Parent retains old slot ownership until cleanup. If chair geometry/capability, safe support, cancellation or end-position occupancy requires broad carry redesign, stop and write a separate prerequisite brief.

Do not widen this increment to a universal furniture DSL, drag editor, new building system, moving occupied furniture, relocation across levels/access links, automatic seating optimization or hidden rearrangement of the entire event.

## Bounded acceptance tests

1. Staggered audience arrival: close an assigned empty chair before its child starts; same actor takes an authored spare, original event reaches presenting and finishes; other role/seat assignments remain stable.
2. Ground approach in progress: expected safe child stop followed by replacement sit; actor remains participating, no old coordinate seating, no ghost hold or duplicate children. Final phase advances from actual occupation.
3. Occupied or sit-down/stand-up chair intervention refuses with named actor/seat; hash, participation, floor and original hold remain unchanged. Host/presenter chair intervention also refuses in first scope.
4. Explicit missing/wrong/occupied/unreachable replacement and exhausted spare list produce useful refusal. They do not cancel the existing valid arrival or end the event; if old chair is already unavailable, report a bounded local wait or exclude only that audience member with explicit reason, preserving minimum-role viability.
5. Two interventions targeting one replacement have one winner via ordinary slot reservations. Repeated closure is a named idempotent refusal or readout of existing closure, not another stop.
6. Cancel while reassignment stops/approaches: safe child cleanup, no remaining actor/slot claims from ended parent; unchanged fixture poses. Repeat with identical seed/input ticks for same outcome/marks.
7. Negative future-mover test before physical expansion: occupied/reserved fixture move refuses without support/pose writes. Do not infer safe relocation from a clearance-only check.
8. One actual inside-room UI proof after engine checks: close chair during arrival, show affected participant at replacement and ongoing presenter; capture occupied-seat refusal. Root owns this later visual work, not this feasibility pass.

## Hard constraints and open choice

All controls use registered/validated intents; actor movement remains existing sit/walk children. Fixed ground scope, bounded local wait/cleanup, parent ownership coherent throughout. No claims are manually dropped merely to let a furniture command through. Current active classroom snapshots remain explicit nonresumable. Exact hand contact and chair pickup rendering are separate fidelity work.

Stop before implementation if the owner requires physically moving chairs now rather than the honest seat-withdrawal foundation, or if safe local approach stopping requires Runtime reservation/preemption redesign. The present global route replan mechanism alone is insufficient to certify seat rebinding. Choose and author the smallest fixture mover prerequisite first in that case.
