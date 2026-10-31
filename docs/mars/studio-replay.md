# Studio replay

The `/studio/<year>` page replays recorded takes, plays long builds as chapter sets, and directs the camera over a take.
Code: `mars/viewer/app/studio/{take-panel.tsx, take-host.ts, take-checks.ts, chapter-set.ts, chapter-set.worker.ts,
chapter-panel.tsx, direct-panel.tsx, direct-camera*.ts, camera-verify.ts}`, `app/engine-view/take-replay.ts`. Specs:
`e2e/studio-take.spec.ts`, `studio-build.spec.ts`, `studio-direct*.spec.ts`, `camera-verify.spec.ts`.

## Take picker (manifest-driven)

The studio lists every entry of `public/engine/takes/manifest.json` whose `year` matches, in manifest order; no take id or
file name appears in code. **Replay take** lists all; **Watch it being built** lists build takes and chapter sets.

| Manifest field | Use |
| --- | --- |
| `id`, `file` | option value; the `mars-take-replay/1` file to fetch |
| `label`, `year`, `hypothetical` | option text and the banner (hypothetical scenario vs recorded state) |
| `ticks`, `duration`, `entities`, `moments` | option text, scrubber, readout, moment markers |
| `finalStateHash` | final-frame check |
| `kind` | `'year-build'`, `'year-build-chapter'`; inferred from `rulesVersion` when absent |
| `chapter` | `{ of, index, id, startsFrom, startHash }` for a chapter of a set |
| `cameras` | ids of extra tracks the file carries |

`chapterSets[i]` = `{ id, label, year, hypothetical, kind: 'year-build-chapters', duration, ticks, startStateHash,
finalStateHash, planHash, rulesVersion, … }`; the set id is `hashOf({ set, takes })`.

## Take host

`createTakeHost(scene, { year, … })` opens a take:

1. **Datum**: `offsetY = campus-<year>.json groundY − file.site.groundY`, applied to a shifted render copy of the take (not
   by moving the group, since the arm solvers mix bone world positions with engine targets). Hashes, the sampler and
   checks use the original take.
2. **Hide the rebuilt building** for a build fork (`base.campus = mars-<year>:build:<assembly>`), so the replay starts from
   the empty site.
3. Ambient people are hidden; fixtures (piles, bundles, benches, campfires) render with `contents` as of t.
4. Hands come from `sampleTake(...).hands` (metres, interpolated).

Speeds 0.5–64×; time is random access, so speed and camera never change what is drawn at t.

**Log.** `take.events` supply blocked waits, failures and violations; the newest lines show on the bar, the rest in a
Diagnostics drop-down with whole-take totals. Merged waits read "(×n over d s, until m:ss.s)".

**Final-frame checks** (`take-checks.ts`): `hashOf(take.finalState)` equals the take's and the manifest's hash; the
sampled last frame matches the recorded final state within 2 mm; for build takes, the engine's `compareToCanonical` runs on
the replayed last frame against the year file's assembly graph (≤ 1 cm, ≤ 1°), and parts outside the take are reported,
not failed.

## Chapter sets

One run cut into consecutive chapter takes ([construction.md](construction.md#generated-builds-from-material-piles)) plays
as one entry on one set clock.

- Set time T maps to chapter k with `from·dt ≤ T < to·dt`. A chapter bar under the scrubber jumps to chapter starts and
  shows a continuity mark per seam.
- One `TakePeople` draws the whole set; at a boundary the next chapter's take is swapped in with `setTake` (its first frame
  is the previous final state with the same ids, so no mesh is rebuilt).
- A chapter is used only if its `baselineStateHash` equals the previous chapter's `finalStateHash` and the manifest's
  `chapter.startHash`; otherwise the clock stops with "continuity ✗".
- The next chapter is prefetched; a jump to an unloaded chapter holds at the boundary until it loads.
- Each chapter uses its own planned camera. At high speed each shot is held for at least `HOLD_S` = 1.5 wall seconds while
  the world keeps its speed. Walk-cycle offsets carry across seams.
- `chapter-set.worker.ts` checks every chapter start against the previous final state (`chapterContinuity`), the last
  frame against the set's final hash, and the canonical comparison (frames, beams, and the deck, stair, wall and solar parts).

## Direct camera

The replay bar's **Direct camera** panel has a form that writes one typed `CameraDirection`
([camera-direction.md](camera-direction.md)), a **Say it** box that parses sentences, an editable JSON list, **Compute
camera**, and a result list (per shot: subject, readability, self-correction verdict and corrections, or the refusal with
candidates). **Play directed track** switches the engine camera to it; the take, its hash and poses are untouched.
Compilation runs in a worker for file takes (`direct-camera.worker.ts`).

**Camera picker and saved tracks.** The picker lists the planned track, then the file's `cameras` entries in id order, then
an unsaved directed track. **Save track** writes `withFileCamera(file, track)` into a downloaded copy of the take file
(byte-identical apart from `cameras`); the browser cannot write `public/`, so shipping it means copying that file into
`public/engine/takes/`. The recorder keeps a file's `cameras` across a re-record of the same take id and drops them when
the take changes.

## Verifying directed tracks

`verifyCamera(scene, replay | null, { track, trackId, sampler, offsetY })` verifies a directed or take-less track against
the render ([camera-direction.md](camera-direction.md#render-side-verification)). Subject points come from the take sampler,
or from the track's recorded `data.subjects` for static subjects. Rays are cast in scene coordinates; framing and size stay
in take coordinates.

Test hooks on `window.__marsStudio`: `take()`, `takeSet()`, `takePerf()`, `verifyCamera(from, to, hz, { track })`,
`cameras()`, `useCamera(id)`, `direct(directions)`, `playDirected(on)`, `directOnYear(directions, opts)`, `palm(id, hand)`,
`visiblePeople()`.

## Approximations

- A build take renders 0.16 m below the scene's own racks (the datum offset): feet-true, not rack-true.
- Build takes use the recorder's planned shot list; a directed track can be computed instead.
- A static subject's focus points lie on its own bounding-box face, so verification sees occlusion by other meshes only.
- The foreground rule measures cover of the subject's frame region; a bystander can be large in frame without covering
  the subject's points.
