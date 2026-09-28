# Renderer poses: stairs, handling, eating (owner feedback §3 renderer half, §4, §6, §12)

Code: `viewer/app/engine-view/` — `humans.ts` (per-person tick snapshots, layer order, arms), `rig.ts`
(bone chains, two-bone IK, palm), `stair-gait.ts` (pure: tread-by-tread foot placement), `posture.ts`
(pure: crouch / hip-bend / heel-raise / kneel solver), `items.ts` + `components.ts` (item meshes, in-hand
attachment, food level), `fixtures.ts` (one line: the 6 ft table mesh), `take-replay.ts` (`TakePeople`:
the take-replay half, shared by the studio and the lab check). Lab presets `meal`, `hand-up`, `body`
(`app/lab/meal.ts`, `hand-up.ts`, `body.ts`); hook `__marsEngine.bones(id?)`, `stairs()`, `heldItems()`,
`probe()`, `bodyModel()`, `recordTake()` / `humanFields()` / `replayTake()`.
Specs: `e2e/stairs.spec.ts`, `e2e/poses.spec.ts`, `e2e/meal.spec.ts` (+ `e2e/take-fixture.ts`).

Renderers only read the world. Everything below is a deterministic function of the engine's tick
history and the entity id (template, legs-crossed variant, warm-hands spread, which knee kneels);
nothing feeds back. (The lab `probe()` hook is the one exception: a renderer-only measurement tool in
the still `body` preset.)

## Body model (OWNER_DECISIONS "One body model")
`rig.ts BODY_MODEL` is the renderer's copy; the engine's is `engine/body/model.ts`. The rendered body
is fitted to it once per loaded template (`people.ts`):
- **scale**: each template uniformly so its shoulder joints stand at **1.34 m** (Idle, t = 0). The
  Quaternius rigs are stylised (big heads): scaled to 1.75 m overall their shoulders were at 1.32
  (casual), 1.25 (punk — its hair spikes counted as height) and 1.34 m (woman), eyes ≈ 1.6 m. A real
  1.75 m adult's shoulders are ≈ 1.42 m; lifting these rigs' shoulders there would make them 1.87 m tall
  with eyes at ≈ 1.72 m, so the rigs keep 1.34 m (crowns 1.75–1.77 m, punk's hair tips 1.88 m).
- **arms**: UpperArm and LowerArm lengthened by one factor k per side (casual 1.375, punk 1.378,
  woman 1.285; before: 0.47 / 0.47 / 0.50 m) so shoulder → elbow → palm centre = **0.62 m**, solved
  exactly from the Idle pose. The LowerArm / Wrist rest offsets and the clips' translation tracks for
  them are scaled by k (clips that share one accessor are scaled once), and the two bones' skin is
  stretched along the bone axis only (their bind inverses get a one-axis scale in bone space) — girth,
  hands and fingers unchanged, no shear. Bone lengths never change after that.
- **shrug**: the shoulder joint rises up to **5 cm** when the hand goes ≥ 0.5 m above it (the clavicle
  turns first, ~3 cm; the rest is the girdle rising), weighted by the contact the shrugged shoulder has.
- **palm** = a fixed point in the wrist frame (midway wrist → middle-finger knuckle at rig creation), so
  closing the fingers never moves it.

**Measured** (`poses.spec.ts` "body model", lab preset `body`, `probe()`; asserted within 2 cm):

| | casual | punk | woman | BODY_MODEL | engine model |
| --- | ---: | ---: | ---: | ---: | ---: |
| shoulder joints | 1.340 | 1.340 | 1.340 | 1.34 | **1.42** |
| shoulder half-width | 0.146 | 0.145 | 0.116 | — | **0.19** |
| arm (shoulder → palm) | 0.620 | 0.620 | 0.620 | 0.62 | 0.62 |
| overhead, heels down (palm) | 1.997 | 1.997 | 1.997 | 2.0 | 2.0 |
| overhead, heels up | 2.057 | 2.057 | 2.058 | 2.06 | 2.06 |
| reach-down, kneeling at an edge, 0.45 m out | 0.54 | 0.54 | 0.35 | 0.35 (all reach) | **1.0** |
| kneeling reach out, 0.1 m below the feet | 0.96 | 0.96 | 0.78 | — | 0.8 |

The spec asserts the renderer copy and the numbers the engine shares with it (arm, overhead, heels up),
and prints `ENGINE MISMATCH` lines for the rest. **Open (needs the engine / a decision):** a kneeling
body's shoulders stay above the deck (bent 150° over the edge, hips at the kneel height), so 0.62 m
of arm ends 0.35 (woman: long legs, short torso) – 0.54 m below the feet, not 1.0 m; the engine's
`posture.bentOver.lo −0.15` (shoulders below the feet) is not a pose this body has. Receivers' hand
points deeper than that hang (reach_down 172 / 264 reached below).

## The rig
Quaternius CC0 `animated-{casual,punk,woman}.glb`, clips Idle / Walk / Wave only, fitted as above.
Hierarchy: `Root → Body (pelvis) → {Hips → Abdomen → Torso → Chest → Shoulder/UpperArm/LowerArm/Wrist,
UpperLeg → LowerLeg}`; **`Foot.L/R` are children of Root** (baked IK targets), so moving the pelvis
leaves the feet where they are and every leg IK places the Foot bone at the shin end itself.
Measured once per rig from Idle at t = 0 (`measure()` in humans.ts): hip joints 0.89 (casual, punk) –
0.96 m (woman), thigh 0.41 / 0.46 m, shoulder joints 1.34 m, arm 0.62 m, ankle 0.02–0.03 m, the spine
chain (Hips → Abdomen → Torso → shoulder midpoint), the ankle in the shin frame, the rest foot rotation.
Left / right are taken from where the bones are, not from their names.

## Layer order (every frame; the clip pose is restored first, so nothing accumulates while paused)
1. **Clip**: Walk iff ground speed ≥ 0.08 m/s (engine `human.speed` from walk_to when published —
   MOVEMENT.md — else the position delta; a blocked walker `wait`s at speed 0; `climb-wait` standing
   still is Idle), blended in / out over **0.2 s**; Walk rate = speed / clip speed (≥ 0.35).
2. **Legs / pelvis** — one of:
   - **sit** (`sit`, `sit-down`, `stand-up`, and `eat` / `serve` whose `baseActivity` is `sit`): hips
     0.09 m above the seat surface (`fixtures.ts seatHeight`), thighs forward, feet on the ground by
     leg IK, blended over 0.4 s. **Legs-crossed** variant for about half the people (bit 15 of
     `imul(hash(id), 2654435761)`): right knee over the left, right ankle beside the left shin,
     faded in over the last 40 % of the sit-down.
   - **stairs** (the body is on a usable `stairs` link, `stair-gait.ts`): see below.
   - **posture** (`posture.ts`): see below.
3. **Torso bend** (posture): pitched forward at Hips / Abdomen / Torso by 60 / 20 / 20 %.
4. **Arms**: engine hand points (`human.hands`) → else the grip slot of `human.grip` (lift-far / hold-N
   column line ≤ 1.9 m, foot-l/r column base, liftcrew `lift-*` handPoint, `lift-station` none) → else
   seated hands on the thighs / warm hands to the fire. A shoulder shrug toward the target (up to 5 cm
   overhead, 2.5 cm down; Body model). Free arms on a torso bent > ~30° hang with gravity instead of
   keeping the clip's arm (which would point backwards). **Closed hand**: every arm in contact with its
   point (≥ 0.3, fully by 0.8) curls its fingers — each finger chain turns about the axis it already
   bends about in the clip pose (toward the palm): joints metacarpal / knuckle / middle / tip 0.1 /
   1.0 / 1.15 / 0.7 rad, the thumb 0.15 / 0.35 / 0.45 — so a held joist, sheet, bowl or spoon is gripped.
5. Items in hand ride the rendered palm (after all people are posed, `components.attachHeld`).

## Stairs (§4)
`flightOf(link)`: treads = the link path's interior points strictly between the bottom and top heights
(construction stairs: approach, foot, tread 1…N, top, approach; proving ground: ground, 15 treads,
deck edge). Foot spots k: 1…N treads, ≤ 0 the floor, ≥ N+1 the landing, one `going` apart.
Body coordinate u = 1 + (s − s₁)/going. One tread per step, feet alternating (left on odd spots): the
foot on spot k is planted for u ∈ [k − 0.7, k + 0.5] and swings to k + 2 over the next 0.8 (40 % swing,
20 % double support); swing = smoothstep along the axis, rise early going up (stay high going down),
clearance ≥ 7 cm over the tread in between. **A pure function of u**, so descending is the same motion
reversed and the cadence is locked to the tread pitch at any engine speed (0.45 m/s along the path).
Ankle = spot + ankle height, 4 cm behind the tread centre (the sole centred on the tread); the trailing
heel lifts up to 6 cm over the last half-step of its stance (toe-off; zero at every plant).
Pelvis: the clip's, lowered just enough that both legs reach their ankles at 0.97 of their length — it
rises riser by riser with the body point. Knees forward. Blended with the clip's legs over one tread
before / after the flight (gait weight in `bones().gait.weight`).
**Measured** (`stairs.spec.ts`, proving-ground stairs A, up and down, 209 ticks on the flight each):
15 / 14 plants, worst |sole − tread top| at plant **0.0 cm**, no tick with a sole > 3 cm below the tread
under it, hip 0.86–0.96 m above the lower sole (knees bend). Baseline `poses-stairs-mid-flight`.

## Handling postures (§5, §6)
Per tick the solver picks `{drop, bend, rise, kneel}` (pelvis lowered by bending the knees, feet
planted, down to a squat with hips 0.42 m up; torso bend; heels up ≤ 6 cm; or one knee down) that
minimises, in order: hands beyond 0.92 arm length from their shoulders (through the bent spine chain,
pelvis shifted back 0.3 × the shoulders' forward travel when standing), hands jammed closer than 0.4
arm length, then effort. Styles by activity:
- `knees` (crouch, lift, stand_with_load, carry, support/hold, release, idle with a grip): squat first,
  bend ≤ 80° (costly) — "lift from the knees"; kneel only when a squat + bend cannot do it (a ground
  pickup far out, a raise footer at the column base);
- `hips` (reach_down, take, lay, set_down, items `reach`, `serve`): bend ≤ 100° (cheap up to 60°, then
  steeply dearer — a straight-legged 100° bend read as lying on the load), squat allowed, or kneel;
- `up` (reach_up, walk-load, push): heels up, bend ≤ 30°;
- `walk` (anyone moving): drop ≤ 8 cm, bend ≤ 15°.
**Kneel** (one knee): hips straight above a knee resting on the floor (hip joints at kneecap 5 cm +
thigh: 0.46 m casual / punk, 0.51 m woman), that shin back along the floor with the toes tucked
(foot pitched 63° toes-down), the other foot planted 0.3 m out to its side and 0.12 m forward with the
knee up and out — so on a beam both stay on the beam line; the torso may bend to 150° over an edge;
no pelvis back-shift (the knee holds the body). Which knee goes down is fixed per person (id hash).
Blended in with the posture (kneel 0 → 1 over 0.4 s: the knee travels down with the pelvis).
Targets: the engine hand points, else each arm's grip slot point from a standing-shoulder estimate.
The result approaches its goal at ≤ 0.55 m / 1.6 rad / 6 cm per 0.4 s (the §6 blend), interpolated
between ticks. Take replay (`setFrame`) solves each frame without the blend.

## Reach honesty (kept)
Contact weight by shoulder → point distance: full within 1.02 arm lengths (reach clamped at 0.97; 0.88
for carriers, elbows bent), fading to none at 1.25; beyond that the arm hangs. Bone lengths never
change. `bones()` reports per arm: shoulder, palm, arm length, target, contact, palm error, ratio.
**Measured**:
- meal (631 ticks, 4372 engine hand points): **99.0 % reached within 0.1 m**; every point within the
  rig's arm length reached (worst 0.7 cm); no arm longer than its bones; held items within grip offset
  + 2 cm of the palm on every tick.
- hand-up v3 at `b7c901a` (the engine on the one body model; 16219 ticks, 5518 points): **89.5 %
  reached** with the body-model arms and the kneel (63.3 % with the old 0.44–0.50 m arms on the same
  engine; 54.8 % at `cdcf731`); **0 misses among points the rig can reach**; no over-long arm. Per
  activity, before → after: crouch 78 → 119 / 216, lift 214 → 216 / 216, walk-load 304 → 514 / 514,
  reach_up 620 → 1773 / 2166, reach_down 148 → 172 / 264, take 176 / 176, stand_with_load
  161 → 176 / 176, lay 1592 / 1592, set_down 198 / 198. Still missed: reach_up points above the 2.06 m
  the body reaches (up to ~1 m out), reach_down deeper than a kneeling body reaches (Body model,
  "Open"), the 0.6 s crouch while the body is still going down. `poses.spec.ts` floor: 88 %.

## Items and eating (§12)
Item meshes (`items.ts`): bowl / cup / plate / pot as lathe-turned open vessels (pot with side
handles), spoon = handle + small bowl at local +x; a food disc whose height and radius follow
`contents.fraction` (hidden at 0; stew brown). `table-6ft`: top slab + four legs + stretchers.
`resting-on` / `ground` items render at their engine pose (interpolated); **`in-hand` items ride the
holder's rendered palm** with the catalog grip offset (item = palm − rot(grip, yaw), upright, the
holder's yaw) — when an arm cannot reach its engine point the item stays in the hand. The spoon aims
from the hand at the bowl in the other hand when low and at the rig's lips when raised, sliding back in
the grip so its tip stops at the lips.
Eat: seated base (legs from the sit layer), arms to the engine hand points. The engine's mouth landmark
(0.15 m ahead of the body axis at 1.58 m, −0.45 seated) is 7 cm ahead of and 3 cm above this rig's lips,
so a palm exactly on it covered the face: within 0.12 m of the landmark the palm target moves 5 cm
forward and 7 cm down (≤ 8.6 cm from the engine point) and the spoon reaches the lips.
Captures: `meal-sit-down`, `meal-spoon-at-mouth` and `meal-legs-crossed` (baselines), `meal-oblique`.

## Take replay (studio; `take-replay.ts` `TakePeople`)
The studio's replay and the lab check pose people from a take with the live path: `HumanViews.setFrame`
(random access, posture solved without the blend) → `render` → `components.attachHeld`. Per frame:
- **hands** (take field `hands`, HumanState): the last recorded value, blended into the next one when
  that is the next tick (a hand moving every tick); arms, postures and the eat mouth offset follow them;
- **baseActivity**: eat / serve on a seated base sit (seat at the default 0.45 m: a take has no
  fixtures); **on** (beam / climb link): carried to `bones().on`, a readout only (as in the lab);
- **components** take their phase / support / connections (and contents, when recorded) from the frame,
  not from the final state — so items `in-hand` ride the replayed palms and parts are where they were;
- **stairs**: usable stairs links of the base SpatialScene (`TakeReplay(file, { scene })`, when the host
  has it) plus the construction contributor (`progressiveContributor`) over the frame's components —
  a flight is walked tread by tread once installed with all its treads.
The recorder does not store `hands` / `baseActivity` / `on` yet (engine W10); until it does, the specs
prove the path with a **fixture**: the lab records its own run with the engine's TakeRecorder and the
spec adds those three fields as change events (`e2e/take-fixture.ts` — not real recorder output).
**Measured**: meal replay (31 frames, every 20th tick, 219 engine hand points) — every live arm on an
engine hand point is on the same point in the replay (0 wrong), live reaches 216 and the replay 216,
eaters keep their seated base, held items on the replayed palms (0 off); stairs replay (42 frames on
stairs A) — the replayed climber is on the same flight, soles within **0.0 cm** of the live ones.
The studio host (`app/studio/take-host.ts`) passes no base scene (the flagship take's stairs are
construction stairs, found by the contributor); campus stairs in a take would need the campus scene.

## Approximate / not done
- Wrists keep the clip rotation; the closed hand is one curl for every grip (no per-item hand shape).
- Postures are knee squat + hip bend + heel raise + one-knee kneel: no two-knee kneel, no prone reach,
  no side lean, no stepping, no torso twist; a 150° kneeling bend over an edge is steep (the head hangs
  below the deck) — it is what reaching below a deck takes with this body.
- Reach-down is shallower than the engine allows (Body model, "Open"); those receivers' arms hang.
- No body-vs-object collision: a squatting foot can overlap a part lying on the ground, the crossed
  knee can touch the bowl, thighs can clip chair arms.
- Stair gait only on `stairs` links, not on `climb` (frame climbing plays Idle while the body rises) or
  `beam` links (beam walking plays the flat Walk clip). A person standing still mid-flight (climb-wait)
  can keep a foot mid-swing.
- The posture blend lags the engine's hand points by up to 0.4 s (crouch misses).
- Take replay: food level follows `contents` only if the take records it (the recorder does not: the
  final state's fill is shown); seats at a default height; the kneeling side and legs-crossed variant
  are per id, as live.
