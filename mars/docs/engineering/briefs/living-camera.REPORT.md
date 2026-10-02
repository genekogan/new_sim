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

Root hook review exposed three concrete gaps before browser validation: permanent
paused/waiting priority, absent object targets, and classroom excluded/presenter
semantics. Root owns object and participation normalization. The adapter now gives
an interruption edge at most four simulation seconds of elevated salience, then
places still-paused/waiting commitments below running activities. Authored delayed
starts also remain below active work. Existing editorial holds may defer or omit
a short edge; no cut/hold/manual policy is bypassed. Optional `presenter` and
`departing` fields retain the exact question pair and exclude withdrawn/missing
people from the active group. Eight new plus 27 existing camera checks pass:
**35 PASS, zero failures/skips/TODOs** (544.1 ms), including actual Director return
from paused/waiting actor A to busy actor B, exact questioner/presenter pair and
supported object target. Cinematography TypeScript and scoped lint pass.

## Acceptance still required

Deterministic repeated observations/decisions, stable semantic versions on paused
or progress-only frames, finite valid poses, exact manual precedence/release,
unchanged authoritative state and preserved classroom tests. Actual longer-day
Play capture must follow serialized browser-slot authorization, include concurrent
commitments and interruption, and be personally inspected for useful natural
coverage rather than only counting shots. Focused source validation is complete;
combined integration, actual long-day coverage and release remain unproved.

## First actual long-day camera attempt (2026-10-02)

Frozen integrated source `c20fc34`, ports 5404/8924, original Playwright configuration
and browser cache: two new actual Play proof cases reached notes, independent
reader interruption, talk, preparation and worker follow. Both failed the new
harness assertion requiring a fresh `source=operator` Decision (59.3/58.4 seconds).
The existing Director intentionally records only a changed selected shot, cut or
external decision; operator takeover of the already-selected worker retains the
same shot. Both personally inspected worker-follow PNGs show OPERATOR, and paused
authoritative hash/tick assertions passed. This is a harness false-negative, not
evidence warranting a Director change. The corrected check requires the actual
OPERATOR indicator, unchanged hash/tick, six simulation-second expiry to AUTO and
explicit release. Reports, diagnostics and final state are now retained in finally,
including on subsequent failure. Strict focused e2e TypeScript passes.

Original RED log is `viewer/.cloudflare/living-camera-c20fc34.log`; its two traces
were generated in the shared `viewer/test-results/` output, which the next native
run replaced. Those first traces are no longer retained; the original log and all
ten PNGs remain. Subsequent attempts use separately preserved ignored trace outputs.
All ten original PNGs in
`viewer/e2e/artifacts/living-camera-c20fc34/` were personally inspected via three
ignored contact sheets. Clear notes/worker shots are close, talk frames the host
without the display; Restrained talk shows audience/display, while its preparation
view leaves the pot/workers small. Both interruption captures cover other activity
after five simulation seconds. These are observed framing limitations, not a visual
quality acceptance claim. Sleep, concurrent music and completion remain unobserved;
the corrected full journey awaits the next exclusive browser slot. No camera policy,
baseline, world activity or geometry changed in response to this result.

Two later attempts still did not prove later camera coverage. The `c800958` run
was deliberately interrupted at a known impossible meal phase predicate: parent
routine forwards the real child phases `gathering`/`eating`/`stowing`, not `food-*`.
Native result: one INTERRUPTED, one NOT RUN, exit 130. Five PNGs and trace are
retained under `living-camera-c800958` and
`viewer/.cloudflare/living-camera-c800958-interrupted-traces/`.

The next `living-camera-meal-corrected` attempt used the correct active-child
identity and meal progress but wrongly required ActionRecord status `running`.
Actual ActionStatus is `executing` (distinct from routine mode `running`). Native
result: Mars timeout at 360 seconds, studio deliberately interrupted, exit 130;
zero PASS. The timeout's actual DOM shows the Mars day COMPLETED, notes 30/30,
meal 2/2 eaten, sleep 18/18, independent intentions completed and music 36/36
silent. This proves the impossible checkpoint missed the completed run, not a
camera or activity failure. It does not prove the missed camera views. Both traces
remain under `viewer/.cloudflare/living-camera-meal-corrected-traces/`; ten PNGs,
periodic partial camera reports and interruption markers remain in the matching
artifact run. Browser closure on timeout/SIGINT prevented final page reads; periodic
reports preserve the last captured stage but not final camera state. All fifteen
later PNGs were personally inspected, with framing limitations consistent with
the first run. No sleep/music/completion camera PNG exists yet.

The final owned harness uses exact `shared_food_break` child status `executing`,
real `gathering`/`eating` phase and actual served/consumed progress. Other waits were
checked against current API: living-day initial-work/completed, classroom presenting,
sleep mode sleeping, music-and-dance phase, reader elapsed and actual simulation
time. Strict focused TypeScript and zero-warning scoped lint pass; the Node types
reference matches other e2e files. Browser acceptance remains incomplete pending
the combined gate. Source camera policies, world authority and all existing
assertions/baselines are unchanged; no equal-priority rotation is justified yet.
