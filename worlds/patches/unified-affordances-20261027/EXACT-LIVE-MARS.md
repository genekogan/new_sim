# Exact live Mars fixture

`worlds/templates/unified-mars-live-proof-20261027.json` is a hidden (`"hidden": true`) operator-only genesis,
generated from a public snapshot of the live Mars world taken before the pond and meaning patches in this folder. It is
not a copy of a private database and not a fresh Mars template.

- Kept: all 176 authored physical entities, their original historical definition hashes, explicit root XYZ poses,
  parent/slot relationships, parameters, shapes, anchors, seeds, constraints, state and all world constants.
- Removed: Soul bodies and their descendants. Account, owner, token, inbox, prayer, build and undo metadata are excluded
  by an explicit field allowlist.
- Two unnamed physical roots get stable clone names (`clone-anon-e_3229a61b`, `clone-anon-e_9fb8b273`); entity IDs are
  regenerated normally.
- `tools/world-launcher/live-proof-template.test.mjs` pins the physical digest after ordinary server-owned genesis.

Template listings skip hidden templates (`tools/world-launcher/registry.mjs`), so ordinary world creation cannot select
it. The loopback operator create endpoint can, subject to its registered-owner checks. Create the proof world unlisted;
never remove or overwrite an existing world.

The fixture keeps the source's historical sofa pose. Ordinary God CLI import does **not** reproduce exact geometry: it
either refuses to redefine historical core definitions or, with world-local aliases, applies a 0.15 m buildsafe sofa
repair. Server-owned genesis is the supported exact path.

To compare with live Mars, apply the same reviewed pond and meaning batches to the new world and to live Mars through
normal God operations, then re-read both public snapshots and compare non-Soul physical fields and meaning references.
The frozen fixture alone does not establish post-patch parity, and it must never be updated from a different snapshot.
