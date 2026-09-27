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
`chiba-flower-mural`, `chiba-entry-sign`. Plans/replays (SPEC §21, §25) should reference
pinned names, or hashed ids captured from the exact revision they were validated against.

## Legacy layouts

`app/history/id-migration.json` is a frozen map from every legacy serial id
(7,942 entries across 2020–2026) to its stable id, generated once by zipping the
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
