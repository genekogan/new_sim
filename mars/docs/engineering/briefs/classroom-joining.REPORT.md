# Classroom joining checkpoint — 2026-09-29

## What is playable

During an active presentation or question, `classroom_control` accepts an explicit
`{kind:'join', actor, departure?}` intention. An eligible new audience member can
take a free reachable seat from the session's authored candidate list, and an
excluded audience member can return after their directive ends. The command uses
`Runtime.reclaimSocialActor` to restore the session's actor claim, then starts a
normal child `sit` action for the chosen seat. No actor pose is assigned by the
coordinator. The current speaker and talk timer continue while the person arrives.

The readout includes the new participant immediately, with `arrival:'joining'`
until the seat child actually reaches `occupied`, then `arrival:'seated'`.
`joining` lists currently arriving actors. An admitted audience member can ask a
question through the existing control verb. Returning members prefer their
original seat; a new attendee needs a supplied departure point unless the
session already has one for that actor.

## Admission and cleanup

The join command checks phase, human/ground/free-hands eligibility, actor
ownership, distinct audience cap (12), departure point, physical seat vacancy and
the existing `sit` route planner before taking a claim. Refusals name missing,
busy, held, unavailable-seat and wrong-phase conditions without changing actor
pose or session membership. Admission and claim happen synchronously in the
registered control's `start`, after validation, so another command cannot take
the seat between a queued request and its session tick. An explicit rejoin marks
its prior cancelled sit child as historical, preventing it from excluding the
member again. Session cancellation cancels a still-walking sit child, waits for
its safe stop, then releases the actor and slot claims.

## Verification and limits

Focused joining and existing classroom tests pass (24/24); TypeScript typecheck
passes. The focused tests cover a late join and question, explicit rejoin after a
directive, busy/held/missing/no-seat/phase refusal, cancellation while joining,
and the audience cap. The root release candidate has its own immutable full gate;
this branch has not run the browser or full suite.

This increment admits audience only. New presenters, rejoining after the event
has moved into conversations, dynamic furniture creation, and route recovery after
a physical world change remain outside the bounded first classroom. Snapshot
continuation for the coordinator remains explicitly unsupported by the existing
action definition.
