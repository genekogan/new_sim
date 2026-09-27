# Mars campus simulation — external agent guide (v3)

Production studio: https://mars-campus-2026.<workers-subdomain>.workers.dev/studio

MCP endpoint: https://mars-campus-2026.<workers-subdomain>.workers.dev/mcp

Transport: **Streamable HTTP**, with an `Authorization` header. This is not a stdio or legacy SSE endpoint. The same endpoint serves independent persistent rooms. Select a year with `?year=2020` through `?year=2026` on every MCP or REST request; omission means 2026. The studio copies the correct URL automatically. Room state is isolated by both year and room ID. A room in 2022 cannot move people in 2026.

## Years and shared controls

Open `/studio/2020` through `/studio/2026` (or `/studio` for 2026). All years share walking, keyboard look/jump, editing, cutaways, weather, day/night, campfires, animated people, EUCs, camera trajectories and MCP. Historical visitors and riders are illustrative, not a claim that those people or vehicles were photographed that year. 2020 starts with fewer visitors and two riders. Discover entity IDs and landmarks with `get_capabilities` for each year; never reuse another year’s IDs. Saved editable layouts also carry their year.

Example 2022 endpoint: `https://mars-campus-2026.<workers-subdomain>.workers.dev/mcp?year=2022`.

## Connect once

1. Open the studio. Save any edited layout; shared simulations use the baseline campus.
2. Expand **Simulation & MCP**, choose **Create simulation room**, and wait for **Connected**.
3. Choose **Copy MCP connection**, or **Connection details**. Give that configuration to your trusted external agent/client through its private settings. It contains the room's control capability.
4. Keep the studio in that room. Check **Follow remote camera** if the agent should direct your view. Keep **People & desert breeze** enabled to display moving people (especially if your browser prefers reduced motion).
5. The external agent connects, lists tools, calls `get_capabilities`, then `get_state`. Do not invent entity IDs or assume another room is the same room.

Configuration shape (replace the placeholders with the configuration copied from the studio):

```json
{
  "mcpServers": {
    "mars": {
      "url": "https://mars-campus-2026.<workers-subdomain>.workers.dev/mcp",
      "headers": {"Authorization": "Bearer ROOM_ID.CONTROL_KEY"}
    }
  }
}
```

Client configuration formats vary. The required pieces are the HTTP URL and Authorization header. There is no OAuth login or account-registration step. A client that supports only stdio needs its own HTTP bridge; do not paste a token into a public URL or chat. There is no need to give the agent Cloudflare credentials.

**Copy viewing link** creates a read-only spectator link. It cannot control the room or connect to MCP. Keep the control configuration private. Leaving a room does not delete it or revoke its keys; to stop using a disclosed key, create another room and move viewers there. This capability system has no per-person roles, expiry, billing quotas or revocation yet. Do not treat it as a public multi-tenant account service.

## Agent operating instructions

- `get_capabilities` gives all command schemas, stable person/rider/screen IDs, landmarks, navigation limits and clock semantics. `tools/list` is authoritative for argument validation.
- `get_state` gives the current revision, wall-clock `now`, persistent state, current person poses, EUC poses/actions, current camera pose and hour.
- Use `apply_scene` to coordinate up to 12 mutation commands atomically at one simulation instant. A rejected child rejects the entire batch. Nested batches and reset are forbidden.
- Check `isError` on every MCP result. A transport success is not necessarily an accepted command. Read `get_state` after uncertain outcomes. Do not retry a movement command indefinitely: inspect the error and choose a reachable destination.
- Commands change shared state; they do not require a browser to be open. Rendering occurs in each viewer. Open viewers receive changes in approximately one second; hidden tabs suspend rendering and polling, then catch up.
- Camera follow is an explicit viewer preference. The server cannot enable it for somebody else. A successful camera tool can therefore have no visible effect in a viewer that has not opted in.
- Coordinates are **metres, Y up**; ground is **Y = -0.16**. Landmarks and model dimensions are approximate. Camera trajectories enforce ground clearance, not collision avoidance with structures. Choose elevated paths for reliable exterior shots.
- New rooms start at 16:00 (4 PM) with the day–night cycle off. The room's **Time passes · day–night cycle** checkbox or `set_environment {cycle:true}` enables it. When enabled, the clock advances while all viewers are away; paused rooms stay paused. A day is 480 virtual seconds by default. `set_simulation_speed` scales people, riders, day/night, screen animation and camera paths together; `set_environment.day_seconds` changes only the sky's day length. Durations below are virtual seconds. For a 120-second real camera path at rate 2, request duration 240.
- Use explicit user intent for destructive reset. `reset_simulation` resets room controls, not campus geometry or local saved layouts.

## Tools and controls

| Tool | Arguments and behavior |
|---|---|
| `get_capabilities` | `{}`. Schemas, IDs, landmarks, limitations. |
| `get_state` | `{}`. Full state and current evaluated poses. |
| `set_environment` | Optional `hour` 0–23.99, `cycle` boolean, `day_seconds` 60–86400. Unspecified values persist; changing speed/day length does not jump the hour. |
| `set_weather` | Optional `preset`: `clear`, `cloudy`, `rainy`, `windy`, `dusty`; optional `clouds`, `rain`, `wind`, `dust` 0–1 and `wind_direction` 0–360 degrees. A preset replaces all weather values, then overrides apply. No preset means patch current weather. Wind angle 0 points +X, 90 points +Z. |
| `set_simulation_speed` | `rate` 0.1–8. Does not unpause the room. |
| `set_paused` | `paused` boolean. Freeze/resume all shared clocks without teleporting. Commands can still change state while paused. |
| `set_camera` | `position: [x,y,z]`, `target: [x,y,z]`. Replaces any trajectory. Position Y 0.05–200; X/Z ±300. Position and target must differ. |
| `set_camera_trajectory` | `target` default `[0,2,8]`; `radius` default 35 and optional `end_radius` (2–150); `height` default 15 and optional `end_height` (absolute world Y, 0.2–150); `turns` integer ±1…8; `duration` 5–3600 (default 120); `loop` default true. Orbit if endpoints equal, spiral otherwise. In a loop the height/radius move out and back smoothly so there is no jump at the seam. Negative turns reverse direction. Duration covers all turns. |
| `set_camera_path` | `points`: 2–32 `{position,target}` keyframes, `duration` 5–3600, `loop` default false. Linear interpolation with equal time per segment. Loop appends the first point. Unequal segment lengths produce different speeds; use roughly equal spacing for steady travel. Non-looping paths hold their final view. Rejects camera/target crossings. |
| `stop_camera` | `{}`. Hold the camera at its current evaluated pose. |
| `move_person` | `person_id`, `x`, `z` (±59). Move one outdoor walker on a collision-aware route. |
| `move_group` | `people: "all"` or 1–8 unique outdoor IDs; `x`, `z` (±55); optional `spacing` 1–5 (default 2). Move a group into a formation with up to three columns. Every route must be reachable. |
| `set_person_activity` | `person_id`, `activity`: `idle`, `wave`, `talk`, `wander`. Indoor people support stationary activities. |
| `start_activity` | `name`: `talk`, `gathering`, `campfire`; `people`: 1–8 unique outdoor IDs; `x`, `z` ±55 (required; ignored for campfire). Gather in a 3.5 m radius circle. Campfire uses its fixed clearing and lights the fire. All routes must be reachable. |
| `set_euc_riders` | Optional `enabled`, `count` 0–6, `speed` 0.5–6 m/s. Default 3 riders at 3 m/s. Hiding riders is different from stopping them; use rider missions or pause to stop motion. |
| `command_euc_riders` | `riders: "all"` (default, enabled riders) or unique `euc-1`…`euc-6`; `action`: `circle`, `return`, `stop`, `dismount`; `dismount_on_arrival` default true. Return routes to discovered parking docks; circle remounts and routes back onto the whole-campus loop without teleporting. Stop holds current position; dismount parks the wheel and puts its rider beside it. Disabled selected riders are rejected. |
| `set_fire` | `mode`: `on`, `off`, `auto` (after dusk). One fixed campfire at the discovered clearing; this is a visual effect, not fire spread. |
| `set_screens` | `screens: "all"` (default) or IDs from capabilities; optional `enabled`, `program`: `art`, `talk`, `test`; `brightness` 0.1–2; `title` plain text up to 100 characters. Programs are local procedural artwork, a title slide, or test bars. No arbitrary URLs, uploads, audio or browser autoplay dependence. |
| `apply_scene` | `commands: [{name,args},…]`, 1–12. One atomic scene revision. |
| `reset_simulation` | `{}`. Restore defaults in this room. |

Screen IDs: `hall-projector`, `gallery-upper-1`, `gallery-upper-2`, `gallery-upper-3`, `gallery-lower-1`, `gallery-lower-2`, `gallery-lower-3`.

## Example: rainy Mars, slow spiral, recall all EUCs

Call `get_state` first. If paused, include `set_paused: {paused:false}`. If riders are disabled, include `set_euc_riders: {enabled:true,count:3}` before recall. Then:

```json
{
  "commands": [
    {"name":"set_weather","args":{"preset":"rainy","wind":0.6}},
    {"name":"set_simulation_speed","args":{"rate":1}},
    {"name":"set_environment","args":{"hour":16,"cycle":false}},
    {"name":"set_camera_trajectory","args":{"target":[0,2,8],"radius":40,"end_radius":22,"height":30,"end_height":12,"turns":2,"duration":180,"loop":true}},
    {"name":"command_euc_riders","args":{"riders":"all","action":"return","dismount_on_arrival":true}},
    {"name":"set_screens","args":{"enabled":true,"program":"art"}}
  ]
}
```

Send that object to `apply_scene`. The looping spiral returns smoothly to its starting height/radius. All enabled EUCs take routes back to their own docks and their riders stand beside the parked wheels.

## More scenes

**Gallery evening:** batch `set_environment {hour:20,cycle:false}`, `set_screens {enabled:true,program:"art",brightness:1.2}`, `set_fire {mode:"on"}`. The gallery uses a portrait projection wall and six small monitors across two tiers, based on the reference photos. Use a static interior shot after inspecting the scene; an outside camera cannot see through opaque walls.

**Thunder Talk:** use `set_screens {screens:["hall-projector"],enabled:true,program:"talk",title:"Thunder Talks — Mars College"}`. Use `set_person_activity` to make indoor people talk/wave. Outdoor walkers cannot yet be routed up stairs or into the classroom.

**Call people back:** `move_group {people:"all",x:-15,z:28,spacing:2}` targets the open area near the campus parking docks. Routes reflect the baseline layout. A blocked destination is an error, not a request to walk through a wall.

**Desert wind:** `set_weather {preset:"dusty",dust:0.5,wind:0.8}`; return to clear with `set_weather {preset:"clear"}`.

**Send EUCs out again:** `command_euc_riders {riders:"all",action:"circle"}`. It remounts them and follows obstacle-aware connector routes before joining the perimeter loop.

## Programmatic connection (JavaScript, MCP SDK v2)

Install `@modelcontextprotocol/client`. Supply the copied token privately in `MARS_CAPABILITY` (ROOM_ID.CONTROL_KEY); never put it in source control.

```js
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
const client = new Client({name:'mars-director',version:'1.0.0'});
await client.connect(new StreamableHTTPClientTransport(
  new URL('https://mars-campus-2026.<workers-subdomain>.workers.dev/mcp'),
  {requestInit:{headers:{Authorization:`Bearer ${process.env.MARS_CAPABILITY}`}}}
));
const capabilities = await client.callTool({name:'get_capabilities',arguments:{}});
const result = await client.callTool({name:'set_weather',arguments:{preset:'rainy'}});
if (result.isError) throw new Error(result.content[0].text);
await client.close();
```

For clients without MCP, the same room supports authenticated REST:

- `GET /api/simulation/state` → full snapshot. Optional `?revision=N` returns `{unchanged:true,revision,now}` if unchanged; retain your prior state and update server time.
- `POST /api/simulation/command`, JSON `{name,args,id}`; `id` is a fresh UUID per logical command. Reuse the **same UUID and exact parsed arguments** after an uncertain response. Receipts retain the most recent 256 revisions; no indefinite exactly-once guarantee. Reusing an ID with different arguments is rejected.
- REST responses: 401 missing capability, 403 invalid/view-only/origin mismatch, 405 wrong method, 413 body over 32 KiB, 400 invalid command. MCP command failures use `isError` with explanatory text.
- Commands are serialized in a Durable Object. No last-writer version precondition: coordinate multiple directing agents at the application level.

## Boundaries and browser requirements

Modern WebGL2 browser and WebAssembly required. The browser campus transfer is about 38.5 MB with Brotli (70.8 MB decoded GLB); geometry is losslessly compressed and browser textures capped at 1024 px. Original full-texture GLB/Blender files remain downloadable. Edited browser exports use the browser textures. The renderer adapts pixel ratio downward under sustained load, suspends in hidden tabs, and handles WebGL context loss/restoration. Low-memory/mobile devices can still struggle with this large campus; no claim of universal mobile performance is made.

People and riders are generic illustrations, not historical inventory. Ground walking covers ±60 m around Chiba; indoor/stair routing is not mapped. EUC routes cover the baseline campus perimeter and docks, with conservative obstacle clearance; riders do not implement traffic physics or dynamic avoidance of other people. Dismount is a change to a static standing pose, not a motion-captured animation. Weather includes sky/cloud lighting, rain streaks, wind-driven vegetation/dust and wet-looking ground. Rain is masked under a coarse roof-height map; it is not a hydrology simulation. Gallery fixture placement is photo-informed, not surveyed, and procedural screen artwork is not a reproduction of historical artworks. Gallery screens and weather are presentation overlays and are not added to the editable construction inventory. Camera trajectories can pass through buildings: use elevated paths and inspect results.

This version adds no billing or user management. Rooms are persistent and capability-protected; anyone with a valid control capability can direct their room. Keep this deployment's intended community scale in mind before distributing it as a public service.
