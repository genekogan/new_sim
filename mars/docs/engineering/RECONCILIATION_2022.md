# 2022 reconciliation: the work plan for Gene's questionnaire answers (W49, 2026-09-29 evening)

Source of truth: OWNER_DECISIONS.md, "(2026-09-29 evening, Gene — questionnaire answers)". The answers are also on the
`Gene:` lines of QUESTIONS_FOR_GENE.md (Q1–Q14, Q19; Q3 correction). This file is a **plan**: nothing here is built
yet. Every hour figure is a **labelled estimate**. Every photo measurement is a pixel pick by eye, with its error
stated. Model facts are read-only reads of `viewer/app/history/scenes.ts` (`make2022`, `ring`, `hall`), `kit.ts`, and
YEAR_BUILD.md / FRAMING.md / SOLAR_PAINT.md / HISTORY_IDS.md at head `8a05fa3`.

Pictures (made by `questions/tools/reconcile2022.py`):
- `questions/r2022-aerial-annotated.jpg`: aerial-03 with the names, stairs (hatch = tread direction), solar rows,
  trailers T1–T9 (T1–T5 = the train) and both north arrows.
- `questions/r2022-names-model-vs-photo.jpg`: the model's top-down (`q20-2022-top.jpg`) with the new names, next to the
  photo.

![names, model vs photo](questions/r2022-names-model-vs-photo.jpg)

## Photo frame and scale (used by every section)
- **aerial-03** (`questions/photos/2022-aerial-03.jpg`, 1200×675, near-nadir, no telemetry, provenance not recorded).
  It is roughly aligned with the model's top-down frame (screen up = world −Z, right = +X): each of the four houses sits
  in the same quadrant in both.
- **Scale ≈ 8.3 px/m**, from Huaqiangbei's 3-bay body (91 px = 3 × 12 ft = 10.97 m). The error is about ±10 %, and a
  1 px pick is ±0.12 m. Photo → model: `X = (px − 545)/8.3`, `Z = (py − 345)/8.3`, with origin = courtyard centre
  (545, 345) = the model's `make2022` origin. These are photo-fit numbers, not a survey.
- **DJI_0829**, turned north-up by its logged FlightYaw 110.2° (as `questions/tools/axis.py` does), is the cross-check
  for names, panels and north.

## Order, owners, estimates, what each invalidates

Order by dependency. The datum goes first because it moves every seated prop. All `mars-2022` scene edits (a, b, c, d,
e, g-Kit, h-Kit) are then **one** reconstruction edit: one re-seed, one id-migration pass and one contentHash freeze,
not seven. North (f) and 2023/24 (i) are independent. The engine rules come next, then re-pins, and the takes come last.

| step | section | owner (PROGRESS plan) | depends on | estimate (h) | invalidates |
| --- | --- | --- | --- | --- | --- |
| 1 | (j) ground datum y = 0 | W53 | — | 3–5 | seated props in 2020–2025 (ids may move → aliases); studio / lab year baselines; walkabout ground; maybe perf-walk 5 pins (see j) |
| 2 | (a) names + pinwheel handedness | W50 | j | 3 | `mars-2022` contentHash; 2022 ids (alias or 1:1); every 2022 year-build pin (neighbours move in each 35 m crop); W38 rules 3/4/8/10 re-checked |
| 2 | (e) no SW-corner table | W50 | a | 0.25 | 2022 table ids → `null`; kitchen A+B (W38 rule 4 reversal and rule 10 lay-down were caused by the table); walkabout "known blocked" |
| 2 | (c) trailer train + scatter | W50 | a, j | 2 | `rv-1…rv-12` placements; `rv-10…12` → `null`; every house crop that sees a trailer |
| 2 | (b) stairs parallel, wide | W50 (Kit), W52 (engine) | a, g | 2 + 5 | 21 stair parts per house (all re-made); the S chapter take; Q12 unplaced list |
| 2 | (d) solar: south rows on 45° frames | W50 (Kit), W52 (engine) | a, h | 2 + 6 | 20 solar parts per house; the P chapter take |
| 2 | (g-Kit) joists under every deck | W50 | a | 2 | every 2022 deck sheet id and height; stair rise |
| 2 | (h-Kit) roof framing | W50 | a | 2 | roof sheets (+13 cm), solar height |
| 3 | (f) 2022 north from the panels | W50 | — (env only) | 1.5 | 2022 sun, shadows, studio 2022 baselines and 2022 directed tracks; no construction pin (physicalView excludes env) |
| 3 | (i) 2023/24 trailers out of Chiba, off the walls | W51 | j | 2 | `mars-2023` / `mars-2024` contentHash, those `rv-*` ids; 2023/24 studio / lab baselines |
| 4 | (g-engine) joists-then-plywood | W52 | g-Kit | 7 | `beamDeckRule` retired; D0/D1/D2 sequencing; BOM; `ddb634d6…`, `94db263e…`, all house A+B runs |
| 4 | (h-engine) roof framing sequenced | W52 | h-Kit | 5 | D2 section; A+B pin |
| 4 | (k) Q10 sideways 3 ft row | W52 | g | 0.5 | nothing (confirmation) |
| 5 | re-pins | W52 | 1–4 | 4–6 | first bay `251a44c5…`, whole house `d382e461…`, phase-B `94db263e…`, A+B `ddb634d6…`, house tranches `940e9f64…` / `4862adfc…` / `b4c42210…` |
| 6 | takes | W52 | 5 | 3–4 | chapter set `8ce33bee…` (7 takes), the whole-skeleton take, W47's houses' takes (not recorded yet: skip) |
| | **total** | | | **≈ 50–58 h of worker time** (estimate), about 12 h on the critical path if W50 / W51 / W53 run in parallel after (j) | |

W47 (checkpoint 1b, in flight) produces pins that step 5 replaces. Its green runs are still worth landing: they
exercise the refusal fixes (receiver spot, stair-side parking) on geometry that §a/§b/§g change.

---

## (j) Ground datum: y = 0 (Q4) — step 1

**Gene:** "posts stood directly on the sand → ground datum y = 0 (the drawn −0.16 ground is wrong)".

**Model now.** The Kit authors every piece on y = 0. The published year scenes and the studio put the ground at
`GROUND_Y = −0.16` (`engine/campus/extract.ts:9`). `Kit.surface()` (`app/history/kit.ts:86`) falls back to `GROUND`
(−0.16) where no structure is under a prop. W46 seated the trailers, the 2020 RVs, the toilets and the 2022 west-house
table on −0.16. W42 moved the 2020 ring and ballast tires down to −0.16 (`app/studio-2020/scene.ts`). Readers of the
ground height: `engine/campus/{extract,load,types,world}.ts`, `engine/camera/{solve,correct}.ts`,
`app/lab/{year-build,year-walkabout,year-walkabout-view}.ts`, `app/studio/{take-host,direct-camera}.ts`,
`app/engine-view/{frame-gait,take-replay}.ts`, and the tests `campus*.test.ts`, `grid-incremental`,
`build-bay-v2/v3`, `camera-chapter-shots`.

**Edit.**
1. Kit years and studio: ground = 0. Set the Kit `GROUND` fallback to 0. Remove the studio's 16 cm offset for rebuilt
   racks. Regenerate `campus-2021…2025.json` (`node deploy/history-scenes.mjs <year>`, then `--check`).
2. 2020: undo W42's −0.16 moves (tires and ballast back onto y = 0 and their surfaces). The rest of the 2020 scene
   already stands on 0.
3. **2026: check before changing `GROUND_Y` globally.** `GROUND_Y` is also the 2026 CAD extraction's ground. If the
   CAD's rack feet sit at −0.16, the 2026 scene keeps its own constant (`GROUND_Y_2026`), and perf-walk's 5 pins must
   not move. If they sit at 0, it is one constant and perf-walk re-runs (expected unchanged, since walkable cells move
   with the ground).
4. Tabletops and seats keep the heights they were authored with for y = 0 (0.53–0.66 m above decks, from the W46 note).
   That is a separate Kit fix and is not in this step.

**Moves.** The props seated on −0.16 rise 0.16 m. If W46's ids hash the seated placement, alias them 1:1. Studio year
baselines and lab walkabout captures are re-captured. The year build already runs on y = 0 ("ground at the Kit datum",
YEAR_BUILD.md), so its pins should not move from this step alone. The crop's trailers do move, so each pin is re-run to
confirm.

**Acceptance.** `history-geometry` asserts "no prop floats / none sunk" per year, with the ground at 0. There is also
a new assertion: every rack foot (frame column bottom) is within 1 cm of y = 0 and of the drawn ground. Capture
`studio-2022-default.png` next to its previous version: the racks sit on the sand, with no 16 cm lip.

---

## (a) Building names and handedness — step 2

**Gene:** "the four 2022 buildings are Huaqiangbei, Cahuilla (right / south), Chatsubo (down), Ba Sing Se (up) — no
'Chiba' in 2022".

**Mapping (derived; the same whichever picture Gene read, because each quadrant holds the same house in the model and
in aerial-03):**

| Gene's name | where (render / aerial-03) | compass (from DJI_0829 north-up) | model id (`make2022` `ids[i]`) | model name now |
| --- | --- | --- | --- | --- |
| **Ba Sing Se** | up | east | `chiba` (i = 0) | "North classroom" |
| **Cahuilla** | right ("south", Gene) | south | `east-house` (i = 1) | "Painted arches house" |
| **Chatsubo** | down | west | `kitchen` (i = 2) | "South kitchen" |
| **Huaqiangbei** | left | north | `west-house` (i = 3) | "West painted house" |

The picture is `questions/r2022-names-model-vs-photo.jpg`. Three checks agree:
- the white canopy building is Huaqiangbei (left in aerial-03, top in DJI_0829 north-up);
- Chatsubo is the only house without panels in both photos, as the model's kitchen (`if(i!==2)k.solar(...)`);
- "Cahuilla = south" matches DJI_0829's logged yaw.

The model's "east / west" labels are therefore 90° off (its "east house" is the south house). That is consistent with
2020's −X = north.

**Model now.** `make2022`: four `rack` groups (3 bays × 12 ft, depth `d = 4.572`, 16 ft frames) at `radius = 8.6`,
rotated `−i·π/2`, each offset along its length by `shift = 3` (origin `(−shift, 0, −radius)`). The stair is in a 4th
slot at local `x = 1.5·BAY`. Seen from above this is a counter-clockwise pinwheel. Both photos show it clockwise (Q20).

**Edit.**
1. **Handedness without a mirror.** Flip the shift. With `shift ≈ −2` (fit), Ba Sing Se's body + stair spans
   X −5.3 … 9.3 against the photo's −5.4 … 9.0 (±0.5 m). Each house keeps its quadrant, its stair end (Ba Sing Se +X,
   Cahuilla +Z, Chatsubo −X, Huaqiangbei −Z, as the photo) and its rotation. Only the overlap reverses: Ba Sing Se's
   stair end now sits over Cahuilla's north end, as in the photo. This replaces Q20's "mirror X or Z" proposal. Q20
   stays open for Gene's confirmation (note added there).
2. **Names.** Change the display names (`names[]`) to Ba Sing Se / Cahuilla / Chatsubo / Huaqiangbei. **Keep the ids**
   (`chiba`, `east-house`, …). Renaming them would re-key every 2022 stable id, plan, test and doc
   (`east-house-12-foot-orange-beam-…`). Add a legend to HISTORY_IDS.md and CAMPUS_SCENE.md: "2022 `chiba` =
   Ba Sing Se …". Renaming the ids is a lead decision, listed and not recommended.
3. `historyNotes[2022]` and `sceneManifest` limitations are updated with the names and the photo fit.

**Moves.** It is a reconstruction edit of `mars-2022` (HISTORY_IDS.md procedure). If a stable id hashes world
placement, every 2022 piece moves 5 m along its house axis → 1:1 aliases (same role). If it hashes placement within
the assembly, only the group origins change and the ids survive; `history-ids.test.mjs` says which. All seven 2022
year-build pins move, because each 35 m crop's neighbours move. W38's neighbour rules (3 beam staging end, 4 build
direction, 8 narrow +u side, 10 stringer lay-down) were fitted to the old overlaps and must be re-checked per house.

**Acceptance.** Re-capture `q20-2022-top.jpg` and re-run `axis.py`: the model's arrow turns clockwise, like DJI_0829.
In `r2022-names-model-vs-photo.jpg` regenerated from the new capture, each house outline sits over its photo house
within about 1 m. The walkabout's four corner passages all pass.

---

## (e) No table at the SW corner (Q1) — step 2 (with a)

**Gene:** "no table at the SW corner (tables are incidental)".

**Model now.** `make2022` `i===3`: `k.table(rack, 0, d/2+1.2, 3, .8)`. It is Huaqiangbei's (west-house) table in the
Huaqiangbei–Chatsubo gap, which is the model's "SW" corner (really about W–NW, see f).

**Edit.** Delete that call. Its table-top and leg ids go to `null` in `id-migration.json`: the piece no longer exists,
and HISTORY_IDS step 3 says null, not alias. The walkabout's "known blocked" entry for that corner is removed.

**Moves.** Kitchen (Chatsubo) A+B: W38 rule 4's reversal was caused by "table top · West painted house", and rule
10's 0.9 m inward stringer lay-down was too. Both may revert, so re-derive them and do not assume. The kitchen tranche
pin `4862adfc…` moves (it moves with (a) anyway).

**Acceptance.** Walkabout: the walkers bound for that corner reach the passage point. `q01-2022-top.jpg` is
re-captured with no red box.

---

## (c) Trailers: a nose-to-tail train on the left, the rest scattered — step 2

**Gene:** "trailers on the left are parked nose-to-tail in a train"; the others "more disorganized".

**Model now.** `ring(k, 12, 25, 28, 0, .45)`: 12 trailers `rv-1…rv-12` evenly spaced on a 25 × 28 m ellipse around the
courtyard, with near-radial headings (`-a + .12·sin i`) and lengths 5.8–7.75 m. The radius is about right: the photo's
trailers stand about 23–25 m from the courtyard centre. The count and the arrangement are wrong.

**Photo layout** (aerial-03 → model frame at 8.3 px/m, ±1.5 m; see the annotated picture):

| photo | X (m) | Z (m) | notes | proposed id |
| --- | --- | --- | --- | --- |
| T1 | −20.5 | −12.4 | train head, diagonal, on the arc | rv-1 |
| T2 | −24.5 | −0.6 | train, along Z, ≈ 7.2 m long | rv-2 |
| T3 | −23.5 | 8.4 | train, nose to T2's tail, ≈ 8.7 m | rv-3 |
| T4 | −18.1 | 17.7 | train, turning round the corner | rv-4 |
| T5 | −11.8 | 18.7 | train tail | rv-5 |
| T6 | −7.3 | −15.4 | beside Ba Sing Se's outer side, along X | rv-6 |
| T7? | 4.9 | −16.6 | light-blue tarp over a trailer-sized box (uncertain) | rv-7 |
| T8 | 22.5 | 6.6 | beside Cahuilla's outer side, along Z, ≈ 8.4 m | rv-8 |
| T9? | 18.9 | 15.1 | long grey flat trailer, diagonal (uncertain; maybe a utility trailer) | rv-9 |
| P | 17.8 | −17.7 | yellow-framed trailer carrying panels; optional | (not modelled) |

**Counts:** a train of **5** on the −X side (north: "left" in both pictures), plus **4** others (2 of them uncertain),
for 9 trailers instead of 12. Cars, the yellow truck and P are not modelled.

**Edit.** Replace `ring(...)` for 2022 with an explicit list, `rv-1…rv-9`, at the positions above. The train's headings
follow the arc (each trailer's nose about 1 m behind the next one's hitch); the others use the headings picked from the
photo. `rv-10…rv-12` go to `null`. Every trailer must stay ≥ 1 m clear of every house footprint and stair (Q2's rule,
applied to 2022 too).

**Moves.** The `rv-*` placements (ids keep their `rv-N` names; aliases only where needed). Every house crop that
includes a trailer changes its obstacles, which is part of the (a) re-pin anyway.

**Acceptance.** A top-down 2022 capture beside aerial-03: the train on the left follows the photo's arc within about
2 m. A new `history-geometry` 2022 assertion: no trailer within 1 m of a building or stair.

---

## (b) Stairs parallel to each building, wide (Q12) — step 2 (Kit), step 4 (engine)

**Gene:** "each building's stairs run PARALLEL to the building (wide), not perpendicular".

**Photo (aerial-03 and DJI_0829 agree).** Every house has one wide stair filling its end slot, **with the treads
parallel to the house's long axis**: you climb across the house's depth, not along its length. Measured sizes:

| house | stair end | tread length (stair width) | run | source |
| --- | --- | --- | --- | --- |
| Ba Sing Se | +X (south end in the real compass) | 3.6–3.9 m | 4.5–4.8 m | both photos |
| Cahuilla | +Z | 3.0–3.9 m | 4.5–5.5 m | both |
| Chatsubo | −X | 3.2–4.2 m | 5.0–5.4 m | both |
| Huaqiangbei | −Z | 3.0–3.2 m | 3.7–5.2 m | both |

So each stair is about one bay wide (BAY = 3.658 m) and runs about the house's depth (d = 4.572 m). ±0.5 m, blurred.

**Model now.** `k.stairs(stair, d − .12, BAY, 2.22, 0, 0, 8)` in a group rotated `π/2` at local `x = 1.5·BAY`: 4.45 m
wide, 3.66 m run, 8 treads **perpendicular** to the house, climbing along its length. The first step floats 0.55 m
(Q12). Engine (YEAR_BUILD phase B): 6 × 2x12 stringers (14 ft cut to 4.059 m), 2x10 + 2x8 treads, posts, handrails.
16 of 21 parts are placed; 2 rail posts inside the end frame and 3 risers are unplaced.

**Edit (Kit).** Same slot, rotated 90°. Width = `BAY − 0.12` ≈ 3.54 m along the house; run ≈ `d − 0.12` ≈ 4.45 m
across it; foot on the courtyard side (default, **Q29**). The rise goes to the first-floor deck top after (g):
2.492 + 0.146 = **2.638 m**. That means 13 risers of 0.203 m and 12 goings of 0.37 m (fits 4.45 m), with the first
riser starting on the sand at y = 0 (fixes Q12's 0.55 m float). The top must meet an **aisle** between the frames on
the end-frame line, because the end frames are three braced frames with 3 ft aisles between them (FRAMING.md kitchen
rows at z 6.771 / 8.600 / 10.429, depth 0.914). W50 picks the aisle nearest the top step and adds a landing sheet if
the top tread falls short.

**Edit (engine, W52).** `stringerRule`: stringers now run across the depth. The slope length is
√(4.45² + 2.64²) ≈ 5.2 m, so 14 ft stock no longer fits: BOM gains 2x12 × 18 ft stock (or 20 ft). Use 4–5 stringers at
≤ 0.9 m across 3.54 m. `treadRule`: treads are now about 3.5 m long, 2 boards each. The two rail posts that stood
inside the end frame should become placeable, because the rail is now on the courtyard / outer side. Stations: the
crew stands in the slot's open ground (it is no longer between frames).

**Moves.** All 21 stair ids per house are re-made (alias by role, e.g. tread k → tread k, extra treads new). The S
chapter take is re-recorded. The stair's footprint changes the neighbours' work zones (W38 rule 8's "other house's
stair rail posts 1.8 m out").

**Acceptance.** An eye-height capture from the courtyard of each stair beside `photos/2022-exterior-09.jpg`. The Kit
stair's walking link is usable with its foot on the sand (walkabout climbs it). Phase B places 21 / 21 stair parts, or
names the refusal.

---

## (d) Solar: south-facing rows on 45° wood frames (Q13) — step 2 (Kit), step 4 (engine)

**Gene:** "one row on two buildings, staggered on another, all facing south, on triangular wood frames ≈ 45° propped on
one side with the low edge on the SOUTH roof edge (not a table in the middle)".

**Photo.** Rows are parallel to the house axes, so they face the house's south side (about 11° off true south, see f):
- **Huaqiangbei**: one row along the full length (≈ 10.5 m).
- **Cahuilla**: one long row, plus a short group beside it (uncertain, **Q28**).
- **Ba Sing Se**: three short rows (≈ 2.5–3.3 m each, E–W), one per bay, stepped along the house. This is the
  "staggered" one (default).
- **Chatsubo**: no panels.

**Model now.** `if(i!==2) k.solar(rack, 3*BAY, 1.65, 0, 5.05, -d/2+.6, .24)`: one row along the local x length at local
`z = −d/2 + 0.6`, 5.05 m up, tilted 0.24 rad (13.75°), with no mount. In world terms:
- Cahuilla's (i = 1) local −z is +X = south: right side, wrong mount.
- Huaqiangbei's (i = 3) local −z is −X = **north**: wrong side.
- Ba Sing Se's (i = 0) row runs N–S and faces −Z = **east**: wrong.

Engine: `solar-panel-107x163` (1.625 × 1.072 m) on a pair of panel rails; 6 of 20 parts are placed. The other 14 need
side stations that a contiguous row does not leave (Q13).

**Edit (Kit).**
- Each module sits on 2x4 **triangle frames**: base on the roof deck (≈ 1.15 m, N–S), a vertical back prop on the north
  side (≈ 1.15 m), and the 45° member under the module. The low edge is on the south roof edge (local
  `z = +d/2 − 0.05` for Huaqiangbei, `−d/2 + 0.05` for Cahuilla), and the high edge is ≈ 1.15 m higher.
- A module in portrait (1.625 m up the slope) projects 1.15 m in plan. There is one frame per module edge, shared by
  neighbours, so n + 1 frames per row.
- Huaqiangbei and Cahuilla: 6 modules landscape along the row, as now.
- Ba Sing Se: 3 rows of 2 modules, each row across the house (local z) facing +X, one per bay. Consecutive rows are
  offset by ≈ 0.5 m in z ("stepped", as in the photo).
- The frame bases sit on the roof deck, which rises 13 cm in (h). Module count is unchanged (6 per panelled house).

**Edit (engine, W52).** New part `solar-frame-45-2x4` (3 members, made at the cutting station from 8 ft 2x4). Order:
`set_part` the frames first, then `install_panel` onto 2 frames (rails retired for 2022). Stations: the installer
stands on the roof deck on the frame's north (back) side. That is the open deck the 45° frames leave, so the 14
unplaced parts should become placeable. BOM: 2x4 for 7 frames per 6-module row.

**Moves.** 20 solar parts per panelled house (ids by role). The P chapter take. Q13's "rails" wording in SOLAR_PAINT.md
for 2022.

**Acceptance.** A top-down capture beside the annotated aerial shows three houses with rows in the photo's places and
Chatsubo bare. An eye-level capture from the south shows the triangles. Phase B places all solar parts (20 / 20) or
names the refusal.

---

## (g) Floors: 2x4 joists across the beams, then plywood (Q8, Q9) — step 2 (Kit), step 4 (engine)

**Gene:** "floors = orange beams → 2x4 joists laid across several beams perpendicularly → plywood on the joists
(criss-cross; plywood never directly on beams)".

**Model now.**
- **Kit:** each deck is 4 ft × 15 ft strips (`k.deck`, 9 per level per house) drawn at beam height, centred on the
  beam centreline. Tops are 0.252 / 2.492 / 4.892 m (FRAMING.md, kitchen).
- **Engine:** `rules.ts beamDeckRule` lets a sheet bear straight on reconstruction-frame beams up to 4 ft. The sheet
  top is +5.7 cm over the Kit's.
- **Beam layout:** beams run along the house (x) in 6 lines, 3 ft apart across the 15 ft depth (3 frames of 3 ft with
  3 ft aisles).

**Edit (Kit, W50).** Under every deck (D0 on the 0.22 m beams, D1 on the 2.48 m beams), add 2x4 **joists on edge**
(3.5 in) running across the depth (15 ft cut from 16 ft stock), **24 in on centre** along the house. That is 19 joists
per level per 3-bay house. The strips stay on top as Q10 has them (6 + 6 + 3 ft). The two cross joints of each strip
get 2x4 blocking between joists (W36's `2x4-blocking-24oc`, 22.25 in): 18 gaps × 2 joint lines = 36 blocks per level.
Joist orientation, depth and sheet direction are **Q30**; this is the default. The roof deck goes to (h).

**Numbers** (derived from the documented offsets; W50 re-derives them from the catalog's beam top):
- Deck top = beam top + 8.9 cm (joist) + 1.9 cm (3/4 ply) = the engine's current on-beam sheet top + **8.9 cm** = the
  Kit's drawn deck top + **14.6 cm**.
- D0: 0.252 → **0.398 m**. D1: 2.492 → **2.638 m** (the stair in (b) rises to this).
- If Gene answers "lying flat" (Q30): +3.8 cm instead of +8.9.
- Headroom under D1 drops 14.6 cm (D0 → D1 clear ≈ 2.24 m, walls unchanged).

**Edit (engine, W52).**
- **Retire `beamDeckRule`.** deck.ts's 24 in span rule then applies to 2022 too, and the joists satisfy it. Q8's
  refusal text ("install 2x4 joists first") becomes the normal path.
- **Joist verb:** `install_top_plate` semantics (rest on the members under it) extended to on-edge 2x4 across ≥ 2
  beams, or a thin `install_joist` wrapper. FRAMING.md has no floor-joist def, so add `2x4-joist-{8…16}ft` on edge.
- **Sequencing** (sequence-b): per level, all joists → blocking → sheets. D0 joists are laid from the ground. D1
  joists are handed up like the 2.48 m beams and laid by the crew on the beam walkways.
- **Risk:** joists on edge are not a walkway. Until the sheets are down, the D1 crew stands on the beams between
  joists, so the access rule has to allow standing on a beam line that has joists across it (check `beam.off-walkway`).
- **BOM per 3-bay house (floors):** + 38 joists (2x4 × 16 ft) + 72 blocks (≈ 9 × 16 ft 2x4) ≈ **+ 47 × 2x4 16 ft**,
  plus cutting-station work for 38 cross-cuts and 72 blocks.

**Moves.** All 2022 deck-sheet ids (their heights move; alias 1:1). Pins `94db263e…` and `ddb634d6…`, all three house
tranches (their 3 deck pieces) and every A+B run. The D0 / D1 chapter takes. Phase A's first-bay and whole-house
skeleton pins do not touch decks: they move only through (a) / (c) / (j).

**Acceptance.** An eye capture under D1 beside `photos/2022-exterior-24.jpg` (the ceiling boards between the orange
beams): joists visible across the beams. `year-build-b` places every deck piece at the canonical pose ≤ 1 cm with 0
violations, and deck.ts refuses a sheet laid before its joists.

---

## (h) Roofs: 2x4 framing, then plywood (Q19) — step 2 (Kit), step 4 (engine)

**Gene:** "roofs had 2x4 framing as in 2026".

**Model now.** The 2022 Kit has no top plates or rafters, and the roof deck lies on the top beams (4.892 m). W36's verbs
`install_top_plate` / `install_rafter` / `install_blocking` are landed and gated (FRAMING.md). The lead decision of
2026-09-29 13:40 kept them out of 2022 because the checkpoint lacked them. That reason is now gone.

**Edit (Kit, W50).** Add top plates on the column tops along both long sides, and flat rafters (= ceiling joists) across
the depth at 24 in on centre. Per 3-bay house that is 19 rafters, blocking over the frame lines and 2 × 36 ft of plate
(3 × 12 ft or 16 + 16 + 4 per side). Roof sheets go on the rafters, at the sheet top from FRAMING.md:
4.877 + 0.038 + 0.089 + 0.019 = **5.02 m**, **+13 cm** over the Kit's 4.892. Chatsubo's partial roof (1 bay) gets the
same framing over that bay. Solar frames (d) stand on the new roof deck.

**Edit (engine, W52).** sequence-b's D2 section becomes: plates → rafters (inner first; FRAMING's "slide over taller"
refusal) → blocking → sheets. Stations as in FRAMING.md (installers on frame stances / the top beams).
BOM + ≈ 19 rafters + plates + blocking ≈ **+ 28 × 2x4 16 ft per house** (estimate).

**Moves.** Roof sheet ids (heights move), the D2 chapter take, the A+B pin, and the solar height.

**Acceptance.** The FRAMING.md bay test pattern on a 2022 house: the framing is visible under the roof sheets in an
eye capture from inside Ba Sing Se's upper floor, beside `photos/2026-skeleton-2x4-frame.jpg`. Year build: D2 at the
canonical pose ≤ 1 cm.

---

## (f) North in 2022, from the panels (Q3 correction; Q22 stays open) — step 3

**Gene:** "north ≈ 8 o'clock of the render, not straight up; derive exactly from the south-facing panels".

**Derivation.**
1. The panels face the house's south side, and the rows run parallel to the house axes (d). So north is
   perpendicular to the rows, on Huaqiangbei's outer side: roughly **world −X** in the model frame. That is "9 o'clock"
   of the render, which is where "8 o'clock" points to within Gene's "roughly".
2. **The residual comes from DJI_0829's logged yaw.** Turned north-up by FlightYaw 110.2°, Huaqiangbei's and
   Cahuilla's panel rows and walls measure **10–12° clockwise of E–W**. So in the model frame north is ≈ **259°
   clockwise from screen-up ("8:40")**: world −X turned **≈ 11° toward +Z**. Gene's 8 o'clock would be 30°.
3. **Cross-check.** At that bearing, aerial-03's shadows (toward about 323° on screen) put the sun at azimuth ≈ 244°
   (WSW). That is a February afternoon, about 16:00–16:30 PST, and the low sun matches the long shadows. DJI_0829's
   shadows are also afternoon (NE).
4. **Error ±5°.** The yaw is FlightYaw (GimbalYaw was not checked), the pitch of −86.4° adds perspective, and the
   picks are by eye.

**Model now.** One global `NORTH_AZIMUTH_OFFSET = −90` (world −X = north; `engine/env/sun.ts`), exact for 2020.

**Edit.** Add a per-year bearing (`northOffset(year)`, the Q22 mechanism). For 2022 it is **≈ −101°** if the offset
runs the way −90 does (−Z → −X → +Z); Gene's estimate is −120°. W50 fixes the sign in `env-sun.test.ts`: at a February
16:15 PST sun, the 2022 shadows must fall toward screen up-left in the top-down capture, as in aerial-03. Q22 (2026 and
the other years) stays open. This only settles 2022.

**Moves.** No construction pin (`physicalView` excludes env; `env-sun.test` proves it). It does move the studio 2022
baselines (shadows), 2022 directed tracks / sunset windows, and camera fixtures that name a compass side for 2022
geometry (W42 relabelled some for −90; re-check `camera-correct` and `studio-direct.spec`). The labels "west house /
east house" in any fixture become the new names.

**Acceptance.** `lab-year-2022-top` at a February 16:15 sun beside aerial-03: the shadow directions agree within 10°.
`q03-2022-top-compass.jpg` is re-drawn with the derived arrow.

---

## (i) 2023 / 2024: trailers out of Chiba, off the walls (Q2) — step 3 (W51, independent)

**Gene:** "no trailers under Chiba in 2023/2024 and side trailers must not touch the walls".

**Model now.**
- 2023: `hall(... 'chiba' ..., 7 bays, depth 8.5344)` at the origin (X ±12.8, Z ±4.27);
  `ring(k, 16, 30, 24, 22, .5)`. The ellipse's near edge is z = 22 − 24 = −2, inside Chiba, so rv-8 / rv-9 are under
  the roof.
- 2024: Chiba is 6 bays × 3 BAY (X ±11.0, Z ±5.5); `ring(k, 18, 32, 24, 22, .55)`, near edge again at −2, so rv-9 and
  rv-10 are inside. The trailers either side of them (a ≈ π ± 0.5 → X ≈ ±14, Z ≈ 1) stand against Chiba's side walls.

**Edit.** Give `ring()` an exclusion: skip, or push outward along the radius, any trailer whose footprint comes within
**1.0 m** of a building footprint (Chiba, kitchen, café, classroom). The ids of skipped trailers go to `null`; pushed
ones keep their ids. **Q21 is open** (2024 kitchen and ring north of Chiba?), so the exclusion must work whichever side
the ring is on, and it must not depend on 2024's current layout. Coordinate with W43's 2024 Chiba front, which is in
the same file.

**Moves.** `mars-2023` / `mars-2024` contentHash (reconstruction edits), those `rv-*` ids, and 2023 / 2024 studio and
lab baselines (`lab-year-2023-top-prisms.png`, `lab-year-2024-top-prisms.png`, `q02-*`). No year-build pin (2022 only).

**Acceptance.** New `history-geometry` assertions for 2023 / 2024: no trailer inside, or within 1 m of, a building
footprint. `q02-2023-top` / `q02-2024-top` are re-captured with no red box inside the blue outline, and Chiba's floor is
walkable end to end in the walkabout.

---

## (k) The sideways third row (Q10) — step 4 (confirmation)

**Gene:** "strips sometimes get a sideways third row (3 ft)".

**Model now.** Each 15 ft strip is 6 + 6 + 3 ft. The 3 ft piece is **cross-cut** from a 4x8 (4x8 → 4x3 + 4x5 offcut),
so its 4 ft side runs across the strip: a sideways third row.

**Confirmed ≈ the current rule.** No change, except "sometimes": the rule stays the default and no alternative layout
is added. Under (g) the joints no longer land on beams. They land between joists, over the new blocking, which is why
(g) adds blocking at the two joint lines. If Q30 says the sheets run across the joists, this layout is re-derived
there.

**Acceptance.** None beyond (g)'s deck-piece check.

---

## Could not map onto the model (for the lead)
- **Q14 "the forklift must stay supported."** The 2022 replay uses no forklift (hand-to-hand relay, crew of six, "no
  forklift", YEAR_BUILD.md). Three readings are possible: a forklift's load must rest on its forks; the forklift must
  stand on firm ground, not on a deck; or forklift-lifted material must be supported on arrival. It applies to the
  2026 / flagship forklift paths, not to 2022. Needs a one-line clarification before any forklift rule changes.
- **What each 2022 building held** (Q31). The model's classroom / arches / kitchen / painted-house contents came with
  the old names. Only Chatsubo = kitchen is supported by evidence (no panels, matching the model's kitchen).
- **"No Chiba in 2022" vs the id `chiba`.** Display names change; the ids stay (a). Renaming them is a lead decision.
- **8 o'clock vs ≈ 8:40.** The derived bearing is 19° from Gene's estimate. Both are recorded; the panels decide (f).
- **Cahuilla's short second panel group** (Q28) and **which end each stair starts from** (Q29) cannot be read from the
  photos.
