# Status

As of **2026-09-30** (the live build id is at `/healthz`). Update this file when the state changes;
it is the single place that says what is true now.

## Live

| | |
|---|---|
| Production | https://sim.eden.art (eden2 Hetzner box), also https://<eden2-sslip-host> |
| Staging | https://<staging-host> (fake brain, separate data) |
| Repo | github.com/genekogan/sim (private); CI green |
| World | `toy-1`, running continuously since 2026-09-30 05:09 UTC; six native Souls (Oda, Pim, Rowan, Tamsin, Juno, Basil) plus owners' Souls |
| Access | invite codes required to create or steer a Soul; watching is open; one admin (Gene) |
| Model spend | capped at $0.50/day by the governor; about $1.4 spent in total so far |
| Durability | Litestream → R2 every 10 s (restore tested), hourly on-box backups, watchdog timer, release folders with rollback |

## Built (the shell)

- Canonical event log, deterministic fold, replay from genesis, snapshots, restore.
- 20 Hz tick loop with clock-rate dial, pause, time dilation.
- WebSocket sync by path decisions; view-hash heartbeat; resync; resume from a ring buffer.
- Privy sign-in, invite gate, Souls (several per account), ownership, retirement.
- Steering: plain-language commands (Jev translator with Haiku fallback), exact intents.
- Agent interface: installable `/skill.md`, pairing both ways, per-Soul tokens, REST
  (`perceive`, `world`, `log`, `intent`, `command`, `wait`), MCP (header or URL token).
- Brain: Jev mid-brain per Soul, Haiku narrator per region, Jev director and ticker;
  every call recorded and inspectable; fair scheduling; spend governor and spend tab.
- Web app: `watch` (anonymous), `my soul` (invite → create → direct → attach agent →
  dashboard with story and thinking), debug tabs (world, brain, story, sync,
  architecture), admin and spend tabs.
- Privacy: model calls visible to admins and the Soul's owner; owners' notes
  removed from every public view.
- Operations: numbered DB migrations, retention, CI, staging-then-production
  deploys, rollback, watchdog, R2 replication.

## Faked or absent (the world)

- **Engine: a toy.** 100 m plane, seven fixtures, straight-line walking, ten verbs.
  The Mars engine is not integrated; no adapter exists yet.
- **No rendering.** The map is text; camera shots are data.
- **Souls do not speak.** "Converse" is an activity without words.
- **Not built from the eden4 design:** manna and any economy, building and
  materials, ground growth, rooms and doors, the daily ritual, generated bodies,
  NFTs or any chain component, asset storage, moderation.
- **Minds are not canonical.** Mood, energy and think-timers are snapshotted but
  not hashed or reproducible from the log.

## Measured

| What | Value | When |
|---|---|---|
| Mid-brain call (Jev) | ~1,900 input tokens, ~220 ms, ~$0.00008 | 09-30 |
| Narrator plan (Haiku, cache warm) | ~$0.003, 3–5 s | 09-30 |
| Tick, 31 Souls / 50 clients | 0.44 ms avg; 2 KB/s per client | 09-30 |
| Tick, 206 Souls / 300 clients | 1.0 ms avg; 22 KB/s per client; all in sync | 09-30 |
| 1,006 Souls / 300 clients | 3.9 ms avg; 129 KB/s per client; clients lose sync | 09-30 |
| Snapshot | 3.5 ms at 31 Souls, 44 ms at 1,000 | 09-30 |
| Server memory | ~150 MB resident | 09-30 |
| Database | ~65 MB after cleanup | 09-30 |

At the target of about 25 people the shell has roughly 100× headroom; it breaks
between 200 and 1,000 Souls because every client receives everything.

## Known limits and risks

- The R2 key in use is eden3's media-bucket writer key (shared bucket, `sim/` prefix).
- An eden3 deploy can drop the Caddy `import` line that serves Sim.
- Secrets on eden2 are readable by both root users (Gene and a second admin).
- Privy free tier ends at 499 monthly users.
- `node:sqlite` is still marked experimental in Node 22.
- Budget and brain mode changed in the admin tab are lost on restart; pairing
  codes and pending approvals are in memory and are cancelled by a restart.
- Real Privy sign-in was confirmed by Gene; the full browser flow is otherwise
  tested with dev accounts.

## Next

Agreed and not yet done, in rough order (`eden4/16-HARDENING-SPRINT.md` has detail):

1. **Mars adapter dry run**: a thin adapter importing the Mars engine read-only,
   run against the conformance suite, to list exactly what the transplant needs.
2. Brain cost: audience-aware cadence, token diet, per-Soul budgets.
3. Protocol version negotiation; hot/cold database split; structured metrics.
4. Asset store on R2; load Privy only on sign-in.

Waiting on Gene: the world ontology (what is state, regions, topics and
subscriptions), and the two questions in `eden4/17-AGENT-INTERFACE.md` (what
agents may see; whether an agent may choose activities directly). The design
discussion for what comes after is in `frontier/`.
