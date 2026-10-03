# Progressive construction — joists, plywood decks, stairs (milestone E)

Spec §7, §10, §12, §28 ("Construction changes navigation", "Incomplete floor/stairs").
Code `viewer/engine/construction/{access,deck,stairs,contributor}.ts`; tests
`engine/test/progressive.test.ts`. **Every rule below is "Mars assembly model v1,
approximate"**: rule-based plausibility, not structural engineering.

## Modules
| File | Role |
| --- | --- |
| `access.ts` | Work access: station finder (ground or supported deck within reach), staging/crew checks, shared lift execution |
| `deck.ts` | `install_joist`, `install_plywood`, support chain (`supportProblems`, `beamProblems`, `sheetSupports`) |
| `stairs.ts` | `install_stair_flight`, `install_tread`, `stairLink` (Link with usable flag + reason) |
| `contributor.ts` | `progressiveContributor` (Spatial hook → deck Surfaces + stair Links), `progressiveSupported` invariant |

Register: verbs are in `CONSTRUCTION_ACTIONS`; build Spatial with
`new Spatial(base, { contributors: [progressiveContributor] })` and add
`progressiveSupported` to the invariants.

## Assumed build-up (how Mars decks are made)
Plywood on 2x4 framing on rack beams. 2x4 joists stand on edge **across the bay
depth** (between the two columns), bearing on the left + right beams at one seat
height, spaced along the bay; plywood lies across the joists. Joists may
cantilever ≤ 12 in past each beam, so a 6 ft 2x4 on a 4 ft deep bay makes a 6 ft
deck (needed anyway: on a 4 ft deck the standable band is too narrow for a stair
landing's approach/exit zones).

## Rules
**install_joist** `{crew(1–2), joist, bay:{a,b}, height, at}` — `at` = metres along the bay from upright a.
- a, b standing uprights; `height` snaps to a seat; installed beams on **both** columns of a–b at that seat
  (`joist.no-beams`: "…needs installed beams on both columns of bay A–B at 1.83 m…; found b3").
- Those beams carry load: installed, their uprights standing and held or stable (`joist.beam-unsupported`).
- Ends reach the beam centrelines (`joist.too-short`), cantilever ≤ 12 in (`joist.overhang`, e.g. 8 ft 2x4);
  0.1 m clear of the frames (`joist.out-of-bay`); ≥ 6 cm from another joist (`joist.occupied`).
- Result: pose on top of the beams, yaw = frame across-axis; `support: resting-on` + `bears-on` connections to both beams.

**install_plywood** `{crew(2), sheet, x, z, yaw, height?}` — the sheet rests on the **highest** installed joists/beams
whose footprints overlap it (optionally within 0.3 m of `height`):
- supports parallel (`plywood.support-geometry`); a support counts if it bears along ≥ half the sheet;
- ≥ 2 counting supports (`plywood.too-few-supports`: "…would rest on j2 (1 joist)");
- centre gaps ≤ 24 in (3/4 in ply rated 24 in o.c.; `plywood.span`); edge overhang ≤ 12 in (`plywood.overhang`);
- supports' own chain OK (`plywood.support-unsupported`); no overlap with an installed sheet (`plywood.overlap`);
  nothing under it → `plywood.unsupported`.
- **Deviation from the brief:** directly on a beam pair only if the beams are ≤ 24 in apart, not ≤ 4 ft. Every Mars
  frame is 3–4 ft deep, so a 4 ft rule would make joists optional on every bay; the diagnostic says
  "cannot span 1.22 m between b3 and b4 (max 0.62 m / 24 in); install 2x4 joists first". Owner may overrule.

**install_stair_flight** `{crew(2), stair, x, z, heading, level?}` — (x, z) = foot (bottom edge centre), ascending along `heading`.
- Foot on a walkable floor of `level` (default ground) (`stair.no-base`).
- Top edge hooks onto an installed, supported joist or beam within 0.15 m horizontally whose top is 0–0.25 m below
  the flight top (`stair.no-top-support`). The landing surface need **not** exist yet (the link stays unusable).
- Installed box must not intersect obstacles (`stair.site-blocked`) or people (`stair.site-occupied`).
- The crew stands either side of the staged flight and walks it ≤ 3 m into place; the flight body gets the shared
  swept-lift check (no lift-over: it is walked, not hoisted; `lift.path-blocked`), the carriers are sampled every
  0.1 m (`stair.move-blocked`). Result: `support: connected` to the top member, `top` connection.

**install_tread** `{crew(1–2), stair, tread, index}` — `index` 1 = bottom; the flight must be installed; the tread
must be missing (`tread.already-installed`); a person stands beside the flight within reach. Recorded as a
`tread-<i>` connection on the flight and `seat` on the tread.

**Common:** parts must be staged (lying on the ground, `stored|staged`) within 3 m of their target — the `carry`
action delivers them (`*.not-staged`); crew not holding anything; preconditions re-checked when the crew arrives;
approach → lift (joist 2 s, sheet 3 s, tread 1.5 s, flight ≥ 2 s) → installed. Cancel is refused mid-lift
(`*.cancel-unsafe`), fine during approach. Symmetric lumber (2x4, sheet, tread) is seated at whichever of yaw /
yaw + π is nearer its staged yaw, so it never spins half a turn in the air.

**Swept lifts** (`access.ts sweptLiftPath`, also `connect_beam`): at plan time and again at the moment of lifting,
the lift path is sampled (≥ 24 samples per segment, ≤ 3 cm displacement of any point between samples) and the part's
box (`entityCorners` → footprint prism) is tested against every scene obstacle — static geometry and components —
except the part itself, what it rests on / seats into (beam: its two uprights; joist: its two beams; sheet: its
supports; tread: its flight; flight: its top member) and anything it already touches where it lies. If the straight
path is blocked, the standard lift-over is tried: straight up until its underside is 0.3 m above its seated top,
across (turning on the way), straight down; paced at 1 m/s (≥ the verb's duration), eased per segment. Both blocked →
`lift.path-blocked` naming the obstacle of each variant. In the flagship both sheets are lifted over the side beams
(s1 is staged east of the bay: the 12 ft end frames leave no path in from the south).

**Crew accompanies the part** (`liftcrew.ts`, spec §7/§8; joist, plywood, tread, `connect_beam`): holders on the part's floor take hold beside hand points — new grip slots `lift-end-0/1` (ends, ±0.45 L), `lift-edge-0/1` (long-edge midpoints), `lift-corner-EK` (two corners of one short end); sheets try edges, then corners — picked so each can walk a straight line from pickup to seat, else one holder follows an end while the other waits at their station (`lift-station`; also deck workers taking a part from below: hand-up not modelled, not checked).
Each tick a holder's target is its hand point + 0.35 m outward (else 0.35/0.6/0.85 m at ±45°/±90°, nearest free); it steps ≤ 0.9 m/s (sliding ±30°/60°), never onto clearance < 0.28 m or within 0.56 m of anyone, facing the hand point.
The part is paced so no hand point outruns 0.9 m/s and waits while a holder would end > 0.9 m away; a holder stuck > 2 s → action `blocked`, `lift.crew-blocked` naming the obstacle/person (the crew keeps holding).
Invariant `lift.hands-out-of-reach`: holder ≤ 1.0 m (ground) from its hand point, hand point (underside) ≤ 2.4 m above their floor; a lift-over apex > 2.4 m above the crew's lowest station floor is refused (`reach.too-high`).
Flight carriers keep their own walk (slots `lift-edge-*`). Lifts take longer: full sequence 253.4 → 270.1 s simulated.

## Work access ("work from deck")
A station must be on a level whose floor is ≤ 2.1 m (`STANDING_REACH`) below the part's top and not above it,
within 0.8 m horizontally of its footprint, with clearance ≥ r + 0.03, not inside the part if it is a body-height
obstacle there, ≥ 0.66 m from other people, and route-reachable. Levels come from the Spatial scene, so only
**supported, built** decks count. Candidates: 0.2 m lattice, sorted by (floor height, distance to the crew
member's anchor, index); a failed route marks its whole connected standing region unreachable (e.g. the enclosed
floor inside a bay). Nothing eligible → `reach.too-high` ("the highest walkable floor below it (level 0 at
0.00 m) is 3.65 m down (standing reach 2.1 m)… ladders/scaffold are not modelled"); eligible but unreachable →
`reach.no-station` with the route diagnostic.

## Navigation (contributor)
- Installed plywood with a complete support chain → Surface at its top on level `round(y / 0.5)` (deck at
  1.99 m → level 4); adjacent sheets merge in the raster. Unsupported sheet → nothing.
- Installed flight → Link `{id: flight id, from 0.45 m before the foot, to 0.45 m past the top edge, path through
  every tread}`. `usable` only if all treads are in, the top support chain is intact, a landing surface (±0.08 m of
  the flight top) contains the exit point, and the foot is on a floor. Reasons join with "; ", e.g.
  `treads 1–10 missing; no landing at top`, `treads 3, 7 missing`. Walkers then get
  `route.link-unusable`: "no usable route: it would require stairs st (treads 3, 7 missing)".
- The flight body is an ordinary component obstacle: it blocks the ground, and ends below the deck's step band.
- Spatial re-keys on phase/pose/connections/support, so every install bumps the epoch; walkers whose remaining
  corridor is invalid replan (test c: `replans ≥ 1`).

## Invariant `progressiveSupported`
Every installed joist, sheet, flight and tread has a complete chain (sheet → joists → beams → uprights held or
stable; flight → top member; tread → installed flight): else `support.deck-unsupported` naming the missing link.

## Catalog additions (`world/catalog.ts`)
`2x4-4ft`, `2x4-6ft`; `plywood-4x6` (4x8 sheet cut to 6 ft); `stair-flight-10` (run 2.5 m, rise 1.98 m, width 0.9 m,
11 risers of 0.18 m, going 0.25 m); `stair-tread` (2x10, 0.9 m). `AssetDef` gained optional `stair: { treads }`
(additive). All provisional (not yet checked against photos).

## Test world and results
Open ground; the supported 12 ft / 9 ft bay from `construction.test.ts`; joists at 0.2/0.8/1.37/1.95/2.55 m; two
4x6 panels (z 0.15–1.37, 1.37–2.59) → deck top 1.99 m; flight foot at (3.44, 0.75) ascending −x onto the deck's east
edge. 9 tests: progressive floor, progressive stairs (+ walk back down), replan while en route, plywood without
joists, joist without beams / overhang, full sequence (4 814 ticks = 240.7 s simulated, 63 actions, 0 violations,
~2 s wall), determinism hash, work from deck, support removed → floor disappears + violation.

## Limitations / deferred
- Heights: only the low platform (upper beam seat ≤ 2.1 m). Full-height Mars upper floors need ladder/scaffold
  access — **not modelled**; work-from-deck is the only way above reach.
- Lifts are interpolated, not swept (a joist may pass through a beam visually); the flight slide is swept.
- A part lying on the ground within 3 m can be "handed up" to someone on a deck (no hand-off modelled).
- No removal/dismantling verbs; no load limits, deflection or fasteners; stair flight rise is fixed (±0.08 m).
- Stair links need ≥ 0.7 m of standable deck behind the exit point (path.ts `linkApproach`), hence the 6 ft deck.
- Test fixtures place a second bay by state for the work-from-deck test (beams above reach cannot be seated).
