# STATUS-A — arena/ (worker A, 2026-10-24)

## What works (exercised against a real dev world + a real haiku seat)

- `arena/provision.mjs` — `startWorld / stopWorld / healthz / describeWorld / provision` (writes `world.json`, `server/healthz-before.json`).
  Refuses `fork`, `template-eden2`, `live`. Hashes the served `skill.md`, `eden.mjs`, `eden-agent.mjs`, `god/eden-god.mjs`, `instructions.md`.
  **Deviation from DESIGN §0 (coordinator please fold in):** the env also needs `EDGE_SKILL_FILE` and `EDGE_INSTRUCTIONS_FILE`
  (= `<serverRoot>/tools/world-launcher/soul/{skill,instructions}.md`). Without them the world serves `/eden.mjs` 2.0 but the
  **1.9.5 skill and an instructions.md that onboards with `eden-agent.mjs`** (the pre-flight did not catch this; it checked
  status codes only). `world.json.instructions.mentionsEdenMjs` is the guard.
- `arena/seat.mjs` — `createSeat` (empty folder + identity seed only), `Seat.onboard` (§6 text, polls `node eden.mjs status`
  ≤ 180 s; `assist: true` = `--assist-onboard` harness-debug path, recorded `assisted: true`), `chat`, `wakeLoop`, `stop`,
  `retire`, `status`, `turnCount()`, `renderedChatSince(turnIndex)`. Files per DESIGN §3: `seat.json turns.jsonl transcript.jsonl
  cost.jsonl chat-as-rendered.md` plus `listen.jsonl` (every harness listen: cmd, exit, message ids, stdout).
  Wake text is `"[background task] <actual listen command> exited with output:\n" + stdout` (the command includes `--after <id>`
  when used). Turns are serialized; the harness listen is stopped during a turn and restarted after it. Wake chains are capped by
  `rails.maxTurnsPerRequest` (counter reset on each director chat / god card), overflow counted in `seat.json.wakeCapped`.
- `arena/adapters/claude-headless.mjs` — `turn`, `renderChat`, `summarize`, `toolCalls`, `buildArgs`. `--effort` is supported by
  Claude Code 2.1.309 and applied (`seat.json.effortApplied`). Every turn runs with `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1`.
  **Important behaviour found:** `claude -p` does not exit while the agent's own background Bash task (its `listen`) runs, so
  every turn hung to the wall cap. The adapter now ends the process group 3 s after the closing `result` event
  (`turns.jsonl.endedAfterResult: true`); a resumed session also emits an early empty `result` (num_turns 0) which is ignored.
  Allowlist = DESIGN's plus `Bash(cp:*)` (instructions.md step 1 says `mkdir -p .claude/skills/eden-soul && cp …`; a human would allow it).
- `arena/adapters/codex-headless.mjs` — `codex exec --json` first turn, `codex exec resume <threadId>` after (supported by
  codex-cli 0.163.0; `-s/-C` are not accepted by `resume`, so sandbox is set with `-c sandbox_mode="workspace-write"`,
  `-c sandbox_workspace_write.network_access=true`, `-c approval_policy="never"`). Usage is cumulative per thread (verified with a
  recorded resume: output 71 → 76); stored as increments. Codex seats do not wake unless `seat.wake === true`.
- `arena/owner.mjs` — `sendCard`, `cardView`, `cardSummary` (ack = `latest.reply`, result = `latest.result`, `outcome`), `publicSoul`, `ownerSoul`.
- `arena/god-seat.mjs` — `createGodSeat` (Seat on `eden-god.mjs`, `listen --json` wake loop), `seat.onboardGod()`, `seat.sendGodCard({text})`,
  `seat.cardView()`, plus module-level `sendGodCard/godCardView` (POST/GET `/v1/god/inbox` as `Bearer dev:admin`, the GodPanel route).
  §6 god text corrected: the world serves the god skill at **`<base>/god/SKILL.md`** and the CLI at `<base>/god/eden-god.mjs`
  (`/god-skill` and `/eden-god.mjs` fall through to the web app HTML). `<serverRoot>/tools/god-skill/build/` does not exist; `preinstall`
  copies `tools/god-skill/eden-god.mjs`. Default: empty folder, the agent fetches the CLI as the skill says.

## Stubbed / not exercised

- God seat: unit-tested (routes, status parse, listen parse) but **not run against a world with a model** in this lane.
- Codex seat: adapter tested on recorded fixtures only; no Codex seat played in the smoke.
- Turns killed at the wall cap have no `result` event, so their `cost.jsonl` row has null tokens (true cost unknown).

## Smoke (run 2, 2026-10-25 03:37–03:43 UTC, machine load 14–17)

`node tools/playtest/arena/smoke.mjs --out <dir>` → exit 0:

```json
{"ok":true,"world":{"build":"dev","skill":"2.0.0","cli":"2.0.0","instructions2":true},
 "onboard":{"ok":true,"soulId":"s_6e75c5ffff","soulName":"Pip","pairedWithinSec":164,"effortApplied":true},
 "messageId":"msg_d2dc6227-…","ackText":"Got it: sitting down","ackLatencyMs":47603,
 "resultText":"Pip is sitting down on the ground here","outcome":"done","publicState":"seated","activity":"sit-ground",
 "turns":[{"turn":1,"reason":"onboard","wallMs":241093,"tools":13,"timedOut":true},
          {"turn":2,"reason":"wake","wallMs":94217,"tools":4,"exit":0,"timedOut":false,"tokensOut":864}],
 "tokens":{"input":8,"cached":102442,"cacheCreation":2548,"output":864,"costUsd":0.0083},"wakes":1,
 "wall":{"worldMs":32395,"onboardMs":243211,"requestMs":88672,"totalMs":373023},"worldStopped":true}
```

The agent onboarded itself unassisted (curl eden.mjs + SKILL.md, register, create, status, background listen, here, act wave).
Run 1 (before the result-event fix) also paired (182 s) and the seat did post `result … done`, but at 167 s into the wake turn, past
the 120 s cutoff; both its turns hung to 240 s.

Notes for the coordinator:
- Each `node eden.mjs` call took ~20–25 s in both runs (here, act, create, status), so a 7-step onboarding uses the whole 240 s turn
  cap and pairing lands at 160–180 s, at the edge of the 180 s rule. Cause not investigated (machine load was 14–17; a running world's
  healthz answers in ms). Consider a larger onboarding cap, or measure CLI latency at preflight.
- The agent tried to read the identity seed (`node -e require('./.eden-agent.json')…`); the allowlist denied it. A seeded folder
  looks "half set up" to the agent; harmless here.
- **Codex seats load Gene's global `~/.codex/AGENTS.md`** even with `--ignore-user-config` (verified: it knows about "walkie").
  The only fix found is a separate `CODEX_HOME`, which means handling the auth file; not done. Fidelity/privacy limitation for codex seats.
- Codex follows instructions.md step 4 by running `listen` in the foreground as its last command, which will hold every codex turn
  to the wall cap. Not handled yet.

## Tests

`node --test tools/playtest/arena/` — 16 tests on recorded fixtures (`arena/fixtures/*.jsonl`: one Claude stream-json turn, one
Codex turn + resume), no world or model needed: stream parsing, usage, tool pairing, renderChat (both adapters), arg building,
owner/god route requests, card summary, listen-output parsing, wake/onboarding text, seat folder seeding, codex wake default,
rendered-chat splitting, provision kind refusal and env.
