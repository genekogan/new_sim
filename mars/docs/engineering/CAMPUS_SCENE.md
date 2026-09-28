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

Frame: metres, Y up, with the CAD origin at X=177, Y=66. The assembly names ("north workshops" at z ≈ −60…−105)
suggest north = −z, but that is **about 57° off** the drone photos (W42, QUESTIONS_FOR_GENE A3 / Q22). Site bearing
per scene (A3), all one parcel:

| Scene | North in world | Confidence |
| --- | --- | --- |
| 2020 (studio-2020) | −X (`NORTH_AZIMUTH_OFFSET = −90`, `engine/env/sun.ts`; DJI_0079 shadows) | high |
| 2026 CAD (this file) | −X turned ~33° toward −Z (offset ≈ −57° ± 8°; DJI_0005, DJI_0098) | high |
| 2025 Kit | −Z (offset 0°) | medium (±20°) |
| 2024 Kit | Chiba fits −Z; kitchen + trailer ring on the wrong side of Chiba (Q21) | medium-high |
| 2022 Kit | **−X turned 11° toward +Z (offset −101, measured; W51)**; the pinwheel's handedness fixed by `shift` −2 (Q20 open for confirmation) | ±5° |
| 2021 / 2023 Kit | authored −Z, unverified | low |

**Per-year bearing (W51).** `engine/env/sun.ts YEAR_NORTH_AZIMUTH_OFFSET` holds the measured years (only 2022 = −101
so far); `deploy/history-scenes.mjs` writes it into the year file as the optional `northAzimuthOffset` (absent = the
global), `sceneFromFile` / `sceneFromYearFile` put it on `scene.meta`, and `solarPosition`, `sunDirectionVector`,
`worldHeadingOfAzimuth` and `sunBehindWindow` take it as an optional argument whose default is the global −90. The camera
(`directCamera`: sun, sun-behind windows, compass `side`) and the studio sky (`createEnvironment(…, {northAzimuthOffset})`)
use the scene's value. Every other scene still uses −90, so the 2026 sun and shadows are ~33° off until Q22 is measured. The site bearing never moves a construction pin (`physicalView()` excludes env). Bounds: x −162…96, z −147…69 (outermost object + 10 m).

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

### Chiba 2024 front: reconstruction edit, 2026-09-29 (W43, OWNER_FEEDBACK §15)
Evidence: `evidence/2024-chiba-facade-front-vertical-inset-stairs-plexiglass.webp` (1000 × 497 px, frontal, cropped,
lens unknown) and `evidence/2024-chiba-solarium-interior-plexiglass-roof.jpg`. Code: `app/history/photographic-corrections.ts
frontage2024` (called by `scenes.ts make2024`). Every new piece carries Kit `source` = "photo 2024 front / interior,
2026-09-29 (reconstruction-edit; provisional photographic fit)". **All measurements are provisional.**

**Before:** one leaning plane (29.7°, bottom 2.65 m proud of the frame front, top at the roof edge) carried the whole
front, and the two stair flights sat in a shear matrix that leaned with it.

**Measured (pixel reasoning):**
- **Scales.** The ground width is 953 px. Keeping 6 bays (21.95 m) gives ≈ 43.4 px/m at the flap bottoms. The door
  leaves (70 px) and the landing (88 px above the ground, at the upper-floor level) give ≈ 35–36 px/m at the inset.
  The outer flap edges converge by ≈ 10 % bottom→top, so the camera is ≈ 25 m away. The two scales disagree by ≈ 10 %,
  which suggests about 7 bays. The footprint is **kept at 6 bays**; see QUESTIONS_FOR_GENE **Q20**.
- **Inset width.** The red vertical panel between the flaps is 310→712 px = 402 px ≈ 9.26 m at the flap scale, so it
  is **2.5 bays (±4.572 m)**, centred on the door (door centre at 512 px, 0.25 m off the facade centre: noise).
- **Set-back.** The right flap's inner cheek shows ≈ 25–30 px at the bottom and tapers to 0 at the top. At ≈ 25 m and
  ≈ 5 m lateral offset that means ≈ 2.5–3 m of depth. So the inset sits in the frame-front plane (z = d/2), **2.65 m
  behind the flap bottoms**. At the top the left flap overlaps the mural panel (the PV rows reach 405 px against the
  mural's 336 px edge), so the flaps are in front of the inset at every height. That is consistent.
- **Flap angle.** A frontal photo cannot give it. The old 29.7° lean (from the Jan 29 oblique) is kept. The flaps'
  bottoms protrude 2.65 m past the inset; triangular **cheeks** at x = ±4.572 close them against it.
- **Door.** Sliding double door on a top track. The left leaf is yellow (461–493 px), the opening 493–535 px, the right
  leaf orange-red (535–564 px). At ≈ 39 px/m that is 0.75 m leaves and a 1.16 m opening. The yellow leaf is the existing
  piece (x −0.96); the orange leaf is added at +0.96.
- **Stairs.** Two straight flights parallel to the inset, from the ground at the outer ends (356 / 665 px) up to the
  landing above the door (444 / 580 px), in elevation at ≈ 45°. Modelled: run 2.6 m, rise 2.08 m, 12 risers
  (0.173 × 0.217 m), width 1.2 m against the wall. Landing 3.46 × 1.45 m, top 2.49 m (the upper-floor level), on two
  front posts, with a front rail at 3.45 m; the Chiba sign is on its fascia (1.97–2.54 m, photo 238–258 px).
- **Right flap (solarium roof).** Red base, slant 0–1.65 m. Then four glazed rows, whose left edge steps in toward the top
  (707 / 739 / 768 px):
  - row C, slant 1.65–3.2: one tall pane plus 2 × 4 panes;
  - row B, 3.2–4.3: 5 panes plus the painted eye pane (808–848 px);
  - row A, 4.3–5.25: 6 panes.
  The panes sit on a 2x4 lattice (22 mullions, 5 rails), per the interior photo. Material `plexiglass` (renderer-only:
  `plexiglass()`, opacity 0.3). The old salvaged windows and their opaque backing are removed, so the solarium is
  visible through the panes.
- **End wall + door.** The end wall is not in either photo; its position comes from Gene's §15 text. It is a plexiglass
  wall at x = +w/2 under the right flap, on 2x4 studs and rails. The door is next to the frame (dz 0.145–1.355 m, height
  0.22–2.22 m), the only place a 2 m door fits under the slope. See **Q21**.

**Door tagging (first door object in any year scene).** The leaf is the pinned `chiba-solarium-door`, Kit kind
`plexiglass door` (→ engine kind `glass`: collides, does not occlude). It stands **open 90° outwards**, so the opening
is a real gap in the rasters. The jambs and header are `solarium door jamb/header` (hashed). `userData.door =
{state:'open', swing:'out-90', hinge, opening:{x, z:[z0,z1], y:[y0,y1]}}` is on the Kit mesh only. The year-file schema
is unchanged, and the camera and walker rules are unchanged: openings are gaps (CAMERA_DIRECT.md §7).

**Walkability.** Unchanged rule. The hall's deck footprint still blocks (100 % of the 2024 hall interior at 0.25 m).
The solarium floor is ground level (sand in the interior photo), so walkers reach it through the door. Before the edit
they reached it through the open flap ends.

**Numbers** (`campus-history.test.ts`):
- walker, outside → solarium through the door: 5.5 m, clearance 0.55;
- camera navmesh at eye level through the door: 5.0 m; with the door closed, no route in a 16 × 14 m crop.

**Ids** (full Kit manifest, 1606 before / 1606 after):
- 1446 kept, including every non-Chiba id, the PV, the left clear strip, the yellow leaf, the frame, the decks and the
  upper stair;
- 160 replaced or added;
- pins `chiba-flower-mural` and `chiba-entry-sign` kept (moved onto the inset);
- `contentHash` c542f3fe… → d197e6ae….
Re-seed and migration: HISTORY_IDS.md "Reconstruction edits".

**Still differs from the photo:**
- width (Q20);
- the PV layout keeps its older 4 + 4 + 2 + 2 rows (the photo has 6 + 6 + 4 + 4 + a clear row, the top rows running
  to 405 px);
- the plexiglass is a flat translucent material, not the photo's sun-glare;
- the rack upright at x = 0 still stands in the front doorway (skeleton unchanged);
- the solarium floor next to the hall is the hall's plywood deck, where the interior photo shows sand;
- no tables, chairs or people inside;
- roof railings and the upper stair are unchanged.

### 2022 reconciliation + 2023/24 trailers: reconstruction edits, 2026-09-29 evening (W51)
Cause: Gene's questionnaire answers (OWNER_DECISIONS.md), planned in RECONCILIATION_2022.md (§a–§f, §i; its banner has
the per-section status). Evidence: `questions/photos/2022-aerial-03.jpg` (positions on a 5 m grid at 8.3 px/m, ±1.5 m),
`questions/photos/2022-DJI_0829.jpg` (bearing). Code: `scenes.ts make2022` / `ring(…, keepOut)`,
`photographic-corrections.ts stair2022 / solarRow2022 / TRAILERS_2022` (new pieces carry Kit `source` = the section).

**2022 legend: ids kept, names changed.** `chiba` = **Ba Sing Se** (east in the real compass), `east-house` =
**Cahuilla** (south), `kitchen` = **Chatsubo** (west), `west-house` = **Huaqiangbei** (north). No "Chiba" anywhere in
2022 (labels, regions, the studio's building button).
- **Pinwheel:** `shift` 3 → −2 (clockwise as both aerials). Ba Sing Se spans X −5.35…9.29 (photo −5.4…9.0); its stair
  end stands off Cahuilla's north end with a 1.0 m corner passage (the four passages are rotations of one another).
- **Stairs** (`stair2022`): in the end slot, treads PARALLEL to the house (12 × 3.54 m, going 0.25 m), 13 risers of
  0.192 m from the sand (y = 0) at the courtyard face, three stringers, a landing at the first-floor deck top (2.49 m)
  over the outer frame bay that reaches 0.6 m into the outer aisle, where one steps through the end-frame line (Q29
  default; Q32). The year files stay ground-only (no stair link); the year build's Kit-stair link needs W52's rule.
- **Solar** (`solarRow2022`): modules 1.65 m up a 45° slope on 2x4 triangle frames (base, north back prop, rafter; n + 1
  per row), facing the house side nearest the year's south (11° off true south), low edge on that edge of the roof deck.
  Huaqiangbei and Cahuilla one row of 10 along the house; Ba Sing Se three stepped rows of 3 across it (x −4.4 / −1.6 /
  1.2, z +0.45 / 0 / −0.45 in the rack frame); Chatsubo none (Q28 default).
- **Trailers:** rv-1…rv-5 the train on −X (T1 head, headings along the arc), rv-6…rv-9 scattered (rv-7 tarp box and
  rv-9 flat trailer uncertain); rv-10…12 removed. Nearest house ≥ 3.4 m.
- **Table** at the Huaqiangbei–Chatsubo corner removed (Q1).
- **Bearing** −101 (above).

**2023 / 2024 (Q2 answered):** `ring(k, n, rx, rz, cz, gap, {box: Chiba core, clear: 1})` leaves open the smallest
sector of the ellipse round Chiba whose edge trailer clears it by 1 m and spreads the same trailers over the two
remaining arcs. No trailer under Chiba; nearest wall 3.96 m (2023) / 3.45 m (2024); every trailer id kept (placement
hashed relative to the trailer). Chiba's interior grid is now exactly what it is without any trailer
(`campus-history.test.ts`); the existing rule still blocks through its ground-floor deck.

**Ids** (full Kit manifest): 2022 1204 → 1331, 999 kept (racks, decks, walls, rooms, rv-1…9), 205 gone (4 × 26 old stair
pieces, 3 × 20 solar pieces, the 5-piece table, rv-10…12 = 36), 332 new; 2023 1523 and 2024 1606, all kept. Migration
table: 2022 stair / solar entries aliased by role, 47 → `null` (HISTORY_IDS.md).
`contentHash`: 2022 8b88e6f0… → f8090a99…, 2023 8e401abb… → 883e6371…, 2024 832e8d9a… → bd2e0c79….
**Moves (planned):** the 2022 year-build pins and chapter takes (`todo`, old hashes kept); no construction pin outside
2022; perf-walk's 5 pins PIN-OK.

