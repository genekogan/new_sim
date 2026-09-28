# Owner feedback after release 5 (Gene, 2026-09-28) — spec addendum

These are product requirements (treat like SPEC.md "must" statements). Each item lists what Gene
observed, the target behaviour, where it lives, and how to prove it. Delivered items must come with
tests and Playwright captures the lead looks at.

## 1. A real fire, not a static cone
Observed: the campfire renders as a static cone/glow.
Target: an animated fire — flickering flame layers (sprite/shader or layered noise-driven geometry),
embers, light flicker with a warm falloff, smoke optional; deterministic given the take time (seeded
by entity id + tick) so replays match. Night/dusk lighting should read as firelight on nearby people.
Where: renderer only (`app/engine-view/fixtures.ts` + a small shader/sprite module); studio ambience
fire (`app/studio/ambience*.ts`) should share it. No engine change.
Proof: lab campfire-evening captures at dusk (oblique + close); frame-to-frame difference test
showing the flame animates while people stand still; no console errors; perf unchanged (draw calls).

## 2. Gradual, human turning — spline the trajectories
Observed: walkers go straight, turn on the spot (sometimes ~270°), then go straight again.
Target: people turn while walking, like people do: the corridor polyline becomes a smooth path
(Catmull-Rom / clothoid-ish arcs of radius ≥ 0.6 m at walking speed, tighter when slow), speed
eased into turns, heading follows the path tangent; turn-in-place only when the required heading
change at zero speed exceeds ~120° (e.g. leaving a seat) and then the shorter direction, never 270°.
Hard constraints stay: the smoothed path must remain inside the corridor clearance (check every
sample against the grid, fall back to the polyline locally where the arc would cut a corner into
geometry), determinism, `motion.teleport`.
Where: `engine/locomotion/walk.ts` (path follower), possibly `spatial/path.ts` (emit corridor
width per segment so the smoother knows how much room it has).
Proof: heading-rate metric per tick (no jumps > turnRate·dt, no >180° turns), path stays clear,
existing walk/nav/social/flagship tests green (hashes will change — say so and re-pin), lab
captures of the U-trap and stairs approach showing curved footprints in the route overlay.

## 3. Notice obstacles immediately; never push into them for strides
Observed: people sometimes walk into an object, keep "walking" against it for 4–5 strides, then
redirect.
Target: a walker never spends more than one tick pushing against something. Detect the block the
tick it happens (person, carried load, newly placed part, formation), stop the walk animation
(stand/wait pose) and decide within ≤ 0.5 s: yield sideways, wait with a named reason, or replan.
Anticipate: look ahead along the corridor ~1.5 s and slow/deviate before contact rather than after.
Where: `walk.ts` (encounter/intrusion/stuck logic and the animation-speed signal it exposes),
`app/engine-view/humans.ts` (walk clip must not play while ground speed ≈ 0).
Proof: a metric in the take — "ticks with walk activity but < 0.05 m/s ground speed" — must be ~0
across the flagship, stress-30 and campfire scenes; a regression test placing an obstacle 0.4 m ahead
of a walker asserts the first blocked tick comes within 2 ticks and no forward motion after it.

## 4. Real stair climbing — feet on the treads
Observed: on stairs the Walk clip plays flat while the body levitates up the slope; feet pass through
treads.
Target: feet land on tread tops: per-step foot placement (foot IK: plant the swing foot on the next
tread top, pelvis rises per riser, knee bend), cadence matched to the tread pitch, hands free (or one
hand on a rail later). Descending likewise. Small stairs data need: the engine already gives the
exact step path (`Link.path`) — expose tread positions to the renderer; keep the engine's climb
timing (0.45 m/s along the path) or derive it from cadence.
Where: renderer (`app/engine-view/humans.ts`; a two-bone leg IK on the Quaternius rig — it has
UpperLeg/LowerLeg/Foot bones), plus `engine/spatial/types.ts` if tread data must be richer.
Proof: lab stairs + build-bay captures with feet on treads (lead inspects); a test sampling foot bone
heights vs tread tops (|Δ| < 3 cm at plant time); no sinking between treads.

## 5. Materials go up by hand or by forklift — no levitating plywood/boards
Observed: plywood and boards float up into place.
Target (the Martian way of making floors):
- Ground crew lift a sheet/board to the level above; **two people already up there, standing on
  the beams/uprights, take it from them** (hand-up: a `hand_up` verb with a receiving pair) and lay
  it on the joists. Nobody up top needs a finished floor: **builders stand on and climb the rack
  structure itself** (uprights' bracing = a ladder, beams = a walkway) while staging. Model
  climbable frames as links (uprights) and narrow walkable beams (walk with balance-limited speed,
  no carry while on a beam unless the load is small), with the same "only what exists is usable"
  rule as stairs.
- Or the forklift lifts the sheet to deck height where the two receivers take it from the forks.
- Arms and hands must be plausibly involved on both ends (poses honest; reach rules enforced).
- Anything above standing reach (2.1 m) requires one of these two mechanisms — otherwise the
  action is refused with a diagnostic, never interpolated.
Where: engine — `construction/deck.ts` (install_joist/plywood from beams and hand-up), new
`construction/handup.ts`, climbable-frame links in `construction/contributor.ts` +
`spatial/types.ts`, catalog handling; renderer — hand/arm poses for lift/receive, beam-walking pose.
Proof: flagship v3 builds the deck this way (two people on the beams receive sheets from two on
the ground; forklift variant for the second sheet), 0 violations, reach/hand invariants extended
(`lift.hands-out-of-reach` covers both ends of a hand-up), captures at the hand-up moment.

## Priority
5 (it changes how the flagship builds and is the most Mars-specific), then 3 and 2 (movement
quality, spec §10), then 4, then 1 (visual only). Items 2–4 change pinned hashes; do them early in a
session and re-pin once, with the reason recorded in PLANNING_BUDGET.md.
