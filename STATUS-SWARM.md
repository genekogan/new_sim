# STATUS-SWARM — swarm director on the playtest framework

Brief: `<team>/TRANCHE-SWARM-DIRECTOR-20261026.md`. Branch `lane/swarm-director-20261026` (off
`lane/playtest-20261024` @ 073363dc9), worktree `<worktrees>/swarm-director`. Additive only.

## Plan

1. Cast schema + `tools/playtest/scenarios/casts/seven-dwarves.json`.
2. `tools/playtest/director/swarm/`:
   - `cast.mjs` — load/validate a cast, economy levels, cast → scenario (so the run folder looks like any run).
   - `truth.mjs` — world truth the gate reads: per-seat place/placePath/posture + speech events (public Soul page
     `events[kind=speech]`, server `ledger.ts` publicSoul), room matching.
   - `planner.mjs` — the Claude agent above the seats: one `claude -p` (opus) call that decomposes the brief into
     per-seat directions (gather / prepare / go); deterministic templates when it is off or fails.
   - `orchestrator.mjs` — the state machine: gather → everyone-present gate → turns in brief order, each `go` gated on
     the previous speaker finished (speech seen, then the card result or `quietSec` silence), a `prepare` direction sent
     to the next speaker when the current one gets `go` (hides the ~30 s card→first-command latency), nudges for
     stragglers / leavers / silent speakers, onboarding nudges (chat) for never-paired seats, token-economy per seat.
     Every direction goes through `arena/owner.mjs` `sendCard` and is logged with its reason
     (`director/directions.jsonl`), opens a request evidence pack (`evidence/<seat>-NNN.json`) and a director's-view
     record (`personas/<seat>/turns.jsonl` + `shown/<n>.json|png`) so `review/story.mjs` renders it as a moment.
   - `console.mjs` — line parser (`<text>` broadcast, `<seat>: …`, `pause`, `resume`, `redirect <seat>: …`,
     `economy <seat> <level>`, `status`, `end`), stdin reader, headless script feeder (`atSec` or `at: "go:<seat>"`).
   - `verify.mjs` — success check from world truth only: all present in the room, each seat presented once, in order,
     redirect observed → `director/verdict.json`, `director/VERDICT.md` (with per-seat cost from `seats/*/cost.jsonl`).
   - `run.mjs` — `direct` end to end: preflight → provision → seats (parallel onboarding) → cameras → orchestrate →
     close → metrics/journal/story (review + developer off).
   - `test/*.test.mjs` — node:test, fake seats + fake world + virtual clock, no model calls.
3. `playtest.mjs direct <cast.json> [--server-root dir] [--world <url>] [--headless] [--script file] [--out dir]`.
4. Local smoke: 1–2 haiku seats, only with 1-minute load < 10.
5. `cloud/run-replay.sh`: `PLAYTEST_DIRECT=<cast.json>` mirrors `PLAYTEST_SCENARIO`.

## Cast schema (version 1)

```jsonc
{
  "kind": "cast", "name": "seven-dwarves", "version": 1, "seed": 7007,
  "world": { "kind": "dev", "genesis": "worlds/templates/eden-district.json", "slug": "pt-dwarves", "port": 4996,
             "natives": false },                       // or {"kind":"url","base":"http://…/w/<slug>"} (--world)
  "durationSec": 2700,                                   // hard stop for the whole scene
  "brief": "one paragraph every seat shares",
  "room": { "label": "the library hall", "match": ["hall"] },  // placePath name substrings (case-insensitive)
  "order": ["doc", "happy", …],                          // presentation order (seat ids)
  "seats": [ { "id": "doc", "soulName": "Doc", "character": "one paragraph", "topic": "what they present",
               "adapter": "claude-headless", "model": "haiku", "effort": "low", "economy": "lean" }, … ],
  "economy": { "lean": { "maxTurnsPerDirection": 2, "maxTurnWallSec": 150, "guidance": "…" }, "normal": {…}, "rich": {…} },
  "timing": { "truthPollSec": 5, "gatherMaxSec": 900, "nudgeAfterSec": 150, "maxNudges": 3, "quietSec": 25,
              "speakTimeoutSec": 240, "prepareAhead": true },
  "orchestrator": { "planner": "opus" | null, "plannerEffort": "medium" },
  "success": { "allPresent": true, "minChars": 40, "inOrder": true, "eachOnce": true },
  "observer": { "sampleSec": 15, "cameras": ["follow", "wide"], "viewport": [1024, 640] },
  "rails": { "onboardWallSec": 600, "onboardTimeoutSec": 540, "onboardConcurrency": 4, "quotaStopPct": 90 },
  "console": { "script": [ { "at": "go:sleepy", "line": "redirect grumpy: …", "expect": ["piano"] } ] }
}
```

## Progress

- Built: `director/swarm/{cast,truth,planner,console,orchestrator,verify,run}.mjs`, casts `seven-dwarves.json` and
  `smoke-duo.json`, `playtest.mjs direct`, `PLAYTEST_DIRECT` in `cloud/run-replay.sh` (+ README section).
- Tests: `node --test tools/playtest/director/swarm/test/*.test.mjs` (21 pass; fake seats/world/virtual clock, no model):
  gather gate, straggler nudge, never-paired chat nudge, onboarding hand-off, turn order, next go waits for the previous
  speaker's speech + result/quiet, prepare-ahead, silent speaker nudge→skip, left-room nudge, early talker caught,
  scripted redirect changes the talk and is observed, broadcast/seat lines verbatim, pause/resume/end, economy, gather
  timeout drop, log files, story.html renders director moments.
- Planner checked for real on seven-dwarves: opus, 30 s, $0.073, all 21 directions from the model.
- Local smoke 2026-10-26 03:19Z (load 5–6): `node tools/playtest/playtest.mjs direct tools/playtest/scenarios/casts/smoke-duo.json --headless`
  on a local eden-district dev world (soul3-integration server), two haiku seats, template plan →
  **PASS** (allPresent, eachPresented, inOrder, eachOnce, redirect observed), 8 min of play, $0.073 seats total.
  Run: `<team>/playtest/runs/20261026-031937-smoke-duo-7002` (director/VERDICT.md, story.html with 6 director
  moments). Room match `hall` works (placePath `hall / eden-library-1`). Latency: gather card → in hall ~2 min;
  go → first speech 107 s for Doc (no prepare) vs 40 s for Grumpy (prepared ahead). Fixed after it: the wide camera
  loop now waits for the camera to open (the smoke had no wide shots).

## Cloud acceptance

- dwarves-r1 (cloud, server rc/soul-fix-20261026 @ 8c8f101b3; results in `<team>/playtest/replays/cloud/dwarves-r1/`):
  4/5: allPresent 7/7, eachPresented 7/7, inOrder, redirect observed; **eachOnce FAIL**: Grumpy spoke his piano line
  when the redirect card arrived (before his turn) and again in his turn. Two stragglers (sleepy, dopey) needed one
  nudge each. $0.44 total (seats $0.37 + planner $0.07).
- Fix (orchestrator only, verifier unchanged): every composed card direction to a seat before its own turn (gather,
  prepare, nudges, redirect) carries the hold guard `Do not say it yet; wait until I write "your turn".`
  (`planner.mjs` HOLD/withHold, applied in `direct()`); a pre-turn redirect reads "for when your turn comes" and its
  content is folded into the seat's "your turn" direction (NUDGE.goOverride). Gene's verbatim console lines stay
  unguarded. Tests: an eager fake seat that talks on any unguarded card speaks once, in its turn; the redirect content
  is in its turn direction; without the guard the same seat fails eachOnce. Rerun as dwarves-r2.

### How to run it

Cloud session (Sim Env `env_01VeMJKsnDSYrGaH6hdWakQ7`) on `genekogan/sim`, prompt:

> `cd /home/user/sim && git fetch origin lane/swarm-director-20261026 && git checkout lane/swarm-director-20261026 &&
> PLAYTEST_DIRECT=tools/playtest/scenarios/casts/seven-dwarves.json nohup setsid bash tools/playtest/cloud/run-replay.sh main dwarves-r1 1 > /tmp/dwarves-r1.log 2>&1 &`
> then poll with foreground calls under 10 minutes each (`sleep 540; tail -n 30 /tmp/dwarves-r1.log; pgrep -f run-replay.sh || echo FINISHED`)
> until FINISHED, and report `results/dwarves-r1/seven-dwarves-r1/director/VERDICT.md` in full, the playtest-results
> push result and CLOUD.md.

Results: branch `playtest-results`, `results/dwarves-r1/seven-dwarves-r1/` (story.html, director/VERDICT.md with
per-seat tokens/USD). The live-console redirect is scripted in the cast (`at: go:sleepy` → redirect Grumpy to the piano).

## Open items

- The interactive console (stdin) is unit-tested through `submit()` only; a hand session by Gene is its real test.
- The first direction's director's view has no picture when the follow camera is still opening (story uses the next).
- `world.kind: "url"` / `--world` skips provisioning but seats onboard with the dev onboarding text; on a real world
  the owner approval flow applies (rehearse on a dev or forked world, per the brief).
- Speech finish = card result or `quietSec` silence; a seat that talks in many short lines with >25 s gaps would be
  cut early (raise `timing.quietSec`).
