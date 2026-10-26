# Playtest round 2 — run plan (draft, 2026-10-26)

Brief: `<team>/PLAYTEST-ROUND2-20261026.md`. Set: `scenarios/round2.json` (8 slots, 9 runs). Nothing here has been
run yet: the files are validated (`node --test tools/playtest/scenarios/test/*.test.mjs`, or
`node tools/playtest/scenarios/lib/validate.mjs` for every scenario and cast) but no world, seat or browser has seen them.

## How to run (laptop, serially; one at a time, machine gate on)

Use a server root at live main (3.97 or later); `--server-root` defaults to the old SOUL3 integration tree, so pass it.

```
R=<repo>   # or a clean worktree at live main
cd <this worktree>
node tools/playtest/playtest.mjs run    tools/playtest/scenarios/wayfind-eden-2026.json    --server-root $R   # 1  ~65 min
node tools/playtest/playtest.mjs run    tools/playtest/scenarios/wayfind-mars-two.json     --server-root $R   # 2  ~65 min
node tools/playtest/playtest.mjs run    tools/playtest/scenarios/wayfind-hello-hamlet.json --server-root $R   # 3  ~60 min
node tools/playtest/playtest.mjs run    tools/playtest/scenarios/look-eden-2026.json       --server-root $R   # 4  ~50 min
node tools/playtest/playtest.mjs run    tools/playtest/scenarios/look-mars-two.json        --server-root $R   # 5  ~50 min
node tools/playtest/playtest.mjs direct tools/playtest/scenarios/casts/podium-eden-hall.json --server-root $R --headless  # 6 ~55 min
node tools/playtest/playtest.mjs direct tools/playtest/scenarios/casts/podium-mars-room.json --server-root $R --headless  # 7 ~55 min
node tools/playtest/playtest.mjs run    tools/playtest/scenarios/newcomer-r2.json          --server-root $R   # 8a ~30 min
node tools/playtest/playtest.mjs run    tools/playtest/scenarios/pinkteam-r2.json          --server-root $R   # 8b ~35 min
```

About 7.5 hours serially. Minutes are estimates: onboarding up to 10, the scenario's `durationSec` (wayfinding 31–32 min,
look 30 min, persona 10–12 min, casts until the last talk, capped at 50 min), then Reviewer + Developer (opus, one call per
request: about 20 min for 24 requests). In the cloud box: `PLAYTEST_SCENARIO=<scenario>` or `PLAYTEST_DIRECT=<cast>` with
`cloud/run-replay.sh` (check `rate_limit_info` and the remaining credits first; Codex is not used by any of these).
After a run, `node tools/playtest/review/rescore-oracles.mjs <run>` re-scores oracles without a model; `verify.mjs <run>`
re-writes a cast's VERDICT.

## What each run scores

| # | run | oracles specific to the round (plus the usual fifteen and the Reviewer) |
|---|---|---|
| 1–3 | wayfinding A/B/C, 12 requests × sonnet + haiku, chat | **target-arrival** (go/find: the body's place name or position at the cutoff vs the template target; any listed alternative counts), **answer-names** (near: the reply names a thing the template places nearby), **answer-direction** (which way: compass words vs the bearing from where the Soul stood when asked, ±50°; unknown if the answer has no compass word or the target is < 8 m away) |
| 4–5 | look/see, 4 × walk → face → look, sonnet | target-arrival; **facing** (heading of the last completed act in the window vs the bearing to the target, ±45°; `view --gaze <it>` also counts); **view-used** (a `view` call; `--out` when the owner asks for a picture, `--alt-only` once on Mars); **named-in-description** (the reply names the thing or its parts) |
| 6–7 | podium casts, 5 haiku seats | allPresent, eachPresented (≥ 40 chars in its turn), inOrder, eachOnce, **fromPodium** (every talk's lines spoken within the podium radius) |
| 8 | newcomer (opus) + pink-teamer (sonnet), eden-district | persona ratings, desires/complaints, Reviewer H/P/M/W, the fifteen oracles |

Truth comes from the genesis templates (`scenarios/lib/world-names.mjs`: op names; positions are the op's `p`, an area's
centroid, or parent + local offset); every `expect.source` and cast `notes` says which op. The validator fails a scenario
whose target is not a placed name or not at its template position. Scripted replays keep each request's `expect`.

## Known limits (read before trusting a fail)

- Place names were read from the templates, not from a running world: a Soul's `placePath` names are the server's place
  refs (e.g. `eden-classroom-1`, `place-commons`), which the arrival oracle matches by substring; position within the
  target radius also counts, so a naming mismatch alone does not fail arrival.
- Facing and fromPodium read positions and headings from receipts (`endedAt`), because the public Soul page has no live
  pose. A Soul that turns without an act, or speaks without any ended receipt, reads as unknown (fromPodium counts
  unknown against the cast).
- Chiba (Mars) has no rooms in its footprint, so "in Chiba" is probably its landmark circle (about 22 m), which also
  covers the kitchen next door: allPresent may over-count on Mars. The podium radius (1.8 m) keeps the tier seats out.
- Eden 2026 has no indoor podium: the hall is the classroom `eden-classroom-1` and the podium is the front of the room
  by the teacher's desk and screen (the outdoor `commons-podium` is the alternative; see the cast notes).
- Which-way answers given as left/right/ahead are not judged (unknown); the Reviewer reads them.
