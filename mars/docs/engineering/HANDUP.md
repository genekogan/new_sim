# Hand-up — materials go up by hand or by forklift (owner feedback 2026-09-28 §5 + §6, engine side)

Code: `viewer/engine/construction/{frame,framemove,handup,aloft}.ts`, additive hooks in
`vehicles/forklift.ts` (`forklift_present`, `forklift_back`). Tests: `engine/test/frame.test.ts`,
`handup.test.ts`, `build-bay-v3.test.ts`. Flagship: `engine/scenarios/build-bay-v3.ts`.
**Mars assembly model v1, approximate**: rule-based plausibility, not ergonomics.
Every reach number below comes from the one body model (`engine/body/model.ts`, `BODY_MODEL.md`, W10
2026-09-28): arm 0.62 m, standing reach 2.06 m (the §5 "2.1 m" rule is 2.06 m), reach-down 0.5 m, kneel rule 0.8 m. Since
2026-09-28 ("Body model = the measured rig", W12) these are the measured rig's numbers: shoulders 1.34 m; the spec's
≈ 1.0 m reach-down is **superseded** by 0.5 m (a kneeling body's shoulders stay above the deck: measured 0.35–0.54 m
below the feet at 0.45 m out) — hand-offs needing more are refused (`handup.too-high`: use the forklift) **unless a
deck covers the edge: then receivers lie prone at its edge and reach 0.73 m below it** (owner feedback §13, W28; the
measured rig since W32: "Prone receiver" below).

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

**Kneeling rise (W30, 2026-09-29).** In the second case the receivers kneeling at the edge lift the load straight up
from the hand-off to slide height (members' top + 5 cm) — through the band where the members it will rest on stick
out past the edge beam (joist ends). That rise is now swept like the prone one: against **everything**, the resting
members included, at plan time (the corridor search below) and per tick in the tests. The hand-off corridor is
searched outward from just outside the edge beam, every 5 cm up to 1 m: the first offset where both the givers' raise
(carry height → hand-off) and the receivers' rise (hand-off → slide height) are clear is where the givers present it.
So the load goes **straight up outside the joist ends, then comes in over them** at slide height (the prone path's
corridor). If the receivers kneeling on the beams cannot reach it there (hands ≤ 0.5 m beyond their edge, ≤ 0.8 m from
their feet), the hand-up is refused `handup.rise-blocked`, naming the member: "s1 cannot rise past the edge beam b3 in
the hands of receivers kneeling at it: 6 ft 2x4 (j1) is in the way of its rise at (1.97, 2.34, 1.83) close to the
edge, and clear of it nobody kneeling on the beams reaches it (at the hand-off the receivers' hands would be 0.71 m
beyond the edge of beam b3 they kneel at (max 0.5 m); …)". Off the forks the load cannot be moved out, so a rise
blocked where the forks hold it is refused "…where the forks hold it (present it clear of it)". After the rise the
feed-in (`lay`) at slide height is also swept against everything; only `set_down` may touch the resting members.
Where the givers raise it to slide height themselves ("direct") there is no receiver rise and nothing changes.
Tests (`handup.test.ts`): every hand-up there sweeps the load each `reach_down` / `take` / `stand_with_load` / `lay`
tick (the 2.4 m green test: 0 intersections, was 4 ticks through j1, handed off with its inner edge outside the joist
ends; +10 ticks); joists overhanging b3 by 0.78 m → `handup.rise-blocked` naming the joist, by 0.48 m → green, handed
off outside them; a sheet on the forks under the joist ends → `handup.rise-blocked` "…where the forks hold it". All
three fail on the pre-W30 code.

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
`handup.no-support`, `handup.cancel-unsafe` (in the air), `crew.size`, `handup.rise-blocked` (kneeling: above; prone: below).

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

## Prone receiver (owner feedback §13, W28 2026-09-29; the measured rig, lying heading, body beyond the lip: W32)
Gene: at Mars, with no forklift, a receiver **lies on their stomach at the edge of the upper floor** to take a plank /
sheet from below, then gets up without letting go — pushing off the floor with one hand, to the knees, to the feet —
and the wood never passes through the walls, floor or beams. Body numbers: BODY_MODEL.md "Prone receiver + rise".

**When.** Receiving postures are tried stand → kneel → prone. Standing and kneeling are the rules above (one `bentOver`
envelope; the 0.5 m reach-down cap is the kneel rule). Prone engages **only** where that cap refuses — the old
`handup.too-high` condition — and a deck (installed plywood) covers the edge beam the load comes over. Nothing that
planned before plans differently (pins unchanged: PROGRESS W28). If prone cannot reach either, `handup.too-high`
lists all three: "…would have to reach 1.18 m below their feet (receivers reach down standing to 0.60 m above their
feet, kneeling ≤ 0.5 m below them, lying prone at the edge of the deck at 2.90 m ≤ 0.73 m below it, here 0.83 m);
use the forklift" (or "…but no deck covers b3 to lie on"). The forklift variant is the same with "raise the forks".
Prone reach is the measured rig's (W32, BODY_MODEL.md "Prone receiver + rise": the woman template, 0.73 m; W28's 0.94 m
was stated, and the rig could not reach the hand points it planned).

**Where they lie.** Station S (the receiver's `pose.p`, feet level = the deck top) is 0.35 m behind the deck lip; they
walk there facing straight out over the edge (`nOut`, `walk_to … face`) and `pose.yaw` keeps facing out. They lie down
with the **body's axis through the grip** (W32; W29 measured the grips 0.31–0.47 m to the side of a body lying straight
out, beyond the rig's arms): the lying heading is `human.proneYaw`, turned `turn` ≤ 45° off the edge normal; where that
heading does not fit (the body off the deck, something in its way, a hand out of reach, the body past the lip meeting a
member) it is turned back toward straight out in 5° steps, first fit wins. Candidates every 0.05 m along the edge beam
wherever a deck covers it (or explicit `stations`, which must be 0.35 ± 0.05 m from the edge): S standable (`deckAt`);
**the lying body at that heading** — toes 0.75 m behind S up to the lip — on the deck (its axis and ±0.12 m across, exact
surfaces; parts of it past the lip line are over the edge), clear of everything standing on the deck (a 0.20 m half-width,
0.3 m high prism vs every obstacle: parts, walls, uprights) and of other people there (≥ 0.28 m); two lying bodies (toes →
head) never overlap and their S are ≥ 0.6 m apart. Preference: nearest to where the load ends up. Refusals name what is in
the way: "…no room to lie down from (0.26, 0.60) turned 25°: p5 is there" / "…: stair tread … (c1) is in the way".

**Reach at the take** (plan time, exact; per tick through the bounding envelope): each hand within arm 0.62 + girdle 0.10
of **its own shoulder joint** lying along `proneYaw`, the chest tipped over the lip as far as needed (≤ 60°, the smallest
tip in 5° steps: `proneReachGap`); ≤ **0.73 m** below the deck and ≤ **0.45 m** beyond the deck outline. Straight out, at the
lip's edge-reach 0.45 m the shoulders reach 0.68 m down; right below them 0.73 m. Otherwise `handup.no-receiver-station`
with the most specific reason from the station nearest the load.

**Beyond the lip** (W32; W29 saw p3 / p4's tipped chests pass through the joist tails j2 / j7 by up to 1.9 cm): at the
take the chest tipped every 15° up to the tip it needs (tip joint → shoulders, ±0.15 m across, from the spine to the chest's
front 0.10 m), the head (a 0.1 m ball 0.15 m on from the shoulders) and both arms (straight, shoulder joint → grip, 4 cm)
are swept against every obstacle but the load (joist tails, the edge beam, walls, the forklift). A hit rejects that heading
/ station; when a crew would work **but for** that sweep, the hand-up is refused `handup.rise-blocked` naming the member:
"s1 cannot be taken over the deck edge over b3 by receivers lying there: lying at (0.26, 0.60) turned 25° with the chest
tipped 30° over the lip, their right arm would pass through 6 ft 2x4 (j3) at (0.83, 2.65, 1.03); nowhere else along the edge
can two of them lie and reach it". `proneBodyHit` (handup.ts) is the same check for tests / other callers.

**The load's way up.** The givers raise it as before; with prone receivers the whole vertical corridor beside the edge,
from the carry height up to slide height, must be clear before the edge offset is chosen — so it comes up outside the
joist ends (since W30 the same corridor search serves kneeling receivers: "Kneeling rise" above). During `take` and the rise it goes **straight up**
outside the edge, level (no tilt, so the fragile-panel tilt limit holds trivially), and every sample of that path is
swept against everything, the members it will rest on included. If something outside the edge (a wall panel, a
cantilever) pushes the corridor out of prone reach, or blocks the rise where the forks hold it, the hand-up is refused
`handup.rise-blocked`, naming it: "s1 cannot rise past the deck edge over b3 in the hands of a receiver lying there:
plywood wall panel … (w1) is in the way of its rise at (…)". From slide height on they feed it in exactly as kneeling
receivers do (bentOver envelope from S, body gap 0.30 m).

**Phases** (receivers; each tick publishes `human.activity`, `human.hands`, `human.grip` from the reach on):

| phase | time | activity | load | hands |
| --- | --- | --- | --- | --- |
| lie_down | 0.8 s, as soon as they are at S (while the givers work) | `lie-down`, then `prone-wait` | — | hips → flat on the deck beside the chest (0.20 m along the lying heading, ±0.25 m; smoothstep); no grip; `proneYaw` turns from facing out to the lying heading |
| reach_down | 0.6 s (after the givers hold it at the edge) | `prone-reach` | held by the givers | deck → just outside the lip (+5 cm) → the grip (never through the edge) |
| take | 0.4 s | `prone-reach` | givers let go at the end | on the grip |
| push_up | ≥ 0.8 s (≤ 0.5 m/s average) | `push-up` | straight up to the lowest height both grips are in the kneel-up envelope | `hold` hand on the load; the other back over the lip onto the deck by 70 % of the phase, then pushing |
| kneel_up | ≥ 0.6 s | `kneel-up` | on up to slide height (members' top + 5 cm) | `hold` hand on the load; the other off the deck, over the lip, back onto the load |
| stand_with_load | 0.4 s | `stand_with_load` | still | both on the load; `pose.yaw` turns from the lying heading (`proneYaw`, then cleared) to facing the hands |
| lay, set_down | as kneeling | `lay`, `set_down` | fed in, set down | both on the load |

**Hand-point schema** (what the renderer reads; pose layers are the renderer track's):
- `human.activity` ∈ `lie-down`, `prone-wait`, `prone-reach`, `push-up`, `kneel-up` (then the existing `stand_with_load`,
  `lay`, `set_down`); `PRONE_ACTIVITY` in handup.ts. Prone body: S = `pose.p` 0.35 m behind the lip; `pose.yaw` faces
  straight out over the edge (the lip is PRONE_BACK ahead along it) until `stand_with_load`.
- **`human.proneYaw`** (W32): the lying body's axis (S → head, through the grip) as a world yaw, from `lie-down` (turning
  from `pose.yaw` with the lie-down's smoothstep) through `kneel-up`; absent otherwise. The renderer's body turn about S is
  `angleDelta(pose.yaw, proneYaw)` — W29's `lipAlong(turn)` then puts the lip where the engine has it
  (`proneLipAlong`); ≤ 45°.
- **`human.phaseK`** (W32): 0–1 progress within the current engine phase (lie-down; then reach_down, take, push_up,
  kneel_up, stand_with_load, lay, set_down — `prone-reach` spans reach_down + take, each 0 → 1), every tick from `lie-down`
  to the release; `prone-wait` = 1. Prone receivers only (a field on everyone would move every pinned hash). The rise
  coordinate is then exact: push-up r = smooth(phaseK), kneel-up 1 + smooth(phaseK), also mid-phase in a replay.
  Rise hip heights: BODY_MODEL.prone.hip.
- `human.grip.slot` = `handup-prone-<i>:<left|right>`: the named hand never lets go from the take to the set-down.
  `handupHands(part, pose, holder, slot)` returns the two-hand grip (valid at `take` and from `stand_with_load` on);
  during `prone-reach` approach, `push-up` and `kneel-up` the free hand is only in `human.hands` (and a take's `hands`).
- `human.hands` = `{ left, right }` world points every tick from `lie-down` to the release; continuous (≤ 0.25 m/tick,
  measured ≤ 0.152 m at 2.75 m). Deck-hand / lip points: `proneDeckHand(S, heading, j)`, `proneLipHand(S, heading, j, out)`
  (handup.ts; `heading` = the unit vector of `proneYaw`).
- Takes: `proneYaw` / `phaseK` reach a take only once the recorder's FIELDS list carries them (`engine/take/recorder.ts`,
  W31's area): until then a replay falls back to the renderer's own turn search and phase clocks.
- Outputs: a prone station's entry ends with `'prone'`.

Measured at the 2.75 m deck (W32; two givers, two prone receivers — the tallest beam seat whose hand-off from the ground
is within 0.73 m): 477 ticks; lie-down 0.8 s, reach 0.6 + take 0.4 s, push-up 0.8 s and kneel-up 0.8 s, hand-off 0.65–0.67 m
below the deck; p3 on d0 and p4 on d2 lie turned +20° / −20° (25° would put p3's right arm through j3's end), chest tipped
35–40°. (W28's 2.9 m deck — hand-off 0.83 m — is now `handup.too-high`.)

**Crews.** One or two receivers (a 4x6 sheet: 1–2). Each station carries its posture, and a kneeling receiver beside a
prone one would hold on through the rise (activity `take`); but because prone engages only where kneeling cannot reach
at all, today every receiver of a prone hand-up is prone.

**Tests** (`engine/test/handup-prone.test.ts`, 8; fixture: a 12 ft bay, 4x3 decks d0 / d2 on 4 ft joists ending at the
lip, the open middle's 6 ft joists overhanging 0.30 m): 2.75 m deck (the tallest seat the rig reaches from), two prone
receivers — hand-off 0.67 m below the deck, 0 violations, all hand points continuous, the `hold` hand equal to its grip
every rise tick, the free hand flat on the deck (along `proneYaw`) in the push-up, the sheet swept clear every tick of
reach / take / rise, `proneYaw` ≤ 45° while lying and `phaseK` 0–1 every tick (both cleared at the release, never on
anyone else), at every take tick each hand within its shoulder's reach at that heading and chest / head / arms past the
lip clear (`proneBodyHit`); one receiver alone + bit-identical rerun; a person / a stair tread where the only body that
reaches would lie → `handup.no-receiver-station` naming them; no deck → `handup.too-high` (…no deck covers b3 to lie on);
2.90 m deck (the next seat up: 0.83 m) → `handup.too-high` listing stand / kneel / prone; a wall panel in the rise corridor
→ `handup.rise-blocked` naming it; W29's geometry (6 ft joists under the decks too: tails 0.30 m past the lip) →
`handup.rise-blocked` naming the joist a chest / head / arm would pass through; off the forks 6 cm outside the joist ends
at a 2.90 m deck: 0.70 m below → prone, 0 violations (the limit at that presentation), 0.72 m → `handup.no-receiver-station`
(beyond the shoulders' reach), 0.74 m → `handup.too-high` "…raise the forks".

**Approximate.** Lying down, the push-up and the knees are timed pose phases with published hands and hip heights, not a
body simulation. The take is planned with the exact lying geometry; the rise (push-up / kneel-up) still with cylinders
about S, and the per-tick invariant with the cylinder bounding the lying reach (lean 1.06: it has no heading). The body
beyond the lip is swept at the take only (not through the rise); arms are straight segments (no elbow routed around a
joist end); the head is a ball. The lying footprint is checked at plan time against people where they stand then (they
may walk into it later: the spatial layer still sees only the disc at S). S stays at `pose.p` through the rise. Only the
edge beam the load comes over is searched for prone stations, and the grip is always the load's point nearest S. The
load is always level and comes straight up.

## Flagship v3
v2's build, deck handed up: 7 joists handed over b3 to crew[4] (on the beam), s1 by hand over b4 to
crew[4]/crew[5] on the beams, s2 off the forks (west side) to crew[4] kneeling on b3 just north of s2 and
crew[5] at s1's north-west corner (kneel rule; crew[4] steps onto s2 once it is fastened), then v2's
stair, spare tread, visitor, campfire. 12 ft bay (forks present a 4x6 long side first; s2 lies along
the bay). 88 steps, 16374 ticks (819 s simulated), 0 violations, ~10 s wall, pinned hash `39a0fb3f…`
(W27, 2026-09-29; history of re-pins in PLANNING_BUDGET.md). v3 has no kneeling rise through members: the joists and s1
are "direct" (the deck is at 1.99 m, the givers raise them to slide height), and s2 rises only 3 cm off the forks; a
per-tick sweep of all 937 receiver-held ticks finds 0 intersections, and W30 leaves the pin and the take unchanged.

## Approximate / not modelled
- Receivers feed a load hand over hand from a fixed station (their grip slides along the nearest edge);
  a sheet is never turned over the bay, so the forks can only deliver sheets parallel to the edge.
- The body envelope is a cylinder + arm-length test, not IK; bodies vs parts only through the 0.30 m
  body-gap rule for receivers; givers stand 0.3 m beyond the grip (a lever giver 0.25 m beside the end) by
  construction.
- Balance is checked for a single giver only (lever grip, free end ≤ 1.5 m); a single receiver feeding
  a joist in end-first is assumed to slide it over the edge beam (not checked), and sheets are not checked.
- Reach-down: 0.5 m below the feet kneeling (measured rig); lying prone at a deck edge 0.73 m below the deck (§13, measured rig since W32; above).
- Kneeling and prone rises are swept against everything at plan time (samples every 5 cm of motion) and per tick in
  the tests; the corridor is searched only outward along the edge normal (5 cm steps, ≤ 1 m), never sideways along the
  edge or with a tilt, and the load always comes straight up (W30). The kneeling
  envelope reaches 0.54 m at 0.45 m out, so the 0.5 m cap binds (`handup.too-high`), not station choice. Decks
  whose receivers stand > 2.05 + 0.5 ≈ 2.55 m above the givers' floor (plus the load's thickness) need the forklift.
- Fork height is not state after the load leaves the forks (the truck just parks); `forklift_back` is
  a straight creep.
- Climb paths are three straight segments; climbing is ≤ 1 person per link but two links on one
  column face are not mutually exclusive; a person on a beam may stand next to a column / on a joist.
- Frame links are in the API spatial scene by default (`servicesFor(scenes, { frameAccess })`, W8;
  `frameAccess: false` opts out); `hand_up` computes them from the world, so it works everywhere.
