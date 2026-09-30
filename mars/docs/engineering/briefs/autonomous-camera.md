# Autonomous camera — durable handoff

Updated 2026-09-30, America/New_York. Gene requested documentation and retirement
of the original camera session. **This is the camera workstream's resume entry.**
It replaces the initial planning brief; the chronological
[REPORT](autonomous-camera.REPORT.md) preserves development evidence and failures.
Historical report paragraphs saying “not integrated/released” describe their date,
not the current checkpoint. Do not infer completion of the entire product goal.

## Current checkpoint and how to resume

Reviewed code through `bf24353` is integrated and verified live in **release 18**,
source `b2928ef`, deployment `4e77562e-9dc4-4f76-890b-22bc188d8ed7`.
The integration owner reported full GREEN: 99 unit passes, 745 engine passes (762 total) with zero failures,
6 skips/11 TODOs, 103 browser passes/7 skips, both typechecks/lint, unchanged
probe/take/tools and original idle-performance limits. This is release evidence,
not a claim that every camera scenario is supported live.

Production: https://mars-campus-2026.<workers-subdomain>.workers.dev

- `/lab?scenario=classroom-4` or `classroom-8`: live authoritative engine with
  optional clear/restrained camera controls and manual takeover/return.
- `/cinematography/review.html`: compiled live iframe review with clear,
  restrained and continuous selectors; `?scenario=classroom-8` selects eight.
- `/app/camera-lab/suite.html`: recorded six-scene comparison, visible scenario,
  Play/Pause/Restart controls. `?case=walking` (or another ID below) selects one.
- `/camera-demo/suite.json`: generated recorded demo asset; not a live world API.

Resume from the latest main, not blindly from the old experimental branch. Before
coding, read repository AGENTS.md, engineering HANDOFF, SIMULATION_VISION,
ACTIVE_ROADMAP, ENGINE_GUIDE, CODEX, CAMERA, CAMERA_DIRECT, CAMERA_VERIFY and release
instructions. Inspect current branches/worktrees, unreleased camera work, ownership
and ports. Reconfirm what changed since release 18. Start by watching the actual
MP4s below, then select one concrete visible defect and preserve a before clip.

Repository: `<mars-campus-repo>`.
Preserved camera checkout: `<mars-worktrees>/autonomous-camera`.
Original handoff branch `codex/autonomous-camera` stays at `a6cc661`; subsequent
frozen reviewed branch `codex/autonomous-camera-next` stays at `c1c9b11`.
Packaging originally `codex/autonomous-camera-tour`/`bf24353`; retirement docs use
`codex/autonomous-camera-handoff`, rebased on `3e444e7` before documentation.
Hashes in old clips may be pre-rebase commits; provenance records their source.
Do not delete/archive this checkout without preserving ignored captures and logs.
A future agent can reuse it if free, or create a dedicated worktree via CODEX recipe.

No camera helpers or paid loops are active at handoff. Historical review helper is
completed. Coordinate the project-wide helper limit with the engine owner before
spawning. Last camera ports: 5593 manual Vite, 5591 e2e, 7393 optional bridge.
**These are reservations from this session, not proof of current availability.**
Check listeners and process cwd; never stop another agent's server or reuse its
outputs. Starting Vite directly avoids implicit demo generation; npm dev runs
predev and regenerates demo data. Node/dependency/browser/model symlink recipe is
in CODEX; never npm install through the shared dependency symlink.

## Ownership and release contract

Engine owner chat ID: `01a0ea92-d0f1-74e0-a0e1-d764b8a2bf63`; title was “Continue
3D Studio engine work”, later renamed “Engine”. Identify by ID/current listing,
not title guessing. Camera chat ID: `01a0efb5-f0fe-7701-b4c3-eb43790abb15` (“Camera”).
Gene explicitly authorized coordination messages between these two workstreams.
Batch messages around actual interface dependencies and reviewed commits; do not
routinely ask the engine owner to manage camera iterations.

Camera-owned: `viewer/cinematography/**`, `viewer/app/camera-lab/**`,
`viewer/e2e/autonomous-camera.spec.ts`, import-only
`viewer/engine/test/camera-autonomous.test.ts`, this brief and its REPORT.
Engine owner owns simulation/activity, existing `engine/camera/**`, shared Lab
entrypoints/hooks, build/deploy machinery, main integration and production release.
Existing camera engine edits require an explicit ownership agreement. Request a
narrow read-only hook only when a concrete scenario proves it necessary.
Do not edit shared roadmap/handoff/progress files concurrently. The engine
roadmap already links this brief. Other camera parse/fixture workers may own
separate paths: inspect their branches before adopting anything.

Local Git only. Never push/add a remote, edit another checkout, clean others'
files, change historical Mars content, repin hashes or loosen tests. Small commits
only on owned paths, inspect diffs before staging, author genekogan
<1335251+genekogan@users.noreply.github.com>, coauthor Codex <noreply@openai.com>, never bypass scanner.
Preserve Node strip-types TypeScript and fixed-timestep deterministic engine.
Camera readiness never blocks independent playable engine milestones. Further
camera improvements stay in separate commits from the integrated checkpoint.

## Product boundary

Autonomous live cinematographer/editor: one program view chosen from feasible
intentions, meaningful cuts and smoothly operated continuous shots. Operator can
briefly steer subject, shot/style/motion or pose, then return to auto. Two camera
policies must be able to film the same world differently without altering it.

**Camera decisions never write authoritative simulation state.** The live adapter
applies only render camera poses. Suite scripts intentionally issue existing
registered engine actions to author hypothetical scenarios; filming those recorded
observations does not issue actions or change outcomes. Do not build a parallel
activity/world execution model, move actors or hide architecture for composition.

Implemented: causal local director, clear/restrained/continuous policies, framing
and geometry checks, safe transitions/explicit cuts, operator precedence, bounded
async advisory interface, recorded resolved camera tracks, live classroom review,
varied recorded tour and actual runtime capture tooling. Elaborate lenses/DOF,
training, universal shot languages, general live activity adapters and a proven
model-directed live editor are not implemented.

## Architecture and file map

The causal pipeline is:

`engine snapshot/readouts → Observer → feasibleShots → Director → execute → render camera`

Optional `Advisory → provider reply → Director.accept → next update` joins at the
editorial decision boundary. Rendering/physics never await provider completion.
Presentation currently uses FOV in the pose; there is no independent focus/DOF
subsystem. Replays use recorded resolved output rather than another model call.

| Layer/file | Responsibility and key limitation |
| --- | --- |
| `types.ts` | Observation/request/reply/operator/shot/decision contracts; camera-owned schema. |
| `observation.ts` | Observer derives subjects and public activity semantics from actual world/readout; cameraScene derives fixture geometry. |
| `lab-driver.ts` | Live hook adapter, run epochs, actual canvas aspect, paused controls, recording, telemetry, pointer/wheel takeover and cleanup. Currently classroom-4/8 only. |
| `shots.ts` | Semantic vocabulary → existing engine ShotSpec/evaluator/candidates; rejects unsafe/unreadable candidates; selects physical variant. |
| `composition.ts` | Body facing proxy and 4×4 image-grid foreground architecture score. Does not adequately score foreground human silhouettes. |
| `director.ts` | Policy ranks, holds/recent history, operator precedence, external staleness checks, continuous anchor and decision log. |
| `physical.ts` | Finite/FOV/placement checks, conservative clearance envelope, bounded translation/pan/FOV, swept safety and visibility recovery. |
| `provider.ts` | Advisory request coalescing, event fingerprint, 1 Hz cap, single in-flight, timeout/abort, accounting and cleanup. |
| `jev-server.ts` | Server-only bounded paid provider; pinned model/price snapshot; validated choices/usage and conservative billing reservations. |
| `jev-client.ts`, `bridge.mjs` | Keyless browser loopback bridge client and explicitly started server with exact origin checks. Never production-enabled. |
| `replay.ts` | Binary-search resolved program frames; interpolate between non-cut frames, step across cuts. |
| `review.html` | Separate compiled live Lab iframe/control entry. |
| `suite-record.ts` | Six deterministic actual-engine scenarios, causal observations, all policy tracks, invariants/actions/hash evidence. |
| `app/camera-lab/suite.*` | Native TakePeople renderers, paired policy tour, playback controls and honest replay labels. |
| `record-comparison.ts`, `app/camera-lab/replay.*` | Earlier classroom comparison/capture; not the current production tour. |
| `capture.mjs`, `capture-suite.mjs`, `capture-replay.mjs` | Playwright runtime capture → WebM → H.264 MP4, logs/proofs. No generated concept footage. |
| `camera.test.ts`, `e2e/autonomous-camera.spec.ts` | Core regressions and real browser/world-preservation/cleanup controls. |

Reuse engine `camera/shots.ts`, `solve.ts`, `quality.ts`, `geom.ts`, take recorder
and native `TakePeople`/template renderer. Do not refactor these shared modules
for a camera-only experiment. Engine core permits only its allowed dependencies;
new camera-owned code outside core uses host math and wall time for rendering/
transport, never authoritative fixed-timestep decisions.

### Read-only observation and frozen hooks

Observation schema `mars-camera-observation/1`: session, tick/time, render aspect,
semanticVersion, geometryVersion, eventCursor, subject poses/height/readability
points, activity phase/speaker/presenter/focus/members/display/departing, scene.
Yaw zero faces +X. Human target points are torso/head; seated height 1.4 m,
standing 1.75 m. Fixture targets derive from entityFootprint. Semantic version
changes with activity/geometry/aspect, not every movement tick. Operator epoch
is separate so takeover invalidates outstanding advice immediately.

Live consumes existing `EngineHook.state()`, `classroom()`, `scenarioEpoch`,
`cameraGeometry()` effective scene/epoch, `cameraPose()` and render-only
`camera(position,target,fov?)`. Aspect comes from canvas width/height, not browser
window dimensions: HUD space and portrait rendering matter. Changing/resetting
runs, including same-tick paused resets, starts fresh session/recording buffers.

Important adapter limitation: live uses a camera-owned classroom fixture mirror
updated from the hook's human readout plus effective geometry; this is an adapter,
not another running world. It does not automatically create every newly introduced
actor or update every movable fixture's semantic target; screen position has a
special update. Broader live conversations/workstations/unknown arrivals require
improving this mirror from available readouts before requesting more interfaces.
The richer suite adapter reads actual Runtime/readClassroom/readWorkstation while
recording. Do not assume that because replay covers a scenario, live hook coverage
has automatically been implemented for it.

### Direction, framing and movement

Vocabulary: group establishing, speaker medium, speaker/display, questioner,
two-person, individual follow, safe context. Group follow is representable via
group framing but is not a separately tuned mature live-follow behavior.

Clear: current questioner/speaker/display or walking focus; minimum hold 4 s,
switch threshold .65. Restrained: contextual/two-person coverage; minimum hold
9 s, threshold 1.1. Recent two shots incur .25 penalty; history retains eight.
Arrival/departure favors group context. Conversations no longer receive the old
large group bonus that defeated speaker coverage. Retain a still-present feasible
old subject through a group change long enough to honor holds.

Continuous: autonomous subject anchor, follow intention, existing subject-frame
follow evaluator with offset [-3.8,1.9,1.4], lookHeight .65×height, FOV45. No model
requests; unrelated floor changes do not retarget it. Override expiry/release
returns to the original anchor; removal permits a present replacement. This is a
new autonomous policy alongside the existing engine EUC experience, not a proof
of exact EUC equivalence or uninterrupted following through every obstacle.

Edited angles depend on primary subject yaw: solo yaw+.35 rad, pair/display
+1.05 rad; establishing/context retain room azimuth .75. Padding is .45 m solo,
.55 pair/display, .65 edited follow; not a general lens simulation. Candidate
variants desired, az±30/±60, el+15, wide1.3, with maxPush0. Reject invalid placement,
unsafe pose or readability<.6. Grade = readability − .18 deviation − .9 foreground
+ .3 frontality (front bonus excluded for continuous/context). Cache per-candidate
grade; retain current variant unless improvement reaches .15. `Shot.quality` is
still raw readability, not the combined visual score passed to a model.

Physical envelope: camera point plus .3 m clearance, static prisms and conservative
human boxes (.32 m half-width, minimum standing1.75 m height even when seated).
Valid endpoint is not enough for a continuous move: sweep must be safe and blended
readability sufficient. Translation capped1.5 m/s, pan60°/s plus damping, FOV5°/s;
update dt capped .1 s. These are current heuristic bounds, not a jerk-limited
cinematic motion controller. Editorial cuts may connect valid disconnected
viewpoints. Recovery cuts for unsafe old placement, obstructed sweep or unreadable
blend are explicitly logged and restart the editorial hold, even with same shot ID.
No safe candidate/unsupported aspect (.25–4 supported) yields a named limitation;
it must not trigger model repair or silently relax checks.

### Operator and autonomous handoff

Safety veto applies to every mode. Valid explicit operator pose wins; otherwise
requested subject/shot/policy/movement constrains local choice; otherwise auto.
Operator subject prioritizes solo framing. Still movement pins a valid pose.
External advice cannot override an operator or minimum hold. Unavailable operator
framing emits a named limitation and uses valid fallback coverage.

`takeover(subject, seconds)`/release in adapter; general OperatorIntent supports
pose/subject/shot/policy/movement/expires. Native pointer/wheel manipulation becomes
temporary manual camera ownership and is checked for safe pose/sweep. Each update
uses actual manipulated pose; pointerdown pose must not snap the view back during
drag. Default UI expiry is six **simulation** seconds; a paused world does not
advance that expiry. Escape/Return to auto releases immediately, including paused
same-tick frames. Release increments epoch/discards advice. Continuous retains its
separate original anchor. Explicit empty/unavailable view is preferable to invalid
coordinates, moving actors or hiding occluders.

### Async provider and replay semantics

Request contains session/version/operator epoch, causal time/policy/current shot,
hold duration/canCut, recent coverage, semantic activity and at most12 feasible
intentions with raw quality/reasons. HOLD is valid only if current candidate stays
feasible. No model coordinates/interpolation/collision/math. Candidate feasibility
is checked again on application; changed state version/session/epoch discards reply.
Accepted external source/model and actual application time appear in decision log.

Advisory fingerprint session/version/epoch/current; unchanged state does not keep
polling. At most1 Hz and one request in flight. Timeout1500 ms aborts transport;
keep busy until transport settles, even if a provider ignores abort. This avoids
request buildup while local coverage continues. Sync throw, malformed reply,
network error and timeout fall back locally. Dispose aborts timer/transport and
prevents application. Transport `accepted` means handed to director, not necessarily
applied; improve telemetry before treating it as an editorial acceptance count.

Decision log bounded2048; frames/observations/overhead bounded2400 each. Long
sessions lose earliest in-memory evidence; durable streaming is a TODO. Reset
clears recording. `ProgramFrame{time,pose,cut,shot}` stores resolved output; replay
requires sorted timestamps and never interpolates across the incoming cut frame.
Identical fresh model inputs do not imply identical output; replay must use recorded
accepted decisions/resolved tracks, not call the model again. Recorded comparison
runs directors sequentially over causal observations without lookahead. Player
uses actual recorded native takes but does not restore unsupported head attention.

## Demonstrations, evidence and reproduction

| Case ID | Actual world behavior and honest limit |
| --- | --- |
| presentation | Classroom session, question, presenter advance; actual authoritative classroom controls. |
| conversation | Actual classroom conversation groups/public floors, visitor approaches, guest1 departs. Visitor is not formally admitted into a group. |
| walking | Lab wall-avoidance walking from open to obstructed spaces. No riding proof. |
| workstation | Registered work_at/readWorkstation; worker/object view; other classroom actors idle. |
| simultaneous | Lab campfire gathering/conversation/walkers; attention/speaker annotations at27/33s are explicitly camera-owned synthetic cues, not general attention inference. |
| operator | Actual classroom take plus identical camera-only partition24–32s and guest2 override25–29s. Obstacle is a labeled camera fixture, not authoritative furniture motion. |

Each case has clear/restrained/continuous tracks over the same recorded take.
Current paired tour shows clear/restrained except walking/operator use continuous/
clear. All six baseline/revised world hashes AND take JSON matched byte-for-byte;
zero invariants/failed actions. Six15-second sustained passages, not rapid montage.
Separate live Lab clip exercises real-time question/takeover/return/departure/
presenter advance. API failure/staleness is covered by tests; no genuine live Jev
visual superiority has been shown.

All paths below relative to preserved checkout's `viewer/e2e/artifacts/`:

- `codex-autonomous-camera-varied-front/review.mp4`:92.68 s, revised six-scene tour,
  source2591b9e; `suite.json`, `proof.json`, `review-manifest.json`, decision tracks,
  filmstrip and dense conversation/walking/operator transitions beside it.
- Same folder `before-after.mp4`:90 s, baseline above/revised below, explicitly
  approximate video-clock alignment. Same world takes; not exact frame alignment.
- `codex-autonomous-camera-varied-baseline/review.mp4`:92.48 s, source15f5726;
  archived suite JSON. `failed-clock.mp4`/failed proof preserve earlier failure.
- `codex-autonomous-camera-clear-front-live/review.mp4`:48.28 s, source2591b9e;
  proof with352 camera updates, mean1.64 ms,p952 ms,max14.5 ms; no browser errors/
  camera diagnostics. Prior clip mean .97 ms: cost rose, not a controlled full
  renderer-regression benchmark. Live update loop around10 Hz, not model1 Hz.
- `codex-autonomous-camera-comparison/sequence.json` and `jev-evaluation.json`:
  earlier causal classroom sequence and bounded provider experiment.
- `codex-autonomous-camera-tour-final/production-tour-controls.png`: inspected
  playback UI proof. Original artifact README/manifest/logs are evidence, not code.

These large artifacts are ignored/local. Preserve/copy the specific directories
before any worktree cleanup. Never externally publish them without Gene's request.
The current generated `public/camera-demo/suite.json` is rebuildable; archived
baseline/proof/MP4s are not replaced by regeneration.

From a camera-owned viewer checkout, after checking ports:

```sh
node deploy/prepare-camera-demo.mjs
npx vite --port 5593 --strictPort
# In another terminal, while the source stays fixed:
node cinematography/capture-suite.mjs varied-front-new
node cinematography/capture.mjs clear-live-new
```

Generator records actual engine runs, validates schema/live:false/exact six cases,
zero violations/no failed records/all policy tracks, then writes ignored
`public/camera-demo/suite.json`. Predev invokes it. Prebuild `--for-build` regenerates
from exact HEAD; release mode stages after prepare into `.cloudflare/public` and
adds a static receipt. Data was18.4 MB, under25 MiB; growth needs measurement.
Vite has suite HTML input. Build/generator/staging are integration-owner paths.
Do not serve ignored e2e output as the production contract or commit the large JSON.

Archive baseline data before a new generation. Compare policies on the same take,
prove unchanged world hashes, and separately show genuine live intervention.
Capture scripts currently hardcode5593; changing a port must also consider bridge
origin allowlist. Changing source/formatting during capture causes Vite HMR and
invalid footage. Inspect the entire captured timeline and dense transitions;
retain failures, label live/replay/scenario/policy/source/defects. Do not cut out
all disruptions or substitute generated concept videos. Captures historically
failed due HMR and negative startup clock; both retained, startup/seek regressions
fixed. Produce new MP4s at visible milestones and roughly60–90 active visual minutes
when there is material progress; no need to generate footage for documentation.

## Prioritized improvement backlog

These are recommendations grounded in footage, not authorization to expand scope
or claims that implementations exist. Pick one bounded defect per reviewed batch.

1. **Foreground human crowding (next visible fix).** Close conversation shots
   frame faces better but another person's large head/hair fills bottom/sides.
   Current grid score only covers scene architecture; subject-point readability
   can pass despite a distracting silhouette. Add a camera-owned projected body/
   foreground measure and sample alternate safe views; reuse body/quality machinery
   where possible. Preserve readability/clearance, participants and world hashes.
   Prove improvement on the archived conversation and simultaneous cases, including
   sustained shots and close passersby; measure overhead before increasing rays.
2. **Abrupt recovery cuts and motivated motion.** Walking clear front view turns
   toward a wall and can require an abrupt visibility/sweep cut. Add side/route
   alternatives and hysteresis/short causal motion history before considering new
   engine hooks. Prefer holding a valid readable position when possible; never
   blend through a wall or delay safety. Distinguish intentional editorial cut
   from physical recovery in UI/logs. Compare continuous route coverage with clear
   front coverage. Target acceleration/jerk and screen-direction continuity need
   actual measurement; current velocity/pan bounds alone do not guarantee elegance.
3. **Broader honest live coverage.** Live adapter is classroom-only and has the
   fixture-mirror limits described above. Exercise known arrivals, actor removal,
   moved screen/table/chair and workstation through available current readouts.
   Create missing mirror subjects/derive fixture target geometry without a second
   activity model. Use engine owner's evolving setup scenarios; request exact
   minimal read-only semantics only when unavailable. Recorded tour alone cannot
   prove this milestone. Keep supported-scenario diagnostics explicit.
4. **Object/workstation/display composition.** Screen content may be rear-facing
   or too small; human front bonus is not enough for display readability. Select
   useful front/three-quarter object view, user hand/contact/action area and human
   context; distinguish intended foreground object from distracting clutter. Do
   not just tighten until composition becomes cramped. Define useful object
   semantics from actual work/readouts; no object execution changes.
5. **Timing/attention/policy clarity.** Measure holds, cuts, missed floor changes,
   arrival/departure coverage and continuity. Clear can miss short floor turns
   because4 s holds are deliberate; restrained may remain too wide. Simultaneous
   demo uses annotated attention, not autonomous significance inference. Decide
   causal rules using available activity readouts, explain coverage priorities,
   retain separate policies and operator intent. Initial continuous anchor may be
   guest1 during arrival rather than presenter; subject-selection UX is unresolved.
6. **Replay fidelity and durable sessions.** Restore head/attention only through
   existing supported take data or agreed optional addition; no silent take schema
   bumps. Long-run logs should segment/persist before buffers roll over, preserving
   model/config/accepted application time, reset epochs, errors and replay cuts.
   Test mid-run restore, cleanup and replay without another model request.
7. **Performance/generalization.** Profile worst-case group8/dense furniture,
   responsive/portrait scene, long session and repeated scenario changes. Cache
   geometry/quality work where justified; test memory/resource cleanup. Do not
   silently reduce guarantees, sampling precision or baseline thresholds. Riding
   and additional environments need actual runtime evidence before advertising.
8. **Optional Jev evidence.** Leave off until same-world comparative footage
   shows a concrete benefit over deterministic selection. Improve reporting of
   actual applied vs merely delivered replies and candidate composition quality.
   Run offline mocks first; reverify current docs/model/pricing and seek Gene's
   ceiling before further sustained paid use. No browser credentials or loops.

First two visual fixes were estimated2–4 active hours for a bounded polish/demo
batch, assuming frozen hooks; this is not an estimate for a universal director.
Elaborate lenses/DOF, training, broad renderer rewrites and universal shot language
remain deferred until evidence warrants them. Engine roadmap remains independent.

## Open product/technical questions for the next agent

- Aesthetic preference: how intimate should observation be; acceptable foreground
  shoulder versus obstruction; preference for stillness, moving shots and cuts?
  Ask Gene only for material choices; use footage for routine local corrections.
- Continuous subject identity: restore original anchor after manual retarget (now)
  versus operator adopting a new persistent anchor? What is intended idle selection?
- Should a paused override expire by wall time or simulation time? Current behavior
  is simulation time with explicit release/Escape; don't silently change it.
- How much screen-direction continuity should constrain speaker/reverse coverage?
  `Shot.side` is currently a constant, not a proven180° axis model.
- What quantitative/perceptual rubric captures composition, motivated coverage,
  time to recover and disruptive cuts? Frontality/foreground proxies are not proof.
- How to label “continuous” when safe recovery requires a cut? Current log is
  honest, but UI and user expectations need definition.
- Are all desirable activity/fixture/arrival semantics already available after
  ongoing room-setup work? Inspect current engine before proposing new fields.
- What, if any, Jev benefit justifies latency/cost? No sustained ceiling was
  answered in this session, and fresh model responses are not reproducible.

## TypeSafe/Jev: historical experiment, not current pricing authority

Read-only external project `<typesafe-repo>`: AGENTS and
`docs/2026-09-19-jev-research-handoff.md` were inspected initially. Relevant installed
skill then was `~/.claude/plugins/cache/typesafe-ai/typesafe/0.5.7/skills/typesafe-ai/SKILL.md`;
future agents must discover its current location. Do not modify that project.
Official https://docs.typesafe.ai/models and https://docs.typesafe.ai/api verified
2026-09-29: jev-1.13.0, POST /v1/systemone choice responses, input$.042/M/outputfree.
These are historical pinned config facts, not a promise of current API/pricing.
Reverify official docs and available skill before another implementation/evaluation.

Key loads server-side via environment from documented Typesafe .env. Never print,
commit, stage, log, expose in captures, pass to browser, or export the key.
`jev-server.ts` must never enter the browser dependency graph. Bridge loopback7393,
exact localhost/127.0.0.1 origin5593, explicitly started; production UI disables it.
Do not start bridge/evaluation as part of ordinary dev/build/test/replay.

Provider defaults12 calls/$0.01; body cap24K, at most12 choices plus HOLD,
reserves64K tokens' estimated cost before requests. Unknown billed errors retain
worst-case reservation; no overlapping request buildup. Model/config/token/latency/
measured cost logged without credentials. Initial evaluation made12 calls,
19,881 input tokens, estimated$0.000835002,172.57–518.34 ms latency. Mostly HOLD,
one pair choice differed; no established visual improvement. It evaluated causal
recorded observations, not a proof of real-time model direction. Optional bridge
was not deployed/enabled. Repeated unattended paid runs are not authorized.

## Validation and acceptance checklist

From viewer, on the future agent's rebased branch:

```sh
node --test cinematography/camera.test.ts
npm run test:engine
npm run typecheck
npx tsc --noEmit -p cinematography/tsconfig.json
npx oxlint cinematography app/camera-lab
E2E_VITE_PORT=5591 E2E_RUN=codex-camera-resume-1 PLAYWRIGHT_BROWSERS_PATH=.pw-browsers npx playwright test -c e2e/playwright.config.ts e2e/autonomous-camera.spec.ts --workers=1
```

Recheck port first, leave optional simulation/paid bridge off. Browser test calls
owner demo generator when present; historical standalone branches have explicit
legacy recorder/copy fallback. It uses a real public data request, not interception.
Deploy demo-validator tests are owner-controlled build acceptance; full gate and
release checklist remain owner's responsibilities. Do not quote focused checks as
full production gate. Documentation-only handoff reruns full engine per CODEX;
no new footage or paid evaluations are necessary.

Core regressions: invalid/NaN geometry and placement, sweep cuts, occlusion/moved
furniture, min holds incl group changes/recovery, manual pose/subject/stillness and
expiry, continuous anchor restoration/removal, stale model session/version/epoch,
unknown choice/invalid reply/sync throw/network timeout, single-in-flight/caps,
cleanup, replay cut interpolation, render aspect and no authoritative mutation.
Browser: native pointer takeover, paused release, portrait framing, same-tick reset
new epoch/ordered recordings, scene/controls teardown, live public floor coverage,
classroom8, public replay playback/pause/restart/selection, local-only Jev UI.
Historical reviewer findings about drag snapback, recovery holds and reset tracks
were fixed and regression-tested; don't reintroduce them.

Acceptance for another improvement: focused tests + required repository checks,
unchanged engine pins/outcomes, complete actual runtime footage with representative
disruption, policy comparison on identical take, separately live proof for live
claims, inspection notes and measured camera overhead. For Jev add latency/calls/
tokens/measured cost and a real visual comparison. Commit only reviewed owned paths,
append REPORT with implemented/inspected/tested/integrated/released distinctions,
and send ready batch to integration owner. Never equate a branch demo with release.

## Session retirement and future takeover

Gene can ask any future agent: “Resume the Mars autonomous camera workstream;
read docs/engineering/briefs/autonomous-camera.md and its REPORT, inspect the
existing footage, then improve the highest-priority visible defect in a dedicated
worktree. Coordinate only real dependencies and ready batches with the engine owner.”

No unfinished implementation is hidden in this session. Pending items are the
explicit backlog/questions above. Keep the preserved worktree/artifacts; archival
of the chat is not authorization to delete them. Do not resume development or paid
experiments automatically after retirement; wait for Gene to ask. The engine owner
can continue independent activity releases without camera participation.
