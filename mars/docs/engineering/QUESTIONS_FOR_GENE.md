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

Status: **14 open blocks** (16 questions; two pairs were duplicates and are merged) and **2 answered**.

---

## Layout of the year scenes

### Q1. 2022: is the south-west corner passage really closed by the west-house table?

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

**What the engine sees.** In both years, two trailers of the trailer circle sit under Chiba's roof, inside
its footprint. These are the tilted orange-brown boxes inside the pink roof area at the top of each picture.

![2023 top-down, engine prisms](questions/lab-year-2023-top-prisms.png)
![2024 top-down, engine prisms](../../viewer/e2e/baselines/lab-year-2024-top-prisms.png)

**What the answer changes.** If this is a scene error, the trailers move out in `scenes.ts`, and
`mars-2023` / `mars-2024` are re-seeded (`reconstruction-edit`, id aliases). Chiba's interior becomes walkable
where they stood. If it is real (the trailers parked under the roof), nothing changes.

Gene:

### Q3. North axis: which way is north on site?

**What the engine sees.** World −Z is taken as geographic north (`NORTH_AZIMUTH_OFFSET = 0`,
`engine/env/sun.ts`). No site bearing was found. The NOAA sun, the shadows and the camera's "sunset behind"
windows all follow from this.

![2022 shadows under the assumed north](../../viewer/e2e/baselines/lab-year-2022-top-prisms.png)

**What the answer changes.** It sets one constant. Every shadow, every sunset / sun-behind camera direction and
the studio lighting rotate by the offset. Directed camera tracks re-plan. Construction pins are not expected to
move, because the environment is outside `physicalView()` (inferred, not yet tested).

Gene:

### Q4. Ground datum: is the ground at y = 0 or at −0.16 m?

**What the engine sees.** The Kit stands every piece on y = 0. The published year scenes and the studio put the
ground at −0.16 m (`GROUND_Y`, `engine/campus/extract.ts`), so rack posts start 16 cm above the drawn ground.
The year build runs on the Kit datum (y = 0). The studio draws rebuilt racks 0.16 m below the Kit's.

![Finished first bay, frame feet at the Kit datum](questions/yb2022-frame-feet.png)

**What the answer changes.** One datum for build takes and the studio. The studio's 16 cm offset disappears.
Re-basing moves every year-build pin once (first bay, whole skeleton, A+B `ddb634d6…`), and the takes are
re-recorded.

Gene:

---

## The rack skeleton

### Q5. The "9 ft" part: is it a frame (upright) or a beam, and what are its dimensions?

**What the engine sees.** Gene's size list was 8 / 9 / 12 / 19 ft. The model library has 8, 12, 16 and 19 ft
frames and 12 ft beams, and nothing that is 9 ft. `world/catalog.ts` carries `upright-9ft` marked `provisional`,
with an assumed 4 ft depth. The flagship builds with `beam-9ft`. No image: nothing 9 ft exists in any scene
to show.

**What the answer changes.** If it is a beam, the provisional `upright-9ft` is removed and the flagship stands
as is. If it is a frame, it needs a depth and a seat pattern (catalog entry, `mars-assembly` rules version).
The provisional flag goes either way.

Gene:

### Q6. Beam heights: keep the Kit's 0.22 / 2.48 / 4.757 m, or snap to the real hole pitch?

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

(Merges HANDOFF Q10 and W13 Q1.)

**What the engine sees.** The Kit draws each deck as 4 ft × 15 ft plywood strips laid at beam height,
centred on the beam centreline (through the frame planes), with no joists. The engine lays them on top of the
beams, 5.7 cm above the Kit's surface.

**What the answer changes.** On the beams: nothing changes. A ledge: a new seat rule. Sheets on joists:
the deck section gains a 2x4 joist layer, and 2x4 framing is Claude's checkpoint-1 work, so this answer shapes
it directly. See also Q8.

Gene:

### Q10. How was a 15 ft deck strip made from 4x8 sheets?

(W13 Q2.)

**What the engine sees.** Each strip is made as 6 + 6 + 3 ft pieces, jointed on beams (`cut` at the cutting
station, 81 deck pieces for 27 strips).

**What the answer changes.** For example 8 + 7 with blocking: different cuts, piece counts and blocking parts
in `parts-b.ts`.

Gene:

### Q11. Wall panels: outside or inside the beam line, and how were they fastened at the aisles?

(W13 Q3.)

**What the engine sees.** The engine hangs panels outside the beam line, 3.5–4.8 cm off the Kit's drawing
(25 panels on 4 walls, `construction/wall.ts`). The Kit's murals are painted on these panels (second picture
above).

**What the answer changes.** Inside the beam line means a different panel plane and different fastening
stations. At the aisles, the fastening rule decides what a panel bears on.

Gene:

### Q12. The rack-house stair: width, stringers, treads, and where its foot stands

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

(W13 Q6.)

**What the engine sees.** Upper-deck material goes up by `pass_up`, a relay through people standing on the
first-floor deck. Top beams go up by the relay on the bracing (picture).

![Top beam (4.76 m) relayed up the frame bracing](questions/yb2022-top-beam-relay.png)

**What the answer changes.** A forklift or ladder route changes the upper-deck section's verbs and crew
stations, and the A+B pin.

Gene:

---

## Answered (kept for the record; not open)

### A1. How were the top beams (~4.76 m) hung? (HANDOFF Q7, W7)

**Gene (2026-09-29):** two people climb the upright on its cross braces, and each holds one side of the beam
while setting it. The `hang_beam` / stance mechanism is the real method (OWNER_DECISIONS.md;
OWNER_FEEDBACK §14).

### A2. Reach-down: accept 0.5 m, or model a lying-down receiver? (HANDOFF Q11, 03:50 EDT)

**Gene (2026-09-29):** the 0.5 m kneel rule stays the default. Add a prone receiver (lying on the stomach at
the deck edge, then rising to knees and feet holding the load) as a further posture (OWNER_FEEDBACK §13).
W28 and W29 landed it.
