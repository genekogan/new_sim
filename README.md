# Sim

Scaffold for eden4: one canonical, server-simulated world shared by every
client, with inhabitants called **Souls** that owners steer and a three-tier
brain keeps alive. The engine is a **toy** (a 100 m plane, a campfire,
benches) behind the same contract as the Mars world engine, which replaces it
later. The UI is a text-only debug shell.

Live: https://sim.eden.art (once DNS points at eden2) · https://<eden2-sslip-host>

## Layout

| Path | What |
|---|---|
| `packages/engine-contract` | The engine contract, mirrored from Mars `viewer/engine`: `WorldState`, `Runtime` (submit / step / snapshot / restore), `ActionDef`, hashing, rng, timed-path kinematics, and a **conformance suite** any engine must pass |
| `packages/engine-toy` | The fake engine. Verbs `walk_to sit stand rest converse gather wave perform ambient_wander do_activity`; `enumerateActivities` and `describeSurroundings` feed the brain |
| `packages/protocol` | Everything that crosses a process boundary: log events, WebSocket messages, REST schemas |
| `packages/brain` | Jev client, mid-brain / translator / director request builders, narrator prompt |
| `packages/client` | Client replica + reconnecting connection (browser and Node) |
| `apps/server` | The sequencer: tick loop, event log, snapshots, WS hub, REST, MCP, Privy, brain scheduler |
| `apps/web` | React + Vite debug shell with Privy login |
| `infra/` | systemd unit, Caddy site file, deploy script, one-time box setup |

## How it works

- **The log is canonical.** Every input is an event (`birth intent decision scene rules admin retire`) applied at a tick. The world is the fold of the log over the engine; `pnpm test:replay` proves replay from genesis reproduces the live state hash.
- **Tick loop.** 20 Hz fixed step with a clock-rate dial and EVE-style dilation. Snapshot every 5 min and on shutdown; boot = latest snapshot + fast-forward.
- **Sync.** The server sends *decisions*, not poses: timed paths when a Soul commits to walking, plus field changes, in 500 ms batches. Clients compute positions locally. Every 5 s a heartbeat carries a view hash; a client that disagrees asks for a resync. Reconnects resume from a ring buffer.
- **Brain.**
  - *Mid-brain (Jev, per Soul).* The engine enumerates feasible activities with params bound; Jev picks one (Choice) and judges pace (Score), sociability and keep-going (Nouls) in the same request. Clear preferences are taken, near-ties sampled, near-zero options never. The choice is logged as a `decision` event, so replay never calls Jev. Fires on new intent, activity end, narrator beat, or a timer Jev's pace answer sets.
  - *Narrator (Haiku 4.5, per region, ~5 min, staggered).* Cached system prompt + region digest → up to four beats with a closed directive list. Beats become `scene` events and reach Souls as suggestions in Jev's context.
  - *Director (Jev, ~6 s while watched).* Picks a broadcast shot (Mars `ShotSpec`) and ticker lines.
  - *Translator (Jev, Haiku fallback).* Owner's text → closed intent.
- **Agents.** A Soul's owner mints a one-time claim prompt; the agent fetches a per-Soul token and uses REST (`/v1/agent/*`) or MCP (`/mcp`). See `/v1/skill.md`.

## Develop

```bash
pnpm install
cp .env.example .env    # fill keys; DEV_AUTH=1 enables dev:<name> tokens and ?dev in the web app
pnpm test
pnpm --filter @sim/web build && node --env-file=.env apps/server/src/main.ts
```

Deploy: `infra/deploy.sh` (see `docs/RUNBOOK.md`).
