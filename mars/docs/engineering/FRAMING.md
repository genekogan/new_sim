# 2x4 roof framing — top plates, rafters, blocking (W36, 2026-09-29)

Owner feedback 2026-09-28 §7 names the Mars build order: **skeleton → 2x4 framing (top plates, rafters, joists) → stair →
floors / walls / roof**. The evidence photo `evidence/2026-09-28-skeleton-stage-racks-2x4-frame-before-plywood.jpg` shows it:
long 2x4s lying along the top of the racks, cross pieces between them, and a sloped 2x4 section at one end. There is no
plywood yet. OWNER_DECISIONS checkpoint 1 lists "2x4 framing verbs". This file covers the verbs, their rules, and what the
Kit years actually draw.

**HYPOTHETICAL / PROVISIONAL.** Mars assembly model v1: rule-based plausibility, not structural engineering. The Kit
(the procedural reconstruction) draws **no roof framing at all** (see "What the Kit has" below). So every framing member
in a year replay is an addition to the canonical scene.

## Code map
| File | Role |
| --- | --- |
| `engine/world/catalog-framing.ts` | defs, `framingRole()`, `FRAMING_ROLE`; registered by one line in `catalog.ts` (`...framingAssets()`); ids added to `CUT_TO_ORDER` |
| `engine/construction/framing.ts` | `placePlate` / `placeRafter` / `placeBlocking` (support rules), the relay-lift planner + executor, verbs `install_top_plate` / `install_rafter` / `install_blocking`, invariants `framingHandsInReach` / `framingSupported`, `framingSupportProblem` |
| `engine/construction/rules.ts` (additive) | `RAFTER_SPACING_MAX` (24 in, for the sheet rule), `FRAMING_BEARING_MIN` 1.5 in, `RAFTER_TAIL_MAX` 12 in, `PLATE_OVERHANG_MAX` 24 in, `TOP_BEAM_BAND` 0.35 m, `frameTopProblem(w, u)` |
| `engine/construction/index.ts`, `engine/api/registry.ts` (additive) | `FRAMING_ACTIONS` in `ENGINE_ACTIONS`, `FRAMING_INVARIANTS` in `ENGINE_INVARIANTS`. `CONSTRUCTION_ACTIONS` is unchanged, so the year-build registries are unchanged too: add `FRAMING_ACTIONS` / `FRAMING_INVARIANTS` to `yearBuildRegistryB` / `yearBuildBInvariants` when sequencing them |
| `engine/test/framing.test.ts` | the bay scenario, refusals, determinism, catalog / cut, pitch |

## Catalog
- `2x4-top-plate-{8,12,16}ft`: size [L, 1.5 in, 3.5 in]. The 2x4 is defined lying flat.
- `2x4-rafter-{4…16}ft` (every whole foot): size [L, 3.5 in, 1.5 in], on edge.
- `2x4-blocking-16oc` (14.25 in) and `2x4-blocking-24oc` (22.25 in): on edge. Length = rafter centres − 1.5 in − ⅛ in of
  play each side.
- **No separate ceiling-joist def.** A flat-roof rafter *is* the ceiling joist. The Kit has neither, and its roof deck
  lies straight on the top rack beams (YEAR_BUILD.md phase B, `beamDeckRule`).
- All of them are the stock 2x4 section (`cut.ts sameFamily`; the flat plate matches through its swapped-section branch).
  So the existing `cut` makes them from 16 ft stock with no change to cut.ts. Examples: a 16 ft 2x4 yields 12 ft rafter +
  24oc blocking + a 2 ft offcut; 16 ft yields 8 ft + 8 ft plates. They are in `CUT_TO_ORDER`, so an offcut is never a
  framing piece.

## Verbs
Common crew parameters: `givers[1–2]` (on the floor below), `relay?[1–2]`, `installers[1–2]` (on frame stances, a deck
or the floor), `fasten?[1–2]`, `raise: {x, z}`.
- `install_top_plate {part, onto: [frame | beam | plate …], at: {x, z, yaw}, …crew}`. The plate is centred at `at`, and
  its height is the top of what it rests on.
- `install_rafter {part, from: plate, to: plate, at, pitch?, …crew}`. The rafter starts at the point `at` m along plate
  `from` and runs square across to plate `to`. Its underside lies on both plate tops. `pitch` (radians) is optional; when
  given it is checked against the plates, ±1°.
- `install_blocking {part, between: [rafter, rafter], on: plate, …crew}`.

**Choreography.** This is hang_beam's relay pattern, driven like set_part:
1. The givers walk to the member where it lies (≤ 7 m from `raise`), crouch, lift it with hands hanging (0.72 m), and
   walk it to `raise`. They stand 0.35 m beside their grips, on the raise side.
2. The givers reach up. `raise` must be a plan point with nothing above it, since a member resting on two supports
   cannot come up between them.
3. The relay (if any) takes it and raises it.
4. The installers take it, raise it 2 cm above its supports (tilting it to its pitch), slide it over them at 0.2 m/s,
   and set it down.
5. They fasten it (2 s; `fasten` adds helpers who work at the member's nearest point).

Each hand-off height is found by scanning in 1 cm steps and taking the middle of the range both crews reach. In the bay
test, the givers hand to the relay (feet 0.95 m) at 1.25–1.31 m, and the relay hands to the installers (feet 3.05 m) at
2.76–2.77 m.

Hands are published every tick in set_part's slot format (`setpart-<i>:<lx>:<ly>:<lz>`, grips in whole mm). This means
`setPartHands()` rebuilds them exactly from a take, and `kitPartHandsInReach` also applies when it is registered.
Holders' activities are `crouch`, `lift`, `walk-load`, `reach_up`, `reach_down`, `take`, `slide`, `set` and `fasten`.
People on stances go back to `stance` afterwards.

## Support rules (plan time; `framingSupported` re-checks the recorded supports at the end of every tick)
- **Top plate.** It must bear ≥ 1.5 in, with its underside on the support ±1 cm, on **≥ 2 points**. Points can be:
  - Column tops of frames, meaning a 3 in cap at each end of the frame box.
  - Top faces of installed rack beams.
  - An installed plate (a double plate).

  Every frame must satisfy `frameTopProblem`: installed, standing, beam-stable (not merely held), with **top beams on
  both columns** within 0.35 m of its top ("a plate needs its frames' top beams"). Every beam's frames must be supported.
  The plate may overhang ≤ 24 in beyond its outermost bearing.

  Supported layouts: across one frame's two columns, or along a column line across two frames (16 ft plates in the test,
  2 ft past each 12 ft bay end). Codes: `framing.plate-frame-not-ready` / `plate-no-bearing` (names both heights) /
  `plate-unsupported` / `plate-overhang` / `plate-bad-support`.
- **Rafter.** Requirements:
  - Both plates are installed (`framing.plate-not-installed`, "needs both top plates installed first") and supported.
  - The plates are parallel.
  - It spans square across.
  - Pitch = atan(Δtop / horizontal span) (`framing.pitch-mismatch` names both angles).

  Length bounds: bearing ≥ 1.5 in on each plate, and a tail ≤ 12 in beyond each plate. Codes: `framing.rafter-short` /
  `rafter-long`, e.g. "16 ft 2x4 rafter r16 is 4.877 m but plates tp-l and tp-r are 0.914 m apart centre to centre: a
  rafter there is 0.902–1.613 m long (≥ 1.5 in on each plate, a tail ≤ 12 in beyond each)".
- **Blocking.** Both rafters must be installed and both must rest on `on`. It sits square to them (±1°), on the plate top,
  and must fit the gap between the rafters' faces with 0…2 cm of play (`framing.blocking-length` names the lengths).
- **Sheets on rafters** need rafters at **≤ 24 in** centres: `deck.ts` enforces `RAFTER_SPACING_MAX` for any sheet bearing on rafters, including mixed supports.
  The exact 24 in boundary is accepted (1e-9 m numerical tolerance); a larger gap returns `plywood.span` naming both members.
  Ordinary joists retain their existing allowance; this rule does not introduce sloped-sheet installation.
  Proof: `rafter-span.test.ts` (axis-aligned/45° layouts, exact boundary, +5 mm/+100 mm refusals, atomic install refusal).

## Stations and reach
- **Reach per hand**, checked at plan time every 5 cm of every motion, and per tick by `framingHandsInReach` with a
  0.1 m envelope tolerance:
  - The body-model envelope (`setpart reachGap`: crouch / reach_up / bent-over).
  - On a **frame stance** (stance.ts): −0.5…+2.06 m from the feet, ≤ 0.8 m out.
  - On a **floor / deck**: ≤ +2.06 m, ≥ −0.5 m, ≤ 0.8 m out.
- **16 ft Kit frame.** The highest bracing node is **3.05 m**, so hands reach to 5.11 m. Plates sit on the column tops at
  4.877 m and rafters at 4.915 m (underside), so an installer at 3.05 m reaches them within about 0.7 m horizontally.
  The bent-over envelope binds: 1.93 m above the feet at 0.74 m out.
- **Gaps.** Givers stop at 2.06 m, and an installer at 3.05 m reaches down only to 2.55 m. That gap is refused as
  `framing.gap` ("add a relay"); a relay on the same column face at 0.95 m (2.1 m below, ≥ 1.9 m) bridges it.
  Installers who cannot reach the member where it goes get `framing.out-of-reach`, e.g. "x1 on the ground (feet
  0.00 m) cannot reach 16 ft 2x4 top plate tp-l where it goes, at 4.88 m (…); use a stance/deck".
- **One person per frame face per height band.** Two people on both columns of one 3 ft face would stand 0.31 m apart,
  which violates `collision.human-human`. The test therefore puts l-column crews on the outer faces and r-column crews on
  the inner faces.
- **Mid-bay rafters.** From the end frames' stances, top-level reach covers only the ±0.4 m around each frame plane. A
  12 ft bay's middle rafters are refused (`framing.out-of-reach`, tested at mid-bay) until someone stands up there. This
  needs a deck, or a verb for standing on the top beams (W2's beam walkways top out at 2.54 m).
- **Clearances.** The member keeps clear of everyone's body in their 1.75 m band (0.24 m on a stance, 0.30 m on a floor).
  The givers' feet need free ground ≥ 0.50 m from anyone, including a relay below 1 m, who counts as ground level. The
  swept path must be clear of everything except the supports (`sweepPoses`).

## Test (`framing.test.ts`)
**Setup.** A bay of two `upright-16ft-kit` frames 12 ft apart on open ground, beam-stable by state, with 12 ft beams on
both columns at the Kit's 0.22 / 2.48 / 4.7568 m. Eight people climb stances with `climb_stance`: installers at 3.05 m
and relays at 0.95 m. Two givers work on the ground.

**What gets installed:**
- Two 16 ft plates along the column lines across both frames: `raise` 0.9 m outside the rack side, relay pair plus
  installer pair.
- Four 4 ft rafters plate to plate across the bay, at ±12 in about each end frame (24 in centres): `raise` 0.8 m outside
  the end frame, one relay and one installer. The inner rafter of each pair goes first, because the outer one would
  otherwise slide over it.
- Four 24oc blocks between each pair, over each plate.

**Result:** 7 674 ticks; 0 violations under DEFAULT + carry + uprightsSupported + stanceAccessOk + kitPartHandsInReach +
the framing invariants; every member within 1 cm / 1° of its target; recorded supports checked; hands rebuilt from the
slots every tick; pinned `935bfcee…4643`.

**Refusals tested:** rafter before plates; installers on the ground (out-of-reach, 4.88 m, use a stance/deck); no relay
(gap, add a relay); 16 ft rafter (rafter-long, names 4.877 / 0.914 / 0.902–1.613 m); mid-bay rafter (out-of-reach);
16oc block between 24 in rafters (blocking-length); pitch 0.2 on flat plates (pitch-mismatch).

**Other tests:** determinism (two runs, same hash); catalog / cut / registry; sloped rafter (plan) onto a double plate:
pitch 2.4°, and a wrong pitch refused.

## What the Kit has (inspected read-only: `campus/assembly.ts`, 2022)
**The 2022 Kit draws no rafters, joists or top plates.** Its decks, including the roof deck at the top beams, lie
straight on the rack beams. The ten 2022 "roof" features are all in the **kitchen** and form a **guard rail around its
first-floor deck**, not roof framing:

| Kit name | count | box (x × y × z m) | where |
| --- | --- | --- | --- |
| `roof rail post` | 8 | 0.07 × 1.00 × 0.06, standing y 2.50–3.50 | x −0.658, 3.000, 6.658, 10.315 (the kitchen's 4 frame lines) × z 6.314, 10.886 (the outer columns of the outer rows; rows at z 6.771 / 8.600 / 10.429, frame depth 0.914) |
| `timber roof railing` | 2 | 10.972 × 0.07 × 0.08, yaw 0, centre (4.829, 3.45, 6.314 / 10.886) | along both long sides, from the first to the last frame line, 0.96 m above the first-floor deck (top 2.492) |

The kitchen itself has 12 × `upright-16ft-kit`, beams at 0.22 / 2.48 / 4.757, a ground deck (9 sheets, top 0.252), a
first-floor deck (9 sheets, top 2.492), and only 3 sheets at 4.892 (a partial roof deck).

**Mapping advice for the campus worker (W31's area):**
- Each **post** stands where a frame column is, so the column is the post. It is unplaceable as a part, for the same
  reason as the two stair rail posts inside the end frame (YEAR_BUILD.md "Unplaced by rule").
- The **railings** are 36 ft timber rails fastened across the outer column faces at 3.45 m. They are not framing. A
  natural mapping is three 12 ft 2x4s on edge, jointed at the frame lines, screwed to the columns by someone standing on
  the first-floor deck (0.96 m above their feet). That needs a guard-rail rule/verb, not `install_top_plate`/`rafter`.
- The other years' "roof" features are also not framing: 2021 has a draped aluminet and ties; 2023–25 have chiba roof
  rail posts, timber railings and the kitchen's rooftop canopy.

**If framing goes into a year replay** it adds members the protected checkpoint does not have, and a framed roof would
raise the roof sheets. On rafters over plates on the column tops, the sheet top is 4.877 + 0.038 + 0.089 + 0.019 =
**5.02 m**, 13 cm above the Kit's 4.892 m roof deck. That breaks the 1 cm acceptance. Either:
- framing stays hypothetical skeleton-stage staging, reported as "added, not canonical"; or
- the sheet rule for Kit years keeps the roof deck on the beams (`beamDeckRule`), and the framing is a separate
  non-canonical layer.

This is a decision for Gene or the lead (QUESTIONS_FOR_GENE).

## Weak spots / not modelled
- The rise is outside the structure, then a slide over the supports at 2 cm. Sliding over something taller (a neighbour
  rafter, a tail) is refused (`framing.path-blocked`) rather than lifted over: order the members, as the test does
  (inner rafter first).
- The member is interpolated along a checked path. Its balance in two hands is not checked, beyond a limit of one holder
  per member ≤ 1.5 m. Hand-offs are instantaneous grips after a 0.6 s reach and 0.4 s take.
- Fastening is 2 s at the installers' grips. There are no toe-nail / hurricane-tie rules, and no load / span check: a
  12 ft 2x4 rafter is allowed.
- Only the givers' feet are checked against bystanders, and only at plan time; there is no runtime make-way, unlike
  set_part and carry. A person walking into the givers' path mid-lift is caught only by the human-human invariant.
- Sloped roofs are only plan-tested, with a double plate (2.4°). A multi-height frame run like the photo's (16 / 19 ft
  frames) is untested, and the photo's long sloped 2x4 ramp at the end is not a framing verb.
- Pins: perf-walk 5/5 PIN-OK and the year-build tests are unchanged. The framing invariants sit in ENGINE_INVARIANTS but
  are no-ops without framing members.
