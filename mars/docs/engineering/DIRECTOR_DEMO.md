# Director demo: the reference MCP session for an external director agent

`viewer/deploy/director-demo.mjs` is the north-star loop from spec §15/§16, run as a script
against the real MCP endpoint. An external agent that wants to direct the engine should copy
this sequence: discover → design-edit the world → bind → rehearse → read the diagnostic →
revise → rehearse clean → execute → shoot → fork → handle staleness → read the ledger and clean
up. Every expectation in the script is asserted, so if the engine's behaviour changes, the demo
fails loudly and doesn't just print something else.

```sh
cd viewer
node deploy/director-demo.mjs                                # starts wrangler dev on :8907 (fresh --persist-to), stops it after
node deploy/director-demo.mjs --base http://127.0.0.1:8907   # use a server you already started:
#   ./node_modules/.bin/wrangler dev --config simulation/wrangler.jsonc --port 8907 --inspector-port 9307
```

For production, point `--base` at `https://mars-campus-2026.<workers-subdomain>.workers.dev`. The script
creates its own room, so it never touches anyone else's.

The world is the `carry-yard` seed (`engine/carry/scenes.ts`, `engine/api/seeds.ts`):

- **Yard A** (x, z ∈ [0, 8]) holds the 12 ft beam `b1` and the crew `p1` and `p2`. Its only exit is
  the **2.5 m corridor A**, which runs east along z ≈ 4, turns north at x ≈ 18, and dead-ends at z = 14.
- **Yard B** (x ∈ [0, 8], z ∈ [18, 26]) is a separate compound, empty in the seed. Its only exit is
  the **1.5 m corridor B**, which runs east and then north into **yard B2** (x ∈ [14, 22],
  z ∈ [32, 40]). Yard B2 has a campfire (`fire`) and two benches (`bench-s`, `bench-e`).
- Regions: `yard-a`, `yard-b` (staging) and `yard-b2` (a place with an audience layout facing the
  fire), so the social verbs have targets.

Step 2 uses `engine_edit_world` to put a 19 ft upright and a crew of four into yard B. That makes
the canonical failure (a 19 ft upright can't get through the 1.5 m corridor) reachable over MCP.

All ids below (plans, takes, checkpoints) come from a real run on 2026-09-27. They are content
hashes, so the same templates and edits reproduce them exactly on any room or host with the same
rules version (`mars-engine/1+mars-assembly/2`) and seeds.

## Templates (copy these)

```js
// one coordinated carry; $crew / $beam are bound per plan
const delivery = (to, id = 'beam-delivery') => ({
  schema: 'mars-sequence/1', id,
  params: { crew: { kind: 'actors' }, beam: { kind: 'entity' } },   // kinds: actor|actors|entity|entities|number|string|point|any
  steps: [{ id: 'deliver', verb: 'carry', params: { crew: '$crew', item: '$beam', to } }],
});
const walk = (id, x, z) => ({
  schema: 'mars-sequence/1', id, params: { a: { kind: 'actor' } },
  steps: [{ id: 'go', verb: 'walk_to', params: { actor: '$a', x, z } }],
});
// engine_bind_plan { template: delivery({x:18, z:11, yaw:Math.PI/2}), bindings: {crew:['p1','p2'], beam:'b1'}, workspace:'scene-1' }

// design edits (all-or-nothing; one design-edit checkpoint). Spawning needs a fork with inventory:'unlimited'.
// engine_fork { from:'carry-yard', name:'scene-1', inventory:'unlimited' }
// engine_edit_world { workspace:'scene-1', note:'…', edits: [
//   { op:'spawn', id:'u1', def:'upright-19ft', lying:{x:4, z:22, yaw:0} },     // laid flat as carry sets loads down
//   { op:'spawn', id:'q1', def:'human', pose:{p:[1.5,0,19.5], yaw:0} },
//   { op:'move', id:'b1', lying:{x:4, z:5, yaw:0} }, { op:'remove', id:'q1' },
//   { op:'region', id:'yb', kind:'staging', polygon:[[0,18],[8,18],[8,26],[0,26]] } ] }
```

The handshake is copied from `deploy/simulation-integration.mjs`. A room is created on the client:
the control key K is random, the view key is sha256(K), and the room id is sha256(view key). The
agent then connects with `Authorization: Bearer ROOM.K` over Streamable HTTP to `/mcp`, using
`@modelcontextprotocol/client`.

**Result handling:** every engine result is JSON with `ok`. Every refusal uses one envelope,
`{ ok:false, code, message, details? }` with `isError: true`, and that includes input that fails
zod validation (`op.invalid-input`, with `details.issues[{path, message}]`). Op-specific payloads
ride along next to the envelope: a failed rehearsal (`rehearsal.failed`) keeps its `report` and
`take`, a stale execute (`plan.stale`) keeps its `diff`, and a refused bind keeps its
`diagnostics`. So check `isError`, then read `code` and `message`, then the payload.

## Annotated transcript

Arguments and payloads are trimmed (`…`). `[wall · in-DO]` is the client round-trip against the
server-side op time (`_meta.elapsedMs`).

### 1. Create a room, list verbs, query the world

```
# room 81e049cbaf98… (control capability = Bearer ROOM.KEY; view key = sha256(KEY))
← engine tools: engine_list_verbs, engine_query_world, engine_bind_plan, engine_rehearse, engine_execute, engine_fork,
                engine_edit_world, engine_log, engine_list, engine_delete_workspace, engine_get_take,
                engine_attach_camera_track
→ engine_list_verbs {}                                                        [13 ms · 0 ms]
← rules: mars-engine/1+mars-assembly/2
← 17 verbs: walk_to, carry, raise_upright, connect_beam, release_support, install_joist, install_plywood, install_stair_flight,
            install_tread, sit, take_slot, stand, face, converse, gather, campfire_circle, ambient_wander
← carry params: crew, item, to, place, via
→ engine_query_world {}                                                       [5 ms · 0 ms]
← workspace proving-ground: protected, head ff738e2e16495227a730be56
← workspace carry-yard: protected, head a26aa6258d67dbeb4065d779
→ engine_query_world {"workspace":"carry-yard","include":["regions","levels","links"]}   [21 ms · 14 ms]
← component b1: beam-12ft at (4.00, 4.00) yaw 0.00, phase stored
← fixture bench-e: bench-6ft at (19.90, 38.00) yaw 1.57
← fixture bench-s: bench-6ft at (15.60, 35.60) yaw 0.00
← fixture fire: campfire at (16.00, 38.00) yaw 0.00
← human p1: human at (2.00, 6.50) yaw 0.00, idle
← human p2: human at (6.00, 1.50) yaw 0.00, idle
← regions / levels / links: yard-a, yard-b, yard-b2 / 1 / 0
→ engine_fork {"from":"carry-yard","name":"scene 1"}                          [6 ms · 0 ms · isError]
← refused: op.invalid-input: "fork: input: name: workspace ids: letters, digits, _ . - (≤ 64)"
           details.issues [{"path":"name","message":"workspace ids: letters, digits, _ . - (≤ 64)"}]
→ engine_fork {"from":"carry-yard","name":"scene-1","label":"beam delivery","inventory":"unlimited"}   [5 ms · 0 ms]
← fork: scene-1 ← carry-yard, inventory unlimited, head 8c73128754069a98ef1643b4
```

Canonical workspaces are protected, so fork one before you edit or execute anything. A malformed
argument comes back in the same JSON envelope as any other refusal. `inventory: 'unlimited'` on
the fork is what lets `engine_edit_world` spawn from the catalog. It is recorded as its own
design-edit checkpoint (`8c731287…`), so the fork's head is not the canonical head. The first call
on a cold Durable Object also loads the history index (`_meta.loadMs`).
`engine_query_world` can also preview a move without binding anything:
`{workspace, route:{actor,x,z,level}}` or `{workspace, carry:{crew,item,to}}`. It runs the same
planners the verbs use and returns the same diagnostic you would get in step 2.

### 2. Design-edit the world, then a deliberately impossible plan and its diagnostic

```
# ask: a crew of four carries a 19 ft upright from yard B into yard B2, through the 1.5 m corridor B
→ engine_edit_world {workspace:scene-1, edits:[spawn u1 upright-19ft lying {x:4, z:20, yaw:π/2}]}   [22 ms · 14 ms · isError]
← refused: edit.blocked: "edit 0 (spawn u1): its footprint would overlap 'yard B south wall'" subjects u1, yb-s
→ engine_edit_world {workspace:scene-1, note:"19 ft upright + a crew of four in yard B (hypothetical)",
                     edits:[spawn u1 upright-19ft lying {x:4, z:22, yaw:0}, spawn q1…q4 human at the yard's corners]}  [20 ms · 14 ms]
← applied: spawned u1 (upright-19ft) centred at (4.00, 22.00) yaw 0.00, level 0
← applied: spawned q1 (human) centred at (1.50, 19.50) yaw 0.00, level 0     … q2 (6.50, 19.50), q3 (1.50, 24.50), q4 (6.50, 24.50)
← checkpoint: 74f04a234ea3487ccac6da98 (parent 8c73128754069a98ef1643b4),
              cause {"kind":"design-edit","note":"19 ft upright + a crew of four in yard B (hypothetical)"}
← diff: added q1, q2, q3, q4, u1
→ engine_bind_plan {template: delivery({x:18, z:36, yaw:π/2}, 'upright-delivery'), bindings:{crew:[q1,q2,q3,q4], beam:u1}, workspace:scene-1}  [5 ms · 0 ms]
← plan: b581702938e52f164b2e3d3a bound to 74f04a234ea3487ccac6da98
→ engine_rehearse {"plan_id":"b581702938e52f164b2e3d3a"}                     [118 ms · 111 ms · isError]
← status: rehearsal.failed / report.status aborted, ticks 0
← step deliver: carry.clearance — subjects u1, q1, q2, q3, q4, yb-e1
  "every crew member could walk to (18.0, 36.0) alone, but the carrying formation cannot: the 19 ft upright
   (5.8 m; formation 2.2 m wide with 4 carriers) cannot turn toward the way on at (6.6, 22.5) (route heading 0°):
   carrier q3 would intersect 'yard B east wall' — the formation gets no closer than 17.7 m to the target
   (18.0, 36.0) (5315 poses searched)"
← details: {"stuck":{"x":6.62,"z":22.48,"th":4.71},"blocker":"yb-e1","part":"carrier q3"}

# revision 1 (the other yard): set the 12 ft beam down across corridor A's dead end (yaw 0)
→ engine_bind_plan {template: delivery({x:18, z:12.5, yaw:0}), bindings:{crew:[p1,p2], beam:b1}, …}   [6 ms · 0 ms]
→ engine_rehearse {"plan_id":"6c80132117295eae91a786db"}                     [20 ms · 15 ms · isError]
← step deliver: carry.target-blocked: "the 12 ft beam b1 cannot be set down at (18.0, 12.5): laying it there would
  overlap 'corridor A inner (west) wall'"
```

Edits are validated in order against the progressively edited world, and they are all-or-nothing.
Every placement gets the same exact footprint tests the carry verb's set-down uses: static walls,
other components and fixtures at any height the item occupies, the level's floor, and standing
people. The first edit is refused and names the wall; nothing is committed. The second commits one
checkpoint with cause `design-edit` and returns the physical diff. Spawned items carry provenance
`design-edit` / `hypothetical`, so they are never mistaken for reconstruction.

Binding only checks the template against the registry schemas. Feasibility is decided by the
rehearsal. The rehearsal is refused before anything moves (`ticks 0`). The code is
`carry.clearance`, not `carry.no-route`: each of the four people could walk to yard B2 alone,
but the 5.8 m formation can't make the turn out of yard B into the corridor. The diagnostic gives
the agent what it needs to revise:

- the concrete wall id (`subjects`, `details.blocker`)
- the pose where the load jams (`details.stuck`, `at`)
- which part collides (here a carrier, `q3`, as opposed to the load itself)

Revision 1 shows the second common mistake: a 3.7 m beam laid crosswise doesn't fit in a 2.5 m
corridor.

### 3. Revise, rehearse clean

```
→ engine_bind_plan {template: delivery({x:18, z:11, yaw:π/2}), …}             [8 ms · 1 ms]
← plan: a09d4b0ad4ca36a61a95847b (a revision is a new content-hashed plan)
→ engine_rehearse {"plan_id":"a09d4b0ad4ca36a61a95847b"}                     [103 ms · 98 ms]
← status: completed, violations 0, diagnostics 0
← metrics: {"duration":33,"ticks":660,"replans":0,"pathLength":19.52,"blockedTicks":0,"violations":0}
← step outputs: {"x":18,"z":11,"yaw":1.5708,"length":19.52,"rotation":1.57,"replans":0}
← take: 9f39574db9d0e070921166a6 — 660 ticks, 14544 B, kept false
→ engine_log {"workspace":"scene-1"}                                          [5 ms · 0 ms]
← scene-1 head: 74f04a234ea3487ccac6da98 (unchanged by 3 rehearsals)
```

The beam turns the L corner (`rotation` 1.57 rad) and is set down lengthwise at the dead end:
33 s of simulated time, 0 violations. A rehearsal is private. It never moves a head, and its take
lives only in memory unless you pass `keep: true`.

### 4. Execute

```
→ engine_execute {"plan_id":"a09d4b0ad4ca36a61a95847b","workspace":"scene-1"}   [103 ms · 97 ms]
← checkpoint: 30d2630b2b8ded760f19a4ab (parent 74f04a234ea3487ccac6da98)
← cause: {"kind":"simulation-run","take":"9f39574db9d0e070921166a6","plan":"a09d4b0ad4ca36a61a95847b"}
← take: 9f39574db9d0e070921166a6 — identical to the rehearsal take (deterministic)
→ engine_query_world {"workspace":"scene-1","ids":["b1"]}                     [5 ms · 0 ms]
← b1 now: (17.95, 11.00) yaw 1.57, phase staged
```

Executing the same plan from the same baseline replays exactly what was rehearsed: same take id,
new checkpoint, and a cause that records `{take, plan}`.

### 5. Take slice and camera track

```
→ engine_get_take {"take_id":"9f39574db9d0e070921166a6","from":12,"to":14,"entities":["b1"]}   [5 ms · 1 ms]
← slice: range {"from":12,"to":14,"fromTick":240,"toTick":280}, b1 track 4 samples; events 0, changes 4
← b1 samples [tick, x_mm, y_mm, z_mm, yaw_mrad…]: [[236,9109,799,4155,170],[256,9957,799,4181,198],[276,…]]
→ engine_attach_camera_track {take_id, track_id:"crew-follow", shot:{kind:"follow", subject:"b1", offset:[-6,4,-3]}}  [75 ms · 65 ms]
← camera report: 331 samples, 0 invalid, 0 swept crossings, 1 cuts, 1 corrections, readable 1
← first correction: az-15 t 12.7–33 s: subject b1 20% occluded by 'yard A east wall'
→ engine_get_take {take_id, from:0, to:0.1, entities:["b1"], include:["cameras"]}   [6 ms · 1 ms]
← cameras on take: crew-follow (follow of b1, 10 Hz, 33 s)
→ engine_log {"workspace":"scene-1"}                                          [5 ms · 0 ms]
← take unchanged: takeHashUnchanged true; id 9f39574db9d0e070921166a6, finalStateHash 301d349e5ed4ac9f… before and after;
  scene-1 head still 30d2630b2b8ded760f19a4ab
```

`from`, `to` and `range` are all in seconds. `range.fromTick` and `range.toTick` give the same
window in ticks (1 s = 20 ticks), which is the unit of the track samples. Samples are integer
keyframes, so the slice includes the keyframe just before `from` (tick 236). The camera planner
explains every correction it makes: here it swung 15° in azimuth to get out from behind a wall.
Attaching a camera track re-simulates nothing, never changes the take, never moves a head, and
never makes a plan stale.

### 6. Fork and run an alternative future

```
→ engine_fork {"from":"scene-1","name":"scene-1-alt","label":"alternative: carry it back"}   [5 ms · 0 ms]
← fork: scene-1-alt at 30d2630b2b8ded760f19a4ab
→ engine_bind_plan {template: delivery({x:4, z:4, yaw:0}, 'beam-return'), …, workspace:scene-1-alt}   [4 ms · 1 ms]
→ engine_execute {"plan_id":"ba45ebb432be7070fb20f3a9","workspace":"scene-1-alt"}   [109 ms · 102 ms]
← alt execute: checkpoint 1e5ee84ec4db79401328bb96, take 6258a7c2b13dc9c7c0e72aa7, 732 ticks
→ engine_log {"workspace":"scene-1"}      → engine_log {"workspace":"scene-1-alt"}          [6–7 ms · 0 ms each]
← scene-1 HEAD: 30d2630b2b8ded760f19a4ab simulation-run take 9f39574d… plan a09d4b0a…
← scene-1     : 74f04a234ea3487ccac6da98 design-edit
← scene-1     : 8c73128754069a98ef1643b4 design-edit
← scene-1     : a26aa6258d67dbeb4065d779 canonical-publish
← scene-1-alt HEAD: 1e5ee84ec4db79401328bb96 simulation-run take 6258a7c2… plan ba45ebb4…
← scene-1-alt     : 30d2630b2b8ded760f19a4ab simulation-run take 9f39574d… plan a09d4b0a…
← scene-1-alt     : 74f04a234ea3487ccac6da98 design-edit
← scene-1-alt     : 8c73128754069a98ef1643b4 design-edit
← scene-1-alt     : a26aa6258d67dbeb4065d779 canonical-publish
← b1 in scene-1: (17.95, 11.00) yaw 1.57
← b1 in scene-1-alt: (4.00, 3.95) yaw 3.14
```

The log keeps design edits and simulated events apart: two `design-edit` checkpoints (the
inventory switch, then the upright and crew), then `simulation-run`s. The fork shares its history
up to `30d2630b…` and then diverges: the crew carries the beam back around the corner into yard A.
`scene-1` is untouched, with the same head and the same beam pose. There is no merge; to compare
futures, keep forking.

### 7. Plan staleness

```
→ engine_bind_plan {template: walk('p1-inspect', 6, 6), bindings:{a:p1}, workspace:scene-1-alt}   [9 ms · 0 ms]
← bound p1-inspect: 8bc70adc421e55f344dad800 to 1e5ee84ec4db79401328bb96
→ engine_bind_plan {template: walk('p1-step-aside', 2, 2), …}                                     [5 ms · 0 ms]
→ engine_execute {"plan_id":"352743ddc2b9e0570c3061bf","workspace":"scene-1-alt"}                 [24 ms · 19 ms]
← executed p1-step-aside: checkpoint 195454e07352850ee883b408
→ engine_execute {"plan_id":"8bc70adc421e55f344dad800","workspace":"scene-1-alt"}                 [5 ms · 0 ms · isError]
← execute p1-inspect: plan.stale
  "workspace scene-1-alt changed physically since plan 8bc70adc421e55f344dad800 was validated against
   1e5ee84ec4db79401328bb96: p1 changed (pose) — revalidate (rehearse/rebind) before executing"
← diff.changed: [{"id":"p1","fields":["pose"]}]
→ engine_rehearse {"plan_id":"8bc70adc421e55f344dad800"}                                          [25 ms · 20 ms]
← rehearse (still allowed): status completed, stale {"code":"plan.stale", …}
# fix: bind the same template again — it gets a new plan_id against the new head
→ engine_bind_plan {template: walk('p1-inspect', 6, 6), …}                                        [6 ms · 0 ms]
→ engine_execute {"plan_id":"50ad802162ed0c7db93c268f","workspace":"scene-1-alt"}                 [29 ms · 22 ms]
← re-bound + executed: 50ad802162ed0c7db93c268f → checkpoint 34077153214a5daf4db670ad
```

A plan is pinned to the checkpoint it was bound against. When the workspace changes physically,
execution is refused, and the `diff` (`added` / `removed` / `changed[{id, fields}]` / `regions`)
names what moved. You can still rehearse a stale plan: it replays against its own baseline and
reports `stale`. The fix is always to bind again.

### 8. Read the ledger, clean up

```
→ engine_list {"take_id":"9f39574db9d0e070921166a6"}                          [6 ms · 1 ms]
← plan 0: b581702938e52f164b2e3d3a upright-delivery (scene-1), 808 B, referenced by —
← plan 1: 6c80132117295eae91a786db beam-delivery (scene-1), 755 B, referenced by —
← plan 2: a09d4b0ad4ca36a61a95847b beam-delivery (scene-1), 785 B, referenced by 30d2630b2b8ded760f19a4ab
← plan 3: ba45ebb432be7070fb20f3a9 beam-return (scene-1-alt), 749 B, referenced by 1e5ee84ec4db79401328bb96
← plan 4: 8bc70adc421e55f344dad800 p1-inspect (scene-1-alt), 626 B, referenced by —
← plan 5: 352743ddc2b9e0570c3061bf p1-step-aside (scene-1-alt), 629 B, referenced by 195454e07352850ee883b408
← plan 6: 50ad802162ed0c7db93c268f p1-inspect (scene-1-alt), 626 B, referenced by 34077153214a5daf4db670ad
← take 0: 9f39574db9d0e070921166a6 kept true, 14544 B, cameras true, referenced by 30d2630b2b8ded760f19a4ab
← take 1: 6258a7c2b13dc9c7c0e72aa7 kept true, 16173 B, cameras false, referenced by 1e5ee84ec4db79401328bb96
← take 2: 2adf24bad4d35da2d1594194 kept true, 6241 B, cameras false, referenced by 195454e07352850ee883b408
← take 3: 9605c02b20eb69f64fa75215 kept true, 6272 B, cameras false, referenced by 34077153214a5daf4db670ad
← take 4–6: 0b18c30e…, 02567c00…, cc429e07… kept false (rehearsal takes held in memory), referenced by —
← cameras on the delivery take: crew-follow (follow of b1, 10 Hz, 33 s)
← workspace proving-ground: protected, head ff738e2e16495227a730be56
← workspace carry-yard: protected, head a26aa6258d67dbeb4065d779, forks scene-1
← workspace scene-1: editable, head 30d2630b2b8ded760f19a4ab, forks scene-1-alt
← workspace scene-1-alt: editable, head 34077153214a5daf4db670ad
→ engine_delete_workspace {"workspace":"scene-1"}                             [6 ms · 0 ms · isError]
← refused: workspace.has-forks: "workspace scene-1 is the fork parent of scene-1-alt; delete that first"
→ engine_delete_workspace {"workspace":"scene-1-alt"}                         [7 ms · 0 ms]
← deleted: scene-1-alt (head 34077153214a5daf4db670ad) — its checkpoints stay addressable by id (engine_fork `at`);
  plans/takes referenced only from it are now evictable
→ engine_list {"include":["takes"]}                                           [5 ms · 0 ms]
← now unreferenced (evictable): 6258a7c2…, 2adf24ba…, 9605c02b…, and the three unkept rehearsal takes
```

`engine_list` is the room's ledger, so an agent no longer has to keep its own. Plans and takes are
listed oldest first (`order`) with their stored size. `referencedByCheckpoint` names the
checkpoints of live workspaces whose `simulation-run` cause points at them. Past the room caps
(64 plans, 32 takes per year), the oldest unreferenced ones are evicted first. Deleting a
workspace is refused while another live workspace was forked from it, and the refusal names the
forks. After a delete, that workspace's runs count as unreferenced, which is how a long session
frees storage without starting a new room.

## Timings

These come from a local `wrangler dev` (workerd) on a Mac laptop, fresh room, against an
already-running server (`--base`). The whole script took 0.89 s.

| Step | Calls | Wall ms | In-DO ms |
| --- | ---: | ---: | ---: |
| 1. Create a room, list verbs, query the world | 6 | 93 | 14 |
| 2. Design-edit, bind an impossible plan, read the diagnostic | 6 | 191 | 154 |
| 3. Revise, rehearse clean | 3 | 116 | 99 |
| 4. Execute | 2 | 108 | 97 |
| 5. Take slice + camera track | 4 | 90 | 67 |
| 6. Fork + alternative plan + logs | 7 | 141 | 103 |
| 7. Staleness | 7 | 103 | 61 |
| 8. Ledger + cleanup | 4 | 25 | 1 |

The slowest call is the infeasible upright rehearsal: 111 ms in-DO, because the planner searches
5,315 poses before it can say the formation can't leave yard B. A feasible 33 s carry rehearses
or executes in about 100 ms, and a camera track plans in about 65 ms. A design edit costs about
15 ms in-DO (it builds the spatial grids once to check placements). Everything else costs under
10 ms of client round-trip.

## Tool gaps

Closed after the first run of this demo (the rows it used to list):

- **Design edits.** `engine_edit_world` spawns, moves and removes entities and adds or replaces
  regions (step 2). Spawning needs a fork with `inventory: 'unlimited'`.
- **Regions and social targets.** Both seeds carry regions and a campfire with two benches.
  Historical year rooms (`/mcp?year=2020…2025`) also start with protected canonical
  `mars-<year>`: the campus scene for that year with its regions (for example `chiba` and
  `kitchen` in 2022), no people, and finite inventory. Fork it and spawn people to direct it.
- **Error shapes.** There is one JSON refusal envelope, including for zod input failures.
- **Units.** `engine_get_take` takes and returns seconds; ticks are extra fields.
- **Ledger and deletion.** `engine_list` and `engine_delete_workspace` (step 8).

Still open:

- **Static geometry isn't editable.** Design edits change entities and regions, not the base
  scene: a director can't widen corridor B or remove a wall. To get different geometry, pick a
  different seed or year.
- **Holding social verbs need an explicit end.** `gather`, `campfire_circle` and `take_slot` hold
  their people until cancelled. In a plan, end them with `stand` steps at a cue (for example
  `{verb:'stand', params:{actor:'n1'}, at:60}` per person), or the rehearsal runs to the tick budget
  and fails `sequence.timeout` after 1,800 s. `ambient_wander` and `converse` take a `duration`.
  A `sit` step ended by `stand` is reported `cancelled`, so the plan status is `partial`.
- **A region's audience `layout` isn't part of the physical view.** Changing only a region's layout
  doesn't make a bound plan stale (`world/types.ts` `physicalView`).
- **Deleting a workspace doesn't delete its checkpoints.** They stay addressable by id (forking
  `at` one still works), but a take or plan they reference may since have been evicted, so
  `engine_get_take` on it can return `take.unknown`.
- **2026 rooms stay synthetic.** A 2026 room has only `proving-ground` and `carry-yard`; the
  reconstructed `mars-2026` scene isn't seeded into rooms yet.
