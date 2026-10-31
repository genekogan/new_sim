# Renderer poses

Code: `mars/viewer/app/engine-view/`: `humans.ts` (per-person tick snapshots, layer order, arms), `rig.ts` (bone
chains, two-bone IK, palm), `stair-gait.ts`, `frame-gait.ts`, `posture.ts`, `prone.ts` (pure solvers),
`items.ts` / `components.ts` (item meshes, in-hand attachment), `take-replay.ts` (`TakePeople`, shared by the studio
and the Lab). Lab presets `meal`, `hand-up`, `body`, `prone`, `prone-forks`, `year-build-2022`. Specs:
`e2e/stairs.spec.ts`, `poses.spec.ts`, `prone.spec.ts`, `meal.spec.ts`, `year-build.spec.ts`.

Renderers only read the world. Every pose is a deterministic function of the engine's tick history and the entity
id (template, legs-crossed variant, which knee kneels); nothing feeds back. The Lab `probe()` hook in the `body`
preset is a renderer-only measurement tool.

## Rig and body fit

Quaternius CC0 `animated-{casual,punk,woman}.glb` with Idle, Walk and Wave clips. `Foot.L/R` are children of Root
(baked IK targets), so moving the pelvis leaves the feet in place. Once per loaded template (`people.ts`):

- **scale** so the shoulder joints stand at 1.34 m (`BODY_MODEL`, [body-model.md](body-model.md));
- **arms**: UpperArm and LowerArm lengthened by one factor per side so shoulder → palm = 0.62 m (skin stretched
  along the bone axis only);
- **shrug**: the shoulder rises up to 5 cm when the hand is ≥ 0.5 m above it;
- **palm**: a fixed point in the wrist frame, so closing the fingers never moves it.

`poses.spec.ts` "body model" asserts the measured rig against `BODY_MODEL` within 2 cm.

## Layer order (every frame, from the restored clip pose)

1. **Clip**: Walk iff ground speed ≥ 0.08 m/s (`human.speed` when published, else the position delta), blended over
   0.2 s; Walk rate = speed / clip speed (≥ 0.35).
2. **Legs and pelvis**, one of:
   - **sit** (`sit`, `sit-down`, `stand-up`, and `eat`/`serve` over a `sit` base): hips 0.09 m above the seat, feet by
     leg IK, 0.4 s blend; about half the people cross their legs (id hash);
   - **stairs** (on a usable `stairs` link): tread-by-tread gait;
   - **frame** (climbing a frame, on a frame stance or beam);
   - **posture** (crouch, hip bend, heel raise, one-knee kneel).
3. **Torso bend**: pitched at Hips / Abdomen / Torso by 60 / 20 / 20 %.
4. **Arms**: engine hand points (`human.hands`), else the grip slot of `human.grip`, else seated hands, warm hands
   toward a fire, frame holds or beam balance. Free arms on a torso bent > ~30° hang. Arms in contact curl the fingers.
5. **Items in hand** ride the rendered palm (`components.attachHeld`).

## Stairs

`flightOf(link)` takes the treads from the link path. Feet alternate one tread per step; a foot is planted for
u ∈ [k − 0.7, k + 0.5] and swings to k + 2, with ≥ 7 cm clearance over the tread between. The gait is a pure function
of the body coordinate u, so descending is the same motion reversed and the cadence is locked to the tread pitch. The
pelvis is lowered just enough for both legs to reach. `stairs.spec.ts` asserts soles on the tread at every plant.

## Handling postures

Per tick the solver picks `{drop, bend, rise, kneel}` minimizing, in order: hands beyond 0.92 arm lengths, hands jammed
closer than 0.4 arm lengths, then effort. Styles by activity:

- `knees` (crouch, lift, carry, hold): squat first, bend ≤ 80°, kneel only when needed;
- `hips` (reach_down, take, lay, set_down, item reach, serve): bend ≤ 100°, squat or kneel allowed;
- `up` (reach_up, walk-load, push): heels up, bend ≤ 30°;
- `walk`: drop ≤ 8 cm, bend ≤ 15°.

The one-knee kneel puts the hips above a knee on the floor; which knee is fixed per person. The result approaches its
goal at a bounded rate (≤ 0.55 m / 1.6 rad / 6 cm per 0.4 s); take replay solves each frame without the blend.

**Reach honesty.** Full contact within 1.02 arm lengths, fading to none at 1.25; beyond that the arm hangs. Bone lengths
never change. `bones()` reports per arm: shoulder, palm, target, contact and palm error.

## Rack structure

`frame-gait.ts` gives a context from `human.on` and the activity:

- **Climbing** (`climb-up` / `climb-down` on a `climb:` link or a frame stance): the climber faces the frame and runs a
  two-hand, two-foot ladder cycle (rungs at 0.25 m, then every 0.35 m), a pure function of body height.
- **Frame stance**: both soles on the bracing node; free hands on the column and the bracing; holding a load the person
  turns on the rod toward it, up to 100°.
- **Beam walk**: arms out for balance, short steps (Walk weight halved, cadence ×1.8).

## Prone receiver

`prone.ts` + `humans.ts` read `human.activity` (`lie-down`, `prone-wait`, `prone-reach`, `push-up`, `kneel-up`, then
`stand_with_load`), `human.hands`, `human.proneYaw` (the lying body's axis) and `human.phaseK` (0–1 within the engine
phase). One rise coordinate r (0 lying, 1 on the knees, 2 kneeling up, 3 standing) follows `phaseK` but never runs
ahead of the load. The body turn is the engine's `angleDelta(pose.yaw, proneYaw)`. A per-tick grid solve chooses torso
pitch and a small slide back along the deck so the hands reach; a hand on the deck lies flat. Takes recorded without
`proneYaw` / `phaseK` fall back to a renderer search and each phase's end pose.

## Items and eating

Bowl, cup, plate and pot are lathe-turned vessels; the spoon is a handle and small bowl. A food disc follows
`contents.fraction`. `in-hand` items ride the holder's palm with the catalog grip offset; `resting-on` and `ground`
items render at their engine pose. The spoon aims at the bowl when low and at the lips when raised. Near the engine's
mouth landmark the palm target shifts slightly so the spoon reaches the rig's lips.

## Take replay

`HumanViews.setFrame` (random access, posture solved without the blend) → `render` → `components.attachHeld`. Per frame:
recorded `hands`, `baseActivity` and `on`; component phase, support and connections from the frame, not the final
state; stairs from the base scene's usable links plus the construction contributor over the frame's components.

## Approximations

- Wrists keep the clip rotation (except a flat prone hand); one closed-hand curl for every grip.
- No side lean, stepping or torso twist; hands far to the side or behind the body hang.
- No body-versus-object collision in the renderer (a squatting foot can overlap a part on the ground).
- Climbing rungs are not IK'd to the drawn bracing rods; beam walking has no foot placement on the flange.
- The posture blend lags the engine's hand points by up to 0.4 s.
