# Protocol: events and WebSocket messages

Everything that crosses a process boundary is defined in
`packages/protocol/src/index.ts` (types and zod schemas). This is the prose.

## Log events

`LogEvent { seq, tick, kind, author, payload, at }`, one row per event in `events`.
`fold.ts` applies each to the engine and the kernel; `world.ts` then updates minds.

| kind | author | payload | effect when applied |
|---|---|---|---|
| `birth` | `soul:<id>` or `world` | `{ soulId, entityId, name, description, owner }` | spawn a human at the engine's arrival point; make the Soul's Thing at the arrival place with the base deck and up to three default manners; create the mind |
| `intent` | `soul:<id>` | `{ soulId, intent, source: web\|api\|mcp\|system }` | replace the standing intent and its agenda, start the agenda from its first step; re-think at once |
| `decision` | `brain:mid` or `brain:reflex` | `{ soulId, entityId, option, label, steps[], mood?, reevalTicks, fallback, call?, trigger, card?, target?, manner?, approachLen? }` | `engine.perform({actor, label, steps})`, replacing the actor's program; the card is remembered as pending |
| `play` | `soul:<id>` | `{ soulId, card, hash, target, manner? }` | apply the card's changes to the kernel. Refused, with the program stopped, if the card or its hash is unknown, a condition no longer holds, or the coherence rule forbids a change |
| `mint` | `soul:<id>` | `{ card: MintedCard, links?, kinds?, forSoul? }` | add the declared kinds and link kinds that do not exist yet; add the card if its name is free; deal it to `forSoul` if the card under that name has the same hash |
| `deck` | `soul:<id>` or `brain:attune` | `{ soulId, add?, remove?, manners?, why }` | add known cards (a deck holds at most 80), remove cards, set manners (known ones, at most 4) |
| `scene` | `narrator:<region>` | `{ region, narrative, beat: {at_min, kind, directive, targets[], flavor} }` | nudge the named Souls (or, for a `scene` beat, all in the region; `quiet` nudges nobody) and re-think |
| `retire` | `soul:<id>` | `{ soulId, entityId }` | remove the entity, the Soul's Thing, the things it made, its deck and the mind |
| `rules` | `admin` / `system` | `{ clockRate, why }`, `{ vocabulary: { kinds, links, manners, cards }, why }` or `{ kernelBootstrap: { at }, why }` | clock rate: recorded, no world effect. `vocabulary` sets the base vocabulary (kinds, link kinds, manners, base cards): logged once at a world's first tick so its history replays with its own words, and again whenever an admin adopts a newer set. `kernelBootstrap` (logged once for a world that predates the kernel) sets where each Soul's Thing is |
| `admin` | `admin` | `{ action, … }` | recorded; no world effect |

Living worlds additionally accept `mandate` events (add/update/remove/wake/status/
report/condition) and `rules` payloads for day configuration, quiet renewal,
reflection, accepted-baseline recovery, runtime policies and an unsnappable-head
marker. These update replayable state, not just operator metadata. Exact shapes
are defined in `packages/protocol/src/mandate.ts` and `apps/server/src/world.ts`.
Public event projections retain identifiers/status while redacting owner words,
reflection text and recovery recipes. Birth projections hide account IDs.

A `play` is logged by the host when the engine reports that the pending card's
program has reached step index `approachLen`, or has completed. Plays are in the
log, so replay applies them without watching programs.

**Intent.** `{ goal?, target?, note?, agenda?, text? }`; a goal or an agenda is
required.

- `agenda`: 1 to 8 steps `{ card, target?, of? }` (`agendaStepSchema`). `target` is
  one thing. `of` means any target that is that thing, was made by it, or that it
  holds a control link to; it lets a plan name something that does not exist yet
  ("the gathering Rob hosts").
- `goal` (closed list): `wander, go, follow, attend, gather, converse, rest, perform`.
  The server turns a goal into an agenda of base cards before logging the event.
- `note` (≤160 chars) and `text` (≤280, the owner's wish) are the owner's own
  words. They are stored in the log and given to the Soul's mind, and `publicEvent()`
  removes both from every public view.

## WebSocket (`/ws`, JSON, protocol 1)

Public URLs use `/w/<key>/ws`; each connection belongs to one world process.

Client → server (validated; max 20 messages per 10 s, beyond which the socket is
closed with code 1008; 64 KB each):

| message | meaning |
|---|---|
| `{t:'hello', proto, token?, since?, epoch?}` | join; `token` = Privy access token (or none); `since` = last batch seq for resume |
| `{t:'resync', reason}` | ask for a fresh snapshot |
| `{t:'ping', n}` | latency probe |

Server → client:

| message | when | content |
|---|---|---|
| `welcome` | after hello | `build, proto, worldId, rulesVersion, schema, dt, clockRate, serverTick, serverTime, you, epoch?, paused?` |
| `snapshot` | join, resync, or too far behind | `tick, seq, viewHash, entities, regions, env, paths[], souls[]` |
| `batch` | every 10 ticks (500 ms) | `seq, fromTick, toTick, paths[], changes[], souls[], removedSouls[], log[]` |
| `heartbeat` | every 100 ticks (5 s) | `tick, seq, viewHash, keyframes{id: PoseSample}, clients, clockRate, paused` |
| `takes` | recorded chunk broadcast | `serverTick, chunks[]` (physical depiction only) |
| `log` | on join | last 150 public events |
| `kernel` | on join; after a batch when the kernel changed; at least every 200 ticks | `view: KernelView { tick, things, links, decks, vocab, hash, plays }` (unexpired links; `plays` counts successful plays per card) |
| `plays` | on join (last 60), then one per play | `PlayView { seq, tick, soulId, soul, card, target, targetName, manner?, ok, reason?, changes[] }` |
| `talk` | on join (last 40), then when words are rendered | `TalkLine { id, tick, at, from, to, fromName, toName, act, manner?, text, place }` |
| `brain` | on join and live | model calls, **scoped**: admins all; owners only calls about their Souls |
| `camera`, `ticker`, `narrative` | live | broadcast shot, ticker lines, narrator plan per region |
| `stats` | every 2 s | server counters |
| `pong`, `error` | | |

`paths[]` entries are `PathCommit { entity, startTick, speed, waypoints: PoseSample[],
activity, actionId }`. On the toy engine a path is the whole timed walk, and a
one-waypoint path means "stopped here". On the Mars adapter a path is a
two-waypoint keyframe (`speed` 0) sent every 5 ticks while a body moves.
`changes[]` entries are `[tick, entityId, field, value]`. Both engines send
`present`, `activity` and `on`; the toy engine also sends `task`, `doing` and
`$env.datetime`.

`BrainCall.tier` is one of `mid, translate, director, narrator, shot, compile,
talk, attune, reflection`. A reflex decision is recorded as tier `mid` with model `reflex`.

`PlayView.changes` are kernel `Change` values. A refused play has `ok: false`, a
`reason` and no changes. A `TalkLine` is depiction: the act it renders is already
in the kernel as a `said` link.

## Client replica (`packages/client`)

`Replica` applies snapshots and batches (a gap in `seq` → resync) and computes any
entity's position at a tick with `samplePath`. `Connection` reconnects with
jittered exponential backoff and resumes from the ring buffer by sending `since`.
On each heartbeat it recomputes `viewHash` (sorted `[id, activity, seat, x mm, z mm]`
for every human) and resyncs on mismatch. A `welcome.build` different from the
page's own build makes the page reload once. `kernel`, `plays` and `talk` are
passed to handlers (`onKernel`, `onPlays`, `onTalk`) and are not part of the
replica or the view hash.

Limits: 30 connections per IP, 2,000 total; a client more than 1 MB behind is
skipped and resyncs at the next heartbeat.

## Recorded 3D observer

The live view uses `/v1/scene` and `/v1/take` hot chunks, plus `/v1/takes` paged
local/verified archives for rewind. TakePeople/FloaterView sample quantized recorded
poses about one second behind the server. They do not run a browser Runtime or
replace the accepted event-log cursor. Labs execute a separate paused Runtime.
