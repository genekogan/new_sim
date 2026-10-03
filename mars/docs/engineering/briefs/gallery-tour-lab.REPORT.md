# Gallery HUD and Play authoring

**Future, unshipped; browser proof pending.** Isolated `codex/gallery-tour-lab`
inherits root combined source plus the gallery core at `d61d4ef4263f398e417c6729c42a26b7b3197d49`. This candidate
owns only `viewer/app/lab/gallery-tour-hud.tsx`,
`viewer/e2e/gallery-tour.spec.ts` and this report. Registry/scenario/hook/panel and
camera facts remain root-owned. No shared interfaces, dependencies, rigs, engine
semantics or historical values were changed.

## HUD

`GalleryTourHud({sim,refresh})` renders only `gallery-tour` and
`gallery-tour-short`. It uses the actual latest retained `gallery_tour` record and
`readGalleryTour`; it does not keep a private executor. Start submits the registered
coordinator with `galleryTourBinding()`, using two stops for the short preset.
The hypothetical pre-made artwork scope is explicit.

The panel reads the actual current pad, retained drawing marks/task/support,
current stop and completed stop history, declared membership, physical viewing
roles, floor/shared attention, actual question/answer contributions, diagnostics
and bounded retry state. Pause/Resume/End, Ask/Answer/Floor and declared Join/Leave
are enabled by real admission and lifecycle checks. Direct host away submits an
ordinary `walk_to` to `[-10,-8]`; existing directive/yield hooks own the physical
handoff and explicit tour Resume.

Handlers recheck runtime identity, `scenarioEpoch`, pending controls/directions,
actual live action and plan at click time. Feedback is keyed by runtime/epoch.
No effect queues actions across Reset, no actor/support/mark is moved directly,
and no new unsupported controls or orphan child executor is introduced.

## Authored actual Play regressions

Two tests retain the existing 120-second timeout, one worker and no retries.
Execution is **not yet performed**; timing/control availability and visual
visibility remain authored expectations.

- Three-stop default: physically forms the first real viewing circle, records a
  question and explicitly requests an eligible visitor answer, safely Pauses and
  explicitly Resumes the same circle with exact retained clock/effects/history,
  reaches the second and third actual pads, requests a real floor, verifies same
  pad/table/pencil identities and ordinary completed departures before each new
  binding, then explicitly Ends during the third stop. Completed first/second
  history persists; early End remains distinct from successful completion.
- Two-stop short: a visitor Leaves physically and remains withdrawn at the next
  stop; the named insufficient-audience wait is exposed. Explicit declared late
  Join restores actual viewing. A player host direction completes its ordinary
  walk and requires explicit Resume of the same retained discussion. Both stops
  then finish, claims/held items/tasks/hand drivers release, and Reset/first-Step
  checks a fresh world.

Current-rig talk/listen poses, planted soles, authoritative ground height, actual
attention, eight real retained marks per displayed pad, exact discussion progress,
per-stop question/history and no replacement objects are asserted. The short
transition expects the actual two continuing departure walkers, plus the prior
Leave already complete; the default checks all three. These assertions are not
weakened to match a future failure.

Global Pause freezes captures/intervention boundaries, then Play resumes ordinary
physical execution. No programmatic runtime stepping claims activity progress;
Step is used only after Reset for tick 1 readiness. Manual camera requests only
frame the actual stop; they have no world authority.

## Minimal hook and evidence handoff

Root supplies the agreed read-only `EngineHook.galleryTour()` returning the latest
readout or null. The spec uses a local intersection cast for that planned hook,
without editing `EngineHook`. No additional shared API is required.

At execution time each JSON receipt records the actual `git rev-parse HEAD` and
run id. Under `viewer/e2e/artifacts/$E2E_RUN`, the planned six default and five short
captures each write PNG, accessibility YAML and detached state JSON. Per-test
proof/result receipts include records, violation state, actual entities/support,
slots, human/rig/attention facts, page errors and console errors; failed runs retain
a frozen failure capture and the standard trace. Personally inspect all actual
images, preserve failed-first evidence and save runner logs before claiming proof.
No evidence images exist from this authoring task.

Only after root grants a frozen-source browser slot, from `viewer/`:

```sh
E2E_VITE_PORT=<assigned> MARS_SIMULATION_PORT=<assigned> E2E_RUN=<fresh-source-run> \
  npm run e2e -- gallery-tour.spec.ts --workers=1
```

Use existing dependency/browser symlinks and copy the frozen campus assets. Do not
install, run browser/performance checks during release37 validation, change shared
source or raise timeouts without measuring an actual failing journey first.

## Fast authoring checks

Viewer typecheck, focused type-aware HUD/spec lint, formatting and diff whitespace
checks: PASS. Browser/performance/full gate: intentionally not run. Root integration,
actual Play, personally inspected captures and release validation remain necessary
before this future candidate can be called shipped or visually proved.

## Bounded director endpoint repair (future source ce2213c)

The first actual Play short-tour run on frozen `ce2213c` timed out after 120 seconds
at tick 526, globally paused just after the declared late visitor physically joined
stop two. The failure JSON/a11y showed the host's ordinary viewing hold, zero
violations/page errors, and a disabled Direct host away button; no director walk
record had been admitted. Failed-first artifacts remain under
`viewer/e2e/artifacts/social-seed-ce2213c/gallery-short-{failure,result}` in the
root-owned frozen candidate.

Focused deterministic reproduction identified the concrete cause: the HUD's
`[-10,-8]` endpoint intersects `left-wall`, producing `route.goal-blocked` because
there is no standing room for the 0.34 m-radius actor. Admission and the disabled
control were correct; the authored destination was infeasible. The HUD now uses
`[-8,-8]`, which admits through ordinary walk planning from all three formed
stops. It also displays the real route diagnostic when direction is unavailable.
The Play assertion changes only the exact expected endpoint to `[-8,0,-8]`;
original timing, retained discussion comparisons, resource/identity checks and
other assertions remain unchanged. No engine planner, geometry, refusal or tour
semantics were changed.

A new focused Node regression reproduces Leave → named insufficient audience →
declared late Join at stop two, verifies the old wall endpoint still refuses,
then executes the new ordinary direction. It asserts exact paused clock/effects/
history, actual final host pose, persistent withdrawn visitor, explicit Resume,
two supported same-artifact history entries and final actor/slot/artwork claim
cleanup. Fourteen gallery checks pass in about 1.2 seconds, with zero violations.
Viewer TypeScript, focused type-aware lint, formatter and diff checks pass.

Repair work is isolated in `codex/gallery-direction-fix` from `ce2213c`; the
candidate being browser-tested was not modified. No browser/performance/full gate
ran for this repair. Root must integrate it and execute the unchanged strict
actual Play journey on a newly frozen source before claiming repaired visual proof.
