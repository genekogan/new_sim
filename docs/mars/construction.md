# Construction

Rack frames, beams, decks, stairs, hand-up, roof framing, solar, paint, disassembly and generated builds. Code:
`engine/construction/`, `engine/work/paint.ts`, `engine/campus/` (generated builds). Spec: [spec.md](spec.md) §7, §10, §12,
§28. Every rule here is the **assembly model v1, approximate**: rule-based plausibility, not structural engineering
(`construction/rules.ts`, `RULES_VERSION`). Reach numbers come from the body model ([body-model.md](body-model.md)).

Common to every install verb: parts must be staged (lying on the ground or resting where they go) within reach of
their target, delivered by `carry` ([carry.md](carry.md)); crews hold nothing else; preconditions are re-checked when
the crew arrives; cancellation is refused mid-lift (`*.cancel-unsafe`) and fine during approach; symmetric lumber is
seated at whichever of yaw / yaw + π is nearer its staged yaw.

## Frames and beams

An *upright* is a complete two-column braced frame; *beams* join the columns of two parallel uprights to form a bay.

- `raise_upright`: footers hold the base; lifters raise the top end overhead and walk it up toward the base, hands on
  the columns, every step checked against geometry (`raise.station-blocked`). The frame ends `held` by the crew. A single
  person can raise an 8–9 ft frame.
- `connect_beam`: hangs a beam on a seat of two uprights (seats above standing reach are refused).
- `release_support`: allowed only when the stability rule holds. A group of beam-joined uprights is self-supporting iff
  it has ≥ 2 standing uprights and every upright has beams on both columns at ≥ N distinct heights (N = 1 for frames
  ≤ 9 ft, 2 for taller). Until then each upright must be held by ≥ `holdCrew` people. Other still-held uprights in the
  group are exempt from the height count.
- Invariant `uprightsSupported`: an upright that is neither held nor stable is a violation.

## Progressive construction: joists, decks, stairs

Code: `construction/{access,deck,stairs,contributor,liftcrew}.ts`; tests `engine/test/progressive.test.ts`. Build Spatial
with `new Spatial(base, { contributors: [progressiveContributor] })` and add `progressiveSupported` to the invariants.

Decks are plywood on 2x4 joists on rack beams. Joists stand on edge across the bay depth, bearing on the two beams at one
seat height, and may cantilever ≤ 12 in.

| Verb | Rules (refusal codes) |
| --- | --- |
| `install_joist {crew, joist, bay:{a,b}, height, at}` | beams on both columns at that seat (`joist.no-beams`), carrying load (`joist.beam-unsupported`); ends reach the beam centrelines (`joist.too-short`), cantilever ≤ 12 in (`joist.overhang`); clear of frames and other joists |
| `install_plywood {crew, sheet, x, z, yaw, height?}` | rests on the highest overlapping joists/beams: parallel supports, ≥ 2 counting supports (`plywood.too-few-supports`), centres ≤ 24 in (`plywood.span`), edge overhang ≤ 12 in, supports' chain intact, no overlap with installed sheets |
| `install_stair_flight {crew, stair, x, z, heading, level?}` | foot on a walkable floor (`stair.no-base`); top hooks onto a supported joist or beam (`stair.no-top-support`); site clear of obstacles and people; walked ≤ 3 m into place with a swept check |
| `install_tread {crew, stair, tread, index}` | flight installed, tread missing, a person beside the flight within reach |

Plywood directly on a beam pair is allowed only for beams ≤ 24 in apart, except under the reconstruction-frame rule
(`BEAM_DECK_SPAN_MAX`, 4 ft) used by generated builds.

**Swept lifts** (`access.ts sweptLiftPath`, also `connect_beam`): the part's box is tested along its lift path against every
obstacle except what it rests on or seats into; if the straight path is blocked, the lift goes up, across and down
(`lift.path-blocked` names the obstacle of each variant).

**Crew accompanies the part** (`liftcrew.ts`): holders take grip slots (`lift-end-*`, `lift-edge-*`, `lift-corner-*`) and
step with the part at ≤ 0.9 m/s; the part waits for them; a holder stuck > 2 s blocks the action (`lift.crew-blocked`).
Invariant `lift.hands-out-of-reach`.

**Work access.** A station is on a level whose floor is ≤ 2.06 m below the part's top, within 0.8 m of its footprint,
with clearance and route-reachable. Only supported, built decks count. Nothing eligible → `reach.too-high`; eligible but
unreachable → `reach.no-station`.

**Navigation (contributor).** Installed plywood with a complete support chain becomes a Surface on level
`round(y / 0.5)`. An installed flight becomes a Link, `usable` only when every tread is in, the top support is intact, a
landing surface contains the exit point and the foot is on a floor; otherwise walkers get `route.link-unusable` with the
reason ("treads 3, 7 missing"). Every install bumps the navigation epoch and affected walkers replan.

Invariant `progressiveSupported`: every installed joist, sheet, flight and tread has a complete support chain, else
`support.deck-unsupported` naming the missing link.

## Climbing the structure and hand-up

Code: `construction/{frame,framemove,handup,aloft}.ts`, hooks in `vehicles/forklift.ts`. Tests: `frame.test.ts`,
`handup.test.ts`, `handup-prone.test.ts`, `build-bay-v3.test.ts`.

**Only what exists is usable.** `climb:<upright>:<l|r>@<seat>` links exist on an installed, supported upright (one per
column and seat; 0.35 m/s; one person per column face, reserved as `climb-face:<upright>:<column>:<face>`; small loads
only). `beam:<beam>` walkways exist when a beam and its partner on the other column are installed (≤ 0.4 m/s, loads
≤ 10 kg, never under a deck). Both are narrower than a routing disc, so `walk_to` never routes over them. Verbs:
`climb_frame`, `beam_walk`. Invariant `frameAccessOk`.

**`hand_up {part, givers?, receivers, to, edge?, via?, operator?, stations?}`** stages a part exactly where it goes;
`install_joist` / `install_plywood` then only fasten it.

- Givers (on the floor): crouch, lift (hands hanging), walk it below the edge, reach up (underside ≤ floor + 2.06 m),
  push it in when in reach, let go after the take.
- Receivers (on a beam or deck): reach down, take, stand with it, feed it in hand over hand, set it down.
- Receiving postures are tried standing → kneeling → prone. Kneeling: hands ≤ 0.5 m below the feet, ≤ 0.8 m from them,
  ≤ 0.5 m beyond the edge. Prone (only where kneeling cannot reach and a deck covers the edge): lie 0.35 m behind the lip
  with the body axis through the grip, reach ≤ 0.73 m below the deck; then push up, kneel up and stand without letting
  go. The prone body beyond the lip is swept against every member at the take.
- The load rises straight up outside the edge (the corridor is searched outward in 5 cm steps) and comes in over the
  members at slide height; the rise and the feed-in are swept against everything (`handup.rise-blocked` names the member).
- A single giver handing up a long load end-first uses a lever grip; a free end > 1.5 m is `handup.unbalanced`.
- `via: 'forklift'`: `forklift_pick`, `forklift_present` (hold it raised at the edge), then receivers lift it off the
  forks; `forklift_back` backs the truck out. Decks beyond hand reach need the forklift (`handup.too-high` says so).
- Published per tick: `human.activity`, `human.hands`, `human.grip`; prone receivers also `human.proneYaw` and
  `human.phaseK`. `handupHands(part, pose, holder, slot)` rebuilds a grip from a take.

## Roof framing: top plates, rafters, blocking

Code: `world/catalog-framing.ts`, `construction/framing.ts`; test `framing.test.ts`. Verbs `install_top_plate`,
`install_rafter`, `install_blocking` (in `FRAMING_ACTIONS`; invariants `framingHandsInReach`, `framingSupported`). Crews:
givers on the floor, optional relay, installers on frame stances or a deck, optional fasteners. The member is lifted,
handed up through the relay, raised 2 cm above its supports, slid over them and fastened; hand-off heights are the middle
of the range both crews reach (`framing.gap`: "add a relay").

- **Top plate**: bears ≥ 1.5 in on ≥ 2 points (column tops, installed beam tops or a plate); its frames need top beams on
  both columns within `TOP_BEAM_BAND` (0.35 m); overhang ≤ 24 in.
- **Rafter**: both plates installed and parallel; spans square across; pitch = atan(Δtop / span) (±1°); bearing ≥ 1.5 in
  each side, tail ≤ 12 in.
- **Blocking**: between two installed rafters on the plate, square to them, 0–2 cm of play.
- Sheets on rafters need rafter centres ≤ 24 in (`RAFTER_SPACING_MAX`, `plywood.span`).

## Solar and paint

Code: `world/catalog-solar.ts`, `construction/solar.ts`, `carry/fragile.ts`, `work/paint.ts`. Tests `solar.test.ts`,
`paint.test.ts`.

- `install_rail {actor, rail, onto, at}`: on installed deck sheets (no overhang) or across ≥ 2 framing members at one
  height (`solar.rail-no-support`).
- `install_panel {crew:[a,b], panel, rails:[r1,r2], tilt, at?}`: two parallel installed rails level with each other; the
  panel rests on them (handed up, off the forks, or laid from the floor when the rails are within standing reach), then
  tilts about the rails' direction and is fastened. Higher rails from the floor: `solar.panel-too-high`.
- `place_equipment {actor, item, at, config?}`: battery, charge controller or inverter on the ground or a deck, with a
  config record. No electrical simulation.
- Fragile loads (`maxTilt`, e.g. 30° for panels): carrying up a steeper stair is refused (`carry.fragile-tilt`); invariant
  `fragileLoadsOk`.
- `paint {actor, panel, color | texture, face?, band?}`: upright paintable faces only; the painter works from spots
  0.4 m in front of the face, 0.2 m bands top-down; reach 0.5–2.06 m above their floor (`paint.out-of-reach`: "stand on a
  deck or beam"). Progress is `entity.paint = { face, coverage, bands[] }`; `paintHands` rebuilds the painter's hands
  from a take.

## Disassembly

`construction/disassembly.ts`: `remove_tread`, `remove_stair_flight`, `remove_plywood`, `remove_joist`, `hold_upright`,
`disconnect_beam`, `lower_upright`. Each takes one part from installed back to lying on the floor along its install path
in reverse; nothing is created or destroyed. A part comes down only when nothing bears on it, nobody stands on, under or
in its way, the drop spot is clear and every upright a beam joins is held. These verbs are not in the default registry:
an engine adds `DISASSEMBLY_ACTIONS` explicitly under its own rules version.

## Generated builds from material piles

Code: `campus/{assembly,bom,sequence,parts-b,sequence-b}.ts`, `world/catalog-stock.ts`, `world/catalog-phase-b.ts`,
`construction/{bundle,cut,stance,passup,setpart,wall,moves-b}.ts`, `scenarios/year-build.ts`. Tests:
`engine/test/year-*.test.ts`. The build order, piles and crew are hypothetical: a plausible sequence generated from a
canonical scene and the engine's rules. The acceptance target is the canonical checkpoint: every sequenced part ends
installed where the checkpoint has it (≤ 1 cm, ≤ 1°, `compareToCanonical`); everything else is reported with a reason,
never faked.

- **Assembly graph** (`assembly.ts`): maps a scene's kit pieces to catalog frames (posts + crossbar + bracing → one
  `upright-<ft>ft-kit`), beams (with sockets `col<l|r>@<seat>`) and opaque features, with "needs" relations, topologically
  ordered. Pieces that do not map are reported `unclassified`, never forced.
- **Bill of materials and piles** (`bom.ts`): exact frame and beam counts, estimates for decks, walls, stairs and solar,
  bundles (one static obstacle entity with `contents.count`), placed on one side of the building outside its work zone.
- **Verbs**: `take_from_bundle` (a piece appears lying beside the bundle); `cut` at a cutting station (kerf, offcuts,
  `cut.insufficient` with the arithmetic); frame stances (`climb_stance`, `leave_stance`: the bracing as a ladder at any
  seat height); `hold_frame`, `let_go` (refused for the last holder of an unstable frame); `hang_beam` (from the ground,
  handed up, or through a relay; every hand-off height checked, `hang.gap`); `pass_up` (a part to a given level);
  `install_stringer`, `install_stair_part`, `install_wall` (explicit holders, local grips, per-role support rules);
  `climb_stair`, `leave_stair`, `step_onto_beam`, `stack_offcut`.
- **Generator** (`sequence.ts`, `sequence-b.ts`): a fixed crew, bay by bay and row by row: frames off the stack, raised and
  held; low beams from the ground; middle beams handed up; release once beam-stable; top beams through a relay. Then
  sections in order: ground deck, first-floor deck, roof deck, stair, walls, solar. Steps depend on each actor's previous
  step plus physical preconditions; independent work overlaps. `yearBuildPlan(…, { bays })` builds only the first N bays.
- **Chapters** (`take/chapters.ts`): a long run is cut into consecutive takes at plan barriers, each starting exactly where
  the previous one ended.

## Approximations

- Lifts are interpolated along checked paths; a member's balance in two hands is not checked beyond the lever rule.
- Hand-offs are instantaneous grips after a short reach.
- No load limits, deflection or fastener rules; heights above reach need decks, stances or the forklift.
- Receivers feed a load from a fixed station; the hand-up rise is straight up along the edge normal, never tilted.
- Stances are points on a bracing lattice; climb paths are not body-checked.
- Sloped roofs are plan-tested only; tilt legs of solar mounts are drawn by the renderer, not engine entities.
- Painting covers flat upright faces only; coverage is an area fraction, not a texture mask.
