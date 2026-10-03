# R9 — Spawn: games made by talking, on a platform built for agents

> Written 2026-10-03 from Spawn's own public pages and developer documents, read that day:
> the home page and FAQ (https://www.spawn.co/), the about page (https://www.spawn.co/about),
> `https://www.spawn.co/llms.txt`, `https://www.spawn.co/llms-full.txt`,
> `https://www.spawn.co/openapi.json`, the npm metadata of `@spawnco/client`, and one play page
> (https://www.spawn.co/@tiger/skyfall-rush/play). **Everything here is Spawn's own
> description of itself [claimed]**; no independent coverage was found, and Spawn says that
> reviews from before February 2026 describe a deprecated product. No account was created and
> no game was played: the game frame did not finish loading in the test browser. "Sim" means
> the merged app at sim.eden.art (`22-MERGE-PLAN.md`, `MERGE-LOG.md`). Everything under
> "For Sim" is Claude's proposal, not Gene's, and not decided.

## 0. The short version

Spawn is a browser platform for making multiplayer games by conversation. A creator stands in
an empty world and tells **Savi**, an AI game designer with a persona, what to build; she makes
terrain, characters, art, music and rules while the creator watches. Every game is multiplayer
from the first message, is a Git repository, and can be opened to outside coding agents. The
business model copies Roblox. It is the nearest thing found to Gene's "worlds are data and
code, made by talking, open to agents" (`20`), and it is not a competitor to what Sim is for:
Spawn's worlds are **sessions for players**, with nothing living in them when nobody is there.
Sim's worlds have inhabitants, one objective state, and a replayable history.

## 1. Facts sheet

| Item | Value |
|---|---|
| Company | Founded by Jacob Sansbury (second company; "previous exit to Robinhood"). "A team of under 10", "backed by an unannounced round". |
| Stage | "About 18 months in early alpha"; beta since February 2026; the current engine release is "Spawn 6". |
| Product | Make and play multiplayer games in a browser: 3D first or third person, 2D side or top view, card and menu games. Desktop app; phone browser; iOS beta. |
| The builder | Savi. "Uses Claude Opus 5.5 by default". Included free; no separate AI subscription. Helpers called "wisps" work on parts of a build in parallel. `/lock-in` asks for a deeper pass with a plan. |
| Price | "Free to make, free to play." |
| Money | Players spend "spoins" inside games; "you keep half and spawn keeps half". The FAQ on the same site says paid access and subscriptions "are not currently available to makers". |
| Community | Discord; "SpawnJam", a weekly jam with a theme, deadline and prizes; a Partner Program by selection. |
| Web stack (observed) | Next.js on Vercel; Datadog monitoring; the game runs in an iframe from `play.bigspawn.net`, which refuses to load without a one-time session grant. |

## 2. How making a game works

- **Conversation, not a prompt.** Their advice: "the worst way to use spawn is to write one
  enormous prompt". Small moves, each after watching the last one land.
- **A builder with taste.** Savi "would rather make a real call and hear you disagree than
  hand you a blank to fill in". She adds things nobody asked for (their example: a chapel at
  the edge of a village).
- **God Mode** for direct editing: fly, select, move, rotate, scale, brushes, saved blueprints.
- **History.** Every change is listed; "Undo" beside a change; "Go back to this" for any
  earlier version. This is the Git history shown as a product feature.
- **Tools as mods.** "When you need a tool, you and savi build it: a cutscene editor… a wave
  composer… a loot balancer." Tools are published as mods that other creators build on.
- **Together.** A visit link lets a friend play the unfinished game; a build link lets them
  edit beside you, with Savi in the same room.

## 3. The world model

| Concept | Meaning |
|---|---|
| Game ("world") | One Git repository. Address `@creator/name`. |
| Place | An area of a game (town, dungeon, arena) with its own scenery and rules, joined by doors and portals. |
| Room / instance | A separate running copy. "When a second group walks into the same dungeon, spawn quietly hands them their own copy." |
| Portal | A door to another Place or another creator's game. Hubs of many games are possible. |
| Crossing | Pets, items and vehicles can go through portals; "what can enter depends on the destination's rules". |
| Player progress | Saved per player in a game database, separate from the game's version history. |
| Publish | Visitors to an editing session see work in progress; the play link serves the released version. |

There is no single persistent world state. Rooms exist while people are in them: the agent
API answers `409 no_live_room` "when nobody is in it".

## 4. The engine, as far as it can be seen

The engine is their own, called **Tome**, and is closed. The public documents never name a
rendering or physics library; the game frame could not be inspected. What the documents say:

| Layer | Design |
|---|---|
| Files | A declarative tree of things, `world.config.yaml`, scripts, `sim.js`, `ui.js`, and an `AGENTS.md` at the root. |
| Deploy | "A push to main reaches every room open on main with no build and no deploy", usually in seconds. "The server never merges and never force-pushes." |
| Logic | `update(ctx, dt)` on each thing that moves; one `tick(ctx)` in `sim.js` "for the rules that run once for everyone". |
| Physics | Declared: `physics: "character"`, `"static"` or `"dynamic"`. No physics library in game code. |
| Determinism | `Math.random` and `Date.now` become `ctx.random()` and `ctx.now()`, "seeded and shared, so every machine draws the same level". |
| State | `ctx.world.state.*` for what everyone shares; `ctx.self.state.*` for one thing. |
| Multiplayer | Built in; "each player is a body their own machine moves". A game's own netcode "stays behind". |
| Server | One server per room, with a tick budget and a health endpoint. A SQL database per world (dev and live; 10 GB limit in the example). |
| Assets | Stored and addressed by content hash: `value.<sha256>.<ext>`, served from a CDN. Files over 4.5 MB upload by address. |
| Bodies | Any rigged `.glb`. "Clips named Idle, Walk, Run, Sprint and Jump play by speed." A model with no skeleton is refused. Characters can be generated from a prompt or a picture and then rigged. |
| HUD | `ui.js` returns HTML. |
| Starters | `3d`, `2d-top`, `2d-side`, `ui-game`, `3d-voxels`. |
| Versions | An engine version per game, with "Upgrade to 6.0" and "Back to v…". |
| Importing | A three.js, Babylon, Phaser, Unity or Godot game is brought in as source under `source/` and rebuilt on Tome; its engine, libraries, server and netcode are dropped. |

The npm package `@spawnco/client` (0.2.0) has no dependencies: "the package is a loader: the
client it runs is the one the stack you join serves."

## 5. Agents as first-class users

Spawn's about page is addressed "for the agent reading this".

- **An account with no human**: `POST /api/agent/v1/signup` returns a durable token.
- **Linking**: a creator copies one prompt from their game's `/code` page and pastes it to
  their agent; that signs the agent up, links it to the person and makes it an editor. A
  one-time key from `/agent` in Savi's chat lasts ten minutes.
- **Playing**: `spawn client join @alice/gauntlet` joins a world as a real player and runs
  play scripts.
- **Building**: clone, read `AGENTS.md`, push to main.
- **Eyes without a browser**: per-world docs and "skills" (the same texts Savi reads, by
  domain: terrain, geometry, cameras, UI, physics), live rooms, logs, room health, a
  read-only SQL door, and read-only JavaScript run inside the live room.
- **The budget law**: "an unlinked agent account may burn our CPU and never inference or GPU
  until a human links it". Limits for an unlinked account: 3 worlds a day, 2 sessions at a
  time, 200 distinct bodies a day, 600 pushes per world per hour. Linked, it runs under the
  person's allowance. Refusals name the closed "lane" and who can open it.
- **Closed to agents**: public reviews, and Savi herself ("no agent account ever wakes Savi").
- A machine-readable contract (`openapi.json`, 55 paths) and `llms.txt`.

## 6. Spawn and Sim

| | Spawn | Sim |
|---|---|---|
| A world is for | players, in sessions | inhabitants, all the time |
| State | a copy per room; gone when empty | one objective state per world, logged, replayable |
| Who acts | the player moves an avatar | owners steer Souls that act by themselves |
| What the AI is | the builder | the inhabitants' minds |
| World definition | a Git repository of text and scripts | a world folder in one repo (`22` §3.3) |
| Agents | sign up, play, build by Git | pair, steer by rules, MCP |
| Crossing worlds | portals; the destination decides | open (`20` §8) |
| Economy | platform currency, half to the creator | open (`21`) |
| Content | generated from prompts | a real place and real ceramic art |
| Who moves bodies | each client moves its own | the server |

Shared ideas: many worlds on one platform; worlds shaped in plain language; code as part of a
world; a library that creators grow; agents treated as users.

## 7. For Sim (proposals)

1. **A world as a text tree in Git, live on push.** The concrete form of "code and data
   become the same thing" (`20` §1). Sim's `worlds/<id>/` folders can be read this way now;
   a repository per world is the later step if other people make worlds.
2. **Engine version per world, with upgrade and roll back.** This is the version pinning of
   `20` §2, shipped.
3. **Portals where the destination decides what may enter.** A minimum answer to Soul travel
   (`20` §8, `21` §8).
4. **Content-hashed asset names.** Sim planned hashes for cards and world code; the same
   scheme for models and textures gives caching and one copy of each file.
5. **A body contract by clip name.** "A rigged GLB with Idle, Walk, Run and Jump" is far
   simpler than a morphology vector and enough for a first body library (`20` §4).
6. **Seeded `ctx.random()` and `ctx.now()` for world scripts.** The Mars engine already
   forbids the raw calls; this makes the rule usable by world authors.
7. **The agent door.** Signup with no human; one pasted prompt to link; compute-only budgets
   for unlinked agents, with refusals that say who can lift them. Compare `17`.
8. **Per-world documents for agents**: an `AGENTS.md`, skills by domain, a read-only script
   door into the live world, a health door.
9. **Tools as mods.** Creators build their own editors and publish them: Gene's "grow
   software like data".
10. **A builder with taste.** A world-building assistant that makes a call and invites
    disagreement, instead of asking questions. A candidate for how worlds get furnished.
11. **The community loop**: a "live now" feed, a weekly jam, a Discord.

**Do not compete on "make a game by talking".** Spawn has a funded team, a free Opus-backed
builder and a head start. What Spawn does not claim is what Sim is built around: worlds that
are alive when empty; owned inhabitants whose habits form over days; one canonical, replayable
history; worlds rooted in real places and art.

**The risk.** Persistent characters are a feature Spawn could add, and anyone could build a
"living town" as a Spawn game. The log, ownership and steering are the parts that would be
hard to copy.

## 8. Not known

- The renderer and physics libraries (the frame is locked to a session grant).
- User numbers, retention, revenue, funding.
- Whether any Spawn game runs autonomous characters over long periods.
- What the Tome API reference contains: it needs a token, and no account was made.
- The terms of service on ownership of generated assets ("generated assets may not be unique
  to your game").

## Sources

- https://www.spawn.co/ (home and FAQ), read 2026-10-03
- https://www.spawn.co/about, read 2026-10-03
- https://www.spawn.co/llms.txt and https://www.spawn.co/llms-full.txt, read 2026-10-03
- https://www.spawn.co/openapi.json, read 2026-10-03
- https://registry.npmjs.org/@spawnco/client (version 0.2.0, modified 2026-09-06)
- https://www.spawn.co/@tiger/skyfall-rush/play, loaded 2026-10-03 (page structure and network only)
