# Bounded supported sleep prototype — 2026-10-01

New source lives in `<mars-worktrees>/supported-sleep`, branch
`codex-supported-sleep`, starting at exact `084f492`. Local only; no remotes or
shared source edits. This is a prototype awaiting root integration and inspected
actual Play, not a released or visually accepted interaction.

## Proposed playable boundary

An explicitly free-handed person walks to one hypothetical rectangular ground
mat, lies on their stomach using the existing prone body helper, sleeps, rises
and optionally physically returns to an authored point. The actor anchor, ground
height and ordinary-ground support remain unchanged throughout lying/rising.
No bed, arbitrary support, climbing, paired pose, new rig, anatomy/IK framework
or new mover is introduced. Duration progress belongs to the purpose rather than
the animation; the engine publishes only normalized `standingFraction` (0 lying,
1 standing), and the renderer alone maps it to the existing prone helper's
0..3 coordinate. The 2.1-second lie/wake durations and support/motion are unchanged.

`sleep` retains duration, elapsed rest and `returnTo`. `sleep_control` takes
`{sleep: actionId, intent: 'pause'|'resume'|'end'}`. Pause and directed movement
first cancel the owned physical child, continuously wake while retaining its
actor/mat leases, then free those leases. Explicit Resume approaches from the
actual current position and completes only unfinished rest/return. Ending
terminates the purpose. `sleep_on_mat` is the internal physical action; its
approach uses ordinary `walk_to`. The purpose never globally claims the actor.

`readSleep` exposes mode, stable bindings, elapsed/remaining rest, child ownership
and named reasons. This prototype does not initiate computer work or mutate any
existing notes. Root's continuing-purpose UI can retain its existing exact
unfinished notes while this action owns sleep, then expose the ordinary return.
No autonomous schedule, recovery/need benefit, or active snapshot guarantee.

Mat configuration uses an existing hypothetical `work-area` region: level 0,
four rectangular corners, first edge defining body heading, length 3–4 m and
width 1.2–2 m. The authored sample is 3.2 by 1.4 m. Whole-body support requires
the entire convex lie/rise envelope to fit within one actual y=0 ground surface,
not merely the standing anchor. The conservative major-volume footprint is
3.0 by 1.2 m, local forward -1.85..1.15 m, through the full 1.8 m rise height.
Static OBB overlap and other human bodies are checked before approach and every
physical tick. A moved/removed mat, obstruction or support mismatch produces a
named blocked state rather than teleporting or releasing a prone actor. Owned
wake/cleanup resumes after the obstruction is remedied. Unsupported external
geometry edits inside an occupied body remain invalid; there is no magical
escape through the geometry.

## Exact small root integration

1. `world/types.ts`: add optional `sleepPose?: {mat: string; standingFraction: number}` to
   `HumanState`. The local module currently uses a structural extension so it
   can compile independently without editing root's shared file.
2. Registry/activity exports: register `SLEEP_ACTIONS` from
   `engine/activities/sleep.ts` and expose `readSleep`/types as appropriate.
3. `spatial/service.ts` `aroundObstacle`: if `sleepEnvelope(e)` is non-null,
   use that OBB instead of the standard person square. Preserve its ordinary
   foot/rise height band. This is a temporary person obstacle, never a scene
   contributor (the contributor cache does not track humans; a static self
   obstacle would also be wrong).
4. `walk.ts` `intrusion`: sleeping-person distance is `gapToSleep(o,to)`, with
   threshold `r + SLEEP_BODY_MARGIN`, compared against `gapToSleep(o,from)`; retain existing
   disc behavior for standing people. `hazardAhead` must use that same distance
   and threshold when probing a sleeping candidate, so approach/stop is smooth.
   Existing temporary replan grids then use the actual OBB from step 3. Check
   `occupant` as well if root's goal admissibility can otherwise select a point
   inside the sleep body. No altered traffic ownership or new route controller.
   `SLEEP_BODY_MARGIN` is explicitly **0.05 m**, preserving the existing human
   clearance margin rather than adopting the earlier proposed 0.03 m. Use the
   same closed-boundary comparison (`gap <= radius + margin`) in walking and
   safety checks, with the existing closer-than-from condition in intrusion.
5. `runtime/invariants.ts`: for a human with sleepPose, call the read-only
   `sleepSafetyIssue(rt,e)` and append its named issue. It checks the actual
   unchanged anchor/yaw/ground, free hands, whole support/static/body envelope
   and excludes the actor itself. The normal standing-disc invariant remains
   for other people. No static self obstacle or seated/climbing exemption.
6. `humans.ts`: import `sleepGoal`/`sleepHands` from new view module. In
   `proneGoal`, return `sleepGoal(e.human.sleepPose,e.pose.yaw)` before the
   construction-only `PRONE_ACTS` solver. The current `proneBody` already
   consumes its `ProneState`; keep that path. After body posing, add a small
   sleeping free-arm branch using `sleepHands(v.dims,pr)` transformed from
   forward/lateral/up into world coordinates, existing `armTo`/`reachTo`, an
   outward/up pole and existing `flatHand`. This avoids the construction/default
   dangle that can hang hands through the ground. These view targets must never
   be written into authoritative human.hands or hand claims. Palm/finger contact
   is bounded visual approximation; no anatomical certification.

Root must inspect actual Play at lie-down, sustained sleeping and wake-up for
both current human rigs before calling the envelope adequate or the feature
convincing. A severe rig-dependent contact failure should stop this prototype
and trigger the smaller real chair-nap alternative, not an animation redesign.
Root must also add an integrated walker-crossing test across head/feet outside
the old standing disc; the isolated branch intentionally leaves shared collision
adapters untouched and cannot claim ordinary walkers already honor this volume.

## Validation status

Focused `node --test engine/test/sleep.test.ts` completed **23/23** before the
historical owner's serialized validation freeze. It covered three mat headings,
actual approach/continuous rise/return, ten invalid cases including head-volume
obstruction, exclusive occupied mat through wake, Pause in lie/sleep/wake/return,
director handoff waiting for wake, End during approach, determinism, envelope
and numeric existing-prone adapter. No full engine suite, TypeScript gate, build,
GPU/browser or full gate was run by this worker. Node modules are a local ignored
symlink to the base checkout's existing installation.

Source-only follow-up after that run replaced sampled floor support with exact
convex containment, added moved-mat and actual-anchor/free-hands diagnostics and
propagated child blocked reasons. These changes need another focused test and
TypeScript/lint validation after root releases the slot; no green commit claim
until that succeeds. Three additional source-only cases now cover blocked Resume,
moved-mat wake retention/remedy and separated floor patches. The dedicated
fixture is explicitly hypothetical.

## Source-only corner/handoff correction

The pre-correction uncommitted snapshot of these five files is preserved at
`<mars-worktrees>/supported-sleep-source-backup-before-corner-fix`.
No tests, builds or TypeScript commands were run during this follow-up.

`gapToSleepEnvelope(obb, point)` is the shared exported Euclidean distance to the
closed full-body OBB. `gapToSleep(entity, point)` delegates to it for a sleeping
person. Ordinary standing people use the canonical `HUMAN_PROFILE.radius` disc
and collide when their gap is at most radius plus `SLEEP_BODY_MARGIN` (0.05 m).
Sleeping people use OBB-to-OBB overlap with that same explicit margin. The old
world-axis standing-person square could falsely overlap a rotated mat corner
when the canonical circular body was safely outside it. The authored yaw 0.63
regression demonstrates this old false positive, accepts the clear disc and
then explicitly refuses a closer disc that actually overlaps. No body threshold,
test tolerance or baseline was relaxed. Root's walker contact/hazard/goal checks
must use this same helper and exported margin; temporary routing rasterization
may remain conservative, but it must not certify overlap as safe.

Runtime calls `onDirective` before planning. A repeated direct `sleep_on_mat`
request therefore used to trigger drain even when its own admission refused.
The sleep purpose now explicitly ignores `sleep`, `sleep_on_mat` and
`sleep_control` admission in that handoff hook; they are sleep admission/control,
not independent direction. Their normal admission/resource checks still refuse
busy actors and duplicate purposes. `yieldTo` makes the physical sleep action a
pre-emptible hold, so runtime already declines same-social-verb pre-emption.
Actual independent walk/player direction retains the continuous wake handoff.
Source-only regressions cover both repeated sleep verbs plus premature Resume
and nonexistent control target, asserting the old posture/ownership/progress
remain intact after refusal.

There are now **30 authored cases**. The original 23/23 result predates these
source corrections and the normalized-field change; all current source awaits
fresh focused validation and root integration. No sleep main/deployment claim.


## Root recovery and visual bridge draft (not validated)

2026-10-01 recovered original5files by SHA into separate sleep-mvp based clean meal90fe830; originals remain untouched. Source-only core worker owns world/spatial/walk/invariant integration. Root adds normalized sleepPose recorder/replay propagation, existing prone body adapter and private free-palm contacts, two hypothetical mat presets with standard sleep/control/direction commands, detached HUD/readout/tour and a read-only mat display with explicit disposal. No engine hand/grip/actor/support mutation by renderer, new rig or animation library. No tests/typecheck/browser/build/gate on this sleep source during meal candidate validation. Actual body envelope/arms/continuity/replay and strict reset checks remain required; not shipped or visually accepted. Do not infer acceptance from older23tests or new source-only review. Stop/escalate if bounded existing rig cannot represent this interaction without repeated anatomy work.

Authored root acceptance adds2actualPlay browser definitions: woman/origin and casual/rotated using existing actor identity selection, ordinary same-purpose Pause/Resume/completion, rest/upright/return/replay captures, major torso/head/arm/leg ground clearance bounded at3cm (fingers/clothing excluded), exact3Reset geometry/texture equality.2real-action Node take/replay definitions compare normalized pose at each recorded rest/transition tick and cleared final state. Definitions have NOT executed, including typecheck; no acceptance claim. No fine anatomy tuning has occurred. Core source90dc5fd adds48unexecuted cases (30recovered/18integration). Source recovery hashes/artifact remain in ignored .cloudflare, all original drafts untouched.
