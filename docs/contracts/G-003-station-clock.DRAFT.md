# G-003 concrete station and clock proposal

Core, October 4. Parent `47d79f6`. **Proposal for App/World/PM review, not
accepted wire or implemented station.** Existing G-003 scope is accepted; these
exact choices are still open. No client/root, Score source, dependency, API,
engine, schema or selection policy changes accompany this document.

The first station should make one shared, bounded performance audible to two
listeners and expose the same beat to permitted world activities. Its clock
must survive pause, dilation, restart and late join without recreating the intro
or pretending a seeded composer is already a synchronized player.

## Inputs and ownership

Use the reviewed App runtime `154dda2dd66558394ebf43798845eea5676fade9`,
Score source `3b806f2084d5dcefcf9a2282828765657bd74220` and frozen Tone15.1.22.
Exact handoff, preview declarations and composition adapter were read from Git.
The handoff's original missing-input statements are historical; subsequent
source/dependency/composition/local playback receipts remain separately accepted.

The pure adapter supplies `createComposition({pieceId,seed}).next()` and
`composeAt({pieceId,seed,cycle})`. Both reviewed pieces have four beats per bar,
eight bars per cycle: Starfield60 BPM/straight and Zoning Board108 BPM/swing0.62.
Composition carries sequential memory, rejects tempo changes and caps at64 cycles.
Replaying earlier cycles reconstructs composition; it does not start/seek audio.
The local preview API has start/stop/mute/volume/dispose, without authoritative
seek/rate/pause commands. The proposed station requires new App adapter work.

App owns the deterministic **piece selection policy**. Core owns the public
situation input, seed, durable station facts and clock anchors. World owns
depiction and contact envelopes. PM owns root distribution and integration.
There is no Houseband/local random/camera/selected-Soul/private-intent selector.

## Recommended clock: simulation beat with explicit real-time anchors

Propose a canonical beat derived from simulation ticks, and an audio scheduling
anchor stamped by Core. This lets a historical take reproduce the beat without
wall-clock access; pauses freeze the station and clock-rate changes retime audio.
It is a proposed product behavior, requiring App/World/PM agreement before code.

For a fixed piece started at `startTick`, before its bounded end:

```text
canonicalBeat(tick) = (tick - startTick) * dtSeconds * pieceBpm / 60
estimatedLiveBeat(serverMs) = anchorBeat
  + (serverMs - effectiveAtMs) * pieceBpm * clockRate / 60000
```

Clamp before-start to silence and after-end to expired. When paused, the live
estimate stays at anchorBeat. `dtSeconds` comes from the actual selected engine;
the existing native/take baseline is0.05. A new anchor is required for pause,
resume, user rate changes, dilation/recovery and restart before audible playback
resumes. Piece/seed/composition memory stay the same across clock anchors.
AnchorBeat must come from the actual canonical tick, not an accumulated client
estimate. The client estimates server time using existing welcome/pong timing,
then uses its audio clock to schedule notes. Local mute changes no world state.

Effective audio tempo is base piece BPM times world clockRate. This needs an
App adapter conformance test; the existing preview does not qualify it. At first,
unsupported/extreme rate or clock suspension must stop/dispose audibly and show
unavailable, preserving the cue for rejoin. Do not claim arbitrary-rate synthesis
or silently continue on another clock. A reviewed rate1-only first demonstration
is useful, while pause/rate transitions remain explicit unsupported gates.

Core's wall-time loop can stall without immediately logging dilation. Therefore
an anchor predicts phase; it is not proof every future tick happens on time.
Actual server-tick samples detect divergence. A measured correction threshold
must cause a bounded fade/rejoin to the current canonical phase, never a reset to
cycle0. Reanchoring policy, note tails and output latency need two-listener proof.
Do not publish a clock correction every tick as a substitute for measuring drift.

Alternative for review: a station that continues in real time while simulation
pauses. That would need separately logged beat-to-tick cuts for historical takes
and resume contacts; it should not be silently mixed into the recommended clock.
App/World should identify a concrete reason if that experience is preferable.

## Candidate public payload (field proposal)

| Field | Producer/meaning |
|---|---|
| `contract: sim.station/1`, `worldId` | Core; selected public world |
| `stationEpoch`, `cueId`, `cueSeq` | Durable Core identities; not Hub's ephemeral process/batch epoch |
| `rulesVersion` | Actual engine rules used at acceptance |
| `scoreRevision`, `adapterRevision`, `catalogRevision` | Exact agreed source/adapter/two-piece catalog identities |
| `pieceId`, `seed` | App policy chooses allowed piece on server; Core stamps uint32 seed |
| `situation`, `energy` | Small enum and0..1 value derived from explicit public actual observations |
| `startTick`, `cycleCount`, `endBeat` | Bounded interval; first proof4 cycles, at most64; endBeat32*cycleCount |
| `clock.revision`, `clock.sourceTick`, `clock.anchorBeat` | Monotonic durable anchor identity, actual tick and derived beat |
| `clock.effectiveAtMs`, `clock.dtSeconds`, `clock.clockRate`, `clock.paused` | Server real-time stamp and actual pace/pause, distinct from simulation tick |
| `transition` | Optional previous cue ID and agreed finite fade-out/fresh-start boundary |

Base BPM/meter/swing come from the pinned catalog, or appear redundantly only
with strict catalog equality checks. No arbitrary words, speaker/owner/principal/
request IDs, intent interpretations, memory or model prompts enter the payload.
Private details are not allowed even if a caller labels them a situation.

The public handler must explicitly whitelist every field. Unknown/private fields,
unsupported catalog/adapter revisions, invalid seed/ranges and wrong-world/epoch
inputs fail before playback. An unsupported cue stops stale playback rather than
falling back to the local piece widget. No new canonical event kind or generic
publicEvent fallback may be used until its strict named producer/reader exists.

Cue facts and clock revisions must replay with models disabled. Reboot preserves
the durable cue/seed; it publishes a fresh clock anchor at the recovered tick
before clients resume. Hub's process epoch only invalidates transport caches.
Historical lookup returns that cue's finite tick/beat interval and old anchors;
it never substitutes the latest station or applies a recorded seek to the live
world. At expiry the client fades/stops until an actual next cue exists. Do not
loop64 cycles or promise indefinite radio from the bounded composer.

## Exact selection input still needed from App

The reviewed handoff allows two pieces and expressly leaves culture/situation
assignment open. Its tags are metadata, not an accepted selection algorithm.
Core proposes a small deterministic input containing `worldId`, a reviewed world
profile, current **public** situation enum/energy and the previous cue. App should
specify the exact function, tie-breaks, minimum residence/transition condition,
catalog revision and unsupported-input behavior for this two-piece checkpoint.
Core then implements the server-owned policy with conformance fixtures.

First two-piece qualification can use an explicitly labeled trusted test selector
to exercise Starfield→Zoning Board. That demonstrates clock/transition transport;
it does not prove genuine situation selection. A production selector must use
actual whitelisted public observations. No new broad world ontology, private
purpose classifier, economy or per-Soul station is proposed here.

## First executable checkpoint after agreement

1. Strict candidate codec and pure tick/real-anchor projection. Reject unsupported
   input; replay finite intervals/anchors and derive historical beat without models.
2. Internal actual native host/SQLite producer, named public fold and anonymous
   GET/WS fixture. Compare snapshot/genesis cue identity and pause/rate/restart;
   verify private marker exclusion and preserve existing public takes.
3. App runs two mounted listeners at staggered joins against the same fixture:
   identical composed note/event grid and retained-state hashes, current cycle
   late join, different-tempo transition, suspension/reconnect and old-world cleanup.
   Audio gesture/local mute/volume/disposal remain App-owned.
4. World consumes the explicit beat reference only for an already allowed physical
   activity, then qualifies take/live pause/seek mapping. Music alone grants no
   dance/action/contact and changes no authoritative actor state.

Proposed measurement hypotheses, **not acceptance claims**: keep note-grid phase
within50ms at scheduling points under the declared local test network; measure
actual output latency separately. Record samples/max drift, packet/clock delays,
correction discontinuities and disposal/voice growth alongside the viewer.
App/PM should replace this threshold with a justified measured tolerance before
calling the experience synchronized. Device/battery and real network remain gates.

This document is a concrete coordination input. It does not claim a producer,
accepted wire, selected cultural policy, two audible listeners or G-003 completion.
Main/push/deploy/root adoption stay held for Gene's explicit handover.
