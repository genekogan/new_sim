# Studio replay: "Watch it being built", camera direction, verify of directed tracks

W19, 2026-09-28. Owner feedback §10 (watch a year being built) and §11 (direct the camera), studio side. Code:
`viewer/app/studio/{take-panel.tsx, take-host.ts, take-checks.ts, direct-panel.tsx, direct-camera.ts, camera-verify.ts}`,
`viewer/app/engine-view/take-replay.ts`. Specs: `e2e/studio-build.spec.ts`, `e2e/studio-direct.spec.ts`,
`e2e/studio-take.spec.ts`, `e2e/camera-verify.spec.ts`.

## 1. The take picker (manifest-driven)

`/studio/<year>` lists **every entry of `public/engine/takes/manifest.json` whose `year` equals the studio year**,
from both `takes` and `otherYears`, in manifest order. No take id, file name or year appears in code; a newly recorded
take shows up after the recorder rewrites the manifest.

- **Replay take** (bottom of the stage, every year with at least one take). Each option reads
  `label · year · ticks · hypothetical|historical`. The label's "(HYPOTHETICAL …)" suffix is dropped because the flag says it.
- **Watch it being built** (header, right of the year picker). This lists only the year-build entries of that year and is
  hidden when there are none. It drives the same host, so the bottom panel then shows the transport.

### Manifest contract (what the studio reads)

| field | use |
| --- | --- |
| `id`, `file` | option value; the `mars-take-replay/1` file to fetch |
| `label`, `year`, `hypothetical` | option text; the banner ("HYPOTHETICAL build scenario — not historical" or "Historical record") |
| `ticks` (optional) | option text; falls back to `duration / 0.05` |
| `duration`, `entities`, `moments` | scrubber, readout, moment dots (labels: carry, held, deck, visitor, beam, bay; unknown keys show the key) |
| `finalStateHash` | final-frame check (the replayed hash must equal it) |
| `kind` (optional) | `'year-build'` marks a "Watch it being built" take. **Absent → inferred:** `rulesVersion` contains `year-build`. W17's recorder can add `kind` without a studio change. |

From the take file, the studio also reads `campus`, `site { origin, yaw, groundY }`, `steps`, `take` and `camera`
(`take.finalState.base.campus` is `mars-<year>:build:<assembly>` for a year-build fork).

**As of the W19 run**, the manifest had the flagship `969c8bf9…` (2026, `takes`) and the 2022 east-house first bay
`9970e93e…` (2022, `otherYears`, 41 182 ticks, `rulesVersion` `mars-rules/year-build-phase-a`, no `kind`). Both takes are
still `mars-take/2`; the replay also reads `/3` (§2). **Since W22** the 2022 first bay and the 2022 whole skeleton
(`year-build-2022-east-house.json`, `otherYears`, recorded with `--full`) are `mars-take/4` (TAKES_AND_PLANS.md "Compact
tracks, events and entities0"), both with `kind: 'year-build'`. The flagship is still the /2 file: its re-record is
held back by a camera-synth test (see there).

## 2. The take host per year

`createTakeHost(scene, { year, … })` now exists for every year. Opening a take does five things:

1. **Datum.** `offsetY = campus-<year>.json groundY − file.site.groundY`, where the first term is the ground the studio
   draws. The flagship gives −0.16 − (−0.16) = 0. The 2022 year-build fork stands on the Kit datum 0, so it gives
   −0.16 − 0 = **−0.16 m**. Takes without `site` are in scene coordinates.
   - The offset is applied to a **shifted render copy of the take** (tracks, recorded hands in mm, final poses), not by
     moving the group. The arm and leg solvers in `humans.ts` mix bone world positions with the engine's target points,
     so a moved group would put every hand 0.16 m off.
   - The camera pose gets the same offset. Hashes, the sampler, the checks and camera direction use the original take.
   - **Consequence:** the rebuilt 2022 frames render 0.16 m below where the Kit draws its other racks. The Kit draws
     rack posts from y = 0 above a ground plane at −0.16. People and piles stand on the drawn ground. The canonical
     check (below) is done in engine coordinates, so it is unaffected.
2. **Hide the rebuilt building.** For `base.campus` = `mars-<year>:build:<assembly>`, every Kit group with that
   `assembly_id` is hidden (`visible = false` plus a render-batch rebuild) while the take is open, and restored on close.
   The replay therefore starts from the empty site, the pile yard and the crew.
3. **Ambient people** are hidden, as before (`life.setHidden`).
4. **Fixtures render as fixtures.** Piles, bundles, the cutting station, benches and campfires go through `FixtureViews`,
   with `contents` as of t, so a pile shrinks as pieces are taken. Before this change they were drawn as people (nine
   "visitors" standing in the 2022 yard).
5. **Hands** come from `sampleTake(...).hands`: metres, interpolated between `mars-take/3` keyframes, and held per tick
   for `/2`. Before this change, the raw integer-mm change values were handed to the arm solver.

Transport speeds are 0.5, 1, 2, 4, 8, 16 and 64×. The time is random access, so speed and camera never change what is
drawn at t.

### Refusal / blocked log

`take.events` carry the diagnostics:
- actions `blocked` (code + message), for example "the crew carrying … waits for m3 to move out of its way";
- actions `failed` (a refusal);
- `violation`s.

The two newest entries up to the current time are always shown (`role="log"`, "Take log"), and the last 12 are in the
Diagnostics drop-down with the whole-take totals. The 2022 take has 101 blocked waits, 0 failed and 0 violations.
Since mars-take/4, repeated identical waits are one line "(×n until t s)", and the totals count each wait (the /4 first
bay: 106 waits, whole skeleton: 242).

### Final-frame checks (`take-checks.ts`)

- **Hash.** `hashOf(take.finalState)` must equal `take.finalStateHash` and the manifest's hash.
- **Last frame.** `sampleTake` at the last tick is compared with the recorded final state: every entity must be present
  and within 2 mm. 2022: 0.57 mm; flagship: 0.69 mm.
- **Canonical (year-build only).** The graph is `assemblyGraph(year, sceneFromYearFile(campus-<year>.json))`. The
  targets are the building's frames and beams that the take contains. The engine's own `compareToCanonical`
  (installed, upright, ≤ 1 cm, ≤ 1°) is run on the **replayed last frame**.
  - 2022 first bay: **✓ 24 / 24 at the mars-2022 canonical pose, max 0.2 mm / 0.02°**. The house's other 42 frames and
    beams are reported as "outside this take" (a tranche), never as failures.
  - The protected checkpoint is not rebuilt in the browser. The graph comes from the same year file that
    `publishCampusYear` publishes as `mars-<year>`.
  - The reconstructed year-build scene hashes to the take's `base.staticHash` (`a3ffdd2f…`), which `direct-camera.ts`
    checks.

## 3. Direct camera (replay bar)

"Direct camera" (a drop-down) has four parts:
- **The form builder** writes one typed `CameraDirection` (CAMERA_DIRECT.md §1). Fields: subject kind + ref, verb,
  degrees and direction (for verbs that take them), duration, "at the current time", framing size, side, sun behind
  (+ sunset), interior and look at. **Add** appends to the list; **Replace** starts a new one.
- **The JSON list** is editable. It is exactly what the compiler takes; there is no natural-language parsing.
- **Compute camera** compiles the list.
- **The result** shows the shot list: label, verb, window, the resolved subject, the planner's readability / invalid
  samples and the phase-2 simulation verdict. Under each shot are its corrections
  (`failure → strategy (n samples, t0–t1 s): reason · tried first: …`) or "valid as computed — no correction".
  A refusal shows its code and message, plus the candidates for an ambiguity.
- **Play directed track** switches the engine camera to the directed track (`TakeReplay.setTrack`), seeks to its first
  shot, plays, and folds the form away. **Back to the take's camera** restores the take's own track. The take, its hash
  and its poses are untouched (tested).

**Where it compiles.** The public takes are files, not takes stored in a simulation room, so the studio runs the pure-TS
compiler itself (`direct-camera.ts` → `engine/camera/synth.ts directCamera`, phase 2 on). The inputs match what
`engine_direct_camera` and the recorder use:
- `world = take.finalState`, `sampler = takeSampler(take)`, `facts = takeFacts(take)`;
- policy: parts collide and do not occlude;
- the static camera scene:
  - 2026: the campus cropped ±40 m around `site.origin`;
  - year-build: `yearBuildScene(sceneFromYearFile, assembly, footprint centre, 35)`;
  - in both cases the installed parts are added as collision-only prisms.

The track id is named as the op names it (`dir-<hash>`).

The **Simulation & MCP** room path was not used, because none of these takes exists in a room. A room-held take would
go through the panel's existing `/api/simulation` MCP calls; that wiring is left for when rooms hold recorded takes.
Compile time in headless Chromium, per the spec runs: 17–35 ms for the close hold, 15 ms for the Chiba pan, 251 ms for the 270° orbit, and 393 ms for the kitchen fly-through (navmesh plus a split).

**Tested direction** (`studio-direct.spec.ts`): `{subject:{kind:'group',ref:'carryA'}, motion:{verb:'hold'}, at:1,
framing:{size:'close',side:'east'}}` on the flagship gives **foreground → raise**. The reason recorded is "person person-2
1.69 m from the camera covers 37 % of the subject's frame region (13 samples, t 3.8–5 s); raised the camera 1 m". An
unknown group is refused with `camera.direct.unknown`.

## 4. Verify of directed tracks (`verifyCamera(scene, replay | null, { track, trackId, sampler, offsetY })`)

- `track` replaces the replay's own camera track: a directed track of the open take, or a take-less track with
  `replay = null`.
- **Subject points.** They come from the take sampler, exactly as the planner had them. For ids the sampler does not
  know (the synthesiser's `focus:<i>` points of static subjects), the points come from the track's recorded
  `data.subjects` (`subjectReader`).
- **Coordinates.** Rays are cast in scene coordinates (the take + `offsetY`). Framing, size and the planner comparison
  stay in take coordinates, since a translation changes neither.
- **Test hooks** (`window.__marsStudio`):
  - `verifyCamera(from, to, hz, { track: 'take'|'directed'|'year' })`;
  - `direct(directions)`, `playDirected(on)`;
  - `directOnYear(directions, { datetime, crop, duration })`: the year's canonical campus with nobody in it, as in the
    fixtures `campus2026()` / `campus2024()`;
  - `palm(id, hand)`, `visiblePeople()`.

**Results** (`camera-verify.spec.ts`, "directed tracks", 2 Hz, SwiftShader):

| track | samples | planner / real | hidden (≥ 0.8 → ≤ 0.3) | \|Δ\| ≥ 0.2 | worst sample |
| --- | --- | --- | --- | --- | --- |
| flagship bay orbit, 270° / 120 s from `seat_b1` (208.9–328.9 s) | 240 | 0.908 / 0.934 | 0 | 0 | t 293: planner 0.83, real 1.0 (crew capsule vs skinned body) |
| carryA close hold, corrected (+1 m) | 11 | 0.882 / 0.918 | 0 | 0 | t 1: planner 0.6, real 0.7 (person p2) |
| Chiba sunset pan, 2026-03-01 17:18, take-less | 18 | 1.0 / 1.0 | 0 | 0 | — |
| 2024 kitchen fly-through from (8, 1.6, 36), take-less, crop [−30, 15, 35, 70] | 37 | 0.730 / 0.730 | 0 | 0 | 0–4 s: 0 / 0, sink behind the real plywood wall (both agree), split at the hatch |

No planner-vs-render disagreement was found on any directed track, so there is nothing to hand to the engine worker as a
regression fixture.

## 5. What is approximate (honest)

- **Datum.** A year-build take renders 0.16 m below the Kit's own racks (§2). The parts are exact in engine coordinates;
  the picture is feet-true, not rack-true.
- ~~Entities removed mid-take are not drawn.~~ Fixed in mars-take/4 (W22): the take's `entities0` holds each entity as
  first recorded, and the replay draws from it when the final state lacks the entity. The emptied
  `pile-upright-16ft-kit-1` is drawn, shrinking, until tick 29 588, when it is removed. `info().undrawable` is now empty
  for /4 takes and lists such ids only for older ones.
- **Year-build takes have no dedicated "watch" camera.** They use the recorder's planned shot list (0.5 Hz; readability
  mean 0.81). A directed track can be computed and played instead.
- **Direction in the studio compiles in the page.** The directed track lives only in the page and is not stored beside
  the take.
- **Chiba verify is weak evidence.** A static subject's focus points lie on its own bounding-box face (3 per sample).
  The render check therefore only sees occlusion by *other* meshes, never the facade itself. Chiba's 1.0 / 1.0 says
  nothing blocks the view, not that the frame shows Chiba well.
- **Corrected hold, foreground.** The +1 m raise passes phase 2's foreground rule, and the render agrees on readability.
  But the capture at 4 s (`studio-direct-playing.png`) still shows a bystander's head large in the lower centre of the
  frame. The rule measures cover of the subject's frame region and accepts a bystander who is big in the frame without
  covering the crew's points.
- **Worst-sample captures of take-less tracks** use the orbit camera at the sample's pose with the studio fov, not the
  track fov.
