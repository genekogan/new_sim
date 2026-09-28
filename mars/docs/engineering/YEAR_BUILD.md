# Year build — phase A: the skeleton stage from material piles (owner feedback §7)

2026-09-28 (W7). **HYPOTHETICAL**: the construction *order*, the piles and the crew are a plausible
Mars-style build generated from the canonical scene and the engine's rules, not a documented history.
The acceptance target is the year's protected checkpoint (`mars-<year>`): every part the generator
sequences must end installed where the checkpoint has it; everything else is reported, never faked.

Mars assembly model v1, approximate — rule-based plausibility, not structural engineering.

## Code map
| File | Role |
| --- | --- |
| `engine/campus/assembly.ts` | assembly graph of a year scene: frames, beams, opaque features, relations, `unclassified` report |
| `engine/world/catalog-stock.ts` | reconstruction frames `upright-<ft>ft-kit`, whole-foot 2x4 / 2x6, 4x1…4x7 plywood, bundles / stacks, `cutting-station` (one additive registration in `catalog.ts`) |
| `engine/campus/bom.ts` | bill of materials (phase A exact, phase B estimates, unresolved), bundles, pile yard placement |
| `engine/construction/bundle.ts` | `take_from_bundle` (unbundling), `bundleEntity`, `lyingPose`, `spotBlocker` |
| `engine/construction/cut.ts` | `cut` at a cutting station (kerf, offcuts, refusals) |
| `engine/construction/stance.ts` | frame stances (bracing as a ladder), `climb_stance` / `leave_stance`, `hold_frame` / `let_go`, `hang_beam`; invariants `stanceAccessOk`, `hangHandsInReach` |
| `engine/construction/rules.ts` | stability v1.1 (held uprights exempt from their group's height count) |
| `engine/campus/sequence.ts` | skeleton sequence generator → `SequenceTemplate` + scenario entities + targets + `unplaced[]`; `yearBuildScene` |
| `engine/scenarios/year-build.ts` | setup (publish `mars-<year>`, fork, commit piles + crew, bind), registry / invariants, `compareToCanonical` |
| tests | `year-assembly`, `year-stock`, `year-hang`, `year-build` (`engine/test/`) |

## The chosen year: 2022 (first building: east-house)
The Kit draws a pallet-rack frame as two `rack upright` posts + an `upright crossbar` + diagonal
`upright bracing` rods; a catalog upright is the whole two-column frame. The graph maps a crossbar whose
ends sit on two posts to one catalog frame when the height and column spacing match.

| year | components | catalog frames | beams | what does not map |
| --- | --- | --- | --- | --- |
| 2020 | 1054 | 6 | 0 | the Portal / Forest racks hang beams on the frames' centre lines and across bays, frames of 10 / 13 ft and 0.8 m deep: 364 rack parts unclassified (reasons in the graph) |
| 2021 | 1152 | 52 | 248 | — |
| **2022** | 1168 | **48** | **216** | — |
| 2023 | 1481 | 60 | 300 | — |
| 2024 | 1555 | 62 | 306 | — |
| 2025 | 1360 | 62 | 270 | 39 (19 ft central uprights, beams off posts) |

2022 is the simplest year whose racks are catalog frames: fewest frames and beams of any mappable year,
and its four rack houses are one template (12 frames of 16 ft × 3 ft in 4 frame lines × 3 rows, 54 beams
of 12 ft at the Kit levels 0.22 / 2.48 / 4.757 m, a plywood deck on each level, an end stair). 2021's outdoor
kitchen is a smaller rack (10 frames) but a one-level 8 ft utility shelf with no upper floor or stair — not
the skeleton pattern of the owner's photo. The generator is parameterised by year and building.

## Assembly graph (`assembly.ts`)
- Nodes: `upright` (def `upright-<ft>ft-kit`, components = 2 posts + crossbar + 6 bracing rods), `beam`
  (catalog length ±2 cm), `feature` (deck-sheet, wall, stair-part, solar, roof, railing, door, window,
  fixture, vehicle, context) — opaque in phase A.
- Relations (`from → to` = "from needs to"): frame `rests-on` ground; beam `connects-to` each of its two
  frames with socket `col<l|r>@<seat>` (column in the frame's canonical yaw, seat above the post base; the
  seat must be a seat of the frame's def); deck sheet `rests-on` / `supported-by` the beams under it (the
  Kit draws sheets at beam height, up to 11 cm into the beam — phase B resolves joists); other features
  `rests-on` ground when they start there.
- Unclassified (never forced): a crossbar not on two free posts, a post with no crossbar partner, bracing
  outside any frame, a beam whose ends miss the posts, a cross beam (both ends on one frame), a seat that is
  not a seat of the frame, a non-catalog height / spacing, a Kit name with no rule.
- 2022: 48 frames, 216 beams, 102 deck sheets, 84 stair parts, 60 solar parts, 19 walls, 10 roof parts,
  100 fixtures, 144 vehicle parts, 1 door; 0 unclassified. Deterministic, topologically ordered (Kahn).

## Reconstruction frames: why `upright-16ft-kit`
The Kit hangs beams at 0.22, 2.48 and height − 0.12 m (beam centres above the post base) — photo
estimates on no uniform hole pitch: 0.22 m is below the stock planning seats (first at 12 in), 2.48 / 4.757 m
are 4.2 / 3.2 cm off the nearest 6 in seat. `upright-<ft>ft-kit` = the stock frame + seats at exactly those
levels, so beams can hang where the checkpoint has them (1 cm acceptance). Provisional; asked in PROGRESS.

## Bill of materials and piles (`bom.ts`, `catalog-stock.ts`)
2022 east-house:
- phase A (exact, from the graph): 12 × `upright-16ft-kit`, 54 × `beam-12ft`.
- phase B estimates: 79 × `plywood-4x8` (27 deck strips of 1.21 × 4.57 m = one full sheet + one cut to
  7 ft each; 4 plywood walls stood up in sheets cut to 2.20 / 2.23 m) — 52 cuts; 10 × solar panel 1.59 × 1.07 m
  (own pile, def pending W8's `solar.ts`).
- unresolved: 21 stair parts (no material rule yet).
- bundles: 2 stacks of 6 frames, 3 stacks of beams (20, 20, 14), 4 plywood bundles (24, 24, 24, 7), and a cutting station.
A bundle is ONE static obstacle entity (`kind: fixture`, `obstacle`) sized for its full capacity; its
`contents` = `{ food: 'stock:<piece>', fraction, count }` (count = pieces left). Capacities are chosen to
look like the evidence photos (plywood ~24 sheets per strapped stack; long lumber in strapped units), not documented.

**Yard placement** (`placePiles`): all piles on one side of the building, outside its work zone (footprint +
6 m at the ends where frames are laid out and raised, + 3 m at the sides), each pile's plot = the pile, its
take-out strip (the piece lies 0.8 m beside it so a carrier fits between) and a 1 m access margin — the plots'
margins are the yard's aisles; plots clear of every ground-blocking obstacle of the build scene and of each
other. Deterministic 0.5 m lattice per side (nearest to that side's anchor first); the side with everything
placed at the least total distance wins. No room → `refused` with the plot size. 2022 east-house: the +x side,
0 refused.

## Verbs
- `take_from_bundle {crew, bundle, piece, to}` — crew = the piece's carry crew; stations on the spot's far
  side; 4 s pull; the piece is created lying on the spot (`stored`), the count drops, an empty bundle goes
  (`canonicalEntityOrder`). Refusals: `bundle.unknown / empty / piece-exists / too-far / spot-occupied`
  (names what lies there), `crew.size`, `actor.holding`, `bundle.station-unreachable`. The pull itself is
  not animated.
- `cut {actor, station, stock, cuts[], offcut?}` — one person; stock lying ≤ 2.5 m from the station; targets
  of the stock's family (plywood across its length only); Σ lengths + 3 mm kerf per cut ≤ length (+5 mm: the
  last piece may be the end); remainder ≥ 0.3 m → an offcut catalog piece (largest whole size ≤ remainder +
  1 cm) stored in the out-feed, else waste; mark 3 s + per cut 3 s handling + saw at 0.2 m/s across the piece
  (4 ft plywood 6.1 s, 2x4 0.45 s); outputs in out-feed slots 0.8 m apart behind the bench. Refusals:
  `cut.not-station / stock-unknown / stock-not-at-station / wrong-stock / insufficient` ("a 16 ft 2x4
  (4.877 m) cannot yield 8 ft + 8 ft + 4 ft (6.096 m + 2 kerfs = 6.102 m)") `/ piece-exists / station-occupied`
  (names the piece in the out-feed), `reservation.conflict` for a second cut at a busy station.
- **Frame stances** (`stance.ts`) — the owner's "uprights' bracing works as a ladder" for any seat height:
  `stance:<upright>:<l|r>:<f|b>@<feet>`, body 0.30 m inward of the column on the bracing, 0.36 m off the frame
  plane on face f / b; feet on a bracing node of the Kit frame (0.25 + 0.7k, 0.91 + 0.7k, ≤ height − 1.2 m).
  `climb_stance` from a foot point just outside the column, 0.25 m behind the frame (in the aisle / outside),
  0.35 m/s up the edge and round the column; below 1 m of feet a climber counts as on the ground (level 0,
  walkers route round them); `leave_stance {to?}` waits on the frame at 1 m until the foot is clear.
  Held (not beam-stable) frames: feet ≤ 1.0 m only; one column face carries several people only ≥ 1.9 m apart;
  the body (r 0.22, 1.75 m) may not intersect another component. Hands (from `body/model.ts`): ≤ feet + 2.06,
  ≥ feet − 0.5 (one hand stays on the bracing — stricter than the model's 1.0 m kneeling reach-down), ≤ 0.8 m
  horizontally from the feet (+1 cm tolerance in the invariant); the plan checks the farther hand.
  A low stance (feet < 1 m) counts as level 0 so walkers route round the climber; `leave_stance` checks the climb
  foot before stepping down to it (and asks an idle person standing there to make way, as `walk_to` does).
- `hold_frame {actor, item, at}` / `let_go {actor, item}` — take over holding a held frame from any spot
  ≤ 1 m from it (the generator uses 0.6 m behind it, on the unbuilt side); let go while ≥ holdCrew others
  hold it or it is beam-stable (`hold.last-holder`).
- `hang_beam {beam, a, b, column, height, installers[2], givers?[2], relay?[2]}` — the beam lies on its
  stage axis 0.457 m outside the seat line (the centre of the 3 ft gap between rows; as far outside an outer
  line), anywhere along it within 25 m; the lifters pick it up, walk it in single file along the axis at
  0.6 m/s (body clearance checked on the level grid, `hang.walk-blocked`), raise it beside the line, slide it
  0.457 m onto the two column seats and hook it (1 s). Seat ≤ 1.2 m: the two installers do it from the ground,
  standing 0.35 m beyond its ends and holding it at the ends (hands at the end and 0.3 m in).
  Higher: two ground givers lift it to ≤ 2.06 m (body model); the installers on stances of the two frames (same column,
  faces toward each other) take it (≥ feet − 0.5); optionally a relay pair lower on the same faces takes it
  first and raises it. Hand-offs: givers → first aloft pair at max(their feet − 0.5 + 0.05, 1.5 m) (≤ 2.01 m);
  relay → installers at the installers' feet − 0.45 m (2.56 m for installers at 3.01 m, relay at 0.91 m).
  Every hand-off height is checked (`hang.gap` names both heights and says "add a relay");
  swept path against everything but the two frames (`hang.path-blocked`). Hands published every tick
  (`human.hands`, grips `hang-give-i` / `hang-relay-i` / `hang-hook-i`).
- Stability v1.1 (`rules.ts`): an upright of a group that is still held by ≥ holdCrew people is exempt from
  the group's "beams at N heights on both columns" count (the upright being judged never is) — otherwise
  hanging a new held frame on a stable run would un-stabilise the frames already released. Existing pins
  unchanged.

Why stances and not the existing verbs: `connect_beam` refuses seats above standing reach (2.06 m, body model) (every Kit rack year hangs
beams at 2.48 and 4.757 m); W2's climb links end on an installed beam's end (no beam, no link) and its walkways
top out at 2.54 m (4.757 m is 2.22 m above them); the forklift lifts to 3.2 m. The Kit's diagonal bracing is
the ladder the owner describes.

## Generator (`sequence.ts`) and ordering rules
Frames stand in frame lines (coordinate along the frames' normal) × rows (along their across axis); a beam
joins frame (k, r) to (k + 1, r). Crew of six, no forklift (the forks reach 3.2 m, the top beams sit at 4.76 m
and the inner lines are not reachable by the truck): 0–1 carry and give, 2 and 5 hold then relay, 3–4 install
on the bracing. Per bay k–k+1, row by row (the skeleton grows in tranches from one end):
1. frame (k+1, r) [and (0, r) for the first bay] off its stack, carried to lie over the not-yet-built bays
   (line 0 lies outward), raised by two, taken over by a holder 0.6 m behind it, the raise crew lets go
   one at a time;
2. the two low beams (0.22 m) hung from the ground by the two who carried them;
3. the two middle beams (2.48 m): installers climb to 0.91 m (held frames), givers hand up;
4. release the new frame (and the first) — beam-stable at two levels on both columns;
5. the two top beams (4.757 m): installers at 3.01 m on the stable frames, the two former holders as a relay
   at 0.91 m, givers hand up, relay → installers hook.
Every beam is staged at the building's line-0 end on its stage axis and walked in: the carry crew straddles
a beam (one carrier each side), and beside a bay one of them would stand on the seat line or in the 0.91 m aisle.
Steps depend on each actor's previous step plus physical preconditions (frames raised / held, beam staged,
climbs done, the take-out spot cleared by the previous carry, one `let_go` at a time; after a hand-up the givers
step out of the aisle before anyone climbs down into it); independent work overlaps (carriers fetch the next beam
while installers climb). Rules re-checked by every verb at run time. `yearBuildPlan(…, { bays })` builds a tranche
(the first N bays); what lies beyond it is reported as "outside the requested tranche".

**Runner change (`sequence/runner.ts`, one condition):** a ready step whose resources are held by an ambient
make-way walk (`<person>:make-way:<tick>`, `locomotion/walk.ts makeWay` nudging an idle person out of a walker's
way) waits for it instead of failing with `reservation.conflict` and aborting the sequence. Long sequences with
idle crew hit this; the pinned scenarios never did (their pins are unchanged).
No cuts: the skeleton uses frames and beams as stocked.

## First run: 2022 east-house (`year-build.test.ts`)
Scene: `mars-2022` cropped to 35 m around the house, the house removed, ground at the Kit datum — not an open
fork; the build fork declares that derived static base (`mars-2022:build:east-house`). Crew of six, no forklift.
| run | steps | ticks (simulated) | violations | parts at the canonical pose | wall (machine load ~20) | pinned final hash |
| --- | --- | --- | --- | --- | --- | --- |
| first bay (tranche, in the suite) | 198 | 41 019 (2 051 s) | 0 | 24 / 24 (6 frames, 18 beams), max 0.57 mm, 0° | 11–22 s | `ad844b78…248121` |
| whole house (`YEAR_BUILD_FULL=1`) | 552 | 116 477 (5 824 s ≈ 97 min) | 0 | 66 / 66 (12 frames, 54 beams), max 0.57 mm, 0° | 38–53 s | `14d5c768…30c89a` |

Whole house, by verb: 66 `take_from_bundle`, 66 `carry`, 12 `raise_upright`, 12 `hold_frame`, 24 `let_go`,
54 `hang_beam` (18 from the ground at 0.22 m, 18 handed up at 2.48 m, 18 through a relay at 4.757 m),
108 `climb_stance`, 108 `leave_stance`, 12 `release_support`, 90 `walk_to`; no `cut`. Settled at the end: nobody
on the frames, nobody holding anything, both frame stacks and all three beam stacks emptied, plywood untouched.
Unplaced (phase B, each with its reason): 27 deck sheets, 21 stair parts, 20 solar parts, 4 walls (the tranche
adds 6 frames + 36 beams "outside the requested tranche"). The whole house is gated because its ~40–55 s rehearsal
would make it the suite's longest file (the suite is ~57 s wall with the tranche).

## Approximations / not modelled
- Stances are points on a Kit-shaped bracing lattice; climbing paths are not body-checked (as W2's climb
  links); nobody clips on or checks load on a frame.
- A beam is walked in and raised by pose interpolation along a checked path; its balance on two hands is
  not checked; hand-offs are instantaneous grips after a 0.5 s take.
- The pull off a bundle is not animated (the piece appears lying beside it after 4 s); a bundle's box stays
  full size until it is empty.
- The build ground is the Kit datum (y = 0), 0.16 m above the studio ground of the published year scenes.
- The crew is generic; no fatigue, no breaks, nobody else on site.

## Phase B needs (as W7 left them)
Deck sheets (plywood strips on beams: the Kit's 15 ft strips → sheets + cuts; joists the Kit does not draw),
the stair / ramp (a site-built flight of the Kit's width, stringers, treads), plywood walls and screens
(install verb with support rules), roofs / ceilings, doors, windows, railings, solar panels on roofs (W8's
verbs, own piles), paint (W8), fixtures placed as items; `cut` in the flow (the BOM's cut list); the other
three 2022 houses and the other years (2021, 2023–25 map; 2020 needs non-catalog rack parts); a director-run
take per year with camera tracks and the studio "Watch it being built" picker.

# Phase B — floors, stair, walls, solar (W13, 2026-09-28)

**HYPOTHETICAL** order, piles, crew and choreography; every material rule below is **PROVISIONAL** (the Kit
draws decks, stairs, walls and solar as boxes, several through each other). The acceptance target stays the
protected `mars-2022` checkpoint, through each rule's stated physical placement.

## Code map (phase B)
| File | Role |
| --- | --- |
| `engine/world/catalog-phase-b.ts` | notched 4x6 / 4x3 deck pieces, wall panels 4 ft × 2.23 / 2.20 m + a ripped 3 ft panel, Kit stair lumber (2x12 stringer cut to 4.059 m, 2x10 + 2x8 tread boards, 2x4 posts / handrails), the Kit 2022 solar module `solar-panel-107x163` (1.625 × 0.045 × 1.072 m), bundles, a scrap pile; `NOTCH`, `CUT_TO_ORDER`, `kitStringerGeometry` (registered through catalog-stock.ts; catalog.ts unchanged) |
| `engine/campus/parts-b.ts` | the material rules: Kit feature node → engine parts with target poses, Kit refs with the stated offsets, `unplaced` with reasons, the Kit stair descriptor |
| `engine/campus/bom.ts` | `billOfMaterialsB` (one stock piece per part + the cut list), `morePiles` (phase-B bundles placed after the unchanged phase-A yard), extra plots (scrap pile) |
| `engine/campus/sequence-b.ts` | the phase-B generator (sections D0, D1, D2, S, W, P, END) appended to the phase-A template |
| `engine/construction/passup.ts` | `pass_up`: a sheet / rail / panel to a given level, optional relay kneeling on a deck, receivers walking alongside on a deck, fastening |
| `engine/construction/setpart.ts` | the set-part engine + `install_stringer`, `install_stair_part`; the Kit stair link + contributor; `kitPartHandsInReach`, `kitPartsSupported` |
| `engine/construction/wall.ts` | `install_wall` (fastening lines, reach per band) |
| `engine/construction/moves-b.ts` | `climb_stair` / `leave_stair`, `step_onto_beam`, `stack_offcut`; `stairWorkOk` |
| `engine/construction/{rules,deck,access,cut,contributor,frame}.ts` | additive: Kit beam-deck span rule, notch exemption in sweeps, rips + notch time, standing plywood is not a deck, `stairwork:` skipped by `frameAccessOk` |
| `engine/scenarios/year-build.ts` | `yearBuildSetup(…, { phaseB })`, `yearBuildRegistryB`, `yearBuildBInvariants` (cached support-chain invariants), `cachedContributor`, `compareB`, `kitOffsets` |
| `engine/test/year-build-b.test.ts` | plan / BOM / unplaced / determinism, report-only for the other 2022 houses, the full A+B run (YEAR_BUILD_FULL=1) |

## Phase B material rules (all provisional)
- **Deck strips** (Kit `plywood deck sheet`, 4 ft × 15 ft across a whole house): 3/4 in plywood straight on the rack
  beams (**rules.ts `beamDeckRule`**: sheets bearing only on beams of reconstruction frames may span ≤ 4 ft; the Kit has
  no joists; deck.ts's 24 in rule stays for everything else). 8 + 7 ft is impossible with beams every 3 ft (one piece
  would cantilever 0.61 m, deck.ts allows 12 in), so the strip is **6 + 6 + 3 ft jointed on beams** (4x8 → 4x6 + 4x2
  offcut; 4x8 → 4x3 + 4x5 offcut), split from the side with room. Strips whose long edge lies on a frame line are
  drawn by the Kit through the frame: those pieces are **notched** at the station (30 s jigsaw) and access.ts lets a
  notched part share ≤ 2 in of its edges with a reconstruction frame. Offset: the sheet rests ON the beams — its top
  +5.7 cm above the Kit's (the Kit centres its sheets on the beam centreline, 3.8 cm below the beams' top).
- **Plywood walls**: 4 ft panels stood up and cut to the Kit height (2.23 / 2.20 m); a 15 ft wall closes with a panel
  ripped to 3 ft (**cut.ts rips**). Placed against the outer face of the beam line / frame plane the Kit centres the
  wall on (offset 3.5 cm beam line, 4.8 cm frame plane). **`install_wall`** fastening rule: screwed to the members
  right behind it (≤ 1.2 cm) — beams (a line each), frames (column + bracing), deck edges; needs a line in its bottom
  and its top third, each reached by a crew member (−0.5…2.06 m from their feet, ≤ 0.8 m out); the ground walls' top
  line (the 2.48 m beam) is screwed from the first-floor deck; the upper wall is raised to two kneeling on that deck.
- **Kit stair** (2022 rack-house template only: 8 treads, 4.452 m wide, going 0.457, rise 0.2775): six **2x12
  stringers** (14 ft cut to 4.059 m, two inside each end-frame row) whose foot is on the ground and whose top end is
  bolted to the end frame (rule `stringerRule`); each Kit tread = **2x10 front + 2x8 back** (0.419 m, centred; two 2x10
  would overlap the next tread in plan) bearing on ≥ 2 stringers (`treadRule`; the sawtooth cuts are not modelled);
  the top tread's back board notched; **posts** = 2x4 cut to 0.85 m bolted to the tread ends 1.9 cm outboard of the
  Kit's (`postRule`); **handrails** = 2x4 on edge on ≥ 2 post tops (`handrailRule`). The walking link is usable once
  every stringer and tread is in and the landing deck exists.
- **Solar**: the Kit 2022 module is 1.625 × 1.072 m (the 1.59 × 0.43 box is its tilted envelope): new
  `solar-panel-107x163` (in catalog-phase-b.ts; W8's catalog-solar.ts is W12's) tilted 13.75° about its short edge,
  on a **pair of panel rails** on the roof deck under it (rails shared by two neighbouring panels). Offset: +3.2 cm
  above the Kit (it draws the module's low edge into its deck, with no rails).

## Unplaced by rule (with the reasons)
- 2 **rail posts** the Kit draws inside the end frame (its column is the post there);
- 1 **riser** that is a 6.5 cm sliver; 2 full **risers**: a riser stands in the slot between two treads 1.9–2.5 m up
  and the set-part crews bring boards in only from the front (through the tread below); a lengthwise insertion from
  the stair's side is not modelled;
- **every other solar panel** (and its cell overlay): W8's `install_panel` stands its crew beyond both ends of the
  tilt axis — inside the neighbouring panels' places (0.99 m from the centre vs a 1.10 m pitch); once a neighbour is
  tilted there is no station, so in a contiguous row only alternate panels can be mounted. Needs side stations in
  `install_panel` (solar.ts, W12's).

## Verbs added (phase B)
- `pass_up {part, to:{x,z,yaw,height}, edge, out, givers, relay?, relayAt?, receivers, receiverAt?, follow?, give?, push?, side?, fasten?}`
  — hand_up's choreography to a *given* level (hand_up rests a part on the highest members under it, i.e. the roof
  beams once the skeleton stands): givers raise it outside the edge (or push it in low over a 0.22 m beam), an optional
  relay kneeling at a deck edge takes it and stands up with it, receivers (on walkways, or kneeling on a deck and
  walking alongside it) lift it over the members and feed it in; plywood is screwed down in the same action (receivers
  + a second person, or the receiver alone — provisional). Hand points use hand_up's slots, so `liftHandsInReach`
  checks every tick. Refusals: `passup.*` (not-staged, no-rest, occupied, too-high "add a relay", giver/relay/receiver
  reach, body-gap, path-blocked, fasten-reach, follow-on-beam …).
- `install_stringer`, `install_stair_part`, `install_wall` (setpart.ts engine): explicit holders with local grips and
  stations, optional hand-off to a deck crew, tip-up for standing sheets, per-role support rules, fasteners in reach;
  invariants `kitPartHandsInReach`, `kitPartsSupported`. **Bystanders (W27):** while the lift crew moves the part
  (tip-up, walk-in, set), anyone else whom a lifter's feet would come within 2r + 0.08 m of (and closer than now), in the
  next 1.2 m of foot travel, stops the crew: it holds the part (`setpart.path-occupied`, blocked) and an idle person is
  asked to step aside (`makeWay`, as the carry verb does). Before, set-part checked feet only against the static grid.
- `climb_stair` / `leave_stair` (builders on the treads already built; `stairWorkOk`), `step_onto_beam` (deck → walkway,
  to climb down), `stack_offcut` (offcuts onto the scrap pile by the station).

## Generator order (sequence-b.ts) and what the ordering rules produced
Sections, each gated on everyone's last step of the one before (the Mars order): **D0** ground-floor deck (pieces pushed
in over the 0.22 m edge beams, taken by two in the aisles) → **D1** first-floor deck from the stair end (first strip by
four who climbed the end frame onto the beams; later strips received by people kneeling on the strip laid before;
middle pieces fed in by a receiver walking alongside) → **D2** roof deck through a relay kneeling at the first-floor
deck edge → **S** the stair → **W** walls → **P** solar → **END**.
**Stair vs upper decks:** the ordering rules put the stair *after* both upper decks: the stair's walking link needs
its landing (a first-floor strip), and nothing in D1/D2 needs the stair — **the deck crews climb the end frames
(bracing as a ladder) and come down the same way** (step_onto_beam → climb_frame down). The stair's top treads are
set by a builder standing on the treads below (climb_stair). Walls and solar use the finished stair to reach the
first-floor deck.

## Numbers (2022 east-house, W21 walker)
Plan A+B: **1552 steps** (552 A + 1000 B): take 145, carry 370, cut 136, stack_offcut 89, pass_up 90, walk_to 57+,
climb_frame 22, beam_walk 15, step_onto_beam 8, install_stringer 6, install_stair_part 24, climb/leave_stair 2/2,
install_wall 25, install_rail 6, install_panel 3. Stock: 106 × 4x8 (81 deck pieces + 25 wall panels), 136 cuts.
Sections run one after the other from snapshots (each 0 violations): A 117 277 ticks; D0 94 646; D1 96 662; D2
102 287; S 84 136; W 68 331; P+END 15 635 → ≈ 579 000 ticks ≈ 8 h simulated.
Default suite: first bay + its first ground-floor deck strip (3 pieces cut, notched, offcuts stacked, pushed in):
221 steps, 53 604 ticks, 0 violations, ~14 s wall, pinned `94db263e…`.
**Full A+B end to end (YEAR_BUILD_FULL=1, W27): 1552 steps, 600 599 ticks ≈ 8.3 h simulated, 0 violations, settled,
pinned `ddb634d6…` (~13 min wall); matched at 1 cm / 1°: phase A 66 parts, phase B 145 (81 deck pieces, 25 wall
panels, 6 stringers, 16 tread boards, 6 posts, 2 handrails, 6 rails, 3 panels; max 0.25 mm); unplaced 19 (solar 14, stair 5).** W13's run had 37 ticks of `collision.human-human` in the walls section. m2,
lifting wall panel p5 of wall 113aa87d in (`s1417-install-wall`: tip-up, then walk-in), passed 0.48 m from m6, who was
idle outside the +x side since the stair section. The carry that brought the panel had checked its set-down spots. The
set-part walk-in checked the lift crew's feet only against the static grid, so people were not obstacles. With the
bystander rule above, that step waits 17 ticks while m6 steps aside; it is the only wait in the whole house. Every other
step status matches the unguarded run.
Matched by kind (sequenced Kit components): frames 12, beams 54, deck strips 27 (81 pieces), walls 4 (25 panels),
stair 16 of 21 (6 stringers + 16 tread boards for 8 treads, 6 posts, 2 handrails), solar 6 of 20 (3 panels + cells).
Unplaced 19, each with its reason: 2 rail posts inside the end frame, 3 risers (a 6.5 cm sliver; two in slots between
treads no verb can reach), 14 solar parts (7 panels + their cells: 4 span a frame line whose columns stand 5 cm above
the roof deck; the rest lose install_panel's end stations to a tilted neighbour or the deck's end).

## Report only (yearBuildPlan with phaseB, no run)
| year | houses | sequenced (A + B) | unplaced | why (main) |
| --- | --- | --- | --- | --- |
| 2022 | chiba, east-house, kitchen, west-house | 48 frames, 216 beams, 102 deck strips, 12 walls, 64 stair parts, 18 solar | fixtures 100, solar 42, stair 20, walls 7, roof 10, door 1 | fixtures / roofs / doors have no rule; wall heights ≠ 2.23 / 2.20 m, screens; the same stair / solar limits |
| 2021 | chiba, outdoor-kitchen | 52 frames, 248 beams | decks 23, solar 32, stair 28, roof 15, walls 3, fixtures 79, door 1 | deck strips not jointable on beams at whole feet / beams not across; stairs of 12 treads; no catalog panel of those module sizes |
| 2023 | chiba, kitchen | 60 frames, 300 beams | decks 78, solar 140, stair 88, walls 20, roof 19, fixtures 15 | as 2021 (other deck layouts, 12–41-tread stairs, other modules) |
| 2024 | chiba, kitchen | 62 frames, 306 beams | decks 73, windows 91, stair 127, walls 25, solar 36, roof 17, fixtures 15 | + windows (no rule) |
| 2025 | chiba, kitchen, secondary-house | 60 frames, 270 beams, 3 walls | decks 66, stair 66, walls 15, roof 11, solar 12, 2 frames | as above |
| 2020 | chiba | 6 frames | decks 18, walls 76, stair 24, fixtures 183 | the Portal / Forest racks are not catalog frames (phase A) |
The phase-B rules are generic in form (strips jointed on beams, walls by height, Kit modules by size) but their
parameters fit the 2022 rack-house template only; other years need more sheet splits, wall heights, stair templates
and module sizes.

## A+B as chapter takes (W31, 2026-09-29)
As one take the whole A+B is **12.0 MB**, 5.7 MB over the 6 MB budget (`--scenario year-build-2022-ab`, W27). Its
phase-A shot list read poorly over 8 h (min readability 0.15). Lead decision: split per section. `record-campus-take.mjs
--scenario year-build-2022-ab-chapters` (explicit, ≈ 30 min) runs the pinned A+B plan **once**. `engine/take/chapters.ts`
cuts the take at sequence-b's section barriers: the end of the tick in which the last step before a section start
ended. END is folded into P. Each section start is a barrier of the plan (every later step depends on every earlier
one; `isBarrier`, tested). Chapter k therefore starts exactly where k − 1 ended (same world, same tick), and the ticks add
up to the run.

| # | chapter | plan steps | ticks | sim min | take id | raw B | gzip B | camera min / mean readability | shots / cuts |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | A skeleton (12 frames, 54 beams) | 0–551 | 117 277 | 97.7 | `e8fd2e0d…` | 3 522 237 | 575 701 | 0.70 / 0.98 | 53 / 52 |
| 2 | D0 ground-floor deck | 552–742 | 99 007 | 82.5 | `c1e76f1c…` | 2 171 414 | 298 376 | 0.70 / 0.99 | 29 / 28 |
| 3 | D1 first-floor deck | 743–953 | 100 831 | 84.0 | `517ac94d…` | 2 285 860 | 312 987 | 0.80 / 1.00 | 29 / 28 |
| 4 | D2 roof deck | 954–1166 | 107 341 | 89.5 | `5c5f7709…` | 2 477 582 | 331 119 | 0.67 / 1.00 | 29 / 28 |
| 5 | S the Kit stair | 1167–1340 | 87 041 | 72.5 | `785987be…` | 2 074 902 | 281 470 | 0.80 / 1.00 | 32 / 31 |
| 6 | W plywood walls | 1341–1498 | 72 915 | 60.8 | `0799de33…` | 1 942 049 | 254 990 | 0.60 / 0.94 | 27 / 27 |
| 7 | P solar + END | 1499–1551 | 16 187 | 13.5 | `5cceb1c4…` | 896 593 | 104 365 | 0.60 / 0.96 | 9 / 9 |
| | **set `8ce33bee…`** | 1552 | **600 599** | 500.5 | | **15 370 637** | 2 159 008 | | |

Every chapter is 100 % readable, with 0 invalid samples and 0 crossings, at 0.5 Hz. The last chapter's final state is
the A+B pin **`ddb634d6…` @ 600 599**. The chaptered run reproduces it: the cutter only swaps take recorders.
Continuity is checked by the recorder and by `take-chapters.test.ts` on the shipped files. For each k: chapter k's
`baselineStateHash` = k − 1's `finalStateHash`, its `entities0` = k − 1's final entities, and its replayed first frame is
within ½ mm / ½ mrad. The manifest contract is in STUDIO_REPLAY.md "Chapter sets".
- **The skeleton chapter is not the whole-skeleton take** (`69c41651…`, `d382e461…`). The A+B yard has ten more piles
  (the phase-B stock: 2 plywood bundles, lumber, rails, the solar pallet, the scrap pile). That take's final state is
  therefore not where D0 starts, even though its motion and ticks are the same (117 277). Chapter A is recorded from the
  A+B run. The skeleton take stays as its own entry.
- The ticks differ from W13's per-section runs (D0 94 646 … W 68 331): those ran from separate snapshots, while the
  chapters are one continuous run.
- **Cameras** (`workShots`): an establishing wide, then one frameGroup per 90–300 s of work at the house (cut at the
  starts of non-yard steps). Each frames the people who do that work *and* stay at the house (footprint + 2.5 m, for
  ≥ 70 % of the stretch). The camera sits outside the house on their side, ±30° alternately, at 10° for work on the
  ground (under the decks a steep camera sees plywood), 22° on the first floor and 30° on the roof. Each chapter ends on a
  wide. Before the stay filter, the ground givers (away at the station most of each stretch) widened the frame until the
  deck crew was 4 % of frame height: min 0.25–0.37, mean 0.73–0.79 for D0 / D1 / D2 / W.
- Weak spots: most work shots are close on one to four people for minutes. Nothing frames the piece being cut or
  carried, and the yard (the station, the carries) is seen only in the opening wide. Four W stretches and one D0 stretch frame people idle
  at the house (nobody worked there then). Moments per chapter are generic (`work`, `middle`, `done`).

## What phase C needs
- a director-run take per house / year (mars-take/4) with camera tracks. The east-house A+B ships as 7 chapter takes
  (above). The studio does not yet play a chapter set back to back (a renderer task, STUDIO_REPLAY.md "Chapter sets").
  The other three 2022 houses run (they plan with the same rules). Idle crew should be parked away from each section's
  carry paths (today they are moved by make-way when a carry or set-part needs the ground);
- install_panel side stations (solar.ts) — 7 of 10 modules wait on it; a lengthwise insertion for risers; a post rule
  at the end frame; notching / seating decks below the column tops (or a Kit decision) for the panels over frame lines;
- rules for other years: deck layouts that are not whole-foot on beams, wall heights, stair templates (12–41 treads),
  more solar module sizes, roofs, doors, windows, fixtures as placed items;
- performance: phase-B sections run ~1–4 s wall per simulated minute (support-chain checks are cached by supportKey).
