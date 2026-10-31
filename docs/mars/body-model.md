# Body model

`engine/body/model.ts` exports `BODY_MODEL`, the only place the engine says where a person's hands can be. It models a
~1.75 m adult and equals the renderer's rig (the Quaternius templates scaled to 1.75 m; [poses.md](poses.md)). Heights
are above the feet (`pose.p`), horizontal distances from the body axis. Anything outside is refused with a diagnostic,
never interpolated. `engine/test/body-model.test.ts` pins the values and checks the model is internally consistent.

## Constants

| Constant | Value | Used for |
| --- | --- | --- |
| `height` | 1.75 m | — |
| `shoulderHeight` | 1.34 m | landmarks, posture bands, rest hands |
| `shoulderHalf` | 0.15 m | shoulder points (items) |
| `armLength` | 0.62 m | every reach envelope |
| `shrug` / `heelRaise` | 0.05 / 0.06 m | band tops |
| `overheadReach` / `overheadMax` | 2.00 / 2.06 m (heels up) | standing reach: hand-up, solar, aloft fastening, beam seats, paint |
| `lowReach` | 0.5 m | lowest paint band |
| `reachDownBelowFeet` | 0.5 m | kneeling at an edge: hand-up receivers, solar, aloft |
| `maxHorizontalFromFeet` | 0.8 m | the kneel rule, station reach |
| `edgeReach` | 0.5 m | hands beyond the edge a receiver kneels at |
| `tableReach` | 0.6 m | items on a table |
| `seatedDrop` | 0.45 m | landmarks while seated |
| chest / mouth | 1.22 m (+0.08 fwd) / 1.58 m (+0.15 fwd) | bowl and spoon hands |
| rest hand / carry hand | 0.72 m up, 0.18 out / 1.00 m up, 0.16 out, 0.28 fwd | default and carrying hands |

**Posture envelopes** (`posture.*`): a shoulder band above the feet × a horizontal lean, plus the arm.
`postureGap(posture, feet, hand) ≤ 0` means inside; the envelope is convex, so a straight hand path between two
inside points stays inside.

| Posture | Shoulders above feet | Lean |
| --- | --- | --- |
| `upright` | 1.22–1.45 m | 0.20 m |
| `crouch` | 0.50–1.45 m | 0.35 m |
| `bentOver` (kneeling over an edge) | 0.07–1.45 m | 0.35 m |
| `painting` | 0.82–1.45 m | 0.35 m |

## Prone receiver

`BODY_MODEL.prone`: a receiver lying on their stomach at a deck edge to reach down, then getting up without letting
go (push-up, knees, feet). Used only where kneeling cannot reach. Station S (`pose.p`) is `back` = 0.35 m behind the
lip; the lying body turns at most `turnMax` = 45° off the edge normal and tips its chest over the lip up to
`tipMax` = 60°. `reachDown` is 0.73 m below the deck and `edgeReach` 0.45 m beyond the deck outline. Exact
heading-aware geometry: `proneFrame`, `pronePoints`, `proneReachGap`; the per-tick invariant uses the bounding
cylinders `posture.prone`, `pushUp`, `kneelUp`.

## Reach rules

| Rule | Value | Diagnostics |
| --- | --- | --- |
| standing reach (hands, or a load's underside, above the floor) | ≤ 2.06 m | `handup.too-high`, `lift.hands-out-of-reach`, `solar.too-high`, `paint.out-of-reach`, `reach.too-high` |
| reach down kneeling at an edge | ≤ 0.5 m below the feet | `handup.too-high`, `solar.too-low` |
| reach down lying prone | ≤ 0.73 m below the deck, ≤ 0.45 m beyond it, the body past the lip clear | `handup.too-high`, `handup.no-receiver-station`, `handup.rise-blocked` |
| kneel rule at a hand-off | hands ≤ 0.8 m from the feet, ≤ 0.5 m beyond the edge | `handup.receiver-reach` |
| posture envelope | hands within 0.62 m of the shoulder band + lean | `handup.giver-reach`, `solar.no-station`, `paint.out-of-reach` |
| station reach | part ≤ 0.8 m horizontally from the station | `….out-of-reach` |

Consumers: `construction/handup.ts`, `construction/invariants.ts`, `construction/solar.ts`, `construction/aloft.ts`,
`construction/access.ts`, `construction/rules.ts`, `work/paint.ts`, `items/body.ts`, `items/model.ts`.
`construction/stance.ts` and `construction/liftcrew.ts` keep a few rules of their own (lift-over apex, ground hand
distance).

## Hands and takes

Hand-up hands travel from the rest hands to the grip with a smoothstep during `crouch` and `reach_down`; afterwards
they are on the part. `test/hands-check.ts` enforces `hands.teleport`: a hand point moves ≤ 0.25 m per tick. The take
recorder stores `hands` (integer mm), `baseActivity`, `on`, `speed` and `contents`; `sampleTake` decodes them
([takes-and-plans.md](takes-and-plans.md)).

## Approximations

- The envelope is a cylinder plus an arm, not IK; shoulders are one cylinder, not two joints.
- `reachDownBelowFeet` 0.5 m is one number for three templates that reach 0.35–0.54 m; the smallest template's arms
  hang for points 0.35–0.5 m down.
- Band proportions come from two of the three templates.
- The prone rise uses cylinders about S; arms are straight segments; the head is a ball.
- Release is not blended in the engine (the renderer blends hands back over 0.4 s).
