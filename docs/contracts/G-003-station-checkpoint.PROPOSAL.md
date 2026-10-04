# Joint station checkpoint recommendation

October4 Core recommendation for PM disposition. This combines the fully read
Core07fd0e clock draft, Appce28136 exact policy/function/tests, and World review
`team/reviews/world-station-proposal-20261004.md`. It is a candidate specification
proposal, not accepted wire, installed policy, audible radio or release authority.
Source counterpart hashes are recorded outside Git in
`team/reviews/core-station-counterparts-20261004.json`.

## Agreed direction for the isolated checkpoint

All three recommend simulation-tick beat with actual real-time anchors, finite
four-cycle performances, explicit pause/rate handling, historical lookup separate
from live state, and durable station identity separate from Hub transport epoch.
App's exact inactive policy selects Starfield60 for ordinary and Zoning Board108
for qualifying public gatherings; retains the current128-beat interval; changes
only after expiry; and never forces alternation. Energy is validated but unused.
The selector has App's reported nine pure passes; Core has read its full source
and tests, without independently executing or importing it.

Pin Score `3b806f2084d5dcefcf9a2282828765657bd74220`, reviewed App runtime
`154dda2dd66558394ebf43798845eea5676fade9`, Tone15.1.22, catalog
`score/3b806f2084d5dcefcf9a2282828765657bd74220/starfield-zoning/1`, and policy
`two-piece-public-gathering/1`. PM owns any dependency distribution. The current
preview lacks authoritative phase seeking, pause and rate support.

## Concrete Core public situation input

Core9a5d2e7 adds optional, inactive `Engine.gatheringObservation()` and actual
native producer fixture. Source revision `settled-native-gather-fixtures/1`
requires currently occupied, claimed fixture slots under live settled native
gather/campfire parents. Two bodies at one target qualify; proximity, private
intent, planned group activity, different targets and mere direct seats do not.
Current task, actor/slot claims, slot membership, level and physical position
corroborate the count. Separate native parents at the same fixture can contribute.

The actual native fixture is ordinary/count0 at admission0, gathering/count2
at settlement165, ordinary/count1 after actual departure166, then count0 on
cancellation. Native snapshot and independent genesis-command reconstruction
agree. Eight native/two producer checks passed; public default producer/recorder
checks remain separate. This is not canonical-log/cue replay or network/audio proof.

App should disposition this exact revision as the narrow selector source.
Regional audiences, conversations, richer music sessions and body families are
excluded. An engine without the observer is unsupported, not silently ordinary.
Do not infer broader social classification from `ordinary`. Do not synthesize
an emotion/energy estimate: for the first candidate explicitly use energy0 as
an unused neutral constant, or remove that field jointly. It is not measured
arousal. Selected piece is computed only on Core; clients consume it.

## Proposed exact interval, identity and transition rules

For allowed piece BPM and actual fixed engine dt, beat at a requested tick is
`(tick-startTick)*dt*BPM/60`. Valid interval is half-open `[0,128)` beats.
Integer expiry tick is `startTick + ceil(128*60/(BPM*dt))`; at dt0.05 this is
start+2560 for Starfield and start+1423 for Zoning Board. At a fractional drawn
tick, use the exact beat boundary, not the rounded expiry tick. If the next actual
committed cue begins later, the gap is silent; never extrapolate, repeat or use
the latest cue to fill a historical gap. A fresh performance, including the same
piece, gets a new cue identity/seed and starts from its actual committed tick.

The first durable station epoch is a recorded identity bound to the selected
world and its existing genesis identity. Restart, pause, seek, reconnect and
ordinary cue change preserve it. No station reset operation is exposed in this
checkpoint. A future reset needs an explicit recorded boundary and consumer
disposition. Cue sequence and anchor revision monotonically increase within
that world/epoch. Cue identity is a content address of immutable public cue
fields: contract, world/epoch/sequence, rules and pinned revisions, piece/seed,
situation source, start tick/dt and cycle count. Exclude the identity itself and
mutable clock anchors from that address; Core supplies a recorded uint32 seed.
No owner, request, actor,
private word, memory or model field participates in the public payload.

First checkpoint uses an explicit cut transition: previous cue ID, its exact
finite end tick (possibly fractional), next actual start tick, and fade-out/
fade-in lengths fixed to zero. This makes interval lookup and graph cleanup
unambiguous before qualifying fades. App must review audible tails/cut behavior;
nonzero crossfades are later separately measured, finite transitions. There is
no implied repeat after expiry or arbitrary nested transition object.

An anchor records revision, actual source tick, derived beat, server time sampled
for that tick, actual dt, clock rate and paused state. It cannot stamp a future
transition as already observed. A new recovered anchor follows restart before
audio resumes. Reject stale/out-of-order revisions without replacing a newer
accepted anchor. A current mixed world/epoch/catalog/policy, changed dt,
unsupported input or expired interval stops prior playback. Anchors
predict live scheduling only; subsequent actual tick samples reveal divergence.
Historical lookup keys world/rules/epoch and requested take tick, returning only
the appropriate recorded interval/anchors. It never changes the live station.

## Implementation and acceptance sequence

After joint disposition, implement a strict candidate codec plus pure canonical
and anchored phase projection. Preserve those exact source/catalog/policy/
situation revisions. Next implement named durable cue/anchor facts, a named
public fold, actual native host/SQLite producer and anonymous selected-world
GET/WS fixture. Replay snapshot and genesis with models disabled; compare cue
identity/seed/interval/anchors and prove private marker exclusion. Generic public
event fallback, automatic root installation and unqualified history rewriting
are not substitutes for these producers.

App then builds a separate station adapter: rate1-only first audible proof,
joining the current phase, stopping old audio on pause/unsupported rate/suspension,
resuming only with a fresh supported anchor. Two staggered mounted listeners
must compare composed note grid and retained state at current cycle; exercise
different-tempo transition, expiry, reconnect, late join and old-world cleanup.
Measure scheduling error separately from output latency, drift/corrections/tails
and resource growth. 50ms remains a hypothesis, not an acceptance threshold.

World consumes explicit beat for already permitted physical activity and proves
live/recorded pause/seek/late join/epoch mapping with exact fractional boundaries,
input immutability and occupied effectors unchanged. Seek or restart clears
display smoothing. A cue does not authorize dance, contact or body movement.

Four finite cycles do not establish persistent radio. Continued actual cue
production, broader situations, arbitrary rates, device/network behavior and
complete G003 remain gates. Installed terrain/support and swim/boat work proceeds
independently. Main/push/deploy remain held for Gene's explicit handover.
