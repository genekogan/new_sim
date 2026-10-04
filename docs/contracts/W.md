# W-001 — recorded presentation and static scene baseline

Publisher: Core. Consumer: World; App consumes agreed public viewer controls.
Scope accepted by the three trunks/PM. This document and its structural schemas
are the code baseline; full consumer/stream conformance is separately qualified.
No transport, physics, history or renderer behavior is changed by these types.

## Current wire

Selected-world `/ws` uses PROTO=1 and sends welcome with world/rules/schema/dt,
serverTick/serverTime, clockRate, paused, build and process epoch. Epoch invalidates
ring-buffer sequence reuse. State hashes, replica hashes, take hashes and camera
track addresses identify different data; never substitute one for another.

The takes message is `{t:'takes',serverTick,chunks:[{fromTick,toTick,take}]}`.
`/v1/take?after=<absolute tick>` supplies the hot equivalent without `t`.
`/v1/takes?from=&to=&limit=` supplies durable chunks and nullable `next` cursor.
The history limit is clamped to 1–120. Producers finish a chunk each 20 ticks and
keep twelve hot chunks. Normal viewer depiction lags 30 ticks; that is not a
latency guarantee. Stored archive reads may return gaps; a gap is never a
permission to run a model or silently regenerate motion.

`fromTick`/`toTick`/`serverTick` and `take.startTick` are absolute world ticks.
`take.ticks` is duration. Pose samples, changes, events and removed-entry `t`
are relative to startTick. The chunk interval must match that origin/duration.
Endpoints can share a boundary tick; a reader must apply its documented interval
choice consistently. Seconds within a take are `(absoluteTick-startTick)*dt`.

Current producers emit `mars-take/4`. The shared structural decoder also accepts
synthetic /1–/3 shapes with /4 optional fields absent. This is shape compatibility,
not proof that an unavailable old physical rules implementation can replay logs.
Unknown take schemas fail explicitly; retained historical engine epochs remain
their own compatibility obligation.

`recordedTakeSchema`, `recordedTakeChunkSchema`, `recordedTakeStreamSchema` and
`recordedTakeHistorySchema` are exported from `@sim/protocol`. They validate
wire structure and chunk origins. They do not verify content hashes, physics,
entity/reference validity, authority, privacy or every temporal field bound.
Additive fields are preserved. Existing consumer helpers are not silently
replaced by the new structural decoder.

## Units and actual state

World geometry is metres, Y-up, x-z ground; yaw zero faces +X. Pose tracks store
integer millimetres and milliradians; hands are millimetres; speed is cm/s.
Five-component pose samples are `[relativeTick,x,y,z,yaw]`; pitch/roll use seven.
The native pure sample decoder converts them back to metres/radians/m/s.
Hands/speed are thinned/interpolated keyframes from /3; other discrete changes
hold their last value. `null` means a clear, not “ignore this update.”

The take contains id/provenance hashes, rulesVersion, dt/origin/duration,
tracks/changes/events/finalState and optional `entities0`/`removed`. /4 uses
first-seen entity data and removal ticks to draw an entity that is absent from
finalState at earlier historical ticks. Missing body identity defaults humanoid;
existing floater family/model/radius/hoverHeight remains explicit. Runtime action
events may compact same-tick lifecycle runs or repeated blocked waits.

Actual public fields include activity, attention, hands, phases, support,
baseActivity/on, speed, contents, plant/gardenCare/foodPreparation, sleep and
prone-state extensions. A label is not authority to invent gesture, grip, contact,
speech, consent or physical completion. Camera/render sampling is pure.

## Scene publication

`Engine.renderScene()` now names its existing `RenderScene` shape, including
optional clock and grass ground fields previously absent from the declared
signature. Runtime output is unchanged. `scenePublicationSchema` validates the
current envelope: scene bounds and array domains or null, optional decorative
buildings/kin, optional `{origin,dayTicks}` clock and optional grass ground.
Geometry remains engine-specific; inner traversal/contact codecs are not frozen
by this validator. Consumers retain defaults for omitted arrays/clock/ground.

`/v1/scene` is static-on-load today. It does not promise scene revisions at a
historic take tick. W-002 will version scene/body/action/terrain/water/support
semantics and applied-scene transitions with concrete fixtures; no future water
surface, dock or duck capability is advertised as shipped by this baseline.

## Privacy and proof

W contains public physical/presentation state. Owner words, journal, prompts,
provider credentials and fault recovery recipes do not cross W. Structural
validation is not redaction: Core must produce the permitted projection before
serialization. A public camera observes what is visible, without private thoughts.

Core fixtures: `apps/server/test/fixtures/w.ts` exports
`worldPresentationFixtures()`, using real factories/recorders and JSON delivery
for all four worlds. They include nonzero-origin retirement, humanoid/floater
identity, private owner markers and public scene/kernel/snapshot/log/takes.
They are isolated, no scheduled mind/provider, no filesystem DB. The real Souls
owner projection is present with empty `available_now` in this W fixture; actual
alignment/options are qualified separately in mandate tests.

`apps/server/src/contracts.test.ts` checks those producers, lifecycle sampling
without mutation, exact hand/speed quanta and null clears, synthetic older optional shapes
and explicit malformed/unknown refusal. The field-codec fixture is not proof of
a new hand/contact controller. World owns actual validChunks/chunkAt/viewer
sample/render assertions and stream/history gap/duplicate/epoch/memory bounds;
its own consumer handoff is required. Do not call these producer checks a full
browser or W-conformance pass.
