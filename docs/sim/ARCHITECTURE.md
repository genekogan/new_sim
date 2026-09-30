# Sim architecture

How the shell is put together, as built. For what each part should become, see
`../eden4/`; for current state and gaps, `../STATUS.md`.

## One process

Everything server-side is one Node process (`apps/server/src/main.ts`), TypeScript
run directly by Node's type stripping (no build step for the server).

```
 owners' agents ── REST /v1/agent/*, MCP /mcp ──┐          browser (apps/web)
                                                ▼             │  REST /v1/*, WebSocket /ws
┌───────────────────────────── sim server ──────────────────────────────────────┐
│ http.ts   Hono routes (public, signed-in, admin, agent) + static web app     │
│ mcp.ts    MCP tools over Streamable HTTP (stateless)                          │
│ hub.ts    WebSocket hub: join snapshot, batches, heartbeat, resume, limits    │
│ auth.ts   Privy access-token verification, users, roles                       │
│ souls.ts  Soul lifecycle, intents, perceive, timeline, pairing, wait, invites │
│ world.ts  WorldHost: tick loop, event queue → log → engine, snapshots, views  │
│ brain.ts  three tiers: mid-brain, narrator, director (+ translator, shots)    │
│ governor.ts  daily budget → per-tier token buckets                            │
│ db.ts, migrations.ts   SQLite (node:sqlite), numbered migrations              │
└───────────────────────────────────────────────────────────────────────────────┘
        engine = packages/engine-toy behind packages/engine-contract
```

## The fold

The world is the fold of an append-only event log over the engine (doc
`../eden4/11-STATE-AND-UPDATE-FORMALISM.md`):

1. Inputs (`birth`, `intent`, `decision`, `scene`, `retire`, `rules`, `admin`) are
   queued with `WorldHost.enqueue`.
2. At the next tick boundary each is assigned `seq` and the current `tick`,
   written to the `events` table, and applied (`WorldHost.apply`).
3. The engine steps one tick (`DT = 1/20 s`).
4. Events logged with tick T are always applied when `world.tick == T`, before
   stepping to T+1. Replaying the log from genesis therefore reproduces the state
   hash (`replayFromGenesis`, tested).

Model outputs never enter the engine directly. A mid-brain choice becomes a
`decision` event carrying the concrete verb steps; a narrator beat becomes a
`scene` event. Replay never calls a model.

## Tick loop

`setInterval` every 50 ms; a fixed-step accumulator runs `elapsed × clockRate / 50`
ticks, at most 40 per frame. Three consecutive overruns halve the effective clock
rate (time dilation, down to a quarter of the set rate) and log a `rules` event;
after about ten seconds of keeping up it doubles back toward the set rate.
Dilation is not persisted. Pause and the set clock rate are admin dials; the set
rate persists across restarts.
Every 10 ticks a batch is broadcast; every 100 ticks a heartbeat; every
`SNAPSHOT_EVERY_TICKS` (default 6,000 = 5 min) a snapshot.

## Persistence and recovery

- **Snapshot** = engine runtime snapshot (world + in-flight actions) + minds +
  module state, captured inside a tick; the database write is deferred past the
  tick for periodic snapshots. Also taken synchronously on SIGTERM.
- **Boot** = the latest snapshot, if its rules version matches the engine's, then
  fast-forward through later log events by stepping the engine to their ticks.
  No snapshot, or a rules mismatch → genesis and a replay of the whole log under
  the current rules (rule changes with migrations, "epochs", are not built).
- **Off-box**: Litestream replicates the SQLite file to R2 continuously; hourly
  on-box backups are kept too. See `RUNBOOK.md`.

## Sync (server → clients)

The server does not stream poses. When a Soul commits to walking, the engine
emits a timed path; clients compute positions locally with the shared kinematics
(`samplePath`). See `PROTOCOL.md`. Each heartbeat carries a hash of every human's
activity, seat and position; a client whose replica disagrees requests a fresh
snapshot. A ring buffer of the last 600 batches lets a reconnecting client resume.

## Souls, minds, entities

A Soul exists in three places: a `souls` row (identity, owner, agent token), a
**mind** in `WorldHost.minds` (standing intent, mood, energy, recent history,
next-think time; snapshotted but not part of the hashed engine state), and an
engine **entity** of kind `human`. Ids: Soul `s_<hex>`, entity `h_<hex>`.
Six "native" Souls owned by `system` (Oda, Pim, Rowan, Tamsin, Juno, Basil) are
seeded when the world has no live Souls.

## What is real and what is faked

| Part | State |
|---|---|
| Log, fold, replay, snapshots, restore, tick loop, dilation | real |
| WebSocket sync, replica, resync, resume | real |
| Accounts (Privy), invites, Souls, ownership, agent pairing, MCP | real |
| Mid-brain, narrator, director, translator calling live models | real |
| Spend tracking and governor | real |
| Engine | **toy**: 100 m plane, 7 fixtures, straight-line walking, 10 verbs. Same contract as the Mars engine (`ENGINE-CONTRACT.md`) |
| Rendering | none: the "map" is text; the broadcast shot is a Mars `ShotSpec` shown as data |
| Economy (manna), building, rooms, ritual, NFTs, chain | not built |
| Conversation content | none: Souls "converse" as an activity with no words |
