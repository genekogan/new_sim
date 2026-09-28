# Renderer poses: stairs, handling, eating (owner feedback §3 renderer half, §4, §6, §12)

Code: `viewer/app/engine-view/` — `humans.ts` (per-person tick snapshots, layer order, arms), `rig.ts`
(bone chains, two-bone IK, palm), `stair-gait.ts` (pure: tread-by-tread foot placement), `posture.ts`
(pure: crouch / hip-bend / heel-raise solver), `items.ts` + `components.ts` (item meshes, in-hand
attachment, food level), `fixtures.ts` (one line: the 6 ft table mesh). Lab presets `meal`, `hand-up`
(`app/lab/meal.ts`, `hand-up.ts`); hook `__marsEngine.bones(id?)`, `stairs()`, `heldItems()`.
Specs: `e2e/stairs.spec.ts`, `e2e/poses.spec.ts`, `e2e/meal.spec.ts`.

Renderers only read the world. Everything below is a deterministic function of the engine's tick
history and the entity id (template, legs-crossed variant, warm-hands spread); nothing feeds back.

## The rig
Quaternius CC0 `animated-{casual,punk,woman}.glb`, clips Idle / Walk / Wave only, scaled to 1.75 m.
Hierarchy: `Root → Body (pelvis) → {Hips → Abdomen → Torso → Chest → Shoulder/UpperArm/LowerArm/Wrist,
UpperLeg → LowerLeg}`; **`Foot.L/R` are children of Root** (baked IK targets), so moving the pelvis
leaves the feet where they are and every leg IK places the Foot bone at the shin end itself.
Measured once per rig from Idle at t = 0 (`measure()` in humans.ts): hip joints 0.88 (casual) –
0.96 m (woman), shoulder joints ≈ 1.33–1.34 m, **arm (shoulder → elbow → palm centre) 0.44–0.50 m**
(casual 0.46, woman 0.50 in Idle; 0.44 in the hand-up readouts), ankle 0.02–0.03 m, the spine chain
(Hips → Abdomen → Torso → shoulder midpoint), the ankle in the shin frame, the rest foot rotation.
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
   seated hands on the thighs / warm hands to the fire. A 2.5 cm shoulder shrug toward the target
   (5 cm overhead). Free arms on a torso bent > ~30° hang with gravity instead of keeping the clip's arm
   (which would point backwards).
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
Per tick the solver picks `{drop, bend, rise}` (pelvis lowered by bending the knees, feet planted, down
to a squat with hips 0.42 m up; torso bend; heels up ≤ 6 cm) that minimises, in order: hands beyond
0.92 arm length from their shoulders (through the bent spine chain, pelvis shifted back 0.3 × the
shoulders' forward travel), hands jammed closer than 0.4 arm length, then effort. Styles by activity:
- `knees` (crouch, lift, stand_with_load, carry, support/hold, release, idle with a grip): squat first,
  bend ≤ 80° (costly) — "lift from the knees";
- `hips` (reach_down, take, lay, set_down, items `reach`, `serve`): bend ≤ 100° (cheap), squat allowed;
- `up` (reach_up, walk-load, push): heels up, bend ≤ 30°;
- `walk` (anyone moving): drop ≤ 8 cm, bend ≤ 15°.
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
- hand-up v3 (16191 ticks, 5528 points at `cdcf731`): **54.8 % reached**; **0 misses among points the
  rig can reach**; no over-long arm. Per activity: lay 1544/1592, set_down 198/198, take 160/176,
  stand_with_load 148/176, lift 191/216, reach_down 134/264, walk-load 178/514, reach_up 415/2176,
  crouch 60/216 (the body is still going down during the 0.6 s crouch).

### Reach gap (the main weak spot — needs a decision)
The engine's reach envelope (`construction/handup.ts` `ARM_LEN` 0.75 m + posture lean 0.2–0.45 m,
`GIVE_MAX` 2.1 m overhead, `REACH_DOWN` 1.0 m below the feet; `items/body.ts` `armReach` 0.75) is far
larger than this rig's **0.44–0.50 m** shoulder → palm, with shoulders at ≈ 1.33 m (a real 1.75 m adult:
≈ 0.62–0.65 m from ≈ 1.45 m). With the heels up and shoulders shrugged, the rig's palm tops out at
≈ 1.9 m straight overhead; hanging, it is at ≈ 0.85–0.9 m (the engine carries at 0.75). So reach_up (hands 1.93 m, up to ~1 m out), walk-load (0.75 m)
and the far half of a single giver's lever grip are out of reach and those arms hang — honest, but in
the captures the givers stand under a sheet they visibly do not touch. Options: (a) the engine uses a
rig-sized envelope (arm ≈ 0.45 m from shoulders at 1.33 m, overhead ≈ 1.9 m, hanging ≈ 0.9 m) — refuses more hand-ups; (b) the
people get human-proportioned arms (a one-time, per-template lengthening of UpperArm / LowerArm to
≈ 0.62 m — a visible change to every character, not a per-pose stretch); (c) accept the gap.

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

## Approximate / not done
- Hands stay open (the clip's hand; no finger curl or grip pose); wrists keep the clip rotation.
- Postures are knee squat + hip bend + heel raise only: no kneel on one knee, no side lean, no stepping,
  no torso twist; receivers on a beam at 100° bend can look like they lie on the sheet.
- No body-vs-object collision: a squatting foot can overlap a part lying on the ground, the crossed
  knee can touch the bowl, thighs can clip chair arms.
- Stair gait only on `stairs` links, not on `climb` (frame climbing plays Idle while the body rises) or
  `beam` links (beam walking plays the flat Walk clip). A person standing still mid-flight (climb-wait)
  can keep a foot mid-swing.
- The posture blend lags the engine's hand points by up to 0.4 s (crouch misses).
- Take replay: takes carry no `human.hands` / `baseActivity` (no eat arms, no items attach in the studio
  replay) and no stairs links (flat Walk on stairs in the studio).
