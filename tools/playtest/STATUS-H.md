# STATUS-H — harness fixes B2–B4 and the frozen-set scorecard (2026-10-25)

Branch `lane/playtest-20261024`, worktree `<worktrees>/playtest`. Not pushed. Brief: ROOT-CAUSES-20261025 §B2–B4, §E.

## Done (each with node --test on fixtures/fakes; `node --test tools/playtest/{review/test,director,observer,arena}/` = 92 pass)

1. **Arrival (B3)** — `review/oracles.mjs` `placeTarget` takes the seat's *last* walk act for the request, or a walk receipt
   accepted inside sentAt..cutoffAt (`acceptedAt`/`startedAt`, else `acceptedTick` mapped to time by `tickClock` over the
   seat's samples). Never an earlier request's walk; an act accepted after the cutoff → arrival `unknown`. Arrival passes on
   place/placePath/near(here|close) name, target pos, or the completed walk's end point (≤ 3 m). no-progress/oscillation
   use in-window walks with tick-mapped times (real receipts carry ticks, not ISO times; the old code got NaN windows).
   Turn links: the Director records the turn that carried each chat request (`Seat.chat(…, {onStart})` →
   `evidence.addChatTurn`); `review/run.mjs` `linkTurns` infers links for older runs (chat turns in order; wake turns
   starting in a card window), marked `chatTurnsInferred`.
2. **Truthfulness (B4)** — reads chat replies (`finalText` of linked turns) and card ack/result, each against the samples
   around its own write time (seat-wide samples and receipts, so post-cutoff replies are judged fairly); claims: arrived,
   sitting, lying, swimming, riding, done; negated/future/conditional/question clauses and other-Soul subjects are skipped.
   `result-sent` on chat passes on a reply before the cutoff.
3. **Cost join (B4)** — `metrics.joinTurns`: turns overlapping the request window (or linked) serve it; tokens and CLI calls
   split evenly. New: `cost.outputTokensPerRequest`, `cost.cardTurnsPerRequest`; `metrics.version` 2.
4. **Chat queue (B2)** — evidence `queuedSec`, `budgetStartAt`, `budgetSec`; chat budget clock starts at the carrying turn;
   `speed.chatQueuedSec`; DESIGN §9b documents it as a measurement choice.
5. **Scenario defaults** — the 10 persona scenarios set `world.natives: true`; basics batteries unchanged; god 600 s kept.
6. **`playtest.mjs replay-set`** + `review/scorecard.mjs` (`FROZEN`, `frozenScenario`, `runMeasures`, `thresholds`,
   `noNewBugs`, `mergeBase`, `renderScorecard`). `--dry-run` verified against the seven real folders; nothing was played.
   Also: `machineCheck()` shared by preflight and the replay-set gate; `scenario.review.developer: false` skips step 6;
   `replayToScenario` no longer forces 180 s (god requests now get 600 s on replay).

## Re-score (no model) — all 16 reviewed runs

`node tools/playtest/review/rescore-oracles.mjs --all <team>/playtest/runs`; originals kept as `oracles.jsonl.v1`,
`metrics.json.v1`. Booklet and summary regenerated. Ledger verdicts (and their vetoes) are not re-scored.
Walk arrival (arrived / accepted-in-window): basics-1 5/7, basics-2 8/10, **basics-3 12/12**, newcomer-opus 2/2 (+1
accepted after cutoff), newcomer-rich-124610 2/2, trio-131525 3/6, god-hamlet-2 1/2, pinkteam 3/6.
Truthfulness with chat: basics 0.96–1.00; newcomer-opus 0.80 (riding/swimming over-claims); pinkteam 0.92.
Baseline scorecard over the re-scored originals: "sit down" in place ≤ 15 s 0/6 (both seats walk to a seat object: D2),
batteries arrival 25/29, body moved 60/71, truth 135/139, card result 19/53, out tok/req worst persona 1167.

## Notes for the coordinator

- Replays send the original requests on the original channels at their original offsets, but sequential mode holds a
  seat's next request until the previous one closes, so persona offsets drift; god requests (600 s, sequential) may not
  all fit in god-hamlet-2's 900 s duration.
- Persona replays take `world.natives` from today's scenario file (true); a first replay set on the unchanged build is the
  fresh baseline (`--baseline <that out dir>` for later sets).
- Thresholds not measurable offline: skill size (release check); D1-class W needs the ledger read (scorecard counts all W);
  "pavilion/kitchen inside the polygon" uses the arrival oracle as proxy; "away while waiting" uses listen-open fails.
- Truthfulness claim parsing is heuristic; residual false positives seen: meta-quotes ("my 'I'm riding it' reports").
