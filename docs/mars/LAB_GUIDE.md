# Seeing the engine: a user's guide (release 5, 2026-09-28)

Everything below is live at https://mars-campus-2026.<workers-subdomain>.workers.dev (release 5 = the checkpoint
tree). Scenes marked HYPOTHETICAL are illustrative builds on open ground, never historical claims.

## /lab — the Engine Lab
The deterministic engine running in the browser at a fixed 1/20 s tick, rendered with the studio's animated people.

**Controls (right panel):** Scenario picker · Play / Step / Reset · speed (1×–8×) · Expectations (the scenario's
own pass/fail checks, computed from engine state, not pixels) · Overlays, all off by default · Log (action
lifecycle: requested → validated → reserved → executing → completed, with `blocked` waits and their diagnostic
text, e.g. `traffic.person: p1 is waiting for p5 to move out of the way`) · Top-down / Oblique cameras.
Failures are shown as red banners; expected conflicts as amber.

**Overlays:** Walkability/clearance heatmap · Routes + corridors · Single-file traffic · Agent discs + facing ·
Obstacle footprints · Stair links (usable vs not) · Action phase labels · Violation markers · Prisms (year
walkabouts) · Slots (social: claimed vs free seats / fire places).

**Scenarios**
- *Wall, U-trap, Narrow passage, Stairs, Deck→ground, Incomplete stairs, Construction, Trio* — the spec §28
  proving-ground regressions. Incomplete stairs deliberately fails with the diagnostic naming the missing treads;
  Construction lets you drop a panel into the gap mid-walk and watch the replan.
- *Stress: 30 wanderers* — 30 people re-targeting continuously; watch violations stay at 0.
- *Build a rack bay (flagship, HYPOTHETICAL)* — 43-step sequence: six people carry two 12 ft uprights and four
  beams from piles, raise the frames (lifters walk the rising end up, footers at the base) and hold them, seat
  beams at 0.5 m and 1.8 m, release only when the assembly rule passes, fix joists, lift plywood over the side
  beam with the crew walking alongside, set the stair flight, install ten treads, then the visitor walks up.
  The Sequence Timeline shows each step's status; the HUD shows every wait.
- *Campfire evening (HYPOTHETICAL)* — social verbs: gather to the fire circle, converse, sit on chairs/benches
  via approach points, stand, an 11th person refused on a full circle (expected conflict), a directed walk
  pre-empting a circle member, ambient wandering. Seated and warming poses are procedural; talk/watch are Idle.
- *Year 2020 … 2026 walkabouts* — the real procedural year scene with the engine's obstacle prisms as a
  translucent overlay; four walkers cross the campus (2021 corridor between the two long buildings, 2022
  courtyard corner passages, 2024 frontage). Prism build time is shown in the HUD. Known data findings:
  2022 south-west corner is closed by the west-house table; trailers intrude into Chiba in 2023/2024.

Test hook for scripts: `window.__marsEngine` (`runScenario`, `step`, `runToEnd`, `state`, `violations`,
`records`, `setOverlay`, `camera`, `cameraPreset`, `perf`).

## /studio (2026) — Replay take
Bottom bar → **Replay take** → "Flagship rack bay at staging-east (HYPOTHETICAL)". The recorded campus take
(608 s simulated, 0 violations) plays inside the real 2026 scene east of Chiba. Scrubber with moment markers,
Play, speed, **Engine camera** (planned shot list: establishing, follow the carry, orbit the raise, beam close-up,
wide on the deck, follow the visitor up the stair; readability verified against the render) — drag the view to
take over, toggle back to return. Diagnostics readout shows violations/failed/blocked waits from the take. Ambient
people are hidden while a take plays; poses are identical with either camera (spec §18).

## MCP / director workflow
`/simulation-agent-guide.md` documents the 20 legacy tools and the 13 `engine_*` tools: `engine_list_verbs`,
`engine_query_world`, `engine_edit_world` (design edits on a fork), `engine_bind_plan`, `engine_rehearse`,
`engine_execute` (with `pauseAt`), `engine_resume`, `engine_fork`, `engine_log`, `engine_list`,
`engine_delete_workspace`, `engine_get_take`, `engine_attach_camera_track`. Rooms exist per year 2020–2026
(protected canonical `mars-<year>`; fork before editing or simulating).
Worked example against production (creates a disposable room):
`cd viewer && node deploy/director-demo.mjs --base https://mars-campus-2026.<workers-subdomain>.workers.dev`
— 9 steps in ~7 s: query → bind an impossible plan → structured refusal → revise → rehearse → execute → take →
camera track → fork → stale-plan refusal → pause/fork/resume. Transcript: DIRECTOR_DEMO.md.

## Engine-only for now (tests, no lab scene yet)
EUC and bicycle riding (`mount`, `ride_to`, `ride_loop`, `dismount`), the forklift (`forklift_pick`,
`forklift_deliver`), single-carrier loads up/down stairs, flagship v2 (forklift delivery + tread carried up the
stair + campfire ending, 66 steps). Adding "Flagship v2" and a "Vehicles" scenario to /lab is the natural next
lab task (see NEXT_SESSION_PROMPT.md).

## Local
`cd viewer && npm run dev` → http://127.0.0.1:5173/lab · `npm run gate` before any deploy · `npm run evidence`.
