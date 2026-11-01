# Chiba tier seating layout, 2026-10-29

Prepared for coordinator-owned isolated-world confirmation. Five static native
use-checks and all 24 occupied seating orders with reverse exits pass with the
prospective `occupied-link-routing/1` policy. The earlier policy-off failure is
preserved in the private proof records (kept outside the repo); it is not erased by the repaired run. The release owner also verified the original semantic commands in the isolated
Mars server: presenter and all four original tier slots were simultaneously
seated. Visual support/aisle review and production application remain pending.
The initial verification script incorrectly compared an entity ID with a slot
ID; its raw output is retained alongside the corrected native slot proof in the
private records kept outside the repo.

This repairs the actual named cushion placements in the shipped, fully rotated
Mars two layout. It does not select replacement seats, reinterpret released
definitions, remove a collider, reduce body radii, or change stair links.

The original first-tier sitter occupied the approach to the unique tier 1→2
stair link. Clearing that sitter let the same second-tier request reach its
walking destination, where the native sit transition then refused: its endpoint
was 0.0583 m from Chiba `obj-2`, below the 0.14 m torso sweep radius. Both failures
and the causal clear/retry receipts remain in the development evidence owned by
the continuity coordinator.

`layout.json` pins the unchanged source definitions, Chiba mesh/footprint, and
original poses. Three real cushions move onto existing tread support east of the
central stair chain; the third tier and presenter stay in place. The seat-local
slots move with their depicted cushions. All four tier capabilities retain their
original native entity/slot targets.

| Fixture | Original world position | Repaired world position |
| --- | --- | --- |
| tier | -13.132, 0.742, -20.040 | -12.606, 0.742, -19.978 |
| tier-2 | -14.411, 1.123, -20.881 | -12.753, 1.123, -21.017 |
| tier-3 | -12.919, 1.504, -22.120 | unchanged |
| tier-4 | -14.241, 2.266, -23.984 | -13.181, 2.266, -24.062 |
| presenter-timber-box | -14.412, 0.373, -18.447 | unchanged |

All fixture yaw values remain -1.431 in the authored-world convention. The dev
world's native levels are 3, 4, 5, 7 and 0 respectively; fresh hosts can allocate
different numeric IDs. The proof preserves each source world's own level and
physical floor height. The first, second and fourth seat
anchors are approximately 1 m from the central stair chain. The exact compiled
measurements and five native use-check verdicts are emitted by the focused test.
Ground→first-tier has redundant generated entry links across the entire tread;
an occupied cushion can cover one redundant entry. We require the unique central
chain to remain clear and prove usable access with earlier occupants still
seated, rather than claiming every redundant link is empty.

## Build and pure verification

From the repository root, outside an active playtest window:

```sh
node worlds/patches/mars-chiba-seating-20261029/build.mjs
node --test worlds/patches/mars-chiba-seating-20261029/patch.test.mjs
CHIBA_PROOF_OUT=.local/chiba-seating/proof.json node --test worlds/patches/mars-chiba-seating-20261029/native.test.mjs
```

The builder adds one final move batch to `worlds/templates/mars-two.json`, without
rewriting previous bytes. It refuses changed source poses. The old base-campus
generator precedes the fidelity and rotation patches; run this final integrator
after those patches, not inside that earlier generator.

The native check boots the shipped template in memory with a fake, quiesced
brain; there is no listening server or model call. It reproduces the original
second-tier refusal, applies the guarded patch, checks all four tiers plus the
presenter with `useCheckV1`, measures tread and central-entry clearance, then
physically seats tier 1→2→3→4 with earlier occupants held in their original
seats. It proves reverse exits and verifies rollback. Each arrival/exit is bounded
at 900 engine ticks (45 simulated seconds). `CHIBA_ALL_ORDERS=1` extends this to
all 24 seating orders with reverse exits; use only if the focused run is cheap.
These are geometry regressions, not continuity A/B trials or soak acceptance.

The proof records (`proof.json` for the critical order and `proof-all-orders.json` for all 24
orders, both kept outside the repo; `CHIBA_PROOF_OUT` writes a fresh one) hold (96 physical arrivals and 96 reverse exits), five use-check verdicts,
source-code hashes and exact clearance measurements for those orders. Every arrival/exit passed
the predeclared 900-tick bound. Kernel regression tests separately retain the
policy-off wait, supported alternate-route recovery, six-attempt cap, snapshot
continuation, historical-policy absence and no mid-flight replanning.

## Existing-world apply and rollback

The runtime/release owner owns all world writes and the subsequent visual check.
First verify the prospective occupied-link policy has been accepted in that
world's journal. The layout and native policy are separate repairs; the layout
alone does not cure occupied-flight selection.
Do not move occupied fixtures. First stand/clear the three moving seats through
native actions and obtain fresh `bodyUsesV1` vacancy reads. `makePatch` accepts a
fresh public `world/1` authored snapshot and `{vacant: {tier:true, 'tier-2':true,
'tier-4':true}}`. It refuses wrong definitions/poses, ambiguous names, scaling,
schedules, and missing vacancy proof. It emits only three public `move` ops,
guarded by revisions of Chiba and the whole five-seat family. It never sends a
request or reads credentials.

For a coordinator-owned snapshot and vacancy JSON file:

```sh
node worlds/patches/mars-chiba-seating-20261029/build.mjs --snapshot SNAPSHOT.json VACANCY.json > PATCH.json
```

Apply only `PATCH.json`'s `batch` through the normal owner path. Preserve the
accepted receipt and verify the three resulting poses. `undo` names the public
group-undo route; alternatively, `rollback` contains the three inverse moves
with expected post-apply revisions, also guarding unchanged family/source
entities. Clear moving fixtures again before rollback. Any intervening authored
revision requires owner review rather than bypassing these guards.

Pending at initial preparation: root-owned native semantic receipt confirmation,
visual support/aisle review, and any release-owner live-world application.
