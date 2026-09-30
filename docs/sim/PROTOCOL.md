# Protocol: events and WebSocket messages

Everything that crosses a process boundary is defined in
`packages/protocol/src/index.ts` (types and zod schemas). This is the prose.

## Log events

`LogEvent { seq, tick, kind, author, payload, at }`, one row per event in `events`.

| kind | author | payload | effect when applied |
|---|---|---|---|
| `birth` | `soul:<id>` or `world` | `{ soulId, entityId, name, description, owner }` | spawn a human at the gate; create the mind |
| `intent` | `soul:<id>` | `{ soulId, intent: {goal, target?, note?}, source: web\|api\|mcp\|system }` | replace the standing intent; re-think at once |
| `decision` | `brain:mid` | `{ soulId, entityId, option, label, steps[], mood, reevalTicks, fallback, call?, trigger }` | `submit('do_activity', …, {preempt: true})` |
| `scene` | `narrator:<region>` | `{ region, narrative, beat: {at_min, kind, directive, targets[], flavor} }` | nudge the named Souls (or, for a `scene` beat, all in the region; `quiet` nudges nobody) and re-think |
| `retire` | `soul:<id>` | `{ soulId, entityId }` | remove the entity and the mind |
| `rules` | `admin` / `system` | `{ clockRate, why }` | recorded; no world effect |
| `admin` | `admin` | `{ action, … }` | recorded; no world effect |

Goals (closed list): `wander, go, follow, attend, gather, converse, rest, perform`.
`note` (≤160 chars) is the owner's private colour for the Soul's mind; it is
stored in the log but removed by `publicEvent()` from every public view.

## WebSocket (`/ws`, JSON, protocol 1)

Client → server (validated; max 20 messages per 10 s, beyond which the socket is
closed with code 1008; 64 KB each):

| message | meaning |
|---|---|
| `{t:'hello', proto, token?, since?}` | join; `token` = Privy access token (or none); `since` = last batch seq for resume |
| `{t:'resync', reason}` | ask for a fresh snapshot |
| `{t:'ping', n}` | latency probe |

Server → client:

| message | when | content |
|---|---|---|
| `welcome` | after hello | `build, proto, worldId, rulesVersion, schema, dt, clockRate, serverTick, serverTime, you` |
| `snapshot` | join, resync, or too far behind | `tick, seq, viewHash, entities, regions, env, paths[], souls[]` |
| `batch` | every 10 ticks (500 ms) | `seq, fromTick, toTick, paths[], changes[], souls[], removedSouls[], log[]` |
| `heartbeat` | every 100 ticks (5 s) | `tick, seq, viewHash, keyframes{id: PoseSample}, clients, clockRate, paused` |
| `log` | on join | last 150 public events |
| `brain` | on join and live | model calls, **scoped**: admins all; owners only calls about their Souls |
| `camera`, `ticker`, `narrative` | live | broadcast shot, ticker lines, narrator plan per region |
| `stats` | every 2 s | server counters |
| `pong`, `error` | | |

`paths[]` entries are `PathCommit { entity, startTick, speed, waypoints: PoseSample[],
activity, actionId }`; a one-waypoint path means "stopped here". `changes[]` entries
are `[tick, entityId, field, value]` with fields `present`, `activity`, `on`, `task`,
`doing`, and `$env.datetime`.

## Client replica (`packages/client`)

`Replica` applies snapshots and batches (a gap in `seq` → resync) and computes any
entity's position at a tick with `samplePath`. `Connection` reconnects with
jittered exponential backoff and resumes from the ring buffer by sending `since`.
On each heartbeat it recomputes `viewHash` (sorted `[id, activity, seat, x mm, z mm]`
for every human) and resyncs on mismatch. A `welcome.build` different from the
page's own build makes the page reload once.

Limits: 30 connections per IP, 2,000 total; a client more than 1 MB behind is
skipped and resyncs at the next heartbeat.
