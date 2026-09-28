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
  `label · year · length · ticks · hypothetical|historical` (W24 added the length: "… the whole house, from the piles ·
  2022 · 1 h 38 min · 117,277 ticks · hypothetical" beside "… first bay, from the piles · 2022 · 34 min · 41,317 ticks"). The label's "(HYPOTHETICAL …)" suffix is dropped because the flag says it.
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
| `kind` (optional) | `'year-build'` marks a "Watch it being built" take. **Absent → inferred:** `rulesVersion` contains `year-build`. W17's recorder can add `kind` without a studio change. `'year-build-chapter'` (W31) is one chapter of a chapter set (below). `isYearBuild` is false for it, and since W37 `isChapter` keeps it out of **both** pickers: a chapter plays only as part of its set. |
| `chapter` (optional, W31) | `{ of, index, id, startsFrom, startHash }`: the chapter set's id, the 0-based position, the section id (`A`, `D0`, …), the previous chapter's take id (`null` for the first) and this take's start state hash (= `take.baselineStateHash` = the previous chapter's `finalStateHash`). |

From the take file, the studio also reads `campus`, `site { origin, yaw, groundY }`, `steps`, `take` and `camera`
(`take.finalState.base.campus` is `mars-<year>:build:<assembly>` for a year-build fork).

**As of the W19 run**, the manifest had the flagship `969c8bf9…` (2026, `takes`) and the 2022 east-house first bay
`9970e93e…` (2022, `otherYears`, 41 182 ticks, `rulesVersion` `mars-rules/year-build-phase-a`, no `kind`). Both takes are
still `mars-take/2`; the replay also reads `/3` (§2). **Since W22** the 2022 first bay and the 2022 whole skeleton
(`year-build-2022-east-house.json`, `otherYears`, recorded with `--full`) are `mars-take/4` (TAKES_AND_PLANS.md "Compact
tracks, events and entities0"), both with `kind: 'year-build'`. The flagship is still the /2 file: its re-record is
held back by a camera-synth test (see there).

### Chapter sets (W31): a long build as consecutive takes

A build too long for one take (the 2022 east-house A+B: 600 599 ticks, 12.0 MB as one file against the 6 MB budget) is
recorded as **one run cut into chapter takes** at plan barriers (`engine/take/chapters.ts`; the A+B chapters are
sequence-b's sections A, D0, D1, D2, S, W, P+END). The manifest gets a top-level **`chapterSets`** list, which the
studio offers as one "Watch it being built" entry per set (W37, "Chapter sets: playback" below). The chapters themselves are ordinary `otherYears` entries (`kind: 'year-build-chapter'`,
`chapter`, see the table above), each with its own file, camera track and final-frame hash.

`chapterSets[i]`:

| field | meaning |
| --- | --- |
| `id` | the set's id: `hashOf({ set: <key>, takes: [chapter take ids] })` (24 hex). Every chapter's `chapter.of` |
| `label`, `year`, `hypothetical` | option text, as for a take ("Watch it being built: 2022 east-house (A+B) (HYPOTHETICAL …)") |
| `kind` | `'year-build-chapters'` |
| `duration`, `ticks` | the whole run. `ticks` = Σ chapter ticks; `duration` = `ticks × dt` |
| `startStateHash` | the first chapter's start state (`take.baselineStateHash`) |
| `finalStateHash` | the last chapter's final state = the run's final state (for the A+B: the `year-build-b.test.ts` pin) |
| `planHash`, `rulesVersion` | the one plan every chapter ran |
| `bytes`, `gzipBytes` | Σ over the chapter files |
| `chapters[]` | in play order: `{ id, label, take, file, from, to, ticks, fromStep, toStep }`. `take` / `file` = the chapter's manifest entry. `from` / `to` = the chapter's tick range within the run (`to − from = ticks`; `from` of chapter k = `to` of k − 1). `fromStep` / `toStep` = the plan step range `[fromStep, toStep)` |

**Guarantees** (checked by the recorder on every record / `--check`, and by `engine/test/take-chapters.test.ts` on the
shipped files):
- **Continuity.** Chapter k's first frame is chapter k − 1's final state. `take.baselineStateHash` of k =
  `take.finalStateHash` of k − 1 = `hashOf(finalState)` of k − 1. `take.entities0` of k holds every entity of k − 1's
  `finalState` exactly (minus provenance / label / tags). `sampleTake(k, 0)` is within ½ mm / ½ mrad of those poses,
  with the same phase / activity / level (`chapterContinuity`).
- **One timeline.** `take.startTick` of k = `startTick + ticks` of k − 1, so absolute world ticks continue across the
  chapters. Within a take, times are relative (from 0), as for every take.
- **Own steps only.** A chapter's `steps` / events hold only the lifecycles of its own plan steps (`fromStep … toStep`).
  Ambient make-way walks belong to the chapter in which they run.

**Playing a set back to back (the W31 recipe; built in W37, see "Chapter sets: playback" below).** Offer each `chapterSets` entry under "Watch it being
built" as one item, with its `ticks` and `duration`. Keep the chapter entries out of that picker (they already are, by
`kind`). Then:
1. Fetch chapter 0 and open it as today: datum offset, hide the rebuilt building, fixtures, camera = its `camera`.
2. At its end (or on seek past `to`), open chapter k + 1. The scene need not be rebuilt: chapter k + 1's `entities0` is
   chapter k's final frame, so the swap is seamless. Check `chapter.startHash === previous.take.finalStateHash` before
   the swap and show a continuity error instead if it fails.
3. The set's scrubber runs over `[0, duration)`. Map a set time T to the chapter k with `from ≤ T/dt < to` and the local
   time `T − from·dt`. Moments are per chapter, take seconds within the chapter: the first of each event (`first raise`,
   `first beam`, `first hand-up`, `first relay`, `first cut`, `first pass-up`, `first stringer`, `first tread`, `first post`,
   `first wall`, `first rail`, `first panel`, and `up the frame` early in D1 / D2 / W / P) + `done` (W39,
   `engine/camera/chapter-shots.ts`; was `work`, `middle`, `done`). Offset them by `from·dt`.
4. Final checks: the last chapter's hash check covers the whole set (`finalStateHash` of the set = of the last chapter).
   The canonical check (year-build) runs on the last chapter's replayed last frame. Earlier chapters can run it on their
   own last frame; parts not yet built there are "outside this take".
5. Prefetch chapter k + 1 while k plays (each file ≤ 6 MB raw; the A+B chapters are 0.9–3.5 MB, gzip 0.1–0.6 MB).

### Chapter sets: playback (W37)

Code: `app/studio/chapter-set.ts` (`ChapterSetReplay`), `chapter-set.worker.ts` (whole-set checks), `chapter-panel.tsx`
(transport), `take-host.ts` (`openSet`), `take-panel.tsx` (pickers). Spec: `e2e/studio-build.spec.ts` (the last three tests).

- **One entry.** Each `chapterSets` entry of the studio year is one option (value `set:<id>`) in "Watch it being built"
  **and** in "Replay take", above the single takes. The text is derived from the set, not written in code:
  `<place>: <what the chapters build> — from the piles · <length> · <n> chapters`. `<place>` is the set label without its
  "Watch it being built:" prefix and parentheticals; the chapter words are each chapter label's head noun (before " — " or
  ","; a head listing two things reads as its first word), neighbours folded into a plural. For the A+B:
  **"2022 east-house: skeleton, decks, stair, walls, solar — from the piles · 8 h 20 min · 7 chapters"** (30 029.95 s =
  8 h 20.499 min; the picker's own `span` rounding). The 2022 bay-1 and whole-skeleton takes stay as they were; the seven
  chapter takes are in neither picker (`isChapter`).
- **One clock.** The set runs over `[0, duration)` on an h:mm:ss clock. Set time T maps to the chapter k with
  `from·dt ≤ T < to·dt` and the local time `T − from·dt`. The scrubber covers the whole set; speeds 0.5–64×, as for a take.
- **Chapter bar.** Under the scrubber: `A · D0 · D1 · D2 · S · W · P`, each as wide as its ticks, the chapter on screen
  highlighted (`aria-current`); a click jumps to its start. Every seam carries the continuity mark (✓ / ✗ / … while it is
  being read). The row below says "Chapter 4/7 · D2: roof deck — … · 0:45:37 in" and the seam of the chapter on screen:
  "D1 → D2: ✓ 35b45a51… (first frame = D1's final state)"; chapter 0 reads "A starts from the pile yard b432a59b… ✓".
- **One set of views.** A single `TakePeople` draws the whole set. At a boundary the next chapter's (datum-shifted) take is
  swapped in with `TakePeople.setTake`: its first frame is the previous chapter's final state with the same ids, so no
  rig or mesh is rebuilt. `show(t, clock)` poses at the local time but animates idle loops and fires on the set clock.
  Poses depend only on T, as for a single take.
- **Guard before a swap.** A chapter is used only if `take.baselineStateHash` = the previous chapter's manifest
  `finalStateHash` (the set's `startStateHash` for chapter 0) = the manifest's `chapter.startHash`, and its take id is the
  set's. Otherwise the clock stops and the panel shows "continuity ✗: chapter … starts from …, chapter … ended at …"
  instead of the swap.
- **Prefetch.** 300 ms after chapter k comes on screen, chapter k + 1 is fetched (fetch + JSON parse + the take's own
  hash check in one task, the render copy and log in the next). Chapters k − 1 … k + 1 stay parsed; the rest are dropped.
  If the clock reaches a chapter that is not loaded (a jump, or prefetch not done), it holds at the boundary
  ("Loading chapter D2…") and goes on when it is in.
- **Engine camera per chapter.** The camera is the chapter's own planned shot list (`camera` of its file), sampled at the
  local time plus the datum offset. The camera picker and Direct camera are not offered for a set (they act on one take).
- **Log on the set clock.** Every chapter's log (`takeLog(take, steps, { at: from·dt, clock })`) is on the set clock,
  including a merged wait's "until" (h:mm:ss.s). At D0's start the log still shows A's last lines. The Diagnostics totals
  cover the whole set once every chapter has been read (until then "(n / 7 chapters read)"). A+B totals: 0 violations,
  105 refused / failed, 769 blocked waits.
- **Whole-set checks (a worker).** `chapter-set.worker.ts` reads the chapters in order, one plus the previous at a time,
  and posts per chapter: its final state hashes to its recorded and manifest hash; its start = the previous chapter's
  final state (the three hashes above plus the engine's `chapterContinuity`: `entities0` = the previous final entities,
  first frame within ½ mm / ½ mrad, same phase / activity / level); its log. Then the final checks on the last chapter's
  replayed last frame: the final state = the set's `finalStateHash` (for the A+B: `year-build-b.test.ts` `PIN_FULL_AB`,
  which the spec reads), last frame = final state, and the engine's `compareToCanonical` (frames / beams) plus `compareB`
  (phase-B parts) against `yearBuildPlan(…, { phaseB: {} })` from the year file. It is a worker because the phase-B plan
  takes ≈ 2 s to build. Shown as:
  "✓ continuity: 7 / 7 chapter starts · ✓ final state ddb634d6… = A+B pin · last frame = final state (0.64 mm) ·
  ✓ 66 frames + beams + 145 parts at the mars-2022 canonical pose (≤ 1 cm, 1°; max 0.57 mm)". The 145 parts: 81 deck pieces,
  25 wall panels, 16 tread boards, 6 stringers, 6 posts, 2 handrails, 6 panel rails, 3 solar panels.
- **Hooks.** `__marsStudio.takeSet()`: set clock, chapter (`k`, `id`, `local`), loaded chapters, `waiting`, `error`,
  entities / rendered, shot, track, per-chapter checks and the final checks, boundary swaps. `takePerf()` adds `swaps`
  (chapter, wall ms of the swap redraw, set time) and `loads` (chapter, fetch + parse ms, render-copy ms).

**Measured (W37, headless Chromium + SwiftShader, 1280×800, `studio-build.spec.ts`).** Open to first frame: 0.4 s; the
worker's whole-set checks (7 chapters read, then the phase-B plan and the final comparisons): done 2.9 s after opening. 64× for 10 s from 384 take-s before the A → D0
seam (1 s warm-up): 17.7 fps, frame mean 56.8 / p95 66.7 / **max 66.8 ms**; the frames around the seam 50–66.7 ms; the
swap's own redraw 2.6 ms; D0 was prefetched (36 ms fetch + parse) and D1 prefetched inside the window (20 ms + 1 ms);
64.6 take-s per wall-s. Redraw mean 1.21 ms (sampleTake 0.34 ms).

### Prone receivers in a take (W37)

`TakePeople.show` hands the take's prone fields (mars-take/4, W32; recorded as discrete changes) to the renderer:
`proneYaw` integer mrad → rad, `phaseK` integer % → 0–1, into `SampledHuman`, which `humans.ts setFrame` passes to the
prone layer (W35). `e2e/studio-take-prone.spec.ts` records the lab `prone` preset with the engine's TakeRecorder and
replays it through `TakePeople` at every tick where p3 / p4 are prone (708 samples): the engine numbers the replay receives
equal the live lab's on every sample; the body turn is within 0.0005 rad; in prone-wait (574 samples) hips and head are
within 0.6 mm; lying down / reaching the rise is within 0.021. Getting up, the replay rises exactly on smooth(phaseK) while
the live body may wait for the load (live − replay ≤ 0.004, i.e. never ahead; behind by up to 0.79 at p4's kneel-up): the
replay is random access (no tick history), so it cannot know that the live layer waited. The torso pitch search likewise
lands differently without the previous tick's pose (up to 0.6 rad in lie-down / prone-reach, head up to 0.33 m).
Without the fields the replay was off by 0.35 rad in body turn in every prone-wait tick, the rise by up to 2.97.

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
Since mars-take/4, repeated identical waits are one line, and the totals count each wait (the /4 first
bay: 106 waits, whole skeleton: 242).

**W24 (`takeLog` in take-replay.ts).** A merged wait reads "(×n over d s, until m:ss.s)" in the log's own clock (it read
"until 1236.1 s" beside an m:ss clock). A wait of the same action with the same code and message that starts again
within 5 s of the previous one's end (a resume between them kept them apart in the take) folds into that line: the
whole skeleton's last two lines were "96:19 … a484 … m5 is waiting for m4 …" and "96:20 …" the same, now
"96:19 blocked · walk_to a484 waiting: traffic.yield — m5 is waiting for m4 to clear a single-file passage (×2 over 1.3 s,
until 96:20.5)". Whole skeleton 160 wait events → 154 lines; totals unchanged (flagship 57, bay 1 106, whole 242). A step
reads as its label; an unlabelled step or a sub-action as `verb id` (`walk_to a484`, `m6:make-way:62896`), a step id
that already names its verb as is (`s0539-leave-stance`).

The whole skeleton also shows **95 refused / failed**: 94 `reservation.conflict` + 1 `route.unreachable`, all ambient
make-way walks the engine submits for a person already reserved by a waiting step (`m6:make-way:62896 … actor:m6 is
already reserved by action step:s0294-climb-stance`). Every sequence step completes; known since W14 (PROGRESS). The
first bay has none.

### Final-frame checks (`take-checks.ts`)

- **Hash.** `hashOf(take.finalState)` must equal `take.finalStateHash` and the manifest's hash.
- **Last frame.** `sampleTake` at the last tick is compared with the recorded final state: every entity must be present
  and within 2 mm. 2022: 0.57 mm; flagship: 0.69 mm.
- **Canonical (year-build only).** The graph is `assemblyGraph(year, sceneFromYearFile(campus-<year>.json))`. The
  targets are the building's frames and beams that the take contains. The engine's own `compareToCanonical`
  (installed, upright, ≤ 1 cm, ≤ 1°) is run on the **replayed last frame**.
  - 2022 first bay: **✓ 24 / 24 at the mars-2022 canonical pose, max 0.2 mm / 0.02°**. The house's other 42 frames and
    beams are reported as "outside this take" (a tranche), never as failures.
  - 2022 whole skeleton (W24): **✓ 66 / 66, max 0.2 mm / 0.02°**, nothing outside; hash = recorded = manifest
    (`d382e461…`), last frame = final state within 0.57 mm.
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
- **Save track** (W24) writes the compiled directed track into the open take's file and offers that file as a download
  (below, "Where a saved track goes").
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

### Camera picker and saved tracks (W24)

A take file may carry extra tracks beside its planned `camera` (`cameras: { id: CameraTrack }`, CAMERA_DIRECT.md §8.2).
- **Read.** `TakeReplayFile.cameras?` is typed; `loadTakeFile` runs `fileCameras(f)`, so a malformed track or one of
  another take refuses the file. The replay bar's **Camera** picker (beside Engine camera) lists the planned track, then
  every `cameras` entry in id order (`fileCameras`), each as `kind · id · n shots` ("planned · cam-bb4b6990b0c93c33 ·
  10 shots", "directed · dir-3c000e40cf0b · 2 shots"), then a directed track compiled on this page and not yet saved
  ("… · unsaved"). Choosing one plays it exactly as the planned camera: `fileCamera` → `trackData` → `sampleTrack` per
  frame, plus the datum offset. A directed track starts at its first shot.
- **Where a saved track goes.** Save track → `withFileCamera(file, { id, takeId, kind: 'directed', data })` (checked:
  the take's own id, not the planned camera's id; the take and the planned camera untouched) → a JSON download named
  like the shipped file (`flagship-campus-2026.json`). The browser cannot write `public/`, so the owner puts the file
  into `public/engine/takes/`; the recorder keeps its `cameras` across a re-record of the same take id and drops them
  (with a log line) when the take changes. The open replay carries the track from then on (the picker lists it as
  saved). The downloaded file is the shipped file byte-for-byte plus `cameras` (tested).
- **Not posted to a room.** The controller's ops are `get_take`, `attach_camera_track` (a shot spec, planned in the
  room) and `direct_camera` (directions, compiled in the room), all for a take the room holds. None stores a precomputed
  track or a take file, and the public takes are not in any room, so Save track is download-only even with `wrangler
  dev` up; the panel says so. A room that held the take would store the same direction with `direct_camera`.
- **Verify.** The hook's `verifyCamera(from, to, hz, { track: { file: id } })` resolves the track through `fileCamera`.
  The saved directed track verifies sample-for-sample like the in-page one (`studio-direct.spec.ts` "save track").

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
  - `verifyCamera(from, to, hz, { track: 'take'|'directed'|'year'|{ file: id } })` (`{ file }`: W24);
  - `cameras()`, `useCamera(id)` (the Camera picker), `takePerf(reset?)` (redraw timing) — W24;
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
- **Direction in the studio compiles in the page.** The directed track lives in the page until **Save track** puts it
  into a downloaded copy of the take file; shipping it is a manual copy into `public/engine/takes/` (W24).
- **A reach-down from a frame stance misses by ~1 m.** Whole skeleton, t 2682.3 s, m5 standing on a frame at 3.01 m
  (`reach_up`, taking the top beam handed up through the relay): the recorded right hand is 0.38 m *below* the feet
  and 0.75 m to the side; the rendered palm is 1.025 m from it (arm posing, `humans.ts`). The other 11 sampled hand
  moments are within 0 mm, so the spec's median criterion passes. Not fixed here (not a studio file).
- **Unbound step labels.** Some whole-skeleton step labels are template text (`$crew[0] steps out of the aisle`); the log
  shows them as recorded (recorder / sequence side).
- **Chiba verify is weak evidence.** A static subject's focus points lie on its own bounding-box face (3 per sample).
  The render check therefore only sees occlusion by *other* meshes, never the facade itself. Chiba's 1.0 / 1.0 says
  nothing blocks the view, not that the frame shows Chiba well.
- **Corrected hold, foreground.** The +1 m raise passes phase 2's foreground rule, and the render agrees on readability.
  But the capture at 4 s (`studio-direct-playing.png`) still shows a bystander's head large in the lower centre of the
  frame. The rule measures cover of the subject's frame region and accepts a bystander who is big in the frame without
  covering the crew's points.
- **Chapter sets (W37).** (1) The gait phase restarts at a seam for anyone walking across it: each chapter's walked
  distance starts at 0 (a one-frame leg-phase jump; seams are plan barriers, so the crew is normally standing). (2) The
  option's chapter words come from a head-noun rule tuned on the A+B labels; another set's labels may read less well.
  (3) Direct camera and the camera picker are off for a set. (4) A jump into a chapter not yet parsed keeps the old frame
  for the fetch (≈ 20–40 ms here); on a slow network the clock would hold at the seam ("Loading chapter …"). (5) The
  captures are with the panel open: it covers the lower ≈ 20 % of the engine camera's frame (the D2 relay's giver on the
  first-floor deck is at the panel's top edge).
- **Worst-sample captures of take-less tracks** use the orbit camera at the sample's pose with the studio fov, not the
  track fov.

## 6. Whole skeleton at 64× (W24)

`studio-build.spec.ts` "at 64×": each year-build take plays at 64× for 10 s from 40 % of its length, engine camera on,
headless Chromium + SwiftShader (software WebGL) at 1280×800. `redraw` = `TakeReplay.perf()`: `pose` is the whole
`TakePeople.show` (sampleTake + posing people, parts and piles), `sample` is `sampleTake` alone; rendering is not in it.

| take | ticks / entities | fps | frame mean / p95 / max (ms) | take-s per wall-s | redraw mean / max (ms) | sampleTake mean / max (ms) |
| --- | --- | --- | --- | --- | --- | --- |
| first bay | 41 317 / 40 | 19.6 | 51.1 / 66.7 / 83.3 | 64.5 | 1.44 / 2.3 | 0.15 / 0.3 |
| whole skeleton | 117 277 / 82 | 19.8 | 50.8 / 66.7 / 83.3 | 64.6 | 1.38 / 2.1 | 0.24 / 0.4 |
| whole skeleton, loaded machine (load avg ≈ 12) | | 13.8 | 73.1 / 266.7 / 516.7 | 50.6 | 1.44 / 2.5 | 0.25 / 0.4 |

Node, the same stepping (64 / 60 s per call, 2 000 calls): `sampleTake` 0.066 ms mean on the first bay, 0.144 ms on the
whole skeleton — it grows with the entity count (binary search per field), not with the take's length. **No per-tick
cache**: the redraw is ≈ 3 % of a SwiftShader frame, and at 64× every frame is a new tick (≈ 21 ticks apart), so a cache
of the visible window would never hit. The studio loop clamps dt to 0.1 s, so frames slower than 100 ms play below 64×
(the loaded run: 50.6×); on the 50 ms SwiftShader frames the take keeps 64×. Frame stalls on the loaded run came with
unchanged redraw times, i.e. rendering / CPU contention, not the replay.

Captures looked at (W24): `studio-build-east-house-yard.png` (the establishing shot: ten piles, the cutting station, the
crew of six, the other three 2022 houses, the east-house hidden), `-mid.png` (48:52: part of the skeleton standing, the
crew at the frames, two blocked-wait lines), `-final.png` (97:43: all twelve frames with beams, emptied pallets, "✓ 66 /
66 frames + beams"). The lab's year-build presets have the same yard framing as an **Oblique yard** button
(LAB_GUIDE-level detail in `app/lab/year-build.ts`: the establishing spec evaluated with `evaluateShot`, equal to the
take's first camera sample).

