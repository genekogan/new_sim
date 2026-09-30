# Autonomous camera progress — 2026-09-29

## Status and ownership

Implemented on `codex/autonomous-camera` in
`<mars-worktrees>/autonomous-camera`. Rebased onto `a4078c6`.
Core checkpoint `edc45f0`, provider `a3f980e`, review/capture `5649493`; authorized owner hook `d98d9e5` cherry-picked as
`e1e47c6`. No pushes, remotes, dependency changes, baseline changes or historical
content edits. The engine chat owns shared entrypoints, combined gate and release.
Camera helpers: zero. Ports: 5593 review, 5591 tests, 7393 optional bounded bridge.

Implemented: yes. Runtime frame review: yes. Focused tests: yes.
Combined full gate, integration and release: pending the engine owner.
Standalone HTML review pages currently run only through local Vite.

## Behavior and limits

Causal read-only observation, semantic direction, physical execution, presentation,
operator override and asynchronous provider are separate camera modules. Existing
shot synthesis, candidate search, placement/readability and native TakePeople are
reused. EUC and existing camera machinery are untouched.

Clear coverage uses 4-second minimum holds and prefers current focus; restrained
coverage uses 9-second holds and prefers conversational/context views. Feasible
vocabulary includes establishing, speaker, speaker/display, questioner, two-person,
individual follow and context. Group framing tracks its members. Physical safety
and visibility are separate checks. Unsafe sweeps become explicit cuts. Recovery
cuts restart hold timing. Stillness is supported.

Valid manual pose takes precedence over subject/shot/policy/movement steering,
which takes precedence over auto. Safety can veto any pose. Native pointer/wheel
controls retain ownership during use, then hold for six simulation seconds; Escape
or Return auto releases immediately. Subject steering defaults to five simulation
seconds. State, session and operator epochs reject obsolete model replies.

Live adapter currently supports classroom-4 and classroom-8; classroom-4 has
runtime/browser evidence. Other scenarios show a named unsupported limitation.
The owner’s immutable live geometry/FOV/scenarioEpoch hooks are consumed. Older
released hooks retain a visibly labeled fixed-furniture adapter. Conversation
public-floor hooks are forthcoming from the owner; no parallel activity model.

## Runtime footage and observed quality

All MP4s are actual Three.js runtime recordings, local and ignored. Baseline is
46 seconds; live directed footage includes a question, subject takeover and return,
guest departure and presenter rotation. Frame review spans each entire clip and
transitions. The baseline is wide and unresponsive. Directed questioner coverage
is legible; restrained coverage is calmer but speakers are smaller. Rear views of
moving presenters remain awkward. Recorded head attention is unsupported by
TakePeople and labeled. No visual claim of a finished classroom or Jev benefit.

A 70-second actual engine take drives both policies with the same causal
observations and no lookahead. A camera-owned synthetic partition at 58–64 seconds
is rendered and scored, but absent from authoritative simulation. This demonstrates
camera occlusion handling, not live engine furniture editing. World hash stays
unchanged during filming and the take reports zero invariant violations.

Artifact roots under `viewer/e2e/artifacts/`:
- `codex-autonomous-camera-baseline/review.mp4`: initial live baseline.
- `codex-autonomous-camera-clear-v3/review.mp4`: earlier live directed milestone.
- `codex-autonomous-camera-clear-final/review.mp4`: final live checkpoint capture.
- `codex-autonomous-camera-replay-clear/review.mp4` and
  `codex-autonomous-camera-replay-restrained/review.mp4`: same recorded world.
- `codex-autonomous-camera-comparison/sequence.json`: take, causal observations,
  both camera tracks, decisions, interventions, hash and source provenance.
- `codex-autonomous-camera-comparison/jev-evaluation.json`: bounded provider result.

Failed proof is retained: initial directed framing exposed disappearing held
candidates and seated occlusion; clear-v2 had an invalid capture-policy label;
one restrained recording aborted during source HMR. Those are not success proof.

Reproduce from viewer with own Vite on 5593:
```sh
node cinematography/record-comparison.ts
node cinematography/capture-replay.mjs clear
node cinematography/capture-replay.mjs restrained
node cinematography/capture.mjs clear-final
```
Do not change imported source during capture. Logs/proofs include branch/commit;
resolved camera frames replay without model calls. Videos contain labels.

## TypeSafe result

Official API/model/Choice docs verified before implementation:
https://docs.typesafe.ai/api and https://docs.typesafe.ai/models.
Pinned `jev-1.13.0`, input $0.042/million tokens, output free.
12 calls used 19,881 input tokens, measured $0.000835002;
latency 172.57–518.34 ms. Mostly HOLD, with one question choosing pair over local
medium. This is a bounded causal fixture evaluation, not live Jev footage or proof
of visual superiority. No further paid calls while Gene’s sustained ceiling is pending.

Provider selects feasible IDs or HOLD, never coordinates. Requests are event-driven,
at most 1 Hz and single-flight. Timeout/failure/invalid/stale choices fall back while
world/render continue. Default bridge is loopback only, 12 calls/$0.01 conservative
reservations, exact local origin, server-only environment loading. Credentials never
enter browser, logs, captures or commits. Unknown billed outcomes reserve worst case.

## Validation

Pre-rebase full engine: 605 total, 588 pass, zero fail, 6 skip, 11 TODO (75.0 s).
19 focused offline tests now cover geometry, swept walls, occlusion, minimum holds,
manual precedence/expiry/stillness, stale/invalid replies, API timeout/failure,
cleanup, replay cuts, recovery holds, and provider accounting/reservations.
Rebased full engine: 622 total, 605 pass, zero fail, 6 skip, 11 TODO (59.1 s). Final camera browser recheck: 1/1 (8.0 s).
Repo and explicit camera typechecks pass. Scoped camera and repo lint pass.
Browser camera + owner hook tests: 2/2 (12.1 s), including native manual drag,
world hash preservation, mock API failure, return to auto, questioner, same-tick
paused reset, live geometry, FOV validation and disposal.
Earlier live clear-v3 overhead: 321 updates at about 10 Hz, mean 0.823 ms,
p95 1.1 ms, max 8.6 ms under concurrent load. This is functional measurement,
not the owner’s idle-host release benchmark. No guarantees/tests loosened.

## Final footage checkpoint

Captured unchanged committed source `56494933afd8c5da1bbb1ccc7d05dc267ff720ff`.
Final live clear MP4: 47.36 seconds, no page errors or camera diagnostics.
355 camera updates, mean 0.983 ms, p95 1.2 ms, max 8.9 ms. Stable presenter,
questioner, explicit guest2 takeover, auto return and departure/presenter-change
wide view. Reviewed whole-clip frames and quarter-second samples around the cut.

Recorded policy outputs: clear 6 cuts, restrained 5 cuts, including each policy’s
explicit visibility recovery cut at 58.05 seconds to an elevated alternate.
Recovery preserves head/chest visibility; the foreground partition still obscures
lower bodies and dominates the composition. The point-based readability score
does not promise full-body visibility. This is a visible limitation, retained in
the footage rather than hidden. The camera never moves actors or architecture.

`clear-final/before-after.mp4` puts the initial live baseline on the left and final
live clear coverage on the right. They are separate live executions with the same
intervention script, not identical-world replay. Reproduce with ffmpeg hstack,
scaling both 1280×800 source clips to 640×400 and using the shorter duration.
The recorded policy clips share the exact same final take. Earlier Jev evaluation
used the prior causal fixture checkpoint and retained all request/candidate states
in its report; no later paid rerun or matching final visual model comparison is claimed.

The owner acknowledged all three camera commits and will select them onto their
social/hooks candidate, review production entry wiring and run the combined gate.
No camera release has occurred.

Production-entry preparation requested by owner: viewport/noindex metadata,
truthful prototype label, classroom-8 query selection, and Jev hidden/disabled
unless localhost/127.0.0.1:5593. Review entry plus live intervention browser tests
pass 2/2 (10.2 s), both typechecks pass. Replay page remains local-only.
Ignored `comparison/review-manifest.json` records absolute clip paths, SHA256,
durations, source commit, inspection method and before/after ffmpeg command.

## Bounded integration review corrections

Engine-owner review found paused control invalidation, fixed 16:9 assumptions,
and synchronous provider throws. Corrected all three within camera-owned paths:
- Subject takeover/Return auto mark the adapter dirty even without a world tick.
- Actual canvas aspect flows through causal observation/fingerprint, synthesis,
  candidate scoring and smooth execution. Supported aspect 0.25–4; other values
  give a named limitation. Recorded camera fixtures default explicitly to 16:9.
- Provider invocation enters a Promise boundary, validates reply shape, clears
  timers/busy on errors, avoids sending after disposal and bounds accounting.

The additive presenter field also identifies the true presenter/questioner pair
when the new public floor belongs to the questioner. Conversation-group floors
remain outside this classroom adapter’s supported scope. Agreed engine APIs are
frozen: scenarioEpoch, immutable cameraGeometry, render camera with optional FOV.

22 focused offline tests pass. Browser entry and live tests pass 2/2 (10.2 s),
including takeover and Return auto on an unchanged paused tick and a genuinely
portrait render canvas. First portrait test assumed the mobile browser layout
produced portrait; it did not, and the test was corrected after measuring canvas
dimensions. Failure trace remains local. Portrait questioner screenshot inspected.
Both typechecks and scoped/repo lint pass. Full engine recheck and new MP4 follow.

Gene’s direction: camera readiness does not block playable engine milestones.
Owner is releasing engine-only improvements separately; reviewed camera commits
will integrate at a convenient green boundary. No additional integration scope.

## Correction checkpoint proof

Corrected live runtime capture at `228b30b715f1015145a2dc4d222f2c1090f99671`:
`viewer/e2e/artifacts/codex-autonomous-camera-clear-aspect/review.mp4`, 47.24 s,
zero browser errors and camera diagnostics. 364 updates, mean 0.971 ms,
p95 1.2 ms, max 12.6 ms. Actual canvas aspect 1.15 (the HUD consumes width),
not the browser’s 1.6. Whole-clip frames and quarter-second cut samples inspected.
Presenter/questioner/guest2 takeover/return/departure holds remain legible.
`clear-aspect/before-after.mp4` compares prior director on left with corrected
framing on right, using separate live executions. Portrait screenshot is in
`codex-autonomous-camera-review-fixes/portrait-questioner.png`.

Full engine correction gate: 625 total, 608 pass, zero fail, 6 skip, 11 TODO
(70.55 s); 22 focused pass; browser 2/2; both typechecks and both lint scopes pass.
A final nonvisual guard suppresses provider requests when no feasible candidates
exist or aspect is unsupported; no API is consulted to repair an infeasible view.
This guard does not change the supported-scene footage. Its final full engine recheck also passes: 608/625, zero failures (61.89 s), with the same 6 skips and 11 TODOs.

No camera integration/release yet. Engine owner has reviewed additive checkpoint
commits and retains the frozen interface/next green-boundary integration decision.
Local review remains on http://127.0.0.1:5593/cinematography/review.html.
No further paid calls; no camera helpers; no changes to engine release sequencing.

## Autonomous camera next — varied suite baseline

Reviewed handoff branch `codex/autonomous-camera` remains at a6cc661. Further
work is on `codex/autonomous-camera-next`, same dedicated worktree/ports, rebased
onto independent engine release16. No engine/shared entrypoint edits.

Six actual engine takes: classroom presentation/questions/rotation, classroom
conversation groups/public floors, Lab wall-avoidance walk, actual work_at
workstation, Lab campfire simultaneous activities, classroom with camera-only
partition and operator override. Policies share identical takes/world hashes; all
six runs have zero invariant violations and no failed actions. Visitor approaches
conversation vicinity (not formal admission); concurrent speaker/attention cues
are explicitly camera-owned because standalone Lab lacks public floor readout.
No riding, live Jev or restored replay head attention claim.

New continuous policy holds one followed subject through unrelated speaker
changes, with safety recovery/manual controls retained. Camera observation adds
derived fixture target points for workstation framing; no object task mutation.
New suite-record.ts, capture-suite.mjs and local app/camera-lab/suite.* produce a
90-second two-view reel with six uninterrupted 15-second passages. Baseline source
has fixed room-side angles and weak foreground composition; preserve it before
front-angle corrections for same-take comparison.

24 focused camera tests; full engine643 total,626 pass,zero fail,6skip11TODO
(63.1s). Repo/camera typechecks and scoped lint pass. An initial uncommitted capture
was interrupted by my formatting-triggered HMR and stalled at the initial world
time; failed WebM/frame retained, not success proof. Capture tooling now saves
failed proof as well; source will remain fixed during the committed rerun.
Engine-owner release17 idle measurement respected; no helpers/API calls.

## 2026-09-29 evening — varied footage and facing/framing checkpoint

The integration owner confirms reviewed camera checkpoint a6cc661 is integrated
and released in release17 (source d04271d). This subsequent work is independently
implemented and tested on `codex/autonomous-camera-next`; it is not yet integrated
or released. Handoff branch remains unchanged. Base/merge-base is ab85a15, with
new commits 4979de7 (six-scenario suite/continuous policy), 2831418 (reel clock and
seek fix), 2591b9e (facing/framing/continuous handoff). No shared entrypoints or
engine modules changed; no interface dependency, additional helper or paid call.

Changes: `suite-record.ts` uses actual registered engine activities and Lab
scenarios; `app/camera-lab/suite.*` and `capture-suite.mjs` render and capture six
sustained 15-second passages with policy labels. Observation derives fixture
points for object framing. `composition.ts` scores body facing and foreground
architecture; `shots.ts` uses front-relative edited angles, tighter framing and
cached composition scores over feasible candidates. Clear conversation covers
the public floor; restrained holds pairs. Continuous uses the existing subject
relative follow evaluator, retains its autonomous subject through unrelated
focus changes, and restores it after operator expiry/release. A conversation
membership change no longer bypasses minimum hold if the prior shot is feasible.
Capture tooling now logs the actual branch. Browser suite generates its own
ignored fixture data instead of depending on previously captured artifacts.

Commands from viewer on the rebased branch:

- `npm run test:engine`: 692 total, 675 pass, zero fail, 6 skip, 11 TODO; 62.17s.
- `node --test cinematography/camera.test.ts`:27/27 pass; 0.23s.
- `npm run typecheck`: pass.
- `npx tsc --noEmit --target es2022 --module esnext --moduleResolution bundler --allowImportingTsExtensions --skipLibCheck --strict --jsx react-jsx --types node cinematography/*.ts`: pass.
- `npx oxlint cinematography app/camera-lab`: pass.
- `E2E_VITE_PORT=5591 E2E_RUN=codex-autonomous-camera-front-portable PLAYWRIGHT_BROWSERS_PATH=.pw-browsers npx playwright test -c e2e/playwright.config.ts e2e/autonomous-camera.spec.ts --workers=1`:3/3 pass; 41.3s,including fixture generation.
All pinned tests pass unchanged. An attempted standalone NodeNext/non-strict
compiler invocation was inappropriate for the repo's bundler/TSX configuration;
its configuration errors were corrected by the explicit command above. No source
or assertions were weakened. Release full gate belongs to integration owner.

Actual runtime MP4s under this worktree's ignored viewer/e2e/artifacts:

- `codex-autonomous-camera-varied-baseline/review.mp4`:92.48s;source15f5726.
- `codex-autonomous-camera-varied-front/review.mp4`:92.68s;source2591b9e.
- `codex-autonomous-camera-clear-front-live/review.mp4`:48.28s;source2591b9e.
- `codex-autonomous-camera-varied-front/before-after.mp4`: before above, after
  below; same takes with explicitly approximate playback-clock alignment.
Each original clip includes scenario,policy,live/replay,branch/commit and defects.
`review-manifest.json`, `suite.json`, proof/decision logs and filmstrips preserve
provenance. Reproduce with `node cinematography/suite-record.ts`, camera-owned
Vite 5593, `node cinematography/capture-suite.mjs varied-front`, and
`node cinematography/capture.mjs clear-front-live`. Keep source unchanged during
capture. Baseline is archived before replacing generated suite data. Six world
hashes AND full take JSON match exactly across baseline/revised policies; all
six runs have zero invariant violations and no failed actions.

Inspection covered the entire decoded MP4 durations via filmstrips, plus dense
2 Hz conversation/walking transitions and 1 Hz operator transitions. Compared to
baseline, faces are larger and generally front-on, conversation attention is
legible, the workstation has a sustained worker/object view, simultaneous
activity shifts from gathering to conversation, and the partition no longer
hides most of the presenter. Continuous and clear walking now visibly differ:
route view from behind versus front coverage. Operator takeover lasts four
seconds in the fixture and continuous returns to its original subject, which
baseline failed to do. Safety-driven cuts around the wall remain explicit;
there is no fly-through-wall interpolation or hidden architecture.

The live Lab clip independently shows a real-time question, guest2 takeover,
autonomous return, departure and presenter rotation. Zero browser errors or
camera diagnostics. Measured 352 camera updates: mean 1.64 ms, p95 2.0 ms, max 14.5 ms,
capped around 10 Hz. This is camera update overhead, not a full render-performance
regression proof. It exceeds the prior clip's mean 0.97 ms; cached scoring avoids
repeated raycasts during sorting, but denser scenes still need measurement.

Defects retained in footage: conversation partners' heads can crowd the lower
frame; group context remains wide; walking recovery can cut abruptly; workstation
screen content is not always legible. Body-facing proxy is not a perceptual
quality metric, and replay still does not restore head attention. No riding
proof. Visitor approaches the group vicinity, not formal membership admission.
Simultaneous activity floor/attention annotations are explicitly camera-owned
fixtures; actor activities themselves are actual engine actions. Jev remains
optional/off because comparative footage has not established a benefit.

Two earlier failed captures remain preserved: HMR interrupted the first; the
second startup clock selected a negative scenario index. `failed-clock.mp4` and
failed proof are failure records, not successful demos. The clock/seek browser
regression and stable committed-source recording corrected both issues.

Next bounded outcome: reduce foreground human crowding and abrupt reframing
without weakening placement/readability or expanding the interface. Estimate
2–4 active hours for that polish/footage batch, assuming existing scenarios and
frozen hooks; no estimate of universal camera completion. No engine blocker.
This checkpoint used roughly 45 minutes of active development/verification after
the previous suite setup; approximate token accounting is unavailable.

## 2026-09-29 — production tour packaging

Engine owner requested this bounded packaging for Gene's bleeding-edge combined
checkpoint. `codex/autonomous-camera-next` remains frozen at c1c9b11; this separate
`codex/autonomous-camera-tour` commit changes only camera-owned files. Base remains
ab85a15. No helpers, paid calls, new policies or MP4 generation.

Replay loads `/camera-demo/suite.json`, has visible scenario/Play/Pause/Restart
controls and direct `?case=` selection. Scenario changes pause/reset and dispose
old scene resources. Abort-based cleanup removes control listeners and disables
controls. Responsive layout keeps controls separate on narrow screens. Missing
public data produces an explicit unavailable message. Labels retain recorded
REPLAY, world-time/provenance, fixture notes and defects; workstation caption now
names the actual registered work_at action. Live review adds Continuous following
alongside clear/restrained; source policy behavior is unchanged.

Camera browser 3/3 pass (28.2s), including actual public URL loading, active-clock
pause, restart, scenario change/play, and continuous controller replacement on
classroom8. New screenshot production-tour-controls.png in ignored
codex-autonomous-camera-tour-final was inspected: controls and both policy panels
are legible. Repo/explicit camera TSc and scoped lint pass. Full engine unchanged:
692 total/675 pass/zero fail/6skip/11TODO (74.64s); all pins unchanged. Initial
selector test raced controller replacement; wait now requires its first new
continuous frame before the existing classroom8 membership assertion.

Fresh e2e calls the owner's deploy/prepare-camera-demo.mjs when present; isolated
camera branches use an explicit legacy recorder/copy fallback because that shared
build file does not exist here. No browser request mocking. The owner packages
Vite HTML input, generator, ignored public data, release staging and shared tour
links; no tracked large data. Combined gate, production verification and release
remain theirs. Camera packaging is locally implemented/inspected/tested, not yet
integrated/released. Existing footage/policy defects from the preceding checkpoint
remain applicable. No shared-interface blocker. Roughly 15 minutes for this batch;
remaining production work is the owner's combined gate/staging/deployment.

## 2026-09-30 — final documentation and session retirement

Gene asked for an extensive future-agent handoff and retirement of this session.
Reviewed camera code through bf24353 is now integrated and production-verified in
release18, source b2928ef, version4e77562e-9dc4-4f76-890b-22bc188d8ed7. Historical
branch-only status paragraphs above remain chronological evidence; the rewritten
brief is the current authority. Production tour and compiled live entry were
verified by integration owner. Broader live scenarios and Jev superiority are not
claimed; replay/fixture limitations remain explicit.

Documentation-only branch codex/autonomous-camera-handoff, base/merge-base3e444e7.
Rewrote autonomous-camera.md as complete resume/architecture/ownership/contracts/
policies/precedence/safety/async/replay/evidence/build/runbook/validation/backlog/
open-questions/retirement handoff. Added viewer/cinematography/README.md pointing to
it and this REPORT. No implementation, fixtures, pins, release code, historical
content, shared roadmap or API changes. No helpers, paid calls or new videos.

After rebasing on current main, npm run test:engine:762 total,745 pass,0 fail,
6 skip,11 TODO (68.67s); npm run typecheck and npx tsc --noEmit -p
cinematography/tsconfig.json pass. Markdown relative links and diff checked. No
browser rerun was needed for documentation-only changes. All pinned tests pass
unchanged. Captures referenced in handoff were previously inspected; preserved
ignored MP4/proof/log directories remain in the dedicated camera checkout.

Only camera-owned Vite5593 process37901 was verified by listener and cwd for
shutdown; no other servers/ports/worktrees will be touched. Worktree/artifacts
are preserved, not archived/deleted. Completed review helper has no active work.
Documentation commit is sent to integration owner for main inclusion without a
production release dependency. Future camera development or paid experiments
resume only when Gene asks; all remaining work is in the explicit brief backlog.
