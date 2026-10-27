# Reviewed live differences, 2026-10-27

These supplemental overlays cover existing live entities skipped by the template overlays' exact physical guard. Apply the ordinary template overlay first, then these with the saved source snapshot supplied to `tools/meaning/live.mjs`. Existing custom meaning is preserved. These are descriptions only; they do not reconcile geometry.

- `mars-two.json`: 19 blocks. Thirteen tabletop props have small local placement changes; five chairs use the live version-2 definition instead of the template's version 3. The kitchen block depends on one of those chairs. The text remains accurate, and its seat anchors were checked against the live slots.
- `eden-2026.json`: 61 blocks. Twenty-three buildings omit the template's derived `plan.size` while retaining the same room layout. The remaining buildings have different settled heights at the same horizontal positions. Every named room and seat anchor was checked against the live model.

The new Mars pond and Eden pier bench are intentionally absent here; they belong to the separately reviewed common physical fixtures and ordinary template overlay. The Eden pier's description also remains in the ordinary overlay because its bench anchor requires that fixture first.

Each supplemental overlay pins `source.snapshotSha` to the exact public snapshot reviewed. Do not update that hash to bypass a failed comparison: review new physical differences and re-check the descriptions and anchors. The public source snapshots and per-entity review notes are under `team/scratch/unified-preflight-20261027/live-meaning/` outside the Sim repository.

Validation: all 80 blocks and 36 parts compiled with no warnings, preserved physical entity fields, and produced no batches on a second plan. No live writes were performed during authorship.
