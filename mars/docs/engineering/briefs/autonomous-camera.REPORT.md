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
