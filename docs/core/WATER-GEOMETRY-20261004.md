# Pinned shore water geometry

October 4, 2026. This is detached geometry for W002 physical work. It does not
install terrain or water in a world, admit an activity, move an actor or boat,
change canonical state, or publish a new take/API field.

## Inputs and producer

`createTerrainGeometryProbe().point()` reports a point, normal and grade on the
declared triangle bed, including its closed boundary. Outside points return
null geometry without extrapolation. Existing sweep and footing behavior stays
unchanged.

`createWaterGeometryProbe()` accepts a validated, copied single-layer bed, calm
constant water datum and closed rectangular wet domain contained in that bed.
A column is wet only inside the wet domain and where the datum exceeds the bed.
An optional vertical segment reports its intersection length with bed-to-datum;
its fraction is a segment fraction, not body volume or anatomical immersion.

An axis-aligned hull request supplies centre, half extents, draft and under-keel
margin. Clearance uses every intersecting bed triangle across the whole footprint,
including interior extrema. The lowest signed clearance must meet the supplied
margin. A footprint outside the water domain returns unresolved geometry rather
than a favourable centre sample. Yaw, swept routes and unknown permission fields
reject; semantic region labels do not override depth.

The producer at `apps/server/test/fixtures/water-geometry/generate.ts` verifies the
exact copied World shore input before generating geometry. Original World source
commit: `27879c144ef7716cd0238b5734a93d785e922950`; copied input at
`apps/server/test/fixtures/scene-placement/shore-world.v1.json`, SHA256
`69ac8401b8ff734f8d23acc8088d6e583d29a31d428a0a8f066cf700c85dfb3b`.
The probe explicitly interprets the proposed bed with diagonal
`min-min/max-max` and verifies the rectangular water polygon. It does not silently
generalize that proposal to arbitrary polygons.

Generated `apps/server/test/fixtures/water-geometry/shore-water-geometry.v1.json`:
5,544 bytes, SHA256
`e740efb2d3f44e6b91f524dfa9412227af423b51f029836f2b3cc11c07467dcc`.
It carries input provenance, five columns, three hull queries, and explicit
unresolved installation/physics fields. It is public proposal data, not a live
world capture or controller observation.

For the proposed yaw-zero hull at `[-4,7]`, half extents `[1.5,0.65]` metres and
draft `0.3` metres, whole-footprint depths are `[0.75,1.5]` metres and signed
keel clearances `[0.45,1.2]` metres. The supplied illustrative `0.1` metre margin
passes. At `[-1.5,7]`, centre depth is about `0.45` metres, but the footprint
touches depth zero and minimum keel clearance is `-0.3` metres: insufficient.
At `[-1.49,7]` the footprint leaves the water domain and ranges return null.
The margin is an input to this demonstration, not accepted boat safety policy.

## Verification and retained failure

Initial new native selection: 8/9 passed. The interior-ridge test incorrectly
placed corners where they were already shallower than its stated draft. Corrected
the synthetic query centre to `[1.3,1.3]` and half extents to `[0.6,0.6]`; all
corners and centre then exceed draft while the interior ridge still fails full
footprint clearance. The clearance implementation and threshold did not change.

After that correction, the focused combined selection passed 37/37:

```sh
node --test --test-concurrency=1 packages/engine-mars/src/water-geometry.test.ts packages/engine-mars/src/terrain.test.ts apps/server/src/terrain-geometry.test.ts apps/server/src/scene-candidate.test.ts apps/server/src/contracts.test.ts
```

After adding the exact polygon assertion and serialized producer fixture, the
changed paths passed 11/11 (nine native, two producer):

```sh
node --test --test-concurrency=1 packages/engine-mars/src/water-geometry.test.ts apps/server/src/water-geometry.test.ts
```

These checks cover actual shore values, both nonplanar bed triangles and boundary,
vertical segment clipping, interior ridge grounding, exact margin thresholds,
malformed/unknown input rejection, detached source/request/result mutation and
two fresh-process JSON reconstructions. Sixty-four detached queries leave actual
native greenfield state hash, snapshot, render base, rules and tick unchanged.
This is not a new recorder/take or installed-water replay test.

TypeScript checks passed for engine-contract, engine-mars and server. Existing
public world contract and terrain/candidate fixtures passed in the 37 selection;
the new water fixture contains no owner, principal, actor ID, swimming, admission
or canonical tick fields. Local model spend is zero; no live DB or service used.
These checks completed before the newly received single-heavy-slot protocol;
future heavy runs use its wrapper. No repeated unchanged suites are needed.

## Installation boundary and next physical work

Native navigation currently uses horizontal level grids; normal walking writes
level Y. This probe is not its support provider. Canonical terrain installation
needs a pinned topology/support revision, spatial/nav invalidation, whole-body
clearance and grade/step admission, durable snapshots/replay, and actual public
producer/World consumer evidence. Existing root/support approvals remain open.

Water activity additionally needs anatomy and body capability, contacts and shore
transitions. Boats need hydrostatics, obstacles, yaw and route sweeps, docked/moving
frames, connector claims and passenger occupancy. This service proves none of
those outcomes. No swimming/treading/boarding/pilot program is activated. W002
wire grammar, canonical scene/config/rules, snapshots and public takes stay as
they were. Exported geometry helpers are opt-in additions only.
