# 16 — Hardening sprint (from overnight hack to a shell that can hold a few dozen people)

Round 14, 2026-09-30. Status: **proposal; nothing here is built.** Scope is
the app shell only (`<old-sim-repo>`), not the engine. Target: ~25 simultaneous
people, one Soul each, on the public internet, for about a week of work.
Every choice should extend toward hundreds or thousands later without a
rebuild.

## 0. Measurements taken today

| Probe | Result |
|---|---|
| Production process memory after 4 h | 150 MB resident (the 750 MB systemd reports is file cache) |
| Production database after 12 h | 150 MB: 74 MB model-call records, ~70 MB snapshots (3.5 MB each × 20), 1.8 MB events |
| Narrator call record | 22 KB each, because the 13 KB system prompt is stored with every call |
| Hourly backups | full copy each hour, **no retention**: 1.2 GB after 12 h and accelerating |
| Type check (`tsc --noEmit`) | never part of the gate; 2 real errors found |
| Load, 31 Souls / 50 clients (fake brain) | tick 0.44 ms avg, 4.6 ms max; 2 KB/s per client; all in sync |
| Load, 206 Souls / 300 clients | tick 1.0 ms avg; 22 KB/s per client; all in sync; 147 MB |
| Load, 1,006 Souls / 300 clients | tick 3.9 ms; 129 KB/s per client; **843 resyncs**, 22 clients out of sync; 79% of a core |

Reading: at the 25-person target the shell has roughly 100× headroom in CPU
and bandwidth. The real risks at that scale are durability, data growth,
privacy, fairness of the brain budget, the upgrade story, and the engine
swap. Throughput only becomes the problem between 200 and 1,000 Souls, and
the cause is visible: every client receives everything (full Soul records
and full log events), so bytes grow with Souls × clients.

## 1. Defects to fix first (hours, not days)

1. **Backup retention.** Keep the last 6 hourly + 7 daily; ship them off the box.
2. **Database bloat.** Store each distinct prompt once (by hash) and reference
   it; keep full call bodies for 24 h and only the summary row after; keep
   5 snapshots plus one per day; stop storing finished action records in
   snapshots.
3. **Type check in the gate** (`tsc --noEmit` per package) and fix the two errors.
4. **Brain fairness bug.** The governor is one bucket per tier, and Souls are
   served in map order, so with 25 Souls the first few would take the whole
   mid-brain share. Needs a per-Soul fair queue (§5).
5. **Privacy leak.** Any signed-in user currently receives every model call,
   including other owners' typed commands. Scope to owner and admin (§7).

## 2. Reliability and recovery

Server
- **Snapshot off the tick path.** Today the snapshot is serialized and
  written synchronously inside a tick (3.5 MB of JSON). Move the write to a
  worker thread or chunk it; with the real engine this stall will be the
  first visible hitch.
- **Tick watchdog.** systemd `WatchdogSec` with a heartbeat from the loop,
  so a hung loop is restarted, not just a crashed process. Add the site to
  the existing `eden_watchdog.py` for an outside-in check.
- **Off-box, continuous durability.** Litestream replicating the SQLite file
  to R2 (seconds of loss instead of an hour; restore is one command).
- **Rules epochs.** Today a rules-version change makes boot ignore the
  snapshot and replay the whole log under the new rules, which is wrong the
  day the rules really change. Add `epoch` to worlds, events and snapshots;
  a rules change closes an epoch with a final snapshot and a migration
  function, exactly as doc 03 describes. This is the mechanism the engine
  swap will use.
- **Releases and rollback.** Deploy into `/srv/sim/releases/<commit>` with a
  `current` symlink; rollback = flip the symlink. Add a second unit
  (`sim-staging`, fake brain, another port) so deploys are rehearsed.
- **Graceful restarts.** Tell clients "restarting" so they reconnect with
  jittered backoff instead of all at once.

Client
- Jittered reconnect backoff; visible "reconnecting / out of date" state.
- **Build id in `welcome`**: a client running an old bundle after a deploy
  reloads itself instead of mis-parsing new messages.
- React error boundary per panel; pause rendering when the tab is hidden.

## 3. Protocol and upgradeability

- **Inbound validation.** Client WebSocket messages are parsed and cast, not
  validated. Validate with the zod schemas already in `packages/protocol`;
  add per-connection message rate limits and a per-IP connection cap.
- **Topics instead of one firehose.** Split the stream into `world` (paths,
  changes), `souls` (public Soul fields, sent as field diffs, not whole
  records), `log`, `debug` (stats, brain) and `mine` (my Souls). Clients
  subscribe to what they show. At 25 people this is tidiness; at 1,000 it is
  the difference measured above. Make **region** a subscription key now even
  though everyone subscribes to all regions: that is the interest-management
  seam, and it costs nothing to lay today.
- **Version negotiation.** `hello` carries min/max protocol; server picks.
  Every log event gets a schema version. Messages stay JSON (fine to a few
  hundred clients); the topic split is what makes a later binary encoding a
  local change.
- **Database migrations.** A `schema_migrations` table and numbered
  migration files instead of `CREATE TABLE IF NOT EXISTS`.

## 4. Database

- Keep SQLite on one box: it is the right tool until a second process needs
  to write. The `Db` class is already the only place that touches SQL, so
  moving to Postgres later is contained. Two cautions: `node:sqlite` is
  still marked experimental in Node 22 (pin the Node version; the swap to
  `better-sqlite3` is a one-file change), and one writer means one process.
- Add real columns where JSON is being scanned: `events.soul_id` (indexed),
  `brain_calls.mode`, `brain_calls.soul_id`. Today a Soul's history is a
  scan of the last 2,000 events and spend queries use `LIKE` on JSON.
- Separate hot from cold: events and Souls are canonical and small; model
  call bodies and snapshots are large and disposable. Put the disposable
  tables in a second SQLite file so backups of the canonical file stay tiny.

## 5. Cost

- **Per-Soul fair scheduler.** One queue ordered by (priority, last served):
  new owner intent > activity ended > narrator beat > timer. Each Soul gets
  an equal slice of the mid-brain share; unused slices flow to others.
- **Audience-aware cadence.** A Soul that nobody is watching and whose owner
  has not steered in a day can think every ten minutes; a watched or
  recently steered Soul thinks at full rate. Same idea already applies to
  the director (runs only while watched).
- **Token diet.** A mid-brain call is ~1,900 tokens, mostly option criteria.
  Shorten criteria text, drop options the engine can rule out, send 5
  nearby things instead of 8. Target 1,100 tokens (~40% cheaper).
- **Budget scales with population.** Express the budget as dollars per Soul
  per day plus a world floor, so 25 Souls do not think 5× slower than 5.
  At today's rates a lively Soul costs about $0.03–0.05 a day.
- **Invite gate.** Privy's free tier ends at 499 monthly users ($299/month
  after) and every Soul costs brain money. An allowlist or invite codes
  bounds both during the alpha.
- Server cost stays zero extra on eden2; measured load says the box is not
  the constraint at any scale this sprint cares about.

## 6. World-state modeling

- **Minds are outside the canonical state.** Energy, mood, nudges and
  think-timers live in a server map that is snapshotted but not hashed and
  not reproducible from the log. Decide what is canonical: proposed rule is
  that anything another client can see is state (hashed, changed only by
  events), and anything that is scheduling is not.
- **One identity, three records.** A Soul is a DB row, a mind, and an engine
  entity with separate ids. Collapse to one id with clear ownership of each
  field.
- **World registry.** `WORLD_ID` is a constant. Make the host, hub and
  brain per-world and route by world id, so "Mars as world #2" is
  configuration. No second world needs to exist yet.
- **Region as the unit** of snapshots (content-addressed per region, as the
  Mars engine stores blobs), of subscriptions (§3) and of narration (already).
- **Signed authorship.** Events carry an author string, not a signature.
  Add a server signature now (one key) so the log format does not change
  when owners' keys arrive.

## 7. Communications, agents, MCP

- **Scope the debug stream** to admin and to each owner's own Souls.
- **MCP for chat apps.** The endpoint needs a bearer header, which Claude
  Code can send but claude.ai and ChatGPT connectors cannot; they need OAuth
  or a secret URL. Add a per-Soul secret-URL form (`/mcp/<token>`) so a
  low-tech owner can paste one link into their assistant.
- **A `wait` tool.** Agents currently poll. Add a blocking call ("return
  when my Soul's activity ends, something addresses it, or after N
  seconds") for REST and MCP. It is the natural rhythm for an LLM agent and
  removes polling load.
- **Claim links** are consumed by a plain GET, so a link-preview bot can
  burn one. Require a POST or a confirm step.
- **Presence**: who is watching, and an "owner is here" flag on Souls.
- Missing piece for engagement, outside this sprint's list: Souls
  "converse" but exchange no words. When wanted, it is a fourth brain tier
  (a small text model writing lines, logged as events).

## 8. Assets and CDN

- Nothing is stored yet; build the path before the engine needs it:
  content-addressed objects (`sha256` keys) in an R2 bucket behind a custom
  domain, an `assets` table (hash, type, bytes, uploader, license), and an
  `ingest` event kind. Exercise it with one fake asset type (a Soul
  portrait or a placeholder body file).
- Hashed web files should be served with `Cache-Control: immutable`; today
  they are served by Node with no cache headers.
- **Split the bundle.** Privy is most of the ~3 MB client and anonymous
  spectators never need it. Load it only when someone clicks "sign in".

## 9. Organization and documentation

- CI on GitHub Actions: type check, tests, build; block deploy on red.
- The load probe used for §0 becomes a checked-in benchmark with thresholds.
- Structured logs and a `/metrics` endpoint (tick time, clients, queue
  depth, brain latency, spend) instead of journald text.
- `docs/PROTOCOL.md`, `docs/STATE.md`, and short decision records for the
  choices in this file.
- **`docs/ENGINE-ADAPTER.md` plus an adapter dry run.** The single most
  valuable de-risking step: in the Sim repo, write a thin adapter that
  imports the Mars engine read-only and run the conformance suite against
  it. It will fail, and the failures are the exact list of what the
  transplant needs (snapshot at any tick, cheap activity enumeration, path
  output format). No Mars code is touched.

## 10. Suggested order (seven working days)

1. Defects in §1; CI; load benchmark checked in.
2. Durability: Litestream, snapshot off-tick, watchdog, releases + staging.
3. Database: migrations, real columns, hot/cold split.
4. Protocol: validation, topics + region key, versioning, build-id reload.
5. Brain: fair scheduler, audience-aware cadence, token diet, per-Soul budget; invite gate; privacy scoping.
6. State model: world registry, canonical minds, epochs, signed events.
7. Agents and assets: MCP secret URL, `wait`, claim fix, R2 asset path, bundle split; adapter dry run and docs.

## 11. What this deliberately does not do

No sharding, no second process, no Postgres, no binary protocol, no chain.
Each has a seam prepared above (world registry, `Db` class, topics, signed
events) so adding it later is additive.
