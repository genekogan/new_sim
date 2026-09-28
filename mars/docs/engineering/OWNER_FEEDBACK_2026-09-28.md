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

## 6. Body motions for handling: kneel, crouch, reach up, reach down
Observed: people handle parts from a standing Idle/Walk pose; hands reach only when the part happens
to be near shoulder height.
Target: a small vocabulary of procedural body motions, driven by the engine's activity + grip data
and blended over ~0.4 s (only Idle/Walk/Wave clips exist, so these are pose layers on the rig's
hip/knee/spine/shoulder bones):
- **crouch / kneel** to grip a part lying on the ground (beam, 2x4, tread, sheet), then **stand with
  the load** — lift from the knees, torso upright; used at every pickup and set-down, in carry and in
  construction lifts.
- **reach up**: arms extended overhead to pass a part above head height; **reach down**: bending at
  the hips (or kneeling at a deck edge) with arms extended below the feet to receive a part from
  below. The hand-up in item 5 is exactly these two: two people on the ground crouch → stand → reach
  up with a beam or sheet; two people on the level above reach down, take it, then stand and lay it.
- **hold high / hold low** for footers and lifters during a raise (hands where the engine's grip slot
  is, at whatever height that is — crouching when it is low, reaching when it is high).
Engine side: the hand-up verb (item 5) must publish per-tick hand points for all four people so the
renderer can pose them; reach envelopes (max overhead reach ≈ 2.1 m, max reach-down from a deck edge
≈ 1.0 m below the feet, load must be within ≈ 0.5 m horizontally of the edge) are engine rules —
the action is refused if the geometry doesn't allow a genuine hand-off (deck too high for a sheet:
use the forklift).
Where: renderer `app/engine-view/humans.ts` (pose layers; keep the existing reach-honesty rule —
arms hang if the hand point is truly out of reach); engine `construction/handup.ts` (hand points,
reach rules), `carry/actions.ts` (pickup/set-down phases expose crouch), `raise.ts` (slot heights).
Proof: close-up captures of a pickup (crouch → stand), a hand-up (reach up below, reach down above),
a raise footer holding low; a per-tick test that every gripping hand is within 0.1 m of its engine
hand point when the engine says it is reachable, and that no arm exceeds its length.

## Evidence photos (Gene, 2026-09-28) — `docs/engineering/evidence/`
- `2026-09-28-skeleton-stage-racks-2x4-frame-before-plywood.jpg` — a building after most pallet racks are
  up and the 2x4 top framing is in, before any plywood: mixed green/red/blue uprights (three frame heights
  visible: a low run on the left, a taller middle, tallest at the right), orange and blue beams, 2x4 top
  plates/rafters and a long 2x4 stair-ramp on the right end reaching the top level; trailers parked behind;
  on the ground: strapped 2x4/2x6 bundles, plywood stacks, a metal grate, a folding chair; a forklift at
  the far right. This is the canonical **skeleton stage**.
- `2026-09-28-material-piles-plywood-2x4-2x6-timbers.jpg` — plywood in strapped bundles (~20–30 sheets,
  several stacks), strapped bundles of 2x4 and 2x6 (long, ~16–20 ft), salvaged heavy timbers/railroad ties
  at the right, loose boards on the ground, vehicle tracks. The pile geometry the piles in the engine
  should look like (bundles, not loose sheets side by side).
- `2026-09-28-material-piles-with-loader.jpg` — the same yard with a yellow loader/backhoe behind the
  plywood, a wheel (EUC) on the ground, more timbers.

## 7. MAJOR MILESTONE — replay the entire construction of each Mars year from raw piles
Target: for each canonical year 2020–2026, a long timeline in which people build the campus **from
material piles to the finished reconstruction**: uprights and beams, plywood, 2x4s, 2x6s and other wood,
doors, windows and other features where the reconstruction has them, solar (item 9). The end state of
the timeline must equal the year's canonical state (same components, same placements — the year's
protected checkpoint is the acceptance target; provenance stays what it is, the *sequence* is
hypothetical unless documented).
Build order is the Mars way (photo 1): **skeleton first** — raise and connect large tranches of pallet
racks, then the 2x4 framing (top plates, rafters, joists), then a stair/ramp to the upper level — and
only then floors, ceilings and walls, added gradually in a logical, ergonomic and safe order (you can
stand on what exists; you never need what doesn't exist yet). Materials arrive by the hand-up /
climb-the-structure / forklift mechanisms of items 5–6; nothing levitates. There is wood-cutting
equipment on site: a `cut` verb at a cutting station turns stock lengths into the sizes the
reconstruction needs (a 4x8 sheet → the 4x6 the bay uses, a 16 ft 2x4 → 8 ft), with offcuts.
Piles look like the photos: strapped bundles that are unbundled as people take from them.
Deliverables: a per-year **construction sequence generator** (from the canonical scene, derive an
assembly graph: which components rest on / connect to which, then a safe order that respects support
rules and access), material piles sized from the year's bill of materials, a director-run take per year
with camera tracks, and a comparison test: final state == canonical (component set and placements within
1 cm / 1°; anything the generator could not place is reported, never faked). Milestone evidence: takes
for all seven years replayable in the studio, each with its blocked/refused log and 0 violations.
Where: `engine/construction/` (2x6, top plates, rafters, walls, ceilings, doors, windows as install
verbs with support rules; `cut`; bill of materials), `engine/campus/` (assembly graph from the year
scenes — needs the component kinds/relations the Kit already knows), `engine/scenarios/` (per-year
templates), `deploy/record-year-take.mjs`, studio replay picker per year.

## 8. Painting
Target: a person stands in front of a wall panel and paints it: `paint {actor, panel, color|texture}`
— walk to a standing spot facing the panel within arm's reach, a painting motion (arm sweeps over the
reachable band; higher bands need standing on something — the reach rules apply), the panel's
material changes progressively (coverage fraction per tick, visible in the renderer and stored in the
take). Murals (e.g. 2024 flower mural) are the motivating case; texture from the reconstruction.
Where: `engine/social/` or a new `engine/work/` (paint verb + progress state on the entity),
renderer material progress, catalog `paintable` faces.

## 9. Solar panels are their own thing
Target: solar panels (and their mounts/rails) are catalog items with their own **piles**; people carry
them (2-person carry, fragile: no tilting past ~30°, no dropping), pass them up (hand-up) or forklift
them, and mount them on roofs/top decks at the reconstruction's tilt; batteries, charge controllers and
inverters are placed items too (spec §19: identifiable and configurable, no electrical simulation yet).
The 2024 stepped panels and every year's roof arrays come from the same verbs.
Where: catalog (`solar-panel-<size>`, `panel-rail`), `construction/solar.ts` (install verbs with
support: rails on framing), piles in the year bill of materials, renderer.

## 11. Autonomous, expressive camera direction (a full tranche)
Today the camera planner takes a typed shot list (fixed/follow/orbit/frameGroup/path/reveal/establishing)
and validates collision, occlusion and smoothness against prisms, people and take parts. Gene wants a
layer above it that turns *directions* into excellent, self-correcting camera work, e.g.:
- "do a pan across Chiba with the sunset in the background"
- "do a 270° revolution around the main pallet racks over 2 minutes"
- "go inside the kitchen and face the sink"
- "look at this crowd of people having this activity"
Target — three layers, all deterministic and testable:
1. **Direction language → shot program.** A typed `CameraDirection` vocabulary the director (LLM) fills
   in: subject(s) by name/region/activity ("the main pallet racks", "the crowd doing X" → the group
   currently in that social action), motion verb (pan, tilt, dolly, orbit/revolve by angle, crane, push-in,
   pull-out, fly-through, hold), duration/speed, framing (wide/medium/close, headroom, rule-of-thirds
   target), context constraints ("with the sunset in the background" → azimuth/elevation window computed
   from `env/sun.ts` for the take's date-time; "inside the kitchen" → region + interior camera mode;
   "face the sink" → a named fixture/affordance as look-at). Resolve names through the semantic world
   (regions, assemblies, catalog, social slots) and reject ambiguity with a structured question, not a
   guess. Compile to a shot program: keyframed pose + look-at + lens over time.
2. **Trajectory synthesis with calculation, not hand-placed keys.** Given the program, *compute* the
   path: orbit radius from the subject's extent and lens; sunset-behind means the camera azimuth is
   opposite the sun within a tolerance band and the elevation keeps the sun in frame without blowing out
   the subject; interior moves are planned as paths through the walkable/flyable volume (a camera
   navmesh: the level grids plus a "flight" layer above head height, rooms as regions, door openings as
   links) so "go inside the kitchen" is a collision-free route through the door, not a straight line
   through a wall; smoothness by C² splines with speed easing; the subject stays framed by continuous
   look-at solving.
3. **Self-correction against failure modes.** Before committing, simulate the whole shot against the take
   and score every sample (existing readability/collision/coherence plus new checks): stuck between two
   sheets of plywood or inside a rack bay (free-space radius below a minimum → re-route or lift), behind
   a person's head (people occluders — already modelled — plus a "foreground blob" penalty), sun flare
   directly on axis, subject leaving frame during an orbit because it moves (orbit centre follows the
   subject's predicted path), horizon tilt, motion sickness (angular velocity/acceleration caps), and
   cut points when a continuous shot cannot be made valid. Correction strategies are explicit and ranked
   (raise, widen, swing, re-route, shorten, split into two shots, cut) and the chosen fix is recorded in
   the track's report with the reason, so a director can read why a shot changed. Verify the final track
   with the render-side raycast pass (CAMERA_VERIFY) and feed disagreements back as a regression.
Proof: a test suite of direction sentences → expected shot programs (unit), synthesized tracks that are
valid on the campus take and on year scenes (including an interior kitchen move through a door and a
270° orbit of a rack bay with crew moving inside it), a "stuck between plywood" fixture that must be
self-corrected, sunset-behind verified against the sun model, and the MCP tool `engine_direct_camera
{ take, directions[] }` returning the track plus the corrections report. Studio: the direction text and
the resulting shot list shown in the replay bar.
Where: `engine/camera/direct.ts` (vocabulary + compiler), `engine/camera/synth.ts` (trajectory
synthesis, camera navmesh/flight layer using `spatial/`), `engine/camera/solve.ts` (new failure modes +
ranked corrections), `env/sun.ts` (sun-behind windows), `api/` (tool), studio replay UI. Keep the rule
that cameras never mutate the world and never hide geometry except in an explicit cutaway mode.
Size: a full tranche on its own; schedule after the hand-up/handling work and the first year replay,
because the year replays are what it will be pointed at.

## 10. What "done" looks like for this thread
The studio's year picker offers, for each year, **"Watch it being built"**: a take from empty desert +
piles to the canonical campus, with the engine camera, at any speed, with the log of every refusal
and wait — and the final frame equal to the reconstruction. Together with items 1–6 this is the next
tranche's headline.

## 12. Chairs, tables with food, and eating together (Gene, 2026-09-28 late)
Observed/asked: chairs; a person walks up to a chair, turns so their back is to it, sits down exactly on it
and rests (stretch: crosses one leg over the other); tables with things on them, e.g. food; people go to a
table, take a bowl and a spoon in their hands, walk to a chair among other people, sit, and eat together —
bowl held in front of the chest, spoon dips into the bowl, comes up to the mouth, back down, repeat — while
socialising. Gene: pick the 80/20 version (no chewing, no food leaving the plate, no spill physics); keep it
renderable; more detail later.
What exists: `sit` / `take_slot` / `stand` (SOCIAL.md: approach point → turn to seat yaw (back to the
chair) → `sit-down` 0.6 s → `sit`; renderer sit pose). What is new:
- **Catalog**: `table-6ft` (top height 0.75 m, `surfaceSlots` on the top for items), `camp-chair` stays;
  **small items** `bowl`, `spoon`, `plate`, `cup`, `pot` (hand-held, ≤ 1 kg, `handling.smallLoad`), with a
  `contents` field (`food: 'stew'|…, fraction 0..1`) so a bowl can be emptied over a meal.
- **Items on surfaces**: an item rests on a `surfaceSlot` of a table (support `resting-on`), or in a hand
  (support `held`, a named hand `left|right`), or on a lap/knee while seated. Placed items are part of the
  world state and the take; provenance as usual.
- **Verbs** (`engine/social/` or a new `engine/items/`): `take_item {actor, item, hand}` (walk to the table
  edge within reach ≤ 0.6 m of the item, reach, grasp; refused with a diagnostic if out of reach, item held
  by someone else, or the hand is full), `put_item {actor, item, surfaceSlot|ground}`, `serve {actor, from:
  pot, into: bowl}` (optional, fills a bowl at the pot), `eat {actor, bowl, spoon, until?}`: requires the
  actor seated (or standing still), bowl in one hand, spoon in the other; a deterministic eat cycle
  (≈ 2.4 s: dip 0.6 → lift to mouth 0.6 → pause 0.4 → return 0.8) publishing per-tick **hand points** (bowl
  hand ≈ 0.25 m in front of the chest; spoon hand from the bowl rim to the mouth point of the rig) and
  decrementing `contents.fraction` per cycle until empty or `until`; `eat` can run inside a `converse` /
  `gather` so people eat and socialise together (social pre-emption rules as today).
- **Approach/sit naturalness**: keep the present approach → turn → sit-down, but the turn must use the
  splined-turn rules (§2, shorter direction) and the seat point must match the chair's seat exactly (renderer
  pelvis on the seat surface, feet on the ground). Stretch: `sit` variant `legs-crossed` (renderer pose layer
  only, chosen deterministically per person/seat).
- **Renderer**: small items attach to the hand bones with a per-item grip offset; eat cycle as a pose layer
  on the arms driven by the engine hand points (same reach-honesty rule: arms hang if the hand point is
  out of reach); items resting on tables rendered from world state.
- **Proof**: a `meal` scenario (Lab + a test): pot and bowls on a table, four chairs around a fire or in a
  circle; four people take a bowl and spoon each, walk to chairs, sit (back to the chair, then down), eat
  together while conversing, bowls empty over ~5 cycles, 0 violations; invalid cases: bowl out of reach,
  hand already full, eating while walking (refused), sitting on an occupied chair (existing conflict).
  Playwright captures of the approach+sit and of a spoon-to-mouth moment, inspected by the lead.
Where: catalog (`world/catalog.ts`), `engine/items/` (new), `engine/social/actions.ts` (eat inside groups),
renderer `app/engine-view/humans.ts` (pose layer, hand props) + `components.ts`/`fixtures.ts` (items).
Priority: after the hand-up/handling work; it shares the crouch/reach vocabulary of §6 and the hand-point
schema, so it should reuse them rather than invent a second one.

## Priority
5 with 6 (they are one feature: the hand-up is the reach-up/reach-down motion pair, and pickups need
the crouch) — these are prerequisites for 7; then 7 (the headline: full-year construction replays, start
with 2026 or the simplest year, skeleton stage first as its own demo), with 9 (solar) and 8 (paint) as
verbs inside it; 3 and 2 (movement quality, spec §10) and 4 alongside because every construction take
shows them; 1 (fire) last. Item 11 (autonomous camera direction) is its own tranche once the first
year replay exists to point it at. Items 2–4 change pinned hashes; do them early in a
session and re-pin once, with the reason recorded in PLANNING_BUDGET.md.
12 (chairs/tables/eating) comes after 5+6 and reuses their hand-point schema; engine first, renderer with the §4/§6 pose track.
