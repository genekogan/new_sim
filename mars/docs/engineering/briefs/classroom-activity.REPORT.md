# Bounded classroom activity coordinator

2026-09-29. Candidate `codex/classroom-activity`, based on release13 main `3bd40f2`.
Local Git only. Integration, browser evidence, full gate and deployment belong to root.

A host, presenters and audience now arrive at real fixture seats, give successive
presentations at a standing station, queue audience questions with explicit attention
transfer and return, form smaller conversations, and walk to actual departure points.
Two deterministic hypothetical arrangements have two presenters and four/eight audience
members. Registered sit/take_slot/walk_to/face/converse children perform all movement;
the coordinator never writes actor poses or activities. Seated attention is a renderer
contract, preserving seated activity and claims.

Exports from `viewer/engine/activities/index.ts`: CLASSROOM_ACTIONS,
classroomSession, classroomControl, readClassroom, CLASSROOM_DEFINITION and typed
params, intents, readout and display contracts. The small derived activity definition
records role eligibility/bounds, required/optional capabilities, phases and outcomes.

Admission binds one host, 1–6 presenters and 1–12 audience members with distinct roles,
free hands and no foreign claims. Each has a usable ground fixture seat and explicit
exit point; presenters use a ground stand slot. DisplayId and classroomDisplay service
are required by default; only explicit requireDisplay:false selects display-free
discussion. Candidate seats are tested in supplied order through normal per-actor
sit route planning. Occupied/unreachable/already assigned seats are skipped. This is
bounded greedy matching; it names failure rather than promising all feasible matchings.

Parent claims membership actors, selected seats, station and display exclusively;
physical children delegate those claims. classroom_control validates a bounded intent
queue for question/depart/advance/cancel. Readout exposes phase, floor holder, attention
actor/point, waiting reason, roles/seats/exclusion reasons, controls and questions.
Optional arrivalStaggerSeconds schedules arrivals by participant list index on runtime
ticks. Progress waits for actual seating, presenter station occupancy, conversation
completion and departures. Phase waits have an explicit deadline and named timeout.

Display supports/focus/clear return Diagnostic|null. Focus/clear run while the exact
parent display claim is held. Unavailable/disappearing display services, child route
failures and timeouts enter safe cleanup. Cancellation retains parent resources until
all owned children safely stop, including seated stand-up transitions, then clears the
display before releasing claims. Registered departure submits a top-level Runtime
directive; this independently owned walk survives later session cancellation.

Directed intervention releases parent membership and the affected safe child, excluding
that person. Remaining participants continue. Host loss ends with a named failure;
presenter loss rotates onward. Formed conversations retain remaining members during
directed work, then stop/reform before an excluded person could return. Manual hold
cancellation excludes its participant. Manually excluded actor claims remain owned by
the parent until cleanup; directed exclusion releases that actor claim immediately.

Scope/awkward behavior: ground-only admission explicitly refuses any usable access
links, named classroom.access-unsupported. Optional conversationPoints support authored
arrangements; otherwise existing converse clearance search applies. No late-join control,
automatic membership resumption, dialogue generation, furniture optimizer or moving-seat
rebinding. Infeasible routes/placements give named refusal and safe cleanup. Anatomical
contact, meshes, gaze rendering and UI are owned elsewhere. Snapshot support is explicitly
refused: ActionDef.resumable carries the reason "classroom coordinator snapshots are
deferred until the activity graph has focused continuation proof"; Runtime reports its
normal snapshot.non-resumable diagnostic. No unverified continuation promise is made.

Validation: focused classroom tests **19/19**, typecheck **pass**, focused oxlint **pass**.
Coverage includes both complete arrangements; deterministic hash/events/attention;
questions and return; occupied-seat alternative and insufficient-seat refusal; held and
duplicate actors; invalid controls; absent/unavailable/disappearing display; timeout and
route refusal; staggered arrivals; audience/host/presenter directives; manual seat cancel;
formed conversation exclusion and short-directive return suppression; departing-walk
preemption; independent departure plus session cancellation; named access refusal.
Completed/cleaned cases assert zero invariant violations and no actor/slot/display claims.
No browser/full gate/golden/shared progress edits. Next: root integrates real equipment,
/lab controls and scenario, inspects actual runtime captures, then gates the combined RC.
