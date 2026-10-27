# Exact live Mars release fixture

`worlds/templates/unified-mars-live-proof-20261027.json` is a hidden operator-only creation fixture, generated from the public Mars snapshot captured before this tranche's pond and meaning patches. It is not a copy of a private database or a fresh Mars template.

- Source world: `my-mars-college-2026-3-1`, public edit sequence `169`.
- Frozen source digest: `da64a73026bebc281ce4a7a261144313bb29d48415e0ae7370736a93dddaa1f7`.
- Retained: 176 authored physical entities, original historical definition hashes, explicit root XYZ poses, parent/slot relationships, parameters, shapes, anchors, seeds, constraints, state and all world constants.
- Removed: the one engine Soul body and its descendants (none present). Account, owner, token, inbox, prayer, build and undo metadata are excluded by an explicit field allowlist.
- The two unnamed physical roots receive only stable clone names: `clone-anon-e_3229a61b` and `clone-anon-e_9fb8b273`. Entity IDs are regenerated normally.
- Physical digest after ordinary server-owned genesis creation: `b6c5de017f255cbbd534f1d6bfb15f2cad19355bc3f0a25f731ae20b116993c3`. Native comparison against the public source found zero physical or derived-ground differences.

Public template catalogs and ordinary world creation cannot select hidden fixtures. The existing direct-loopback operator create endpoint can select one, subject to its existing registered-owner checks. Create the proof world unlisted; do not remove or overwrite an existing world.

The fixture intentionally retains the source's historical sofa pose. Ordinary God CLI import was also exercised through the real HTTP God routes into an ephemeral memory world: it either refuses redefinition of historical core definitions or, with world-local definition aliases, applies a 0.15 m buildsafe sofa repair. Therefore ordinary CLI import is **not** claimed to produce exact geometry. Server-owned genesis is the supported exact initial-state path.

After release, apply the same reviewed pond and meaning batches to the new scratch world and live Mars through normal God operations. Re-read both public snapshots and verify non-Soul physical fields and meaning references before the Follow proof. This frozen fixture alone does not establish post-patch parity, and it must not be silently updated from a different source snapshot.

Offline generator and detailed proofs (not shipped): `team/scratch/unified-preflight-20261027/exact-live-clone/`. No live action was performed when generating this fixture.
