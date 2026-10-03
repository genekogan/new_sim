# Renderer poses: stairs, handling, eating, the rack structure, the prone receiver (owner feedback §3 renderer half, §4, §5, §6, §7, §12, §13)

> Inherited native reference: source dates, release IDs and operating instructions
> retain their original scope. For the current Eden fork use [the index](README.md),
> [STATUS](../STATUS.md) and the Sim runbook; this file is not production authority.


Code: `viewer/app/engine-view/` — `humans.ts` (per-person tick snapshots, layer order, arms), `rig.ts`
(bone chains, two-bone IK, palm), `stair-gait.ts` (pure: tread-by-tread foot placement), `frame-gait.ts`
(pure: climbing a frame, standing on its bracing, balance on a beam), `posture.ts`
(pure: crouch / hip-bend / heel-raise / kneel solver), `prone.ts` (pure: lying on the stomach at a deck edge and
getting up), `items.ts` + `components.ts` (item meshes, in-hand
attachment, food level), `fixtures.ts` (one line: the 6 ft table mesh), `take-replay.ts` (`TakePeople`:
the take-replay half, shared by the studio and the lab check). Lab presets `meal`, `hand-up`, `body`, `prone`,
`prone-forks`, `year-build-2022` (`app/lab/meal.ts`, `hand-up.ts`, `body.ts`, `prone.ts`, `year-build.ts`); hook
`__marsEngine.bones(id?)`, `meshPoints(id)`, `stairs()`, `heldItems()`,
`probe()`, `bodyModel()`, `recordTake()` / `humanFields()` / `replayTake()`.
Specs: `e2e/stairs.spec.ts`, `e2e/poses.spec.ts`, `e2e/prone.spec.ts`, `e2e/meal.spec.ts` (+ `e2e/take-fixture.ts`), `e2e/year-build.spec.ts`.

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
   - **frame** (climbing a frame, on a frame stance: `frame-gait.ts`, "Rack structure" below): feet on rungs /
     the bracing node, pelvis over the body point lowered until both legs reach (and by the posture's drop).
   - **posture** (`posture.ts`): see below.
3. **Torso bend** (posture): pitched forward at Hips / Abdomen / Torso by 60 / 20 / 20 %.
4. **Arms**: engine hand points (`human.hands`) → else the grip slot of `human.grip` (lift-far / hold-N
   column line ≤ 1.9 m, foot-l/r column base, liftcrew `lift-*` handPoint, `lift-station` none) → else
   seated hands on the thighs / warm hands to the fire / **frame holds** (climbing, on the bracing) and the
   balance pose on a beam (renderer-chosen, source `frame` in `bones()`). A shoulder shrug toward the target (up to 5 cm
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
- hand-up v3 on W12's landmarks (`36aa230`, re-pinned 16237 ticks, 5554 points): **91.8 %** (5101); with W14's
  25° walking bend **92.5 %** (5137): crouch 201 / 216, lift 216 / 216, walk-load 478 → 514 / 514, reach_up
  1811 / 2202, reach_down 253 / 264, take 176 / 176, stand_with_load 176 / 176, lay 1592 / 1592, set_down 198 / 198;
  0 rig-reachable misses. (`[body] ENGINE MISMATCH reachDownBelowFeet` still printed: the woman template reaches
  0.35 m below its feet at 0.45 m out, the engine allows 0.5 — Body model, "Open".)
- year build 2022 east-house, first bay (every 3rd tick of 41 019; 9668 points): **76.5 %** (62.6 % before the
  stance turn and the 25° walking bend); 0 rig-reachable misses. By activity: crouch 138 / 288, lift 643 / 956,
  walk-load 3438 / 4116, hook 333 / 444, reach_up 2588 / 3464, take 256 / 400. What is missed is engine geometry
  the body cannot follow: in `hang_beam` both lifters face the direction they walk the beam in, so the rear one
  carries, lowers and slides it with the hands 0.35–0.65 m **behind** the back (`walk-load`, `lift`, `hook` at the
  0.22 m seat); installers on the bracing hold a beam 0.73–0.79 m to the side of the body point, above the
  shoulders on the way to the 4.76 m seat (no side lean in the rig); the 0.6 s crouch still going down.

## Rack structure: climbing, frame stances, beams (§5, §7; HANDUP.md, YEAR_BUILD.md)
`frame-gait.ts` (pure) gives, per person and frame, a context from `human.on` + activity (`frameCtx`) and a pose
for the interpolated body point (`framePose`); `humans.ts` applies it (`frameLegs`, arm holds, facing).
- **Climbing** (`climb-up` / `climb-down`, on a W2 `climb:<upright>:<l|r>@<seat>` link or a year-build frame
  stance `stance:…`): the climber **faces the frame** — the hold line is the frame-plane point in front of the
  climb axis, clamped between the columns, so a stance climber (who goes up just outside the column) holds the
  column and a W2 climber (inward of the column, off the face) holds the bracing in front. The engine keeps the
  stance / link heading as the body's yaw; the rendered facing is the renderer's reading of "climbing the frame"
  (blended in over the first 0.2 m of height). A diagonal **two-hand, two-foot ladder cycle**: rungs at 0.25 m
  (the Kit frame's lowest bracing node) then every 0.35 m (half the Kit's 0.7 m node pitch), clamped to the top;
  each foot is planted for most of a two-rung cycle and moves up two rungs in the rest (the stair gait's timing,
  left foot on odd rungs); each hand is 1.2 m above the rung of the opposite foot, half a rung ahead of it. A
  pure function of the body height: climbing down is the same motion reversed, the cadence locked to the rung
  pitch at the engine's 0.35 m/s. On the top segment (round the column onto the face / the beam end) the feet
  finish onto the top rung and blend to the stance (or to the clip's legs at a beam end). The pelvis is lowered
  until both legs reach their feet (the feet are on the frame ~0.3–0.45 m ahead of the body point).
- **Frame stance** (`stance:…`, activity `stance` / `take` / `reach_up` / `hook`): both soles on the bracing
  node in the frame plane (the body point is 0.36 m off it: a ladder stance), feet side by side across the
  rendered facing; free hands on the column (1.3 m above the feet) and the bracing in front (1.1 m, toward the
  middle of the frame). Holding a load (`hang_beam` hand points: a beam passing 0.3 m + the 0.457 m stage axis
  beside a body that faces its frame) the person **turns on the rod toward the load**, up to 100° (feet stay on
  the node; the posture is solved in the turned frame — crouch / bend allowed, no kneel, no heel rise).
- **Beam** (`beam-walk`): arms a little out and down for balance (hands 0.45 m out, ~0.35 m below the
  shoulders), short steps (Walk weight halved, cadence ×1.8 — half-length strides at the engine's speed).
- **Kit frames** are drawn with the Kit's bracing (`components.ts`: one rod per 0.7 m from column −x at
  0.25 + 0.7k to column +x 0.66 m higher), so stance feet land on drawn rod ends; climbing rungs at 0.35 m
  are not IK'd to the rods (every other one is near a node).
**Measured** (`e2e/year-build.spec.ts`, first bay, every 3rd tick of 41 019; `poses.spec.ts` v3 climb):
stance soles on their node 44 516 / 44 516 (≤ 3 cm), planted climbing feet on their rung 3 808 / 3 808, frame
holds reached 99.95 % (47 257 / 47 280; the rest ≤ 1.07 arm lengths during the climb's top blend), v3 W2 climb
85 / 85 planted feet on rungs and 140 / 140 holds, beam-walk arms on their balance points; no arm longer than its bones.

## Prone receiver (§13; engine HANDUP.md "Prone receiver", BODY_MODEL.md "Prone receiver + rise"; W29, W35)
`prone.ts` (pure numbers) + `humans.ts` (`proneGoal` per tick, `proneBody` per frame, `flatHand`). The engine publishes
`human.activity` (`lie-down`, `prone-wait`, `prone-reach`, `push-up`, `kneel-up`, then `stand_with_load` …), `human.hands`
every tick, S = `pose.p` 0.35 m behind the deck lip facing out (`pose.yaw`), and since W32 **`human.proneYaw`** (the lying
body's axis through the grip) and **`human.phaseK`** (0–1 within the current engine phase). The renderer reads both
(W35); the torso pitch, the placement from the rig and the arms are the renderer's.
- **One rise coordinate r**: 0 lying on the stomach, 1 on both knees bent forward, 2 kneeling up, 3 standing (the clip's
  legs). **On the engine's `phaseK`** (W35): `lie-down` r = 3 (1 − smooth(phaseK)) (kneel, then down onto the hands and
  the chest), `prone-wait` / `prone-reach` 0, `push-up` r = smooth(phaseK), `kneel-up` 1 + smooth(phaseK) — exact, also
  mid-phase (a longer phase, the load rising at ≤ 0.5 m/s, stretches the rise with it). **Fallback** (a take recorded
  without phaseK — the recorder does not carry it yet): W29's clocks from the activity's age (T.lieDown 0.8 s, T.pushUp
  0.8 s, T.kneelUp 0.6 s), getting up following the clock but **waiting for the load it holds** (never back down, ≤ 1 per
  0.35 s).
  `stand_with_load` hands over to the posture solver (one-knee kneel / squat for hands at the deck) through a 0.4 s
  **bone blend** (every touched bone's local transform lerped from the last prone pose, the arms solved after it); the
  posture waits kneeling meanwhile, so it blends out of a kneel. Take replay (`setFrame`, no clock) uses a frame's
  `phaseK` / `proneYaw` when it has them (`SampledHuman` fields; `take-replay.ts` fills them once the recorder records
  them), else shows each phase's end pose with the searched turn.
- **Placement from the measured rig** (`measure()`, skinned vertices in the Idle pose): lying, the hip joints are
  `lieHip` above the deck = the front of the torso ahead of the hip joints or a leg's radius about its bones, whichever
  is more (0.13 m; the Idle clip's forward knee and the shoe tops are not "front"), so the chest rests on the deck —
  the shoulder joints end `chestDepth` (0.097 punk – 0.102 woman) above it; the engine's `chest` is 0.08. The pelvis
  pitches 90°, the legs lie straight back by leg IK, knees on the deck, feet pointed (the instep on it).
- **Over the edge**: the chest tips down over the lip up to the engine's 60° (`tipMax`), all of it at the Torso joint
  (the lower ribs), which lies 0.08 m past the lip — past the lip by ≥ its height × (sin 60° − tan 30° cos 60°), so the
  tipping chest never cuts the deck corner — plus half a chest × tan(turn) when turned. The engine's hip placement
  (torso / 3 behind the lip) comes out the same: hips 0.11 (punk) – 0.12 m (woman) behind it.
- **Turn** = the engine's lying heading (W35): `engineTurn` = angleDelta(pose.yaw, proneYaw) (≤ 45°), taken as is every
  tick (the engine turns it with the lie-down's smoothstep and checked that heading's footprint, so no deck test and no
  rate limit); the rendered yaw is then proneYaw, so a hand flat on the deck points its fingers along the heading like
  the engine's `proneDeckHand`, and `lipAlong(turn)` puts the lip where the engine has it (`proneLipAlong`). At the 2.750 m
  fixture p3 / p4 lie +20° / −20° by hand, ±25° off the forks. **Fallback** (no proneYaw): W29's search — ≤ 45°, only
  where the lying body (hips → toes) or the kneeling one (knees, feet) still lies on an installed sheet at that level.
- **Per tick solve** (`solveProne`, grid): r in [previous, clock], torso pitch (lying: flat … 60° tip, arched back ≤ 25°
  pushing up; kneeling: to 150°, the engine's bentOver bottom), lying a **slide back** along the deck (0 … 0.16 m in 4 cm
  steps, the body still on an installed sheet; ≤ 0.2 m per 0.4 s — W35, for deck hands behind a long torso's shoulders),
  and the turn only in the fallback (else the engine's); minimising, in order: hands beyond 0.92 of the arm
  from their shoulder, beyond that + the girdle, any spine / head point closer than a chest depth to the deck slab or
  the edge beam under the lip (face 2.5 cm out, 0.21 m down), then r behind the clock, pitch off its natural value, turn.
  Changing pitch / turn from the last tick costs too (no turning back and forth); pitch ≤ 1.6 rad, turn ≤ 0.5 rad per 0.4 s.
- **Arms**: IK to the engine's hand points, reach-honest as everywhere, plus the **shoulder girdle** reaching toward a
  hand by up to 0.1 m (2 × shrug: the engine derives `reachDown` 0.73 with exactly this, W32) only as far as the arm falls
  short; elbows up beside the chest for a hand on the deck, forward and out (off the edge) reaching over it.
  **Flat hand**: a hand on the deck behind the lip lies flat — the wrist turned palm down, fingers forward and a little
  out (from the rig's own palm point and finger-curl axis), the IK re-solved after the turn, open (no grip curl), the palm
  centre 2 cm up — blending in over the last 0.25 m down and out just past the lip.
- **Feet / hands on the deck, measured**: each frame the foot (and a flat hand) as skinned is lifted by whatever of it
  dips below the deck (vertex indices per template, `surfaceRefs`); also after the exit blend (slerping a pointed foot
  into a planted one swings the toes down).

**Measured** (W35; `e2e/prone.spec.ts`, lab `prone` = W32's engine fixture — 2.750 m deck, 4 ft deck joists ending at
the lip, hand-off ≈ 0.67 m below — 477 ticks, and `prone-forks` — 2.902 m deck, the sheet 0.70 m below on the forks —
632; every tick, p3 = punk template, p4 = woman): the body turn equals the engine's angleDelta(pose.yaw, proneYaw) on
every prone tick (708 / 130 ticks, worst |Δ| 0.0000 rad: p3 / p4 +20° / −20° by hand, ±25° off the forks); the rise is
never ahead of smooth(phaseK) and trails it while the body waits for the load (51 / 64 and 44 / 60 push-up / kneel-up
ticks behind by > 0.01, worst 0.78 / 0.86 — p4 waiting for its load; p3 on its knees by the kneel-up and up, r 1.99, by
its end); lying, shoulders beyond the lip every tick and 0.001 m from deck + chest depth; the rendered surface over the
deck never below its top by > 1.5 cm in any prone phase; no arm longer than its bones; **0 rig-reachable misses**;
deterministic (two runs, receivers' bones equal every tick). Engine hand points reached ≤ 0.1 m, by hand / off the
forks (W29 at 2.9 m in brackets): lie-down 60/60 · 56/60, prone-wait 1148/1148 · —, **prone-reach 80/80 · 80/80**
(45/80 · 60/80), push-up 64/64 · 72/72, kneel-up 64/64 · 48/48, stand_with_load 28/32 · 25/32, lay and set_down all.
Misses: p4's stand_with_load (1.06–1.15 arm lengths, the posture layer taking over) and, off the forks, p3's last two
lie-down ticks (1.2: the hands on their way to the lip while the body still settles). Two renderer fixes it took:
(1) the engine's deck-hand points (0.20 m ahead of S along the heading) are set for the woman's torso; turned 20° the
punk's shoulders lie ≈ 8 cm further out and its deck hands hung (1.18 arm lengths, prone-wait 574/1148) — lying flat
the body now **slides back** along the deck by what the hands need (≤ 0.16 m, on the deck; 0.04–0.05 m used) and comes
forward as the chest tips; (2) forcing r = smooth(phaseK) exactly left p4's held hand out of reach mid push-up (23/32)
with that arm 0.14 m through the deck edge, so r keeps W29's wait for the load (never ahead of the engine).
Logged, not asserted: arm / hand vertices ≤ 1.9 cm inside the middle joists' ends (p3 j3, p4 j6: the grips are the
sheet's corners beside them, as W32 notes) and fingers wrapping the sheet as it rests on them; no chest or head inside
any member (W29: p3 / p4 chests through the all-6-ft tails j2 / j7); by hand the sheet's inner edge comes up 1 mm outside
the joist ends (6 cm off the forks); after the prone phases fingers wrapping the sheet's edge dip ≤ 4–7 cm below d0's top.
Captures (looked at): `prone-lie-down`, `prone-reach` (baseline, tick 340: both on their stomachs on d0 / d2, chests
tipped over the lip, arms straight down; the givers hold the sheet overhead), `prone-take` / `prone-take-ne` (from the
east, tick 350: p3 draped over the edge, both fists on the sheet's inner south corner; p4 likewise on its north corner —
both receivers' hands on the sheet), `prone-push-up` (baseline, tick 363 mid push-up: hips coming up, one hand flat on
the deck, the other on the rising sheet) / `prone-push-up-e`, `prone-kneel-up`, `prone-standing` (baseline; the first
`lay` tick: both kneeling on the deck — the posture layer's kneel — bent over the sheet at deck level, hands on its edge).
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
- Prone receiver (above): the engine's reach is the rig's since W32 (0.73 m, the woman template; W29 measured this rig
  reaching 0.80 / 0.73 m against the old 0.94); the push-up reads as kneeling bent over the edge (the engine's own
  end-of-push-up pose); the torso pitch is still the renderer's grid search (the engine publishes the heading and the
  phase progress, not the tip); take replay falls back to the searched turn and each phase's end pose until the recorder
  carries proneYaw / phaseK.
- Wrists keep the clip rotation (except a prone receiver's hand flat on the deck); the closed hand is one curl for
  every grip (no per-item hand shape).
- Postures are knee squat + hip bend + heel raise + one-knee kneel (the two-knee kneel and lying prone only in the
  prone layer, "Prone receiver"): no side lean, no stepping, no torso twist; a 150° kneeling bend over an edge is steep
  (the head hangs below the deck) — it is what reaching below a deck takes with this body.
- Reach-down is shallower than the engine allows (Body model, "Open"); those receivers' arms hang.
- No body-vs-object collision: a squatting foot can overlap a part lying on the ground, the crossed
  knee can touch the bowl, thighs can clip chair arms.
- Stair gait only on `stairs` links; frame climbing is the ladder cycle (rungs at a 0.35 m pitch, not IK'd to the
  drawn bracing rods), beam walking the Walk clip at half weight (no foot placement on the 0.1 m flange). A person
  standing still mid-flight (climb-wait) can keep a foot mid-swing.
- The climbing facing and the stance turn toward a load are the renderer's (the engine keeps the link / stance
  heading); no side lean or torso twist, so hands far to the side or behind the body still hang (see the year
  build numbers above).
- The posture blend lags the engine's hand points by up to 0.4 s (crouch misses).
- Take replay: food level follows `contents` only if the take records it (the recorder does not: the
  final state's fill is shown); seats at a default height; the kneeling side and legs-crossed variant
  are per id, as live.
