# Mars simulation

Cloudflare Worker endpoint `/mcp` uses the official MCP TypeScript server and its native Streamable HTTP handler. `MarsSimulation` is a SQLite Durable Object per room. Room state persists independently of any browser. The existing site and model downloads stay in the same deployment.

Create a room in the studio and copy its connection configuration. The browser generates a random 256-bit control capability. `view = SHA256(control)` and `room = SHA256(view)` allow the worker to authenticate control and read-only access without storing plaintext credentials. Bearer format is `room.capability`; keys never go into API URLs. Shareable spectator links carry only the view capability in the fragment. Possession grants access to that room, not to Cloudflare or campus files. Leave/create makes a new independent room; it does not revoke old invitations. OAuth and per-person account revocation are not implemented.

## State and commands

Twenty tools (plus the preview `engine_*` tools below) cover discovery, time/day length/simulation rate, weather, static cameras/orbits/spirals/keyframe paths, people/groups/activities, EUC missions, fire, seven gallery screens and atomic scene batches. The full external-agent contract is [public/simulation-agent-guide.md](../public/simulation-agent-guide.md), also published at `/simulation-agent-guide.md`. Schemas live in `commands.ts`; MCP `get_capabilities` returns their JSON Schema plus landmarks/IDs.

The server stores immutable motion paths and an anchored virtual clock `{real, virtual, rate}`. Pause freezes virtual time; rate changes re-anchor it without changing poses. `normalizeState` migrates old room state on read, preserving active and paused timelines. Commands clone before mutation and commit transactionally. `apply_scene` validates up to 12 children and commits one revision or none. The HTTP command endpoint has UUID idempotency keys (last 256 revisions). MCP creates a new command ID per invocation: retries are separate invocations.

Viewers poll once per second while visible, with cancellation, bounded timeout and error backoff. `?revision=N` returns only `{unchanged:true,revision,now}` when unchanged, avoiding repeated route/trajectory transfer and pose computation. A DO instance caches its loaded state and invalidates that cache only after a successful command transaction. No browser telemetry or archive data is sent to the server. Strict bounded schemas, authenticated body limits and same-origin browser validation guard the command surface.

Routes use baseline mesh bounds, inflated for people. Ground-level walking is currently mapped within ±60 m of Chiba; stationary indoor people are not routed through walls/stairs. EUCs follow an outer rounded rectangle enclosing the full model, or obstacle-aware connector routes to six campus parking docks. Return/dismount leaves the rider standing beside the wheel; circle remounts and approaches the perimeter without teleporting. A single campfire is placed in a three-metre-clear clearing; `start_activity` with `campfire` uses that clearing. Activities and generic people are illustrative, separate from the editable replica. Local layout editing is locked while connected. Shared routes do not yet model pedestrian collision avoidance or movable geometry.

`get_state` returns current interpolated poses and room state. New rooms start at 16:00 with the day–night cycle off; the room toggle and `set_environment` can enable passage of time. Existing rooms retain their chosen environment. The camera is a desired broadcast shot, not telemetry from a viewer. Viewers opt into remote camera following; static shots apply once per revision; trajectories are evaluated every frame while Follow remote camera is enabled. Pause and simulation rate affect the trajectory as well. No screenshots or rendering are returned by MCP.

## Engine tools (preview)

`/mcp` also exposes nine `engine_*` tools generated from the engine controller's op registry (`../engine/api/schemas.ts`, `controller.ts`) — the same registry, zod schemas and `rehearse`/`execute` code the browser and Node tests use; there is no separate control path. `engine-tools.ts` registers them; `engine-room.ts` keeps one `EngineController` per room/year inside `MarsSimulation` and persists it in `engine_blobs(key, chunk, data)` (≤ 512 KiB chunks, year-prefixed keys: `history` — the checkpoint/workspace index only, `state/<stateHash>` — one immutable blob per world state, `plan/<hash>`, `take/<id>`, `cams/<takeId>`), loading the index on first use and states/takes/plans/cameras on demand; an old-format `history` blob with inline states is migrated on first load. Each op persists its changes in one transaction; a commit writes only its new state plus the index, and `rehearse` writes nothing unless `keep: true`. `GET /api/simulation/engine/take?id=&from=&to=&entities=&include=` returns a compact take slice for viewers (view capability suffices). Rooms seed the synthetic `proving-ground` and `carry-yard` canonical workspaces; campus-year scenes are not wired yet. Workflow and tool contract: the "Engine tools" section of the agent guide.

Measured in `wrangler dev` (local workerd, M-series laptop): rehearse of the 60 s three-walker plan ≈ 200–260 ms in-DO (≈ 150 ms in Node), execute ≈ 200–270 ms, a 33 s two-person 12 ft beam carry ≈ 230 ms, a 60 s frameGroup camera track ≈ 230–300 ms. Stored: 60 s take ≈ 29 KB, plan ≈ 2.3 KB, history ≈ 5–7 KB after a few runs, camera track ≈ 100 KB (10 Hz samples). Engine code adds ≈ 260 KB (unminified) to the worker bundle. The same plan produced a byte-identical take id in Node and in workerd. These runs are far below DO CPU limits (30 s default), so no chunking of simulation is done; long takes should be capped or resolved in segments before campus-scale scenes arrive.

## Development

- `node deploy/catalog.mjs`: derive geometry obstacles and people from the baseline GLB, with no textures or private provenance copied.
- `wrangler dev --config simulation/wrangler.jsonc --port 8797 --inspector-port 9237`: isolated local DO server. Vite proxies the simulation routes here.
- `node deploy/simulation-integration.mjs`: real MCP handshake/tool calls, auth/isolation/idempotency tests. Set `SIM_BASE` for production verification. Creates disposable isolated rooms and writes test capabilities only to ignored `.cloudflare/simulation-test-room.json`.
- `npm test`: motion, geometry and camera tests.
- `wrangler types --config simulation/wrangler.jsonc simulation/env.d.ts`: regenerate runtime and binding types.
- Release: existing `deploy/prepare.py`, build (which runs `deploy/configure.mjs`), then `wrangler deploy --config dist/server/cloudflare.json`. Configure bundles the MCP worker and exports the DO class with its SQLite migration.

## Reusable assets

`../scripts/prepare_animated_people.py` applies source Mirror modifiers before exporting animated Quaternius CC0 people. Regression tests verify bilateral body/legs/feet and working clips.

`../scripts/prepare_euc.py` assembles Thingiverse model 3001166 by Qwertzu1029, CC BY 4.0. Original printable mesh files are kept under the generated reconstruction research directory. The derived GLB and attribution JSON are under `public/modular/environment/`. It is available in the studio library and as a direct GLB download. The stock campus library/Blender archive still contains the original baseline; simulation assets are separate.

## Historical campuses

The shared studio supports 2020–2026. Use `?year=YYYY` on `/mcp` and every `/api/simulation/*` request. Omission selects 2026 for compatibility. DO identities include year for historical rooms; the existing 2026 namespace is preserved. `get_capabilities` returns the selected year, its entity IDs, bounds and landmarks. Run `node deploy/history-catalog.mjs` whenever historical geometry changes, before building. This generates navigation obstacles and visitors from the actual scene, not a second hand-maintained map. Layout imports reject a different year.
