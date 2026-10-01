# Data: tables, retention, backups

One SQLite file (`node:sqlite`, WAL) at `$DATA_DIR/sim.db`. All SQL is in
`apps/server/src/db.ts`; schema changes are numbered, forward-only migrations in
`migrations.ts` recorded in `schema_migrations` (never edit a shipped one). Three
exist: 1 baseline, 2 `soul_id` columns, prompts, invites and token metadata,
3 `talks`.

| Table | Holds | Notes |
|---|---|---|
| `worlds` | id, schema, rules version, dt, seed, clock rate | one row; the id is `toy-1` whichever engine runs |
| `events` | the canonical log: `seq, tick, kind, author, payload JSON, at, soul_id` | index on `(world_id, soul_id, seq)`; never pruned. `soul_id` is `payload.soulId`, so `mint` events (which carry `forSoul`) have none |
| `snapshots` | `tick, seq, state_hash, physical_hash, rules_version, snapshot JSON` | keeps the latest 5 plus the first of each UTC day for 7 days |
| `users` | Privy user id, email, wallet, role, invited_by | |
| `souls` | id, owner, entity id, name, description, retired_at, token hash/label/created/last used, native | name unique among live Souls |
| `invites` | code, max uses, uses, note | |
| `brain_calls` | one row per model call with the full body; reflex decisions too (model `reflex`, no cost) | debugging data: pruned after 24 h and beyond 6,000 rows (checked every minute) |
| `prompts` | long prompts stored once by hash | never pruned (a handful of rows) |
| `spend_hourly` | cost and tokens per hour, tier, model (live calls only) | exact spend forever |
| `narratives` | narrator plans | never pruned (small; ~600 rows a day at full cadence) |
| `talks` | rendered speech: `id, world_id, tick, at, from_id, to_id, body JSON` (a `TalkLine`) | index on `(from_id, to_id, id)`; the newest 20,000 lines are kept (`Db.pruneTalk`, hourly) |
| `schema_migrations` | applied migration ids | |

**The kernel has no table.** Things, links, decks and the vocabulary (including
minted cards) are rebuilt from the log (`birth`, `play`, `mint`, `deck`, `retire`
and `rules` events; the starting vocabulary is itself a `rules` event) and carried
in snapshots. The snapshot JSON is `{ runtime, minds, seq,
extra, kernel, counts }`: `runtime` is the engine's own snapshot (format
`sim-runtime-snapshot/1` for the toy engine, `sim-mars-snapshot/1` for the Mars
adapter), `kernel` is the whole `KState`, `counts` is successful plays per card,
`extra` is module state such as the narrator schedule. `state_hash` is the engine's
hash; the kernel hash is not stored. A snapshot without `kernel` (written before
the kernel existed) is upgraded at boot (`ARCHITECTURE.md`).

The list behind `GET /v1/plays` (the last 200 resolved plays) is in memory only.
Spoken words are depiction: losing `talks` loses no state.

Canonical and small: `worlds`, `events`, `users`, `souls`, `invites`. Disposable and
large: `brain_calls`, `snapshots` (rebuildable from the log), `narratives`, `talks`.

Maintenance, hourly in-process (and once a minute after boot): prune call bodies,
`VACUUM` when more than 30% of pages are free, write `backup-YYYYMMDDHH.db`, keep
the 6 newest plus the 00:00 UTC file of each of the last 8 days.
Off-box: Litestream (see `RUNBOOK.md`). Assets: none stored yet.
