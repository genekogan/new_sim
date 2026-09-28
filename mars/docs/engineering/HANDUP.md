# Hand-up — materials go up by hand or by forklift (owner feedback 2026-09-28 §5 + §6, engine side)

Code: `viewer/engine/construction/{frame,framemove,handup,aloft}.ts`, additive hooks in
`vehicles/forklift.ts` (`forklift_present`, `forklift_back`). Tests: `engine/test/frame.test.ts`,
`handup.test.ts`, `build-bay-v3.test.ts`. Flagship: `engine/scenarios/build-bay-v3.ts`.
**Mars assembly model v1, approximate**: rule-based plausibility, not ergonomics.

## The rack structure is climbable / walkable (frame.ts, "only what exists is usable")
| Link | Exists when | Rules |
| --- | --- | --- |
| `climb:<upright>:<l\|r>@<seat>` (kind `climb`) | upright `installed`, standing, supported; one per column and beam seat there (not on a middle frame with beams on both faces) | from the ground on the frame's outside face, up beside the column, round it onto the beam end; 0.35 m/s; one person at a time (`occupancy 1`); small loads only |
| `beam:<beam>` (kind `beam`) | beam installed + supported **and** its partner (same two uprights, other column, same seat) installed | width = catalog `walkway.flange` 0.1 m + 2 × 0.05 m; ≤ 0.4 m/s (balance); no carrying except `handling.smallLoad` (≤ 10 kg: 2x4s, treads); never under a deck |

Both are narrower than a routing disc (0.56 m), so `walk_to` never routes over them (path.ts skips
`width < 2r`); they come from `frameAccessContributor` (not added to v1/v2 or the API spatial, so
existing routes/pins are unchanged). Verbs: `climb_frame {actor, link, dir}` (walk to the foot, climb,
step onto the beam / back down), `beam_walk {actor, x, z, speed?}` (along the beam you are on; may
step off onto a deck at that level from an open spot). A person on the structure has
`human.on = <link id>` and `human.level` = the beam's level.

Diagnostics: `climb.no-link`, `climb.no-carry`, `climb.no-walkway`, `climb.not-at-frame`,
`climb.occupied` (blocked), `beam.not-on-beam`, `beam.too-fast`, `beam.no-carry` (names the beam),
`beam.off-walkway`, `beam.under-deck`, `beam.occupied`, `beam.no-room`.
Invariant `frameAccessOk`: `frame.link-gone`, `frame.off-beam`, `frame.beam-overspeed`,
`frame.carry-on-beam`. (`collision.human-static` skips people with `human.on`.)

## `hand_up {part, givers?, receivers, to:{x,z,yaw}, edge?, via?, operator?, stations?}`
The part ends **staged exactly where it goes**, resting on the members under it (support
`resting-on`); `install_joist` / `install_plywood` then only *fasten* it (aloft.ts: crew up there
within 0.8 m, part at its install pose ± 2 cm; 2 s / 3 s). Ground-staged parts keep the old lift path.

Phases (each publishes `human.activity`):
- givers (1–2, on the floor): `walk` → `crouch` 0.6 s → `lift` 0.6 s (stand with it, underside 0.75 m)
  → `walk-load` (≤ 0.6 m/s to below the edge) → `reach_up` (≤ 0.5 m/s, underside ≤ floor + 2.1 m)
  → [push it in over the edge while still in reach] → hold → let go after the take.
- receivers (1–2): `walk` → `climb-up` → `beam-walk` to a station beside the load's path (or already
  on a beam / a deck) → `wait` → `reach_down` 0.6 s → `take` 0.4 s → `stand_with_load` (raise to
  5 cm above the members) → `lay` (fed in ≤ 0.4 m/s hand over hand; nobody walks with it) → `set_down` 0.5 s.
- `via: 'forklift'`: `forklift_pick`, `forklift_present {operator, at:{x,z,y,yaw}}` (drive, square,
  raise, creep; holds it raised), then `hand_up` with `operator` and no givers; the receivers lift it
  3 cm off the forks and lay it. `forklift_back {operator, d}` backs the empty truck straight out.

Geometry: the load comes over one beam walkway (`edge`, else the one facing where it lies), is raised
outside it (clear of anything sticking out, e.g. joist cantilevers), and fed in perpendicular to it
without turning. With the members' top ≤ givers' floor + 2.05 m the givers push it partway in
themselves ("direct"); else they hand it up below the beam and the receivers lift it the rest.

### Reach rules (engine rules; plan time and every tick)
- givers' hands (the load's underside) ≤ their floor + **2.1 m**;
- receivers' hands ≥ their feet − **1.0 m**; at the hand-off within **0.5 m** horizontally beyond the
  edge they kneel at — a beam walkway's side (`offWalkway − width/2`) or, standing on a deck, the deck's
  outline (W8); refused with `handup.receiver-reach` naming the distance (e.g. "hands would be 0.70 m
  beyond the edge of beam b3 they kneel at (max 0.5 m)");
- long-load balance (W8): one giver handing up a `timber` / `rack-beam` end-first holds it with a
  two-handed **lever grip** (outer hand at the end, inner hand `LEVER` 0.4 m toward the middle; slot
  suffix `:lever`); a free end > **1.5 m** from the inner hand is `handup.unbalanced` (6 ft 2x4: 1.34 m ok;
  8 ft: 1.92 m refused — hand it up side-on or with two givers);
- every holder's hands inside a posture envelope: shoulder cylinder above the feet
  (`crouch/lift` 0.55–1.45 m, `walk-load/reach_up` 1.3–1.45 m, receivers' `reach_down…set_down`
  −0.15–1.45 m, i.e. kneeling / bent over the edge), horizontal lean 0.2–0.45 m, arm 0.75 m;
  planning requires inside, the invariant allows +0.1 m;
- a load in a receiver's body band stays ≥ 0.30 m from them; receivers ≥ 0.6 m apart.

Refusals: `handup.receiver-reach`, `handup.unbalanced`, `handup.too-high` ("…use the forklift" / "raise the forks"), `handup.no-walkway`,
`handup.receiver-not-aloft`, `handup.giver-aloft` (a giver on a beam: nobody walks a beam with a
sheet), `handup.no-receiver-station`, `handup.path-blocked`, `handup.giver-blocked`,
`handup.not-staged`, `handup.not-on-forks`, `handup.forklift-orientation`, `handup.occupied`,
`handup.no-support`, `handup.cancel-unsafe` (in the air), `crew.size`.

Invariant `lift.hands-out-of-reach` now covers both ends: holders with slot `handup-*` must publish
both hands, inside their envelope (+0.1 m), givers ≤ floor + 2.1 m, receivers ≥ feet − 1.0 m.

### Hand points for the renderer
- Live world: `human.hands = { left: [x,y,z], right: [x,y,z] }` every tick while holding (the same
  field engine/items uses; cleared on release), `human.grip = { entity, slot }`, `human.activity`.
- From a take (which records poses + `grip`, not `hands`): `handupHands(part, part.pose, holder, slot)`
  (construction/handup.ts) rebuilds them exactly. Slots: givers `handup-give-<i>:<lx>:<lz>:<x|z>` =
  grip point in the part's local frame on its underside + the local axis the hands spread along
  (±0.15 m), or with suffix `:lever` a one-end grip (one hand at the grip point, the other 0.4 m along
  the axis toward the middle); receivers `handup-take-<i>` = the part's top face at its point nearest them. Fastening
  (install_* aloft) uses slot `fasten` (no hand points: nearest point of the part).

## Flagship v3
v2's build, deck handed up: 7 joists handed over b3 to crew[4] (on the beam), s1 by hand over b4 to
crew[4]/crew[5] on the beams, s2 off the forks (west side) to crew[4]/crew[5] standing on s1, then v2's
stair, spare tread, visitor, campfire. 12 ft bay (forks present a 4x6 long side first; s2 lies along
the bay). 87 steps, 17288 ticks (864 s simulated), 0 violations, ~6.5 s wall, pinned hash `584685f1…`
at the walk.ts of `e09a961` (a walk.ts change re-pins it; with W4's in-flight splines it ran 16191 ticks).

## Approximate / not modelled
- Receivers feed a load hand over hand from a fixed station (their grip slides along the nearest edge);
  a sheet is never turned over the bay, so the forks can only deliver sheets parallel to the edge.
- The body envelope is a cylinder + arm-length test, not IK; bodies vs parts only through the 0.30 m
  body-gap rule for receivers; givers stand 0.3 m beyond the grip by construction.
- Balance is checked for a single giver only (lever grip, free end ≤ 1.5 m); a single receiver feeding
  a joist in end-first is assumed to slide it over the edge beam (not checked), and sheets are not checked.
- The receivers' edge rule does not yet require the body at the edge: a receiver may stand back on a deck
  and lean (envelope lean 0.45 m + arm 0.75 m). The stricter "kneel at the edge" rule (hands ≤ 0.8 m
  horizontally from the feet) is ready but moves v3's pin (s2's deck receivers stand ≈ 1 m back) — see
  PROGRESS W8.
- Fork height is not state after the load leaves the forks (the truck just parks); `forklift_back` is
  a straight creep.
- Climb paths are three straight segments; climbing is ≤ 1 person per link but two links on one
  column face are not mutually exclusive; a person on a beam may stand next to a column / on a joist.
- Frame links are in the API spatial scene by default (`servicesFor(scenes, { frameAccess })`, W8;
  `frameAccess: false` opts out); `hand_up` computes them from the world, so it works everywhere.
