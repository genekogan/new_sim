# Questions for Gene: parked, non-blocking; Gene will look at the photos

These are the reconstruction and product questions the engine does not guess. **They are parked here.** No
work waits on them: every open question has a stated default the engine uses now. They are **not re-surfaced
in handoffs or session prompts**; HANDOFF.md and NEXT_SESSION_PROMPT.md carry only a pointer to this file.
Collected 2026-09-29 by W33 from PROGRESS.md (overnight "Questions for Gene" blocks, W7, W13), HANDOFF.md
"End of night" (11 items) and PROGRESSIVE.md.

**How to answer:** write on the `Gene:` line of each block, in any form. The lead turns an answer into an
OWNER_DECISIONS.md entry and a brief. Answered blocks move to the end of this file.

Each block gives:
- what the engine sees today (with file references);
- a picture, where one helps;
- what the answer changes (code, pins, protected states);
- an empty `Gene:` line.

Images:
- `questions/*.png` are new lab captures (W33, head `be0f66a`, SwiftShader, 1280×800).
- `../../viewer/e2e/baselines/*.png` are committed e2e baselines.

Everything on screen is the engine's reconstruction. The Kit is the procedural year scenes in
`app/history/**`. The year build is a HYPOTHETICAL order, run in a fork of the protected `mars-<year>`
state.

Status: **20 open blocks** (Q1, Q2, Q4–Q14, Q19, W44's site-axis Q20–Q22 and W38's year-build Q25–Q27; two pairs were duplicates and are merged) and **3 answered** (A3 north, §13 reach-down, §14 top beams).
Status: **17 open blocks** (Q1–Q14, Q19, Q20 and Q21; 16 + 3 questions, two pairs were duplicates and are merged) and **2 answered**.

**Gene's page.** `questions/index.html` shows every open block as a card Gene can read and answer (plain question,
pictures, options, export button); it is served at `/questions/` after a deploy. It is generated from this file:
`cd viewer && node deploy/questions-html.mjs`. The generator reads the fenced ` ```question ` block under each
heading and fails if a field is missing. Fields (the engineer's text below each block stays the record):

| field | content |
| --- | --- |
| `id` | Q-number (A-number when answered) |
| `urgency` | `first` (worth answering first), `fidelity` (improves fidelity) or `none` (blocks nothing) |
| `order` | optional number: position within its urgency group (lower first) |
| `status` | optional; `answered` moves the card to the record at the end (no controls) |
| `plain` | one-line question in plain English, no engine vocabulary |
| `terms` | optional list `word \| one-sentence definition` (hover titles + footnotes on the card) |
| `context` | two sentences: why the model thinks this, and what it affects for Gene |
| `changes` | one line: what changes if he answers, in plain words |
| `options` | list of concrete answers (radio buttons; "don't know / skip" is added) |
| `images` | list `questions/<file> \| caption`: a labelled capture (`e2e/questions-captures.spec.ts`), photos in `questions/photos/`, diagrams in `questions/diagrams/`; `none \| description` when it cannot be illustrated |

The answer on the card's record comes from the block's `Gene:` line.

---

## Layout of the year scenes

### Q1. 2022: is the south-west corner passage really closed by the west-house table?

```question
id: Q1
urgency: first
order: 3
plain: In 2022, could you walk out of the courtyard at its south-west corner (between the west house and the kitchen), or did a table block the gap?
context: The model's 2022 drawing has a table standing in that gap, tucked under the kitchen stair, so people in the replay cannot leave the courtyard at that corner (the other three corners are open). We ask because it decides whether that corner is a way in and out when you walk the 2022 scene.
changes: If it was open, the table moves and people can walk through that corner; if a table really stood there, nothing changes.
options:
  - Open: people walked through there (move the table)
  - Blocked: a table or something similar really stood in the gap
  - Open, but something else stood near there (describe below)
images:
  - questions/q01-2022-eye.jpg | The model, 2022, at eye height from outside the corner: the red outline is the table, under the kitchen stair.
  - questions/q01-2022-top.jpg | The model from above: the red box is the table in the gap between the west house and the kitchen.
  - questions/photos/2022-aerial-03.jpg | Real drone photo, 2022, almost straight down: the four buildings round the courtyard and their corner gaps.
  - questions/photos/2022-courtyard-orbit.jpg | Real drone photo, 2022, from another side.
```

**What the engine sees.** The 2022 Kit scene has four corner passages out of the courtyard. NE, SE and NW are
open. At the SW corner, between the west house and Chiba, a table stands in the gap: the long purple prism left
of centre. A walker cannot get through it. In the year walkabout, the walkers bound for that corner end
2–3 m from the passage point.

![2022 top-down, engine prisms](../../viewer/e2e/baselines/lab-year-2022-top-prisms.png)

**What the answer changes.** If the passage was open, the table moves in `app/history/scenes.ts`, and the
protected `mars-2022` state is re-seeded with a `reconstruction-edit` cause. The table's stable id changes, and
`id-migration.json` gets an alias for it (HISTORY_IDS.md). Walkabout expectations and the year-build campus crop
are re-checked. If the table really stood there, nothing changes, and the walkabout's "known blocked" entry
becomes a documented fact.

Gene:

### Q2. 2023 and 2024: do trailers rv-8/9 (2023) and rv-9/10 (2024) really stand inside Chiba's footprint?

```question
id: Q2
urgency: first
order: 2
plain: In 2023 and 2024 the model has two trailers parked inside Chiba, under its roof (red outlines). Was that real?
context: The model puts the trailers on a neat circle, and that circle clips the back of Chiba, so two trailers each year end up under its roof. In the photos below the trailers ring the open ground outside Chiba; if none stood inside, they move out and the inside of Chiba becomes open floor you can walk through.
changes: Two trailers per year move out of Chiba and Chiba's floor opens up for walking; nothing else moves.
options:
  - No: no trailers under Chiba (move them out)
  - Yes: trailers really were parked under Chiba's roof
  - Only in one of the two years (say which below)
images:
  - questions/q02-2023-eye.jpg | The model, 2023, from the front of Chiba: the red boxes are the two trailers hidden under the roof; blue is Chiba.
  - questions/q02-2023-top.jpg | The model, 2023, from above: two trailers (red) inside Chiba's outline (blue); the rest of the circle is outside.
  - questions/photos/2023-aerial-09.jpg | Real drone photo, 2023: Chiba on the left, the trailers around the open ground.
  - questions/q02-2024-eye.jpg | The model, 2024, from the front of Chiba: again two trailers (red) under the roof.
  - questions/q02-2024-top.jpg | The model, 2024, from above.
  - questions/photos/2024-aerial-20.jpg | Real drone photo, 2024: Chiba is the white building on the right.
```

**What the engine sees.** In both years, two trailers of the trailer circle sit under Chiba's roof, inside
its footprint. These are the tilted orange-brown boxes inside the pink roof area at the top of each picture.

![2023 top-down, engine prisms](questions/lab-year-2023-top-prisms.png)
![2024 top-down, engine prisms](../../viewer/e2e/baselines/lab-year-2024-top-prisms.png)

**What the answer changes.** If this is a scene error, the trailers move out in `scenes.ts`, and
`mars-2023` / `mars-2024` are re-seeded (`reconstruction-edit`, id aliases). Chiba's interior becomes walkable
where they stood. If it is real (the trailers parked under the roof), nothing changes.

Gene:

### Q3. North axis: which way is north on site?

```question
id: Q3
urgency: first
order: 1
status: answered
plain: On this map of 2022, is north really straight up, with the east house on the right and the kitchen at the bottom?
context: Nobody recorded the site's compass bearing, so the model assumed the top of its map is north (the house names agree with that, if "east" and "west" were real directions). Every sunset, every shadow and every "sun behind the building" camera shot is placed from that guess.
changes: The sun, the shadows and the sunset camera shots turn to the right direction; nothing is rebuilt.
options:
  - Yes: up is north (keep it)
  - North is to the right (toward the east house)
  - North is to the left (toward the west house)
  - North is down (toward the kitchen)
  - Somewhere in between (write an angle or a landmark below, e.g. "the Salton Sea was toward the kitchen")
images:
  - questions/q03-2022-top-compass.jpg | The model's 2022 map. Red: where the model thinks north is. Orange: where that puts the February sunset.
  - questions/photos/2022-aerial-03.jpg | Real drone photo, 2022, looking almost straight down. The long shadows mean early morning or late afternoon; if you remember which, they give the bearing.
  - questions/photos/2022-aerial-10.jpg | Real rooftop panorama, 2022, at sunset: which building was the sun going down behind?
```

**What the engine sees.** World −Z is taken as geographic north (`NORTH_AZIMUTH_OFFSET = 0`,
`engine/env/sun.ts`). No site bearing was found. The NOAA sun, the shadows and the camera's "sunset behind"
windows all follow from this.

![2022 shadows under the assumed north](../../viewer/e2e/baselines/lab-year-2022-top-prisms.png)

**What the answer changes.** It sets one constant. Every shadow, every sunset / sun-behind camera direction and
the studio lighting rotate by the offset. Directed camera tracks re-plan. Construction pins are not expected to
move, because the environment is outside `physicalView()` (inferred, not yet tested).

Gene: (2026-09-29) the long axis of the 2020 tire ring runs north–south; W42 fixed the sign from the DJI_0079 shadows → world −X is north in 2020 (`NORTH_AZIMUTH_OFFSET = −90`). See A3 below for the per-year caveat.

### Q4. Ground datum: is the ground at y = 0 or at −0.16 m?

```question
id: Q4
urgency: none
order: 1
plain: Did the rack posts stand directly on the sand?
context: Two parts of the model disagree by 16 cm about where the ground is, so in the studio the rebuilt racks sit 16 cm lower than the original drawing. We need one ground level; it only matters beyond housekeeping if the posts stood on blocks or pads.
changes: Everything shifts by 16 cm once and the saved build replays are re-recorded; you would not notice it by eye.
options:
  - Posts stood directly on the sand
  - Posts stood on blocks or pads (how high? below)
  - Don't mind: pick one
images:
  - questions/diagrams/q04-ground-options.svg | Diagram, not a 3D render: a 16 cm difference does not show clearly in a 3D view.
  - questions/photos/2026-skeleton-2x4-frame.jpg | Real photo, 2026 (a later year): rack posts at ground level.
```

**What the engine sees.** The Kit stands every piece on y = 0. The published year scenes and the studio put the
ground at −0.16 m (`GROUND_Y`, `engine/campus/extract.ts`), so rack posts start 16 cm above the drawn ground.
The year build runs on the Kit datum (y = 0). The studio draws rebuilt racks 0.16 m below the Kit's.

![Finished first bay, frame feet at the Kit datum](questions/yb2022-frame-feet.png)

**W42 survey (§15 "levitating tires"; measured by ray-casting down from every near-ground mesh of each built scene).**
Every Kit piece standing on the ground floats by the datum (+0.16 m), and some props add their own lift. The 2020 ring
tires (+0.175/0.189 m) and the ballast tires (tarp +0.13–0.19 m, container roof −0.03 m) are fixed in `studio-2020/scene.ts`.
They now rest on the ground and on their surfaces. Everything else waits for this answer:

| Scene | Prop (ids) | Gap above what it stands on | Where |
| --- | --- | --- | --- |
| 2020 | RV wheels `rv-1…rv-6-component-*` (4 each) | +0.089 | `studio-2020/scene.ts` makeRV (datum; not moved) |
| 2020 | portable toilets `site-portable-toilet-body-*` (4) | +0.19 | same; the whole 2020 scene stands on y = 0 (uprights, container, trees +0.16) |
| 2020 | workshop table legs `canopy-table-leg-*` (4) | +0.20 | same |
| 2021–2025 | table legs `*-table-leg-*` (classroom 24, library 4, kitchens 12, chiba 8–12, cafe 4, west-house 4) | +0.26 = 0.16 datum + 0.10 (`Kit.table` legs start at y = 0.1) | `app/history/kit.ts` table() |
| 2021–2022 | bench feet `classroom-bench-foot-*` (12), `chiba-bench-foot-*` (4) | +0.21 (datum + 0.05) | `app/history/scenes.ts` |
| 2021–2025 | stored food crates `*-stored-food-crate-*` (12 per kitchen) | +0.38 (datum + 0.22, under the counter, no shelf) | `kit.ts` kitchen() |
| 2021–2025 | white refrigerator `*-white-refrigerator-*` | +0.18 (datum + 0.02) | `kit.ts` kitchen() |
| 2023–2025 | café painted counter `cafe-cafe-painted-counter-fa10f6cc` | +0.26 | `scenes.ts` |
| 2021–2025 | trailer wheels `rv-N-trailer-wheel-*` | +0.16 (datum only) | `kit.ts` rv() |
| 2026 studio | campfire ring (`scenery.ts`): rocks embedded 0–4 cm, lowest log +0.05 (thick end) | ≈ on the ground | studio ambience (datum −0.16, correct) |

The lab (engine datum y = 0, ground at 0) and the year walk-about (ground at the file's `groundY`) draw props on their own
ground, with no offset. Answering "ground at −0.16" would move every Kit row above by −0.16 in one place (the Kit's
datum). The intrinsic lifts (tables +0.10, crates +0.22, benches +0.05) are separate Kit fixes.

**What the answer changes.** One datum for build takes and the studio. The studio's 16 cm offset disappears.
Re-basing moves every year-build pin once (first bay, whole skeleton, A+B `ddb634d6…`), and the takes are
re-recorded.

Gene:

---

## Site axis per year (A3 follow-ups, W44)

W42 checked every year's scene against drone stills with a logged camera heading (A3's table). Two years show
layouts that no rotation can fix (2022 mirrored, 2024 kitchen / trailer ring on the other side of Chiba), and
2026 needs its own bearing. The pictures put the model's top-down capture (screen up = world −Z) next to the
still turned north-up. They are drawn by `questions/tools/axis.py` from the captures `q20/q21/q22-*-top.jpg`
(`e2e/questions-captures.spec.ts`) and the stills copied into `questions/photos/`.

### Q20. 2022: is the model's layout a mirror image of the real one?

```question
id: Q20
urgency: first
order: 5
plain: The model's four 2022 houses spin one way (counter-clockwise from above); the drone photo shows them spinning the other way. Which is right — or is the model's map flipped left-to-right?
terms:
  - north-up | A photo turned so that north points to the top of the page.
context: In the model each house sticks out past the end of the next one like the blades of a pinwheel, and seen from above that pinwheel turns counter-clockwise. In the 2022 drone photo (turned north-up from the heading the drone logged) the same four houses overlap the other way round, so it turns clockwise: that is a mirror image, which no turning of the map can fix.
changes: If the photo is right, the 2022 layout is redrawn as its mirror image and the 2022 building replay is recorded again on it; if the model is right, nothing changes.
options:
  - The photo is right: flip the model (if you can, say below which house is which in the photo)
  - The model is right: the houses really turned counter-clockwise
  - Not sure
images:
  - questions/q20-2022-model-vs-drone.jpg | Left: the model from above, north (as its house names have it) up; it turns counter-clockwise. Right: drone photo DJI_0829, 2022, turned north-up; the same four houses turn clockwise.
  - questions/q20-2022-eye.jpg | The model's 2022 courtyard from the south-east, with the four houses named.
  - questions/photos/2022-DJI_0829.jpg | The drone photo as taken (the top of the frame faces east-south-east).
```

**What the engine sees.** `app/history/scenes.ts` draws the 2022 Kit with Chiba north (z −10.9 … −6.2, offset
toward −X), the east house at +X (offset toward −Z), the kitchen south (offset toward +X) and the west house at −X
(offset toward +Z): a counter-clockwise pinwheel seen from +Y. DJI_0829 (FlightYaw 110.2°, pitch −86.4°, rotated
north-up by −110.2°; the afternoon shadows fall north-east, as they must in February) shows the four buildings
overlapping clockwise. Handedness is rotation-invariant, so no `NORTH_AZIMUTH_OFFSET` fixes it (A3; W42).

**What the answer changes.** A reconstruction edit: the 2022 scene is mirrored in `scenes.ts` (either
X → −X or Z → −Z; which one depends on which photo building is which), `mars-2022` is re-seeded with a
`reconstruction-edit` cause and every moved id is aliased in `id-migration.json` (HISTORY_IDS.md). The east-house
year build (first bay, whole skeleton, A+B `ddb634d6…`) and its 7 chapter takes are re-planned and re-recorded, so
their pins move once. Q1 (the south-west corner table) is re-read on the mirrored plan. If the model is right,
nothing changes and A3's 2022 row becomes "mirror checked: model right".

Gene:

### Q21. 2024: were the kitchen and the trailer ring north or south of Chiba?

```question
id: Q21
urgency: first
order: 6
plain: In 2024, did the kitchen and the ring of trailers sit north of Chiba, as the drone photo shows, or south of it, as the model has them?
terms:
  - north-up | A photo turned so that north points to the top of the page.
context: The model's 2024 drawing puts Chiba at the north end, with the ring of trailers and the kitchen spread out to its south. The one straight-down drone photo from that winter, turned north-up by the old tire ring (which runs north–south on the west side of the site), shows Chiba at the south end with the ring and the kitchen to its north.
changes: If the photo is right, the kitchen and all the trailers move to Chiba's other side (Chiba itself stays), which also clears the two trailers now standing under Chiba's roof; if the model is right, nothing changes.
options:
  - The photo is right: kitchen and trailers were north of Chiba (move them)
  - The model is right: they were south of Chiba
  - Not sure
images:
  - questions/q21-2024-model-vs-drone.jpg | Left: the model from above, north up: Chiba (blue) at the top, the trailer ring (red) and the kitchen (orange) below it. Right: the drone photo of 22 January 2024, north-up: Chiba at the bottom, the kitchen and the ring above it.
  - questions/q21-2024-eye.jpg | The model's 2024 camp seen from the west: Chiba on the left (north), the kitchen on the right (south), the trailers between them.
```

**What the engine sees.** The 2024 Kit puts Chiba at z −5.5 … 9.2, the kitchen at z 35 … 47 and the 18 trailers
(`rv-1` … `rv-18`) on a circle between them, all on Chiba's +Z side. DJI_20240122144543_0335_D (nadir, north-up by
the 2020 tire ring on the west edge) has the big building with the solarium (Chiba, W42's `d2024_chiba` crop) at
the south and the long kitchen with the solar panels at the north, the ring between. Chiba alone fits −Z = north
(A3, "medium-high").

**What the answer changes.** A reconstruction edit in `scenes.ts`: the kitchen, kitchen-interior, cafe and the
trailer circle mirror across Chiba (z → −z about Chiba's centre, or the circle is re-centred north of it);
`mars-2024` re-seeded, ids aliased. It also answers Q2 for 2024: rv-9 / rv-10 no longer stand under the roof.
Coordinate with W43's 2024 Chiba facade edit (same file). If the model is right, nothing changes.

Gene:

### Q22. Which way is north in 2026 (and in each year)?

```question
id: Q22
urgency: first
order: 7
plain: Your 2020 answer set one north for every year, but the 2026 model is turned about 33° from what the 2026 drone photos show. Should 2026 use the drones' north?
terms:
  - north-up | A photo turned so that north points to the top of the page.
context: The tire ring running north–south fixed north exactly for 2020, and the model now uses that one north for every year. The 2026 model was drawn separately, and next to two 2026 drone photos turned north-up it sits about 33° off (Chiba's long side, the container row and the trailer arc all agree), so the 2026 sun, shadows and sunset shots are off by that much.
changes: The sun, the shadows and the sunset camera shots for that year turn; nothing is rebuilt.
options:
  - Use the drones' north for 2026 (turn only the sun and shadows for that year)
  - Use each year's own north wherever a drone photo shows it
  - Keep one north for all years
  - Not sure
images:
  - questions/q22-2026-model-vs-drone.jpg | Left: the 2026 model from above. Grey: north as the model uses it now. Red: north from the drone photos, about 33° round. Right: drone photo DJI_0005, 2026, turned north-up: turn the left picture until the red arrow points up and the two match.
  - questions/q3-2026-cad-vs-drone-north-up.jpg | The earlier comparison: the model's 2026 plan and two drone photos (DJI_0098, DJI_0005), each turned north-up.
  - questions/q22-2026-eye.jpg | The model's Chiba, 2026, at eye height; its shadows and the sunset shots around it are what would turn.
```

**What the engine sees.** One global `NORTH_AZIMUTH_OFFSET = −90` (`engine/env/sun.ts`, world −X north), exact for
2020 (DJI_0079). For the 2026 CAD, DJI_0005 (FlightYaw −91.7°, near-nadir, 2026-03-19 14:31, rotated north-up by
+91.7°) and DJI_0098 (nadir) put north at −X turned ~33° toward −Z (offset ≈ −57° ± 8°; A3 table). 2025 fits 0°
(±20°); 2021 and 2023 are unverified.

**What the answer changes.** A per-year bearing (e.g. `northOffset(year)` beside the constant). Only `camera/` and
`api/` read `env/sun.ts`, and `physicalView()` excludes env, so no construction pin moves; the sun, shadows,
studio lighting and "sunset behind" camera windows for that year rotate, and directed tracks for that year
re-plan. CAMPUS_SCENE.md's "North" note follows the answer.

Gene:

---

## The rack skeleton

### Q5. The "9 ft" part: is it a frame (upright) or a beam, and what are its dimensions?

```question
id: Q5
urgency: none
order: 3
plain: Your list of rack sizes included a 9 ft piece. Was it a frame or a beam, and what size was it?
terms:
  - frame | The ladder-like end of a rack: two posts joined by diagonal braces.
  - beam | The horizontal orange bar that hangs between two frames.
context: The model has frames of 8, 12, 16 and 19 ft and beams of 12 ft, but nothing 9 ft, so it carries a placeholder 9 ft frame, guessed at 4 ft deep. Nothing in any scene uses it yet, so this only tidies the parts list.
changes: One placeholder part is removed or completed; no scene changes.
options:
  - A beam
  - A frame (how deep? below)
  - Don't remember
images:
  - none | Cannot be illustrated: no 9 ft part appears in any scene or photo we have. Picture a rack frame (two posts joined by diagonal braces, like a ladder) only 9 ft tall; or a single orange beam 9 ft long, the kind that hangs between two frames.
```

**What the engine sees.** Gene's size list was 8 / 9 / 12 / 19 ft. The model library has 8, 12, 16 and 19 ft
frames and 12 ft beams, and nothing that is 9 ft. `world/catalog.ts` carries `upright-9ft` marked `provisional`,
with an assumed 4 ft depth. The flagship builds with `beam-9ft`. No image: nothing 9 ft exists in any scene
to show.

**What the answer changes.** If it is a beam, the provisional `upright-9ft` is removed and the flagship stands
as is. If it is a frame, it needs a depth and a seat pattern (catalog entry, `mars-assembly` rules version).
The provisional flag goes either way.

Gene:

### Q6. Beam heights: keep the Kit's 0.22 / 2.48 / 4.757 m, or snap to the real hole pitch?

```question
id: Q6
urgency: none
order: 2
plain: The model hangs the beams at 22 cm, 2.48 m and 4.76 m, as measured from photos. Keep those heights, or move each beam to the nearest real hole in the posts (at most 2.5 cm away)?
context: The heights were estimated from photos, while the real posts have holes every 2 inches, so each real beam sat in one of those holes. The lowest height (22 cm) is also lower than the first hole could plausibly be.
changes: Beams move by up to 2.5 cm and the saved build replays are re-recorded once; invisible by eye.
options:
  - Keep the heights as they are
  - Snap to the real holes
  - The lowest beam was higher (give the height below)
images:
  - questions/q06-2022-beams-eye.jpg | The model, 2022 east house: the three beam heights on one frame.
```

**What the engine sees.** The Kit hangs beams at 0.22, 2.48 and h − 0.12 m (4.757 m on a 16 ft frame). These
come from photo estimates, and 0.22 m is below any plausible first hole. The engine reproduces them exactly with
`upright-16ft-kit` seats (`world/catalog-stock.ts` `kitSeatLevels`), so the year build matches the protected
checkpoint to 1 cm. Snapping to a 2 in hole pitch would move beams by up to ±2.5 cm.

![First bay: the low beam at 0.22 m](questions/yb2022-frame-feet.png)
![Whole first bay, three beam levels](../../viewer/e2e/baselines/year-build-skeleton.png)

**What the answer changes.** Snapping edits every Kit year's beam placements. The protected `mars-2021..2025`
states are re-seeded (`reconstruction-edit`), beam stable ids move (aliases), and every year-build pin moves
once. Keeping the Kit heights changes nothing.

Gene:

### Q7. Stock on site: how many pieces per bundle, and how were uprights and beams stacked?

```question
id: Q7
urgency: fidelity
order: 8
plain: When the materials were on site, how were they piled: how many plywood sheets per stack, and were the rack frames and beams stacked flat or bundled?
context: The replay's material yard is a guess made to look like the photos: plywood in strapped stacks of about 24 sheets, frames lying flat, beams in strapped bundles, and a cutting table. The size of the yard sets how many trips the crew makes and how long a build takes.
changes: The yard's size, the number of trips and the length of the build replay; the finished houses do not change.
options:
  - Looks about right
  - Different (describe below: sheets per stack, how frames and beams were stacked)
images:
  - questions/q07-yard.jpg | The replay's 2022 yard at the start. Colours match the labels; outlines show through other objects.
  - questions/photos/2026-material-piles.jpg | Real photo, 2026: plywood, 2x4, 2x6 and timbers in piles.
  - questions/photos/2026-material-piles-loader.jpg | Real photo, 2026: the piles with a loader.
```

**What the engine sees.** The pile yard is chosen to look like the evidence photos. None of it is documented:
- plywood in strapped stacks of about 24 sheets;
- lumber in strapped units;
- frames lying flat in stacks, beams in strapped bundles;
- a cutting station (`campus/bom.ts`, `world/catalog-stock.ts`).

![2022 east-house pile yard at t = 0](questions/yb2022-pile-yard.png)
![Showcase: every bundle / stack kind](../../viewer/e2e/baselines/solar-paint-mounted-equipment.png)

**What the answer changes.** Bundle counts and stack shapes in `catalog-stock.ts` / `bom.ts`: yard size, the
number of `take_from_bundle` trips, and how long a year build runs. The material rules stay the same.
Year-build pins move.

Gene:

### Q8. Plywood span: may a sheet lie directly on a beam pair up to 4 ft apart, or only up to 24 in?

```question
id: Q8
urgency: fidelity
order: 1
plain: Could a plywood sheet lie straight across beams 4 ft apart with nothing under the middle, or did it need support about every 2 ft?
context: Standard 3/4 in plywood is rated for 2 ft between supports, so the model refuses to lay plywood across a 4 ft gap and puts joists in first. Your earlier brief said 4 ft was fine; if so, floors can be built without joists.
terms:
  - joist | A smaller board (here a 2x4) laid across the main beams to hold up the plywood.
changes: One rule: if 4 ft was fine, floors without joists are allowed in the build replay. Goes with the floors question.
options:
  - 4 ft was fine: plywood straight on the beams
  - It needed support about every 2 ft
  - It depends (explain below)
images:
  - questions/diagrams/q08-span-options.svg | Diagram, not a 3D render: the two options side by side.
  - questions/q09-2022-deck-eye.jpg | The model, 2022: a floor strip (red) spanning between two beams (blue) with nothing underneath.
```

**What the engine sees.** The brief said 4 ft. The engine says ≤ 24 in centre gap, because 3/4 in ply is rated
24 in o.c. Every Mars frame is 3–4 ft deep, so the 4 ft rule would make joists optional on every bay. The
refusal reads "cannot span 1.22 m between b3 and b4 (max 0.62 m / 24 in); install 2x4 joists first"
(`plywood.span`, PROGRESSIVE.md). It is marked "owner may overrule". No image: this is a rule, not a scene.

**What the answer changes.** One constant plus a rules-version bump. At 4 ft, plans without joists become
valid. The flagship still installs joists, but its bound plans would report `plan.stale`. Relates to Q9.

Gene:

---

## Year build phase B: decks, stair, walls, solar (2022 east-house)

The phase-B rules are provisional and fitted to the 2022 Kit (YEAR_BUILD.md "Phase B material rules"). The A+B
run is green and pinned (`ddb634d6…`, 600 599 ticks, 0 violations). Answers change the rules in
`campus/{parts-b,sequence-b}.ts`, `world/catalog-phase-b.ts` and `construction/{passup,setpart,wall}.ts`, and
re-pin A+B. The pictures show the Kit's drawing of 2022, which is what the engine rebuilds.

![2022 east side, Kit: stair, deck strips, wall panels](questions/kit2022-east-house-a.png)
![2022 from the south-west, Kit: roof modules, mural walls, stair](questions/kit2022-east-house-b.png)

### Q9. Decks: 4 ft × 15 ft strips on the beams, a step-beam ledge, or 4x8 sheets on 2x4 joists?

```question
id: Q9
urgency: first
order: 4
plain: How were the floors built: plywood strips laid on top of the beams, sheets set into a ledge on the beams, or 4x8 sheets on joists?
terms:
  - joist | A smaller board (here a 2x4) laid across the main beams to hold up the plywood.
context: The model's 2022 drawing shows each floor as long 4 ft × 15 ft plywood strips resting on the beams with nothing in between, and the build replay copies that. We are about to add wooden 2x4 framing to the replay, so this answer decides whether floors get joists.
changes: How every floor is built in the build replay and how many pieces it needs; the finished houses look almost the same.
options:
  - A. Strips on top of the beams (as the model does now)
  - B. Sheets set into a ledge on the beams
  - C. 4x8 sheets on 2x4 joists
  - A mix (say where below)
images:
  - questions/q09-2022-deck-eye.jpg | The model, 2022 east house: one floor strip (red) resting on two beams (blue).
  - questions/diagrams/q09-deck-options.svg | Diagram, not a 3D render: the three options seen end-on. They could not be staged in the lab, which only has the model's current version.
  - questions/photos/2022-exterior-24.jpg | Real photo, 2022: look at the ceiling. Are those wooden boards between the orange beams joists?
  - questions/photos/2022-interior-01.jpg | Real photo, 2022: the underside of a floor, orange beams and plywood.
```

(Merges HANDOFF Q10 and W13 Q1.)

**What the engine sees.** The Kit draws each deck as 4 ft × 15 ft plywood strips laid at beam height,
centred on the beam centreline (through the frame planes), with no joists. The engine lays them on top of the
beams, 5.7 cm above the Kit's surface.

**What the answer changes.** On the beams: nothing changes. A ledge: a new seat rule. Sheets on joists:
the deck section gains a 2x4 joist layer, and 2x4 framing is Claude's checkpoint-1 work, so this answer shapes
it directly. See also Q8.

Gene:

### Q10. How was a 15 ft deck strip made from 4x8 sheets?

```question
id: Q10
urgency: fidelity
order: 2
plain: A floor strip is 15 ft long but plywood comes in 8 ft sheets. How was a strip pieced together?
context: The model cuts each strip from 6 ft + 6 ft + 3 ft pieces, joined where they sit on beams. That sets how many cuts and pieces the build replay needs (81 pieces for 27 strips).
changes: Only the cutting and the piece count in the build replay.
options:
  - 6 ft + 6 ft + 3 ft (as the model does now)
  - 8 ft + 7 ft, with a block under the joint
  - Something else (describe below)
images:
  - questions/diagrams/q10-strip-options.svg | Diagram, not a 3D render: one 15 ft strip seen from above.
  - questions/q09-2022-deck-eye.jpg | The model, 2022: one 15 ft floor strip (red) between two beams (blue).
```

(W13 Q2.)

**What the engine sees.** Each strip is made as 6 + 6 + 3 ft pieces, jointed on beams (`cut` at the cutting
station, 81 deck pieces for 27 strips).

**What the answer changes.** For example 8 + 7 with blocking: different cuts, piece counts and blocking parts
in `parts-b.ts`.

Gene:

### Q11. Wall panels: outside or inside the beam line, and how were they fastened at the aisles?

```question
id: Q11
urgency: fidelity
order: 5
plain: Were the plywood walls fixed on the outside of the rack beams or on the inside, and what were they fixed to where a walkway runs through?
context: The model hangs the wall panels just outside the beams, and the 2022 murals are painted on those panels. Where a walkway opens the rack, a panel has no beam behind it, so the replay needs to know what it was fixed to.
changes: Where the wall panels sit (a few centimetres) and where the builders stand to fix them; the murals stay.
options:
  - Outside the beams (as the model does now)
  - Inside the beams
  - Mixed (describe below, with how they were fixed at the walkways)
images:
  - questions/q11-2022-wall-eye.jpg | The model, 2022 east house: wall panels (red) and the beam line (blue).
  - questions/diagrams/q11-wall-options.svg | Diagram, not a 3D render: the few centimetres involved do not show in 3D.
  - questions/photos/2022-exterior-10.jpg | Real photo, 2022: plywood wall panels going up on a rack house.
  - questions/photos/2022-exterior-20.jpg | Real photo, 2022: a mural wall.
```

(W13 Q3.)

**What the engine sees.** The engine hangs panels outside the beam line, 3.5–4.8 cm off the Kit's drawing
(25 panels on 4 walls, `construction/wall.ts`). The Kit's murals are painted on these panels (second picture
above).

**What the answer changes.** Inside the beam line means a different panel plane and different fastening
stations. At the aisles, the fastening rule decides what a panel bears on.

Gene:

### Q12. The rack-house stair: width, stringers, treads, and where its foot stands

```question
id: Q12
urgency: fidelity
order: 3
plain: What was the stair up to the east house's first floor like: how wide, how many stringers under the steps, and where did its bottom step land?
terms:
  - stringer | The sloped board along the side (or middle) of a stair that the steps rest on.
context: The model's drawing has an 8-step stair 4.45 m wide with no stringers, and its first step floats 55 cm above the ground. The replay builds it with 6 stringers and cannot place 5 parts (2 rail posts that would stand inside the rack and 3 step fronts).
changes: The stair's parts and where its foot stands in the build replay; the 5 unplaced parts get placed or dropped.
options:
  - Two stringers (one each side)
  - Four or more stringers
  - It was a ramp, not a stair
  - Not sure about stringers (answer the width and the bottom step below)
images:
  - questions/q12-2022-stair-eye.jpg | The model, 2022 east house stair from the courtyard: 8 steps (red); the orange step floats 55 cm up.
  - questions/diagrams/q12-stair-options.svg | Diagram, not a 3D render: the options seen from the front.
  - questions/photos/2022-exterior-09.jpg | Real photo, 2022: a rack house with a stair at its right end.
  - questions/photos/2026-skeleton-2x4-frame.jpg | Real photo, 2026 (a later year): the long stair on the right.
```

(Merges HANDOFF Q9 and W13 Q4.)

**What the engine sees.** The Kit draws a 4.45 m-wide, 8-tread end stair with no stringers (first picture
above). Its first step is 0.55 m above the ground datum, and its top posts stand inside the end frame. The
engine builds it after both upper decks (crews climb the end frames). It places 16 of 21 parts: 6 stringers,
16 tread boards, 6 posts and 2 handrails. It leaves unplaced 2 rail posts (inside the end frame) and
3 risers.

**What the answer changes.** Stringer count and lumber, tread boards, width, and whether it was a ramp. The
foot position decides the 0.55 m first step and the 5 unplaced parts.

Gene:

### Q13. Solar: rails or a frame under the modules, and how were they mounted?

```question
id: Q13
urgency: fidelity
order: 4
plain: What held up the solar panels on the roof: two rails, or a frame of wood or metal? And which side did people work from to install them?
context: The model shows the panels in one continuous row over posts rising above the roof, and the replay mounts them on two rails. With no gap between panels there is nowhere to stand beside them, so 14 of the 20 solar parts cannot be placed yet.
changes: What sits under the panels and where the installers stand; it decides whether the 14 unplaced parts get placed.
options:
  - Two rails (as the model does now)
  - A frame of wood or metal under them
  - Something else (describe below)
images:
  - questions/q13-2022-solar-eye.jpg | The model, 2022 east house: the row of solar panels (red) above the roof.
  - questions/diagrams/q13-solar-options.svg | Diagram, not a 3D render: the two options seen from the side.
  - questions/photos/2022-exterior-20.jpg | Real photo, 2022: the solar row above a mural wall.
```

(W13 Q5.)

**What the engine sees.** The Kit's modules sit over the frame columns that stand above the roof deck, in one
contiguous row (second picture above). The engine mounts panels on two rails (`install_panel`, SOLAR_PAINT.md).
It places 6 of 20 solar parts. The other 14 need side stations, because a contiguous row leaves no room to stand
beside a module.

**What the answer changes.** A frame under the modules, or access from a particular side, sets the
mount parts and where installers stand in `construction/solar.ts`. It decides whether the 14 unplaced parts
can be placed.

Gene:

### Q14. Upper decks: passed up by a relay on the first-floor deck, or by forklift / ladder?

```question
id: Q14
urgency: fidelity
order: 7
plain: How did plywood and beams get up to the upper floors: handed up by people standing on the lower floor, or with a forklift or a ladder?
context: In the replay, people stand on the first floor and pass material up hand to hand, and top beams go up with people climbing the rack's braces (you confirmed that part). If a forklift or ladder did the lifting, the replay's crew and steps for the upper floors change.
changes: Only the upper-floor steps of the build replay: who stands where and how long it takes.
options:
  - Hand to hand, people on the lower floor (as now)
  - Forklift or telehandler
  - Ladder
  - A mix (describe below)
images:
  - questions/q14-relay.jpg | The build replay, 2022: a top beam (red) handed up by people standing on the frame's braces.
  - questions/photos/2026-material-piles-loader.jpg | Real photo, 2026: a loader on site.
```

(W13 Q6.)

**What the engine sees.** Upper-deck material goes up by `pass_up`, a relay through people standing on the
first-floor deck. Top beams go up by the relay on the bracing (picture).

![Top beam (4.76 m) relayed up the frame bracing](questions/yb2022-top-beam-relay.png)

**What the answer changes.** A forklift or ladder route changes the upper-deck section's verbs and crew
stations, and the A+B pin.

Gene:

### Q19. Did the 2022 roofs have 2x4 framing under the plywood?

```question
id: Q19
urgency: fidelity
order: 6
plain: In 2022, did the roofs have 2x4 framing under the plywood (as in the 2026 photo), or did the plywood lie straight on the top beams?
context: The model's 2022 houses have no roof framing: every roof sheet lies straight on the top beams. The 2026 photo shows 2x4 framing going on before the plywood, so we want to know whether 2022 was built the same way.
changes: If yes, the 2022 roofs gain framing, sit about 13 cm higher, and the replay builds the framing first; if no, nothing changes.
options:
  - No framing in 2022: plywood straight on the beams
  - Yes, 2x4 framing as in 2026
  - Only on some buildings (say which below)
images:
  - questions/q19-2022-roof-eye.jpg | The model, 2022 east house: roof sheets (red) lying straight on the top beam (blue).
  - questions/diagrams/q19-roof-options.svg | Diagram, not a 3D render: the two options seen end-on.
  - questions/photos/2026-skeleton-2x4-frame.jpg | Real photo, 2026: 2x4 framing on the racks before the plywood.
```

(Parked; non-blocking. Added after W33.)

**What the engine sees.** the 2022 Kit scenes have no top plates, rafters or ceiling joists; every roof sheet lies straight on the
rack's top beams (0.22 / 2.48 / 4.757 m). The only "roof" features are the kitchen's 8 rail posts + 2 railings. The 2026 skeleton
photo (`evidence/2026-09-28-skeleton-stage-racks-2x4-frame-before-plywood.jpg`) shows 2x4 top framing before plywood.
**What the answer changes.** if 2022 had framing, the replays would sequence `install_top_plate`/`install_rafter` before the roof
deck and the protected `mars-2022` state would need a reconstruction-edit adding the members (roof deck rises ≈ 13 cm). If not,
nothing changes — the framing verbs wait for 2026.
Gene:

---

## Chiba 2024 front (W43 reconstruction edit, 2026-09-29)

### Q23. 2024: was Chiba six bays wide (about 22 m), or seven (about 25.6 m)?

```question
id: Q23
urgency: fidelity
order: 7
plain: In 2024, was Chiba's front six rack bays wide (about 22 m, as the model has it) or seven bays (about 25.6 m)?
terms:
  - bay | one 12 ft (3.66 m) span of rack beams; the model's Chiba 2024 is 6 bays wide and 3 deep
context: We rebuilt the 2024 front from your photo (vertical inset around the stairs, flaps leaning back on both sides), keeping the model's 6-bay width. But if the doors in the photo are ordinary 2 m doors and the landing sits at the upper floor, the whole front measures about 25–27 m wide, which is closer to 7 bays.
changes: If seven bays, Chiba 2024 grows by one bay (the flaps and the solarium get wider) in another reconstruction edit of the protected 2024 state; if six, nothing changes.
options:
  - Six bays (about 22 m), as modelled
  - Seven bays (about 25.6 m)
  - Something else (say below)
images:
  - questions/photos/2024-chiba-front.jpg | Real photo, 2024: the front with the inset, the stairs, solar on the left and plexiglass on the right.
  - questions/q23-2024-front-eye.jpg | The model after the edit, from eye height on the door axis (6 bays wide).
```

(Parked; non-blocking. Added by W43.)

**What the engine sees.** `app/history/photographic-corrections.ts frontage2024` keeps the hall at 6 × 3 bays (21.95 m × 10.97 m).
Measured in the 1000 × 497 px photo: the facade spans x ≈ 25–978 px at the ground (953 px), so at the flap bottoms 6 bays gives
≈ 43.4 px/m. The door leaves are 70 px tall and the landing (the upper-floor level, 2.46–2.55 m in the model) is 88 px above
the ground, which gives ≈ 35–36 px/m at the inset. The flaps' outer edges converge by about 10 % from bottom to top, so the
camera is roughly 25 m away and the inset should read only about 10 % smaller than the flap bottoms (≈ 39 px/m), not 18 %.
With 6 bays the door would be about 1.8 m tall and the landing 2.2 m; with 7 bays they would be 2.1 m and 2.6 m. The lens and
the crop are unknown, so this does not settle it. **Default:** keep 6 bays.
**What the answer changes.** A 7-bay answer widens the hall frame, the decks and both flaps by one bay (a new
`reconstruction-edit` of `mars-2024`, HISTORY_IDS.md). Every Chiba 2024 hashed id then changes, and the pins stay.
Gene:

### Q24. 2024: where was the solarium's side door, and which way did it open?

```question
id: Q24
urgency: none
order: 8
plain: The right-hand end of the 2024 solarium was a clear plastic wall with a door. Where in that wall was the door, and did it swing out, swing in, or slide?
terms:
  - solarium | the glazed lean-to under Chiba's right-hand front flap (your second 2024 photo)
context: Neither photo shows that end wall. The model puts a 1.2 m wide door next to the building (the only place a 2 m door fits under the sloping flap), standing open outwards, so people and the camera can go through it.
changes: The door moves, or is shown closed or sliding. Walking and camera routes into the solarium follow the door.
options:
  - Next to the building, swinging out (as modelled)
  - Next to the building, swinging in
  - A sliding door
  - Somewhere else (say below)
images:
  - questions/q24-2024-solarium-door.jpg | The model: the plexiglass end wall on 2x4 studs, with the door standing open (right).
  - questions/photos/2024-chiba-solarium-interior.jpg | Real photo, 2024: inside the solarium, with the 2x4 lattice roof, clear panels and rack frames.
```

(Parked; non-blocking. Added by W43.)

**What the engine sees.** The end wall is at x = +w/2 under the right flap (`frontage2024`). The door opening is at
dz 0.145–1.355 m in front of the frame and 0.22–2.22 m high, where the flap underside is still above 2.3 m. The leaf is the
pinned `chiba-solarium-door` (kind `plexiglass door` → engine `glass`), standing open 90° outwards, with `userData.door`
describing the opening. **Default:** as modelled.
**What the answer changes.** Only the door pieces move (new hashed ids for the jambs and header; the leaf keeps its pinned id).
A closed door would need a camera/walk rule for door objects (CAMERA_DIRECT.md: today openings are gaps).
Gene:

---

## Year build checkpoint 1: the other three 2022 houses (W38)

### Q25. 2022 Chiba: what were the two screens, and the 2.30 m wall on the same line as its 2.23 m wall?

```question
id: Q25
urgency: none
plain: In 2022, what were the two screens inside Chiba, and was there really a second, taller plywood wall along the same side?
context: The model shows two framed screens inside Chiba (about 1.75 × 0.96 m and 3.45 × 1.95 m) and a 2.30 m plywood wall drawn on the same line as its 2.23 m wall. The replay builds walls only from plywood panels of the known heights, so it leaves these out and says why.
changes: Screens would become placed items like furniture; a real second wall layer would get panels cut to 2.30 m and be built.
options:
  - Projection / display screens; one plywood wall on that side
  - Screens, and a second (taller) layer on that wall
  - Something else (say below)
images:
  - none | Two framed screens inside Chiba and a 2.30 m plywood wall drawn over its 2.23 m wall (YEAR_BUILD.md "Checkpoint 1").
```

(W38.) **What the engine sees.** Chiba 2022 has 2 screens + 2 bezels (1.750 × 0.962 m at 1.14–2.10 m; 3.450 × 1.950 m at
0.68–2.63 m) and a 10.972 × 2.300 m plywood wall at y 0.23–2.53 on the same beam line as its 10.972 × 2.230 m wall. None has a
material rule; the A+B plan leaves them unplaced with that reason. **What the answer changes.** Screens → placed items; a second
layer → a 2.30 m panel def, and chiba's A+B plan and pins move.
Gene:

### Q26. 2022 kitchen: how did people get onto the roof deck over the far bay?

```question
id: Q26
urgency: none
plain: In 2022, the kitchen's top deck covered only the bay farthest from its stair. How did people get up there to lay it?
context: The replay's builders reach the upper decks by climbing the frames at the stair end and walking along the beams. The kitchen's top deck is 7 m from the stair end, so the replay leaves it out and says why.
changes: If they climbed the far end (or used a ladder), the replay builds that top deck too.
options:
  - Climbed the frames at the far end
  - A ladder
  - Walked across the beams from the stair end
  - Don't know
images:
  - none | The kitchen's top deck covers bay 0 only (3 strips), 7 m from its stair end.
```

(W38.) **What the engine sees.** Kitchen 2022's 4.757 m deck covers bay 0 only (3 strips). The D1 / D2 crews climb only the
stair-end frames and walk one beam's walkway, so the level is reported unplaced. **What the answer changes.** A D2 start from
either end; kitchen gains 3 strips; its A+B plan and pins move.
Gene:

### Q27. 2022 kitchen and west house: what were the low walls (0.90 m and 1.00 m)?

```question
id: Q27
urgency: none
plain: In 2022, the kitchen had a waist-high plywood wall (0.9 m) and the west house a 1 m one. Were these counter fronts or railings, and how were they made?
context: The replay cuts plywood wall panels only to the full wall heights (2.23 and 2.20 m), so it leaves these two low walls out and says why.
changes: A half-height panel rule would build them.
options:
  - Counter / bench fronts, plywood on a 2x4 frame
  - Railings with plywood
  - Something else (say below)
images:
  - none | A 0.90 m plywood wall in the kitchen (y 0.30–1.20) and a 1.00 m one in the west house (y 0.30–1.30).
```

(W38.) **What the engine sees.** Kitchen: 3.658 × 0.900 m at (1.17, 6.31), y 0.30–1.20; west-house: 3.658 × 1.000 m at (−6.31,
1.17), y 0.30–1.30. No panel def of those heights: unplaced with the reason. **What the answer changes.** A half-height panel
rule; both houses' A+B plans and pins move.
Gene:

---

## Answered (kept for the record; not open)

### A1. How were the top beams (~4.76 m) hung? (HANDOFF Q7, W7)

```question
id: A1
urgency: none
status: answered
plain: How were the long top beams (about 4.76 m up) hung?
context: Answered: two people climb the frame's braces and each holds one end of the beam while setting it.
changes: Already in the build replay.
```

**Gene (2026-09-29):** two people climb the upright on its cross braces, and each holds one side of the beam
while setting it. The `hang_beam` / stance mechanism is the real method (OWNER_DECISIONS.md;
OWNER_FEEDBACK §14).

### A2. Reach-down: accept 0.5 m, or model a lying-down receiver? (HANDOFF Q11, 03:50 EDT)

```question
id: A2
urgency: none
status: answered
plain: When someone on a floor takes a load from below, may they only kneel (reach down 0.5 m), or also lie on their stomach at the edge?
context: Answered: kneeling stays the default, and lying on the stomach at the edge was added as a further posture.
changes: Already in the build replay.
```

**Gene (2026-09-29):** the 0.5 m kneel rule stays the default. Add a prone receiver (lying on the stomach at
the deck edge, then rising to knees and feet holding the load) as a further posture (OWNER_FEEDBACK §13).
W28 and W29 landed it.

**A3 — North axis: which way is north on site? (was Q3; the answered card is Q3 above)**

**Gene (2026-09-29, OWNER_FEEDBACK §15):** the long axis of the 2020 tire ring (world X) runs north–south.
**Sign, from evidence (W42):** world **−X is north** in the 2020 scene (`NORTH_AZIMUTH_OFFSET = −90`,
`engine/env/sun.ts`). The March 4 2020 aerial `DJI_0079.JPG` was taken at 10:10:34 PST (EXIF), with
`FlightYawDegree +99.4`, so the camera faces about east. The 2020 scene is laid out as this photo sees it: the Portal →
container → canopy → Forest row runs left → right (+X), the geodesic sphere (z = +17) is nearest and the RV camp
(z ≈ −50) is far. `solarPosition()` puts the sun at azimuth 143°, elevation 43°, so shadows fall toward 323° (NW),
behind-left of an east-facing camera. The photo shows exactly that: the sphere's and the Forest racks' shadows fall
left and slightly toward the camera. The tire line runs left-right across the frame, which is N–S for this heading.

![DJI_0079, 2020-03-04 10:10 PST, camera facing ~east](questions/q3-dji0079-march4-2020.jpg)

Proven harmless to construction: only `camera/` and `api/` (via camera) import `env/sun.ts`, and `physicalView()`
excludes env (`engine/test/env-sun.test.ts`, "the site bearing cannot move a construction pin"). The five
`deploy/perf-walk.mjs` pins and every year-build pin re-ran green at −90.

**The other years do NOT share this frame** (W42, measured against drone stills with XMP yaw + solar-shadow checks;
2020 and 2021+ are the same parcel, and the 2020 tire ring lies west of the later campus):

| Scene | North in world | Evidence | Confidence |
| --- | --- | --- | --- |
| 2020 (studio-2020) | −X (offset −90°) | DJI_0079 above | high |
| 2026 CAD | −X turned ~33° toward −Z (offset ≈ −57° ± 8°) | 2026 DJI_0005 (yaw −91.7, near-nadir, 3-19 14:31) and DJI_0098 (nadir), rotated north-up vs the CAD plan: Chiba's hall axis, the Chiba → container row and the RV arc are all ~33° off | high |
| 2025 Kit | −Z (offset 0°) | 2025 pano 16:14, sun as azimuth reference; Chiba N of the drone, steps facing S, kitchen SW | medium (±20°) |
| 2024 Kit | Chiba alone fits −Z; the kitchen and RV ring are on the wrong side of Chiba | DJI_20240122144543_0335_D nadir, oriented by the tire ring | medium-high |
| 2023 Kit | unverified (authored like 2024) | no still with telemetry | — |
| 2022 Kit | authored as −Z, but **mirrored** (the real pinwheel turns clockwise, the Kit's counter-clockwise) | 2022 DJI_0829 (yaw 110.2, pitch −86.4) | high on the mirror |
| 2021 Kit | authored as −Z | no usable February still | low |

![2026 CAD plotted −X-up next to DJI_0098 and DJI_0005 rotated north-up](questions/q3-2026-cad-vs-drone-north-up.jpg)

So one global offset cannot be right for every year. −90° is exact for 2020 and is the nearer of the two simple
values for 2026 (33° off instead of 57°). CAMPUS_SCENE.md's "North = −z" for the CAD comes from assembly names
and is about 57° off. Open follow-up (lead / Gene): a per-year site bearing (2026 ≈ −57°), and whether the 2022 mirror
and the 2024 kitchen/RV side are scene edits (HISTORY_IDS reconstruction edits), since no rotation fixes them.

