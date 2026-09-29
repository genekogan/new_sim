# Classroom objects checkpoint — 2026-09-29

## Playable contribution

The engine now has two clearly hypothetical classroom fixtures: `standing-display`
(1.6 × 1.65 × 0.36 m) and `speaker-lectern` (0.7 × 1.1 × 0.46 m). Both are physical
walking obstacles. The lectern offers `lectern#presenter`, a standing interaction
slot behind it. These are bounded example assets, not claims about historical Mars
objects. Appearance, dimensions/collision, slots and capability metadata are
distinct; the display capability cannot be inferred from a mesh.

The display exposes an available/on/off/text-content state in plain world JSON at
`entity.equipment`. `display_control` is an ordinary validated Runtime action with
an exclusive `display:<id>` claim, so a standalone director command cannot change
it while a classroom session owns it. The viewer renders a grounded frame whose
screen visibly changes between dark off and lit text content on. Text is limited to
160 characters; there is no URL/media fetching.

## Coordinator interface

`engine/objects/classroom.ts` exports:

- `displaySupport(rt, displayId): Diagnostic | null` for capable and available
  equipment admission. Missing, wrong-capability and unavailable objects have
  separate diagnostics.
- `classroomDisplayFocus(rt, {session, displayId, phase, content?, floorHolder?,
  attentionTarget?}): Diagnostic | null` to switch on and publish activity context.
- `classroomDisplayClear(rt, session, displayId): Diagnostic | null` to switch off and
  clear context.
- `displayReadout(rt, displayId)` for the current state and `OBJECT_ACTIONS` for
  registry composition.

The coordinator must reserve `display:<id>` exclusively for its parent action and
check each returned diagnostic. Focus/clear require the exact active reservation
holder. Call clear in the parent's cancel/completion path **before** Runtime
releases its claim. The coordinator owns people and their attention; this object
adapter only records the claimed display's content/context. The viewer reads world
state and never controls actors.

## Verification and current limits

Focused object tests pass (4/4), including dimensions/slot geometry, a presenter's
real `take_slot` route and claim, state hash change, wrong/missing/unavailable
object refusal, invalid content, exclusive
claim conflict, and ownership-checked cleanup. `npx tsc --noEmit -p .` and
`git diff --check` pass. The combined classroom scenario, browser capture and full
repository gate are integration work owned by the release lead.

The display is a local text panel, not a projection, slide deck, video or power
simulation. The presenter station is an ordinary standing slot; the session must
still validate route and actor eligibility via the existing social actions. An
external cancellation path that omits the coordinator's clear call would leave
the display on; that is a coordinator obligation to test in integration.
