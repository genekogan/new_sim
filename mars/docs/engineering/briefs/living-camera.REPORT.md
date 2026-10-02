# Living activity camera review

Source audit starts from main `65cc0b8`. This is a bounded activity adapter over
the shipped camera policy, not a new camera engine or a released improvement.

## What currently works and what is missing

Live camera is explicitly available only for `classroom-4` and `classroom-8`.
`app/lab/camera-controls.tsx` hides controls elsewhere, and
`cinematography/lab-driver.ts` separately refuses non-classroom scenarios. Thus
prepared-day 4/8/studio has no live automatic coverage despite its existing
authoritative routine, preparation, sleep and continuation readouts.

The driver mirrors a fixed classroom world and updates only already-known human
IDs. Studio people, new living-world people and newly introduced fixtures cannot
be assumed to appear in that mirror. It updates the screen specially, rather
than observing all effective object poses. `Observer` follows classroom floor
semantics only; its standing/seated subject points do not describe ground sleep.
The richer recorded suite observes work directly, which does not prove live
coverage. Existing attention hooks already expose physical social attention.

## Reuse and boundaries

Retain `Director`, `feasibleShots`, `execute`, frozen observation schema and all
existing classroom behavior. Clear holds shots for four simulation seconds;
Restrained holds nine. Their switch thresholds are 0.65 and 1.1. Existing group,
speaker, questioner, speaker/display, pair, follow and context candidates suffice
for a first bounded day adapter. Continuous remains a distinct existing policy
with a persistent subject anchor; the UI currently exposes Clear and Restrained.

Current motion caps are translation 1.5 m/s, pan 60 degrees/s and FOV 5 degrees/s.
Safety can cause explicitly logged recovery/sweep/visibility cuts. Do not promise
uninterrupted camera movement or physically accurate lens behavior. Manual
pointer/wheel camera intent wins and lasts six **simulation** seconds; paused
time does not expire it. Escape or Return camera to auto releases immediately.
Keep those semantics unchanged. Camera must never move actors, hide blockers,
alter ownership or execute activities.

## Minimal interface proposal

Root supplies detached authoritative activity facts, not camera decisions:

```ts
cameraActivityReadout(): {
  activities: {
    id: string;
    actors: string[];
    phase: string;
    mode: string;
    status: string;
    focus?: string;
    objects?: string[];
    purpose?: string;
    waitingReason?: string;
  }[];
}
```

Existing routine/classroom/continuation hooks can supply these facts until the
living-intention readout exists. The adapter chooses salience deterministically:
actual gathering floor, companion walking, worker with preparation object, shared
meal participants, grounded sleeper/mat, original work and independent follow-up.
Pause/wait/recovery changes produce semantic edges; elapsed progress alone does
not churn semantic versions or editorial cuts. Idle context is explicitly bounded
to present actors rather than inventing an event.

Actual world subjects require a lightweight detached entity view (IDs, kind,
pose, human activity/optional sleepPose and existing entityCorners for objects),
or equivalent additions to existing readouts. Static fixtures/effective geometry
are already available; small pot/book items and sleepPose are not in the current
human state hook. Observe current entities, including unknown studio/newcomer IDs,
instead of constructing another fixed classroom or mutating a fake executor.

Approved owned paths: new `cinematography/activity-observation.ts` and its focused
test, narrow existing `cinematography/lab-driver.ts` and
`app/lab/camera-controls.tsx`, plus this report. Root owns other shared Lab hooks,
scenario/index/scene wiring and living intentions. No MP4, provider, rig/library,
save/load, full gate, deployment or main integration work is included.

## Source implementation checkpoint

`ActivityObserver` consumes the agreed detached entity/activity facts and emits
the existing observation schema. New IDs are collected from actual entities,
including item targets; invalid positions produce named diagnostics. Sleep target
points include the actual authored mat corners while lying, not a fabricated
standing head. Standing/seated human safety envelopes retain existing conservative
camera behavior. This is support-extent coverage, not anatomy/contact proof.

The driver delegates only the three prepared-day presets, `living-day-4`,
`living-day-studio`, `music-dance` and `garden-care` to this adapter. Missing new
hooks produce `camera.activity.readout-unavailable`; they do not silently fall back
to fixed classroom data. The existing classroom Observer path stays unchanged.
New activity controls offer Follow activity person using the current observation's
actual focus, with the existing six-second takeover/release behavior.

Six new adapter checks and 27 existing camera checks pass: **33 PASS, zero failures,
skips or TODOs** (470.3 ms combined). Cinematography TypeScript and scoped zero-warning
lint pass. These cover detached inputs, new actor/item identities, movement-only
semantic stability, pause/purpose/floor/wait edges, authored sleep support points,
deterministic finite Clear/Restrained decisions and manual pose precedence through
paused time, explicit release and six simulation-second expiry. No camera baseline,
policy, rig, authoritative activity or engine pin changed.

Root supplies optional `cameraEntities()` and `cameraActivityReadout()` hooks;
type exports are `CameraEntity`, `CameraActivityFact`, `ActivityObserver` and
`activityCameraScenario` from `cinematography/activity-observation.ts`.
Actual long-day browser evidence is pending root wiring and serialized slot release.

## Acceptance still required

Deterministic repeated observations/decisions, stable semantic versions on paused
or progress-only frames, finite valid poses, exact manual precedence/release,
unchanged authoritative state and preserved classroom tests. Actual longer-day
Play capture must follow serialized browser-slot authorization, include concurrent
commitments and interruption, and be personally inspected for useful natural
coverage rather than only counting shots. Focused source validation is complete;
combined integration, actual long-day coverage and release remain unproved.
