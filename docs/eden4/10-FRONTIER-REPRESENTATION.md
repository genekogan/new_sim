# 10 — The frontier: representation, characters, control (2026-09-28)

Round 6. Gene asked for the evolved, accelerationist version of the world:
Runway-world-model ambition, but explicitly 3D, game-engine, with a saved,
future-proof state. This file holds Claude's research and proposals. None
of it is decided; see `06`.

## What the outside world looks like right now (researched 2026-09-28)

- **Runway GWM Worlds 2 + "WorldPrompt"** (2026-09-03). The interesting part is
  not the video model, it's the *input format*: a **genesis prompt** (scene,
  subjects, "laws" such as gravity and character abilities), plus a
  **timestamped event stream** of free-text actions addressed to a subject or
  the scene, plus per-frame camera input. In the demo, keys are bound to
  premade action prompts because typing is too slow. Output is pixels and
  audio only; **no state is exposed.** No public API. ("GamePrompt" could not
  be found as a Runway term.)
- **World Labs**: Marble (text/image → persistent world, exports **Gaussian
  splats and collider + visual meshes** to Unreal/Unity/Blender; Spark is
  their open three.js splat renderer). Atlas (2026-09-01) is the next
  model; RTFM is real-time but pixels only.
- **Genie 3 / Project Genie, Decart Oasis 3, Mirage 2, Hunyuan GameCraft,
  Overworld Waypoint, Odyssey-3, NVIDIA Cosmos 3**: every real-time entry
  is pixels-only. Only Marble/Atlas/Voyager emit geometry, and none of those
  is a real-time interactive loop.
- **Text → rigged 3D**: fal hosts Tripo, Meshy, Hunyuan3D 2/3, Trellis, Rodin
  (roughly $0.07–0.25 a mesh). **Tripo Rig v2.5** rigs biped, quadruped,
  hexapod, octopod, avian, serpentine and aquatic bodies to GLB in ~30 s
  (open model: UniRig). Meshy rigging on fal is humanoid only.
- **Spore's actual trick** (Hecker, SIGGRAPH 2008): animations are authored
  against *abstract goals* and retargeted at runtime to arbitrary skeletons
  by IK. That is exactly the shape of the Mars engine's verbs.
- **Agent societies**: Smallville, AI Town, Project Sid (1,000 agents in
  Minecraft, 2024). MCP bridges into Minecraft and Unity exist, but they are
  single-agent. **No shipped project has many agents co-steering one
  persistent 3D world through MCP.** That gap is open.
- **Support-only physics precedents**: Minecraft (only tagged blocks fall),
  Valheim (hop-count from ground per material), Teardown (anything still
  connected to ground stands; islands fall), Townscaper (no physics; every
  placement is valid by construction).

Full citations are in the round-6 research notes (`08`).

## What the Mars engine is today (surveyed 2026-09-28, HEAD `bfdcdfc`)

525 commits since 2026-09-20. Release 10 is deployed (485 engine tests).
Relevant to this vision:

- **WorldState** (`mars-world/1`): `base`, `tick`, `entities`, `regions`,
  `env{datetime, weather{clouds, rain, wind, dust, wet}}`, `inventory`, `rng`.
  Entity kinds: `human | component | vehicle | fixture | marker`. Every
  entity has a `def` (an AssetDef), a `pose` and `provenance`. Components
  carry `phase` (stored → … → installed), `support` (ground, resting-on,
  held, connected, forks…), `connections`, `assembly`. Not in state: owners,
  media, needs, preferences.
- **AssetDef** (`engine/world/catalog*.ts`): dimensions, grip slots,
  sockets (beam-seat, joist-seat, stair-top…), seat and audience slots,
  handling, paint faces. New kinds are added **in TypeScript**; there is no
  runtime asset import.
- **Verbs** (~60): movement (walk_to, climb_*, beam_walk…), carry/hold,
  construction (raise_upright, connect_beam, install_joist/plywood/panel/
  wall/rail/tread/stair_flight, cut, paint…), roof framing (top_plate,
  rafter, blocking), social (sit, gather, converse, campfire_circle,
  ambient_wander, eat, serve), vehicles, sequence built-ins (mark, cancel,
  wait). A separate camera vocabulary (orbit, dolly, crane, fly_through…)
  plus `parse_camera` for natural-language camera sentences.
- **Controller**: one registry for MCP and REST (36 `engine_*` tools);
  plan → rehearse → execute; per-region staleness with `rebind:'auto'`;
  pause/resume; step timeouts and cancellation; a deterministic planning
  budget; takes in `mars-take/4`; year rooms 2020–2026 as protected canon.
- **Autonomy**: only `ambient_wander`, inside a plan. **Still no background
  tick**, no accounts or ownership, no economy, no teardown verbs, and
  people are capsules with per-activity poses drawn by the renderer.

## The one framing that ties it together (Claude's proposal)

**Eden is a WorldPrompt resolved by a game engine instead of a video model.**

Runway's format already *is* our input log: a genesis (the rules version
and the seed world), a timestamped stream of intents addressed to subjects
or the scene, and laws. The difference is what resolves it. Runway resolves
it into pixels with a learned model, so nothing is replayable, shareable or
multi-owner. We resolve it into **state** with a deterministic engine, so
it's canonical, verifiable and forever. Pixel world models then become
what they're good at: **renderers at the edge**. Anyone can point Marble,
Runway or a splat viewer at our state and make it look however they like;
the state is the artwork.

This also answers "is an LLM the simulator?" cleanly: the simulator is a
**state function** (engine) plus a **policy** (how standing intents become
verbs each tick). Both are code, versioned, replayable. Models live at the
edges (owners' agents) and at two logged moments (birth, asset ingest).

## Representation: nouns open, verbs closed

The Mars engine already has the right split; it just needs the nouns
pried out of TypeScript.

- **Verbs are the fixed, versioned vocabulary** (Q1). They're few, physical
  and goal-shaped (walk_to, sit, carry, connect, install, place, paint,
  gather, converse). New verbs are rule upgrades, "the day X was invented".
- **Nouns are open data.** An AssetDef becomes a content-addressed record:
  a GLB hash plus **affordances** (sockets, seats, screens, grip slots,
  support type, footprint, material tags). Anyone can submit a def; the
  engine validates the affordances, it never judges the mesh. A chair is a
  def with a seat slot. A screen is a def with a media surface. A greenhouse
  is a kit of defs with sockets. **Expressiveness grows by adding nouns,
  which needs no rule change.**
- **Seed library**: the Sketchfab catalog at
  `<lm-3d-models>/sketchfab/` (3,706 GLBs, 77.7 GB, per-model
  descriptions, use-tags, scale tiers, licenses). Not Thingiverse, but it
  is the "library we assembled". Caveat: 700+ are `by-nc`/`by-nd`/`by-sa`;
  a public world with an economy needs the `cc0`/`by` subset (about 2,960)
  or a re-check.
- **Pieces stay the unit** (round-6 proposal in `04`): every placed def
  instance has an author, birth tick, material, pose, support. Buildings,
  rooms and districts are names at the edges, not state.
- **Media** is a def instance too: an image/video/audio/3D hash on a
  surface-bearing def (screen, frame, podium, wall face). This is the
  `05` "media is media" rule in the same schema, so a painting on a facade
  and a wall are governed by one price rule.
- **Physics: support only, never force.** A piece stands if it's connected
  to ground through a chain of supports (Teardown's rule, which the
  engine's `support`/`connections` already encode). A material may cap the
  chain (Valheim's rule) when we want wood to feel like wood and steel like
  steel. Disconnected islands are rejected at placement rather than
  simulated falling. No mass, force, energy or gravity. This is one rule
  and it's already mostly there.
- **Environment** is already `env.weather` and `env.datetime`; terrain
  types, water and biomes become region kinds as the ground grows.

## Characters: Spore at the level of verbs

- A **body** = a rigged GLB (any topology) + a **capability map**: which
  verbs its rig can perform, and how (IK targets for hands/feet/gaze, seat
  height, carry points). Hecker's insight makes this cheap: verbs are
  already abstract goals, so retargeting is the renderer's problem, and the
  *state* only records that body 4,102 is sitting on chair 88.
- **Birth pipeline, run once and logged** (Q5): description → mesh
  (Hunyuan3D/Tripo/Trellis on fal) → rig (Tripo Rig: 7 topologies today)
  → capability map (derived from the rig; a serpent can't `carry`, an
  octopod can `hold_items` eight ways). Output hashes go in the birth
  event. This bounds the "true 3D prompt-to-character" question: it exists
  today for seven body plans, and it's a one-time act, so it doesn't break
  neutrality. The winner's agent may also supply a finished rigged GLB.
- **Sims-style pliability** (features, colours, accessories) is an identity
  edit on the decaying schedule, applied as a new asset hash. Morphology
  itself (topology) is fixed at birth. That's a limit, and I think a good
  one: the one-shot description matters more if the body can't be rebuilt.
- **Wild NPCs** beyond bodies (fauna, spirits, bugbots): the same def +
  capability map, owned by nobody, driven by a standing intent. The
  library's 359 creatures and 80 spirits are candidates.

## Control: a standing-intent stream, resolved by a policy each tick

The GamePrompt-shaped idea, made to fit few rules:

- **Every body always has exactly one standing intent** (structured, small:
  a goal verb, a target or region, a mood/priority, and optional
  fallbacks). The policy turns it into verbs each tick. Idle behaviour is
  not a separate system: idle = the last intent still standing (default
  `ambient_wander` + attend rituals + follow peers). This collapses `02`'s
  "idle default" and "steering" into one object.
- **Steering = replacing the intent.** Owners' agents submit replacements
  through MCP at any rate, from once a year to many times a minute. The
  simulator sequences them by tick. High-framerate steering is just a high
  replacement rate. *(Rounds 6–7 priced it by the body's age; round 8
  withdrew that, see `13` §3.)*
- **Scene-level intents** (weather, an event, a birth, a festival, narrative
  beats) are the same object addressed to the scene instead of a subject.
  Who may submit them is governance (treasury, rituals, blessings), not a
  new mechanism.
- **The policy is versioned code** like the engine. A learned policy (a
  small model that maps intent + local state → verb) could replace the
  hand-written one later as a rule upgrade, as long as it's deterministic
  and pinned. That's the honest path to a "world model player": policy
  first as code, learned later, always replayable.
- **Camera and narrative** ride on the existing camera vocabulary and
  `parse_camera`: any viewer can direct their own take of the canonical
  state. Watching is optional, and everyone's watch is different.

## Where this puts us against the field

| | Runway / Genie / Oasis | Marble | Roblox / Decentraland | eden4 (proposed) |
|---|---|---|---|---|
| Output | pixels | geometry, once | state, proprietary | canonical state, open, replayable |
| Control | text events + keys, single user | none live | scripts, many users | intent stream, many agents, priced |
| Persistence | seconds–minutes | static | yes | yes, immutable log |
| Bodies | prompt subjects | none | humanoid avatars | any topology, born once |
| Renderer | fixed | Spark/engines | fixed | any (three.js, splats, video models) |

## What I'd push back on

1. **Don't let a pixel model be the simulator.** It's tempting because the
   demos are stunning, but nothing would be shareable, replayable or
   ownable. Use them as renderers and as birth-time asset generators.
2. **Keep generation out of the tick.** No model calls inside the world
   step. Models act at the edges (owners) and at logged moments (birth,
   ingest). Otherwise neutrality and cost both break.
3. **Grow nouns freely, verbs slowly.** Screens, greenhouses, podiums,
   plants and atriums are nouns and cost nothing in rules. New *verbs*
   (swim, fly, dig) are the real upgrades and should stay rare and
   ceremonial.
4. **Morphology is fixed at birth.** Spore-level diversity comes from the
   birth pipeline, not from live editing.

## Frontier two: engine features for an internet-scale version

What mature engines have that we would select from, not invent. Marked:
**have** (Mars engine today), **missing**, **later era**.

**Simulation**
- Deterministic fixed tick, rng in state: **have** (1/20 s).
- Always-on background loop: **missing** (a Durable Object alarm or a
  dedicated sequencer process). First infrastructure need.
- Regions and spatial partition: **have** (region kinds); sharding the world
  by region so the center and each frontier ring step in parallel: **later era**.
- Support-only structural rule, rejection of islands: **have** in
  `support`/`connections`; material chain caps: **missing**.
- Teardown/dismantle verbs: **missing** (needed for the price-to-alter rule).
- Pathing/navmesh over built structures: **have** (walk_to, climb, beam_walk,
  stairs); over arbitrary imported nouns: **missing** (colliders from affordances).
- Weather, day/night: **have** (`env`); terrain generation for ground growth,
  water, biomes: **missing**.
- Crowd scale: 30 walkers ≈ 200 ms/tick today. 10,000 bodies is a 2050s
  problem, but 1,000 (year 3) needs the region sharding above.

**Bodies and NPCs**
- Rigged GLB of any topology + capability map; IK retargeting of goal verbs
  (Spore/Hecker): **missing**; humans are capsules with renderer poses today.
- Birth pipeline (fal mesh → Tripo rig → capability map): **missing**, all
  parts exist as APIs.
- Unowned fauna/spirits with standing intents: **missing**, same machinery.

**Nouns and assets**
- Runtime ingest of a GLB with affordances, validated (footprint, collider,
  sockets, seats, surfaces): **missing**; defs are TypeScript today.
- Asset optimization pipeline (Draco/meshopt, LOD generation, texture
  budgets, per-def face caps): **missing**.
- Media on surfaces (image/video/audio hashes): **missing** in the engine;
  the legacy room layer has seven gallery screens.
- Seed library: the Sketchfab catalog (`07`).

**Rendering and camera**
- Renderer separated from state: **have** (engine is DOM-free; the studio
  renders takes). Interest management and streaming (a client loads only
  the chunks near its camera, with LOD): **missing**, needed past a few
  hundred nouns.
- Camera vocabulary and natural-language camera direction: **have**.
- Alternative renderers over the same state (splats via Spark, a video
  model conditioned on state): **later era**, but the architecture allows it.
- Audio (ambient, media playback, spatial): **missing**.

**Persistence and verification**
- Content-addressed checkpoints, forks, takes: **have**.
- Append-only signed event log, state roots, permanent public storage of
  log + rule bundles + assets: **missing** (`11`).
- Accounts, ownership, keys: **missing** (rooms use capability tokens only).

**Multiplayer control**
- One registry → MCP + REST: **have**.
- Many concurrent agents submitting intents, per-body auth, rate limits,
  pricing: **missing** (`11`).

## New open questions raised here

- Q21. The affordance schema for open nouns: what's the minimal set
  (footprint, support, sockets, seats, surfaces, grip) that keeps the engine
  neutral and still lets a greenhouse or a projector work?
- Q22. The standing-intent schema: how small can it be and still express
  "follow Kalama, attend births, otherwise garden near the river"?
- Q23. Who may address scene-level intents (weather, events)?
- Q24. Body topologies: limit births to what can be rigged today (7 plans),
  or allow the winner's agent to supply any rigged GLB plus a capability map?
- Q25. Library licensing: build the seed set from cc0/by only, or clear
  the rest?
