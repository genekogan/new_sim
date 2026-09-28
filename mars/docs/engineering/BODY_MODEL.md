# One body model (owner decision 2026-09-28 "One body model"; feedback §5, §6)

`viewer/engine/body/model.ts` — `BODY_MODEL` is the only place the engine says where a person's hands can be.
A real ~1.75 m adult; heights above the feet (`pose.p`), horizontal distances from the body axis. Anything
outside is refused by the engine with a diagnostic, never interpolated. The renderer (W9) scales the rig's arm
bones to `armLength` from `shoulderHeight` once per template and pins measured rig reach to this model (± 2 cm).

## Constants

Since 2026-09-28 (OWNER_DECISIONS "Body model = the measured rig", W12) the engine model **is** the measured
rig (W9, `e2e/poses.spec.ts` "body model", POSES.md "Body model"): the Quaternius templates scaled to 1.75 m.
`test/body-model.test.ts` pins the values to the measurement and checks the model is internally consistent
(overhead ≈ shoulders + arm + shrug; every stated cap binds before its envelope; bands follow from the rig's
hips / torso; rest and carry hands within an arm of the shoulder).

| constant | value | source | consumers |
| --- | --- | --- | --- |
| `height` | 1.75 m | measured rig 2026-09-28 (templates scaled to it) | — |
| `shoulderHeight` | **1.34 m** (was 1.42) | measured rig 2026-09-28: 1.340 all three | landmarks, bands, `restHand` |
| `shoulderHalf` | **0.15 m** (was 0.19) | measured rig 2026-09-28: 0.116–0.146 | `shoulderPoint` (items) |
| `armLength` | 0.62 m | measured rig 2026-09-28: 0.620 | every envelope (`postureGap`), handup `ARM_LEN`, items `BODY.armReach` |
| `shrug` | 0.05 m | measured rig 2026-09-28 (rig.ts, girdle rise with a hand ≥ 0.5 m above the shoulder) | band tops |
| `heelRaise` | 0.06 m | measured rig 2026-09-28: 2.057 − 1.997 | `overheadMax`, band tops |
| `overheadReach` | 2.00 m | measured rig 2026-09-28: 1.997 (1.34 + 0.05 + 0.97 × 0.62) | `overheadMax` |
| `overheadMax` | 2.06 m | measured rig 2026-09-28: 2.057 heels up — the §5 "standing reach" | handup `GIVE_MAX`, solar `REACH_UP`, aloft `ALOFT_REACH_UP`, rules `STANDING_REACH`, paint `REACH_HI`, stance (W7) |
| `lowReach` | 0.5 m | stated (lower bands not modelled) | paint `REACH_LO` |
| `reachDownBelowFeet` | **0.5 m** (was 1.0) | measured rig 2026-09-28: 0.35 (woman) – 0.54 (casual, punk) kneeling at an edge, hands `reachDownOut` 0.45 m ahead of the feet; the spec's ≈ 1.0 m is **superseded** | handup `REACH_DOWN` (`handup.too-high` → forklift), solar `REACH_DOWN`, aloft `ALOFT_REACH_DOWN` |
| `maxHorizontalFromFeet` | 0.8 m | measured rig 2026-09-28: a kneeling body reaches 0.78 (woman) – 0.96 m (casual, punk) out at `kneelOutBelow` 0.1 m below its feet — the kneel rule's physical basis | handup `KNEEL_BACK` (= 0.8 − 0.5), access `ARM_REACH`, stance (W7) |
| `edgeReach` | 0.5 m | owner feedback §6 | handup `EDGE_REACH` |
| `tableReach` | 0.6 m | stated (bending at the hips) | items `ITEM_REACH` |
| `rig` | hips 0.89, torso 0.45, squat hips 0.42 / bend 80°, kneel hips 0.46 / bend 150° | measured rig 2026-09-28 (POSES.md, rig.ts) | derives the bands below |
| `posture.upright` | shoulders **1.22–1.45 m**, lean 0.20 | top = 1.34 + shrug + heels; bottom = 0.12 m knee bend below the shoulders (as before) | handup `walk-load`, `reach_up` (`postureTop` caps the hand-off at 2.05 m) |
| `posture.crouch` | shoulders **0.50–1.45 m**, lean 0.35 | squat hips 0.42 + torso 0.45 × cos 80° = 0.50 (was 0.55) | handup `crouch`, `lift` |
| `posture.bentOver` | shoulders **0.07–1.45 m**, lean **0.35** | kneel hips 0.46 + 0.45 × cos 150° = 0.07: shoulders stay above the deck (was −0.15, lean 0.45); the envelope then reaches 0.54 m down at 0.45 m out and 0.95 m out at 0.1 m below = the measured casual / punk | handup `reach_down`, `take`, `stand_with_load`, `lay`, `set_down`; solar via handup |
| `posture.painting` | shoulders **0.82–1.45 m**, lean 0.35 | half squat 0.52 m below the shoulders (as before) | paint `PAINT_POSTURE`, `paintEnvelopeGap` |
| `seatedDrop` | 0.45 m | stated (a ~0.45 m seat) | items landmarks while seated |
| `chestHeight` / `chestFwd` | **1.22** / 0.08 m (was 1.30) | 0.12 m below the shoulders, as before | items `chestPoint`, bowl / rim / dip hands |
| `mouthHeight` / `mouthFwd` | 1.58 / 0.15 m | the renderer's measured mouth point (humans.ts) | items `mouthPoint` (spoon target) |
| `restHand` | **0.72 m** up (= 1.34 − 0.62), 0.18 m out, 0.02 fwd (was 0.80 / 0.22) | shoulders − arm, just outside the shoulder line | `restHands` (renderer default, crouch / reach_down start), handup `CARRY_Y` |
| `carryHand` | 1.00 m up, 0.16 out, 0.28 fwd | stated (in front of the hip) | items `carryHand` |

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

Outside this track: `construction/stance.ts` (the year-build hang; W7 is moving its `GIVE_MAX` / `GROUND_ARM` onto the
model in flight — `STANCE_UP` 2.1, `STANCE_ARM` 0.9 remain its own) and `construction/liftcrew.ts` (`HAND_REACH` 1.0 m
ground distance, `LIFT_APEX_MAX` 2.4 m for the lift-over apex: crews raising uprights, a different rule).

## Reach rules in one table

| rule | value | where enforced | diagnostic |
| --- | --- | --- | --- |
| standing reach (hands / a load's underside above the floor) | ≤ 2.06 m | hand_up (plan + tick), solar, aloft fastening, paint, beam seats | `handup.too-high`, `lift.hands-out-of-reach`, `solar.too-high`, `paint.out-of-reach`, `reach.too-high` |
| reach down from an edge | ≤ 0.5 m below the feet (measured rig; was 1.0) | hand_up receivers, solar, aloft | `handup.too-high`, `solar.too-low`, `lift.hands-out-of-reach` |
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

## What moved when the model became the measured rig (2026-09-28, W12)
- Shoulders 1.34 m (were 1.42), half-width 0.15, chest 1.22, rest hands 0.72 m up (hand-up `CARRY_Y` follows), reach-down
  0.5 m (was 1.0), bands recomputed from the rig (table above; tops include the 5 cm shrug).
- Hand-up: givers raise a load only as high as their hands reach at the grips (`postureTop` on the `reach_up` envelope:
  2.05 m from the ground, hands 0.3 m ahead and ±0.15 m apart; straight overhead would be 2.06) — without it every
  ground hand-up was refused `handup.giver-reach` by ~4 mm. Decks the old 1.0 m reach-down allowed and 0.5 m does not
  (receivers ≳ 2.57 m above the givers' floor) are refused `handup.too-high` → the forklift (`handup.test.ts`).
- Paint: from the ground 0.5–2.06 m; the top 0.38 m of a standing 4x8 is refused (`paint.out-of-reach`) and painted
  from a 0.6 m platform (`paint.test.ts`). Band coverage now uses the face's true top (2.4384 m; was the rounded 2.44).
- No station moved: the hand-up green test (2.29 m seats, receivers at 2.34 m: hands 0.27 m below their feet), the
  flagship v3 (seats 1.83 m, deck 1.99 m) and solar (2.4 m deck) hand-offs all stay feasible. v3 re-pinned once (16219 → 16237 ticks, `5f32379d…`), same outcome;
  meal and the year-build first bay did not move.

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
`SampledEntity.hands` / `.speed` (since mars-take/3 thinned keyframes, interpolated: within 5.5 mm / 1.5 cm/s of the
engine at every tick, releases exact — TAKES_AND_PLANS.md "Thinned fields"); `baseActivity`, `on`,
`contents` are in `.state`. Hand points in crouch / reach_down are therefore only in the take — `handupHands`
rebuilds the grip, not the approach. `replayFinalState` is unchanged (the recorded final state, hash-verified).
`test/take-fields.test.ts`: the meal and a hand-up take match the live world tick for tick.

Size, flagship v3 rehearsal (16219 ticks): 457,981 → 675,124 bytes (+47 %), gzip 102,070 → 141,623 (+39 %).
Of the added bytes `speed` is 118 KB (it changes on most walking ticks; 0.1 m/s steps would still be 76 KB,
gzip −7 %) and `hands` 99 KB.

## What the renderer mirrors
Arm bones scaled to 0.62 m from 1.34 m shoulders (the engine model is the same rig since W12), heels up ≤ 6 cm (W9); arms reach `human.hands` (or a take's
`hands`) and hang when a point is truly out of reach (reach honesty, POSES.md).

## Approximate
- The envelope is a cylinder + arm test, not IK; the crouch band (shoulders down to 0.55 m) is generous for a
  squat, and `bentOver` lets shoulders sit 0.15 m below the feet (kneeling, chest over the edge).
- `reachDownBelowFeet` 0.5 m is one number for three templates that reach 0.35 (woman) – 0.54 m: the woman
  template's arms still hang for hand points 0.35–0.5 m down (POSES.md). The cap is independent of how far out the
  hands are; the `bentOver` envelope supplies that (0.54 m down at 0.45 m out, 0.36 m at 0.8 m out).
- The bands' rig proportions (hips 0.89, torso 0.45) are casual / punk; the woman template (hips 0.96, torso 0.38)
  would kneel with shoulders higher. Upright / painting bottoms keep their old offsets below the shoulders (not
  measured).
- `postureGap` treats the shoulders as one cylinder about the body axis (not two shoulder joints ±0.15 m).
- `overheadReach` 2.0 m is the measured 1.997 (shoulders 1.34 + shrug 0.05 + 0.97 × arm: the elbow never locks); the
  envelope's straight-up reach is 1.45 + 0.62 = 2.07 m, so the 2.06 m `overheadMax` cap binds.
- Release is not blended in the engine (hands clear when a holder lets go; the renderer's 0.4 s posture blend
  returns them).
