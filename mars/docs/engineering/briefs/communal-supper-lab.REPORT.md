# Communal supper Lab candidate

Future candidate, separate from the frozen release38/public gate. HUD and Play
specification only; owned paths are `viewer/app/lab/communal-supper-hud.tsx`,
`viewer/e2e/communal-supper.spec.ts`, and this report. Base `5f1dc2e` plus the
reviewed `ca3a105` shared-food foundation and `47c7ac8` communal-supper core
(local dependency cherries `45c4516` / `9420dca`).
No shared selector, registry stamp, panel, hook, camera adapter or engine edits.

## Product scope and wiring

Export `CommunalSupperHud({ sim, refresh })`, visible for **communal-supper only**.
This is the core's one hypothetical interior layout, with anonymous cook/guest and
seven existing vessels. There is no rotated variant, heat, universal recipe,
shared walking claim, washing, refill, replacement, growth or active save/load.

Root wiring needs the preset world/scene and canonical actions, the HUD panel,
and one read-only hook:
`communalSupper(): readCommunalSupper(rt, latestActualSupperId) ?? null`.
The detached core readout supplies current materials/support, actual claims,
recipe deposits/mixing, own meal receipts/floor, exact cleanup bindings/completed
placements and owned leaf IDs. Existing state/records/heldItems/slots/humanFields/
bones/cameraEntities/camera hooks provide the remaining capture facts. No direct
logical-claim mutation hook or arbitrary command probe is needed.

Start requires authoritative core admission and a fresh world without a previous
supper. Pause/Resume/End use exact supper ID, authoritative control admission and
click-time Runtime/epoch checks. Pending controls cannot queue stale operations
through End or Reset. Display distinguishes physical draining from paused and
ended from finished. Both real material and later direction diagnostics are visible.
Direct cook away is available only after safe local Pause, with no competing
control/player walk and a registered ordinary walk. It submits Runtime's supported
handoff to [-4,-3]; it does not false-disable solely from raw walk preflight at a
held pose. No pose/support changes are made. Resume remains the core's decision.

Preparation Pause retains actual finite deposits/mixing and may leave a supported
spoon in the cook's hand. Meal Pause retains cancelled leaf receipts and genuinely
held utensils; Resume passes the latest same-Runtime checkpoint and cannot serve
already consumed bowls again. Cleanup Pause retains completed placements and
safely supports its carried transfer. End keeps Play running for ordinary draining
and supported utensil return; completed food/material effects stay. Reset explicitly
stages a fresh hypothetical world.

## Authored acceptance journeys — unexecuted

Two actualPlay tests use a fixed ordinary 4x speed, 120-second whole-test limit,
15-second named phase waits, retries zero and fresh load/Reset/readiness Step.
After readiness, all preparation, eating, turns, cleanup and safe stopping advance
through actual Play. No programmatic stepping, runtime pose/material writes,
timeout increase, tolerances or camera quality claims are part of the journeys.

1. Partial real ingredient deposit → local Pause → ordinary cook direction →
   explicit retained recipe Resume → same pot prepared material. Actual two-person
   servings/floor/partial eating → Pause and same-purpose receipt Resume → both
   consumed before stow → second Pause → explicit same empty-bowl receipt Resume,
   no new serving → ordinary supported mealware return → actual held transfer →
   four meal vessels stored → actual held prepware transfer → seven originals
   stored and finished. Finite ingredient/pot/bowl/consumed totals stay exact.
2. Accepted End before the first step creates no phantom recipe/meal/physical child.
   Reset, prepare and actually hold both meal roles' utensils, then End → safe
   ordinary returns with unchanged current material → released claims/actions →
   Reset restores the fresh world without residual action/held/slot state.

Captures include PNG, JSON with actual git HEAD/run receipts, a11y YAML, engine
state/records/current exact identities/material/support, held rendered/engine/palm
facts, hand fields/bones, actual claim arrays, floor/receipts, violations and console
errors. Failure screenshots/readouts and per-test status/errors are durable even
when a later assertion fails. Cameras frame actual fixture facts or the declared
conversation position; they never edit the world. Fine fingers, sparse gestures and
continuous camera quality are outside these assertions and require honest visual
review by the later serialized browser owner.

The browser journeys are **authored but unexecuted**. No pass, screenshot inspection,
public proof or shipping claim is made. Root owns selector/hook/control integration
and the eventual serialized browser run.

## Authoring checks

Reviewed core dependency installed. Viewer `npm run typecheck`, strict standalone
TypeScript over the e2e spec (ES2022 target with the project's esnext/DOM libraries),
focused type-aware Oxlint, Oxfmt checks and `git diff --check` all passed. An initial
pre-dependency lint correctly reported the absent core imports; installation resolved
those diagnostics. A first standalone TypeScript command omitted the project's
esnext library and rejected an existing hook's `findLast`; the corrected command
matches project libraries and passes without source changes. Core worker separately
reported 24 new / 124 combined Node cases passing; this HUD lane did not rerun Node,
browser, performance or full-gate tests. Selector/panel/hook wiring remains root-owned.

Only this final three-path commit is the UI/spec contribution to integrate after the
foundation and core; do not cherry the duplicated dependency commits again.


## Current storage and explicit End recovery follow-up

Dependency `d1846e1` (local cherry `eb68464`) adds reviewed End recovery and detached
`returnAttempts`. Storage rows now compare each same-ID item's **current**
`resting-on` owner and slot from `state.items` against its declared destination
from `state.bindings`. A completed tidy receipt alone never claims present storage
if that object has moved; the row labels retained past completion separately.

The HUD lists actual End return attempt IDs, verbs, terminal/running status, physical
phase and concrete diagnostic, preserving stopped attempts visibly. A concise
instruction explains that restoring the named support/route and pressing End again
explicitly retries remaining actual held utensils. The existing End button still
uses core control admission and pending/freshness checks. No support/pose writes,
engine changes, e2e changes, weakened assertions or new persistence claim were added.
The browser remains unexecuted in this lane; root owns the serialized release38 gate.

Follow-up validation: viewer TypeScript, focused type-aware lint, formatting and
diff whitespace checks all passed. No browser, performance or Node rerun was made.
