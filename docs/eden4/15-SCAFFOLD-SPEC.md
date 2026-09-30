# 15 — Scaffold spec (the wrapper around a faked engine)

Round 11, 2026-09-30. Status: **proposed for the overnight build; open
items in §14 need Gene's answers first.** Disposable starter kit; may be
thrown away. Its job is wiring, not gameplay, and every knob it fakes must
have the same contract as the Mars engine that will replace it.

Related: `14` (MVP technical spec), `11` (formalism). Mars engine facts here
were extracted from `<mars-campus-repo>/viewer`
on 2026-09-30 (release 15).

## 1. What the scaffold is

A text-only web app plus one server process that already has:

1. one canonical, versioned world state on the server (a toy world);
2. many clients synced to it over WebSocket, fault-tolerant, with a heartbeat
   that gradually reconciles;
3. Privy login; logged-in users create a **Soul**, give it a name and a short
   description, and type commands that a server-side brain turns into
   structured intents;
4. the three-tier brain (reflex / Jev mid-brain / narrator) running for real
   against the toy world, with every prompt, answer and decision visible;
5. an agent API (REST + MCP + `skill.md`) with per-Soul tokens and a claim
   flow, so an external Claude can steer a Soul;
6. an append-only event log, periodic snapshots, rules-version tags, and a
   replay-from-genesis test;
7. a debug shell that shows all of the above live;
8. deployed on eden2 at a public address.

Not in scope: 3D, rendering, camera math, animation, construction, terrain,
economy, NFTs, the real engine. The toy engine exists only to exercise the
contract.

## 2. The contract we inherit (from Mars, verbatim where it matters)

The scaffold's `packages/engine-contract` mirrors these names exactly so
wiring the real engine later is an adapter, not a rewrite.

| Mars (viewer/engine) | Scaffold |
|---|---|
| `WorldState { schema, base, tick, entities, regions, env, inventory, rng }` (`world/types.ts:143`) | same shape, `schema: 'eden4-toy-world/1'`, `base.campus = 'toy'` |
| `Entity { id, def, kind, label?, tags?, pose {p, yaw}, provenance, human? {activity, task, level, speed}, reservedBy? }` | same; kinds `human \| fixture \| marker` used |
| `Region { id, label, kind, polygon, level?, provenance }` | same |
| `RngState = [n,n,n,n]` (sfc32), rng inside state | same, copy of `core/rng.ts` |
| `hashOf = sha256(stableStringify(x))`, `physicalView(w)` | same, copy of `core/hash.ts` |
| `DT = 1/20`, `Runtime { submit(verb, params, {id, parent, preempt}), cancel, step(), stateHash(), snapshot(), static restore() }` | same method names and semantics |
| `ActionDef { verb, description, schema (zod), reservations, plan, start, step, cancel }`, `StepResult`, `Diagnostic`, `ActionRecord`, `RuntimeEvent` | same types |
| `ENGINE_RULES_VERSION` string; changing `DT` is a rules change | `'eden4-toy/1'` |
| `describeVerbs(registry) → VerbInfo[]` with `z.toJSONSchema` | same |
| MCP tools generated from an op registry, `engine_<op>` prefix, results as JSON text | same generator, prefix `soul_` / `world_` |
| `Take.tracks: Record<id, PoseSample[]>` with `PoseSample = [tick, x mm, y mm, z mm, yaw mrad]`, `changes: [tick, id, field, value]`, `POS_Q=1000`, `TRACK_TOL` | the **wire format for live motion** (§5) is exactly this |
| `WorldHistory { publishCanonical, commit, fork, read, log, toJSON/fromJSON }`, `Checkpoint { id, stateHash, physicalHash, parent, cause, rulesVersion }` | reused conceptually for snapshots (§4); forks not exposed |
| `RuntimeSnapshot { format, tick, stateHash, data, nextId, eventCursor, violations }` | same |
| Node ≥22.13, ESM, TS type-stripping (`.ts` imports, no build for engine), zod ^4.6, React 19.3, Vite 8, three 0.185 | same versions, pnpm workspace |

**Two demands the scaffold places on the real engine** (record them now,
they are takeover work later): (a) `snapshot()` at any tick with in-flight
actions serialized (`resumable`, `serializeExec/restoreExec` exist per verb
but not universally); (b) a cheap `enumerateActivities(actorId) →
ActivityOption[]` feasibility pass for the brain, since `rehearse` (~200 ms)
is too slow per Soul.

## 3. Repo and layout

`eden4/` (new public GitHub repo, MIT, pnpm workspace):

```
packages/engine-contract   types + interfaces above, hash, rng, zod schemas, conformance test suite
packages/engine-toy        the fake engine: 100×100 m plane, integer-mm poses, verbs below
packages/protocol          zod schemas for every WS/REST/MCP message; shared by server and web
packages/brain             Jev client, prompt builders, narrator, budgets, fakes
apps/server                Node: tick loop, log, snapshots, WS hub, REST, MCP, Privy verify, SQLite
apps/web                   React 19 + Vite: replica, debug shell, Privy login, Soul console
infra/                     systemd unit, Caddy vhost file, deploy.sh (rsync), backup timer
docs/                      skill.md for agents, protocol.md, RUNBOOK.md
```

**Toy engine content:** ground 100×100 m, fixtures `campfire`, `bench×4`,
`kiosk`, `gate` (arrival point), regions `center`, `ring`. Verbs:
`walk_to`, `sit`, `stand`, `ambient_wander`, `converse`, `wave`, `rest`.
Activities (sequence templates): `wander`, `go`, `follow`, `attend`,
`rest`, `converse`, `perform`. Movement is straight-line at 1.35 m/s with a
disc-radius avoidance rule, all integer-mm math (no `Math.sin` in the
engine path) so server and any replica agree bit-for-bit.

## 4. Canonical record: log, snapshots, database

SQLite (`better-sqlite3`, WAL) at `/srv/eden4-data/eden4.db`. One world for
now, `world_id` on every table so Mars can be world #2.

```
worlds        (id, schema, rules_version, dt, clock_rate, created_at)
events        (world_id, seq PK, tick, kind, author, payload JSON, sig, created_at)
                kind ∈ birth | intent | decision | scene | rules | admin
snapshots     (world_id, tick, state_hash, physical_hash, rules_version, snapshot BLOB, created_at)
souls         (id, world_id, owner_user_id, entity_id, name, description, created_at, token_hash, token_created_at)
users         (privy_user_id PK, email?, google_sub?, wallet_address?, role, created_at, last_seen)
brain_calls   (id, world_id, tick, tier, subject, request JSON, response JSON, ms, tokens, cost_usd, applied JSON)
narratives    (id, world_id, tick_from, tick_to, plan JSON, model, cached_tokens, cost_usd)
```

The fold (`11`): `S_{t+1} = E(S_t, verbs_t)` where verbs come from applying
accepted events at their tick. `decision` events are the Jev mid-brain's
choices (so replay never calls Jev). `scene` events are the narrator's.
Snapshot every 5 min and on clean shutdown; on boot, load the latest
snapshot and replay any later events. `pnpm test:replay` folds from genesis
and asserts the final `stateHash` equals the latest snapshot.

Assets: none yet; `/srv/eden4-data/assets/<sha256>` reserved, R2 later.

## 5. Tick loop, broadcast, sync

**Server keeps coarse truth; clients do local polish (Gene, r12).** The
server's job is global state, narrative and the big picture; local
spacetime should be cheap and mostly client-side. So:

- The server simulates **coarse kinematics only**: when an activity
  commits a path (waypoints + speed), the server integrates position along
  it at 20 Hz with trivial integer math, no fine avoidance, no animation.
  That is enough to know arrivals, proximity (for the brain) and
  occupancy. 200 Souls cost microseconds per tick.
- The server broadcasts **decisions, not samples**: on commit, the path
  (waypoints, speed, start tick, activity) in the Mars `PoseSample`
  keyframe format; on change, the `changes` tuple. Between decisions the
  server sends nothing about that Soul.
- Clients run the same kinematic code to place every Soul, and are free to
  add local polish (steering smoothing, avoidance, animation, IK) that the
  server never sees. Two viewers may differ by a step; the server's coarse
  truth is what the brain and the log use.
- A low-rate **pose keyframe** (every 10 s per moving Soul, piggybacked on
  the heartbeat) bounds drift; clients blend to it.
- Steering shows on screen as soon as the next batch arrives (≤500 ms).

Bandwidth ≈ decisions per second × ~200 B, plus keyframes: at 200 Souls
that is a few KB/s per client. The delayed-broadcast-of-samples variant
(server sends every resolved pose, viewers identical, 3 s delay) remains
available as a switch for when exactness matters more than compute.

**Protocol (`packages/protocol`, JSON over `ws`, deflate off):**

```
C→S  hello      { proto: 1, since?: seq, token?: privy_jwt }
S→C  welcome    { worldId, rulesVersion, dt, clockRate, serverTick, delayTicks, you?: { userId, souls[] } }
S→C  snapshot   { tick, stateHash, entities, regions, env }         // on join or resync
S→C  batch      { fromTick, toTick, seq, paths: {id: {startTick, speed, waypoints: PoseSample[]}}, keyframes: {id: PoseSample}, changes, events }
S→C  heartbeat  { tick, seq, stateHash }                            // every 5 s
C→S  resync     { reason }                                         // client's replica hash ≠ heartbeat hash, or gap in seq
S→C  log        { events: Event[] }                                // public log tail, for the ticker + debug
S→C  brain      { calls: BrainCall[] }                             // debug only; gated by role
C→S  ping / S→C pong
```

Fault tolerance: the server keeps a ring buffer of the last ~5 min of
batches keyed by `seq`; a reconnect with `since` replays from the buffer,
otherwise a fresh snapshot. The client maintains a replica (entity table +
buffered tracks), applies `changes`, computes its own `stateHash` of the
replica at heartbeat ticks, and requests `resync` on mismatch. That is the
"gradual syncing heartbeat": most of the time it is a 40-byte confirmation.

Backpressure: skip a client whose `bufferedAmount` exceeds 1 MB; drop it
after 30 s.

## 6. Time and admin dials

`clock_rate` (1.0 default) is a world dial, changed by an `admin` event.
The loop is a fixed-step accumulator: `ticksDue = floor(elapsed × rate /
DT)`, capped at 40 per frame; if the cap is hit three frames running, the
server halves `clock_rate` and logs a `rules`-kind `dilation` event (EVE's
time dilation). Pause/resume is an admin event. Admins are Privy user ids
listed in the env file.

## 7. The brain, for real

Design goals (Gene, r11): high decision volume for intentionality over time
at low cost; give Jev the best data economically; bind its output directly
to the action space; keep clients in sync regardless of brain cadence.

The last goal falls out of §5: brain decisions become `decision` events and
engine actions, and motion is broadcast as resolved tracks, so cadence is
invisible to sync.

### 7.1 Tier 1, reflex

The engine. No model. Runs every action to completion or failure.

### 7.2 Tier 2, mid-brain (Jev, `jev-latest`, `@typesafe-ai/sdk`)

**When to ask.** Per Soul, on any of: a new owner intent (immediately); the
current activity completed / failed / blocked (event-driven, the common
case); a narrator beat targeting this Soul; or a timer `next_eval` that Jev
itself sets (below), clamped to [5 s, 5 min]. Skip the call if the state
fingerprint is unchanged since the last call and the activity is still
running. Cap: a per-world token budget per hour; when exhausted, fall back
to the deterministic default policy and mark decisions `fallback: true`.

**What we send (one request per Soul; batch by region only if the 40 req/s
limit binds).** State is a small object, word-bucketed, no raw numbers:

```json
{
  "world":  { "time": "late afternoon", "weather": "clear", "happening": "a gathering at the campfire (6 souls)" },
  "soul":   { "name": "Verdelis", "about": "a shy gardener who loves fire and music",
              "intent": "attend the gathering at the campfire, then rest",
              "energy": "tired", "mood": "curious",
              "recent": ["walked to the kiosk (done)", "talked with Kalama (ended, pleasant)", "rested on a bench (interrupted)"] },
  "nearby": [ { "who": "Kalama", "what": "a musician", "distance": "close", "doing": "sitting at the campfire" },
              { "who": "campfire", "distance": "near", "doing": "6 souls gathered, lively" },
              { "who": "bench-3", "distance": "far", "doing": "empty" } ]
}
```

Options are **enumerated by code** from feasible activity templates, each
already bound to concrete params, with structured criteria:

```json
"questions": {
  "next": { "type": "choice",
    "instructions": "Given Verdelis's intent, personality and what is nearby, what should Verdelis do next?",
    "criteria": {
      "attend_campfire": { "what": "Walk to the campfire and join the gathering", "not_for": "when already there or exhausted", "examples": ["curious about a crowd", "intent says attend"] },
      "converse_kalama": { "what": "Go talk with Kalama", "not_for": "when Kalama is busy or the soul is shy and tired" },
      "rest_bench3":     { "what": "Walk to the far bench and rest", "not_for": "when something interesting is happening nearby" },
      "wander":          { "what": "Drift around aimlessly", "not_for": "when the intent is specific" },
      "continue":        { "what": "Keep doing the current activity", "not_for": "when it has ended" }
    } },
  "reeval": { "type": "score", "instructions": "How soon should Verdelis reconsider?",
    "criteria": { "0": "in a few seconds, things are changing fast", "1": "in about a minute", "2": "in several minutes, the situation is stable" } },
  "wants_company": { "type": "noul", "instructions": "Does Verdelis want company right now?" }
}
```

**Binding output to actions.** `next.choice` is an `ActivityOption.id`
whose params were fixed by code, so the answer maps 1:1 onto
`engine.submit(verb, params)` for each step of that template. Jev never
emits coordinates or entity ids. We **sample** from `probabilities` with a
temperature and a floor (Pokemon harness pattern) using the world RNG, so
idle life varies but the sampled choice, the probabilities and the seed are
all logged in the `decision` event; replay reproduces it without Jev.
`reeval.score` sets `next_eval`; `wants_company` feeds the narrator digest.

Rules from the jaggedness page baked into the builder: every option carries
`not_for`; there is always an escape (`continue`/`wander`); no numbers
(distances are `close/near/far`, times are words); nearby list ≤ 8, chosen
by code; the state must contain the facts the options depend on; owner text
never enters the state raw — only the closed intent and a ≤200-char sanitized
description; probabilities are normalized in code.

**Cost.** ~1.2k tokens per call. 200 Souls at one call per 30 s ≈ 7 req/s ≈
$0.04/h ≈ $30/month; event-driven cadence is usually sparser. The budget
dial caps it.

### 7.3 Tier 2b, camera director and ticker (Jev)

Same shape, one request per second at most, per feed: code enumerates
candidate shots (`follow <soul>`, `frameGroup <event>`, `establishing`,
`hold`) with `what/not_for`; state is the current shot, seconds held, and
what is happening; a commit window of 8–20 s prevents chatter. In the
scaffold the "camera" is a text line ("BROADCAST: framing the campfire
gathering, 6 souls, held 12 s") and a `ShotSpec` JSON in the Mars camera
type, so the real director can replace it. Per-Soul cinematic follow: on
demand, same call, logged, not a standing stream. The ticker uses a Noul
per new log event ("is this worth announcing to spectators?").

### 7.4 Tier 3, narrator (Claude Haiku 4.5, per region every ~5 min, staggered, prompt caching)

**Per region, not global (Gene, r12):** changing the whole world at once
looks too ordered. Each region (`center`, `ring` in the toy world) has its
own narrator schedule, offset from the others, about every 5 min with
jitter. Input: a cached system block (world bible, activity vocabulary,
the closed directive list, output schema) plus an uncached digest for that
region: last few minutes of its public log compressed to ~40 lines, the
Souls present with intents, moods and `wants_company`, time of day, the
region's active scene intents, and one line per neighbouring region. Output, zod-validated:

```json
{ "summary": "…one paragraph of what is happening…",
  "beats": [ { "at_min": 3, "kind": "scene", "directive": "gathering", "target": "campfire", "flavor": "someone starts a song" },
             { "at_min": 8, "kind": "group", "directive": "converse", "targets": ["Kalama","Verdelis"], "flavor": "they compare gardens" },
             { "at_min": 12, "kind": "soul", "directive": "rest", "target": "Verdelis" } ] }
```

Directives are from the closed activity list; `flavor` is free text that
goes **only** into the Jev state as context, never into the engine. Each
beat is logged as a `scene` event under the `narrator` key when it fires;
the mid-brain sees it as a nudge in the next call and may decline. Cost:
~2 regions × 12/h ≈ 576 calls/day, ~3k tokens each with ~2k cached ≈ $1/day.

### 7.5 Fakes and switches

`BRAIN_MODE = live | replay | fake`. `fake` returns argmax of a heuristic
with the same request/response shapes, so the UI and the log look
identical; `replay` reads `decision` events. Both live in `packages/brain`.

## 8. Accounts, Souls, steering surfaces

- **Privy** (`@privy-io/react-auth` in web; `@privy-io/node` verify on the
  server, bearer JWT). Login methods Google + email. Embedded wallet
  `createOnLogin: 'users-without-wallets'`, wallet UI hidden; the address
  appears only on the debug "me" page. The user-facing copy says "sign in";
  no wallet language.
- **Users** row on first verified request; `role ∈ user | admin`.
- **Soul creation:** several per account (Gene, r12); the UI switches which one you follow. Name (≤32 chars,
  unique per world) + description (≤200 chars). Creation = a `birth` event
  → entity spawned at the `gate` with the default intent.
- **Web console:** click your Soul, type. Server translator: Jev Choice
  over the goal list + Choice over code-enumerated targets near the Soul +
  `unsure` escape; if `confidence < 0.6`, a second pass with Haiku 4.5 tool
  schema; if still unsure, reply "I didn't understand" and log it. The
  result is an `intent` event authored by the user. Rate limit 20/min.
- **Agent API:** `POST /v1/souls/:id/claim` (browser, logged-in) mints a
  claim code; the site shows a paste-able prompt containing
  `https://<host>/claim/<code>`. The agent fetches it, receives a per-Soul
  bearer token (stored hashed), then `GET /v1/skill.md`. Tools (REST and
  MCP `/mcp`, Streamable HTTP, same op registry): `world_query`,
  `soul_status`, `soul_log`, `soul_set_intent` (blocks until the next tick
  accepts, returns the resulting status), `soul_release_token`. 429 with
  `retry_after` over quota. Owner text never enters the log.

## 9. Debug shell (the whole UI for now)

Plain text, monospace, one page with panels; everything updates live:

1. **World:** tick, server time vs display time, clock rate, entity table
   (id, name, activity, pose, task), regions, env.
2. **Sync:** my seq, buffered ticks, last heartbeat hash vs my replica hash,
   resyncs, bytes/s, connected clients (admin).
3. **Log:** the public event log tail with filters by kind/author.
4. **Brain:** every Jev/Haiku call as it happens: tier, subject, the exact
   request JSON, the answer, probabilities, sampled choice, ms, tokens,
   cost; running totals and the budget.
5. **Narrator:** current plan, beats fired/pending, next run countdown.
6. **Camera/ticker:** the broadcast shot line and the spectator ticker.
7. **Me:** Privy user, role, wallet address, my Soul, token status, the
   claim prompt, my intent history.
8. **Console:** the command box for my Soul.
9. **Admin:** pause, clock rate, force narrator run, budget, kick.

## 10. Deployment (eden2)

Follows the mars-mcp precedent, touches nothing of eden3.

- user `sim` (uid ≥1002, no docker group), `/srv/sim` (750, code),
  `/srv/sim-data` (750, SQLite, backups), `/home/sim/sim.env` (0600).
  Repo: `github.com/genekogan/sim` (private for now).
- systemd system unit `eden4.service`: `User=eden4`, `Restart=always`,
  `MemoryMax=1G`, `EnvironmentFile=`, listens `127.0.0.1:4500`, `enable`d.
- Caddy: a **separate file** `/etc/caddy/sites/eden4.caddy` with the vhost,
  and one `import sites/*.caddy` line added to the main Caddyfile (backup,
  `caddy validate`, `systemctl reload caddy`, then curl dev/bp.eden.art and
  <mars-mcp-host>). Note the known risk that an eden3 deploy rewrites the
  main Caddyfile; the separate file survives, the `import` line may not.
- DNS: A record `sim.eden.art → <eden2-ip>` in Route53 (Gene adds
  it; log it in `<notes>/system/internet/actions-log.md`). Cert issues
  automatically once it resolves.
- Deploy: `infra/deploy.sh` = build web locally, rsync `apps/`, `packages/`,
  `infra/` and the web `dist/` to `/srv/eden4`, `pnpm install --prod` on the
  box, `systemctl restart eden4`, health check `GET /healthz`.
- Backup: systemd timer hourly `sqlite3 .backup` to `/srv/eden4-data/backups`
  (keep 48) and a nightly rsync to the laptop from `deploy.sh --pull-backup`.
- Post-check after any reboot: `systemctl is-active caddy eden4`.
- Secrets in the env file only: `PRIVY_APP_ID`, `PRIVY_APP_SECRET`,
  `PRIVY_VERIFICATION_KEY`, `TYPESAFE_API_KEY`, `ANTHROPIC_API_KEY`,
  `ADMIN_USER_IDS`, `BRAIN_BUDGET_USD_PER_DAY`.

## 11. Tests

- `engine-contract` conformance suite: run against the toy engine now,
  against the Mars adapter later. Covers determinism (same seed + same
  submits → same hash on two runs), snapshot/restore mid-action,
  `physicalHash` stability under label/env edits, verb schema round-trip.
- Replay from genesis (§4).
- Sync: two headless clients join at different times, run 60 s of world,
  assert both replica hashes equal the server heartbeat; kill one client's
  socket mid-batch and assert it converges after reconnect.
- Brain builder: snapshot tests of request JSON; fake mode end-to-end.
- Claim flow and token revocation.

## 12. Overnight build order

1. Repo, workspace, contract package, toy engine + conformance tests.
2. Server: SQLite, log, snapshot, tick loop, dials, replay test.
3. Protocol + WS hub + web replica + World/Sync/Log panels.
4. Privy login, users, Souls, birth, Me panel.
5. Brain package: builders, Jev live + fake, decision events, Brain panel.
6. Console translator, agent API, MCP, skill.md, claim flow.
7. Narrator + camera line + ticker.
8. infra: unit, Caddy file, deploy script, backup timer; deploy; smoke test.
9. RUNBOOK.md + handoff note.

Anything not reached is listed in the morning handoff, not silently skipped.

**Preflight 2026-09-30 04:35 UTC:** TypeSafe key OK (319 ms round trip);
Anthropic key OK (Haiku 4.5); Privy app "Sim" reachable via API, the JWT
verification key is fetchable with app id + secret so no dashboard step is
needed; eden2 reachable as root, Node 22.23, pnpm 10.34, port 4500 free,
174 GB disk and 12 GB RAM free, no `import` line in the Caddyfile yet,
`sqlite3` CLI absent (backups use the library's `.backup()` instead);
`sim.eden.art` does not resolve yet (Gene adds the A record).

## 13. Unknown unknowns worth a decision now

- **Privy cliff:** free to 499 MAU, then $299/month (the next tier). Fine
  for the alpha; a rules event later if it grows.
- **Jev accuracy under batching** (many Souls in one state) is unmeasured;
  the scaffold starts one-call-per-Soul and reports latency and accuracy
  in the Brain panel so the batching decision is evidence-based.
- **Jev latency is undocumented** by TypeSafe; harness reports say 100–500 ms.
  The debug panel measures it from night one.
- **Prompt injection:** Soul names, descriptions and commands are attacker
  text. They never reach the engine; they reach Jev only as bounded fields
  and Haiku only inside a data block. The narrator's `flavor` never reaches
  the engine either.
- **Idle cost is the standing cost:** Souls nobody steers still think. The
  per-world budget dial and the `reeval` score are the two brakes.
- **Governance keys:** for now `narrator` and `admin` are server-held
  identities. The log format already has `author`, so moving them to real
  keys later is a rules event, not a schema change.
- **The engine takeover** will hit two gaps recorded in §2 (any-tick
  snapshot, cheap activity enumeration) plus the fact that the Mars
  renderer reads takes, which §5 turns into an advantage.

## 14. Decisions and resources needed before the build

See the chat for the interview; answers are folded back here.

## 15. As built (2026-09-30, overnight)

Repo `github.com/genekogan/sim` (private), checkout `<old-sim-repo>`. Running on
eden2 as `sim.service`; public at `https://<eden2-sslip-host>`, and
at `https://sim.eden.art` once its Route53 A record points at <eden2-ip>.
Details: the repo's `README.md` and `docs/RUNBOOK.md`.

Differences from the plan above:

- **SQLite via `node:sqlite`** (built in) instead of `better-sqlite3`; no native build on the box.
- **Sync = decisions, not samples** (§5 as revised in r12): timed paths + changes in 500 ms
  batches, view-hash heartbeat every 5 s, ring-buffer resume, resync on mismatch.
- **Jev prompts rewritten after reading TypeSafe's official skill and docs** (r13): readable
  option names with `good_when`/`not_for` per option, backticked state paths, a `pace`
  Score with situation levels, `sociable` and `keep_going` Nouls, mood derived in code,
  argmax-or-nucleus selection that never picks options Jev rated near zero, model pinned
  to `jev-1.13.0`. One request per Soul (batching Souls would add distractors for ~10%
  savings). Measured: ~1,900 input tokens and ~220 ms per mid-brain call.
- **Narrator** system prompt carries six worked examples so it exceeds Haiku's cache minimum;
  measured cache reads of 4,465 tokens and ~$0.003 per region plan.
- **Privy app**: email + wallet login enabled; Google is off in the Privy dashboard (Gene's switch).

## 16. Tranche 2 as built (2026-09-30, afternoon)

See `16-HARDENING-SPRINT.md` for the plan and `17-AGENT-INTERFACE.md` for the
agent flow. Done from the sprint: the five §1 defects (backup retention,
database bloat, type check, fair brain scheduling, privacy scoping), numbered
DB migrations with indexed columns, WebSocket inbound validation and
connection limits, build-id reload, immutable asset caching, CI on GitHub,
the invite gate, MCP by URL token, the agent `wait` long-poll, and the claim
fix (pairing by POST). Also: a spend tab, a per-tier budget governor at
$0.50/day, the arrival view, onboarding steps and the per-Soul dashboard.

Done later on 2026-09-30 (evening): Litestream replication to Eden's R2
(restore tested), release folders with staging smoke test and rollback,
watchdog timer, deferred snapshot write (measured 3.5 ms at 31 Souls, 44 ms
at 1,000: the earlier 3.5 MB snapshots were finished-record bloat).

Not yet done from the sprint: topic subscriptions with a region key (Gene:
keep as an idea; he wants to take part in the world-ontology design first), protocol version negotiation, hot/cold
database split, audience-aware cadence and token diet, per-Soul budgets,
world registry, canonical minds, rules epochs, signed events, asset store,
bundle split, and the Mars adapter dry run.
