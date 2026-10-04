# Core review: World producer consumer and physical layout proposals

October 4, 2026. Reviewed exact World consumer `b13c4c74bc73d7506213a79f8ef18c3563460945`
and visual proposals `86dad3685d07f4819aacb048315f9e769e13d783`.
Source baseline `621af25689d50e1fd10ff9bd236d0d5c70e20e15`.

**Disposition:** accept the scoped W-001 source consumer work. Accept the Eden
32×24 m and arid Mars 88×72 m dimensions as design input, with the corrections
below. Neither layout is canonical physical data or a qualified activity yet.
No World file, manifest, cast, stock, scene, controller or live state changed.

## W-001 counterpart

World adopted only Core baseline eb1740d as 2c2a935, with provenance; prompt fix
18117e7 is explicitly absent from that tree. Inspected the actual validChunks
decoder adoption, gap tick correction and new producer→consumer test. Real
four-world JSON enters actual chunk selection, sampleTake, floater identity and
WorldGeometry. The tests exercise private marker separation, lifecycle removal,
pure repeat sampling, shared boundaries, deduplication, gap endpoints, bounded
windows and explicit malformed/unknown refusal. Optional historical shapes are
labelled synthetic, not old-engine replay.

World reports 21 web checks, two actual static component checks and web tsc
passed. Core reviewed their assertions without rerunning unchanged suites.
This closes the narrow baseline consumer seam; GPU/TakePeople rendering,
epoch/reconnect/archive/mounted App and complete W/G qualification remain open.
The component test proves Three geometry construction/disposal, not a GPU image.

## Eden terrain, shore and water

Arithmetic is reproduced by `node docs/core/review-world-fixtures.mjs` and saved
in WORLD-FIXTURE-REVIEW-20261004.json. It reads the exact Git blobs and verifies
the relevant catalog/registry sources still match baseline. It does not route
an actor or admit physical success.

| Quantity | Derived from the visual proposal | Meaning |
|---|---:|---|
| Terrain extent | 32×24 m, 33×25 vertices at 1 m spacing | Grid/bounds agree |
| Maximum continuous triangle grade | 0.30, 16.699° | Requires qualified slope movement/contact; not a 30 cm stair |
| Swimming cove depth | 1.5 m | Datum minus bed, pending wetted-domain/body policy |
| Wading entry | 0–1.2 m plus dry bank | Needs wet/dry clipping and explicit transition bands |
| Boat channel | 1.5 m | Depth alone is not route clearance |
| Dock basin | 0.6–1.5 m | Shallow end must be checked against hull/draft |
| Shore ramp | 4.5% downhill, 2.577° | End matches dry ground at [4,0.52,5] |

The grid is constant across Z. The supplied shoreline is only a line: define
a closed wet domain clipped by world bounds and `bed < datum`, explicit calm
flow, bed interpolation/triangle diagonal and boundary behavior. Positive-X
dry bank in the wading rectangle must not be labelled immersed. Controller
thresholds depend on supported body family/feet/height, not the rectangle name.

Current SpatialScene Surface/Level is horizontal. Do not flatten this proposal
into that codec and claim slope physics. Core's next physical extension needs
deterministic support height/normal, slope-qualified paths and stacked support
identity. Terrain under a dock remains bed; dock support has its own top plane.
Wet bed must not become unrestricted dry walking ground. General swimming and
boat verbs are absent from the current global registry; poses cannot add them.

## Dock and two-seat boat

At yaw zero, dock top is 0.7 m; the proposed boat tight-box top is 0.5 m and
keel -0.3 m. The hull footprint is X[-5.5,-2.5], Z[6.35,7.65]. Its minimum
box keel/bed gap is 0.45 m. These are arithmetic assumptions about centred boxes,
not a hydrostatic or swept-route result. World must distinguish the actual deck,
hull envelope, draft/freeboard and seat/foot/body anchor meanings.

The hull and dock boxes are disjoint by 0.35 m. Dock boarding point
[-4,0.7,5.7] to boat boarding point [-4,0.5,6.35] spans 0.65 m horizontally and
0.2 m vertically. The boat point is exactly at the hull edge, without standing
clearance. Existing HUMAN_PROFILE has radius 0.28/stepHeight 0.22 m; the small
vertical difference does not authorize an unsupported horizontal crossing.

**Request for World revision:** include an explicit dock→boat supported connector
or another reviewed boarding motion, inboard landings and swept body envelopes.
A provisional inboard landing at boat-local [0,0.4,-0.25] is 0.4 m from that edge.
It is design input, not an admitted point. With existing seats at local X±0.45,
that landing is only 0.515 m from either seat anchor, less than two 0.28 m discs.
One possible revision shifts seat anchors toward X±0.65 (0.696 m landing distance),
but actual seated/body/leg/grip envelopes must determine acceptance. Do not add
the same fixed ground route to a moving boat: landing/seat contacts are boat-local.

Core will validate a stopped/docked boat, supported connector, no conflicting
passenger occupancy, admission/version checks and atomic board/release/exit states.
Movement keeps passengers in the canonical boat frame; a scene transform must
not manufacture occupancy. Separate pilot/control capability from passenger
seating. Unsupported body/family/occupied-hand cases return a reason. No jumping
gap, swimming admission, two independent acceptances or rollback codec is proved
by this review. Route envelope/depth must hold through turns and docking; reserve
individual seats and the moving hull, not merely a region called boat channel.

## Mars upper floor, eight residents and pool

The upper-deck box centre Y=3/thickness 0.2 gives top Y=3.1. The proposed stair ends
at Y3.0 on the deck's Z15 edge. Set one shared support top: preferably retain
3.0 m as the intended floor and move visual box centre to 2.9, or revise the
stair/landing to 3.1. Give the landing an inboard footprint and body clearance;
an actor centre on the edge is insufficient. A provisional exit Z=15.4 has room
inside the deck, pending raster and carried-object validation. The stair's
original rise/run is 3/5 (grade 0.6); qualify it as stairs with actual step path,
heading, width, landings, guard/support geometry and carried-load restrictions.

The 88×72 m bounds and nonoverlapping named zones are useful. They do not define
walls/doors/arrivals/equipment/seat/mat placements, so eight-body circulation,
seat/sleep/admission and EUC route coverage are not proven. Eight human-owned
Soul identities require the existing explicit admission/assignment path; this
review births nobody. A 12×6 m pool gives 72 m² plan area, but no datum, basin depth,
rim/support/exit coordinates or fill quantity. Supply those plus two supported
exit proposals. A constructed pool is compatible with the arid design; it does
not imply a wet biome or water resource replenishment.

## Real material bill and lifetimes

For the existing qualified lookout template, the pinned manifest gives:

| Existing catalog component | One bay | Two copies |
|---|---:|---:|
| upright-8ft | 2 | 4 |
| beam-9ft | 4 | 8 |
| 2x4-6ft | 5 | 10 |
| plywood-4x6 | 2 | 4 |
| stair-flight-10 | 1 | 2 |
| stair-tread | 10 | 20 |
| Total | 24 | 48 |

Catalog mass for two copies sums 531 kg; catalog dimensions/masses include
authored/provisional estimates. Two copies
are a planning bill, not new genesis inventory or an approval of recovery ratios.
The proposed 96 m²/3 m upper floor is a different assembly: its frame spans,
supporting members, deck panels, stairs and fixtures need their own canonical bill.
The current build_lookout adapter binds one fixed bay and IDs; copying its stock
does not make another target buildable without parameterized blueprint/affordance
work. IDs and stock provenance must distinguish each actual part and assembly.

Repair stock is unspecified. Define the supported repair operations and recoverable
part/fastener/kerf losses before allocating it. Cut/bundle/offcut implementations
exist in source but **cut, take_from_bundle and stack_offcut are absent from the
pinned global registry** used by the live adapter. Do not assume raw-length or
bundle workflows work just because their files exist; register/qualify them in
an explicit action/rules revision, or start from existing individual catalog parts.

Installed components have persistent physical identity/support; this review
introduces no expiry, nightly reset, free refill or pose-only undo. Current
lookout construction has no registered reverse assembly verbs. Deconstruction
must first refuse/settle occupants and dependent loads, detach in valid reverse
dependency order, preserve recoverable part IDs/provenance and release supports
only when safe. Snapshots/replay must retain the exact intermediate states and
stock/material totals. Structural edits invalidate navigation and late admissions.

## Required physical publication and next work

Core's minimum authoritative W-002 data will bind sceneRevision/sourceHash/
appliedTick and rules/body versions to stable places/supports/water domains,
traversal contacts, moving frames/docks and occupant slots. Takes need the exact
scene revision for their displayed ticks; current static-on-load scene publication
cannot supply historic moving/rebuilt structure truth. Missing epochs fail
explicitly and old takes retain their qualified format/behavior.

Next: World revises the boxed surfaces/anchors/wet domain and missing Mars concrete
placements; Core implements/tests a small support/shore codec against that pin,
then actual slope/shore transitions, calm-water body state and dock/boat lifecycle.
No full controller redesign or wait for the asset long tail. PM still prioritizes
the responsive-intent/authority milestone; this analytic review supplies the
parallel physical seam without claiming admission, restart or renderer results.
