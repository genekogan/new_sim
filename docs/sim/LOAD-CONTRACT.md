# LOAD-CONTRACT v1 — how a world reports, limits and sheds load (2026-10-31)

Shared contract for the server-reliability tranche (`<team>/TRANCHE-SERVER-RELIABILITY-20261031.md`). Lanes L1 (launcher), L2 (in-world load), L3/L4 (hot paths, dials), L5 (boot), L6 (clients, bench) and L7 (metrics) build to this file and change it only by a commit that names the lanes it affects. Additive to EDGE-CONTRACT-v1: nothing here removes or renames an existing route, code or field.

## 1. Load levels

`green | amber | red | black`, decided by the in-world monitor (L2) from sampled signals with hysteresis (enter on any condition, leave after 30 s below the lower band):

| Level | Enter when any holds | Leave when all below |
|---|---|---|
| amber | tick service < 0.8 · loop delay p99 > 200 ms · heap > 70 % of limit · oldest queued request > 2 s | 0.9 · 100 ms · 60 % · 1 s |
| red | service < 0.5 · loop p99 > 1 s · heap > 85 % · oldest queued > 6 s | 0.7 · 400 ms · 75 % · 3 s |
| black | heap > 92 % with GC share > 40 % over 10 s · service < 0.2 for 30 s | 0.4 · — · 85 % |

**Loop bands are relative to the world's quiet baseline (as built, L2).** A large world's own quiet ticks set its loop-delay floor (the live Eden 2026 copy: quiet tick p99 ~170 ms), so the fixed 200/100 ms amber bands would hold it at amber forever after load stops. Each loop-delay band is therefore `enter = max(absolute, 2 × baseline)`, `leave = max(absolute, 1.2 × baseline)` (red too; heap, service and queue bands stay absolute). *Baseline* = a peak-hold of the loop p99 of quiet 5 s windows (nothing queued, request handler time < 5 % of the window, tick service ≥ 0.95), decaying 2 % per window (half-life ~3 min); a peak because a quiet large world's loop p99 is mostly low (the live Eden copy: ~30 ms) with a window at its heavy ticks' length (~150 ms) every 10–15 s. Each sample is bounded by the world's own tick p99 × 1.25 + 10 ms (un-admitted work such as account creation is not learned) and capped at 400 ms so amber always enters below red's 1 s; load neither teaches nor decays it. Per-world pin: `SIM_LOAD_BASELINE_MS` (registry → launcher env; `0` = absolute bands only, never learned). Loop delay counts for levels (and the baseline) only once two windows have closed after serving (the serving turn's JIT warm-up is not load); service, heap and queue count at once. `/healthz` `load.loopBaselineMs` and every level-change log line report it.

*tick service* = ticks run / ticks due over 5 s. *loop delay* from `perf_hooks.monitorEventLoopDelay`. *GC share* from a `PerformanceObserver('gc')` over 10 s.

Every file that owns a cost has a **dial** and exposes `setLoadLevel(level: Level): void`; the monitor only sets levels, it never reaches into another module's state. Dials registered in v1: perception slice cadence and radius (L4), menu listing radius (L3), Eyes pause (L2, `edge/eyes/routes.ts`), hub batch interval (L2, `hub.ts`), derive scheduling (L4), admission frame budget (L2). Each dial documents its green/amber/red/black values beside the code.

## 2. Request classes

| Class | Routes | Policy |
|---|---|---|
| **C0 control** | `/healthz`, `/v1/config`, `/v1/edge/inbox/listen`, `/v1/edge/wait`, receipts, inbox ack/result | O(1). Never queued, never shed. `/healthz` is answered from the watchdog's numbers (§4), so it answers even when the main thread is stuck. |
| **C1 writes** | `act`, `say`, converse, plans, make, god `commitBatch` / `preview` | Queued with a deadline (acts 20 s, god commits 30 s). Refused `world.busy` only past the deadline. Idempotency keys make a retry safe. An accepted act is never dropped silently. |
| **C2 personal reads** | `here`, `observe`, `capabilities`, `around`, `resolve`, `view` (Eyes), route preview | Shed first. At amber/red may be served stale from cache with `stale: true, asOfTick`. Default deadline 8 s. |
| **C3 public reads** | `map`, `rides`, `items`, `platforms`, `/v1/world/snapshot` | Cached 1–2 s at the launcher so N browsers cost one world call. |

Admission (L2, `apps/server/src/load/admission.ts`): one outstanding heavy (C1/C2) request per Soul; per-Soul CPU-ms token bucket (refill `min(200, 500/awake)` ms/s, capacity 2,000 ms, charged measured handler time); the god holds a reserved 25 % of the request budget; heavy handlers run from a dispatcher after `tickOnce` within a frame budget (25 ms of each 50 ms at green, less above), round-robin across Souls, writes before reads; a job whose deadline passed is answered `world.busy` without running; a job whose socket closed is dropped. Shedding order: duplicate concurrent → C3 to launcher cache → C2 over budget → C2 past deadline (oldest first) → C1 past deadline only.

## 2b. Ceilings for untrusted clients (Gene, 2026-10-31 04:40Z: agents that run Souls are untrusted users; the world must be immune to being taken down by them, accidentally or adversarially)

Enforced server-side whether or not the client honours §3. Two layers, so a world that is already behind is protected by the launcher in front of it:

| Where | Ceiling (v1 defaults; registry-tunable per world) | On breach |
|---|---|---|
| Launcher, per source IP | 60 requests/10 s to any one world's Soul API; 10 concurrent connections; 4 concurrent `listen` sockets | `429 client.rate` + Retry-After; connections above the cap closed at accept |
| Launcher, per account (Soul token → account) | 2 concurrent `listen` per Soul, 8 per account; 120 heavy (C1/C2) requests/min per account across all its Souls | `429 soul.busy` / `account.rate` + Retry-After |
| Launcher, per world | total heavy requests/s = `worldBudgetRps` from the registry (default 10; bench sets it per size class); request body ≤ 64 KB; C3 public reads served from the 1–2 s micro-cache, never forwarded more than once per second each | `503 world.busy` + Retry-After, answered by the launcher without touching the world |
| World (L2 admission) | one outstanding heavy request per Soul; per-Soul CPU-ms budget; god reserve 25 %; **world total CPU-ms budget per frame** (the dispatcher never spends more than its frame budget on requests, whatever the sum of per-Soul budgets) | `429 soul.slow-down` / `503 world.busy`; a Soul over budget 3× in a minute gets a 60 s cool-down (Retry-After: 60) |
| Both | every heavy read requires a Soul or god token (no unauthenticated C2/C3 that costs more than a cache hit — `calendar`, `scenes` are L8's) | `401` |

Design rule for every lane: **the marginal cost of one more agent must be near zero when it is idle and bounded when it is busy**. A connected agent that only listens costs a held socket; its first request costs its own neighbourhood, never the world (§2 of the design, lanes L3/L4/L8). Growth in agents is therefore a budget question (how many budgets the frame can serve), not a stability question.

## 3. The busy signal

- Every edge response carries `X-Sim-Load: green|amber|red|black`. At amber and above, every refusal carries `Retry-After` (seconds, integer ≥ 1).
- JSON refusals and frames add `world: {load, retry_after_s?, note?}`. `note` states a fact about the world in world language ("It is crowded here right now; things take a little longer."), never a suggestion of what the Soul should do (no server-side mind).
- Codes (HTTP): `world.busy` 503 · `soul.busy` 429 (a previous request from this Soul is still being answered) · `soul.slow-down` 429 (budget; Retry-After = refill time) · `world.crowded` 503 (waking limit, flag-gated; body `{position, eta_s}`) · `world.starting` 503 (launcher, during boot; Retry-After ≤ 5).
- Accepted acts under load carry `delayed: true` and `eta_s`. Stale reads carry `stale: true, asOfTick`.
- WS hub sends `{t:'load', level}` on change; the page shows a quiet "the world is busy" pill, not an error.
- Clients (L6) must honour `Retry-After`, back off with full jitter (base 1 s, cap 60 s), auto-retry only reads, send idempotency keys on writes, hold **one `listen` per Soul** (lock), and never loop on `unreachable`. The server enforces the contract regardless.

## 4. `live.json` (watchdog thread → launcher)

A `worker_threads` watchdog started first in `main.ts` reads a SharedArrayBuffer the main thread updates every 250 ms, on every `tickOnce`, and from `stepReplay` during boot. Every 2 s it writes `<DATA_DIR>/live.json` by atomic rename and answers `/healthz`. The worker never touches world state.

```json
{"v":1,"pid":748574,"at":1761880380123,"phase":"serving",
 "boot":{"stage":"replay","tick":51200,"target":53400},
 "loop":{"lastTurnAgeMs":40,"delayP99Ms":180},
 "tick":{"world":53411,"service5s":0.92,"p99Ms":61},
 "heap":{"usedMb":612,"limitMb":1536,"gcPct10s":6},
 "level":"green",
 "queue":{"depth":2,"oldestMs":310},
 "souls":{"awake":3,"waiting":0,"connected":4},
 "shed":{"reads":0,"acts":0}}
```
`phase` ∈ `boot:restore | boot:replay | boot:projection | boot:prepare | serving | stopping`. `boot` present only while booting; `tick`/`queue`/`souls` present only while serving.

Launcher rules (L1): **wedged** = `at` older than 30 s, or `loop.lastTurnAgeMs` > 30,000, or 6 consecutive `/healthz` failures 10 s apart → SIGUSR2 (diagnostic report: heap snapshot near limit / CPU profile if enabled) → SIGTERM → SIGKILL after 20 s → restart. **Boot** is judged by progress: killed only if `boot.tick` has not advanced for 60 s, never on a fixed deadline. Restart backoff full-jitter (1 s base, 5 min cap), reset after 10 min healthy; **5 failures in 30 min → `held`** (no restarts, alert, manual or dashboard resume). While booting, Soul API calls get `world.starting`; after ready, a 60 s admission ramp. At red/black the launcher sheds C2 at the proxy and serves C3 from its micro-cache. Heap per world from the registry (`worldHeapMb`), default 1536; `install.sh` writes no 768.

As built (L1, `tools/world-launcher/guard.mjs` + `children.mjs`): liveness asks the world's watchdog port (`SIM_HEALTH_PORT`, a second child port, given only where the range has two per running world) and falls back to the main `/healthz`, where any answer counts as alive; live.json is believed only when its `pid` is the child's, and is not judged while a world is frozen or within 30 s of waking. A boot with no live.json is judged by its output (5 min of silence). Exit **75** = planned restart: at once, reason `planned`, never a breaker failure. Visitor-started boots that fail count toward the breaker. `ensure()` refusals reach clients as `503 world.held` (Retry-After 60) and `503 world.starting` (Retry-After 5). Resume a held world with `op.mjs resume-world --slug <slug>`. `pool.problems()` codes `wedged` · `held` · `crashloop` (≥ 2 failures in 30 min) · `bootSlow` (> 15 s) go into `/__sim/healthz` `hostCodes` at once (texts loopback-only, `worldProblems`) and into `<data>/world-problems.json` every 10 s for `deploy/host-health.mjs`. Restart counts: `restartsByReason` {exit, wedged, planned, boot, boot-stalled, capacity} and `lastBootMs` in the pool status (L7 metrics). Proxy admission (before the ceilings, never waiting on the world), for `/v1/edge/*` only: a world `starting`/`restarting` → `503 world.starting` Retry-After 5 (visitors' pages and a handover's pause still wait); for 60 s after a *restart* (not a first or idle-wake boot) C1/C2 are admitted for a share of Souls growing 25 % → 100 %, picked by a hash of the Soul token so a Soul is either in or out (`503 world.busy`, Retry-After = when its share comes); level from `X-Sim-Load` on the world's answers in the last 10 s, else live.json: at red/black C2 → `503 world.busy` (Retry-After 2 red, 5 black), C3 micro-cache TTL ≥ 2 s; C1 still goes to the world (its own admission decides). Refusals are counted in the ceilings' `refused` per world.

## 5. Metrics names (L7, prom-client, launcher loopback `/__sim/metrics`)

`sim_world_last_heartbeat_seconds{world}` · `sim_world_event_loop_delay_p99_seconds` · `sim_world_elu` · `sim_world_gc_seconds_total` · `sim_world_heap_used_bytes` / `sim_world_heap_limit_bytes` · `sim_world_tick_seconds` (histogram) · `sim_world_ticks_late_total` · `sim_world_active_souls` / `_waiting` / `_connected` · `sim_world_queue_depth` · `sim_world_queue_oldest_seconds` · `sim_world_shed_total{class}` · `sim_world_last_boot_seconds` · `sim_world_restarts_total{reason=exit|wedged|crashloop|planned}` · `sim_world_level{level}` (0/1) · `sim_client_errors_total{kind}`. Labels: `world` always; no Soul ids, no account ids (privacy).

## 6. WorldDelta v1 (Stage B, lane B-delta; as built, dark behind `SIM_READ_WORKER=1`)

The tick thread publishes the world's replicated state to read workers as one **WorldInit** followed by one **WorldDelta
per tick**. Code: `apps/server/src/split/{delta,world-init,read-model}.ts`; oracle `split/delta-oracle.ts`.

**Position.** Every message carries `{v: 1, gen, seq, tick, logSeq}`. `gen` changes only when the stream restarts (the
engine was replaced, the comms object table reloaded or was replaced, a tap fault); `seq` counts deltas within a gen,
one per completed tick, contiguous from the init's `seq`; `logSeq` = `host.seq`. A replica applies a delta only when it
is the same gen and `seq = its seq + 1` (`Replica.apply` returns false otherwise, and nothing is applied).

**Resumable.** The tap keeps the last 1,200 deltas (60 s). `since(gen, seq)` returns the deltas after `seq`, or null when
the gen differs or they have left the ring: the consumer loads a new WorldInit. On a restart every subscriber gets
`{t: 'resnapshot', gen, reason}` and must load a new WorldInit.

**WorldInit** (plain structured-clone data, no closures): `entities` (L5's shared snapshot view, one copy per tick and
log seq), `env`, `living` (day clock), `static` (the static layer below), `minds`, `faded`, open `receipts`, `programs`,
`holds`, `objects` = L8 `table.snapshot()` `{gen, records}`, placed `items`, `togetherVersion`, `menuInputs`, and for
B-spatial `scene`/`sceneKey`/`pages`/`navReady`. One WorldInit is built per stream state (gen, seq, log seq, object gen,
receipts seen, together version, faded and minds counts) and shared by every consumer asking then. It may be served at
any point between ticks: each delta section is an absolute row or an idempotent upsert (objects skip `gen <=` the
replica's), so the deltas after its `seq` apply exactly even when a write landed between that delta and the init.

**WorldDelta sections** (each present only when non-empty / changed):

| Section | Content | Source on main (never a scan) |
|---|---|---|
| `bodies` | `[id, x, y, z, yaw]` or `[..., human.speed]`, exact numbers | the tracked set: humans, carriers, any entity the tick named |
| `ents` | whole entities: new ones, and ones whose non-pose fields changed | entities the tick named (paths, changes, programme events, receipts) |
| `gone` | entity ids removed | `present: null` changes, tracked ids that vanished |
| `env`, `living` | whole, when changed | `world.env` (its datetime moves every tick), `host.living` |
| `minds`, `mindsGone`, `faded` | mind rows `{soulId, entityId, name, owner, native}`; faded = the whole set | `host.minds`, `ledger.faded` |
| `receipts` | every phase change since the last delta, in order `{id, soulId, capability, phase, acceptedTick, startedTick, endedTick, code, programId}`; open = waiting/started | `ledger.onReceipt` |
| `programs`, `holds` | `[entityId, programId, step, actionId, verb]`; `[entityId, [{action, slot}]]` | `engine.programOf/programAction`, `nativeSeatHoldsV1`, re-read when the tick named the body |
| `objects` | `{gen, deltas: [{gen, id, record or null}]}` | L8 `table.changes(since)`; null = restart the stream; an unsettled transaction waits |
| `items`, `togetherVersion` | the placed-items list when it changed | read when `together.version` moved |
| `static` | `{epoch, places, shells, solids, fires, regions, spots}` | read when `engine.staticEpochV1()` or `ledger.staticVersion()` moved; checked only when a sync-free key moved (spatial epoch, place writes, spots object, bumpStatic, navReady) |
| `menuInputs` | the ledger's menu-input strings (a god world: commit version, closing sites) | `addMenuInput` sources |
| `scene`, `sceneKey`, `pages`, `navReady` | B-spatial's static scene export (structured clone, not JSON) when the spatial epoch or `entityPhysicsV1.hash` moved; `pageRectsV1()`; `conn.ready` | engine |

Carriers are entities (their `carrier` state rides in `ents`); the replica derives `engine.carriers()` from them.
Not replicated: a programme action's status/phase (they move inside a step with no event), receipt plan/detail/outcome
(written without a receipt notification); B-facade reads those on main or adds them with a notification.

**The tap.** `WorldHost.splitTap(tick, out)` runs right after a completed tick, before `afterTickComplete`, with the
tick's own `paths`/`changes`/`programs` (the arrays the viewer Batch accumulates: one per-tick batch for both). It only
reads. Installed by `installDeltaStream(host, ledger)` when `SIM_READ_WORKER=1`; otherwise nothing runs.

**Measured** (live-copy fixture eden-2026, 4,543 entities, 11,584 objects, 7 Souls of which 6 walk, laptop, CPU =
`threadCpuUsage` of the tick thread): see the B-delta status file for the soak receipt. NUMBERS

## 7. What this contract does not do
No server-side Soul mind (queue, delay, refuse — never choose or retry an act for a Soul). No travel or overflow instances. The waking limit (`world.crowded`) ships dark behind `SIM_WAKING_LIMIT=1` until Gene turns it on. Carryables stay opt-in. The god is never starved.
