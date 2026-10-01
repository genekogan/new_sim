# Status

As of **2026-10-01** (the live build id is at `/healthz`). Update this file when the state changes;
it is the single place that says what is true now.

## Live

| | |
|---|---|
| Production | https://sim.eden.art (eden2 Hetzner box), also https://<eden2-sslip-host> |
| Staging | https://<staging-host> (fake brain, separate data) |
| Repo | github.com/genekogan/sim (private); CI green |
| World | `toy-1` on the **toy engine**, running continuously since 2026-09-30 05:09 UTC; six native Souls (Oda, Pim, Rowan, Tamsin, Juno, Basil) plus owners' Souls |
| Access | invite codes required to create or steer a Soul; watching is open; one admin (Gene) |
| Model spend | capped at $0.50/day by the governor |
| Durability | Litestream → R2 every 10 s (restore tested), hourly on-box backups, watchdog timer, release folders with rollback |

## Built

**The shell**

- Canonical event log, deterministic fold, replay from genesis, snapshots, restore.
- 20 Hz tick loop with clock-rate dial, pause, time dilation.
- WebSocket sync; view-hash heartbeat; resync; resume from a ring buffer.
- Privy sign-in, invite gate, Souls (several per account), ownership, retirement.
- Agent interface: installable `/skill.md`, pairing both ways, per-Soul tokens, REST and MCP.
- Operations: numbered DB migrations, retention, CI, staging-then-production deploys,
  rollback, watchdog, R2 replication.

**The meaning layer** (2026-10-01; design in `eden4/18`)

- **Kernel**: things, links, time and five kinds of change (appear/vanish, set, move,
  link/unlink, say). Everything else (kinds of thing, kinds of link, manners, cards) is open
  vocabulary. One rule: an actor changes only itself, what it controls and what it made.
  The kernel replays from the log with no engine.
- **Cards**: named actions with conditions, changes and a depiction. Fifteen base cards; a
  deck and three manners per Soul; a shared library.
- **Plans**: an owner's wish becomes an agenda of cards (`of` for things that do not exist
  yet). One-step lookahead finds travel and unblocking by itself; unplayable steps are passed
  over; a plan impossible for ten minutes is given up.
- **Minting**: a compiler (Haiku) writes missing cards; owners' agents can propose cards;
  every card is validated before it enters the library.
- **Speech**: acts (ask, agree, decline…) are state; words are rendered afterwards by a
  small model and stored beside the record.
- **Minds in three tiers**: reflex (code, free), mid-brain (Jev), compiler (Haiku). Plus the
  narrator per region and the director.
- **Pages**: `grammar` (plays as sentences, things, vocabulary, card library, animation
  to-do), `notebook` (open design questions beside live evidence), deck/plan/speech on
  `my soul`, overheard speech on `watch`.

**A second engine** (2026-10-01; design in `eden4/19`)

- `packages/engine-mars`: the real Mars engine behind Sim's engine contract, imported
  read-only from a local checkout (never copied into this repo). `ENGINE=mars` runs the
  whole shell on it, and one of Mars's own authored scenarios (the meal) runs through it
  unchanged. Not deployed: the Mars code exists only on Gene's laptop.

## Faked or absent

- **Production runs the toy engine**: a 100 m plane, seven fixtures, straight-line walking.
- **No rendering.** The map is text; camera shots are data.
- **Scenes** (several bodies in one coordinated motion: a class, a meal, a carry) are
  designed (`eden4/19` §5), not built.
- **Layered knowing** (atlas, news, memory) and **self-change proposals** (`eden4/18` §6, §8)
  are not built.
- **Not built from the eden4 vision:** manna and any economy, building and materials,
  ground growth, rooms and doors, the daily ritual, generated bodies, NFTs or any chain
  component, asset storage, moderation.
- **Minds are not canonical.** Mood, energy, plan position and think-timers are snapshotted
  but not reproducible from the log.

## Measured

| What | Value | When |
|---|---|---|
| Mid-brain call (Jev) | ~$0.00009, ~220 ms | 10-01 |
| Reflex decision | no model call | 10-01 |
| Compile a wish (Haiku) | $0.007–0.012 (about 7,700 input tokens; a third of that when cached) | 10-01 |
| One exchange of words (Haiku) | ~$0.002 | 10-01 |
| Narrator plan (Haiku, cache warm) | ~$0.003, 3–5 s | 09-30 |
| DJ story, live models, 8 Souls, 3 minutes | $0.041 in total | 10-01 |
| Tick, toy engine, 31 Souls / 50 clients | 0.44 ms avg; 2 KB/s per client | 09-30 |
| Tick, toy engine, 206 Souls / 300 clients | 1.0 ms avg; 22 KB/s per client; all in sync | 09-30 |
| Tick, toy engine, 1,006 Souls / 300 clients | 3.9 ms avg; clients lose sync | 09-30 |
| Tick, **Mars engine**, 20 people strolling | 0.36 ms avg, 8.5 ms worst | 10-01 |
| Mars 2026 campus | loads in 3 ms; walk planning 6 ms avg, 34 ms worst; state hash 1.7 ms | 10-01 |
| Snapshot | 3.5 ms at 31 Souls, 44 ms at 1,000 | 09-30 |
| Server memory | ~150 MB resident | 09-30 |

Tests: 52 (kernel 6, engine contract 4, toy engine 8, Mars adapter 13, brain 6, server 15).
The Mars tests skip where there is no Mars checkout (CI).

## Known limits and risks

- The R2 key in use is eden3's media-bucket writer key (shared bucket, `sim/` prefix).
- An eden3 deploy can drop the Caddy `import` line that serves Sim.
- Secrets on eden2 are readable by both root users (Gene and a second admin).
- Privy free tier ends at 499 monthly users.
- `node:sqlite` is still marked experimental in Node 22.
- Budget and brain mode changed in the admin tab are lost on restart; pairing
  codes and pending approvals are in memory and are cancelled by a restart.
- **A wish costs about a cent.** At $0.50/day the compiler's share covers roughly fifteen
  wishes a day across all owners; each owner is limited to twelve an hour, after which a
  cheaper translator handles plain goals.
- **Any card can target anything anywhere**; only its own conditions limit reach.
- **Cards cannot be retired or revised** once minted. Base cards can be revised for an existing world
  only by adopting a new base vocabulary (an admin action, logged).
- The old goal `follow` now means "go and talk with"; nothing follows continuously.
- On the Mars engine the director's shot list and the map still assume the toy world's layout.
- On the Mars engine, only eight verbs resume exactly from a snapshot; the body language
  uses only those (`eden4/19` §6).

## Next

1. **Take over the Mars engine** (Gene, from 2026-10-02): decide where its code lives; run
   staging on `ENGINE=mars`; a furnished campus world; the first scene; a Mars vocabulary
   pack. Plan in `eden4/19` §8.
2. Layered knowing and memory; self-change proposals (`eden4/18` §6, §8).
3. Cost: a cheap matcher for wishes existing cards already cover; audience-aware cadence.
4. From the hardening sprint (`eden4/16`): protocol version negotiation, hot/cold database
   split, structured metrics, asset store on R2, load Privy only on sign-in.

Waiting on Gene: the questions at the end of `eden4/18` and `eden4/19`. The earlier design
discussion is in `frontier/`.
