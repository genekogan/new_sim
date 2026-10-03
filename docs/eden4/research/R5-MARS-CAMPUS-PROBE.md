# R5 — The Mars engine on the real 2026 campus

Mars commit at start and at end: `ad58b58 Fri Oct 2 11:49:56 2026 -0400` (unchanged during the probe).
Nothing in `~/Mars` or `<old-sim-repo>` was modified. Scripts (Node 26.8.2, Apple-silicon laptop,
one process at a time except where noted) are copied with their JSON outputs to
`eden4/research/_handoff/campus-scripts/`. Every number below names the script that produced it.

## 1. Geography

`g1-geography.ts`, `g1b-labels.ts`, `points.ts`. The file `viewer/public/engine/campus-2026.json` (1.42 MB) covers
x −162…96, z −147…69 (258 × 216 m), ground y = −0.16. It holds 9,497 static obstacles (4,657 solid, 3,104 fixture,
1,174 vehicle, 518 wall, 44 glass), 9 regions, and after `loadCampus2026` six generic people and no fixture entities.
There is one level (0, ground), one surface and **no links: no decks, stairs or walkable upper floors**; the 2,419
"upper" prisms are roofs and lofts, obstacles only. The 0.1 m grid is 2,580 × 2,160 = 5.57 M cells and takes 735 ms
to build. 53,408 m² is standable (clearance ≥ 0.34 m); all of it is one connected area except 27 cells.

| Region | Kind | Centroid | Area m² | Standable m² | Verified arrival point | Clearance |
|---|---|---|---|---|---|---|
| chiba | place | 0.00, −1.54 | 711.5 | 229.1 (32 %) | 0.45, −1.35 | 0.80 |
| north-workshops | place | −32.86, −69.68 | 590.8 | 316.2 (54 %) | −29.85, −67.95 | 0.81 |
| north-rack-building | place | 4.54, −83.28 | 63.7 | 4.0 (6 %) | 4.55, −77.95 | 0.85 |
| northeast-compound | place | 46.29, −88.87 | 320.1 | 145.4 (45 %) | 46.25, −88.85 | 1.16 |
| west-rack-building | place | −116.91, 0.30 | 569.7 | 409.3 (72 %) | −116.95, 0.25 | 0.80 |
| staging-east | staging | 28, −9 | 352 | 352 (100 %) | 27.95, −8.95 | 18.9 |
| pile-uprights / -beams / -timber | material-pile | 28,9 / 27,−26 / 15,−26 | 76 / 42 / 77 | 100 % | centroids | 5–12.7 |

All regions are level 0 with no audience `layout`. Place regions are convex hulls of building assemblies; the
other four are hypothetical clearings for the flagship build. Inside the hulls, roofed interiors are blocked:
Chiba's open ground is its east court (x 1…12, z −6…4) and an east lane. The 4 m ASCII map is printed by
`g1-geography.ts`; in short, Chiba sits at the origin, staging and the piles just east of it, the north workshops,
the Dojo (north rack building) and the Freeside/CoLab compound 70–100 m north, the west rack building (OG) 117 m west.

## 2. Movement

`g2-movement.ts`, `g2b-routes.ts`, `g6-spawn.ts`. All 30 ordered walks among the five place regions and staging, one
walker at a time, arrival point to arrival point: 30/30 planned and completed, 0 violations, end error 0.00 m.

| Measure | Value |
|---|---|
| Path length | avg 99.6 m, max 194.7 m (northeast ↔ west) |
| Length / straight line | avg 1.07, max 1.29 (Chiba → west, round Chiba's south side) |
| Smallest route clearance | 0.35 m |
| Ticks to arrive | avg 1,493 (75 s), max 2,902 (145 s); 1.28–1.34 m/s |
| `walk_to.plan`, exact planner | avg 56.9 ms, median 29.6, p95 209, worst 263 ms (908,573 expansions) |
| Corridor planner, longest route | 33 ms vs 144 ms exact, same length |

Routes go round buildings; none crosses a blocked footprint. Refusals seen: `route.goal-blocked` at the centroids of
north-workshops (blocked by `wood_component-1948`) and north-rack-building (`interior:wood_component-1902`) and
outside the bounds; `route.unknown-level` for level 1 or 2; `entity.unknown`; `action.invalid-params` (speed > 1.4);
and `route.search-limit` (4 M expansions, **1.2 s per plan**) for goals in cut-off pockets — the early
unreachability proof only runs on grids of ≤ 4 M cells. On a 1.49 M-cell crop the same goal is refused as
`route.unreachable` in 316 ms (`g6-spawn.ts`).

**Nobody can reach an upper level as the campus stands.** Upper levels exist only when a scenario builds them:
the flagship takes (`takes/flagship-campus-2026.json`, `build-bay-v3-campus-2026.json`) build a rack bay, deck and
stair at staging-east and end with a visitor on the deck (asserted in `test/campus-flagship.test.ts`, read, not run).
`climb_frame` was not tried: campus racks are static CAD prisms, not rack entities.

## 3. People

`g3-crowd.ts <N> <local|campus> 5 [planner]`: N people round six hubs, each walking again and again (2–8 s pauses)
to a random standable point — `local`: within 25 m of its own hub; `campus`: within 18 m of a random hub, so most
walks cross the campus. 5 simulated minutes = 6,000 ticks; the probe does not prune records or events.

| Measure | 25 local | 100 local | 200 local | 25 campus | 100 campus | 200 campus | 200 campus, corridor |
|---|---|---|---|---|---|---|---|
| Tick incl. submits, avg ms | 0.55 | 7.0 | 29.2 | 0.85 | 8.9 | 35.6 | 30.3 |
| Tick worst ms | 160 | 314 | 520 | 226 | 504 | 888 | 628 |
| Ticks > 50 ms (of 6,000) | 6 | 131 | 529 | 19 | 209 | 874 | 693 |
| Speed vs real time | 90× | 7.1× | 1.7× | 59× | 5.6× | 1.4× | 1.65× |
| `submit(walk_to)` avg / worst ms | 3.0 / 42 | 2.5 / 43 | 2.5 / 41 | 25.5 / 225 | 31 / 360 | 27 / 332 | 10.2 / 246 |
| Walks completed / failed | 290 / 0 | 1,043 / 0 | 1,889 / 0 | 109 / 0 | 358 / 0 | 607 / 0 | 557 / 0 |
| Violations | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Blocked person-ticks | 3.0 % | 10.6 % | 15.1 % | 1.4 % | 7.6 % | 15.4 % | 21.1 % |
| `deadlock.*` person-ticks | 0 | 0 | 743 | 0 | 51 | 2,028 | 44,806 |
| Blocked at the end | 0 | 7 | 36 | 0 | 11 | 43 | 66 |
| Records / events per sim. minute | 62 / 437 | 228 / 1,899 | 419 / 4,463 | 27 / 189 | 90 / 1,085 | 162 / 3,932 | 151 / 3,735 |
| World JSON | 10.6 kB | 30.9 kB | 58.5 kB | 10.6 kB | 31.4 kB | 59.5 kB | 59.5 kB |
| `stateHash()` avg ms | 1.0 | 2.1 | 3.4 | 1.2 | 2.4 | 2.2 | 2.5 |
| Snapshot size / take ms | 282 kB / 45 | 1.24 MB / 166 | 3.01 MB / 432 | 203 kB / 42 | 1.01 MB / 147 | 3.03 MB / 292 | 3.18 MB / 342 |
| Resident memory | 949 MB | 1.11 GB | 1.53 GB | 507 MB | 1.02 GB | 1.36 GB | 1.33 GB |

Restore (new Spatial + grid) took 900 ms (25) and 1,073 ms (200 local); both restored copies matched the original
hash after 1 and 201 ticks. Snapshots grow with the unpruned record/event history; the Sim adapter already prunes
events above 20,000 and records two minutes after they end, which will cut them.

The profiler (25 local) shows every tick over 50 ms is a people-replan: `spatial.gridsAround` copies the whole
campus rasters (~50 MB per copy, up to 8 cached), ~150 ms each, which also explains the memory. At 200 people the
average tick (29–36 ms) is over half the 50 ms budget and 9–15 % of ticks overrun it, so **real time holds to
roughly 100 people on the full grid**. Deadlock recovery reported stalls and cycles at 200 people but nobody
collided. The corridor planner cuts submit cost by 2.6× but produced far more `deadlock.stalled` time.

A person added the adapter's way (`human(id, x, z)` with no `y`, so y = 0 on a −0.16 campus) raises one
`motion.teleport` violation ("moved 0.16 m in one tick") when it first walks, then stays at −0.16
(`g6b-y0.ts`). Spawned at y = −0.16 there is none. A person placed inside an obstacle raises
`collision.human-static` every tick (`g4-furnish.ts`), so spawn points must be checked.

## 4. Furnishing

`g4-furnish.ts`, `g6-spawn.ts`, `g6b-y0.ts`.

**Usable fixtures with body slots:** `bench-6ft` (3 seats), `camp-chair` (1 seat), `campfire` (8 fire-circle places
on a 1.6 m ring), `speaker-lectern` (1 standing presenter place). Obstacle fixtures without body slots:
`table-6ft` (18 surface slots), `computer-workstation` (workstation capability, needs a chair), `standing-display`,
`garden-planter`, and construction stock bundles/stacks. `chess-board` and `chess-tray` are non-obstacle surfaces.

Placed: a campfire, two benches and two chairs in staging-east; a bench and table in Chiba's east court; a chair at
the northeast-compound arrival point (clearance 1.16 m).

| Test | Result |
|---|---|
| Fixture added to `world.entities` mid-run | picked up with no rebuild: `sp.epoch` 1 → 2, clearance at the table 18.8 → 0, a route through it re-routed (16.0 → 16.3 m, passes 1.96 m away), first sync 49 ms; removing it restored 18.8 |
| Fixture y = 0 instead of −0.16 | navigation identical; but the validating editor refuses it (below) |
| `sit` on `bench-n#seat1` | occupied after 387 ticks; second claim of the seat → `reservation.conflict`; `stand` releases it |
| `sit {fixture: chair}` (staging and the tight NE point) | both occupied |
| `campfire_circle`, 10 people | 8 occupied after 492 ticks; 2 failed `slot.none-free` |
| `gather {fixture: bench}`, 2 people | gathered after 342 ticks |
| `gather {region: 'chiba'}` | `slot.none` "region chiba (place) has no audience layout" |
| Same region given `layout: {focus: [6, −1]}` | gathers (slot `chiba#r7c13`, at 9.81, −7.62) in 182 ticks |
| New place region with layout over the fire (8 × 8 m) | 12 of 12 gathered in 511 ticks, 0 violations |
| `converse`, 3 people in Chiba's east lane | talking |
| `converse` at a point 0.6 m from a wall | `converse.clearance` |
| Violations in the furnished run (1,954 ticks) | none except a deliberately misplaced person |

`world.obstacleEdits` is read only when services are built: setting `{ 'wood_component-1948': null }` on a live
world changed nothing (still `route.goal-blocked`); a new Runtime built from the same world (986 ms) cleared the
cell and the centroid walk planned. The validating path, `api/edit.ts applyEdits`, behaves so:

| Edit | Result |
|---|---|
| `spawn` on the canonical world | `edit.inventory-finite` — needs `inventory: 'unlimited'` |
| `spawn campfire` at y −0.16 | ok |
| at y 0 | `edit.unsupported` (floor tolerance 0.05 m) |
| bench overlapping a CAD prism | `edit.blocked` |
| bench over the bounds | `edit.off-floor` |
| `region` with layout | ok |
| `static_add` wall | ok, lands in `obstacleEdits` |
| `static_remove wood_component-1948` | `edit.static-support` (it supports another piece) |

Each spawn/static edit costs 830–980 ms because `applyEdits` builds a fresh whole-campus Spatial.

**A furnishing file** should therefore be a list of `applyEdits` edits applied once at genesis: `spawn` ops
(`id`, catalog `def`, `pose {p: [x, −0.16, z], yaw}`), `region` ops for gathering places (polygon, `kind: 'place'`,
`layout {focus, spacing ≥ 0.7, rowGap ≥ 0.7}`), and optional `static_add/update/remove`. Constraints: inventory
must be `unlimited` for the edit (or the result kept with `finite` afterwards); y on the floor within 0.05 m;
footprint clear of every CAD prism and inside the bounds; seat yaw = entity yaw + π/2 with a free approach
0.35–0.5 m beyond the front edge; static edits need a Spatial rebuild (~1 s) and cannot remove supporting pieces.

## 5. Regions as places

`g5-regions.ts`, `g5b-subplaces.ts`, `g5c-reach.ts`. 40,000 uniform samples: 95.9 % standable; of those, **96.95 %
lie in no region** and 97.97 % in no place region; no point lies in two regions. The median distance from an
uncovered point to the nearest place region is 36 m (p90 73 m, max 137 m). The regions are islands, and two of five
place centroids cannot be stood on (`g6-spawn.ts`: the adapter's centroid walk is refused for both).

Finer names exist in the obstacles' assembly field (33 non-context assemblies). Standable ground and a reachable
arrival cell (clearance ≥ 0.6 m, all planned from staging):

| Sub-place | Standable m² | Arrival point | Plan |
|---|---|---|---|
| auditorium-2026-furnishings (Chiba) | 8.9 | 3.93, 0.95 | 26 m |
| mimos-home (lounge) | 3.1 | 3.84, −11.04 | 26 m |
| kitchen-details | 14.3 | −10.04, −12.42 | 54 m |
| dojo-2026-observed-interior | 0 | none | — |
| tool-2026-library | 59.5 | −28.88, −81.80 | 99 m |
| library-2026-front (Freeside) | 19.5 | 41.60, −92.56 | 90 m |
| freeside-2026-completed-enclosure | 22.8 | 43.23, −96.78 | 93 m |
| colab-huts-2026 | 540.8 | 71.62, −46.23 | 59 m |
| og-clubhouse-details | 1.2 | −109.88, −4.65 | 142 m |
| og-boat-details | 4.7 | −81.59, −17.87 | 112 m |

Places should be derived as: an explicit list, each with a verified arrival point (not a centroid), drawn from the
five place regions plus the reachable sub-assemblies above; the open ground between them stays "the grounds"; the
hypothetical piles are hidden; gathering places get their own small `layout` regions.

## 6. Existing content

| Source | What it is | What it needs to run here |
|---|---|---|
| `campus/world.ts` `flagshipInventory` | uprights, beams, timber in the three pile regions | `loadCampus2026(file)` default; carry/build registry |
| `scenarios/build-bay*.ts` (v1–v3), `test/campus-flagship.test.ts`, `campus-full.test.ts` | rack-bay build at staging-east; the only campus-native scenario; makes a walkable deck | `Site {origin, yaw, groundY}`, `buildBayRegistry()`, `BUILD_BAY_CONTRIBUTORS` in the Spatial |
| `public/engine/takes/flagship-campus-2026.json`, `build-bay-v3-campus-2026.json` | recorded takes (11,459 and 17,034 ticks, 0 violations) | playback only, not seeds |
| `scenarios/meal.ts` | table, fire, four chairs, four people | takes a `base` scene, but fixtures at y 0 and proving-ground coordinates |
| `build-bay` Site-placed, `preparation(x, z)`, `sleep groundSleepFixture(centre)`, `reading-circle`/`art-sharing` (region + layout pattern) | relocatable layouts | translating to a campus point and y −0.16 |
| Other 22 scenarios (classroom, design-studio, table-cleanup…) | own synthetic room scenes | rebuilt layouts; not portable as is |
| `campus-2020…2025.json` | other years: 18–48 place regions each (classroom, kitchen, cafe, presenter-station…) | `history-node loadCampusFile(year)`; same flat, unfurnished format |

None of these furnishes 2026 with seats, fires or tables; every furnishing must be authored.

## 7. Proposed adapter configuration and limits

The adapter's `MarsWorldConfig.scene` is `'proving-ground' | 'meal'` and `genesis`/`restore` are hard-wired to those,
so the campus needs a new branch (not written here):

```ts
const MARS_2026_CAMPUS = {
  scene: 'mars-2026',
  sceneFile: 'viewer/public/engine/campus-2026.json',      // loadCampus2026(file, { flagshipInventory: false })
  removeContextPeople: true,                               // the six generic people
  crop: [-50, -110, 60, 25] as [number, number, number, number], // 1.49 M cells, 562 ms build; excludes the west rack building
  planner: 'corridor' as const,                            // 2.6x cheaper submits on long walks
  groundY: -0.16,                                          // pass to human() on spawn
  arrival: [27.95, -8.95] as [number, number],             // staging-east, clearance 18.9 m
  arrivalPlace: 'staging-east',
  reference: [0.45, -1.35] as [number, number],            // Chiba court, for the spawn reachability check
  grounds: { id: 'campus', name: 'the Mars campus' },
  hideRegions: ['pile-uprights', 'pile-beams', 'pile-timber'],
  places: [                                                // explicit points, not centroids
    { id: 'chiba', name: 'Chiba', point: [0.45, -1.35] },
    { id: 'chiba-auditorium', name: 'Chiba auditorium', point: [3.93, 0.95] },
    { id: 'mimos', name: 'Mimos lounge', point: [3.84, -11.04] },
    { id: 'kitchen', name: 'Kitchen', point: [-10.04, -12.42] },
    { id: 'north-workshops', name: 'North workshops', point: [-29.85, -67.95] },
    { id: 'tool-library', name: 'Tool Camp library', point: [-28.88, -81.8] },
    { id: 'dojo', name: 'Dojo (outside)', point: [4.55, -77.95] },
    { id: 'freeside', name: 'Freeside', point: [41.6, -92.56] },
    { id: 'northeast-compound', name: 'Northeast compound', point: [46.25, -88.85] },
    { id: 'staging-east', name: 'The clearing', point: [27.95, -8.95] },
  ],
  furnishing: [                                            // applyEdits ops on an 'unlimited' fork, y = -0.16
    { op: 'spawn', id: 'fire', def: 'campfire', pose: { p: [28, -0.16, -9], yaw: 0 } },
    { op: 'spawn', id: 'bench-n', def: 'bench-6ft', pose: { p: [28, -0.16, -12.2], yaw: 0 } },
    { op: 'spawn', id: 'bench-s', def: 'bench-6ft', pose: { p: [28, -0.16, -5.8], yaw: Math.PI } },
    { op: 'spawn', id: 'chair-w', def: 'camp-chair', pose: { p: [24.8, -0.16, -9], yaw: Math.PI / 2 } },
    { op: 'spawn', id: 'court-bench', def: 'bench-6ft', pose: { p: [6, -0.16, -1], yaw: 0 } },
    { op: 'region', id: 'fire-circle', kind: 'place', polygon: [[24, -13], [32, -13], [32, -5], [24, -5]], layout: { focus: [28, -9], spacing: 1, rowGap: 0.8 } },
  ],
};
```

With the crop, the West rack building and CoLab huts drop out; including them means the full grid and its costs.

Engine limits, in the order they will bite:

1. **Re-planning round people copies whole-campus rasters**: ~150 ms per replan, up to 888 ms ticks and
   1–1.5 GB resident at 100–200 people; real time holds to about 100 people on the full grid (§3).
2. **Long exact plans cost 60–260 ms**, and the adapter plans 1–8 times before `submit` plans again.
3. **Unreachable goals stall 1.2 s** (`route.search-limit`) on the full grid; a crop under 4 M cells turns this into
   a 316 ms `route.unreachable`.
4. **Centroids are not arrival points**; regions cover 3 % of the ground; no region has a layout, so `gather` on a
   region fails until one is added.
5. **No fixtures at all**; furnishing goes through `applyEdits` (~1 s per spawn on the full campus) and must use
   y −0.16; the adapter's own y = 0 spawn raises `motion.teleport`.
6. **One flat level**: no stairs, decks or interiors; upper levels exist only if a build scenario makes them.
7. `obstacleEdits` and restores need a new Spatial: 0.9–1.1 s each.

## What did not work

- Walking to the north-workshops and north-rack-building centroids: `route.goal-blocked`.
- Any upper level: `route.unknown-level`; the scene has no links.
- Plans into cut-off pockets on the full grid: 1.2 s, `route.search-limit`.
- Editing `world.obstacleEdits` on a live world: no effect until services are rebuilt.
- Spawning a fixture at y = 0 through `applyEdits` (`edit.unsupported`), or at all on the canonical finite
  inventory (`edit.inventory-finite`); removing a supporting CAD piece (`edit.static-support`).
- `gather` on any campus region (no layout); `converse` beside a wall (`converse.clearance`).
- At 200 people: deadlock stalls (up to 44,806 person-ticks with the corridor planner) and 36–66 people still
  blocked at the end, though with zero violations.
- A shell quirk in the first batch run (zsh does not split `$a`) produced empty runs; they were re-run.
- Not run: `climb_frame`; the flagship build test; a crowd run on the cropped scene (`g3c-crowd-crop.ts` is ready).
