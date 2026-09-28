# Hand-up — materials go up by hand or by forklift (owner feedback 2026-09-28 §5 + §6, engine side)

Code: `viewer/engine/construction/{frame,framemove,handup,aloft}.ts`, additive hooks in
`vehicles/forklift.ts` (`forklift_present`, `forklift_back`). Tests: `engine/test/frame.test.ts`,
`handup.test.ts`, `build-bay-v3.test.ts`. Flagship: `engine/scenarios/build-bay-v3.ts`.
**Mars assembly model v1, approximate**: rule-based plausibility, not ergonomics.
Every reach number below comes from the one body model (`engine/body/model.ts`, `BODY_MODEL.md`, W10
2026-09-28): arm 0.62 m, standing reach 2.06 m (the §5 "2.1 m" rule is 2.06 m), reach-down 0.5 m, kneel rule 0.8 m. Since
2026-09-28 ("Body model = the measured rig", W12) these are the measured rig's numbers: shoulders 1.34 m; the spec's
≈ 1.0 m reach-down is **superseded** by 0.5 m (a kneeling body's shoulders stay above the deck: measured 0.35–0.54 m
below the feet at 0.45 m out) — hand-offs needing more are refused (`handup.too-high`: use the forklift).

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
- givers (1–2, on the floor): `walk` → `crouch` 0.6 s (hands travel from the hips to the grip) → `lift` 0.6 s
  (stand with it, underside 0.80 m = hands hanging) → `walk-load` (≤ 0.6 m/s to below the edge) → `reach_up`
  (≤ 0.5 m/s, underside ≤ floor + 2.06 m)
  → [push it in over the edge while still in reach] → hold → let go after the take.
- receivers (1–2): `walk` → `climb-up` → `beam-walk` to a station beside the load's path (or already
  on a beam / a deck) → `wait` → `reach_down` 0.6 s (hands travel from the hips down to the load) → `take` 0.4 s → `stand_with_load` (raise to
  5 cm above the members) → `lay` (fed in ≤ 0.4 m/s hand over hand; nobody walks with it) → `set_down` 0.5 s.
- `via: 'forklift'`: `forklift_pick`, `forklift_present {operator, at:{x,z,y,yaw}}` (drive, square,
  raise, creep; holds it raised), then `hand_up` with `operator` and no givers; the receivers lift it
  3 cm off the forks and lay it. `forklift_back {operator, d}` backs the empty truck straight out.

Geometry: the load comes over one beam walkway (`edge`, else the one facing where it lies), is raised
outside it (clear of anything sticking out, e.g. joist cantilevers), and fed in perpendicular to it
without turning. With the members' top ≤ givers' floor + 2.01 m (GIVE_MAX − the 5 cm slide clearance) the givers push it partway in
themselves ("direct"); else they hand it up below the beam and the receivers lift it the rest.

### Reach rules (engine rules; plan time and every tick)
- givers' hands (the load's underside) ≤ their floor + **2.06 m** (`BODY_MODEL.overheadMax`; was 2.1) — and no
  higher than the `reach_up` envelope reaches at their grips: hands 0.3 m ahead and ±0.15 m apart top out at
  **2.05 m** (`postureTop`), so that is the hand-off height from the ground (W12);
- receivers' hands ≥ their feet − **0.5 m** (was 1.0; measured rig); at the hand-off within **0.5 m** horizontally beyond the
  edge they kneel at — a beam walkway's side (`offWalkway − width/2`) or, standing on a deck, the deck's
  outline (W8); refused with `handup.receiver-reach` naming the distance (e.g. "hands would be 0.70 m
  beyond the edge of beam b3 they kneel at (max 0.5 m)");
- **kneel rule** (W8 patch, applied by W10 2026-09-28): at `reach_down` / `take` the receivers' hands are
  ≤ **0.8 m** horizontally from their feet (they kneel *at* the edge, not stand back and lean) — planned
  (station choice) and per tick (`lift.hands-out-of-reach`, + 0.1 m). Physical basis (W12): a kneeling rig
  reaches 0.78 (woman) – 0.96 m (casual, punk) out at 0.1 m below its feet; 0.8 m is what every template reaches;
- long-load balance (W8): one giver handing up a `timber` / `rack-beam` end-first holds it with a
  two-handed **lever grip** (outer hand at the end, inner hand `LEVER` 0.4 m toward the middle; slot
  suffix `:lever`); a free end > **1.5 m** from the inner hand is `handup.unbalanced` (6 ft 2x4: 1.34 m ok;
  8 ft: 1.92 m refused — hand it up side-on or with two givers); a lever giver stands **beside** the end
  (`LEVER_SIDE` = body radius + 3 cm, the load passing their hip), not 0.3 m beyond it — with a 0.62 m arm the
  inner hand 0.7 m out was unreachable;
- every holder's hands inside a posture envelope (`BODY_MODEL.posture`): shoulder cylinder above the feet
  (`crouch/lift` 0.50–1.45 m, `walk-load/reach_up` 1.22–1.45 m, receivers' `reach_down…set_down`
  0.07–1.45 m, i.e. kneeling / bent over the edge, shoulders above the deck), horizontal lean 0.2–0.35 m, arm
  **0.62 m** (bands from the measured rig, BODY_MODEL.md; were 0.55 / 1.3 / −0.15 – 1.48, lean ≤ 0.45);
  planning requires inside (`handup.giver-reach` names a giver's hand beyond reach), the invariant allows +0.1 m;
- a load in a receiver's body band stays ≥ 0.30 m from them; receivers ≥ 0.6 m apart.

Refusals: `handup.receiver-reach`, `handup.unbalanced`, `handup.too-high` ("…use the forklift" / "raise the forks"), `handup.no-walkway`,
`handup.receiver-not-aloft`, `handup.giver-aloft` (a giver on a beam: nobody walks a beam with a
sheet), `handup.no-receiver-station`, `handup.path-blocked`, `handup.giver-blocked`, `handup.giver-reach`,
`handup.not-staged`, `handup.not-on-forks`, `handup.forklift-orientation`, `handup.occupied`,
`handup.no-support`, `handup.cancel-unsafe` (in the air), `crew.size`.

Invariant `lift.hands-out-of-reach` now covers both ends: holders with slot `handup-*` must publish
both hands, inside their envelope (+0.1 m), givers ≤ floor + 2.06 m, receivers ≥ feet − 0.5 m and (kneel rule)
≤ 0.8 m horizontally from their feet at `reach_down` / `take`.

### Hand points for the renderer
- Live world: `human.hands = { left: [x,y,z], right: [x,y,z] }` every tick while holding (the same
  field engine/items uses; cleared on release), `human.grip = { entity, slot }`, `human.activity`.
- During `crouch` (givers) and `reach_down` (receivers) the hands travel from the hanging rest hands
  (`restHands`, body/model.ts) to the grip with a smoothstep over the phase; from `lift` / `take` on they are
  on the part (which moves smoothly). Tests enforce `hands.teleport` (≤ 0.25 m per tick, `test/hands-check.ts`).
- From a take: since `mars-take/2` the take records `hands` (integer mm) — read them (`sampleTake(...).entities[id].hands`).
  `handupHands(part, part.pose, holder, slot)` (construction/handup.ts) rebuilds the *grip* exactly (not the
  crouch / reach_down approach). Slots: givers `handup-give-<i>:<lx>:<lz>:<x|z>` =
  grip point in the part's local frame on its underside + the local axis the hands spread along
  (±0.15 m), or with suffix `:lever` a one-end grip (one hand at the grip point, the other 0.4 m along
  the axis toward the middle); receivers `handup-take-<i>` = the part's top face at its point nearest them. Fastening
  (install_* aloft) uses slot `fasten` (no hand points: nearest point of the part).

## Flagship v3
v2's build, deck handed up: 7 joists handed over b3 to crew[4] (on the beam), s1 by hand over b4 to
crew[4]/crew[5] on the beams, s2 off the forks (west side) to crew[4] kneeling on b3 just north of s2 and
crew[5] at s1's north-west corner (kneel rule; crew[4] steps onto s2 once it is fastened), then v2's
stair, spare tread, visitor, campfire. 12 ft bay (forks present a 4x6 long side first; s2 lies along
the bay). 88 steps, 16219 ticks (811 s simulated), 0 violations, ~6 s wall, pinned hash `339cf310…`
(body model unification, 2026-09-28; history of re-pins in PLANNING_BUDGET.md).

## Approximate / not modelled
- Receivers feed a load hand over hand from a fixed station (their grip slides along the nearest edge);
  a sheet is never turned over the bay, so the forks can only deliver sheets parallel to the edge.
- The body envelope is a cylinder + arm-length test, not IK; bodies vs parts only through the 0.30 m
  body-gap rule for receivers; givers stand 0.3 m beyond the grip (a lever giver 0.25 m beside the end) by
  construction.
- Balance is checked for a single giver only (lever grip, free end ≤ 1.5 m); a single receiver feeding
  a joist in end-first is assumed to slide it over the edge beam (not checked), and sheets are not checked.
- Reach-down: 0.5 m below the feet (measured rig; the owner's §6 ≈ 1.0 m is superseded). The kneeling
  envelope reaches 0.54 m at 0.45 m out, so the 0.5 m cap binds (`handup.too-high`), not station choice. Decks
  whose receivers stand > 2.05 + 0.5 ≈ 2.55 m above the givers' floor (plus the load's thickness) need the forklift.
- Fork height is not state after the load leaves the forks (the truck just parks); `forklift_back` is
  a straight creep.
- Climb paths are three straight segments; climbing is ≤ 1 person per link but two links on one
  column face are not mutually exclusive; a person on a beam may stand next to a column / on a joist.
- Frame links are in the API spatial scene by default (`servicesFor(scenes, { frameAccess })`, W8;
  `frameAccess: false` opts out); `hand_up` computes them from the world, so it works everywhere.
