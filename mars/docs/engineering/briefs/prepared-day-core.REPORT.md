# Prepared day core — source candidate

Source-only optional extension to the existing purposeful routine. Unvalidated:
no tests, TypeScript, lint, builds or browser commands were run in this task,
because the root owner holds the shared validation slot. No released or playable
combined-day claim follows from this source. Standalone sleep visual acceptance,
combined authored scenarios/UI, focused execution, the full combined release gate
and deployed verification remain with the root owner.

## Behavior and boundaries

`PurposefulRoutineParams.preparation?: PrepareFoodParams` binds the same worker,
shared meal pot and the first meal participant's spoon. The existing requirement
that the worker is the first participant remains unchanged. Preparation admission
uses the actual cold recipe plan instead of pretending an empty pot is a filled
meal. Ordinary shared food validates actual available contents at dispatch.

After the gathering and optional retained pair trip, preparation executes as an
ordinary child. Pause/director interruption cancels/drains that physical child;
partial `foodPreparation` and conserved quantities remain authoritative on the
pot. Explicit Resume retries the same recipe bindings. A detached readout snapshot
retains observed preparation progress and rejects changed preparation on Resume.
End drains without erasing deposits, inventing food or forcibly stowing a retained
spoon; ordinary hold maintenance remains intact. The committed meal spoon can flow
into the existing shared-food action, which already permits that held utensil.

`sleep?: SleepParams` belongs to the same worker and replaces the seated-rest phase.
The old required `rest` parameter remains backward compatible, but its seat is not
required when sleep is chosen. The real sleep plan verifies current mat clearance,
support and route at admission; actual child admission rechecks when sleep begins.
The routine keeps a single logical sleep action through Pause/Resume and player
direction. Pause controls that sleep instead of cancelling/recreating it; parent
cleanup waits until physical owned sleep actions finish waking and release actor
and mat claims. End cancels and drains the logical sleep. Only completed duration
and ordinary wake/return completion authorize the notes phase. An executed ended
sleep is never silently replaced; an initial nonexecuted admission failure can be
retried explicitly. No new support, locomotion, ownership or pose authority exists.

With no optional bindings, the prior food admission, seated rest, child sequence
and readout fields remain unchanged. Presenter follow-up's existing exact-work
prerequisite can continue observing the same routine identity without modification.

## Candidate test coverage (not executed)

`viewer/engine/test/prepared-day-core.test.ts` constructs a hypothetical test-only
composition over the existing four-guest work-break factory. It puts ingredients
in proven recipe columns, relocates the worker spoon to a free slot and places a
mat in the clear east ground area. No production scenario factories are changed.

Cases cover the full gathering/pair/preparation/food/sleep/same-notes chain; partial
preparation pause/retry; parent sleep pause during lie/sleep/wake; player handoff,
same sleep ID/elapsed and End cleanup; incompatible preparation/sleep bindings;
changed paused preparation; and preparation End preserving deposits/held spoon.
Existing purposeful-routine tests are untouched and remain required regressions.

Combined table reach/capacity, longer paths, real Play visuals and the authored
Mars8/studio variations remain unproven. Escalate any need for broader lifecycle,
routing, animation or support redesign. Current rigs, explicit authored choices,
fixed ground arrangements, one cold two-ingredient recipe and two meal participants
remain the scope. Runtime-local Pause/Resume only; active reload is unsupported.
