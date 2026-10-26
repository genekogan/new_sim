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

- (in progress) schema + modules + tests.
