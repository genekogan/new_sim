# Historical content — per-year state, what each year needs, the re-run recipe (W56, 2026-09-29)

> **Content is parked (Gene, 2026-09-29 evening; OWNER_DECISIONS.md).** Historical reconstruction is Gene's separate
> job. The engine tranche does not re-pin or re-record anything for content. This file is for a future **content
> agent** who has to pick up any year cold. The engine agent's brief is `HANDOFF_PROMPT_ENGINE.md`, and the boundary
> between the two is in §5.

The facts below were read at main `1a0b458`: the year files `viewer/public/engine/campus-20*.json`, the manifest
`viewer/public/engine/takes/manifest.json`, the engine tests, `engine/env/sun.ts`, `app/history/kit.ts`, and PROGRESS
W38–W58. Anything not re-checked is marked **(unverified)**. Every build order, pile yard and crew is
**HYPOTHETICAL** (YEAR_BUILD.md). Only the protected scene is reconstruction.

## 1. Per year

The **protected state** of every year is the checkpoint `mars-<year>`. Every loader publishes it from
`viewer/public/engine/campus-<year>.json` (`publishCampusYear`), so a scene change is a **re-seed** (HISTORY_IDS.md
"Reconstruction edits"). `contentHash` is the year file's field. In every year file the ground is `groundY −0.16` (the
Kit datum). Gene answered **y = 0** (Q4), but that change is RECONCILIATION_2022 §j and has not been started.

**North bearing.** `engine/env/sun.ts` sets the global `NORTH_AZIMUTH_OFFSET = −90` (W42: world −X is north, from the
2020 aerial). Per-year values live in `YEAR_NORTH_AZIMUTH_OFFSET = { 2022: −101 }` (W51: from DJI_0829). A year file
carries `northAzimuthOffset` only when the year was measured (2022 only). The camera, the sun and the studio sky read
the scene's value and fall back to the global. The frames of the other years differ from the 2020 frame (2026 CAD
≈ −57°, 2025 Kit ≈ 0°, 2024 kitchen side: Q21, Q22, OWNER_DECISIONS "North bearing" caveat), so their bearings are
**global placeholders**.

| year | scene source | contentHash (year file) | north | year-build pins | takes in the manifest | studio shows |
| --- | --- | --- | --- | --- | --- | --- |
| 2020 | `createHistoricalScene(2020)` → `app/studio-2020/scene.ts` (the Brahman tire ring; `/studio/2020`) | `cb1580f439b6…` | −90 (global; this year defines it) | none (the racks don't map to catalog frames: HANDOFF) | none | the static scene (Kit props seated by W46) |
| 2021 | `app/history/scenes.ts` `make2021` | `8dcfd059dcfb…` | −90 (global) | none | none | static scene |
| 2022 | `make2022` (+ `photographic-corrections.ts` `DECK1_TOP_2022` / `ROOF_TOP_2022`) | **`f8090a99bc9e…`** (W51; was `8b88e6f0…`) | **−101** (per-year) | **all `todo`** after W51 (§2) | 9 `otherYears` entries + 1 chapter set, **all stale** (recorded on the pre-W51 scene) | the re-seeded scene (Ba Sing Se / Cahuilla / Chatsubo / Huaqiangbei); "Watch it being built" still lists the stale takes (§1.1) |
| 2023 | `make2023` | `883e6371d533…` (W51; was `8e401abb…`) | −90 (global) | none | none | static scene; trailers out of Chiba (W51) |
| 2024 | `make2024` + `photographic-corrections.ts` `frontage2024` (W43) | `bd2e0c79f527…` (W51; W43 made `d197e6ae…` from `c542f3fe…`; W51 then `832e8d9a…` → `bd2e0c79…`) | −90 (global; the kitchen side is Q21) | none | none | static scene with the photographed Chiba front, the solarium door, trailers off Chiba |
| 2025 | `make2025` | `5399653dfa9d…` | −90 (global; the Kit frame is ≈ 0°, Q22) | none (the racks don't map: HANDOFF) | none | static scene |
| 2026 | `deploy/engine-scene.mjs` from the CAD replica `public/browser/campus.glb` (`campus.glb` + `public/modular/components.json`). Codex's frame grouping is `docs/engineering/data/campus-2026-frames.json` (81 frames / 12 beams / 92 unclassified; every `catalogDef: null`) + `-unclassified.md` + `.svg`, and is **not yet read by** `engine/campus/assembly.ts` | `0d980ad942b1…` | −90 (global; the CAD frame ≈ −57°, Q22) | none for the year itself. The flagship / v3 / stress / meal / probe pins are **hypothetical engine scenarios** at staging-east, not reconstructions (PLANNING_BUDGET, `deploy/perf-walk.mjs`) | `takes`: flagship `d2f16bd3…` (final `c56ea8da…`), v3 `64c3331c…` (final `0fe37f01…`) — both hypothetical and current | the CAD scene plus the two flagship takes in the picker |

`SEAT_HELD_YEARS = {2022, 2026}` (`app/history/kit.ts:42`). In those years props keep their pre-W46 placement:
2022 because seating it moves the 2022 pins, and 2026 because its details are unseated (W46). Seating 2022 is part of
the 2022 re-pin (§4).

### 1.1 The 2022 takes (manifest `otherYears` + `chapterSets`)

Every 2022 entry was recorded against the **pre-W51** scene. The houses moved with `shift` 3 → −2, and the stairs,
solar and trailers changed. Their recorded base no longer equals `campus-2022.json`.

| id | file | final hash | what |
| --- | --- | --- | --- |
| `b7b882fd…` | `year-build-2022-east-house-bay1.json` | `251a44c5…` @ 41 317 | east-house first bay |
| `69c41651…` | `year-build-2022-east-house.json` | `d382e461…` @ 117 277 | east-house whole skeleton |
| `e8fd2e0d…` `c1e76f1c…` `517ac94d…` `5c5f7709…` `785987be…` `0799de33…` `5cceb1c4…` | `year-build-2022-east-house-ab-{a,d0,d1,d2,s,w,p}.json` | chapter finals; P ends at `ddb634d6…` | the 7 A+B chapters |
| chapter set `8ce33bee…` | (the seven above) | start `b432a59b…` → `ddb634d6…` @ 600 599 | "Watch it being built: 2022 east-house (A+B)" |

Where the stale state is parked:
- **Engine tests.** Eleven 2022 tests are `todo` with the old hashes kept in place: `W51_TODO` in `year-build.test.ts`,
  `year-build-b.test.ts`, `year-build-houses.test.ts` and `year-stock.test.ts`. The consolidated gate at `1a0b458`
  reports them as **433 tests / 416 pass / 0 fail / 6 skip / 11 todo**.
- **Camera test.** `camera-direct-identity.test.ts` skips its D2 chapter case while the take's base ≠ the current
  scene (`1a0b458`).
- **e2e.** Five `test.fixme(W51_FIXME)` sites: `studio-build.spec.ts` (the watch tests), `lab.spec.ts` "Oblique yard",
  and `year-build.spec.ts` first bay + whole house.

**(unverified)** Nobody has looked at what the studio draws when a stale 2022 take plays over the re-seeded scene.
Expect the take's parts in the old east-house frame against the moved neighbours. `app/studio/direct-camera.ts`
computes `matchesBase` only for Direct camera.

## 2. The 2022 reconciliation and the four houses

**Scene (RECONCILIATION_2022.md; W51 landed its sections as one re-seed per year).**

| § | status |
| --- | --- |
| (a) names + handedness | **done**. The ids are kept (`chiba` = Ba Sing Se, `east-house` = Cahuilla, `kitchen` = Chatsubo, `west-house` = Huaqiangbei). `shift` 3 → −2. Q20 is open for Gene's confirmation. |
| (b) stairs parallel | **Kit done**: 12 treads × 3.54 m and 13 risers from the sand. The landing arrangement is Q32; Q29 is still on its default. **Engine not done:** no `stringerRule` / `treadRule` / catalog flight for the new template, so every stair part is unplaced and the **old engine stair rule refuses the stair link**. The stair is never walkable in phase B. |
| (c) trailers | **done**: 9 trailers from aerial-03 (a train of 5 on −X); rv-10…12 are `null`. |
| (d) solar | **Kit done**: 45° triangle frames facing south, 10 / 10 / 3 × 3 / none (the counts are the Q28 default). **Engine not done:** a tilted module reads as a flat **1.18 × 1.07 m** panel (the `year-stock` todo: `solar-panel-1.18x1.07` vs `1.59x1.07`). A `solar-frame-45-2x4` + `install_panel` onto frames is needed. |
| (e) no corner table | **done** |
| (f) north | **done**: −101 |
| (g) floors: joists | **not started** (Kit then engine; the deck rises +8.9 cm; Q30) |
| (h) roofs: 2x4 framing | **not started** (Kit then engine, with W36's framing verbs; the roof rises +13 cm) |
| (i) 2023 / 24 trailers | **done** (Q2) |
| (j) datum y = 0 | **not started** (Kit `GROUND` 0, studio offset, 2020 undo, `GROUND_Y_2026` check, regenerate 2021–2025) |
| (k) third row | confirmation only |

The ids after W51: 2022 kept 999 of 1204. Stair and solar entries are aliased by role and 47 are `null`.
`id-migration.json` now holds 7 811 live entries + 140 nulls (HISTORY_IDS.md).

**Houses (YEAR_BUILD.md "Checkpoint 1" / "1b"; all runs against the pre-W51 scene).**

| house (2022 name) | yard | tranche pin (first bay + first strip) | full A+B (`YEAR_BUILD_FULL=1`) | state now |
| --- | --- | --- | --- | --- |
| east-house (Cahuilla) | **v1** (W7/W13's) | bay-1 `251a44c5…` @ 41 317; bay + strip `94db263e…` @ 53 604 | green, `ddb634d6…` @ 600 599 (`PIN_FULL_AB`); skeleton `d382e461…` @ 117 277 | all `todo` (`W51_TODO`). The corridor part of W47's parking rule would move this pin to `2cd6af11…` @ 600 204; that change is held back. |
| chiba (Ba Sing Se) | v2 | `940e9f64…` @ 60 997 | **green end to end, pinned `0ee1da11…` @ 564 548** (W47, 7.84 h simulated, 0 violations) | tranche `todo`. **The full test is not marked todo** (`todo: FULL_RED[h]`, and chiba has no entry), so under `YEAR_BUILD_FULL=1` it asserts the pre-W51 pin against the re-seeded scene. It will most likely fail. **(unverified — not run after W51)** |
| west-house (Huaqiangbei) | v2 | `b4c42210…` @ 54 322 | `todo`: stops in S at `s1328-carry` `carry.gather-stuck` (two carriers meet head-on in the take-out strip) | **Next:** a crossing-free gather (match crew to carrier stations by distance in `carry/actions.ts`, which moves every two-person carry pin, or order the crew in the generator). Needs a lead decision. |
| kitchen (Chatsubo) | v2 | `4862adfc…` @ 55 293 | `todo`: `s0995-carry` `carry.path-occupied` without end (idle m4 on the stair foot); the test is cut at 340 000 ticks | **Next:** (1) rule 15's corridor parking, which moves east-house's pin; (2) a two-leg lift path at `s0996` `stair-part.no-room`; (3) treads, posts, W, END. The roof deck over bay 0 (rule 9) is also open. |

The 2022 year also stays in `SEAT_HELD_YEARS`. The LAST_MILE §13 ruling classes LM-156 / LM-184 (the other houses'
`todo` tests) as **content**.

**Consequence for the re-pin.** After W51, every 2022 pin above has to be re-derived on the new scene. The yard, the
beam staging end (W38 rule 3: Cahuilla's staging end now falls inside Ba Sing Se, 9 beams unstaged), the stair
template and the solar template all change what the generator produces. W47's rules 12–23 were tuned on the old
geometry.

## 3. What each year needs from Gene

The loop is the same for every year: **photos → answers (QUESTIONS_FOR_GENE.md fenced `Gene:` lines, the `/questions`
page) → scene edit (a re-seed, §4.1) → re-run (§4.2–4.5)**. Never guess a historical fact. A new question goes into
QUESTIONS_FOR_GENE.md as a ` ```question ` block with a capture, then run `node deploy/questions-html.mjs`. The page is
served at `/questions/`, and `npm test` fails if it is stale.

| year | open questions | what else would unblock it |
| --- | --- | --- |
| 2020 | none open | nothing. The racks don't map to catalog frames, so no year build is planned. |
| 2021 | none open | photos of the rack layout if a year build is wanted (none planned) |
| 2022 | **Q20** (handedness confirmation), **Q25** (Ba Sing Se's screens and the 2.30 m wall), **Q26** (how the kitchen's bay-0 roof deck was reached), **Q27** (the 0.9 / 1.0 m low walls), **Q28** (which house is staggered, solar counts), **Q29** (stair foot side), **Q30** (joists on edge or flat, depth), **Q31** (what each house held), **Q32** (stair landing) | the engine templates for the new stair / 45° solar / joist / roof framing (§5, engine-side) |
| 2023 | none open | — |
| 2024 | **Q21** (kitchen and trailer ring north or south of Chiba), **Q23** (Chiba front 6 or 7 bays), **Q24** (solarium door position / swing) | — |
| 2025 | **Q22** (per-year bearing) | the rack mapping (none today) |
| 2026 | **Q22** (the CAD frame is ≈ 33° off the drone) | Codex's frame grouping → `assembly.ts` (engine-side: the CAD posts are ≈ 1.02 m deep, no stock size) |

Q1–Q14, Q19, A1 and A2 are answered. Their answers are in OWNER_DECISIONS.md ("2022 reconciliation + build rules").
Most of them are what RECONCILIATION_2022 §g/§h/§j still has to implement.

## 4. The exact re-run recipe

All commands run from `viewer/`, on a branch in a worktree (CODEX.md recipe), with the full `npm run gate` before any
merge.

1. **Scene edit (re-seed).** Follow HISTORY_IDS.md "Reconstruction edits":
   - Edit the Kit scene (`app/history/scenes.ts` / `photographic-corrections.ts` / `kit.ts` values).
   - Run `node deploy/history-scenes.mjs <year>`, then `node deploy/history-scenes.mjs --check`.
   - Run `node deploy/history-ids.test.mjs`. It names each vanished legacy id. Alias it to its successor or set it to
     `null` in `app/history/id-migration.json`, editing only that assembly's line. Then update the live/null counts
     the test asserts (7 811 / 140 now).
   - Run `node deploy/history-geometry.test.mjs` (no floating props, trailer clearance, `SEAT_HELD_YEARS`).
   - In `engine/test/campus-history.test.ts`, freeze the pre-edit `contentHash` and prove that publishing the pre-edit
     canonical, forking it and committing a `reconstruction-edit` checkpoint gives the new canonical (W51's
     `PRE_EDIT_W51` block is the template).
   - Re-baseline that year's studio / lab captures and look at them.
   - For a new north: set `YEAR_NORTH_AZIMUTH_OFFSET` in `engine/env/sun.ts`; the year file then carries
     `northAzimuthOffset`.
   - To seat 2022 props: remove 2022 from `SEAT_HELD_YEARS`. That moves the 2022 pins, so do it in the same re-pin
     window.
2. **Year-build runs.**
   - `yearBuildSetup(year, assembly, file, { phaseB?, bays?, avoidNeighbours? })` (east-house, yard v1) and
     `yearBuildHouseSetup(2022, house, file, { tranche? })` (the other houses, yard v2) are in
     `engine/scenarios/year-build.ts`.
   - The tests: `year-build.test.ts` (phase A), `year-build-b.test.ts` (A+B, sections), `year-build-houses.test.ts`
     (four houses), `year-stock.test.ts` (BOM), `year-assembly` / `year-hang`.
   - The default suite runs the tranches. `YEAR_BUILD_FULL=1 node --test engine/test/year-build*.test.ts` runs the
     whole-house runs (chiba ≈ 13 min each; east-house A+B ≈ 13–14 min wall). Run them in the background with logs.
   - Drop `todo: W51_TODO` only when the run is green on the new scene.
3. **Re-pin.**
   - Verify "0 violations, same discrete outcome" (every sequenced part at its target, the unplaced list with reasons).
   - Write the new tick + hash into the test's `PIN_*` constant.
   - Add a **reason paragraph to PLANNING_BUDGET.md** naming the cause (e.g. "2022 reconciliation re-seed W51 +
     joists/roof framing; old → new"). Today PLANNING_BUDGET has **no W51 entry**: the `todo` state lives only in the
     tests.
   - Update the `pin:` fields in `deploy/record-campus-take.mjs` (its `year-build-2022*` scenarios name the pins they
     must reproduce).
   - `node deploy/perf-walk.mjs` must still show 5 × PIN-OK (content edits don't touch them).
4. **Takes.**
   - `node deploy/record-campus-take.mjs --scenario <name>`, then the same command with `--check`. The scenarios are
     `flagship`, `build-bay-v3`, `year-build-2022` (bay 1), `year-build-2022-house` (skeleton, opt-in),
     `year-build-2022-ab` (explicit), and `year-build-2022-ab-chapters` (explicit: one run cut into the 7 chapter takes
     + a `chapterSets` entry; STUDIO_REPLAY.md "Chapter sets").
   - `--all --full --check` covers every non-explicit scenario.
   - Per-house chapter sets for chiba / kitchen / west-house need new scenarios modelled on
     `year-build-2022-ab-chapters` (never recorded).
   - The recorder rewrites the manifest's `otherYears` / `chapterSets` entries. Check the size `limit` (6 MB per take).
5. **Re-enable consumers.** Remove `test.fixme(W51_FIXME)` from the e2e sites (§1.1). `camera-direct-identity`'s D2
   case comes back on its own once the base matches, so re-check its golden. Run `studio-build.spec` ("final A+B
   checks": the set ends at the pin) and the lab "Oblique yard".
6. **Gate + docs.** Run `npm run gate` green, then update YEAR_BUILD.md, RECONCILIATION_2022.md (section status),
   HISTORY_IDS.md (the edit record), CAMPUS_SCENE.md, and add a PROGRESS entry.

## 5. Engine-side vs content-side

The boundary is set in `HANDOFF_PROMPT_ENGINE.md` "Your scope".

- **Content (this file's agent).**
  - The year scenes `app/history/scenes.ts`, `photographic-corrections.ts`, and `kit.ts` *values*.
  - The generated `public/engine/campus-20*.json` and `app/history/id-migration.json`.
  - RECONCILIATION_2022.md, per-house year-build *content* (which house has what), QUESTIONS_FOR_GENE.md +
    `questions/`, this file.
  - The 2022 re-pins and take re-recordings that a content edit causes.
- **Engine.**
  - Mechanics: a new field or schema, a renderer for a new kind, the verbs and rules (stringer / tread templates,
    `install_panel` onto 45° frames, joist-then-plywood floors, roof framing sequencing, crossing-free carry gather,
    corridor parking).
  - The 2026 grouping integration into `assembly.ts`.
  - The engine agent may touch content files only for mechanics, must say so, and re-runs its gate when a content edit
    moves a pin.

Which side owns the 2022 *engine rules* (§b/§d/§g/§h engine halves: LAST_MILE LM-182 and related) is open. They are
needed only for the reconstruction, and LAST_MILE classes them as content-gated. Coordinate before either agent starts
them.
