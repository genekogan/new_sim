# Historical component IDs (2020–2025, plus 2026 procedural details)

Layouts, plans and replays address components by `component_id`. 2026 GLB ids (CAD
extras) were always stable; procedural pieces (`app/history/**`) used build-order
`${assembly}-${serial}`, so one insertion renumbered everything after it (AUDIT §0.6).
Fixed 2026-09-27.

## Scheme

`${assembly}-${kind}-${hash}` — e.g. `chiba-rack-upright-fd5a230a`.

- `assembly`: the `assembly_id` of the owning `Kit.assembly` group (`chiba`, `rv-7`, …).
- `kind`: slug of the definition name (`'12 foot orange beam'` → `12-foot-orange-beam`).
- `hash`: FNV-1a (8 hex) of `kind | placement`, where placement is the piece's transform
  relative to its assembly group: position quantised to 0.05 m, rotation-matrix entries
  to 0.0175 (about 1°). Rounding is off-centre (`floor(v/step + 0.5137)`) so round
  authored decimals never sit on a boundary where float noise could flip them.
- Two pieces with the same kind and quantised placement in one assembly get `-2`, `-3`, …
  in build order (none exist today). This is the only order-dependent case.
- Ids are assigned by `Kit.finalize()` after the scene is fully built (so later
  `rotation.y = …` tweaks count). Pieces removed after tagging get no id. 2020
  (`studio-2020/scene`) goes through the same `assignStableIds` in `tag2020`.
- Visitors keep `person-N`; assembly-group ids are unchanged.

Adding, removing or reordering *other* pieces never changes an id. Moving a piece
~2.5 cm, rotating it ~1°, or changing its kind/assembly does — pin a name if a plan needs it.

## Naming a piece explicitly (for plans)

```ts
k.named(k.box(g, 'Chiba entry sign', size, p, material, layers.wall), 'entry-sign');
// component_id === 'chiba-entry-sign', stable however the piece is moved or retyped
```

Names are slugged, must be unique per scene (duplicates throw), and are assigned before
hashed ids. Pinned today: 2021 `chiba-mars-letters`, `chiba-aluminet`; 2024
`chiba-flower-mural`, `chiba-entry-sign`, `chiba-solarium-door` (2026-09-29). Plans/replays (SPEC §21, §25) should reference
pinned names, or hashed ids captured from the exact revision they were validated against.

## Legacy layouts

`app/history/id-migration.json` is a frozen map from every legacy serial id
(7,942 entries across 2020–2026; 84 point at pieces removed by the 2024 reconstruction edit, below) to its stable id, generated once by zipping the
pre-change build with the new build in identical traversal order. Format:
`years[year][assembly] = {start, ids}`, where `ids[i]` is the suffix after
`${assembly}-` for legacy serial `start + i` (`null` = piece removed after tagging).

`validateLayout(data, baseline, stock, year, migration)` (`lib/layout.ts`) rewrites
legacy ids (including `copy:<id>` additions) before validating. Ids already in the
baseline pass through. A legacy-shaped id with no live target logs a warning and that
edit is dropped, so the rest of the layout still loads. The studio lazy-loads the table
on import; saves always write stable ids.

**Never regenerate the table** — the old build order no longer exists. If a scene edit
changes an id that the table targets, `deploy/history-ids.test.mjs` fails; add an alias
(point the entry at the new id) rather than rebuilding it.

**Tests:** `deploy/history-ids.test.mjs`: per-year determinism/uniqueness; a 2021 build with a dummy
injected as the first chiba piece (`KitHooks.assembly`) keeps every id; pins; live table
targets; migration, warn-and-drop and rejection paths through `validateLayout`.

## Reconstruction edits of a protected year (first: Chiba 2024 front, 2026-09-29)

A protected `mars-<year>` is re-published from `public/engine/campus-<year>.json` by every loader
(`publishCampusYear`; the year rooms too). So a reconstruction edit is a **re-seed**: change the Kit scene, then
regenerate the file. The edit's cause is recorded as a `reconstruction-edit` checkpoint (engine/history/store.ts).
Procedure:

1. Edit the Kit scene. Keep untouched pieces' kind and placement, including any parent group's transform, so their
   hashed ids survive. Pin a name for anything a plan should address. Tag new pieces with the evidence (Kit `source`).
2. `node deploy/history-scenes.mjs <year>`, then `--check` (all years deterministic).
3. `deploy/history-ids.test.mjs` names every legacy entry whose target vanished. Point each one at its successor
   (same role, build order: an **alias**). Set it to `null` when the piece no longer exists. Edit only that
   assembly's line; never regenerate the table.
4. `engine/test/campus-history.test.ts`: freeze the pre-edit `contentHash`. Prove that publishing a pre-edit
   canonical, forking it and committing the regenerated world with `{kind: 'reconstruction-edit', note, evidence}`
   gives the same `physicalHash` as `publishCampusYear` on the new file. Name kept and removed ids, and check that the
   year room still seeds.
5. Re-baseline the year's studio and lab captures, look at them, and record the edit in CAMPUS_SCENE.md.

**2024, 2026-09-29 (W43).** `contentHash` c542f3fe… → d197e6ae…. Full Kit manifest:
- 1446 of 1606 ids kept, including every non-Chiba id, the PV, the left clear strip, the yellow door leaf, the frame,
  the decks and the upper stair;
- 160 Chiba pieces replaced or added.
Migration table (`2024.chiba`):
- 76 entries aliased to successors: the stair treads, risers, rails and posts; the landing sheets; the two orange
  murals; the eye pane; the two leaning "painted frontage side" boxes → `left flap` / the right flap's base;
- 84 entries set to `null`: the 14 right-hand salvaged windows (backing, glazing, 4 frames each) no longer exist.
So the table now holds 7,858 live entries plus 93 nulls; 9 nulls predate this edit. `history-ids.test.mjs` asserts
both numbers.

**2022 / 2023 / 2024, 2026-09-29 evening (W51, RECONCILIATION_2022.md).** One re-seed per year; `contentHash` 2022
8b88e6f0… → f8090a99…, 2023 8e401abb… → 883e6371…, 2024 832e8d9a… → bd2e0c79… (`campus-history.test.ts` freezes the
three and proves pre-edit canonical + `reconstruction-edit` = the new canonical).
- 2022: 999 of 1204 ids kept, including every rack, deck, wall and room piece (the house groups moved with `shift`, so
  their placements inside the house are unchanged) and rv-1…rv-9 (moved; placements are relative to the trailer). The
  stairs and solar rows were re-made: their migration entries are aliased by role in build order (tread k → tread k,
  riser k → riser k, rails, posts, panel k → panel k, cells k → cells k); 47 entries → `null`: Ba Sing Se's 10th module
  (panel + cells), one surplus rail post per house (4), the corner table (top + 4 legs) and rv-10…rv-12 (12 pieces each).
- 2023 / 2024: every id kept (the ring's trailers moved out of Chiba; nothing aliased).
So the table now holds 7,811 live entries plus 140 nulls; `history-ids.test.mjs` asserts both numbers.
