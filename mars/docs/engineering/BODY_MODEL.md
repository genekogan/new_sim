# One body model (owner decision 2026-09-28 "One body model"; feedback §5, §6)

`viewer/engine/body/model.ts` — `BODY_MODEL` is the only place the engine says where a person's hands can be.
A real ~1.75 m adult; heights above the feet (`pose.p`), horizontal distances from the body axis. Anything
outside is refused by the engine with a diagnostic, never interpolated. The renderer (W9) scales the rig's arm
bones to `armLength` from `shoulderHeight` once per template and pins measured rig reach to this model (± 2 cm).

## Constants

| constant | value | meaning |
| --- | --- | --- |
| `height` | 1.75 m | the person |
| `shoulderHeight` | 1.42 m | shoulder joints, standing (was 1.42 in items, 1.45 band top in hand-up) |
| `shoulderHalf` | 0.19 m | each shoulder joint off the axis |
| `armLength` | **0.62 m** | shoulder joint → palm centre (was 0.75 in hand-up / items / paint) |
| `heelRaise` | 0.06 m | up on the toes |
| `overheadReach` | 2.0 m | palm straight overhead, heels down (hands in front of the head: < 1.42 + 0.62) |
| `overheadMax` | **2.06 m** | `overheadReach + heelRaise` — **the §5 "standing reach"** (was 2.1 everywhere) |
| `lowReach` | 0.5 m | lowest a standing painter's brush goes (lower bands are not modelled) |
| `reachDownBelowFeet` | 1.0 m | kneeling at a deck / beam edge, hands this far below the feet (§6) |
| `maxHorizontalFromFeet` | 0.8 m | hands from the feet while working a part from a station; the kneel rule at a hand-off |
| `edgeReach` | 0.5 m | at a hand-off, hands at most this far beyond the edge the receiver kneels at (§6) |
| `tableReach` | 0.6 m | items: hands beyond the table edge a person stands at |
| `posture.upright` | shoulders 1.30–1.48 m, lean 0.20 m | standing, walking with a load, reaching up (1.48 = 1.42 + heels) |
| `posture.crouch` | shoulders 0.55–1.48 m, lean 0.35 m | squatting to grip / lifting from the knees |
| `posture.bentOver` | shoulders −0.15–1.48 m, lean 0.45 m | kneeling at an edge, bent over it |
| `posture.painting` | shoulders 0.90–1.48 m, lean 0.35 m | facing a vertical face |
| `seatedDrop` | 0.45 m | landmarks drop this much when seated |
| `chestHeight` / `chestFwd` | 1.30 / 0.08 m | sternum |
| `mouthHeight` / `mouthFwd` | 1.58 / 0.15 m | the spoon hand's target |
| `restHand` | 0.80 m up (= 1.42 − 0.62), 0.22 m out, 0.02 m fwd | hands hanging at the hips |
| `carryHand` | 1.00 m up, 0.16 m out, 0.28 m fwd | a small item carried in front of the hip |

The envelope for a posture is a shoulder cylinder (band × lean) plus the arm: `postureGap(pz, feet, hand)` ≤ 0
means inside. It is convex, so a straight hand path between two inside points stays inside.

## Who imports it

| module | uses |
| --- | --- |
| `construction/handup.ts` | `GIVE_MAX` = overheadMax, `REACH_DOWN`, `EDGE_REACH`, `KNEEL_BACK` = 0.8 − 0.5, `ARM_LEN`, `POSTURE` (crouch / upright / bentOver), `CARRY_Y` = restHand.up (0.80 m; was 0.75), `envelopeGap` = `postureGap`; crouch / reach_down hands start at `restHands` |
| `construction/invariants.ts` | through handup.ts (`lift.hands-out-of-reach`, kneel rule) |
| `construction/solar.ts` | `REACH_UP` = overheadMax, `REACH_DOWN`; envelopes through handup.ts |
| `construction/aloft.ts` | `ALOFT_REACH_UP` = overheadMax, `ALOFT_REACH_DOWN` |
| `construction/access.ts` | `ARM_REACH` = maxHorizontalFromFeet (0.8, unchanged) |
| `construction/rules.ts` | `STANDING_REACH` = overheadMax (highest beam seat from the ground) |
| `work/paint.ts` | `REACH_LO` = lowReach, `REACH_HI` = overheadMax, `PAINT_POSTURE` = posture.painting + armLength |
| `items/body.ts` | thin layer: re-exports the body frame / landmarks (`bodyFrame`, `at`, `shoulderPoint`, `chestPoint`, `mouthPoint`, `restHand`, `carryHand`); `BODY` / `SEAT_DROP` are named views of the model; keeps only the eat-cycle landmarks (bowl / rim / dip) |
| `items/model.ts` | `ITEM_REACH` = tableReach |

Not yet on the model (outside this track): `construction/stance.ts` (`GIVE_MAX`, `STANCE_UP` 2.1, `STANCE_ARM` 0.9,
`GROUND_ARM` 0.8 — the year-build hang, W7's in-flight work) and `construction/liftcrew.ts` (`HAND_REACH` 1.0 m
ground distance, `LIFT_APEX_MAX` 2.4 m for the lift-over apex: crews raising uprights, a different rule).

## Reach rules in one table

| rule | value | where enforced | diagnostic |
| --- | --- | --- | --- |
| standing reach (hands / a load's underside above the floor) | ≤ 2.06 m | hand_up (plan + tick), solar, aloft fastening, paint, beam seats | `handup.too-high`, `lift.hands-out-of-reach`, `solar.too-high`, `paint.out-of-reach`, `reach.too-high` |
| reach down from an edge | ≤ 1.0 m below the feet | hand_up receivers, solar, aloft | `handup.too-high`, `solar.too-low`, `lift.hands-out-of-reach` |
| kneel rule at a hand-off | hands ≤ 0.8 m from the feet, ≤ 0.5 m beyond the edge | hand_up (plan + tick at `reach_down` / `take`) | `handup.receiver-reach`, `lift.hands-out-of-reach` |
| posture envelope | hands within arm 0.62 m of the shoulder band + lean | hand_up (plan; tick + 0.1 m), solar, paint | `handup.giver-reach`, `handup.no-receiver-station`, `solar.no-station`, `paint.out-of-reach` |
| station reach | part ≤ 0.8 m horizontally from the station | raise / install (access.ts) | `….out-of-reach` |

## Hand motion (§6, POSES weak spot 4)
Hand-up hands no longer snap onto the part: during `crouch` (givers) and `reach_down` (receivers) the published
hand points travel from the hanging rest hands (`restHands`) to the grip with a smoothstep over the phase; during
`lift`, `reach_up`, `stand_with_load`, `lay` they are on the part, which itself moves smoothly. Tests
(`test/hands-check.ts`, used by the handup, handup-rules and solar tests) enforce `hands.teleport`: a hand point
moves ≤ 0.25 m per tick (5 m/s) from the previous tick's point, or from the rest hand when none was published;
at the grip the hands equal `handupHands(part, pose, holder, slot)`; on the way they lie on the rest → grip segment.
Measured in the hand-up green test: worst hand step 0.14 m/tick, 48 approach ticks (4 people × 12).
Solar placing (`partHands`), items and paint are unchanged (items already blend with `smooth` over `reach`).

## What moved when the model landed (2026-09-28)
- Hand-up: givers carry at 0.80 m (hands hanging; was 0.75, below a 0.62 m arm from 1.42 m shoulders); a one-end
  (lever) giver stands beside the end instead of 0.3 m beyond it (inner hand was 0.70 m out).
- Paint: one standing spot covers ≤ 1.0 m of face (was 1.3 m); a 4x8 sheet now takes two spots.
- Solar test: the battery is set down 0.36 m from where it lies (was 0.67 m: one crouched person cannot slide it
  that far with a 0.62 m arm).
- Flagship v3 re-pinned once (16248 → 16219 ticks, `339cf310…`), same outcome; the meal pin did not move.

## Takes (mars-take/2)
`take/recorder.ts` FIELDS also record `hands` (integer mm, `{ left?, right? }`), `baseActivity`, `on`, `speed`
(integer cm/s, `SPEED_Q`) and `contents`; `sampleTake` decodes `hands` / `speed` to metres into
`SampledEntity.hands` / `.speed` (last value ≤ t, no interpolation between ticks); `baseActivity`, `on`,
`contents` are in `.state`. Hand points in crouch / reach_down are therefore only in the take — `handupHands`
rebuilds the grip, not the approach. `replayFinalState` is unchanged (the recorded final state, hash-verified).
`test/take-fields.test.ts`: the meal and a hand-up take match the live world tick for tick.

Size, flagship v3 rehearsal (16219 ticks): 457,981 → 675,124 bytes (+47 %), gzip 102,070 → 141,623 (+39 %).
Of the added bytes `speed` is 118 KB (it changes on most walking ticks; 0.1 m/s steps would still be 76 KB,
gzip −7 %) and `hands` 99 KB.

## What the renderer mirrors
Arm bones scaled to 0.62 m from 1.42 m shoulders, heels up ≤ 6 cm (W9); arms reach `human.hands` (or a take's
`hands`) and hang when a point is truly out of reach (reach honesty, POSES.md).

## Approximate
- The envelope is a cylinder + arm test, not IK; the crouch band (shoulders down to 0.55 m) is generous for a
  squat, and `bentOver` lets shoulders sit 0.15 m below the feet (kneeling, chest over the edge).
- `reachDownBelowFeet` (1.0 m, the owner's §6 figure) is a cap; the `bentOver` envelope binds first at
  0.15 + 0.62 = 0.77 m below the feet, so hand-offs needing 0.77–1.0 m are refused at station choice
  (`handup.no-receiver-station`) rather than by `handup.too-high`. Lowering the cap to 0.77 m (or allowing prone
  receivers) is an open owner decision.
- `overheadReach` 2.0 m is a stated number, not derived: shoulder + arm straight up would be 2.04 m.
- Release is not blended in the engine (hands clear when a holder lets go; the renderer's 0.4 s posture blend
  returns them).
