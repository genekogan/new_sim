# Connected room preparation — future core candidate

Base `cea39b5eff0e4ec874d47308a74576084bf89926`, isolated `codex/room-preparation`. Four new assigned paths only. No registry, existing rule, selector, HUD, camera, renderer, historical value or original classroom staging changed. Existing dependencies are symlinked; no install, browser, performance or full gate. Root owns playable integration, actual Play evidence and release validation.

## Connected experience and reusable APIs

The hypothetical classroom-4 derivative retains nine existing people: host, two presenters, four guests, worker and optional visitor. Worker clears the same `break-bowl` and `break-spoon` into declared `storage-table` at `[12,0,4]`. Guest1/guest2 then move empty `belongings-table` from `[10,0,-5]` to `[12,0,-2]`; guest3 carries `seat8` from `[4.5,0,3]` to `[7.5,0,3]`. Existing classroom arrivals/two talks/questions/rotation/conversations/departures follow. Optional visitor uses ordinary Join to sit in the actual relocated `seat8#seat` and ask a question.

The original classroom bowl at edge `r0c1` refuses `tidy_table.source-capacity` because its footprint overhangs. This derivative explicitly initializes the same-ID props at supported interior `r1c1/r1c2` before Runtime creation. No runtime teleport, original-preset edit or capacity weakening occurs. All staging/people are hypothetical, with no historical reconstruction claim.

Existing `tidy_table`, `setup_room`, `move_fixture` and `classroom_session` remain authoritative. The finite coordinator submits cleanup → setup → session only after real predecessor completion/release and next-stage admission. Existing item walking/take/put, shared fixture carry and classroom children own all physical writes. The parent reserves one logical `room-preparation` claim, never its own people/movement.

- `roomPreparation`, verb `room_preparation`, accepts `RoomPreparationParams {tidy,setup,session,late:{actor,departure}}`. Bounds: two stored items, one source table plus one classroom candidate chair; at most nine declared people, two presenters/four audience, one optional late person outside the initial session.
- `roomPreparationControl`, verb `room_preparation_control`, accepts `{preparation,intent:'pause'|'resume'|'end'}`. `ROOM_PREPARATION_ACTIONS` supplies local registry extras.
- Detached `readRoomPreparation(rt,action)` exposes stage/mode/status/finished, bindings, child IDs/owned actions, actual tidy/setup/session readouts, full authored target placements and stored objects, waiting reason/diagnostic. All returned nesting is cloned.
- `roomPreparationWorld/Scene/Binding/Runtime()` build the bounded derivative with the existing common registry plus missing local extras and existing classroom display/spatial services.

## Honest interruption and refusal

Cleanup Pause uses the existing persistent safe Pause: held items drain to actual permitted support, completed transfers remain, and explicit Resume continues the same tidy task. A tidier directive releases the object before its independent walk; the parent waits for explicit Resume. An externally cancelled incomplete cleanup is not silently recreated when the remaining list could violate the existing two-item contract.

Setup Pause safely cancels the existing physical setup. Partial ground placements persist. Explicit Resume preflights a new setup from those actual poses, skipping fixtures already at their exact targets. This is safe-ground retry, not active setup graph resume, undo, relifting a finished table or retidying. Occupied/unsupported/unavailable targets wait with named diagnostics and no automatic retries or failed-child spam; explicit Resume rechecks real admission after restoration.

Once classroom begins, local Pause refuses `room_preparation.session-pause-unsupported`: Global Pause freezes the world; ordinary session controls remain available; End drains. No classroom continuation architecture is invented. Clients use exposed `session.session` with normal `classroom_control` (Join/question/depart/advance/cancel) and ordinary directives. Optional Join explicitly passes `bindings.late.departure`. Directed participants retain existing exclusion/explicit rejoin behavior.

End drains all owned active children before release, retaining completed storage and safe partial layouts. Pre-first-tick End creates no physical children. `finished:true` means the complete natural session chain; cancellation/End retains `finished:false`. Existing blocked safe-release children keep truthful ownership until declared support is restored.

Admitted item ID/material/configuration stay immutable. Completed storage snapshots also include the actual destination fixture/support, while excluding the source table that is intentionally moved. Changed payload/storage support safely stops preparation and names the binding; no replacement or silent repair is performed. Completion boundaries are rechecked before advancing; changed completed layout requires explicit remaining-fixture retry.

## Verification and limits

Focused checks cover complete session and late moved-seat question, exact world/action/readout replay, same IDs/contents/support, detached nesting, pre-tick End/Pause, second-held-item Pause/Resume, tidier direction, held table stop/retry, completed table retention while chair retries, End in each stage, named local classroom Pause refusal, existing session exclusion/rejoin, occupied chair with explicit safe restoration, changed storage support, immutable payload restoration, exact tidy/setup completion boundaries, original edge capacity refusal, malformed definition/missing item and zero violations/final actor/hand/item/surface claims.

Final result: **15/15 new focused Node checks pass**, about eight seconds. Viewer TypeScript, focused type-aware/type-check lint, formatter/diff checks pass. Ignored log: `viewer/.cloudflare/room-preparation-focused.log`. Existing engine files remain unchanged; no broader tests or browser/performance/full gate were run. Root must run actual Play, inspect captures and perform release validation before shipping.

Fine fingers/sideways carry gait, arbitrary floor/layout optimization, actor/source substitutions, active reload and local classroom Pause/Resume remain outside scope. This is a finite bridge over useful existing work, not a universal coordinator or furnishing planner.
