# Reviewed live differences

These supplemental overlays cover existing live entities that the template overlays skip because of their exact physical
guard. Apply the ordinary template overlay first, then the supplement, passing the saved source snapshot to
`tools/meaning/live.mjs` (see [tools/meaning/README.md](../../../tools/meaning/README.md)). Existing custom meaning is
preserved. These are descriptions only; they do not reconcile geometry.

- `mars-two.json`: 19 blocks. Thirteen tabletop props have small local placement changes; five chairs use the live
  version-2 definition instead of the template's version 3, and the kitchen block depends on one of them. Seat anchors
  were checked against the live slots.
- `eden-2026.json`: 61 blocks. Twenty-three buildings omit the template's derived `plan.size` but keep the same room
  layout; the others have different settled heights at the same horizontal positions. Every named room and seat anchor
  was checked against the live model.

The Mars pond and Eden pier bench are absent here: they belong to the common physical fixtures
(`tools/meaning/fixtures.mjs`) and the ordinary template overlay. The pier description stays in the ordinary overlay
because its bench anchor needs that fixture first.

Each supplement pins `source.snapshotSha` to the exact public snapshot reviewed. Never update that hash to get past a
failed comparison: review the new physical differences and re-check the descriptions and anchors instead.
