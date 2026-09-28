# Campus 2026 → engine SpatialScene (spec §4, §5, §21)

2026-09-27. Code `viewer/engine/campus/*`; extractor `viewer/deploy/engine-scene.mjs`; data
`viewer/public/engine/campus-2026.json` (0.98 MB, 132 KB gzip, committed); tests `engine/test/campus*.test.ts`.

## What you get
```ts
// engine/campus/{node.ts (Node-only fs), world.ts, load.ts}
const { base, world } = loadCampus2026(readCampus2026File());     // browser: fetch('/engine/campus-2026.json')
const local = cropScene(base, [x0, z0, x1, z1]);                  // ±40 m work areas
const { canonical, flagship } = publishCampus2026(history, file); // 'mars-2026' (protected) + 'mars-2026-flagship'
```
- `base` is a `SpatialScene` (usable by `Spatial`, `buildGrids`, `findRoute`). Each obstacle also carries
  `component` (manifest `component_id`), `assembly`, and `provenance`. Regions and `meta.notes` are included too.
- `world` is the canonical 2026 `WorldState` (`base.staticHash` = file `contentHash`). It holds 6 generic people
  in staging-east and, by default, the hypothetical flagship inventory. Pass `{ flagshipInventory: false }` to
  leave the inventory out.
- `publishCampus2026` publishes the canonical workspace without the inventory. It then forks
  `mars-2026-flagship` and commits the inventory there with cause `design-edit`. Commits to `mars-2026` are
  refused (`HistoryError 'protected'`). Use `forkCampus2026` for further workspaces.

## Method (offline, deterministic)
1. Load `public/browser/campus.glb` (the runtime GLB, meshopt) in Node. Materials and images are stripped, as in
   `deploy/catalog.mjs` and `nav-eval/lib/campus.mjs`. Join node extras with `public/modular/components.json`
   to get assemblies and `source_ancestors`. People, context groups, the aerial reference and reference-ground
   are skipped.
2. Each mesh is assigned to its nearest ancestor that has a `component_id`, and its world triangles are gathered.
   That gives 6436 components.
3. Per component (`engine/campus/extract.ts`, pure TS):
   - Triangles are clipped (Sutherland–Hodgman) to the **ground body band** y ∈ [G+0.06, G+2.0], with G = −0.16.
     Clipping matters because a 6 m post has vertices only at its ends.
   - Clipped triangles are grouped by connectivity: a triangle is internally connected, and triangles touching
     neighbouring 0.5 m cells join. Each cluster gets a **minimum-area OBB**. If a cluster is ≥ 6 m² and less
     than 60% filled (L/U-shaped meshes), it is split along its long axis, clipping polygons at the cut.
   - The result is a prism with the OBB footprint and y0..y1 = the component's span within/below the band.
   - Geometry above the band becomes `<id>.up[.k]` prisms (1 m clusters). These are overhead for ground
     walking and exist for camera and upper-level use.
   - `Roofs and upper floors` components of the five building assemblies also emit `interior:<id>[.k]` prisms
     from G to the roof underside. Covered space counts as an unverified interior, so it is **non-walkable
     by rule**.
   - Zero-thickness horizontal sheets get a 2 cm slab.
   - IDs: `<component_id>` for the first cluster, `<component_id>.k` for the rest. They are unique (tested).
4. Kinds:
   - `vehicle`: a source ancestor name matches bus/van/motorhome/Chevy/Mitsubishi… (school bus, L300
     motorhome, Chevy van).
   - `glass`: `transparent_panel` / Glazing. **Glass and plexiglass are not distinguishable**: material names
     are generic "Translucent_Glass_*" and none say acrylic or polycarbonate.
   - `wall`: Walls and screens.
   - `fixture`: fittings, furniture, solar.
   - `solid`: rack steel, timber, roofs.
   Counts: solid 2961, fixture 3123, vehicle 1145, wall 305, glass 44. Total 7578 prisms, of which 5707
   block the ground band, 1640 are `.up` and 152 are `interior:`.
5. Regions (`engine/campus/regions.ts`):
   - One convex hull per building assembly: chiba, north-workshops, north-rack-building, northeast-compound,
     west-rack-building. site-context is scattered, so it gets no hull.
   - Hypothetical regions come from a clear-rectangle search. It uses an integral image over the engine grid
     (0.25 m, crop around Chiba), an exact OBB check against every ground-blocking prism, and a ≥ 3 m gap from
     every assembly hull.
     - `staging-east`: 22×16 m, plus a 1 m clear margin, east (+x) of Chiba. Currently x 17…39, z −17…−1,
       about 8 m from Chiba's east face.
     - Piles: `pile-uprights` 8×9.5 m, `pile-beams` 6×7 m, `pile-timber` 11×7 m.
6. `contentHash = hashOf(file minus contentHash)`. `node deploy/engine-scene.mjs --check` re-extracts and
   compares; it matched on repeated runs. The extractor takes ~5 s: 0.5 s GLB load and 4.5 s extraction.

Frame: metres, Y up. North = −z (the north assemblies sit at z ≈ −60…−105) and east = +x, with the CAD
origin at X=177, Y=66. Bounds: x −162…96, z −147…69 (outermost object + 10 m).

## What is walkable, and why — LOUDLY
- **Only the flat ground (level 0, y = −0.16) is walkable.** There are no other levels, no links and no stairs.
- **Decks, upper floors and roofs are NOT walkable.** Nothing in the reconstruction identifies stair components
  or verified floor extents. Layer "Timber, floors and stairs" mixes all three, and the manifest itself says
  hidden partitions are unverified. Unknown ≠ walkable. Making a deck walkable needs explicit evidence plus a
  hand-authored stair `Link` with provenance.
- **Building interiors are NOT walkable.** Anything under a building roof or upper floor is blocked by
  `interior:` prisms. Ground-level floors above step height also block. Test: > 50% of Chiba's hull blocks
  walking; the remainder is courtyard/eaves gaps inside the convex hull.
- Obstacles use the engine's grid rules: they block if y1 > level+0.22 and y0 < level+1.8. Prisms lower than
  that stay in the data but are walk-over. The 8 components flush with the ground (top ≤ G+0.06) are dropped.
- The ground has no terrain: it is a flat plane (provenance `provisional`).

## Provenance
| Thing | origin | confidence | note |
| --- | --- | --- | --- |
| obstacle prisms | canonical | inferred (2 provisional) | "CAD geometry; visual correspondence, dimensions not field verified"; photo-estimated → provisional; evidence = GLB + component id |
| interior blockers | canonical | inferred | covered space, non-walkable by rule |
| ground surface | canonical | provisional | flat plane, no terrain model |
| assembly regions | canonical | inferred | hull of prisms |
| staging-east, piles | design-edit | hypothetical | flagship work area / "flagship scenario inventory, not historical" |
| inventory (35 items) | design-edit | hypothetical | 3×19 ft + 2×12 ft uprights (lying flat, height along +x), 8×12 ft + 4×9 ft beams, 12×12 ft 2x4, 6 plywood sheets; all `support: ground`, `phase: stored`, side by side with crew gaps (carry refuses stacked items) |
| 6 people | canonical | hypothetical | generic context people, not attendees |

## Numbers (M3 Max, Node 26)
Grid build (`buildGrids`, warm):

| area | 0.1 m | 0.15 m | 0.2 m |
| --- | --- | --- | --- |
| whole campus, 258×216 m | 460 ms, 5.6 M cells, ~84 MB | 218 ms, 2.5 M, ~37 MB | 130 ms, 1.4 M, ~29 MB |
| staging crop, ±40 m | 156 ms, 0.64 M, ~18 MB | 69 ms | 41 ms |

- Parsing the scene file takes 7 ms.
- The whole campus fits the ~1 s budget. But `Spatial.sync` rebuilds every time the world's construction
  changes, so interactive construction should use `cropScene` (±40 m, 0.1 m → ~150 ms per rebuild).

Routes (whole campus, 0.1 m, `HUMAN_PROFILE`), all ok: staging → west rack building 140 m (straight 130 m,
57 ms, 74 k expansions); → north workshops 71 m (12 ms); → northeast compound 64 m (27 ms); around Chiba N→S
70 m vs 65 m straight (24 ms); north workshops → north rack building 24 m (9 ms).
- Minimum clearance on these routes is 0.31 m.
- Crop: pile → staging takes 3–5 ms. The staging area fits a 4-person 19 ft carry formation at 16 headings,
  at its centre and its four inset corners (tested).

**Crop vs whole campus (`engine/test/campus-full.test.ts`, 2026-09-27).** The flagship on the uncropped scene
(7,578 obstacles) completes with 0 violations in ~15 s of compute vs ~5 s cropped (2,696 obstacles). It ends
physically identical (components bit-identical, people within 1e-12 m) but not bit-identical: final hash
`3a01328f…` vs `b159317e…`, 599.3 s vs 597.5 s simulated. Cause: route vertices snapped to cell centres are
`x0 + (i + 0.5)·cell` from the grid origin (−12 cropped, −162 full), so they differ in the last ulps (17.05 vs
17.05000000000001, first in carryA's gather routes), and the ulps later flip tick-level choices. Free cells match;
only clearance beyond the crop edge differs (the edge counts as blocked). Hashes are therefore pinned per crop.

## Known gaps
- Prisms are OBBs fitted to render geometry. Sloped or curved pieces are over-approximated, and parts of one
  component within 0.5 m of each other merge into one prism (conservative).
- No stairs, decks, doors or interiors. Chiba's kitchen/café details (`add2026Details`) and gallery screens
  are procedural in the studio and not in the GLB, so they are not extracted. Chiba's interior is blocked anyway.
- Glass vs plexiglass is unknown. Vehicle detection relies on CAD names; unnamed vehicles are `fixture`/`solid`.
- The placement of the staging area and piles is algorithmic (nearest clear area east of Chiba). It is not a
  site decision. Re-running the extractor after model changes can move them; the tests re-validate clearance.
- Rack members are CAD posts, not stock frames (AUDIT §2.4); they are not mapped to catalog uprights.

## Historical years 2020–2025 (procedural, spec §21)
Code `engine/campus/history{,-extract,-node}.ts`; extractor `viewer/deploy/history-scenes.mjs` (`--check`, optional
year args); data `public/engine/campus-<year>.json` (200–283 KB, 24–32 KB gzip each); tests `engine/test/campus-history.test.ts`.
```ts
const { base, world } = loadCampusYear(2022, loadCampusFile(2022));  // browser: fetch(campusYearUrl(2022))
publishCampusYear(history, 2022, file);  // protected 'mars-2022'; forkCampusYear(history, 2022, id, label) to edit
```
- **Method**: Node builds each year with the browser's Kit code (`createHistoricalScene`, esbuild bundle, texture
  loads/canvases stubbed as in `history-ids.test.mjs`). `Kit.finalize()` supplies the stable ids
  (HISTORY_IDS.md), so obstacle `component` = Kit id (pinned: 2021 `chiba-aluminet`, 2024 `chiba-flower-mural`).
  Each component's world triangles go through the 2026 band pipeline (clip to G+0.06…G+2.0, cluster, min-area OBB →
  `id`, `id.k`; above the band → `id.up…`). Same schema (`mars-campus-scene/1`), plus `year`; `source` names the scene.
  G = −0.16, the studio ground for every year. Run ~0.1 s per year. `contentHash` as in 2026.
- **Kinds**: rv-* trailers and vehicle parts → vehicle; glazing/translucent → glass; `Walls and screens` → wall;
  `Interior details` and solar → fixture; everything else solid. 2020 scrub (`site_context`) and people are skipped.
- **Confidence**: Kit `source` says "provisional", so 2021–25 are all `provisional`. 2020 groups say high → `inferred`,
  medium/low → `provisional`. `historyNotes[year]` is carried as the obstacle provenance note.
- **Walkable**: only the flat ground. The scenes draw decks, roofs and stairs, but declare no walkable surface, and
  unknown ≠ walkable, so there are no levels or links. Halls block through their ground-floor decks (top 0.41 m above
  G). No `interior:` prisms are needed: 65–100% of each Chiba hull blocks, and the rest is corridor/aisle ground.
- **walkNoCollision** meshes (stair risers, the 2021 aluminet and MARS letters) keep only their overhead `.up` part.
  So the 2021 corridor stays open at its south end, although the real cut-out letters stood there (caveat).
- **Regions**: one convex hull per Kit assembly (chiba, kitchen, east-house, …, each rv-N). There are no
  hypothetical staging areas or inventory: canonical worlds have no entities.
- **Numbers** (0.1 m grids, warm): 70–107 ms, 0.63–1.30 M cells per year. 2022 N→S around the courtyard: 33.1 m vs
  28.5 m straight, clearance 0.35. 2021 through the corridor: 34.0 m straight, clearance 2.15.
- **Wiring rooms** (`engine/api/seeds.ts`, not done here): publish each year with `publishCampusYear(h, y, file)` next
  to the proving ground. Node reads files with `loadCampusFile`. The DO/browser fetches `campusYearUrl(y)` from the
  release (`prepare.py` stages `engine/**`).
