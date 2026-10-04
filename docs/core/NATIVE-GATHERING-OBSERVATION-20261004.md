# Candidate native gathering observation

Optional `Engine.gatheringObservation()` supplies a strict, detached physical
observation. No server bootstrap, public HTTP/WS route, station selector, cue,
clock anchor or viewer is installed. This is a producer prerequisite for the
pending G003 clock/policy checkpoint, not its wire or adoption.

Revision `settled-native-gather-fixtures/1` recognizes native `gather` and
`campfire_circle` groups at a fixture only. A participant must have a live
executing `take_slot` child in `occupied` phase under a live executing parent in
`gathered` phase; be named in that parent; retain its current body task and actor
and slot claims; occupy the target's actual catalog slot on the matching level;
and be within 0.05 metres of that slot horizontally. Walking, waiting and seated
transition activities do not count. Different independent gather parents can
contribute distinct bodies to the same target. Program completion does not
erase a native physical hold that remains live.

`largestCommonTargetMembers` is the maximum distinct participant count at any
one qualifying fixture. `gathering` requires at least two; `ordinary` means no
qualifying gathering under this narrow revision, not that all forms of social
life are absent. Nearby idle bodies, direct seats, different targets, cancelled
groups, missing claims/tasks and departures cannot manufacture a gathering.

Region audience generation calls Spatial sync and may rebuild navigation.
Revision1 excludes it, rather than calling it inside an observation. Pure fixture
slots are memoized per target within a read. Conversations, music-gathering
sessions, new body families and broader social situations remain unqualified.
The helper scans retained records and reads active claims only when explicitly
called; no per-tick installation or performance/retention bound is proved.

The output contains exactly contract, source revision, canonical tick, actual dt,
rules version, situation and largest group count. It excludes actor, fixture,
slot, action, owner, Soul, intent, dialogue, labels and model data. Counting a
public physical group neither derives emotion nor admits a new activity. No
energy value or music piece is invented by this reader. App must disposition
this exact physical definition before using it for station selection.

## Exact native fixture

`apps/server/test/fixtures/gathering-observation/generate.ts` creates a real
native proving-ground engine with two explicit fake body/Soul associations.
It submits actual campfire gathering, steps to settlement, restores a native
checkpoint, directs one member to stand, then cancels the group. It uses no
owner DB, provider, model or browser; fake body association is not real human
ownership or cohort admission proof.

Generated `native-gathering.v1.json` in that directory is 2,836 bytes, SHA256
`ba1695e4a01cd876597d2a614f7efbbf6e41f777c8257e457f5dca2f43c2b5bc`.
Idle and admission at tick0 are ordinary/count0. Actual settlement at tick165
is gathering/count2; departure at166 is ordinary/count1, cancellation at166
ordinary/count0. Native snapshot restoration reproduces the settled observation
and state hash `1dbdb134f105c5be3fdbec2992aa66df0f00b7c6bc69a448ed9bfb088dc5e55a`.
The fixture exposes public observations and a checkpoint hash only; it is not
an anonymous network response or recorded cue lookup.

## Verification and failure

Initial native 0/7: the helper called the shell's `liveIds()` on the native
Runtime, which has `isActive()` instead. Corrected the native call; 7/7 passed.
Then producer plus changed default public W/G and scene-capture selection passed
12/12 (two new producer, four existing contracts, six scene/clock/recorder).

Source review identified regional slot generation's Spatial sync before a
regional read-only claim or release. Narrowed the source revision to fixtures
and added an actual regional negative test whose Spatial sync throws on access.
Final changed selection passed 10/10 (eight native plus two producer):

```sh
python3 <team>/ops/with-heavy-slot.py --owner Core --purpose fixture-only-gathering-check -- node --test --test-concurrency=1 packages/engine-mars/src/gathering-observation.test.ts apps/server/src/gathering-observation.test.ts
```

Checks include real idle/admitted/settled/departure phases, direct seats and
different-target negatives, independent body-language holds after completion,
current task/slot/position/status contradictions, actual regional exclusion,
strict private-field rejection and throwing private Soul/label getters. Repeated
reads preserve native state hash, full snapshot and render base. Native snapshot
restore and independent genesis command rerun match the observation and hashes
for a further25 ticks without models. This is native command reconstruction,
not server canonical-log replay or recorded station/take beat conformance.
A fresh producer subprocess reproduces exact JSON.

Contract/native/server TypeScript checks and normal source/diff/secret/hook review
accompany the commit. All new heavy checks use the shared wrapper; paid spend is
zero and no listener/live DB is used. Engine rules/state/snapshot/take grammar
and default programs remain unchanged. Regional read proof, broader social
definitions, actual cue durability/public transport and listener/World consumers
are separate next work, not claims from these checks.
