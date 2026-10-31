# Campus scenes → engine `SpatialScene`

Code: `engine/campus/*`; extractors `mars/viewer/deploy/engine-scene.mjs` (the CAD-derived scene) and
`mars/viewer/deploy/history-scenes.mjs` (procedural year scenes); data `mars/viewer/public/engine/campus-<year>.json`;
tests `engine/test/campus*.test.ts`. Spec: [spec.md](spec.md) §4, §5, §21.

## API

```ts
// engine/campus/{node.ts (Node-only fs), world.ts, load.ts, history.ts}
const { base, world } = loadCampus2026(readCampus2026File());       // browser: fetch('/engine/campus-2026.json')
const local = cropScene(base, [x0, z0, x1, z1]);                    // work areas
const { canonical, flagship } = publishCampus2026(history, file);   // protected 'mars-2026' + 'mars-2026-flagship'
const { base: b, world: w } = loadCampusYear(2022, loadCampusFile(2022)); // browser: fetch(campusYearUrl(2022))
publishCampusYear(history, 2022, file);                             // protected 'mars-2022'; forkCampusYear to edit
```

- `base` is a `SpatialScene` usable by `Spatial`, `buildGrids` and `findRoute`. Each obstacle carries `component`
  (manifest `component_id`), `assembly` and `provenance`; regions and `meta.notes` are included.
- The 2026 `world` holds a few generic people in a staging area and, by default, a hypothetical construction inventory
  (`{ flagshipInventory: false }` leaves it out). `publishCampus2026` publishes the canonical workspace without the
  inventory and commits it on the `mars-2026-flagship` fork as a `design-edit`. Commits to a canonical workspace are
  refused (`HistoryError 'protected'`).
- `contentHash = hashOf(file minus contentHash)` equals `base.staticHash`. `--check` re-extracts and compares.

## Extraction (offline, deterministic)

1. Load the runtime GLB in Node (materials and images stripped) and join node extras with the components manifest to get
   assemblies.
2. Assign each mesh to its nearest ancestor with a `component_id` and gather its world triangles.
3. Per component (`engine/campus/extract.ts`, pure TS): clip triangles to the ground body band y ∈ [G+0.06, G+2.0]
   (G = −0.16); cluster by connectivity; fit a minimum-area OBB per cluster (splitting large, poorly filled L/U shapes);
   emit a prism with that footprint. Geometry above the band becomes `<id>.up[.k]` prisms (overhead, for cameras and upper
   levels). Covered space under building roofs emits `interior:<id>` prisms: unverified interiors are non-walkable by
   rule. Ids are `<component_id>` then `<component_id>.k`.
4. Kinds: `vehicle` (by CAD name), `glass` (transparent panels), `wall`, `fixture` (fittings, furniture, solar), `solid`.
5. Regions: one convex hull per building assembly; hypothetical staging and pile regions from a clear-rectangle search
   with a margin from every hull.

Procedural year scenes go through the same band pipeline: Node builds each year with the browser's kit code
(`createHistoricalScene`, bundled with esbuild, texture loads stubbed), and `Kit.finalize()` supplies stable component
ids ([history.md](history.md)). Same schema (`mars-campus-scene/1`) plus `year`.

**Site bearing.** `engine/env/sun.ts` holds the global `NORTH_AZIMUTH_OFFSET` and per-year values in
`YEAR_NORTH_AZIMUTH_OFFSET`; the year file carries `northAzimuthOffset` when set, and the sun model, camera and sky read
the scene's value. Bearing never moves a construction pin (`physicalView()` excludes the environment).

## What is walkable

- **Only the flat ground (level 0) is walkable** in extracted scenes: no levels, links or stairs. Unknown is never
  walkable; making a deck walkable needs explicit data and a hand-authored stair `Link` with provenance.
- **Building interiors are not walkable**: blocked by `interior:` prisms or by ground-floor decks above step height.
- Obstacles block if `y1 > level + 0.22` and `y0 < level + 1.8`; lower prisms stay in the data but are walk-over.
- The ground is a flat plane (provenance `provisional`).

## Provenance

| Thing | Origin | Confidence |
| --- | --- | --- |
| obstacle prisms | canonical | inferred (CAD geometry, not field-verified) |
| interior blockers | canonical | inferred, non-walkable by rule |
| ground surface | canonical | provisional |
| assembly regions | canonical | inferred (hull of prisms) |
| staging area, piles, inventory | design-edit | hypothetical |
| generic people | canonical | hypothetical |

## Performance and determinism

- A whole-campus 0.1 m grid build fits the ~1 s budget, but every construction change re-syncs, so interactive
  construction uses `cropScene` (about ±40 m).
- Cropped and uncropped runs end physically identical but not bit-identical: route vertices are snapped to cell centres
  measured from the grid origin, and the last-ulp differences later flip tick-level choices. Hashes are pinned per crop.

## Known gaps

- Prisms are OBBs fitted to render geometry: sloped or curved pieces are over-approximated, and nearby clusters of one
  component merge (conservative).
- No stairs, decks, doors or interiors in extracted scenes; procedural studio details that are not in the GLB are not
  extracted.
- Glass and plexiglass are indistinguishable; vehicle detection relies on CAD names.
- Staging and pile placement is algorithmic; re-extraction can move them, and the tests re-validate clearance.
- Rack members in the CAD scene are posts, not catalog frames.
