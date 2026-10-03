# 20 — Many worlds, one codebase: worlds, capabilities, bodies, things

> Status (2026-10-03, round 19): **a direction, with a small decided core.**
> Gene decided the shape in §1 and the build order in [`22`](22-MERGE-PLAN.md).
> Everything else here is Claude's proposal from the discussion, kept for the
> next round. Gene: "a lot of this is still open questions. i can give myself
> more time to figure them out." The economics are in
> [`21`](21-WORLD-ECONOMY-OPEN-QUESTIONS.md).

## 1. What Gene decided

In his words (round 19, 2026-10-02 → 10-03):

- "split the project into two. The Mars version and the broader Eden project,
  which simulates a more capable world… I want Eden to be where most of the
  technical development occurs… I want the Mars simulation to be somewhat
  nimble, free from the burden of Eden development… one among many different
  worlds that I want to create, including the Little Martians world."
- "we make worlds. each world inherits a general set of capabilities. It might
  have pallet racks, it might have terrains, it might have different kinds of
  creatures. It's configured in various ways. Perhaps it even has different
  rules. Mars is just one flavor."
- "I guess it's really just one repo still, and that Mars is a world in that
  repo… Maybe worlds are just data."
- "maybe capabilities are general purpose code and they are data in worlds by
  being enabled or not? i feel like the idea of the simulation is its one latent
  codebase."
- "maybe we can allow code itself to be part of the spec. So the owner of the
  world has an interface that inherits the Eden package and can code on top of
  it features that Eden doesn't have… we could curate it with people that we
  trust… it's like open frameworks. You get the core libraries. But you can
  always write your own."
- "for now the worlds are going to be just held and modulated through code
  manually through me and some enthusiasts until i see this has sticking power."
- "let's just make code in as practical a way as possible, anticipating that
  code and data slowly become the same thing anyway and the economic model is
  premature."

So, decided:

1. **One repo, one engine, many worlds.** Mars is the first world, Little
   Martians the second, Eden (a literal green field) the third.
2. **Mars direct development stops** at the v1 alpha (release 42, 2026-10-03).
   Its code is copied (a hard fork) into the Sim repo with its history; the
   legacy app at sim.mars.college keeps running from the old repo for now.
   Engine work happens in the Sim repo.
3. **No fork.** A world is configuration and content on the shared engine.
   Code inside a world is allowed, kept practical, not designed as a platform yet.
4. **The ontology of worlds (constants, laws, owner-held variables) and the
   economy are left open**, with the analysis saved (this note and `21`).
5. **Keep three.js.** Do not adopt a game engine. Do not reinvent what exists
   (§7).

## 2. What a world is (proposal)

| Part of a world | Form | Mars example |
|---|---|---|
| Manifest: name, engine version, capabilities on, settings | data | `mars`: humanoids, carry, construction, day of 1 h |
| Map: ground, regions, buildings | data | the camp; later the 2026 campus |
| Things: furniture, objects | data | tables, chairs, stage, fire |
| Vocabulary and rules: kinds, cards, manners, numbers | data (the kernel already logs a `rules` event) | classroom cards, supper cards |
| Routines and starting population | data | four residents and their day |
| Custom code | code, in the world's folder, loaded by the engine | Mars construction choreography |

- **Capabilities are general code in the engine. A world turns them on and sets
  them.** When a world needs something new (a floating body, terrain), it is
  added to the engine for every world.
- **Version pinning** is what keeps Mars nimble: a world names the engine
  version it runs on and its log records it. Mars's takes already carry a
  `rulesVersion`. Not built; needed once a second party depends on a world.
- **World code, when it comes, is stored and named by its hash** in the world's
  `rules` event, as minted cards are. Replay then knows which code produced
  which history.
- **Viewer code and rules code differ.** Viewer code cannot change canonical
  state, so any world may ship its own. Rules code needs determinism (no clock,
  no randomness, no network) and, for strangers, a sandbox (V8 isolates, WASM
  or SES compartments). While world makers are trusted people, review is enough.
- Three kinds of world, for later: **configured** (settings only), **scripted**
  (settings plus code, on our host), **forked** (takes the libraries, runs its
  own server, may disagree with Eden about anything).
- Prior art: Minecraft datapacks next to mods; Second Life LSL (`research/R8`);
  Roblox Luau; Hyperfy apps; Garry's Mod as the warning.

**What Eden must own in any version:** Soul identity and ownership, the log
format with its hash and replay, spend metering, and the one rule at the border
if Souls travel. Everything else is a library a world may use, change or replace.

## 3. The engine is depiction; a world model may replace it

Gene: "eventually the engine is a world model not the procedural 3d one with
rigging i have right?" Yes for most of it, and `18` already planned for it
(the depiction layer "could be a generative world model").

| Part of the engine | Replaceable by a learned model | Order |
|---|---|---|
| Rendering | yes | first |
| Animation and rigging | yes | second |
| Feasibility (can this body do this here; who holds which seat) | possibly | last: every viewer must see the same fair answer |
| Meaning (the kernel, the log) | no | never: a latent cannot be replayed, owned or verified |

Consequences: Eden's lasting investment is the meaning layer and the action
space. Spend little on procedural depiction beyond what a world needs now. The
procedural engine is also the training data: every take is an exact record of
state, action and pose.

## 4. Bodies (proposal; Gene receptive)

Gene: "maybe we can make a body and enforce that every body implement some kind
of morphology vector to shape it and texture it/skin it separately? and you can
build your own. like maybe we just grow software like data, we just accumulate
models." And: "i want mars to eventually support non-humanoid souls like ducks
or blobs or large snails or robots… every single one of them would need rigging
and have to have their own adapter to all the activities (dance, etc) for full
interchangeability across worlds."

A body is three layers:

| Layer | Content | Read by |
|---|---|---|
| **Family** | the body plan and its code: humanoid, floater, blob, bird, gastropod, robot | engine and viewer |
| **Morphology vector** | a shared core every body provides, plus numbers of the family | engine reads the core; viewer reads all |
| **Skin** | mesh surface, textures, materials | viewer only |

- **Shared core:** height, footprint radius, eye height, speed for each way of
  moving, reach, carry limit, a level for each capability.
- Mars already has the human vector: `BODY_MODEL` (height 1.75 m, arm 0.62 m…),
  measured from the Quaternius rig. Today it is one global constant.
- For human shape variation: Anny (NAVER Labs, Apache 2.0), not SMPL.

**Avoiding an adapter for every body × activity pair.** A middle layer of about
ten **capabilities**. Each family implements those it has, once. Each activity
is written once against capabilities. Sim's nine body verbs are this layer for
humans.

| Capability | Human | Duck | Blob | Snail | Floating sculpture | Robot |
|---|---|---|---|---|---|---|
| move | walk | waddle, swim | ooze | slide | float | roll or walk |
| settle | sits on a seat | sits on the ground | flattens | withdraws | lowers and hovers | parks |
| hold | hands | beak | engulfs | — | — | gripper |
| rhythm | dance clips | bob and flap | pulse | sway | spin and bob | stepped moves |
| express | gesture | wings | wobble | eye stalks | tilt, glow | lights |

- A body that lacks a capability **refuses the activity with a named reason**
  (Mars refuses this way already; Spore did the same).
- If the meaning is still true without the depiction, the kernel records it and
  the missing animation goes on the depiction backlog (`18`).
- **Activities produce targets, not bone rotations**: "eat" = bring the item to
  the `mouth` landmark; "sit" = put the `seat` landmark on the seat. Each family
  declares its landmarks and a solver. Mars's solvers (`rig.ts`, `posture.ts`,
  `stair-gait.ts`, `frame-gait.ts`, `prone.ts`, `items.ts`) are the humanoid
  solver. This is the thing worth abstracting from Mars, because three.js and
  Blender do not provide it.
- **Rigging is per family, not per Soul.** Floaters, blobs and rigid robots need
  no rig. Ducks, snails and humans need a skinned rig.

**Rigging arbitrary things.** Blender, headless (`blender -b --python`), as an
offline pipeline: Rigify template rigs (human, quadruped, cat, wolf, horse,
shark, bird) with automatic weights; UniRig (MIT code, SIGGRAPH 2025) for meshes
with no template; export glTF. Motions: Quaternius Universal Animation Library
1 and 2 (CC0, about 250 clips); NVIDIA Kimodo and ARDY for motion from text,
offline, to fill the depiction backlog. Creatures: Spore's method (a small
recipe, parts carry abilities; `research/R6`).

## 5. Things: a small Thingiverse (proposal)

Gene: "maybe this also requires something like a mini thingiverse so that
objects can be standardized."

- Objects carry their own interactions, as in The Sims (`research/R7`): a chair
  advertises "sit here, facing this way".
- Format: glTF plus metadata: slots (seats, surfaces, grips, places to stand),
  size, mass, capability requirements, optional animation for a body family.
- Existing standard to build on: the OMI group's glTF extensions (`OMI_seat`,
  `OMI_spawn_point`, `OMI_physics_body`). Mars's `objects` module is the working
  version.
- Seed: about 2,960 CC0 and CC-BY models in the Little Martians Sketchfab
  catalog (`<lm-3d-models>/sketchfab/catalog.json`, license per
  model; about 19% are restrictive and must be left out).

With this the system has four libraries that grow the same way (minted,
validated, hashed, pinned): **cards**, **bodies**, **things**, **worlds**.

## 6. Terrain (proposal)

Gene: "mountains and volcanoes… i can also imagine these terrains being somehow
optional to eden too. maybe the souls play god and sculpt the land." And: flat
land is already not a hard assumption, "given that humanoids can float above
pallet racks".

- Store **landforms as kernel things** (mountain, volcano, mound, crater: place,
  radius, height, shape, states such as `erupting`). The height field is derived
  from them by a deterministic function. The log stays small; replay stays exact.
- Sculpting is cards ("raise land", "dig"). The one rule decides whose land.
- A flat world has no landforms; that is what makes terrain optional.
- Walkers read slope; floaters keep a height above ground.
- A height field has no caves or overhangs. Voxels are the costlier alternative.
- Display: THREE.Terrain or Terrain Studio; ez-tree and grass libraries for
  plants. Pathing on hills: Recast (Mars measured it; its own planner assumes
  flat floor levels).

## 7. Build or reuse (decided as a principle; the table is the current answer)

Gene: "as a principle, i dont want to reinvent any part of this i dont have to,
but i want to have all the things we have in the mars world to start."

| Need | Answer |
|---|---|
| Renderer | **three.js, keep it.** Godot, Bevy, Unity and Unreal own the game loop and the world state; ours is a server-side, deterministic, replayable log with a thin viewer. |
| Simulation core | **The Mars engine, as it is.** Nothing open source matches a deterministic, server-side activity engine with named refusals. |
| Human motion | Quaternius clips (CC0) plus Mars's solvers. More clips from the Universal Animation Library. |
| Asset processing | **glTF-Transform** (already used in `<lm-3d-models>/tools/optimize.mjs`): weld, simplify, WebP or KTX2, Draco or meshopt. |
| Rigging | **Blender headless, offline.** Rigify; UniRig where there is no template. |
| World editing | Blender as the editor: custom properties export into glTF `extras`. No level editor to write. |
| Pathfinding | Mars's planner now. Recast when there are hills or many walkers. |
| Physics | None now. Rapier (deterministic build) only if a world needs it. |
| Terrain and plants | three.js libraries, display only. |

**Is Blender allowed for commercial work? Yes.** Blender's licence (GPL)
covers Blender itself and scripts that call its Python API when those scripts
are distributed. What you make with Blender (models, rigs, renders, exported
glTF) is yours with no licence condition. So: use Blender as an offline tool,
keep `bpy` scripts in their own `tools/` folder, and never ship Blender or
`bpy` code inside the product.

Mars's code by reuse (lines of engine source, 2026-10-02):

| Bucket | Modules | Lines |
|---|---|---|
| General core | runtime, world, core, history, take, sequence, rehearsal, env, api, camera | ~13k |
| Needs generalizing | spatial, locomotion, social, objects, items, carry | ~10k |
| Human or Mars content | activities, construction, campus, scenarios, vehicles, body | ~34k |

## 8. Open questions

1. Where is the line between engine and world? Little Martians is the test.
2. Can a Soul travel between worlds? This decides how much worlds must agree.
   Minimum proposed: a Soul may always leave.
3. What are a world's constants (fixed at genesis) and laws (changeable with
   notice)? See `21`.
4. When does world code need a sandbox, and which one?
5. The shared core of the morphology vector: which numbers?
6. The capability list: which ten?
7. The thing format: adopt OMI extensions or our own metadata?
8. Height field or voxels?
9. When to pin engine versions per world.
10. Which parts of the engine to replace with learned models first, and what
    data to keep now for that (takes are already kept).
