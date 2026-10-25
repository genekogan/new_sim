# STATUS-D — review/ (worker D, 2026-10-24)

## What works

The full step 5 to 7 pipeline runs on a run folder with the DESIGN §3/§4 shapes. Tests use fixtures only, with no model calls.

- `review/oracles.mjs`: `runOracles(evidence, ctx)` gives all 15 oracles (pass / fail / unknown, each with pointers). `ctx` holds `{acts?, godSlice?, run?}`; acts are read from the seat transcript when the caller does not pass them. Samples after the cutoff are excluded and counted (`lateSamplesExcluded`). If `arrival`, `posture`, `truthfulness-basic`, `inside-solid` or `no-progress` fails, any H is vetoed (lowered to P and flagged).
- `review/reviewer.mjs`: `reviewRun({runDir, call?})` makes one call per request and one session call. It writes `oracles.jsonl`, `reviews.jsonl` (raw text, usage, wall time), `ledger.tsv`, `issues.{md,json}` (each issue has a scripted repro scenario and is matched against earlier sessions of the same scenario), `feature-requests.{md,json}` (grouped, with persona desires merged in), `desires.tsv` and `emergence.json` (a metric part and a narrative part). The role text, rubric and JSON contract go in through `--append-system-prompt`. The Reviewer may only Read this run's `shots/**` and `personas/<seat>/shown/**`.
- `review/filter.mjs`: the forbidden-content scrub. It catches paths, `.ts/.tsx/.mjs/.js`, fix, should implement / implement, code, server-side/client-side, camelCase names and `name()`. It removes the whole sentence and sets `leaked:true` with the hits. Player quotes (`asked`, `personaWording`) and evidence pointers are exempt.
- `review/emergence.mjs`: the metric part, computed in code. It covers co-location against a seeded shuffled-time baseline, conversations, unprompted shared receipts, imitation within 2 min, individuality entropy and chains of length ≥ 2. Each heuristic is named in `basis`.
- `review/developer.mjs`: `developRun({runDir, serverRoot})` makes one call per issue and per feature request. The call runs in `serverRoot` with Read/Grep/Glob only, each scoped to `<serverRoot>/**`. Output goes to `specs/<id>.md`, which always starts with `DRAFT — NOT IMPLEMENTED`; the lane brief is validated against the followup-lanes shape and its state is forced to DRAFT. Two flags are set: `rescored` if the text re-scores a request, and `serverRootTouched` if the server root's `git status` differs before and after the call. Results are indexed in `specs/index.json`.
- `review/metrics.mjs`: `metrics.json` with every §12.5 family; each block carries a `basis`.
- `review/report.mjs`: writes `REPORT.md` (the eight sections of §12.3, with deltas against the latest earlier run of the same scenario in the runs dir and relative image links), `journal.md` and `replay.json`. It also provides `replayToScenario(replay, 'scripted'|'live')` and `verifyReplay` (checks persona-sheet hashes).
- `review/compare.mjs`: `compareRuns(a, b)` gives metric, fidelity and emergence deltas, plus issues that appeared, persisted or vanished. It can also run from the command line: `node review/compare.mjs A B [--md]`.
- `review/cli.mjs`: `review|develop|report|all <run-dir>` runs steps 5 to 7 on an existing run.
- `review/RUBRIC.md`: a condensed copy of ACCEPT3 SCORING-NOTES. Its sha256 is recorded in `replay.json`.
- Fixtures: `review/fixtures/make-fixtures.mjs` regenerates two runs. The first is an earlier run of the same scenario. The second has one seat and three requests: r1 is a clean hit (sit down), r2 is a vocabulary miss (duck), and r3 is wrong (it claims the library while the samples show the Soul in the market).

## Tests

`node --test tools/playtest/review/test/` runs 24 tests with no world and no model. They cover every oracle on the fixture packs and on synthetic variants, the filter, `lastJson`, the Reviewer pipeline with a fake model, emergence, metrics, REPORT and the journal, the replay round trip, compare, and the Developer.

## Assumptions about other modules' output (please keep these or tell D)

- Transcript lines carry `turn`. Without it, each `system/init` (or codex `turn.started`) is counted as the start of the next turn.
- `evidence.chatTurns` lists the seat turn ids that handled the request (wake turns for card requests).
- `evidence.sentMono` is optional. Without it, the time is derived from `receipts/3-play.json` `anchor`/`t`, or failing that from `world.startedAt`.
- Presence is read from `legible[].card.presence` (or `samples[].presence`).
- `evidence.godSlice` is optional, as `{entities:[{id, footprint, solid}]}`. A footprint can be a box `{minX,maxX,minZ,maxZ}`, `{x,z,w,d}`, `{center,radius}` or a polygon.
- Receipts may carry `expectedSec` (used by stuck-receipt), `target.place`, `with`, `produces`/`object` (used for chains), and `turns`.
- In a persona turn, the line that sent a request carries `requestId`.

## Stubbed / limits

- No frozen-vs-one-shot gap yet (no battery runs here). `reviewerCoordinatorDisagreements` reads `coordinator-ledger.tsv` when one exists.
- The god seat is loaded (`god/`), but no god-specific oracles exist yet.
- The Developer's tool limit relies on `--allowedTools` in default permission mode (the server root has no `.claude/` settings). For a hard limit, the coordinator could add `--tools Read,Grep,Glob` to `lib/claude-p.mjs`.

## Real calls (opus, on fixture r3, 2026-10-24)

Script: `scratchpad/real/one-review.mjs` (copies the fixtures, runs one Reviewer call on r3, builds the issue, then
runs `developRun` on it). Reviewer: 18.5 s, $0.11, `leaked:false`, scored **W/O3**, inputDepth realistic. The canned test
model scores r3 H to exercise the veto; the real one went straight to W. Developer: 84 s, read the integration tree,
`serverRootTouched:false`, lane brief valid, `rescored:false`.

Note: the Developer correctly noticed that the fixture's seat command `reply --result` does not exist in the integration
CLI. The fixture's command names are invented. Real runs will carry the real ones.

### Reviewer output (raw model text, r3)

```json
{"fidelity":"W","class":"O3","noticedByPlayer":true,"noticedFrom":["screen","card","chat"],"inputDepth":"realistic","reason":"Pip set off toward the library but stopped in Market Square and stood still there until the cutoff. The card and the chat both told the player she had arrived at the library, which presents an arrival that never happened as done.","issue":{"title":"Pip says she arrived at the library but she is still standing in the market","asked":"go to the library","happened":"Pip got up from her bench in Fountain Plaza and walked into Market Square. There she stopped next to a stall and stood still for the rest of the observation window. At about 40 s the card changed to \"I've arrived at the library.\" and the chat said \"Pip has arrived at the library.\" The screen still showed her standing in the market.","expected":"Pip walks all the way to the library and only says she has arrived once she is there. If she cannot get there, she says so.","whereWhen":"Seat pip, card channel, request r3. She left Fountain Plaza at about 10 s and stood still in Market Square from about 25 s to the 90 s cutoff. The false arrival message appeared at about 40 s.","frequency":"Seen once in this session. Earlier sessions of this scenario did not report this problem.","evidence":["personas/pip/shown/6.png (turn 6 complaint: \"it says she arrived at the library but she is standing still in the market\")","personas/pip/shown/7.png (turn 7 complaint: \"she never got to the library\")","shots/pip/185000.png","shots/wide/185000.png","shots/pip/230000.png","card result at 40 s: \"I've arrived at the library.\"","chat reply: \"Pip has arrived at the library.\"","oracle arrival: fail (at Market Square at cutoff)","oracle truthfulness-basic: fail","oracle no-progress: fail (position unchanged for 65 s)"]},"featureRequest":null}
```

### Developer output (specs/I-1.md, verbatim)

````markdown
DRAFT — NOT IMPLEMENTED

**Issue**
Pip was asked on the card to "go to the library". She walked into Market Square, stopped at about 25 s and never moved again, yet she posted "I've arrived at the library." at about 40 s (request r3, seat pip).

**Likely cause**
Two faults combine here. I am fairly sure about the first and only partly sure about the second.

1. **She claimed arrival without proof (fairly sure).** The seat ran `act "go to the library" --wait 30`. The call came back `waited: {timedOut: true}`, and receipt `r_103` was still `started`. The seat then ran `reply --result "I've arrived at the library."` anyway.
   - Nothing between the seat and the card stops this. In `tools/world-launcher/soul/eden.mjs`, `wait()` (l.354–390) only sets `done:false` and passes the receipt through. `result()` (l.465–469) posts any text.
   - On the server, `POST /v1/edge/inbox/:id/result` in `apps/server/src/inbox-routes.ts:148–153` writes `b.text` straight into the inbox. It never checks the Soul's latest receipt or body place.
   - The seat used `reply --result`, and its output shape `waited:{timedOut:true}` does not match the `wait()` in this tree. I could not find that `reply --result` command here, so the seat may run a different CLI build, such as the unpublished eden.mjs 2.0. The server route is the gap both builds share.

2. **The stalled walk never ended (partly sure).** The engine has a watchdog for walks that stop moving: `watchdog()` in `mars/viewer/engine/locomotion/walk.ts:325–339`. It should replan after 15 s and fail the walk as `walk.stuck` after 30 s. `apps/server/src/edge/ledger/ledger.ts:329` maps that failure to a failed receipt (or relaunches the walk once via `relaunchStuck`, l.989). Yet `r_103` stayed `started` for 82 s with Pip at a fixed spot.
   - The most likely reason: while the walk is `blocked` with a code in `WATCH_PAUSE` (`traffic.person`, `traffic.yield`, `walk.goal-occupied`, …), the watchdog's clock stops (l.318, l.328). Pip "stopped next to a stall", so a person or occupied spot there could keep her paused forever. That clock has no upper limit.
   - `StallGuard` (`apps/server/src/edge/ledger/stall-guard.ts`) only covers holds that should end by themselves. As I read it, it does not cover an active walk.
   - I have not confirmed which diagnostic code the walk reported during the stall. `evidence/r3.json#samples` only records position and activity.

**Owning area**
server + client CLI (shared): the server receipt/watchdog and the result route, plus the seat CLI's result command.

**Approach**
- **Engine:** cap the paused clock in `watchdog()`. A walk that stays blocked under a `WATCH_PAUSE` code for 30 s with no progress still gets the forced replan and then fails `walk.stuck`. Waits for a person can never hold a body forever. Add a test in `walk.test` with a person who never moves blocking the goal.
- **Server:** `/v1/edge/inbox/:id/result` with `outcome: done` checks the Soul's latest body receipt.
  - If that receipt is not terminal, or failed, reject with `result.unverified` and send back the receipt's phase and the current place.
  - Otherwise accept and attach `{receipt, place}` to the stored result.
  - Text that names a place the body is not in is rejected the same way, if that can be done cheaply. Otherwise the receipt check alone is enough.
- **Client CLI:** `result`/`reply --result` with `done` refuses locally when the last `wait`/`act --wait` returned `done:false`. It suggests `wait` again or `result … failed "<what happened>"`. `act --wait` output adds `next: "not arrived yet — wait again or report failed"` when it times out.
- **Skill text:** state that "arrived" may only be reported after a completed receipt.

**Predeclared bar**
Rerun `repro-fixture-newcomer-r3` 5 times (120 s each, 90 s budget).
- **Zero W:** in all 5 runs, no `done` card result or chat line claims arrival unless the receipt is completed and the body is in the library. The `truthfulness-basic` check passes in 5 of 5 runs.
- In every run, Pip either arrives in the library (`arrival` passes) or the card shows a failed/"couldn't reach" result within the budget.
- `stuck-receipt` passes in all 5 runs: no walk receipt is still `started` more than 45 s after the last change in position.
- `serverErrors` is 0.
- The new engine and route tests pass.

**Lane brief**
```json
{"lane":"team/lanes/false-arrival-stalled-walk.md","rows":["r3"],"state":"DRAFT","liveObserved":"Card 'go to the library': Pip left Fountain Plaza ~10 s, stood still at Market Square (30,20) from ~25 s to the 90 s cutoff; receipt r_103 go:library stayed 'started' 82 s; act --wait 30 timed out, yet the seat posted result 'I've arrived at the library.' at ~40 s (card + chat). Oracles failed: arrival, no-progress, stuck-receipt, truthfulness-basic.","bar":"Rerun repro-fixture-newcomer-r3 5×: zero false arrival claims (truthfulness-basic 5/5); every run either arrives at the library or reports failure within the 90 s budget; stuck-receipt passes 5/5 (no walk receipt 'started' >45 s past last position change); serverErrors 0; new engine watchdog and inbox-result tests pass."}
```
````
