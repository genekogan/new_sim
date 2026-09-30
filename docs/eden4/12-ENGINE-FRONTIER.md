# 12 — Engine frontier (frontier two)

Round 7, 2026-09-29. Claude's research into what mature engines and 2025–26
work make possible for a browser-first, server-canonical world. A menu, not a
plan. Marks: **have** (Mars engine today), **missing**, **later**. The HTML
report (`report/eden4.html`) has the same chapter with links context.

Gene's second frontier: the actual engine, "simulation, camera, rendering, NPCs, modeling, assets, physics, and other advanced features that are in mature versions of this and can work on the internet." What follows is what mature engines and 2025–26 research make possible in a browser-first, server-canonical world, grouped by his list. Each item says what it would give eden4. Marks: **have** means the Mars engine already does it, **missing** means it is needed and absent, **later** means a later era. Items marked [U] rest on a single unverified source.

## Simulation

- **Always-on world step.** **missing** A Durable Object alarm or a dedicated sequencer process running the fold continuously. Cloudflare's limits as of June 2026 (10 GB SQLite per object, thousands of hibernating WebSockets, unlimited objects) suit one object per region shard plus one for the log. Shard on space, never on session.
- **Deterministic lockstep, proven at scale.** Factorio runs the whole simulation on every client and syncs inputs only; Age of Empires II DE pins strict floating point. WebAssembly's IEEE-754 is strictly deterministic; TypeScript number math is too if the engine avoids transcendental `Math.*` drift (fixed-point or its own libm). **have** in spirit: the Mars engine is byte-identical across Node and workerd.
- **Mass entities.** Unreal's MassEntity plus StateTree plus Smart Objects (5.5–5.8) run thousands of background agents as integers with LOD'd representation and reservation-based activities. This is the blueprint for ten thousand bodies where a handful are actively steered. The Mars engine's regions and `reservedBy` fields are the seed; crowd scale (30 walkers ≈ 200 ms) is **missing**.
- **Time dilation.** EVE Online slows the simulation clock under load rather than dropping inputs. A world that advances in seconds and minutes can borrow this for free: the tick rate is a rule, not a promise.
- **A storyteller.** RimWorld's AI Storyteller, descended from Left 4 Dead's director, paces events per day. In our terms it is a governance-keyed scene-intent author. The birth ritual already is one such beat.

## Camera and cinematography

- **Virtual cameras with priority blends.** Unity Cinemachine 3.1's Follow, FreeLook, spline dolly and obstacle avoidance model is portable to three.js. **have** a camera vocabulary (orbit, dolly, crane, fly_through) and natural-language camera sentences via `parse_camera`.
- **An AI director of photography.** GenDoP (ICCV 2025) and PACE (2026-09) emit typed shot specs from scene semantics. An edge agent can be the DoP: it writes shot specs, the engine executes them deterministically, so every viewer can watch their own cut of the same canonical day.
- **Replays as state, not video.** Rocket League's replays are input scripts with an AI-chosen director camera. A replayable log makes a free television channel of the world: the daily birth as a broadcast, any past day re-shot from any angle. **have** takes and the "watch it being built" player.

## Rendering

- **three.js WebGPURenderer with TSL is the default path.** r186 (2026-09-08) adds cascaded sun shadows and async compute; WebGPU is universal since Safari 26. One TypeScript codebase, compute shaders for culling and crowds, WebGL2 fallback only for low-end devices. **have** three.js; **missing** WebGPU.
- **GPU-driven instancing and impostors.** A 2026 three.js demo places roughly 190,000 trees and 450,000 understory instances by GPU scatter, culls per frame into indirect draws, and bakes octahedral impostors for the far field (two triangles per instance). This is how millions of user-ingested nouns stay visible at the horizon. Bake the impostor atlas at ingest.
- **Virtualized geometry.** A Nanite-style port exists on WebGPU (meshlet hierarchy, software rasterizer, per-meshlet culling) but is heavy; the production path is a meshopt LOD ladder plus impostors. Claims of "Nanite 3.0 for WebGPU" [U].
- **Dynamic global illumination.** Radiance Cascades run on WebGPU compute; Split Radiance Cascades (2026-07) give 3D diffuse bounce from sparse world-space probes. A world that changes every day cannot bake light; this gives time-of-day bounce without baking. MegaLights (UE 5.8) shows stochastic many-light sampling is the target for a city of lamps.
- **Gaussian splats next to meshes.** Spark 2.0 (World Labs, 2026-04) streams continuous-LOD splat trees with a 16M-splat GPU paging pool in the same three.js scene as meshes. PlayCanvas SuperSplat 3.0 (2026-06) streams up to 24M Gaussians on compute. Photogrammetry and Marble-generated worlds become ground and backdrop under rigged GLB bodies.
- **Asset pipeline at ingest.** gltfpack with meshopt, KTX2/Basis textures (ETC1S for colour, UASTC for normals), a LOD chain via meshoptimizer, per-def face and texture budgets. **missing**. Decentraland's publish-then-LOD pipeline is the model.

## NPCs, characters, animation

- **Motion matching per rig class.** Stock in Unreal since 5.3, productized by Motorica. Ship a motion database per body plan and get locomotion quality without hand-authored blend trees. **missing**; people are capsules with renderer poses.
- **Motion for arbitrary topologies.** AnyTop (any-topology diffusion, 2025), Motion2Motion cross-topology transfer (2025-08), MotionBricks real-time modular latent motions (2026-04), STyMo few-shot style transfer (2026-09). This is what makes "a rigged GLB of any topology" walk, sit and carry. Generate clips at birth, store them with the body.
- **Physics-based control** (score-matching priors, whole-body tracking, 2025) is not browser-feasible yet. **later**, server-side or precomputed.
- **Faces.** TalkingHead.js drives ARKit visemes on Mixamo rigs in the browser; Audio2Face outputs 52 ARKit blendshapes. Bodies that carry ARKit shapes can speak with faces.
- **Behaviour: StateTree and Smart Objects.** Nouns advertise affordances as claimable objects (a bench offers `sit`, a kiln offers `gather`), which maps one-to-one onto the affordance schema in chapter 6 and onto MCP tools. GOAP or utility planners are the cheap deterministic layer under the intent: the edge sets the goal, the planner executes. This is the policy of chapter 4, and it is what shipping LLM-NPC games (inZOI, Where Winds Meet, Convai) converged on: the model for intent and dialogue, schedules for everything else.
- **Schedules, proven.** Smallville's daily-to-hourly-to-minute schedules with memory and reflection, and Project Sid's thousand agents in Minecraft with emergent roles and norms. Tick-indexed schedules keep this deterministic.
- **Need-driven fauna.** Rain World's creatures pursue their own survival; RimWorld keeps its ecology "observable and comprehensible." Unowned creatures with standing intents give a living world at no model cost.

## Modeling and assets

- **Generated nouns with behaviour schemas.** Roblox Cube (open source, 2025-03) then its 4D generation beta (2026-02): text to functional objects with behaviour schemas, 160,000 player-generated objects in one experience, an open-vocabulary schema system, and CubePart (2026-05) for part-controllable generation. This is the closest existing thing to "a noun with affordances" generated in one prompt.
- **Rigged bodies on demand.** Meshy auto-rigs humanoid and quadruped with 600+ preset clips; Tripo Rig covers seven body plans; Hunyuan3D is open but static. See chapter 9.
- **Procedural layout.** Wave Function Collapse and model synthesis remain the standard for tiled districts (Townscaper, Bad North, Caves of Qud); a 2025 WFC plus genetic-algorithm hybrid reports 73% fewer unplayable layouts. Deterministic and seedable inside the engine, useful for frontier terrain and starter streets.
- **Procedural terrain on the GPU.** Height, biome and erosion generators exist for three.js at planet scale. The expanding ground can be generated per day from the day's seed. **missing**.
- **Editor-side generation is mainstream.** Unity AI (open beta 2026-05) and Unreal 5.8 ship LLM and MCP editor workflows. Validates MCP as the editing surface. **have**.

## Physics

- **Support graphs, not rigid bodies.** Valheim: a foundation touching ground is 100% supported, decaying per hop, colour-coded. Teardown: anything still connected to ground stands. Graph propagation, cheap and deterministic. **have** most of it in `support`/`connections`; material chain caps **missing**.
- **Deterministic rigid bodies when needed.** Rapier (WASM, cross-platform determinism flag, 2025 voxel colliders and persistent islands, SIMD builds 2–5× faster, GPU rigid bodies on the 2026 roadmap). Box2D 3.1 is deterministic across platforms; Box3D was announced 2026-06-30, alpha, no WASM yet. Jolt in WASM has soft bodies, cloth and vehicles for client-only cosmetics. **later**, and only server-side canonical.

## Audio

- **Spatial audio.** Web Audio's HRTF panner is still the only native spatializer; Resonance is dormant. Adequate for ambience; an ambisonic AudioWorklet if VR matters.
- **A daily-born score.** Suno v5.5 (2026-03, continuation and personas), Stable Audio 3, ElevenLabs Music, and Magenta RealTime for adaptive scores. Precompute stems per biome and time of day, crossfade by region. A world born one body a day can have music born one day at a time, generated at the edges and ingested like any media.
- **Media playback on surfaces** (screens, projectors, speakers as nouns) is **missing** in the engine; the legacy room layer has seven gallery screens.

## Environment, weather, time

- **Volumetric sky on three.js WebGPU.** Eanpa-Sky (weather fronts, lightning, day/night), Three.js Sky Pro (scattering, clouds, god rays, cloud shadows), three-clouds (Beer shadow maps). Server-canonical `env.weather` **have** drives client volumetrics; cloud shadows tie the sky to the simulation.
- **Seasons and foliage states.** Unreal 5.8's vegetation authoring is the reference for season-driven foliage. A lunar-calendar birth ritual suggests a lunar season system for free.

## Multiplayer and networking

- **Transport.** WebTransport is in every browser since Safari 26.4 (2026-03). Unreliable datagrams for presence, WebSockets for canonical events. Colyseus 0.18 (2026-08) adds server-authoritative prediction and rollback if human-driven bodies ever need it.
- **Interest management and sharding.** The ACM survey remains the reference; Hadean's Aether Engine partitioned space for 10,412 participants (EVE Aether Wars, 2019); SpatialOS shipped Worlds Adrift and then collapsed in the 2019 Unity dispute. The lesson across all of them: cross-shard entity handoff is the hard part. Keep shard boundaries static and coarse (center, rings), hand off by deterministic tick. **later**, needed around a thousand bodies.
- **Streaming.** Clients load only chunks near their camera with LOD. **missing**, needed past a few hundred nouns.

## Persistence and creator economies

- **What retention actually is.** Fortnite's UEFN paid creators $1B by 2026-06 and 47% of playtime is in creator islands; Roblox paid over $1B in 2025 and moved to Creator Rewards. In-world items and creator share are the retention lever. Manna UBI plus a creator share of buyouts (chapter 7) is the same shape.
- **Onchain worlds.** Lattice's Redstone chain shut down 2026-05-15; MUD and Dojo continue. The lesson for us: keep the chain for ownership and verification, run the simulation off-chain, publish roots for replay-verifiability. This is exactly the rollup posture of chapter 3.
- **Decentraland SDK 7.29** (2026-09-15) with a Unity Explorer client, Worlds without the Genesis vertical limit, background LOD generation on publish. A peer, and a pipeline to copy.

## What I would take from this list first

- The always-on step and the signed log, because nothing else is real without them.
- The ingest pipeline (gltfpack, KTX2, LOD chain, affordance validation, impostor bake), because nouns-open depends on it.
- Motion databases per body plan plus any-topology motion transfer, because bodies are the product.
- Smart-object affordances as the bridge between nouns and the policy.
- Everything under rendering can wait until there is something to look at; three.js WebGPU makes most of it a later upgrade rather than a rewrite.

*Unverified: "Nanite 3.0 for WebGPU", Unity 7 shipping WebGPU by default, and Cloudflare's "10 dynamic workers per Durable Object."
