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

## Phase B needs
Deck sheets (plywood strips on beams: the Kit's 15 ft strips → sheets + cuts; joists the Kit does not draw),
the stair / ramp (a site-built flight of the Kit's width, stringers, treads), plywood walls and screens
(install verb with support rules), roofs / ceilings, doors, windows, railings, solar panels on roofs (W8's
verbs, own piles), paint (W8), fixtures placed as items; `cut` in the flow (the BOM's cut list); the other
three 2022 houses and the other years (2021, 2023–25 map; 2020 needs non-catalog rack parts); a director-run
take per year with camera tracks and the studio "Watch it being built" picker.
