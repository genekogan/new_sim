# Installed native dry commons/1

Core supplies a real, isolated native scene for World's corrected garden commons.
A fake human-owned Soul arrives, sits on a usable bench, stands, climbs onto the
presentation deck and returns to the lawn. No renderer-owned movement or models
drive this journey. Existing Eden/default configuration remains Greenfield.

Source parent: `13d87b2c5736ad23f71bc09755fcd94428887138`.
World layout/physical proposal source: `9b6db72fc2dcf45a762d7ce8e4db0b71d0418ea8`.
Exact proposal SHA256: `8a20d529865951d4d5cb140bd78de8a753b8eacde2f5e76464fdee48b896343a`.
Source packet is in team/reviews/world-commons-physical-proposal-20261004.json;
all five placements, 79 parts, bounds, surfaces and clearances were read.
This installation uses explicit conservative physical envelopes, not all render
part boxes as universal colliders.

## Physical installation

`EDEN_COMMONS_WORLD` opts into `scene:'eden-commons'`, arrival `[14,4]`, reference
`[9,5]`. Native genesis creates the five fixtures and three regions; runtime
Spatial services install the static obstacles, levels, support surfaces and link.
The imported original scenes and historical configurations are unchanged.

| Object | Base-centred root / yaw | Native meaning |
|---|---|---|
| Pavilion | `[9,0,-5]` / 0 | Four .38m post envelopes through2.6m, overhead eaves/crossbeams/roof; open ground aisle |
| Platform | `[9,0,-1.8]` / 0 | 3×2m solid through.24m; supported deck level1 at.24m; explicit front low-climb link |
| West bench | `[6,0,3]` / π | 2×.65m footprint/.9m back envelope; three seats spaced.65m; native.45m seated-body convention |
| East bench | `[12,0,3]` / π | Same three seats; local+Z front rotates toward world−Z |
| Table | `[12,0,-5]` / 0 | Conservative1.4×.8×.75m walking box; six item support points at.75m |

Roof is overhead, not a solid ground footprint. Post envelopes conservatively
include feet/collars. Table overhang beyond pavilion east edge remains. Bench and
table voids/knee spaces are conservatively blocked for walking; they do not grant
ducking or body passage. Neither fixture exposes carry/move capabilities.

Both supplied1.4m corridors `[14,4]→[9,5]→[4,5]` retain at least.7m clearance
at101 samples per segment and actual native routes. Admission uses the unchanged
detached native placer and actual spawn, including existing human radius. Benches
use existing `sit`/`stand`/`gather` reservations and front approach, with fourth-seat
and duplicate-seat refusals. Table slots use existing `take_item`/`put_item` and
occupied-hand/occupied-slot refusals. Tests temporarily seed two native cups to
exercise these operations; the authored scene's table starts empty.

The platform is above ordinary.22m step height. Its canonical level1 surface and
one1m-wide explicit low `climb` link provide bidirectional continuous native
movement. The 3D path and both supported approach landings are pinned. This is
one authored low climb, not arbitrary climbing, slope projection or a ramp.
Coordinates keep the actor's current level; use the named `commons` ground
place to descend, `commons-deck` to ascend. No position or level is patched.

## W input and reconstruction

Exact runtime-free input:
`apps/server/test/fixtures/dry-commons/installed-commons.v1.json`,1,333,877 bytes,
SHA256 `47280a18bebe7a587e08dbe4da4f6d3b67ef30a300cba582fd4557639383fadf`.
Generator: sibling `generate-installed.ts`; producer checks:
`apps/server/src/installed-commons-fixture.test.ts`.

The public captured `scene.commons` carries version/source and exact five
kind/def/id/root/yaw placements inside the existing opaque scene description.
The strict typed `commonsSceneMetadataV1Schema` producer/consumer codec rejects
private/extra fields, non-finite roots and duplicate/missing placements.
Top-level capture/publication schemas remain unchanged. New catalog IDs require
a separate World consumer; generic renderer boxes are not visual acceptance.
World should depict these roots and original native activity/support, suppress
duplicate generic fixtures if needed, and never place the kit over the old
Greenfield capture or derive movement from the decorative corridors.

One fake ordinary invited human owns `s_commons`/`h_commons` in real ephemeral
SQLite. Actual canonical birth/mandate/five decision inputs drive1460 ticks:
arrival100, first sit320, deck arrival904, return1274. Native checkpoints at8
(walk),320(sit),838(climb-up),1129(climb-down) continue with identical hashes
at every subsequent tick through their respective220/720/1100/1460 endpoints.

All73 original20-tick take chunks through1460 and one content-addressed public
capture are published by actual anonymous Hono scene/take/capture requests,
HTTP200/no-store. Full SQLite graceful close/reopen checkpoint and bounded
inclusive genesis match body/kernel. Deleting only the ephemeral checkpoint also
exercises actual WorldHost genesis boot. Final body hash:
`c100b8fe1ac945db6bdd6f480e212f3f0c6a449621c193e547bed95741c0dfa5`;
kernel hash `234667a50a417e29705df5c9fd5847d00d7023c2174e69c86ca1cdefc6b7caaa`;
capture `07b4d1c81dce6a6dcbf9e66628029f0d70183b25dad704009d428c0f34ec96c0`.
Owner/mandate/journal markers are absent from public publications; paid0,
no native violations or recovery facts. DB/tmp resources are removed.

Canonical birth is at0 in initialSnapshot; first recorded take body is at1.
All1460 subsequent sampled native roots match the recorder within4.5mm on every
axis across chunk boundaries, sitting and ascent/descent. Original take IDs,
capture hashes and finite endpoints validate without a runtime. Do not backfill0.
The earlier e03 empty-field recording and four reviewed file hashes remain
unchanged and its bounded fixture tests still pass with the additive scene.

## Rules/history boundary

Only this scene adds `+commons/1` to native rules. History/restore accept its exact
rules/config/version/base; old factories refuse commons history before host
fallback. New factories refuse old history. Foreign or altered physical bases
cannot be stamped with commons rules. Snapshot stores commonsVersion and checks
the decoded restored world's native base/hash; legacy snapshots remain unchanged.

This is **not** an existing-world migration. A logged, versioned installation
transition with retained old capture/history and compatible rollback still needs
qualification before PM can activate Eden. A refusal and a source restart are
not a successful transition or an old-binary rollback. No station epoch is reset
or migrated by this work. Main/live/deploy remain held.

Actual genesis boot stops at the last logged event when no checkpoint exists.
The recording explicitly publishes ordinary clock rate1 at1460 to preserve its
observation boundary. Without that final event, the original generator failed
the host-genesis body comparison for the unlogged idle tail. That general replay
fault remains; this fixture does not claim arbitrary unlogged-head recovery.

## Validation and limitations

Final new7 checks PASS (native5 + publication/recording2). Earlier combined33 PASS
included affected native birth7/crew2/render captures6/history-policy9 and old
dry-recording2. After final strict base guards, new7 passed again. Server and native viewer TypeScript checks passed; adapter check first failed on
a test Vec2 inference and the shell Entity type omitting native item support.
Tests now use explicit Vec2/native Entity typing; corrected adapter check passed. All heavy jobs use the single team lease.
Initial native3/5 retained: wrong test route argument order and coordinate target
on the deck's current level; corrected against actual API/named ground place.
Generator initially rejected a snapshot because the added check expected a plain
world instead of native's encoded graph; now validates the decoded runtime.
Publication first5/7 failed because tests parsed the HTTP worldId envelope as a
bare strict capture; corrected using actual envelope semantics, not schema widening.

No mounted renderer/browser/mobile/real-owner proof, TCP/WS change, model/compiler
interpretation, agent activation, power-loss/multiprocess/day-long/retention proof,
generic terrain/water/swim/boats/dance/creature capability or migration grant.
Native item transfers are isolated physical tests, not owner-language UI proof.
The broader current-window Goal remains active after this bounded handoff.
