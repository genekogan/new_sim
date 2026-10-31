# Mars simulation host

A Cloudflare Worker serving `/mcp` (the official MCP TypeScript server over Streamable HTTP) and `/api/simulation/*`, with
one SQLite Durable Object (`MarsSimulation`) per room and year. Room state persists independently of any browser. The
external-agent contract is [`../public/simulation-agent-guide.md`](../public/simulation-agent-guide.md), also served at
`/simulation-agent-guide.md`. In Sim, the engine runs in the Sim server instead; this host is the engine's original
standalone deployment.

## Rooms and capabilities

A room is created in the studio. The browser generates a random 256-bit control capability; `view = SHA256(control)` and
`room = SHA256(view)`, so the Worker authenticates control and read-only access without storing plaintext credentials.
Bearer format is `room.capability`; keys never go in URLs. Spectator links carry only the view capability in the URL
fragment. Leaving and creating a room makes a new independent room; old invitations are not revoked. There is no OAuth or
per-person revocation.

Use `?year=YYYY` (2020–2026) on `/mcp` and every `/api/simulation/*` request; omission selects 2026. Durable Object
identities include the year. `get_capabilities` returns the selected year's entity ids, bounds and landmarks.

## Scene commands

Tools cover discovery, time / day length / simulation rate, weather, cameras (static, orbit, spiral, keyframed path),
people and groups, activities, EUC missions, fire, screens and atomic scene batches. Schemas live in `commands.ts`;
`get_capabilities` returns their JSON Schema.

- The server stores immutable motion paths and an anchored virtual clock `{ real, virtual, rate }`; pause freezes virtual
  time, rate changes re-anchor it without moving poses. `normalizeState` migrates old room state on read.
- Commands clone before mutation and commit transactionally; `apply_scene` commits its children as one revision or none.
  The HTTP command endpoint takes UUID idempotency keys (last 256 revisions); each MCP invocation is a new command.
- Viewers poll about once a second while visible; `?revision=N` returns `{ unchanged: true }` when nothing changed. A room
  caches its loaded state and invalidates it only after a successful command.
- Routes use baseline mesh bounds inflated for people; EUCs follow a perimeter loop or obstacle-aware routes to parking
  docks. These shared routes do not model pedestrian avoidance or movable geometry.
- The camera is a desired broadcast shot; viewers opt in to following it. MCP returns no screenshots.

## Engine tools

`/mcp` also exposes `engine_*` tools generated from the engine controller's op registry (`../engine/api/schemas.ts`,
`controller.ts`): the same registry, schemas and `rehearse` / `execute` code the browser and Node tests use, with no
separate control path. Validation failures come back as the controller's JSON refusal envelope.

- `engine-room.ts` keeps one `EngineController` per room and year and persists it in `engine_blobs(key, chunk, data)`:
  rows of ≤ 512 KiB split on code-point boundaries; keys `history` (checkpoint and workspace index), `state/<hash>`,
  `state/resume.<hash>` (pause snapshots), `plan/<hash>`, `take/<id>`, `cams/<takeId>`. Each op persists in one
  transaction; `rehearse` writes nothing unless `keep: true`.
- Rooms seed the synthetic `proving-ground` and `carry-yard` workspaces; year rooms also seed the protected canonical
  `mars-<year>` from `public/engine/campus-<year>.json` (bundled by `campus-years.ts`). A legacy editable workspace with
  that name yields `room.campus-conflict` and is preserved.
- `GET /api/simulation/engine/take?id=&from=&to=&entities=&include=` returns a compact take slice (view capability is
  enough).

## Storage and workload limits

- Per room and year: at most `MAX_PLANS` = 64 plans and `MAX_TAKES` = 32 takes; past a cap, the oldest ones no live
  workspace references are evicted, otherwise the call is refused with `room.storage-full`.
- Every JSON blob ≤ `MAX_BLOB_BYTES` (8 MiB); all blobs of a room and year ≤ `MAX_ROOM_BYTES` (64 MiB), counting state
  history and resume snapshots. Exceeding either is `room.storage-bytes`; the whole operation rolls back.
- Synchronous runs admit at most `ROOM_MAX_STEPS` = 96 steps and `ROOM_MAX_ENTITIES` = 128 entities (`workload.ts`);
  `bind_plan`, `rehearse`, `execute` and `resume` check before running and refuse with `room.workload-limit`. This is a
  conservative boundary, not proof that every smaller workload fits the Worker CPU allowance; larger runs need a measured
  acceptance case or segmented execution.

## Development

Run from `mars/viewer/`:

- `wrangler dev --config simulation/wrangler.jsonc --port 8797 --inspector-port 9237`: local Durable Object server; Vite
  proxies the simulation routes to it.
- `node deploy/simulation-integration.mjs`: real MCP handshake and tool calls, auth, isolation and idempotency tests in
  disposable rooms (`SIM_BASE` points it at another deployment). Test capabilities go only to the ignored
  `.cloudflare/simulation-test-room.json`.
- `npm test`: motion, geometry and camera tests.
- `wrangler types --config simulation/wrangler.jsonc simulation/env.d.ts`: regenerate binding types.
- `node deploy/catalog.mjs` and `node deploy/history-catalog.mjs`: regenerate navigation obstacles and visitors from the
  baseline and year scenes whenever their geometry changes.
