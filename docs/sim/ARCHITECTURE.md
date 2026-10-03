# Sim architecture

How the shell is put together, as built. For what each part should become, see
`../eden4/`; for current state and gaps, `../STATUS.md`.

## October 3 world architecture

Four independent processes serve `/w/toy`, `/w/mars`, `/w/littlemartians` and
`/w/eden`, with separate SQLite files, clocks, logs, owner-bound new Souls and
budget ledgers. Caddy routes each world; the common shell and browser-only
Labs/year pages ship in the same immutable release. The Mars engine is a hard
fork under `mars/`, imported through the engine contract inside this repository.

Living Mars and Little Martians keep one-hour world days. Customs and first
light/supper/dusk are observations. Logged decisions choose playable cards from
mandate, context, needs and journal; a seeded fallback makes the same decision
path when paid minds cannot run. There is no routine object or daily action
schedule. Eden remains idle without owner direction. Owner mandate and journal
text stay private; public physical takes contain no owner rules or reflection.

At a daily quiet point the Mars adapter settles finite programs and releases
ordinary controllers, then builds a fresh Runtime from WorldState. Checkpoints
plus logged suffixes preserve engine, kernel and mind state across restarts.
Resumability uses actual ActionDef capabilities. Fault recovery restores an
accepted baseline, avoids the failed card and quarantines repeat faults. Long
soak qualification rejects every physical recovery rather than reading only a
cleared violation list. The 48-day camp proof remains separate from floater proof.

Floater bodies retain the same action registry objects and physical world shape.
Body admission rejects hand-dependent activities with named reasons. A derived
per-Runtime navigation cache opens only the declared floater shafts at the same
0.1 m grid. Continuous shaft motion, height-aware separation, traffic admission
and serializable landing clearances live in ordinary locomotion. Humans retain
the original profile and refuse these shafts. Ceramic recharge and quiet company
are enacted during settled rest; they are not a scheduled replenishment.

The observer records server takes in bounded chunks; the browser draws sampled
poses through TakePeople and FloaterView, about one second behind. Selection,
follow and rewind share this path. Five-minute archives are compressed off-loop,
verified in R2 before local pruning, and indexed forever; SQLite keeps 24 hours.
New-world Labs start paused, run an isolated browser Runtime and expose explicit
movement requests, Play and Reset. They have no server day, ownership or minds.

The sections below retain the earlier shell component description. Native
`system` ownership applies only to the preserved Toy world; all new-world Souls
require the verified human owner. Historical text-only/local-Mars limitations
are superseded by the deployed world architecture above.

## One process per world

Everything server-side is one Node process (`apps/server/src/main.ts`), TypeScript
run directly by Node's type stripping (no build step for the server).

```
 owners' agents ── REST /v1/agent/*, MCP /mcp ──┐          browser (apps/web)
                                                ▼             │  REST /v1/*, WebSocket /ws
┌───────────────────────────── sim server ──────────────────────────────────────┐
│ http.ts   Hono routes (public, signed-in, admin, agent) + static web app      │
│ mcp.ts    MCP tools over Streamable HTTP (stateless)                          │
│ hub.ts    WebSocket hub: join snapshot, batches, heartbeat, resume, limits    │
│ auth.ts   Privy access-token verification, users, roles                       │
│ souls.ts  Soul lifecycle, intents, commands, card proposals, perceive, wait   │
│ world.ts  WorldHost: tick loop, event queue → log → fold, minds, snapshots    │
│ fold.ts   one logged event applied to the engine and the kernel; replay       │
│ deck.ts   a Soul's cards → the options its mind chooses among; plan progress  │
│ brain.ts  reflex, mid-brain, narrator, director, compiler, speech, translator │
│ governor.ts  daily budget → per-tier token buckets                            │
│ db.ts, migrations.ts   SQLite (node:sqlite), numbered migrations              │
└───────────────────────────────────────────────────────────────────────────────┘
   meaning   = packages/kernel (things, links, changes, cards)
   depiction = packages/engine-toy or packages/engine-mars, behind packages/engine-contract
```

The world has two parts. The **kernel** holds meaning: what exists, where it is,
who hosts what, what was asked and agreed. The **engine** holds depiction: bodies
and motion. The kernel never reads poses and replays from the log with no engine.
`ENGINE` selects the engine (`toy` by default, or `mars`; see `ENGINE-CONTRACT.md`).

## Kernel and cards

`packages/kernel` (`types.ts`, `kernel.ts`, `cards.ts`, `vocab.ts`). State is `KState
{ tick, things, links, vocab, decks, nextId }`.

- **Thing** `{ id, kind, name, traits, states, at, born, by }`. `traits` are fixed at
  creation, `states` change, `at` is the id of the thing it is at (or null), `by` is
  its maker (a thing id or `world`).
- **Link** `{ kind, from, to, value?, data?, since, until? }`, keyed `kind|from|to`. A
  link whose `until` tick has passed is invisible to queries and swept later.
- **Five changes** (`Change.op`): `appear` / `vanish`, `set` (a state; null clears
  it), `move` (sets `at`), `link` / `unlink`, `say`. Vanishing a thing also removes
  its links and anything made to exist `with` it (`traits.with`).
- **Saying** is the only source of the speech links. `say` writes `said` (2 minutes,
  data `{act, about?, manner?}`). Act `ask` also opens `asked` (2 minutes). `agree`
  or `decline` closes the asker's `asked`; `agree` writes `agreed` (30 minutes).
- **Vocabulary** (`KState.vocab`: kinds, link kinds, manners, cards) is open data.
  A link kind may be declared `control: true` (`hosts`, `made`, `holds` in the base
  vocabulary). `vocab.ts` seeds 4 kinds, 9 link kinds, 8 manners and 15 cards.
- **Decks**: per Soul, the card names it holds (at most 80) and its manners.

**The coherence rule** (`check()`): an actor changes only itself, what it controls,
and what it made.

- `world` may change anything. Only the world makes or removes a Soul.
- A Soul may never set, move or remove another Soul.
- A thing that is not a Soul may be changed by whoever holds a control link to it.
  If nobody does, only by its maker, or by anyone when `traits.loose` is true.
  Places and regions are made by the world, so nobody can change them.
- `link` must start from the actor; `unlink` needs the actor at one end; `say` is
  from the actor. `said`, `asked` and `agreed` can never be linked or unlinked.
- A control link can be taken only over a thing the actor made, over a loose thing
  nobody controls, or when someone who controls it has an `agreed` link to the actor.
- Bounds: at most 24 things of one maker at a time (`MAX_MADE`), at most 400 links
  from one Soul (`MAX_LINKS`).

`preview(state, changes, by)` checks and applies a batch on a copy and returns the
new state or the refusal `{code, message}`. `applyAll` commits the same batch
atomically: every change passes in order, or none applies. `kernelHash` covers
things, unexpired links, decks, `nextId` and the vocabulary (cards by hash).

**Cards** are data: `{ name, summary, good_when?, not_for?, target, derive?, when,
then, approach, during, wants?, takes }`.

| Field | Meaning |
|---|---|
| `target` | `{kind, same_place?}` or null. The one free choice of a play. Kind `any` accepts every kind; a card is never played on its own actor |
| `derive` | extra slots found through links, e.g. `host` = whoever `hosts` `$target` |
| `when` | up to 8 conditions: `is`, `at`, `notAt`, `linked`, `notLinked`, `noneLinkedTo`, `state`, `notState`, `said`, `distinct` |
| `then` | 1 to 8 steps, one per kind of change: `move`, `set`, `link` (`value`, `data`, `forSeconds`), `unlink`, `say` (`about`), `appear` (`with`, `states`, `linkFromActor`), `vanish` |
| `approach`, `during` | engine verb steps (at most 4 and 6). `approach` runs before the changes apply, `during` after |
| `wants` | motions the card would have liked that no engine verb expresses |
| `takes` | `seconds`, `minute`, `minutes` or `long` |

References are `$actor`, `$target`, `$region`, a derived slot, `$new` (a thing the
card just made) or a literal id; `.at` means "the place of". `validateCard` refuses
a card that: exceeds 4,000 characters; fails the schema; refers to an unknown slot;
moves, links or speaks for anyone but `$actor`; cuts a link `$actor` is not an end
of; sets a state on anything but `$actor`, `$target` or `$new`; makes or cuts a
speech link; makes a Soul; uses an undeclared link kind; changes or removes
`$target` without requiring or taking a control link to it; names a verb the engine
lacks; or reuses the name of a different card. The library holds at most 5,000 cards. A minted card records `hash`, `by`,
`mintedAt` and `origin` (`base`, `compiled`, `agent`).

**One-step lookahead.** `unmet` lists the conditions of a play that do not hold,
`gap` is the fewest unmet over the possible targets, and `enablers` returns the
plays open now that would shrink that gap, each tried with `preview`. This is how
travel and unblocking serve a plan without being written into it.

## The fold

The world is the fold of an append-only event log over the engine and the kernel
(`fold.ts`; design in `../eden4/11-STATE-AND-UPDATE-FORMALISM.md`):

1. Inputs (`birth`, `intent`, `decision`, `play`, `mint`, `deck`, `scene`, `rules`,
   `admin`, `retire`) are queued with `WorldHost.enqueue`.
2. At the next tick boundary each is assigned `seq` and the current `tick`,
   written to the `events` table, and applied: `foldEvent` moves the engine and the
   kernel, then `WorldHost.apply` updates the minds.
3. The engine steps one tick (`DT = 1/20 s`).
4. Events logged with tick T are always applied when `world.tick == T`, before
   stepping to T+1. `replayFromGenesis` therefore reproduces the engine state hash
   and the kernel hash, and `replayKernel` rebuilds the kernel from `birth`, `play`,
   `mint`, `deck` and `retire` events with no engine (both tested).

Model outputs never enter the engine or the kernel directly. A choice becomes a
`decision` event carrying the concrete verb steps; a narrator beat becomes a
`scene` event. Replay never calls a model.

**From a decision to a play.**

1. `deck.ts` builds a Soul's options: every playable (card, target) pair, ranked,
   at most twelve, and at most three targets per card unless they serve the plan.
   Each option's first verb step is checked with `engine.canPerform`.
2. The choice is logged as `decision` with the card, target, manner and the
   resolved steps (`approach` then `during`). The fold starts them as one engine
   program (`engine.perform`).
3. The engine reports program progress every tick. When the approach steps are
   done, the host logs a `play` event. The fold checks the card's conditions
   again, turns it into changes and applies them under the coherence rule.
4. If the play is refused, its program is stopped and that option is not offered
   again for a minute. If it succeeds, the owner's plan may advance, a Soul that
   was greeted, asked or answered re-thinks soon, and the words of anything said
   are rendered (`BRAIN.md`).

`mint` adds a card (and any link kinds and kinds it declares) to the vocabulary
and deals it to a Soul. `deck` adds or removes cards and sets manners. `retire`
removes the body, the Soul's Thing, the things it made and its deck.

## Tick loop

`setInterval` every 50 ms; a fixed-step accumulator runs `elapsed × clockRate / 50`
ticks, at most 40 per frame. Three consecutive overruns halve the effective clock
rate (time dilation, down to a quarter of the set rate) and log a `rules` event;
after about ten seconds of keeping up it doubles back toward the set rate.
Dilation is not persisted. Pause and the set clock rate are admin dials; the set
rate persists across restarts.
Every 10 ticks a batch is broadcast; every 100 ticks a heartbeat; every
`SNAPSHOT_EVERY_TICKS` (default 6,000 = 5 min) a snapshot. The kernel view is
broadcast with a batch when the kernel changed, and at least every 200 ticks.

## Persistence and recovery

- **Snapshot** = the engine's snapshot (world + in-flight actions) + minds + module
  state + the kernel + play counts per card, captured inside a tick; the database
  write is deferred past the tick for periodic snapshots. Also taken synchronously
  on SIGTERM.
- **Boot** = the latest snapshot, if its rules version matches the engine's, then
  fast-forward through later log events by stepping the engine to their ticks.
  No snapshot, or a rules mismatch → genesis and a replay of the whole log under
  the current rules (rule changes with migrations, "epochs", are not built).
- **A snapshot from before the kernel existed** gets a kernel at boot: places from
  the engine, a Thing and a deck per Soul. Where each Soul stood is logged once as
  a `rules` event (`kernelBootstrap`), so a replay from genesis puts each Soul in
  the same place.
- **A world's base vocabulary is in its log.** At the first tick (or, for a world
  that predates this, at its next boot) the kinds, link kinds, manners and base
  cards are written as a `rules` event (`vocabulary`). Replay starts its kernel
  from that, not from `vocab.ts`, so changing a base card in the code changes new
  worlds only. An existing world takes a newer set when an admin adopts it
  (`adopt_vocabulary`), which is another logged `rules` event.
  At start, a mind that has a goal intent and no agenda is given the matching
  agenda of base cards (`Souls.carryOverDirections`; in memory, not logged).
- **Off-box**: Litestream replicates the SQLite file to R2 continuously; hourly
  on-box backups are kept too. See `RUNBOOK.md`.

## Sync (server → clients)

The server does not stream poses. On the toy engine, when a Soul commits to
walking, the engine emits a timed path and clients compute positions locally with
the shared kinematics (`samplePath`). The Mars adapter sends a two-point keyframe
path for each moving body every 5 ticks instead. See `PROTOCOL.md`. Each heartbeat
carries a hash of every human's activity, seat and position; a client whose
replica disagrees requests a fresh snapshot. A ring buffer of the last 600 batches
lets a reconnecting client resume. The kernel, plays and spoken lines travel as
their own messages and are also public over REST.

## Souls, minds, entities

A Soul exists in four places: a `souls` row (identity, owner, agent token); a
**mind** in `WorldHost.minds`; an engine **entity** of kind `human`; and a kernel
**Thing** of kind `soul` whose id is the Soul id and whose `traits.body` is the
entity id. Ids: Soul `s_<hex>`, entity `h_<hex>`.

The mind holds the standing intent, its agenda and position (`agenda`,
`agendaPos`), the card whose effects are still to apply (`pending`), an option to
avoid for a minute after it failed (`avoid`), since when the plan has been blocked
(`planBlockedSince`), mood, energy, recent history and the next-think time. Minds
are snapshotted but are not part of any hash and are not rebuilt by replay.

Six "native" Souls owned by `system` (Oda, Pim, Rowan, Tamsin, Juno, Basil) are
seeded when the world has no live Souls.

## Web app

`apps/web` is one page with tabs: `watch`, `my soul`, `grammar`, `notebook`, `world`,
`brain`, `story`, `sync`, `spend`, `admin`, `architecture`, `everything` (`spend` and
`admin` are shown to admins only). `grammar` shows plays as sentences, the
vocabulary, the motions cards wanted and did not get, every thing, and the card
library. `notebook` sets open design questions beside counts from the running
world. `my soul` shows the Soul's deck and plan, its plays and what was said to or
by it. `watch` includes overheard speech.

## What is real and what is faked

| Part | State |
|---|---|
| Log, fold, replay, snapshots, restore, tick loop, dilation | real |
| Kernel, cards, decks, plays, minting, agendas, lookahead | real |
| WebSocket sync, replica, resync, resume | real |
| Accounts (Privy), invites, Souls, ownership, agent pairing, MCP | real |
| Mid-brain, narrator, director, compiler, speech, translator calling live models | real |
| Spend tracking and governor | real |
| Engine (default) | **toy**: 100 m plane, 7 fixtures, straight-line walking, 10 verbs |
| Engine (`ENGINE=mars`) | the Mars engine through an adapter; needs a local Mars checkout, so it runs only where one exists |
| Speech | the act (ask, agree, chat…) is kernel state; the words are rendered afterwards and change nothing |
| Things made by cards | exist in the kernel only; no engine entity is created |
| Rendering | none: the "map" is text; the broadcast shot is a Mars `ShotSpec` shown as data |
| Scenes (several bodies staged as one), retiring or revising a card | not built |
| Economy (manna), building, rooms, ritual, NFTs, chain | not built |
