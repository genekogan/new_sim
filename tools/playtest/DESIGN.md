# Playtest — implementation design (contract for the build, 2026-10-24)

Spec: `<team>/PLAYTEST-PROPOSAL-20261024.md` (r6). Pre-flight: `<team>/playtest/PREFLIGHT-20261024.md`.
This file is the contract between the modules. Workers own the files listed under their name; the coordinator owns
`playtest.mjs`, this file and integration. Node 22+ ESM, no TypeScript, no new dependencies beyond what the repo has
(Playwright comes from `mars/viewer`). Everything prints JSON on stdout and logs to stderr. No file here may read a seat's
`.eden-agent.json` after the seat has run `register`; the harness only ever writes the identity seed before.

## 0. Fixed decisions

- **Worlds for stage 3 rung 1**: local dev worlds started from the SOUL3 integration worktree server
  (`--server-root <worktrees>/soul3-integration`), with `INVITE_REQUIRED=0`, `EDGE_CONTROLLER_CLI_FILE` (eden.mjs),
  `EDGE_CLI_FILE` (eden-agent.mjs), `WEB_DIR=<server-root>/apps/web/dist`, `DEV_AUTH=1`, fake minds, one port per world
  from 4990 upward. `tools/god-skill/dev-world.mjs` from that root does the start (it spreads `process.env`).
- **Owner identity**: the harness generates `agent-<24 hex>` per seat, writes `{"identity":"agent-…"}` to the seat
  folder as `.eden-agent.json` before `register`, and acts as the owner with `Bearer dev:agent-…`. The browser signs in
  as the same owner via `localStorage.sim.dev = "agent-…"` (init script).
- **Seat adapters**: `claude-headless` (default) and `codex-headless`. One session per seat for the whole run.
- **Persona and Reviewer and Developer model calls**: `claude -p` with `--model opus` (sonnet allowed for personas via
  scenario), fresh session per call unless the role keeps state (personas keep one session per run: their memory is
  their session).
- **Clocks**: every record carries `t` (UTC ISO) and `mono` (ms since run start, `performance.now()` based). World
  ticks come from the server where present.
- **Budget rails**: `usage.py --json` before provisioning; refuse to start if week ≥ 85 or 5h ≥ 85; abort the play phase
  if a mid-run check shows ≥ 90. Per-seat caps: max turns per request (default 6), max turn wall (default 240 s).

## 1. CLI (`playtest.mjs`, coordinator)

```
node tools/playtest/playtest.mjs run <scenario.json> [--seed n] [--out dir] [--from step] [--server-root dir] [--keep-world]
node tools/playtest/playtest.mjs review <run-dir>          # steps 5–7 again on an existing run
node tools/playtest/playtest.mjs replay <run-dir> --mode scripted|live [--out dir]
node tools/playtest/playtest.mjs compare <runA> <runB>
node tools/playtest/playtest.mjs preflight [--server-root dir]
```

Steps and receipts (each writes `receipts/<n>-<step>.json` with `ok`, `t`, `mono`, details; a failure stops the run and
leaves everything in place):

0 preflight → `preflight.json` · 1 provision → `world.json` · 2 seats → `seats/<seat>/seat.json` · 3 play → everything
under `personas/`, `evidence/`, `shots/`, `seats/*/transcript.jsonl` · 4 close → `close.json` · 5 review → `oracles.jsonl`,
`ledger.tsv`, `issues.md`, `issues.json`, `feature-requests.md`, `feature-requests.json`, `emergence.json` ·
6 develop → `specs/*.md` · 7 report → `REPORT.md`, `journal.md`, `metrics.json`, `replay.json`.

Run dir default: `<team>/playtest/runs/<YYYYMMDD-HHMMSS>-<scenario-name>-<seed>/`.

## 2. Scenario file (`scenarios/*.json`)

```json
{
  "name": "newcomer-rich-1", "version": 1,
  "world": { "kind": "dev", "genesis": "worlds/templates/eden-2026.json", "slug": "pt-eden-a", "port": 4990 },
  "durationSec": 600,
  "seats": [
    { "id": "pip", "adapter": "claude-headless", "model": "haiku", "effort": "medium",
      "persona": "newcomer", "personaModel": "opus", "startOffsetSec": 0,
      "soulName": "Pip", "channelMix": { "chat": 0.3, "card": 0.7 } }
  ],
  "god": null,
  "director": { "mode": "persona", "requestsTarget": 8, "glanceSec": [10, 30], "goal": null,
                "script": null },
  "observer": { "sampleSec": 5, "cameras": ["follow", "wide"], "viewport": [1280, 800], "dpr": 1 },
  "review": { "reviewerModel": "opus", "developerModel": "opus", "rubric": "accept3" },
  "rails": { "maxTurnsPerRequest": 6, "maxTurnWallSec": 240, "quotaStopPct": 90 }
}
```

- `world.kind`: `dev` (this stage). `fork`, `template-eden2`, `live` are reserved; `provision.mjs` must refuse them
  with a clear message.
- `god`: `null` or `{ "adapter": "claude-headless", "model": "opus", "effort": "high", "persona": "first-timer",
  "startOffsetSec": 0 }`. A god seat pairs with `register <url> dev:admin` + `mint`.
- `director.mode`: `persona` (the persona decides what to say, when, on which channel) or `scripted`
  (`script`: `[{ "seat": "pip", "atSec": 5, "channel": "card", "text": "sit down", "budgetSec": 90 }, …]`; used by
  the frozen battery and by scripted replay).
- A seat's `persona` names `personas/<name>.md`.

## 3. Run folder layout

```
scenario.json preflight.json world.json close.json REPORT.md journal.md metrics.json replay.json
receipts/<n>-<step>.json
seats/<seat>/ seat.json transcript.jsonl chat-as-rendered.md cost.jsonl turns.jsonl folder/ (the seat's actual folder)
god/ seat.json transcript.jsonl chat-as-rendered.md cost.jsonl turns.jsonl folder/
personas/<seat>/ sheet.md session.json turns.jsonl ratings.json desires.jsonl shown/<turn>.json shown/<turn>.png
evidence/<requestId>.json evidence/raw/<sha256>.json.gz evidence/session.json
shots/<seat>/<mono>.png shots/wide/<mono>.png shots/index.jsonl
oracles.jsonl ledger.tsv issues.md issues.json feature-requests.md feature-requests.json emergence.json
specs/<id>.md
server/ world.log (window) healthz-before.json healthz-after.json
```

## 4. Module ownership and interfaces

### 4.1 `arena/` — worker A

`arena/provision.mjs`
- `startWorld({serverRoot, slug, port, genesis, dataDir, log}) → {base, pid, build, healthz}`; uses
  `<serverRoot>/tools/god-skill/dev-world.mjs` via `import`, with the env in §0. `stopWorld({pid})` sends SIGTERM and
  waits. `healthz(base)`.
- Writes `world.json`: `{kind, base, slug, port, pid, build, skill: {version, sha256}, cli: {eden.mjs sha256,
  eden-agent.mjs sha256}, startedAt}`. Hashes come from fetching the served files.

`arena/seat.mjs`
- `createSeat({runDir, seat, worldBase}) → Seat`: makes `seats/<id>/folder/`, writes the identity seed, fetches
  `eden.mjs` and `SKILL.md` (and installs `.claude/skills/eden-soul/SKILL.md` the way the skill tells a human's agent to:
  no, the seat does that itself; the harness only fetches what the onboarding guide says to fetch first: nothing. The
  harness provides an empty folder plus the identity seed; the onboarding prompt names the world URL and the agent does
  the rest exactly as a friend's agent would).
- `Seat.onboard()`: first turn with the onboarding text (§6) and waits for `status.paired`; polls
  `node eden.mjs status` in the folder (read-only, prints no credential) up to 180 s. Records `soulId`, `soulName`,
  `ownerIdentity` in `seat.json`.
- `Seat.chat(text, {reason}) → Turn`: a resume turn through the adapter; appends to `turns.jsonl`
  `{turn, reason: "chat"|"wake"|"onboard", startedAt, endedAt, wallMs, usage, finalText, toolCalls:[{cmd, ms}], exit}`;
  appends raw stream to `transcript.jsonl`; appends `{t, mono, inputTokens, cachedTokens, outputTokens, costUsd?}` to
  `cost.jsonl`.
- `Seat.wakeLoop()`: between turns keeps `node eden.mjs listen [--after <lastId>]` running in the folder (stdout
  captured, never filtered); when it exits with messages, calls `chat(<wake text>, {reason: "wake"})` where the wake
  text is exactly what Claude Code shows for a finished background task: `"[background task] node eden.mjs listen
  exited with output:\n" + stdout`. Restarts listen after each turn. For `codex-headless` the loop is **off** unless
  `seat.wake === true` (fidelity: Codex users only see card messages at their next chat turn).
- `Seat.stop()`: ends listen, no more turns; `Seat.retire()`: not needed on a dev world that is deleted with the run;
  on kept worlds the harness retires via the owner's `DELETE /v1/souls/:id`.

`arena/adapters/claude-headless.mjs`
- `turn({cwd, sessionId, resume, model, effort, text, allowedTools, maxWallSec}) → {stream: [events], usage, finalText,
  sessionId, exit, wallMs}`; command: `env -u CLAUDECODE claude -p <text> --model <m> (--session-id <id> | --resume <id>)
  --setting-sources project --strict-mcp-config --mcp-config '{"mcpServers":{}}' --allowedTools … --output-format
  stream-json --verbose`, stdin `/dev/null`, own process group, killed at `maxWallSec` (recorded as `timedOut`).
- Allowlist (default): `Bash(node eden.mjs:*)`, `Bash(node eden-agent.mjs:*)`, `Bash(curl:*)`, `Bash(ls:*)`,
  `Bash(cat:*)`, `Bash(mkdir:*)`, `Bash(pwd:*)`, `Bash(test:*)`, `Read(./**)`, `Write(./**)`, `Edit(./**)`. No MCP, no
  web. Effort via `--effort` if the CLI supports it, else omitted and recorded.
- `renderChat(streamEvents) → markdown`: what a terminal shows: user text, assistant text, each tool call as one
  collapsed line (`⏺ Bash(node eden.mjs act "sit down" --wait)` + first line of the result), final message. This is the
  only form of the transcript a persona may be shown.

`arena/adapters/codex-headless.mjs`
- Same `turn()` shape via `codex exec --ignore-user-config --skip-git-repo-check [-m model] --json` with thread
  resume (`codex exec resume <threadId>` per the installed CLI's help; detect at preflight), usage from the JSONL
  (cumulative-thread semantics: store increments), `renderChat` for its event shape.

`arena/owner.mjs` (the Director's hands on the card)
- `sendCard({base, soulId, identity, text}) → {messageId, sentAt}` via `POST /v1/edge/owner/<soul>/inbox`.
- `cardView({base, soulId, identity}) → inbox owner view` (latest, state, ack/result text, presence, queued).
- `publicSoul({base, soulId})` → `/v1/edge/public/souls/<id>`.

`arena/god-seat.mjs`
- Like a seat with `eden-god.mjs` (copied from `<serverRoot>/tools/god-skill/build/eden-god.mjs` or the served
  `/eden-god.mjs` if the world serves one), pairing `register <base> dev:admin` + `mint` inside the first turn's
  onboarding text (the creator persona's agent does it), `listen`-wake loop with `eden-god.mjs listen --json`,
  `sendGodCard` via the god inbox route the panel uses (`GodPanel.tsx`; find the route), `chat()` identical.

### 4.2 `observer/` — worker B

`observer/world-truth.mjs`
- `snapshotSoul({base, soulId, identity?}) → {t, mono, tick, place, placePath, pos, posture, activity, near, holding,
  following, riding, fade, lastReceipt, receipts: [last 5]}` from `/v1/edge/public/souls/<id>` plus, as the owner,
  `/v1/souls/<id>` status (position, doing, needs) and the owner inbox view; plus `/v1/world` for all souls' doing/region.
- `receipt({base, id, identity})` if an owner/public route exists; else the public soul's receipts list is the source.
- `godSlice({base, godToken?, around:[x,z], radius: 10})`: entities within radius with def, layer, footprint, slots; via
  the god CLI `describe`/`where`/`map --json` run from the god folder when a god seat exists, else via `dev:admin` god
  routes (`/v1/god/snapshot` with `Bearer dev:admin` on a dev world: verify at build time; if not possible, record
  `godSlice: null` and the oracle returns `unknown`).
- `serverWindow({log, fromMono, toMono})` slices the world log; `healthz(base)`.

`observer/browser.mjs`
- `openBrowser({headless: true, gpu: "metal"|"swiftshader"}) `; `openCamera({base, identity, kind: "follow"|"wide",
  soulId, viewport, dpr}) → Camera` (one persistent page each; follow = `#soul/<id>` hash, verify that the camera mode
  becomes follow; wide = default arrival camera; `localStorage.skipgc='t'` always).
- `Camera.shot(outPath) → {t, mono, ms}`; `Camera.legible() → {card: {name, presence, ack, result}, bubbles: [...],
  signs: [...], toasts: [...], roster: [...], raw: innerText}` from the rendered DOM (document the selectors used; fall
  back to `innerText` segments).
- `sampler({cameras, everySec, onShot})` writes `shots/<cam>/<mono>.png` and `shots/index.jsonl`.

`observer/evidence.mjs`
- `openRequest({runDir, seat, requestId, text, channel, sentAt}) → RequestEvidence` and
  `RequestEvidence.sample()` (called on the sampler tick and on card changes), `RequestEvidence.close({cutoffReason})`
  writes `evidence/<requestId>.json`:
  `{requestId, seat, soulId, text, channel, sentAt, ackAt, ackText, resultAt, resultText, resultState, cutoffAt,
   cutoffReason, samples: [snapshotSoul…], receipts: [...], shots: [...paths], chatTurns: [turn ids], legible: [...],
   firstBodyChangeAt, serverErrors: n, cost: {...}}`; bodies over 256 KB go to `evidence/raw/<sha>.json.gz` with a
  projection and `omitted` flags.

### 4.3 `director/` — worker C

`personas/*.md`: one sheet each: `newcomer`, `casual`, `social`, `spectator`, `storyteller`, `boundary`, `pinkteam`,
`expert`, and creators `first-timer`, `tinkerer`, `storyteller-god`, `pinkteam-god`. Each sheet: who they are, axis
position (0–1), vocabulary, patience (seconds before nagging), attention (glance interval range), channel mix,
how they rate (fun 1–5, alive 1–5, plus `feltLikeGod` for creators), what counts as a desire, and the output JSON
contract below. Sheets never mention Eden internals, verbs, IDs or APIs.

`director/persona.mjs`
- `PersonaSession({runDir, seat, sheet, model})` keeps one `claude -p` session (fresh at run start). `step({shown}) →
  decision` where `shown = {screenshotPath, legible, chatRendered (new since last), cardView (as text), elapsedSec,
  lastRequests: [...]}` and the persona must answer JSON only:
  `{ "say": null | {"channel":"chat"|"card","text":"…"}, "waitSec": n, "thought": "…", "rating": null | {"fun":1-5,
  "alive":1-5}, "desires": ["…"], "complaints": ["…"], "done": false }`. The screenshot is passed as a file the
  persona can `Read` (allow `Read(<runDir>/personas/<seat>/shown/**)` only). Persona turns are logged to
  `personas/<seat>/turns.jsonl` with what was shown (`shown/<n>.json` + png copy).
- `finalRating()` asks for the end-of-session rating and desires.

`director/director.mjs`
- `runPlay({runDir, scenario, world, seats, god, observer}) `: real-time loop until `durationSec`: for each seat, at its
  next glance time, gather `shown` (Observer camera for that seat's follow page, legible, chat rendered, card view),
  call `persona.step`, deliver `say` (chat → `seat.chat`, card → `owner.sendCard`), open a `RequestEvidence` for each
  request, close it on result or budget (default budget 180 s, 90 s for T0/T1 if the persona marks `quick: true`),
  and write the **decision log** `personas/<seat>/turns.jsonl`. Scripted mode replaces persona steps with the script.
  Also drives the god persona identically through the god seat.
- Independence: seats are scheduled from separate seeded RNGs (`seed + index`), never share state, and the director
  never passes one seat's information to another persona.

### 4.4 `review/` — worker D

`review/oracles.mjs` — `runOracles(evidence, world) → [{id, status: "pass"|"fail"|"unknown", detail, pointers}]` for:
`ack-latency` (≤ 10 s), `result-sent`, `listen-open` (presence listening/working across samples), `arrival`
(requested place reached: uses the Reviewer-free heuristic: the resolved target from the seat's act output in
transcript if present, else unknown), `posture`, `duration-held`, `inside-solid` (needs godSlice; unknown otherwise),
`no-progress` (walk receipt started and pos unchanged ≥ 20 s), `oscillation`, `stuck-receipt` (started > 3× expected),
`truthfulness-basic` (result says "done"/"arrived"/"sat" and no completed receipt → fail), `vocabulary`
(`capability.unknown` with no match), `duplicate-acts`, `server-errors`, `first-body-change`.
`review/reviewer.mjs` — builds the Reviewer brief (rubric from `<team>/scratch/soul2/accept3/SCORING-NOTES.md`
summarized into `review/RUBRIC.md`, role rules from the spec §2.4/§2.7), calls `claude -p --model opus` once per
request with the evidence projection, oracle results, persona turn(s), and asks for JSON:
`{fidelity: "H"|"P"|"M"|"W", class: "O1".."O5"|null, noticedByPlayer: bool, inputDepth: "realistic"|"debug",
 reason, issue: null|{title, asked, happened, expected, whereWhen, frequency, evidence:[...], repro:{...}},
 featureRequest: null|{title, want, personaWording, count}}`; a session-level call produces emergence metrics'
 narrative part and the story rating. Writes `ledger.tsv`, `issues.{md,json}`, `feature-requests.{md,json}`,
 `emergence.json` (metric part computed in code from evidence: co-location, conversations, shared receipts,
 imitation, individuality, chains; narrative part from the model). **The Reviewer prompt forbids causes, code areas,
 fixes; the module strips and flags any that slip through.**
`review/developer.mjs` — per issue and feature request, `claude -p --model opus` with the issue, its evidence, and
read access to the server root and the client source (`Read`, `Grep`, `Glob` tools only), asking for
`specs/<id>.md`: likely cause, owning area, approach, predeclared bar, lane brief JSON (followup-lanes shape), marked
`DRAFT — NOT IMPLEMENTED`. Never edits files.
`review/metrics.mjs` — `metrics.json` per spec §12.5 from evidence, turns, cost, shots index, healthz.
`review/report.mjs` — `REPORT.md` (spec §12.3), `journal.md` (player's-eye story with embedded shot paths and the
persona's own words), `replay.json` (spec §12.4). `compare.mjs` for two runs.

## 5. Shared helpers (coordinator) — `lib/`

`lib/clock.mjs` (t/mono), `lib/jsonl.mjs`, `lib/proc.mjs` (spawn with group kill, timeout, capture), `lib/hash.mjs`,
`lib/quota.mjs` (`usage.py --json`), `lib/claude-p.mjs` (one-shot model call helper used by personas, reviewer,
developer: `callModel({model, system?, prompt, cwd, allowedTools, sessionId?, resume?, maxWallSec}) → {text, json?,
usage, sessionId}`; parses the last JSON object in the text).

## 6. Onboarding texts (what a human would type; the only harness-authored prompts a seat sees)

Soul seat (chat turn 1): `Make me a Soul in this world: <base>/ . Call it <Name>. Start from <base>/instructions.md.`
(The persona sheet may rephrase in its own voice; the Director passes the persona's wording when in persona mode and
this default in scripted mode.)
God seat (turn 1): `You are the god of my world at <base>/ . Set yourself up from <base>/god-skill (register with
dev:admin and mint, since this is a local world), then wait for my messages.` Verify the served god skill path at build
time (`/god/SKILL.md`?) and correct this line in `god-seat.mjs`.

## 7. Tests

Each module ships `*.test.mjs` with `node --test` on recorded fixtures (no world, no model): adapters' stream parsing
and chat rendering; evidence projection; every oracle on synthetic packs; reviewer/developer JSON extraction and the
forbidden-content filter; metrics; replay round trip. One integration smoke `smoke.mjs` boots a dev world, one seat,
one scripted request, one shot, and tears down (≈ 2 min; run manually).

## 8. Worker rules

- Own only your files; add helpers under your folder. Shared changes go to the coordinator.
- Write `STATUS-<worker>.md` at `tools/playtest/` with what works, what is stubbed, how to run your tests. Commit on the
  lane branch with clear messages; never push; never touch `<repo>` main or the integration worktree's source.
- Context hygiene: keep under ~120k; read only what you need; prefer small files; no full-suite runs.
- Never print or copy a token; never read `.eden-agent.json` after a seat ran; TEST names only.
