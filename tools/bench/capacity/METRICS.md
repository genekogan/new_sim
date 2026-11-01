# Capacity bench — metrics (FROZEN v1, 2026-10-31, before the first run)

Frozen before any number was taken (LESSONS-20261026 §2). A change to a definition below is a new version (v2), and
v1 and v2 numbers are never put in one table. Pass bars: `team/TRANCHE-SERVER-RELIABILITY-20261031.md` §2 (copied in
`REPORT.md` beside each result). Contract the numbers refer to: `docs/sim/LOAD-CONTRACT.md`.

## Run shape (every arm, every repeat)

One fresh world process per (arm, repeat): the fixture copied into an empty `DATA_DIR`, `BRAIN_MODE=fake`,
`MIND_DRIVER=edge`, `DEV_AUTH=1`, `NODE_OPTIONS=--max-old-space-size=<heapMb>` (default 768, the production value on
main `da5269cd0`), the launcher's malloc env, `--inspect` on a loopback port (heap reads only). Phases, wall-clock:

| Phase | Length | What runs |
|---|---|---|
| boot | until `/healthz` answers, then until `perceive catch-up` is logged (≤ 300 s) | nothing |
| join | as long as it takes | N Souls `register` + `create` with the world's own `/eden.mjs` (dev auth) |
| warm-up | 60 s | the full load (below); not measured |
| idle | 30 s | Souls joined, each holding its `listen`, its `wait` long-poll and its viewer socket; no other requests |
| active A, active B | 120 s each | the full load |
| (calibration, N=1 arm only) | ≤ 60 s per class | 20 serial requests per class, one Soul |

Fake minds only: no model is ever called ($0). Scripted Souls run the **real CLI** (`eden.mjs` served by the world
under test), one outstanding command per Soul (as an agent does), so client etiquette is part of what is measured.

**Load per Soul per minute:** 1 held `listen` (the real CLI); a `wait` long-poll stream (55 s, raw HTTP in the driver, so 24 Souls are not 24 more processes); 6 `here`/`observe` (alternating), 2 `caps --search`,
2 `resolve`, 1 `around`, 2 `act` (walk to a named place; every third a sit), 1 `say`; one headless viewer WebSocket per
Soul. Commands are spread over the minute with ±30 % jitter.

## Arms

| Arm | Souls | Clients |
|---|---|---|
| `n1`, `n6`, `n12`, `n24` | 1, 6, 12, 24 | the load above |
| `incident` | 6 | tonight's pattern: every command wrapped in the old user script (up to 6 tries, 15 s apart, on any non-zero exit); 3 of the 6 Souls get a **new** `listen` every 20 s without the old one being stopped |
| `hostile` | 6 | the load above **plus** 4 parallel raw-HTTP loops per Soul (`here`, `capabilities`, `act`, `say` round-robin) that ignore Retry-After and retry instantly on any answer or failure |

Two repeats of every arm; results are reported as the range of the two (min–max), never one picked number.

## Metrics (per active window; the reported value is the worse of A and B unless named otherwise)

| # | Name | Definition |
|---|---|---|
| M1 | **tick service** | (world tick at window end − at start) ÷ (window seconds × 20). Nominal 20 ticks/s (`world.ts` TICK_MS 50). From `/healthz`.tick. |
| M2 | **healthz p99** | p99 of `/healthz` wall time, polled every 1 s with a 5 s timeout; a timeout counts as 5 s. Also: share answered within 1 s. |
| M3 | **act p99 / read p99** | p99 wall time of the CLI command (spawn to exit) for C1 (`act`, `say`) and C2 (`here`, `observe`, `caps`, `resolve`, `around`). Includes the CLI's own designed waits. CLI startup (`eden.mjs version`, median of 10) is reported beside it and not subtracted. Long-polls (`wait`, `listen`) are excluded. |
| M4 | **heap peak** | max V8 heap used, from `Runtime.getHeapUsage` over the inspector (the world runs with `--inspect=127.0.0.1:<port>`; no profiler, no snapshots), sampled every 2 s over the whole run after boot; % of cap = peak ÷ heapMb. RSS peak (`/proc/<pid>/status` VmRSS, or `ps -o rss` on macOS) beside it. |
| M5 | **wedge** | any 30 s span (sliding, 1 s steps) of the run after boot in which no `/healthz` answered. Reported yes/no plus the longest gap in s. |
| M6 | **outcomes** | per command: `ok` (exit 0) · designed refusal (exit 75 with `world.busy`/`world.crowded`/`world.starting`/`soul.busy`/`soul.slow-down`/`rate-limited`, or HTTP 429/503 with one of those codes for raw clients) · `unreachable` (exit 75 unreachable) · `timeout` (bench kill at 60 s for C2, 90 s for C1) · `error` (anything else, incl. non-designed 5xx). Counted per class. |
| M7 | **CPU-s per request class** | calibration (N=1 arm): world CPU-s spent during 20 serial requests of one class, minus the idle CPU rate × elapsed, ÷ 20. World CPU from `/proc/<pid>/stat` utime+stime (Linux) or `ps -o time` (macOS). |
| M8 | **marginal CPU and memory per additional agent** | (first-class, Gene's bar "adding agents must be cheap") world CPU s/s and RSS MB in the **idle** phase and in the **active** windows, against N over the `n1/n6/n12/n24` arms; least-squares slope = CPU-s per s and MB per added Soul, idle and active, with the intercept (the world with no one in it). Also per-arm (value − n1 value) ÷ (N − 1). |
| M9 | **listeners per Soul** | max over the run of live `listen` processes per Soul folder (client side); and the count of `listen` HTTP requests answered `409 superseded` (server side, from the CLI's exits). |
| M10 | **host** | load average before and after, CPU model, cores in the slice, kernel, node version, source sha, fixture sha256, heapMb. |

## Pass table (tranche §2, eden2 slice only; laptop runs are INDICATIVE and never pass or fail)

| Arm | M1 tick service | M2 healthz p99 | M3 act/read p99 | M4 heap peak | M5 wedge |
|---|---|---|---|---|---|
| n1 | ≥ 95 % | ≤ 200 ms | ≤ 1 s | — | never |
| n6 | ≥ 80 % | ≤ 1 s | ≤ 3 s | ≤ 60 % cap | never |
| n12 | ≥ 50 % | ≤ 1 s | ≤ 5 s or designed refusal | ≤ 70 % cap | never |
| n24 | 100 % of commands answered or refused before their deadline (M6 timeout = 0) | | | | never |
| incident / hostile | — | — | — | — | never; M9 ≤ 1 listener per Soul |

---

# v2 — Stage B (lane B-soak, 2026-10-31; `--load stageb`, frozen before the first eden2 number)

A new version, so v1 and v2 numbers are never in one table (the report's eden2 "before" column is v1, labelled so).
Target (tranche `TRANCHE-STAGE-B-20261031.md`): **N = 100: tick service ≥ 90 %, reads ≤ 300 ms p99**. Through the
launcher only (`--via-launcher`: its proxy, ceilings and read routing are in the path).

## Run shape (changes from v1)

- Phases as v1 (boot, join, warm 60 s, idle 30 s, active A/B 120 s). Join runs 8 Souls at a time (`--join-concurrency`).
- **Load per Soul:** a read every 3–5 s, cycling `here, observe, caps, here, resolve, observe, around`; an act every
  15–30 s (`go to <place>`, every third a `sit down`; every fourth act slot a `say`); one held listener. One command
  at a time per Soul. No `wait` long-poll (v1 had one per Soul); **6 viewer sockets per arm** (`--viewers`), not one per Soul.
- **Clients:** the first 3 Souls (`--cli-souls`; all 6 in `incident`) run the real CLI as in v1. The rest are **raw-HTTP
  Souls** in the driver: the CLI's own requests (`here?include=doHere`, `observe`, `capabilities?all=1`, `POST resolve`,
  `around`, `POST act`/`say` with an idempotency key, `inbox/listen?timeoutMs=50000`), its retry etiquette (6 tries with
  full jitter on no answer; up to 3 waits of the stated Retry-After on a designed busy answer), each from its own
  `X-Forwarded-For`. Reason: N = 100 CLI Souls would be ~200 Node processes (~8 GB) on the driver.
- **Read worker arms** (`--read-worker off,on`): every arm runs once per mode, back to back (`n24@off`, `n24@on`).
  on = registry `readWorkers` = `--read-workers` (default 1; the field `op.mjs set-read-workers` writes) and the launcher
  passes `SIM_READ_MODE=2`; off = `readWorkers: 0`.
- **World budget:** the world's registry `limits.worldBudgetRps` = 200 (`--world-budget-rps`; the field `op.mjs set-limits`
  writes). The launcher default (10 C1/C2 per second for the whole world) would refuse most of N ≥ 50's reads.
- **CPUs** (`--cpus 6-7`, Linux): the world process and all its threads (tick thread, read workers, libuv) pinned with
  `taskset -a` as soon as its pid is in `children.json`, re-pinned after a restart; the launcher and driver stay
  outside. The CPU set is a cpuset by affinity, not a cgroup: no MemoryMax (the V8 heap cap is the limit).

## Metrics (added to v1's; worse active window in the headline)

| # | Name | Definition |
|---|---|---|
| M3v2 | **read p99 / act p99** | p99 wall time of the raw Souls' C2 / C1 requests incl. designed waits (no CLI start-up). The CLI Souls' spawn-to-exit p99 is reported beside it (`CLI read p99`). Per read kind p99 too. |
| M11 | **worker-served share** | over the window, from each worker's `/healthz/read` (`served`, `forwarded`): served ÷ (served + forwarded) of what the launcher routed to the workers. Also: share of raw `here` answers the worker computed itself (`x-sim-read-cpu-ms` present). |
| M12 | **fallbacks** | Δ `sim_world_read_fallback_total` (launcher `/__sim/metrics`) over the active windows; Δ `sim_world_read_routed_total` beside it. |
| M13 | **CPU split** | process CPU-s/s (as v1), workers = Σ Δ`read.threadCpuMs` ÷ window, main = process − workers. |
| M14 | **oracle sample** | on `--oracle-rate` (1 %) of raw reads: B-facade's HTTP cross-thread compare — `here` on main's own port, then on a worker's port, same Soul; field-compared (inbox block stripped) when both are 200 at the same tick and the worker computed its answer. Reported equal / compared, tick-moved and not-served counts, the first differing paths. |
| M8v2 | **marginal cost** | v1's M8 per worker mode over the n arms, plus main and worker CPU slopes. |

## Pass table (eden2 only; laptop runs are INDICATIVE)

| Arm | tick service | read p99 (M3v2) | timeouts | wedge |
|---|---|---|---|---|
| n100 (the gate) | ≥ 0.90 | ≤ 300 ms | 0 | never |
| n6–n50 | reported ("meets"/"misses" the same bar) | | | |
| hostile@on | — | — | — | never; M9 ≤ 1 listener per Soul |
