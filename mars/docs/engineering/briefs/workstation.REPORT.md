# Individual computer workstation

2026-09-29. Candidate `codex/workstation-interaction`, based on immutable classroom RC
`f40f659`. Local Git only; current classroom integration/release remains untouched.

A person can now use a hypothetical computer workstation by binding a real nearby,
correctly facing fixture chair, walking and sitting through the existing Runtime sit
child, and advancing a bounded deterministic task. Successful work ends with actual
stand-up. Interrupted work remains unfinished in the station's plain equipment config;
explicit same-user/same-task continuation completes the remaining work.

Exports: `WORKSTATION_ACTIONS`, `workAt`, `readWorkstation`, `WorkAtParams` and
`WorkstationReadout` from `viewer/engine/objects/workstation.ts`. Params are
`{actor,station,seat,duration,task?,resume?}`. Default task is `computer-task`;
duration is the total task duration (positive, maximum 3600 seconds). `resume:true`
requires the exact stored task, user and original duration. Omitted resume, another
user/task/duration, or a completed/unused task gives a named refusal and does not
replace unfinished work. One task per station is the smallest continuity scope.

`computer-workstation` is a generic composite fixture, separate from any mesh import:
1.4 × 0.75 m desk, desktop height 0.74 m, 0.6 × 0.4 m monitor, overall height 1.3 m.
The full composite envelope is a conservative static collision box. It is hypothetical,
not a measured/documented Mars object. A machine-readable workstation capability in
the asset catalog supplies local chair point, position tolerance, facing direction and
tolerance; behavior checks capability instead of matching a hidden asset id. Other
future appearances can use this capability. The default chair point is [0,-1.2] m,
position tolerance 0.22 m, with the person facing local +z. Chair remains a separate
real fixture. Native sit may select its rear approach when the desktop blocks the
front approach, retaining the existing social module's seat-transition limitations.

Parent exclusively reserves actor, interaction seat, workstation, workstation entity
and chair entity. Sit/walk children delegate claims. No actor pose, activity or independent
movement controller is added. Progress starts only once the child is actually occupied;
walking, standing up and paused/missing occupancy do not count. A maximum 120-second
arrival wait ends through a named safe stop. Task elapsed seconds, total duration,
user/task identity and idle/active/unfinished/completed state live in
`entity.equipment = {kind:'workstation',config:...}`. Readout supplies fraction,
phase/action/seat and availability without modifying an unused station.

Cancellation and directed actor intervention cancel the owned seating child and keep
all parent claims through safe stand-up. A directive waits for that parent before
normal movement starts. Manual chair release and unavailable/moved bindings end with
named diagnostics, preserving progress and releasing ownership after safe cleanup.
Furniture entity claims also refuse conflicting official movement. Unsafe/free-hand,
missing/wrong actor, far/wrong-facing/occupied seat, unavailable/missing workstation,
duplicate station use and incompatible state give concrete refusal.

Smallest supported scope: one human, one grounded/upright capable station and one
compatible fixture seat on an access-free ground scene; a seated progress task rather
than an operating system, application simulation or generated content. Hands/typing,
keyboard contact, fatigue, networking, assets/mesh and UI are deferred. No automatic
resume, task reassignment/discard action, universal editor or registry wiring. Live
snapshots explicitly return `snapshot.non-resumable` with the workstation continuation
proof limitation; post-stop unfinished task continuation is supported and tested.

Validation: workstation focused tests **11/11**; combined classroom/workstation tests
**30/30**, typecheck **pass**, focused oxlint **pass**. Tests prove successful real
seating in two orientations, zero work during arrival, safe normal completion, mid-work
cancel plus explicit resume, directed safe-stop handoff, invalid actors/chairs/stations,
occupied chair and duplicate station, unavailable equipment, deterministic world/events,
pre-seat cancellation, manual seat release/mismatched continuation and explicit live
snapshot refusal. Clean cases assert zero invariant violations and no actor/slot/station/
fixture claims. No full gate, browser or golden changes; root owns eventual integration.
