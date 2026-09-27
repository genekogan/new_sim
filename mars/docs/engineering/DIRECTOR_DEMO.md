# Director demo: the reference MCP session for an external director agent

`viewer/deploy/director-demo.mjs` is the north-star loop from spec §15/§16, run as a script
against the real MCP endpoint. An external agent that wants to direct the engine should copy
this sequence: discover → bind → rehearse → read the diagnostic → revise → rehearse clean →
execute → shoot → fork → handle staleness. Every expectation in the script is asserted, so
if the engine's behaviour changes, the demo fails loudly and doesn't just print something else.

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
- **Yard B2** (x ∈ [14, 22], z ∈ [32, 40]) is reached only through the **1.5 m corridor B** from
  yard B, which is a separate compound.

All ids below (plans, takes, checkpoints) come from a real run on 2026-09-27. They are content
hashes, so the same templates reproduce them exactly on any room or host with the same rules
version (`mars-engine/1+mars-assembly/2`).

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
```

The handshake is copied from `deploy/simulation-integration.mjs`. A room is created on the client:
the control key K is random, the view key is sha256(K), and the room id is sha256(view key). The
agent then connects with `Authorization: Bearer ROOM.K` over Streamable HTTP to `/mcp`, using
`@modelcontextprotocol/client`.

**Result handling:** check `isError` on every call, but **parse the JSON body anyway**. A failed
rehearsal (`rehearsal.failed`) and a refused execute (`plan.stale`) are `isError: true` results
that carry the structured report or diff. Input that fails zod validation comes back as plain
text (`Input validation error: …`), not JSON.

## Annotated transcript

Arguments and payloads are trimmed (`…`). `[wall · in-DO]` is the client round-trip against the
server-side op time (`_meta.elapsedMs`).

### 1. Create a room, list verbs, query the world

```
# room b636d8bd95d6… (control capability = Bearer ROOM.KEY; view key = sha256(KEY))
← engine tools: engine_list_verbs, engine_query_world, engine_bind_plan, engine_rehearse, engine_execute, engine_fork,
                engine_log, engine_get_take, engine_attach_camera_track
→ engine_list_verbs {}                                                        [16 ms · 3 ms]
← rules: mars-engine/1+mars-assembly/2
← 17 verbs: walk_to, carry, raise_upright, connect_beam, release_support, install_joist, install_plywood, install_stair_flight,
            install_tread, sit, take_slot, stand, face, converse, gather, campfire_circle, ambient_wander
← carry params: crew, item, to, place
→ engine_query_world {}                                                       [5 ms · 1 ms]
← workspace proving-ground: protected, head 76f5c86995ac183b0aaa216e
← workspace carry-yard: protected, head d8ad322dbc9065cff0eaddf1
→ engine_query_world {"workspace":"carry-yard","include":["regions","levels","links"]}   [26 ms · 21 ms]
← component b1: beam-12ft at (4.00, 4.00) yaw 0.00, phase stored
← human p1: human at (2.00, 6.50) yaw 0.00, idle
← human p2: human at (6.00, 1.50) yaw 0.00, idle
← regions / levels / links: 0 / 1 / 0
→ engine_fork {"from":"carry-yard","name":"scene-1","label":"beam delivery"}  [5 ms · 0 ms]
← fork: scene-1 ← carry-yard at d8ad322dbc9065cff0eaddf1
```

Canonical workspaces are protected, so fork one before you bind anything you plan to execute.
The first call on a cold Durable Object also loads the history index (`_meta.loadMs`). The social
verbs (`sit` … `ambient_wander`) come from an in-progress track and may change.
`engine_query_world` can also preview a move without binding anything:
`{workspace, route:{actor,x,z,level}}` or `{workspace, carry:{crew,item,to}}`. It runs the same
planners the verbs use and returns the same diagnostic you would get in step 2.

### 2. A deliberately impossible plan and its diagnostic

```
# ask: carry the beam into yard B2, at the far end of the 1.5 m corridor B
→ engine_bind_plan {template: delivery({x:18, z:36, yaw:π/2}), bindings:{crew:[p1,p2], beam:b1}, workspace:scene-1}  [6 ms · 0 ms]
← plan: 5dd77e5a86cfa08de81ef56e bound to d8ad322dbc9065cff0eaddf1
→ engine_rehearse {"plan_id":"5dd77e5a86cfa08de81ef56e"}                     [209 ms · 204 ms · isError]
← status: rehearsal.failed / report.status aborted, ticks 0
← step deliver: carry.no-route — subjects b1, p1, p2, ca-end
  "the 12 ft beam (3.7 m; formation 1.3 m wide with 2 carriers) cannot turn toward the way on at (18.0, 12.2)
   (route heading 90°): the load would intersect 'corridor A end wall' — the formation gets no closer than 23.8 m
   to the target (18.0, 36.0) (17908 poses searched)"
← details: {"stuck":{"x":18.00,"z":12.20,"th":2.16},"blocker":"ca-end","part":"the load"}

# revision 1: stay in corridor A, set the beam down across the dead end (yaw 0)
→ engine_bind_plan {template: delivery({x:18, z:12.5, yaw:0}), …}             [5 ms · 0 ms]
→ engine_rehearse {"plan_id":"c83a76742ca829ff9733f855"}                     [21 ms · 16 ms · isError]
← step deliver: carry.target-blocked: "the 12 ft beam b1 cannot be set down at (18.0, 12.5): laying it there would
  overlap 'corridor A inner (west) wall'"
```

Binding only checks the template against the registry schemas. Feasibility is decided by the
rehearsal. The rehearsal is refused before anything moves (`ticks 0`), and the diagnostic gives the
agent what it needs to revise:

- the concrete wall id (`subjects`, `details.blocker`)
- the pose where the load jams (`details.stuck`, `at`)
- which part collides (`the load`, as opposed to a carrier)

Yard A opens only onto corridor A, so yard B2 can't be reached from here. The planner reports how
close it got. Revision 1 shows the second common mistake: a 3.7 m beam laid crosswise doesn't fit
in a 2.5 m corridor.

### 3. Revise, rehearse clean

```
→ engine_bind_plan {template: delivery({x:18, z:11, yaw:π/2}), …}             [4 ms · 0 ms]
← plan: efad382adbbbf1c031c106cd (a revision is a new content-hashed plan)
→ engine_rehearse {"plan_id":"efad382adbbbf1c031c106cd"}                     [95 ms · 90 ms]
← status: completed, violations 0, diagnostics 0
← metrics: {"duration":33,"ticks":660,"replans":0,"pathLength":19.52,"blockedTicks":0,"violations":0}
← step outputs: {"x":18,"z":11,"yaw":1.5708,"length":19.52,"rotation":1.57,"replans":0}
← take: 6c13f2bdf88bd01f1ab8d526 — 660 ticks, 11425 B, kept false
→ engine_log {"workspace":"scene-1"}                                          [4 ms · 0 ms]
← scene-1 head: d8ad322dbc9065cff0eaddf1 (unchanged by 3 rehearsals)
```

The beam turns the L corner (`rotation` 1.57 rad) and is set down lengthwise at the dead end:
33 s of simulated time, 0 violations. A rehearsal is private. It never moves a head, and its take
lives only in memory unless you pass `keep: true`.

### 4. Execute

```
→ engine_execute {"plan_id":"efad382adbbbf1c031c106cd","workspace":"scene-1"}   [83 ms · 78 ms]
← checkpoint: 05ee43709f612d6453e68d4f (parent d8ad322dbc9065cff0eaddf1)
← cause: {"kind":"simulation-run","take":"6c13f2bdf88bd01f1ab8d526","plan":"efad382adbbbf1c031c106cd"}
← take: 6c13f2bdf88bd01f1ab8d526 — identical to the rehearsal take (deterministic)
→ engine_query_world {"workspace":"scene-1","ids":["b1"]}                     [4 ms · 0 ms]
← b1 now: (17.95, 11.00) yaw 1.57, phase staged
```

Executing the same plan from the same baseline replays exactly what was rehearsed: same take id,
new checkpoint, and a cause that records `{take, plan}`.

### 5. Take slice and camera track

```
→ engine_get_take {"take_id":"6c13f2bdf88bd01f1ab8d526","from":12,"to":14,"entities":["b1"]}   [5 ms · 1 ms]
← slice: range {"from":240,"to":280}, b1 track 4 samples; events 0, changes 4
← b1 samples [tick, x_mm, y_mm, z_mm, yaw_mrad…]: [[236,9109,799,4155,170],[256,9957,799,4181,198],[276,…]]
→ engine_attach_camera_track {take_id, track_id:"crew-follow", shot:{kind:"follow", subject:"b1", offset:[-6,4,-3]}}  [80 ms · 75 ms]
← camera report: 331 samples, 0 invalid, 0 swept crossings, 1 cuts, 1 corrections, readable 1
← first correction: az-15 t 12.7–33 s: subject b1 20% occluded by 'yard A east wall'
→ engine_get_take {take_id, from:0, to:0.1, entities:["b1"], include:["cameras"]}   [7 ms · 1 ms]
← cameras on take: crew-follow (follow of b1, 10 Hz, 33 s)
→ engine_log {"workspace":"scene-1"}                                          [5 ms · 0 ms]
← take unchanged: takeHashUnchanged true; id 6c13f2bdf88bd01f1ab8d526, finalStateHash c28767b5ec8682aa… before and after;
  scene-1 head still 05ee43709f612d6453e68d4f
```

`from` and `to` are in seconds, but `range` comes back in ticks (1 s = 20 ticks). Samples are
integer keyframes, so the slice includes the keyframe just before `from` (tick 236). The camera
planner explains every correction it makes: here it swung 15° in azimuth to get out from behind a
wall. Attaching a camera track re-simulates nothing, never changes the take, never moves a head,
and never makes a plan stale.

### 6. Fork and run an alternative future

```
→ engine_fork {"from":"scene-1","name":"scene-1-alt","label":"alternative: carry it back"}   [4 ms · 0 ms]
← fork: scene-1-alt at 05ee43709f612d6453e68d4f
→ engine_bind_plan {template: delivery({x:4, z:4, yaw:0}, 'beam-return'), …, workspace:scene-1-alt}   [4 ms · 1 ms]
→ engine_execute {"plan_id":"b6fc98d6ec8d9a5b6fb4552b","workspace":"scene-1-alt"}   [90 ms · 85 ms]
← alt execute: checkpoint 421a98e4193caca364628bd0, take 176fa8815486551d848d5c4c, 732 ticks
→ engine_log {"workspace":"scene-1"}      → engine_log {"workspace":"scene-1-alt"}          [4 ms · 0 ms each]
← scene-1 HEAD: 05ee43709f612d6453e68d4f simulation-run take 6c13f2bd… plan efad382a…
← scene-1     : d8ad322dbc9065cff0eaddf1 canonical-publish
← scene-1-alt HEAD: 421a98e4193caca364628bd0 simulation-run take 176fa881… plan b6fc98d6…
← scene-1-alt     : 05ee43709f612d6453e68d4f simulation-run take 6c13f2bd… plan efad382a…
← scene-1-alt     : d8ad322dbc9065cff0eaddf1 canonical-publish
← b1 in scene-1: (17.95, 11.00) yaw 1.57
← b1 in scene-1-alt: (4.00, 3.95) yaw 3.14
```

The fork shares its history up to `05ee4370…` and then diverges: the crew carries the beam back
around the corner into yard A. `scene-1` is untouched, with the same head and the same beam pose.
There is no merge; to compare futures, keep forking.

### 7. Plan staleness

```
→ engine_bind_plan {template: walk('p1-inspect', 6, 6), bindings:{a:p1}, workspace:scene-1-alt}   [3 ms · 0 ms]
← bound p1-inspect: a0f12ea388a3fc0d05e1c30e to 421a98e4193caca364628bd0
→ engine_bind_plan {template: walk('p1-step-aside', 2, 2), …}                                     [3 ms · 0 ms]
→ engine_execute {"plan_id":"19597dff402c189b62ccb342","workspace":"scene-1-alt"}                 [25 ms · 19 ms]
← executed p1-step-aside: checkpoint dc7db5b39c54ca96be116ea3
→ engine_execute {"plan_id":"a0f12ea388a3fc0d05e1c30e","workspace":"scene-1-alt"}                 [4 ms · 1 ms · isError]
← execute p1-inspect: plan.stale
  "workspace scene-1-alt changed physically since plan a0f12ea388a3fc0d05e1c30e was validated against
   421a98e4193caca364628bd0: p1 changed (pose) — revalidate (rehearse/rebind) before executing"
← diff.changed: [{"id":"p1","fields":["pose"]}]
→ engine_rehearse {"plan_id":"a0f12ea388a3fc0d05e1c30e"}                                          [22 ms · 16 ms]
← rehearse (still allowed): status completed, stale {"code":"plan.stale", …}
# fix: bind the same template again — it gets a new plan_id against the new head
→ engine_bind_plan {template: walk('p1-inspect', 6, 6), …}                                        [4 ms · 0 ms]
→ engine_execute {"plan_id":"1c02a4af2a9c6604c27aba27","workspace":"scene-1-alt"}                 [21 ms · 16 ms]
← re-bound + executed: 1c02a4af2a9c6604c27aba27 → checkpoint 1a696030f26b87f0db98f409
```

A plan is pinned to the checkpoint it was bound against. When the workspace changes physically,
execution is refused, and the `diff` (`added` / `removed` / `changed[{id, fields}]` / `regions`)
names what moved. You can still rehearse a stale plan: it replays against its own baseline and
reports `stale`. The fix is always to bind again.

## Timings

These come from a local `wrangler dev` (workerd) on a Mac laptop, fresh room. Wrangler
started in 0.75 s, and the whole script took 1.6 s.

| Step | Calls | Wall ms | In-DO ms |
| --- | ---: | ---: | ---: |
| 1. Create a room, list verbs, query the world | 5 | 81 | 25 |
| 2. Impossible plan: bind ×2, rehearse ×2 | 4 | 241 | 220 |
| 3. Revise, rehearse clean | 3 | 103 | 90 |
| 4. Execute | 2 | 87 | 78 |
| 5. Take slice + camera track | 4 | 96 | 77 |
| 6. Fork + alternative plan + logs | 7 | 113 | 87 |
| 7. Staleness | 7 | 83 | 52 |

The slowest call is the infeasible carry rehearsal: 204 ms in-DO, because the planner exhausts
17,908 poses before it can say "no route". A feasible 33 s carry rehearses or executes in
about 80–90 ms, and a camera track plans in about 75 ms. Everything else costs under 10 ms
of client round-trip.

## Gaps an external director will hit

- **No design-edit or spawn op.** A director can't add a component (for example a 19 ft upright in
  yard B) or change the geometry (such as a corridor width) through MCP. It can only choose among the
  seeded workspaces and move what they contain. So the canonical "19 ft upright vs the 1.5 m
  corridor" failure is proven in-process (`engine/test/carry.test.ts`) but can't be reached from
  MCP. In this demo, the impossible request is "yard B2, which is behind corridor B".
- **Synthetic worlds only.** There are no regions yet (`include:["regions"]` returns `[]`), so the
  `region` filter and the `region` arguments of `gather` and `ambient_wander` have nothing to target in
  either seed. Campus-year scenes aren't extracted yet.
- **Error shapes differ.** Engine refusals are JSON bodies with `isError: true`. Zod input failures
  are plain text. A client needs both paths (see `call()` in the script).
- **Units differ.** `engine_get_take` takes `from` and `to` in seconds but returns `range` in ticks.
- **There is no op to list stored plans or takes, and none to delete a workspace.** Keep your own
  ledger of plan and take ids. Rooms cap out at 64 plans and 32 takes per year (see the agent
  guide).
