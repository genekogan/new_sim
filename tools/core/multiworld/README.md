# Local edge worlds

Mars and Little Martians use the shared edge protocol, one process/SQLite database each, and a loopback routing proxy. Eden keeps its existing launcher and database. These tools make no production, DNS, Cloudflare, tunnel or paid-model changes.

`world-server.mjs` takes an explicit descriptor. Required: `input`, `dataDir`, `worldKey` (`mars` or `littlemartians`), `worldId`, and a private port4963–4969. Optional `publicOrigin` is loopback HTTP, commonly the proxy origin. `webDir`, `marsWebDir`, `skillFile` and `cliFile` select the shared built assets. `check` boots an existing disposable copy and reports its exact clock/head/hash before any prospective runtime, card, cast or living-world installation.

Mars is a new `mars-2026-1` history: original camp mechanics on the versioned 2026 campus map, with native pallet-rack construction and disassembly. An old camp history is deliberately incompatible with that new map. Little Martians uses the unchanged production factory and existing stable body model slugs. The separate map lead's authored map requires `worldVariant:'authored'`, a worldId other than `littlemartians-1`, and the exact selected `sceneSha256`; legacy descriptors refuse changed scene bytes. A restored physical base must match the selected map. This is a separate disposable history, not a migration or replay substitute.

The original native cast may live through seeded fake choices at $0. A durable original-birth roster authorizes their IDs, never current names. Retired names recreated by an owner remain outside native control across restart; retirement never triggers automatic reseeding. Owner/agent-controlled Souls and any paired cast Soul are skipped immediately, including queued native choices. New native programs recheck every concrete participant at durable admission, so they cannot borrow paired bodies. Pairing an active or borrowed original cast member refuses until a safe boundary. Accepted history always replays independently of present tokens. A second Edge ambient driver is disabled in both native and manual modes. Mars keeps quiet first-light renewal for finite food; neither world enables fading. Ceramic heads glide/hover and never receive human-only hand/limb offers. Physical admission still checks routes, free crew, occupancy and resources.

To run the whole local group, save a config outside the repository:

```json
{
  "input": "<worktrees>/pm-multiworld",
  "dataDir": "<team>/scratch/world-runtime/local-worlds",
  "edenPort": 4970,
  "proxyPort": 4966,
  "webDir": "<worktrees>/pm-preview/apps/web/dist",
  "skillFile": "<worktrees>/pm-preview/tools/edge-skill/SKILL.md",
  "cliFile": "<worktrees>/pm-preview/tools/edge-skill/eden-agent.mjs",
  "marsWebDir": "<mars-campus-repo>/viewer/dist/client",
  "mars": {"port":4963,"worldId":"mars-2026-1"},
  "littlemartians": {"port":4964,"worldId":"littlemartians-1"}
}
```

`node tools/core/multiworld/local-worlds.mjs /absolute/local-config.json` reuses the already-running Eden process without writing its files; optionally `edenDescriptor` starts an owned Eden copy on4950–4959 instead. `sourceDb` per new world uses built-in SQLite `readOnly:true` plus `VACUUM INTO` and refuses an existing destination. Never point a world dataDir at live data. Readiness checks all three world identities before starting the proxy. Ctrl-C/SIGTERM stops only owned children.

The proxy preserves selected-world HTTP, streaming SSE, WebSocket upgrades and queries. `/__sim/worlds.json` returns `local-worlds/1` metadata. Campus derivative routes go to Mars; existing `/w/mars/2020`–`2027` year surfaces stay on Eden's static handler. Unknown world prefixes return404 instead of rendering another world's API.

Before release, run the launcher/profile/proxy tests plus production-reader LM replay proof on a read-only SQLite copy; compare unchanged Eden and all three rendered worlds. Local evidence does not authorize production promotion.
