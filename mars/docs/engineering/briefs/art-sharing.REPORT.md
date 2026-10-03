> Parent verification update2026-10-02: actualPlay on61b236e passes all6
> combined sharing/creative/cleanup cases in2.0min; all30PNG and matching JSON/a11y
> inspected by helper, root personally inspects13representative images. No major
> support/continuity/clipping failure; sparse gestures/finefingers/off-frame events
> remain explicit. Read-only End label fix11cb5d6 passes stricter3/3Play recheck26.6s;
> root inspects all3new early-End readouts. Full combinedgate/publication pending.
> Music history readout inconsistency is being repaired separately before freeze.
> The original authoring-only statements below are dated provenance, superseded
> by this parent execution receipt, not claims of current missing evidence.

# Tangible art sharing — bounded implementation report

Source inheritance: isolated `codex/art-sharing` worktree from root checkpoint
`a711aaf` (`codex/activity-vocabulary`). Only the four assigned new paths changed.
No shared registry/catalog/renderer/Lab file, drawing implementation, historical
content, anatomy, rig, browser or camera file was changed.

## Physical and artifact contract

`art_sharing` binds an existing `drawing-pad`, one host and 2–4 declared visitors.
At least two visitors initially participate. Every active person walks with the
existing `take_slot` → `walk_to` mechanism to their declared ground stand/audience
slot, faces the actual pad within 0.18 rad and 0.65–1.8 m, and holds ordinary
`talk` or `listen` activity. Floor changes safely release/rebind those same
ordinary slot holds; this coordinator never changes body positions or headings.
All shared attention remains on the real retained artwork.

The pad must carry at least one completed retained mark from `drawing_work` and
be safely stopped (`unfinished` or `completed`) on its valid grounded table.
The sharing action holds the actual pad entity exclusively and its support table
shared. It neither picks up nor tilts the pad, erases marks, invents an output,
replaces physical equipment nor claims to reproduce historical participants.

Each completed comment/question/answer retains its actual actor, pad ID, seconds,
visible completed mark count and answer-to-question reference in the session
readout. Committed contribution counts and answers also remain on the pad's
primitive drawing equipment config. Drawing ticks, task/user/pencil provenance,
pose and support stay unchanged. Floor requests are queued behind the ongoing
bounded turn. Questions admit a subsequent answer; the default host/visitor
response is bound to that actual artifact question. Explicit answer controls may
choose another eligible responder. A second question waits until the current
question has been answered.

A leaving visitor releases their viewing hold and walks to an explicit valid
exit point through an independent ordinary directive. Session cleanup preserves
that directive. A player-directed visitor leaves only their membership; the
remaining host/viewer can continue. A directed host drains all owned physical
holds and requires explicit resume. Losing all visitors pauses discussion until
explicit resume/rejoin. No inactive/departed member remains a ghost floor holder.

Same-Runtime pause/resume preserves the current turn's exact elapsed time and all
completed effects. Resume validates the same artwork identity/marks/support and
free physical admission. Missing/unavailable/changed artwork drains all physical
holds and remains waiting for explicit repair/retry. End distinguishes an early
ended session (`finished: false`) from bounded completion (`finished: true`).
Active reload/save-load is not implemented or claimed.

## Integration API

`activities/art-sharing.ts` exports `ART_SHARING_ACTIONS`, `artSharing`,
`artSharingControl`, `ArtSharingParams`, `ArtSharingPlace`,
`ArtSharingControlParams`, `ArtSharingIntent`, `ArtSharingEffect`,
`readArtSharing(rt, session)` and `ArtSharingReadout`.

Main parameters:

```ts
{ pad, host: { actor, slot }, visitors: [{ actor, slot, join? }],
  duration?: number, turnSeconds?: number }
```

Defaults are 32 seconds of actual formed discussion and four seconds per turn.
An invited `join: false` visitor has a declared place but no physical actor/slot
hold until explicitly admitted. Controls:

```ts
{ session, intent: { kind: 'ask' | 'answer' | 'floor' | 'join', actor } }
{ session, intent: { kind: 'leave', actor, to: [x, z] } }
{ session, intent: { kind: 'pause' | 'resume' | 'end' } }
```

The detached readout includes session/status/mode, actual pad bindings,
artifact `{ id, pose, support, marks }`, `attentionTarget { entity, point }`,
floor holder, current turn, pending question, completed effects and per-role
participants. Participant facts include declared slot, active membership,
physical hold, ordinary departure, actual viewing/speaking and states
`invited`, `arriving`, `listening`, `speaking`, `paused`, `left`,
`directed-away`, `ended`. Mark arrays and effects are detached.

`scenarios/art-sharing.ts` exports `artSharingScene()`,
`artSharingWorld(premade = true)`, `artSharingBinding()`,
`artSharingRuntime(premade = true)`, `installArtSharingPlaces(world)`.
The scenario uses the existing `sketcher`, `sketch-pad`, `sketch-table` and
`sketch-pencil` IDs. `installArtSharingPlaces()` creates only hypothetical
real region layouts facing the existing pad and does not create marks.
Standalone default artwork is explicitly tagged `fixturePremade: true` with a
hypothetical pre-made task. For a real drawing → sharing routine, use
`artSharingWorld(false)` or install regions into the actual drawing world;
perform `drawing_work` first. Focused tests prove both full and safely interrupted
real drawing outputs feed this same sharing contract. The scenario registry
filters local extras against canonical entries to survive root wiring.

## Validation and limits

`node --test engine/test/art-sharing.test.ts`: 15 passing cases, zero failures,
skips or TODOs. Covers physical admission/heading/talk/listen holds; same marked
pad and retained discussion; detached facts; real drawing → completed/unfinished
art sharing; host/visitor questions, answers and floor requests; late join and
ordinary independent departure; visitor directive survival; host directive and
pause/resume; missing/wrong/blank/active/unavailable/unsupported artifact;
occupied and claimed places; wrong heading and named view blocker; rotated
table; refusal to silently rebind changed art; replay of world/action/events;
invalid controls; occupied late-join place; unavailable artifact repair; and
loss of all visitors followed by explicit resume/rejoin; and four visitors plus
the host forming five distinct physical viewing places. Drained cases assert
zero ENGINE_INVARIANTS violations and released physical holds. Viewer TypeScript
and focused oxlint over the three TypeScript files pass.

General practice provenance only:
`~/Mars/docs/archive/events/drawing-klerb-2024-01-12.md`. The scenario
uses anonymous fictional people, hypothetical staging/timings and a bounded
synthetic shelter study; no event reenactment, measured historical furniture,
natural-language dialogue, art criticism model or universal social planner.
Visibility is a bounded horizontal tabletop test excluding only the actual
support table; it is not eye/occlusion/anatomy simulation. Existing standing
slots own physical admission; no furniture precision redesign is required.

Root owns shared registration, renderer/Lab/camera readout integration, creative
Afternoon composition, browser proof, combined gate and any eventual release.
No browser, performance or full-gate run occurred in this worker. Initial focused
checks caught invalid helper assumptions (slot-region/entity ID collision and
viewer clearance), TypeScript narrowing issues and tests that asked during a
safe floor-rebind tick; all were corrected before the passing final checks.
No dependency installation, push or remote operation.
