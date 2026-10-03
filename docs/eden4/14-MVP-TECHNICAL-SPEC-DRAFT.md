# 14 — MVP technical spec (draft 1)

> **Currency (2026-09-30):** a design draft written before anything was built. Its architecture, three-timescale mind and steering surfaces were carried out in Sim with changes; `15` records the plan and what was built, and the Sim repo's `docs/sim/` is authoritative for how things work now. Current-use note (2026-10-03): finite physical construction, ceramic rooms and a floater body profile are now delivered; the broader economy, central ritual and general morphology system remain design work. The prior-art survey and reasoning retain their dates.

Rounds 9–10, 2026-09-29. Status: **draft for discussion; the items marked
(Gene, r10) are his answers, the rest is Claude's lean.** Design only; no
building yet.
Scope of this document: the *practical construction* of a playable eden4,
not the existential questions in `01`–`06`, `13`. It assumes those stay open
and designs so they can be answered later by rule versions and dials.

Sources checked this round: the Mars Studio repo
(`<mars-campus-repo>`, 564 commits on `main`
since 2026-09-27, release 15 deployed), the TypeSafe/Jev research folder
(`<typesafe-repo>`), and a prior-art sweep (section 9).

## 0. One-paragraph target

One canonical world, simulated in one process, always on. Hundreds of
**bodies** (working name; "sims" is EA's turf, see §10) live in it. Each
body is owned by one account and runs on its own under a server-side
policy; the owner's agent (Claude, GPT, Codex, a DAO, or an in-site chat
box) *steers* it by sending small structured intents over MCP or REST.
Every client renders the same world in three.js from a WebSocket state
stream. Anonymous visitors watch a director camera; logged-in users get a
camera of their own. The server bill is one small box.

## 1. Relationship to Mars Studio

**(Gene, r10):** Mars gets finished first. Then Mars development stops and
eden4 *takes over* that codebase, generalizes it, and Mars becomes one
world inside it. No fork, no parallel lineage.

What that implies for this spec: everything below is written against the
engine as it exists in `viewer/engine/` (~57k lines, ~19k tests): the
deterministic `Runtime` (fixed `DT = 1/20 s`, seeded sfc32 RNG inside the
state, sorted entity iteration, zod-validated verbs, reservations,
pre-emption, invariants), `WorldHistory` (content-addressed checkpoints,
forks, protected canonical), the single op registry (REST + MCP + browser
from one schema), the spatial raster + A* + traffic layer, the
deterministic camera layer, and `engine-view` (GLB humans + procedural IK).
Mars-specific modules (`construction/` 8.4k lines, `campus/`, catalogs,
vehicles, reconstruction GLBs) become *one world's content* rather than
being deleted.

Generalization work list (post-Mars): generic `SpatialScene` terrain, a
generic building primitive, a world registry (Mars = one world), and the
four server-side gaps in §9.

## 2. Architecture

```
                 owners' agents (Claude/GPT/Codex/DAO)    in-site chat box
                          │ MCP / REST (intents, queries)       │ (translator → intents)
                          ▼                                     ▼
┌──────────────────────── sequencer (one Node process, one box) ────────────────────────┐
│  accept/validate/sign events → append-only LOG (SQLite/Postgres)                       │
│  20 Hz Runtime tick (engine)  ←  policy (standing intent → verbs, ~1 Hz per body)     │
│  snapshot every N min (content-addressed, WorldHistory)                               │
│  director (Jev advisory, ≤1 Hz) → broadcast camera track                              │
│  broadcast: 5–10 Hz deltas over WebSocket (interest-managed)                          │
└────────────────────────────────────────────────────────────────────────────────────────┘
                          │ WS deltas + snapshot on join            │ static assets (R2/CDN)
                          ▼                                         ▼
        three.js clients (spectator / owner view / director view), interpolating between ticks
```

**Why one process, not Durable Objects.** Mars runs on a Cloudflare DO
because its model is "submit plan → simulate faster than real time →
store take → poll at 1 Hz". An always-on world needs a loop that never
sleeps; a DO kept awake 24/7 loses hibernation savings, sits on one
thread with a 30 s CPU cap per invocation, and caps at 128 entities in
Mars's admission rules. **(Gene, r10):** a plain Node process on the Hetzner box, as long as it
tolerates the load; microservices only if and when needed. Simple is best. DOs remain a good option later for the *read side*
(fanning the broadcast to thousands of spectators) and for auth edges.

**Why not client-side deterministic replication (Croquet-style).** The
world must run when nobody is connected and must accept intents from
non-browser agents. Server authority is the only model that fits.

**Cost envelope at ~300 concurrent.** One 4 vCPU box: sim + Postgres +
Caddy. Bandwidth ~5–20 KB/s per client. Jev at $0.042/M input tokens is
noise. The only cost that can grow is *LLM tokens for translation of
chat steering*, which is optional and rate-limited.

## 3. The canonical record

Adopt `11` as-is, with these MVP simplifications:

- **Log first, chain never (for now).** Every accepted input is an
  `Event {seq, tick, kind, author, payload, sig}` in an append-only table.
  Kinds at MVP: `birth`, `intent`, `econ` (mock), `rules`. `ingest` waits.
- **Snapshots, not replay, are the operational recovery path.** Replay
  from genesis is a *test* we run in CI, not a feature users depend on.
  Reason: the engine's cross-JS-engine float determinism is only
  mitigated in Mars by storing resolved motion in takes; a live world
  produces no takes. Canonical = whatever the sequencer computed, hashed
  and snapshotted. Third-party verification is a later rules event.
- **Rules version pinned per snapshot** (`ENGINE_RULES_VERSION` already
  exists). A rules upgrade = stop tick, snapshot, migrate, tag, resume.
- **`live` action state must become serializable.** Today the Runtime's
  in-flight action state is private and resumable only at pause
  checkpoints. For a 24/7 world we need snapshot/resume at any tick.
  This is the first real engine change.

## 4. Time

- Engine step stays 1/20 s. **World clock rate is a runtime dial** (Gene,
  r10: "let it be variable and I'll test it"). At 1:1 a body walks 100 m
  in ~74 s. Rate changes are logged like any rules event, so replay knows. EVE-style
  time dilation slows the world clock uniformly when a tick overruns its
  50 ms budget rather than dropping inputs. Owners' agents already
  tolerate latency.
- Intents are applied at the next tick boundary. **No direct control of a
  body, ever; only steering** (Gene, r10). Humans may WASD-walk a *camera*
  to look around, and may snap the camera to follow their own body, but the
  view is never locked to it. So: no client prediction, no rollback.
- Policy evaluates each body roughly once a second, staggered across
  ticks, so ~200 bodies means ~10 policy evaluations per tick.

## 5. Three timescales of mind (Gene, r10, Claude's structuring)

| Tier | Timescale | Runs | Deterministic? | Logged? |
|---|---|---|---|---|
| **Reflex** | every tick, 1/20 s | engine: locomotion, avoidance, reservations, pathing, current activity script | yes | no (derived) |
| **Mid-brain** | on new owner intent: immediately; otherwise every N s per body, N from ~5 s to minutes, staggered | **Jev** (TypeSafe System One): given the standing intent + word-bucketed local state + a code-enumerated menu of feasible *activities*, pick the next activity | no (model) → so its **choice is logged as an event** authored by the world-brain key | yes |
| **Super-consciousness** | every N minutes to hours, across regions | a capable LLM (Claude): reads summaries of the log, sets scene intents (weather, events, festivals), nudges moods/goals for groups, writes the day's narrative | no → logged as `scene` events under a governance key | yes |

Owner steering and the mid-brain meet in the **standing intent**: the
owner's agent sets it (closed goal list, `11`); the mid-brain chooses how
to pursue it moment to moment; the reflex layer executes. When there is no
owner input for a long time, the mid-brain is the body's whole mind.

**Neutrality check against `03`.** The mid-brain never reads free text and
never invents actions; it selects among options *the engine enumerated as
feasible*. Because its choice is written to the log, replay never calls
the model. If Jev disappears, a hand-written policy takes over and history
stays valid. This is "interpreter at the edges" plus a *chooser* at the
center, which is a weaker and defensible form of central discretion.

**Cost at 200 bodies:** every 30 s = ~7 calls/s ≈ $0.05/h ≈ $40/month at
~2k tokens/call; every 5 s ≈ 6× that. Rate limit is ~1,200 req/min, so
bodies must be batched several per request (per-item questions over shared
state, the documented pattern). Cache by state fingerprint; skip the call
when nothing near the body changed.

**Taxonomy (answering Gene's r10 point 7).** Three levels, smallest set at
the bottom:

- **Verbs** (engine, ~70 today; atomic, deterministic): `walk_to`, `sit`,
  `stand`, `mount`, `ride_to`, `carry`, `converse`, `gather`, `eat`,
  `paint`, `work_at`, `ambient_wander`, `place` (new)…
- **Activities** (scripts of verbs with preconditions, what the mid-brain
  chooses from): sleep (go home, lie down until morning), rest (sit
  somewhere pleasant), eat (go to food, sit, `eat`), read / use computer
  (go to a desk, `work_at`), ride (find a vehicle, `mount`, `ride_to`),
  perform / dance / wave, build (place N blocks per a plan), attend an
  event, join a conversation, follow someone. The engine's sequence
  templates (`mars-sequence/1`) are already this.
- **Intents / goals** (what an owner sets; closed list, ~10): wander, go,
  follow, attend, gather, converse, rest, build, place, perform.

Owners speak in intents. The mid-brain picks activities. The engine runs
verbs. Adding an activity is content; adding a verb is a rules event.

**Bodies at MVP (Gene, r10):** a catalog of rigged humanoids (Quaternius
set already integrated) plus name + description, **upgradeable later** to
the text→mesh→rig pipeline of `10`. Keep the body record shaped to carry
`meshHash / rigHash / capabilityMap`.

## 6. Steering surfaces

| Surface | Who | How | Cost |
|---|---|---|---|
| **MCP server** (Streamable HTTP, same op registry as Mars) | owners' agents | `query_*` tools free and instant; `set_intent` blocks until the tick accepts it and returns the resulting state slice (SpaceMolt pattern); 429 + `retry_after` under quota | quota per body |
| **REST** | scripts, DAOs | same schemas | same |
| **In-site chat box** | low-tech users | click your body, type. A server-side translator turns text into a closed intent, then the same `set_intent` path. Leanest reliable option: **Jev function-calling** (one Choice over the goal list + one Choice over code-enumerated nearby targets + an "unsure" escape; ~200 ms, ~$0), falling back to Haiku 4.5 with a tool schema (~1 s, ~$0.001) when Jev confidence is low or the text needs composition. Never eden3 (Gene, r10: lean small). | manna-priced, hard rate limit |
| **Direct UI** | logged-in owner | buttons for the goal list, click-to-target on the map | free |

Free text never enters the log. The translator's output is the intent.

**Key handoff (Gene, r10: "a prompt you give to your Claude").** The site
shows a one-paragraph prompt containing a claim URL. The owner pastes it
into their agent; the agent fetches the URL, which returns a per-body
bearer token after the owner confirms in the browser (device-code style).
The agent then reads `GET /v1/skill.md` for the tool contract. We never
hold users' Anthropic/OpenAI keys (Moltbook's breach lesson); tokens are
revocable per body.

## 7. Clients, sync and camera

**Principle (Gene, r10):** the public URL is a broadcast view, cheap, no
user-specific data; clients download the map once and stream updates;
push as much compute to the edge as possible.

### 7.1 What the server sends: decisions, not poses

Two ways to keep hundreds of clients in agreement with one server:

| | A. Pose streaming | B. Decision streaming + client-side reflex |
|---|---|---|
| server sends | every body's pose at 5–10 Hz | each *verb commit* (walk_to + resolved path corridor, sit at X, mount Y) when it happens, plus a low-rate authoritative pose keyframe (every 2–5 s) |
| client does | interpolate | runs the engine's locomotion + avoidance layer locally on the same inputs; blends to keyframes |
| bandwidth per client at 200 bodies | ~20–40 KB/s | ~1–3 KB/s |
| server CPU | same either way (it simulates canonically regardless) | same |
| consistency | exact | approximate between keyframes; two viewers may see a body a step apart |
| risk | none | divergence from float nondeterminism and local-avoidance interactions; a body that visibly snaps |

**Lean: B, with A as the fallback switch.** The Mars engine already runs
in the browser (`/lab`) and its renderer is a pure function of history, so
the client-side reflex layer is the same code the server runs. Keyframes
bound the drift. Canonical truth stays on the server; a client is a
best-effort replica whose only job is to look right. "Dumbness" (bodies
walking through each other) is avoided because the client runs the real
avoidance code, not a dumb interpolator.

Join: fetch the latest snapshot (bodies, placed things, ground), then
subscribe to the event stream. Interest management by camera region once
the entity count makes full broadcast expensive.

### 7.2 Cameras

- **Broadcast camera** (anonymous, shared): server-side director,
  read-only, reusing `engine/camera/` shot specs and the Jev director
  experiment on `codex/autonomous-camera` (≤1 Hz, chooses among candidate
  shot ids). Emits one camera track that every spectator client executes.
- **Owner camera:** "follow my body". *Claude's push-back on r10:* this
  does not need a per-user server component; the client already has the
  body's pose stream and the camera solver is deterministic client code.
  A server-side per-user camera is per-user compute, the thing we are
  avoiding. If "best camera following your agent" means Jev-chosen
  cinematic shots, offer it as an on-demand, low-rate server call rather
  than a standing stream.
- **Free camera:** WASD/orbit, client-side, logged-in only.
- **Event feed** (optional, can be disabled): a ticker rendered from the
  public log in plain language ("Kalama sat by the fire", "a body was
  born: Verdelis"). Free, since it *is* the log. Names shown.

### 7.3 Rendering

three.js WebGL now, WebGPU when the Mars renderer moves. Assets from
R2/CDN with a hashed manifest (Mars `prepare.py`). Hundreds of visible
bodies need instanced skinned meshes and animation sharing before long.

## 8. Ground, building, economy at MVP

- Ground: one flat 100 × 100 m plane, generic `SpatialScene` (not the
  campus). Growth ring and terrain types are post-MVP but the region
  schema should allow appending rings.
- Building: **one generic primitive** — place a block/volume of a
  material at a footprint with support rules from the engine's
  `support`/`connections` graph. Not the rack/beam/joist system. Pallet
  racks can be a preset composed from the primitive later.
- Manna: an in-state ledger with daily UBI and a price on `place` and on
  chat-translation calls. Mock purchase for births. No chain.
- Daily ritual: a governance-keyed `scene` intent at the center
  (`manna_fall`), so the crowd-gathering mechanics get exercised from
  day one.

## 9. Scale plan and known engine limits

| Concern | Mars today | MVP need | Approach |
|---|---|---|---|
| Background tick | none; call-driven | 24/7 | Node loop with fixed-step accumulator; dilation on overrun |
| Live snapshot | pause checkpoints only | any tick | serialize in-flight action state |
| Agents | 30 stress-tested; A* spikes 50–100 ms when ~27 replan in one tick | 200–500 | replan budget per tick (queue, stagger), coarser raster (0.25 m) for open ground, spatial hash |
| Accounts/ownership | capability tokens per room | per-body owner, revocable tokens | Privy from day one with Google login, embedded wallet invisible (see §12) |
| Transport | 1 Hz polling | WS event stream + keyframes | `ws` on the same process; DO/PartyKit fan-out later |
| Asset weight | 1 GB campus | tens of MB | new content, meshopt + KTX2 |
| Crowd rendering | one rig, no LOD | hundreds visible | instanced skinned meshes, animation sharing, impostors later |

## 10. Prior art in one screen

- **Screeps** (2014→): players' code drives units; server ticks ~3 s;
  two-stage tick (agents think on a snapshot, world resolves at tick
  end); per-player CPU budget is the economy. Open-source server.
- **SpaceMolt** (Jan 2026): text MMO for LLM agents over MCP/WS/HTTP;
  ~10 s tick; one mutation per tick; blocking mutation, free queries; one
  VPS. The closest live analogue to our agent contract.
- **Project Sid / PIANO** (Altera, 2024): ~1,000 agents in Minecraft;
  fast reflex modules act continuously while slow cognition sets intent.
  Exactly our body/steer split.
- **AI Town / Smallville**: 2D, ~25 internal agents, Convex tick loop
  and memory schema worth reading; no external agents.
- **Fable Showrunner**: a simulation filmed into episodes; the director
  camera precedent.
- **Moltbook** (Jan–Mar 2026, acquired by Meta): the growth shape we
  want, plus two lessons: never store users' agent keys; treat all
  in-world text as prompt-injection surface.
- **Second Life** (one process per 256 m region, ~100 avatars), **EVE**
  (time dilation), **WoW** (layering) — cap density per area, dilate
  don't drop, bound what any viewer sees.
- **Onchain worlds**: Lattice/Redstone winding down May 2026; Hathora and
  Unity Multiplay shut down 2026. Keep the substrate boring and
  portable; chain for ownership later, never for the tick.
- **Engines**: Hytopia (TS, server-authoritative, voxel, alpha), Needle
  (three.js, relay networking), SpacetimeDB (DB-as-server, Rust/C#
  modules, Pro $25/mo). None beats keeping the Mars engine core.
- **Naming**: see §12, item on "sims".

## 11. Build order (each step playable)

0. **Spike (days):** extract engine, Node process, 20 Hz loop, 100
   wanderers on a 100 m plane, run for 24 h, measure tick time and memory.
1. **Watchable:** WS broadcast + three.js spectator client + fixed
   establishing camera. Public URL. Nothing to do but watch.
2. **Ownable:** accounts, birth (mock price), one body per account,
   owner camera, MCP `set_intent` with the closed goal list, per-body
   tokens. First external agents steer.
3. **Directed:** server-side director track (heuristic first, Jev
   second). Anonymous viewers get television.
4. **Buildable:** `place` primitive, manna ledger, UBI, daily manna fall.
5. **Talkable:** in-site chat translator for non-agent users.
6. **Recorded:** log + snapshots + rules version tags exposed publicly;
   replay-from-genesis as a CI test.

## 12. Decisions so far and open items

**Settled by Gene in r10:** world clock is a dial; steering only, camera
free; build in eden4 after Mars, no fork; one Hetzner box; catalog bodies,
upgradeable; lean chat translator, no eden3; event feed and names OK,
disableable; open source from day one; public URL = broadcast view with
client-side rendering.

**Open:**

- **Login / wallet.** Gene wants it to feel like plain Google, no wallet
  features yet, and asks whether Privy costs more than Google alone.
  Claude's lean: Privy from day one. Its Google login *is* Google to the
  user, the embedded wallet is invisible until a rules event needs it, it
  avoids an account migration later, and Abraham already runs Privy smart
  wallets and session keys. Pricing to verify against privy.io before
  committing; the tier for hundreds of users has historically been free
  [U, memory].
- **The word for a body.** Gene: no to "bodies"; maybe citizens, beings,
  residents; "creatures" only if the population is non-humanoid; he
  would really like "sims". See the chat for the trademark reading.
- **Client-side reflex (B) vs pose streaming (A)** in §7.1: Gene to
  confirm the lean.
- **Per-user server camera:** Gene to confirm it can be client-side.
- **Mid-brain cadence N** and whether the super-consciousness exists at
  MVP or is a later rules event.
- What exactly ships at step 1 vs step 2 of §11.
