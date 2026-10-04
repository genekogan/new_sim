# W-002 local scene-placement candidate

October 4 Eastern. `core/scene-placement-candidate`, parent `0928a48`.
Candidate contract `scene-placement-candidate/1`; local proposal producer only.
No live scene field, canonical event, public endpoint, native controller or
renderer is changed. World/Core/PM consumer and installation review remain open.

`packages/engine-contract/src/scene-proposal.ts` supplies the precise types.
`apps/server/src/scene-candidate.ts` validates and produces detached JSON:

- Proposal reference: existing world ID, proposal ID/revision and bounded source
  file/commit/SHA-256 pins. These are provenance declarations; trusted installation
  must verify them independently. They are not a canonical scene revision or epoch.
- Terrain: proposed support ID, XZ origin, regular cell spacing, bounded rectangular
  heights and explicit min/min→max/max diagonal. Metres, +Y up. Both triangles
  supply deterministic height and an upward unit normal. Outside samples return
  no root; there is no extrapolation, horizontal flattening or slope admission.
- Placements: stable proposed IDs, the six existing World plant kinds, requested
  base position/size/yaw and optional unsigned32 seed. Originals stay unchanged.
  Roots within one millimetre of proposed terrain are `terrain-aligned`; others
  are `requires-support` with outside/height-mismatch evidence. Alignment is a
  geometric comparison, not an admitted body contact or obstruction clearance.
- Output stage is always `proposal-checked`. Obstruction policy and canonical
  installation remain unresolved for every candidate, including grass. Crown
  dimensions do not create climbing surfaces, trunk collisions or scene entities.

The preview bounds match World: coordinates within±10000m, size0..20m exclusive
at zero, grid2..129 per axis and batches≤512. Candidate cells are at least1mm,
avoiding unbounded numerical derivatives. Heights and full extents must be finite
and bounded; IDs must be unique. Unknown approval/authority/support claims and
malformed inputs are rejected rather than silently repaired. These are local
proposal limits, not new engine rules or a world ontology.

## Exact design input and proof

The public design fixtures under `apps/server/test/fixtures/scene-placement/`
contain two exact World JSON blobs and43 plant placements generated from World's
pinned pure `designHeightAt`/`shoreGardenPlants` functions. The generator excerpt
ran detached from its viewer class/imports; tests use self-contained fixtures and
do not depend on another trunk's current checkout. Source pins are recorded in
`source-pins.json`:

| Input | Commit | SHA-256 |
|---|---|---|
| Flat commons JSON | afa1c550dcf372b044304d45ce22713ba1102ded | 18436a40c9153f8385b46118a20537ae5a74ebfe593ee9a45c4348f2c09cfdd6 |
| Shore/dock JSON | 27879c144ef7716cd0238b5734a93d785e922950 | 69ac8401b8ff734f8d23acc8088d6e583d29a31d428a0a8f066cf700c85dfb3b |
| Shore garden source | d62f7a0aa2f05d4d8e621d4b7840464ed0d98eb0 | 3b49d5fd033e3cf66226cd172add9dd559898bac415e992dc0ad4db17373ce14 |

Generated43-plant JSON SHA-256:
`b46262eb545b548fa18a200565326419055d6381ee51490fa94ee36f29afe5bc`.
The fixture checks it explicitly; source declarations alone do not attest data.

All31 flat commons roots align on an explicitly authored preview plane. Of43
shore roots,35 align; eight garden-bed shrubs sit0.415m above terrain and remain
unbound pending named raised supports. No bed is invented from the decorative
mesh, and no root is lowered to fit the terrain. Trees/reeds/vines and every
remaining obstruction/resource/occupancy question stay with physical validation.

Seven local candidate checks pass: exact fixture pins, actual placement/root
distinction, both triangles and normals, boundary/outside behavior, malformed
inputs/duplicate IDs/unknown authority/unbounded batches, detached nonmutation
and reproducible JSON without actor/private/tick claims. Server/native TypeScript
and diff checks pass; fake local work, paid$0. First6/7 failed an exact comparison
between `hypot` and an analytic square root differing by one floating-point ULP;
the analytic-normal check now uses an explicit1e-14 tolerance. Reproducible
producer outputs still compare exactly. No physical or performance threshold was
changed, and the failed receipt remains recorded.

Run `node --test apps/server/src/scene-candidate.test.ts`.
The inherited atomic/private milestone111 and native construction4 proof is
separate. No unchanged broad/DJ rerun or full W-002 claim follows from these types.

## Next checkpoint

World can consume this exact candidate shape and review the source/geometry/root
agreement without guessing a canonical installation route. Supply named raised
bed/trellis supports and trunk/root obstruction envelopes separately. Core next
qualifies canonical scene revision-to-log/tick publication, support/topology and
placement validation, body route clearance, then shared terrain/water/boat/contact
controllers and Mars admission/resource binding. Existing scene/history/takes
remain unchanged until that explicit checkpoint. Scope agreement alone does not
qualify physical conformance. Main/push/deploy remain held for Gene's handover.
