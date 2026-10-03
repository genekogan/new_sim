# Mars College 3D World

> Inherited native reference: source dates, release IDs and operating instructions
> retain their original scope. For the current Eden fork use [the index](README.md),
> [STATUS](../STATUS.md) and the Sim runbook; this file is not production authority.

## Research & Development Ideals, Architecture Targets, and Proof Obligations
*Implementation handoff for an autonomous coding agent*
> **Scope:** Historical reconstruction (2020–2026) + future-campus design + Mars-specific simulation/cinematic engine + agent-addressable controller + versioned/replayable world history.
## How to Use This Document
This is a north-star specification. It deliberately describes outcomes, invariants, and architecture boundaries more strongly than source-level mechanics. The implementation agent should turn it into a source-specific engineering plan only after auditing the live app and codebase.
- Treat “must” and “non-negotiable” statements as product requirements.
- Treat named libraries/frameworks as research/prototype candidates unless the document explicitly requires a behavior rather than a library.
- Preserve functioning existing capabilities unless a migration is justified and regression-tested.
- Where historical truth is uncertain, preserve uncertainty; do not invent certainty to simplify implementation.
- Every major claim of competence should be backed by an automated test, deterministic/state assertion, visual capture, or end-to-end demonstration.

## 1. Purpose of This Brief

This document defines the target ideals, architectural constraints, research directions, and proof obligations for the next major tranche of the Mars College browser-based 3D reconstruction and simulation system. It is intentionally not a source-level implementation plan. The implementation agent must inspect the real codebase, agent guide, live application, and available evidence; reconcile this brief with existing abstractions; and then produce and execute a concrete plan.

The implementation agent is expected to operate autonomously for an extended period. It should make reasonable engineering decisions without repeatedly asking for approval, while preserving the non-negotiable product and historical principles below. It must continuously validate its work through automated tests, deterministic checks where possible, visual evaluation, and end-to-end demonstrations rather than relying on manual user review after each feature.

## 2. Product Definition

The system is three things at once: (1) a historically grounded, high-precision record of Mars College campuses from 2020-2026; (2) an editable design playground for future Mars campuses using reusable construction components and assets; and (3) a Mars-specific simulation and cinematic directing engine capable of staging believable human activity, construction, social scenes, vehicles, environmental changes, and camera choreography.

These three purposes must share one coherent world model. Historical scenes should not be a separate visualization product, design mode should not be a detached editor, and simulation should not be a disposable animation layer. The long-term goal is a versioned, semantic Mars world in which known historical states, hypothetical designs, and performed sequences can all be represented without confusing one for another.

> **Core product idea:** Canonical historical Marses are published world states. Workspaces fork those states. Actions create transitions. Takes preserve what happened. Cameras are independently editable ways of witnessing those performances.

## 3. Existing System Context That Must Be Respected

The following is onboarding context supplied by the project owner. Verify source-level details before changing architecture, but do not casually discard these established capabilities.
- Frontend: TypeScript, React 19, Vite 8, Three.js.
- 2026 currently uses an existing modular GLB reconstruction with procedural additions. Historical scenes primarily use procedural Three.js geometry and a reusable component kit.
- Components already have IDs and concepts such as assembly membership, materials, and layers supporting selection, editing, cutaways, saved layouts, and GLB export.
- Shared Studio features include year navigation, orbit/plan cameras, WASD walking, arrow-key looking, jumping, component editing, reference photos, material/display modes, people, EUC riders, rider-follow cameras, weather, fires, screens, and optional time progression.
- Remote controls already exist for environment/time/weather, cameras, people/group movement, EUC behavior, activities, fires, and screens. Consult the live agent guide for exact APIs and authentication; do not infer them from this document.
- Local browsing state and persistent shared simulation-room state are distinct. Durable Objects hold shared room state. Historical years are isolated in the control plane.
- Cloudflare Workers serve the app and control/API code; Durable Objects coordinate shared room state; static assets carry compiled frontend and selected media; R2 stores larger models/downloads.
- Builds are local and deployed with Wrangler. Vercel is not involved. At onboarding time, the project has no Git repository or GitHub-driven deployment pipeline.
- The cloud coding session must not pretend to possess the private local source tree or private media archive. Request only the sanitized source/evidence needed for a task; never request credentials or an indiscriminate private-media dump.

## 4. Historical Reconstruction: Truth Before Plausibility

Historical accuracy is a product invariant. The application is intended to reconstruct what actually existed late in each Mars season, not what a pre-season plan suggested should exist. Archived SketchUp proposals are not as-built evidence and must never silently override photographic evidence or participant corrections.

The evidence hierarchy is: photographs and drone/video evidence first; participant corrections and recollections next; design documents as supporting context; explicit inference only where evidence is incomplete. Unknown or uncertain geometry must remain identifiable as provisional instead of being filled in merely to make the scene look complete.

Dimensional precision and epistemic certainty are separate. The system may represent a component to inch-level precision while remaining uncertain about whether that component occupied a particular historical location. The data model should be capable of preserving both kinds of information.
- Do not overwrite historical baselines when experimenting. Published historical states are protected checkpoints.
- Do not imply that a simulated reenactment is known history unless the construction sequence is actually documented.
- Keep reconstruction edits distinct from events that supposedly happened in-world. Moving a wall in the editor is not evidence that people moved that wall in 2024.
- Attach provenance/confidence metadata where practical, especially to inferred dimensions, hidden interiors, and reconstructed sequences.

## 5. Domain Vocabulary and Semantic World Model

The current geometry should evolve toward a semantic world model. A mesh is not enough. Important objects need identities, interaction affordances, support relationships, navigation implications, and simulation state.

Distinguish reusable asset definitions, placements in a specific reconstructed/design state, and mutable simulation instances during a run. This makes recurring objects such as named trailers persist across years while still allowing different placements and conditions in each year.

| Concept | Responsibility |
| --- | --- |
| Asset definition | Reusable description of a beam, upright/frame, plywood sheet, stair, couch, trailer, vehicle, character, solar component, etc. |
| World placement | Instance in a particular canonical or designed campus, including transform, assembly membership, material state, modifications, evidence/provenance, and labels. |
| Simulation instance/state | Transient operational state during a run: reserved by, held by, supported by, occupied, connected, moving, installed, blocked, etc. |
| Named region / semantic place | Queryable areas such as Chiba, staging zone, material pile, courtyard, behind a building, walkable zone, fire circle, classroom audience area. |
| Interaction affordance | Grip point, seat, work position, stair entry, connection socket, vehicle mount, projector surface, loading zone, etc. |

## 6. Construction and Material Vocabulary

The system is primarily built from a constrained, recurring Mars vocabulary: pallet-rack uprights/frames and beams, plywood, two-by-fours/timber, hand-built doors, plexiglass windows/walls, stairs, classroom furniture and equipment, screens/projections, solar infrastructure, trailers/RVs, campers, cars, tents, people, bicycles, EUCs, and other recurring camp assets.

The implementation agent should verify the actual semantics of existing component names. In particular, confirm whether the current project uses “upright” to mean an individual vertical post or a complete rack side-frame, because handling rules differ dramatically.

Reusable structural assets should gradually acquire connection sockets, grip/handling positions, clearance envelopes, support requirements, and construction roles. These need not imply structural-engineering certification; they exist to make staging and animation believable.

## 7. The First Gold-Standard Scenario

The first major end-to-end scenario is a believable Mars build sequence. Multiple humans begin near piles of rack components, plywood, and timber. Teams of roughly 2-4 people collect components, carry them to a staging area, and assemble a structure in a sequence resembling documented Mars construction.

A tall rack frame/upright must be raised from the ground with credible support. Humans continue holding it until the relevant stabilizing connections are installed. Additional frames and beams extend the structure. A skeleton of two-by-fours/timber is installed as support for upper plywood floors before plywood is placed. Stairs are built progressively and become traversable only when their relevant pieces and landings exist. A forklift may be used to lift plywood or other loads to upper levels when appropriate.

The goal is not an engineering-grade rigid-body simulation. The goal is physical believability: no humans or carried materials pass through walls; crews do not perform impossible maneuvers; a six-foot human cannot casually carry a nineteen-foot frame in an absurd orientation alone; loads remain supported during rotations; the world does not activate invisible floors or stairs before they physically exist.

> **Primary acceptance test:** Can the system explain and visibly demonstrate how every participating person and material reached its state, what supported each important intermediate state, and why the next construction action was allowed?

## 8. Simulation Philosophy: Constraint-Aware Choreography, Not Full Physics

The intended initial position lies much closer to authored/kinematic choreography than to full mechanical simulation. The runtime should preserve authorial control and predictable cinematography, while enforcing enough geometry, support, reach, route, and interaction constraints to prevent visibly impossible outcomes.

A physics or collision library may be used as a query/validation substrate. It should not be allowed to turn the project into a generalized physics sandbox. Likewise, do not assume that a kinematic rigid body automatically respects obstacles: common physics engines deliberately allow kinematic bodies to follow prescribed trajectories unless collision-aware motion is explicitly computed.
- Use collision detection, shape casts, ray casts, broad-phase queries, and character-controller-like movement where they improve correctness.
- Use full dynamics selectively only where it clearly improves Mars-specific behavior and remains controllable.
- Favor conservative failure over visually impossible success. If a carrying formation cannot make a turn, reject or replan it instead of clipping through geometry.
- Keep the distinction between believable simulation constraints and actual structural feasibility/engineering certification explicit.

## 9. Research Mature Game-Engine Patterns Before Reinventing Them

The implementation agent must devote explicit research time to how mature engines and games solve analogous problems before committing to bespoke systems. The objective is not to recreate Unity, Unreal, Godot, GoldenEye, or Mario. It is to avoid rediscovering decades of edge cases badly.

The agent should produce a short decision record identifying which established patterns it will adopt, which third-party libraries it will prototype, and which behaviors remain deliberately Mars-specific. Research should translate into tests and architecture decisions, not merely citations.

| Problem | Patterns to study / questions to answer |
| --- | --- |
| Global route planning | NavMesh/Recast/Detour path corridors, cost areas, walkable surfaces, dynamic topology, off-mesh/special links. |
| Local movement | Character controllers, steering, anticipation, corner smoothing, yielding, congestion, arrival tolerances, anti-oscillation. |
| Contextual traversal | Stairs, ladders, mounting vehicles, entering seats, work positions, special traversal links / smart interaction objects. |
| Dynamic construction | How navigation updates when walls, floors, stairs, and obstacles appear during runtime. |
| Interaction slots | Unreal-style smart objects / reservable positions; approach transform, facing, occupancy, execution ownership. |
| Animation ownership | How navigation/root motion/IK/physics avoid competing to write the same transform. |
| Cameras | Cinemachine-style decollision vs deocclusion, subject framing, damping, shot-quality scoring, predictive visibility. |
| Replay/versioning | Gameplay replay systems, snapshots/checkpoints, deterministic input streams, independent spectator cameras. |

## 10. Natural Navigation and Locomotion Requirements

Collision response is not navigation. A human should not walk directly into a wall, then slide along it until freed. Major obstacles must affect path planning before movement begins. Local collision avoidance is a secondary safeguard for other moving actors and small transient conflicts.

Routes should be represented as navigable corridors or an equivalent robust structure, not as a brittle sequence of world-space points. The mover may smooth and adjust within the corridor but must remain inside valid clearance. Replanning should occur when something materially changes, not every render frame.

Movement quality should match the everyday coherence users expect from mature 3D games: approach doorways and stairs at sensible angles, turn before entering narrow structures, avoid jitter and “dancing,” do not oscillate between equally plausible paths, and wait/yield when passing is impossible.
- Define movement profiles for walking humans, EUCs, bicycles, forklifts, and coordinated crews carrying long loads.
- Separate global pathfinding from local avoidance and from animation.
- Explicitly handle arrival, orientation, turn radius, slope/stair transitions, and floor/level identity.
- Construction must alter future navigation. New walls block routes; newly completed floors and stairs create routes only when usable.
- The controller should return useful failures such as blocked route, insufficient clearance, or unreachable work position.

## 11. Coordinated Carrying Is a Mars-Specific Primitive

Standard individual-agent navigation is insufficient when two to four people carry a long beam, frame, or plywood sheet. The crew and the load become one coordinated moving formation with shared constraints.

Plan and validate the formation as a whole. A path is invalid if the humans fit but the load intersects a wall or cannot rotate through a corner. Individual local-avoidance systems must not move carriers independently in ways that would break hand contact or distort the load.

Each carrying behavior should define permitted crew sizes, grip slots, relative formations, transition poses, orientation limits, clearance envelope, and handoff/release rules. These definitions can be approximate and evidence-informed; they must be visibly plausible.

## 12. Interaction and Construction Recipes

Do not attempt to infer an arbitrary build procedure solely from a finished mesh. Start with a small family of explicit, evidence-backed Mars construction recipes and compose them.

A recipe represents prerequisites, reservations, ordered and parallel tasks, intermediate support states, success conditions, and release conditions. Construction correctness should depend on state/events rather than arbitrary timestamps wherever possible.
- Example: crew continues supporting a raised frame until specified stabilizing connections exist and the support predicate passes.
- Plywood floor installation requires its documented timber/2x4 substructure first.
- An upper work task requires a reachable and safe-enough work position rather than letting a character float or stretch unrealistically.
- Stair traversal becomes available progressively only when the recipe marks the relevant steps/landing/support as usable.
- Forklift actions require a vehicle route, turning clearance, fork/load engagement, lift range, and valid receiving arrangement.
- Actions should fail intelligibly when staffing, access, support, inventory, or clearance is insufficient.

## 13. Action Runtime and Controller Contract

Natural language does not belong inside the low-level controller. The controller should expose explicit, composable operations over named/ID-addressable objects. A smart external director translates requests such as “move the beams behind Chiba” into structured operations.

However, “no interpretation” must not mean “no intelligence.” A carry command should still invoke path planning, collision-aware movement, grip maintenance, reservations, and validation. Those are reliable runtime behaviors, not language understanding.

Every action should have a machine-readable contract: inputs, preconditions, resources/reservations, phases, completion condition, recoverable blockers, failure reasons, cancellation semantics, and outputs.

| Action lifecycle | Meaning |
| --- | --- |
| requested | Structured command has been received. |
| validated | Preconditions and planning checks pass against the referenced world state. |
| reserved | Required actors, objects, interaction slots, and work zones are held for the action. |
| executing | The runtime is advancing the action. |
| completed | Explicit completion condition is satisfied. |
| blocked / paused | Execution cannot presently continue but state remains valid. |
| failed | Action cannot complete under its contract. |
| cancelled | Cancellation policy has brought the action to an allowed stop state; never silently drops unsupported loads. |

## 14. Sequence / Choreography Model

A scene is a composition of actions, conditions, parallel branches, barriers, triggers, and optional exact timing. Construction dependencies should normally use state/event conditions. Exact time remains useful for cinematic cues, music, projections, weather transitions, and deliberate choreography.

Sequences must be serializable, saved, replayed, parameterized, and rebound where appropriate. Distinguish a reusable sequence template from a bound plan that has been validated against one specific starting world state and concrete object/actor bindings.

The sequence system should be capable of being wide and expressive without becoming an untyped “script anything” API. Prefer a growing registry of explicit verbs and typed parameters.

## 15. Smart External Director and MCP/API Layer

The external agent (for example, a coding/LLM agent) is the director. It can reason about intent, object names, scene semantics, and desired storytelling; query the current world; compose controller actions; rehearse; inspect results; revise; and finally execute a validated plan in the watched world.

The MCP/API layer should wrap the same underlying action registry used internally. Do not implement a parallel control system that can drift from in-app behavior. Prefer structured inputs and structured results, with query tools for semantic world state and diagnostics.

The agent should have both symbolic and visual scene awareness: structured queries for identities, states, supports, collisions, routes, and visibility, plus screenshots or short preview captures from requested viewpoints. Pixels should not be the sole source of truth for geometry; structured data should not be the sole judge of whether a scene looks good.

## 16. Rehearsal Before Official Execution

A central workflow is: snapshot -> fork rehearsal -> plan/validate -> simulate -> inspect -> revise -> approve -> execute from the validated baseline. Rehearsal and official execution must share the same action implementations and collision/constraint logic.

The agent should be able to test a scene privately, discover that a camera is blocked or a long load cannot make a turn, modify the plan, and only then perform it for the watching user. “Rehearsal” must not be a fake fast path that omits the difficult checks.

Before official execution, verify that the current baseline still matches the plan’s assumptions. If a trailer was moved into the route after rehearsal, the plan requires revalidation. Camera-only changes should not invalidate a construction plan.

## 17. Characters and Activities

Preserve the quality of the current recognizable humanoids and locomotion; do not regress to crude placeholders merely to add simulation structure. Generic people are sufficient initially. Future real-person scans should only be added with participant permission and should plug into the same action system.

The action vocabulary should grow beyond construction to include walking, stairs, sitting/standing, riding bicycles and EUCs, dancing, reading, socializing, facing/conversing, tending or sitting by campfires, teaching/presenting, watching projections, and coordinated activities/parties.

At a higher level, Mars can become Sims-like: people have available activities and can participate in coordinated social life. Explicit director commands must take precedence over background autonomy, and critical responsibilities such as supporting an upright may never be abandoned because an autonomous behavior fired.

## 18. Camera and Cinematography System

The camera is an independently controllable participant in the simulation, not the owner of the world state. A performance should run correctly with no cinematic camera at all; the user may manually fly around, follow a rider, or attach a separate recording camera.

Separate at least viewer/manual camera, recording/cinematic camera, and rehearsal/inspection cameras conceptually. Camera tracks attach to a take; changing them should not change what happened in the take.

Study mature camera systems such as Unity Cinemachine. Explicitly separate placement validity (camera not embedded in geometry), deocclusion/readability (subject actually visible), and temporal coherence (no twitching between nearby alternatives).
- Support direct trajectories and semantic shot requests such as follow, orbit, frame group, reveal, wide establishing shot, installation close-up.
- A visibility check should consider the actual subject of the action: for installation, the hands, beam end, and receiving socket may all matter.
- Plexiglass demonstrates why camera collision and visual occlusion categories may differ.
- If a shot becomes obstructed, prefer planned alternate placement or a deliberate cut. Never silently fly through a wall or hide architecture except in explicit inspection/cutaway mode.
- For rehearsed scenes, exploit future knowledge: predict impending occlusion and choose a better shot before it happens.

## 19. Environment, Weather, Time, and Infrastructure

In the next tranche, environmental systems are primarily visual and cinematic. Implement convincing sun position, lighting, shadows, day/night, cloud cover, rain, wet/muddy ground appearance, fires, screens/projections, and seasonal/time-of-day controls. Do not overbuild power-grid or weather physics yet.

Solar panels, charge controllers, batteries, inverters, and related infrastructure should remain semantically identifiable and configurable. A later simulation may connect sun exposure to power availability, but this is not required now.

Keep environmental date/time separate from simulation elapsed time so the same recorded take can be presented under different lighting when such overrides are explicitly visual-only.

## 20. Inventory and Future-Campus Design

Future campus workspaces may operate in finite-inventory mode or unlimited/spawn mode. Both should use the same geometry, connection, handling, and action rules. Unlimited inventory means new parts may be created explicitly; it does not grant unlimited human strength or permission to ignore collisions.

Over time, the semantic component catalog should support bills of materials, actual available stock, reusable named assets, snap/connection constraints, and possibly assembly-order guidance. Do not block the next tranche on exhaustive inventory tracking.

## 21. Versioned World State Is a Core Product Feature

The application should be conceived as a versioned world-state system, not seven mutable scenes. The canonical 2020-2026 Marses are protected, named, published states within the same general model used for experimental states.

A plan only makes sense relative to the exact state for which it was designed and validated. Formally, a complete starting state plus ordered inputs plus a specific version of the runtime rules produces a successor state. Execution-rule versions matter because improved navigation, collision, or handling code can change the result.

Historical years are not automatically a causal chain. The app knows separately reconstructed endpoints; it must not invent the undocumented transitions between them.

| Artifact | Meaning |
| --- | --- |
| World state | Complete state required to describe a campus/simulation at a point in history. |
| Revision / checkpoint | Immutable saved state with parent/provenance and version identifiers. |
| Workspace | Editable branch/fork derived from a checkpoint or other workspace state. |
| Sequence template | Reusable parameterized choreography independent of one specific state. |
| Bound plan | Template bound to concrete actors/objects and a particular starting revision, then validated. |
| Run / take | What actually happened during one execution, including resolved timing and motion. |
| Camera track | Separately versioned observation/presentation of a take. |

## 22. Branching, Checkpoints, Replay, and Forking

Users must be able to browse canonical states, create a workspace from any suitable state, make edits, save checkpoints, execute sequences, inspect history, replay prior takes, and fork from earlier states into alternatives.

Do not initially build automatic branch merging. Physical and semantic conflicts make naive merging unsafe. Prefer explicit selective import/cherry-pick-like operations followed by validation.

Distinguish replaying a take from rerunning a plan. Replay shows what actually happened and should not invoke the latest planner again. Rerunning a plan is a new execution; if state, behavior versions, assets, or parameters changed, it is a new take.
- A replay must be camera-independent: reshoot the same performance from a different camera without recomputing the world actions.
- Forking mid-performance requires a resumable simulation checkpoint, not merely a screenshot of transforms. Active tasks, reservations, supports, grips, RNG state, and relevant controller phases may need preservation.
- If full mid-action resumability is too large initially, support it for a defined subset and state limitations explicitly. Never label a merely visual snapshot as a fully resumable state.
- Watching a replay must be isolated from the live room and must not reserve live actors, mutate inventory, or send commands into current state.

## 23. Determinism and Reproducibility

Aim for deterministic or at least strongly reproducible behavior within controlled subsystems. Use a fixed simulation timestep, explicit random seeds, ordered inputs, pinned runtime/asset definitions, and captured resolved decisions. A language model should not be reinvoked during replay to “remember” what it decided.

Do not overclaim determinism. A deterministic physics library does not automatically make the entire application deterministic if upstream math, asynchronous operations, navigation generation, animation, or asset versions differ.

When exact visual replay matters, persist enough resolved motion/state information to reproduce the take even if planning algorithms later improve.

## 24. State Persistence and Shared Rooms

Preserve the existing distinction between ordinary client-local exploration and explicitly joined persistent/shared simulation rooms. There must not be one accidental universal global Mars.

For shared rooms, exactly one authority must order accepted world-changing actions. Browsers should not independently decide whether an installation succeeded. The coding agent should inspect the current Durable Object architecture and choose where authoritative simulation stepping belongs.

Do not send per-frame motion or hand placement through MCP/network round trips. High-level actions are submitted to an authoritative runtime; local/rendering systems advance detailed motion. Persist important room/run state explicitly because in-memory state cannot be assumed to survive indefinitely.

## 25. Asset Management, Source Control, and Deployment Discipline

Before or alongside major refactoring, establish proper version control. The project should have Git history, intentional asset boundaries, a reproducible local build, release identifiers, rollback capability, and a documented deployment command sequence. GitHub-driven deployment is optional; reproducibility and rollback are not.

Keep the private media archive and credentials out of source control. Public/deployable selected photos and textures should remain explicitly staged. Large model/download assets can continue using R2 or an equivalent existing mechanism.

Every canonical state, run, and plan should ultimately reference pinned asset/behavior versions rather than ambiguous “latest” filenames when replay fidelity matters.

## 26. Frameworks to Evaluate, Not Blindly Adopt

The implementation agent should prototype established libraries against the actual Mars code before deciding to integrate them. Prefer narrow libraries for hard generic geometry/movement problems, and keep Mars semantics in project-owned code.

| Area | Candidate / precedent | Evaluation question |
| --- | --- | --- |
| Navigation | Recast/Detour; recast-navigation-js | Can it robustly support current Three.js geometry, multiple levels, changing construction surfaces, dynamic obstacles, path corridors, and load-aware custom planning hooks? |
| Collision / kinematic queries | Rapier JS/WASM | Does it provide useful colliders, shape/ray casts, character movement, snapshots/determinism without forcing full dynamics or excessive integration complexity? |
| Animation / IK | Existing Three.js animation stack; Three.js CCD IK where compatible | Can current humanoid rigs support reliable contact/pose adjustment without replacing them? |
| Browser E2E / visual capture | Playwright or equivalent | Can tests drive Studio, call controller APIs, capture screenshots/video, and assert both structured state and visual regressions? |
| Agent control | Existing MCP/API architecture; current MCP spec patterns | Can one typed action registry generate both internal controller calls and remote tool schemas/results? |
| Replay | Unreal-style replay concepts, event log + checkpoints | What minimum data is required for faithful camera-independent replay and resumable checkpoints? |

## 27. Self-Evaluation Is Part of the Product, Not Just QA

The implementation agent is explicitly responsible for proving its own progress. Every major capability must arrive with automated or semi-automated evidence that it satisfies the behavioral ideals. The agent should build testability into the architecture instead of adding a few superficial tests after implementation.

Use a layered verification strategy: pure/unit tests for state machines and geometry rules; deterministic simulation tests for actions and transitions; integration tests for controller/state persistence; browser E2E tests for real Studio behavior; and visual/recorded evaluation for movement and cinematography that cannot be judged from numbers alone.

The agent should proactively create diagnostic modes: collision volumes, navmesh/path corridor display, support relationships, interaction slots, reservations, object IDs, camera visibility rays, current action phases, and failure reasons. These modes are essential both for debugging and for self-evaluation.

## 28. Mandatory Behavioral Regression Suite

Create a compact “Mars proving ground” test scene that deliberately exercises the edge cases below. These should become persistent regressions, not one-off demos. The implementation agent may add many more cases as it discovers them.

| Test | Required proof |
| --- | --- |
| Wall avoidance | A human given a destination on the other side of a wall chooses a route around it before contact; no penetration or prolonged wall sliding. |
| U-shaped trap / concavity | Global planning escapes the shape; local steering alone does not oscillate indefinitely. |
| Narrow passage / two agents | Agents pass if clearance allows; otherwise one yields/waits without jitter or repeated path flipping. |
| Stair approach | Agent approaches an entry region, orients appropriately, ascends valid completed steps, exits at the landing; does not climb from the side. |
| Multiple floors | Agent remains on the correct level and uses actual vertical connections instead of selecting the closest X/Y point on another floor. |
| Long load around corner | Crew + load trajectory remains collision-free through the full maneuver; reject if rotation/clearance is impossible. |
| Raise tall frame | Required crew supports the component through the raising arc; frame cannot be released before support predicate passes. |
| Construction changes navigation | Installing a wall invalidates affected routes; installing usable stairs/floor can create valid new routes. |
| Incomplete floor/stairs | No invisible traversable surface appears simply because the final building definition contains one. |
| Reservation conflict | One actor/object/seat/work position cannot be simultaneously owned by incompatible actions. |
| Graceful cancellation | Cancelling a carry/raise does not cause unsupported floating/dropping unless explicitly modeled. |
| Camera collision | Cinematic camera does not pass through opaque architecture during a normal shot. |
| Camera readability | Important action remains visible/readable or the camera deliberately replans/cuts; no rapid oscillation. |
| Replay independence | Changing camera track does not alter actor routes, action results, inventory, or final world state. |
| Fork isolation | Edits in a workspace branch do not mutate canonical historical state or sibling branches. |
| Plan invalidation | Changing a relevant obstacle after rehearsal causes validation failure/replan before official execution. |
| Replay isolation | Viewing an old take cannot mutate a live simulation room. |

## 29. Visual and Cinematic Evaluation

Many failures are perceptual rather than purely logical. Add automated capture of representative sequences from fixed diagnostic cameras. Compare screenshots and/or short videos across versions, supplemented by structured invariants.

The agent should inspect generated captures itself during development. A test passing because no collider overlapped does not establish that a person approached stairs naturally or that four carriers look coordinated. Conversely, visual plausibility cannot excuse a hidden geometry violation.

Useful evaluation signals may include: path efficiency vs shortest sensible corridor; clearance margins; number of replans; abrupt heading changes; foot sliding; hand-to-grip error; subject occlusion percentage; camera acceleration/jitter; action completion time bounds; and number/type of constraint violations.

## 30. Proof-of-Competence Milestones

The agent should organize development around increasingly difficult observable demonstrations. Each milestone requires regression tests and a short machine- and human-readable evidence report describing what was proven, what remains approximate, and what new regressions were added.

| Milestone | Demonstration |
| --- | --- |
| A. Audited foundation | Document current world/state/control architecture; establish Git/reproducible build; create proving-ground scene; preserve existing rendering and characters. |
| B. Natural individual movement | Humans route around static obstacles, handle stairs/levels, avoid oscillation, yield appropriately, and never walk through walls. |
| C. Coordinated carry | 2-4 humans collect and carry a real Mars component around obstacles with stable grips and whole-formation clearance. |
| D. Supported rack bay | Raise a tall frame, hold/support it, install stabilizing connections, and release only after predicate passes; invalid variants fail intelligibly. |
| E. Progressive construction | Extend bays; add timber subfloor, plywood, progressive stairs; update walkable world; optionally use forklift. |
| F. Rehearsal + official execution | Agent rehearses privately, detects and fixes failures, then executes accepted sequence from matching baseline. |
| G. Replay + branching | Save take; replay from independent cameras; fork at checkpoint; produce alternative successor without mutating original. |
| H. Inhabited Mars scenes | Compose campfire/class/party/dance/riding/social activities using the same action/interaction framework. |

## 31. Non-Negotiable Invariants

The implementation agent should treat the following as hard product invariants unless the project owner explicitly revises them.
- Historical evidence outranks plausible invention; SketchUp proposals are not as-built truth.
- Canonical historical states are protected and forkable, not casually mutated.
- No visible human, vehicle, camera, or carried object may pass through solid boundaries in normal simulation.
- Navigation should proactively choose sensible routes; collision sliding is not an acceptable primary pathfinding strategy.
- Construction intermediate states must remain supported according to explicit approximate rules; no magical floating materials.
- Navigation/access surfaces change as construction progresses; incomplete floors and stairs are not fully traversable.
- The controller uses explicit structured actions. The smart agent interprets language and composes those actions.
- Agent plans are rehearsable and state-bound. Relevant baseline changes require revalidation.
- Replay of a take is distinct from re-execution of a plan.
- Camera choreography is independent of world performance and must not silently alter the simulation.
- Tests and self-evaluation are part of every substantial feature; progress is not accepted solely because code compiles or a happy-path demo looks plausible.
- Use generic frameworks for generic geometry/movement problems when they prove useful; keep Mars-specific semantics, build recipes, identities, and evidence in project-owned code.
- Do not over-generalize the system into a generic game engine. It is deliberately a highly expressive engine for Mars College.

## 32. Explicit Non-Goals for This Tranche

These are intentionally deferred unless they become necessary to satisfy a core invariant.
- Engineering-grade structural analysis, material stress, or true construction safety certification.
- Full dynamic rigid-body simulation of every object and accident.
- Detailed electrical-grid simulation tying solar production to every load.
- A Unity-like visual timeline editor.
- Automatic merging of arbitrary workspace branches.
- Photorealistic scanned representations of real Martians.
- A generic-purpose browser game engine unrelated to Mars.
- Perfect inference of undocumented historical build sequences.

## 33. Instructions to the Implementation Agent

Begin by reading this brief, the live simulation-agent guide, reconstruction/history notes, and the actual source. Run the existing application and test current controls before proposing major architecture changes. Identify what already exists and can be extended.

Then produce a concrete implementation plan mapping these ideals onto the current codebase: data migrations, new modules, APIs, dependencies, persistence model, rollout order, tests, diagnostic tooling, deployment changes, and risk mitigation. The plan should be proactive and comprehensive; do not stop at vague recommendations.

Work autonomously. When a technical decision is reversible, choose a reasonable path, document it, implement a small proving prototype, measure it, and continue. Ask the owner only when product intent is genuinely ambiguous or a decision would irreversibly alter historical data/security/cost.

At every stage, prefer an executable proof over an architectural claim. If you believe humans no longer walk through walls, write an E2E regression that attempts to make them do so. If you believe replays are camera-independent, prove identical world-state hashes/results under multiple camera tracks. If you believe a tall frame cannot be prematurely released, test the invalid release explicitly.

Keep a running engineering decision log and evidence log. Failed approaches are useful if recorded. Update tests whenever a newly discovered edge case is fixed so that the behavior does not regress.

The final outcome of the development tranche should include not just new code but a reproducible build/deployment workflow, a persistent regression suite, diagnostic/debug views, documented controller schemas, and one or more compelling end-to-end reference sequences that demonstrate the system’s competence.

> **North-star behavior:** A director agent should be able to say what should happen; reliably interrogate the world; rehearse and validate a plan; have the Mars runtime execute physically believable actions using explicit constraints; inspect the result visually and structurally; revise when necessary; perform it in the official state; save the resulting successor state and take; and reshoot or fork that history without corrupting the source world.

## 34. Reference Research Starting Points

The following are starting points, not prescriptions. Prefer current official documentation and inspect library versions before implementation.
- Unity AI Navigation documentation: NavMesh surfaces, agents, obstacles, links, navigation internals, and mixing navigation with animation/physics. https://docs.unity3d.com/Packages/com.unity.ai.navigation/
- Unity Cinemachine documentation: camera composition, decollision, deocclusion, damping, and shot evaluation. https://docs.unity3d.com/Packages/com.unity.cinemachine/
- Unreal Engine Smart Objects: interaction opportunities and reservable slots. https://dev.epicgames.com/documentation/en-us/unreal-engine/smart-objects-in-unreal-engine---overview
- Unreal Engine Replay System: gameplay recording, reconstruction, checkpoints, and spectator-style playback. https://dev.epicgames.com/documentation/unreal-engine/using-the-replay-system-in-unreal-engine
- Recast & Detour: navigation mesh generation/querying and path-corridor concepts. https://recastnav.com/
- recast-navigation-js: JavaScript/Three.js-oriented Recast/Detour integration candidate. https://github.com/isaac-mason/recast-navigation-js
- Rapier JavaScript/WASM: kinematic bodies, character controllers, collision/scene queries, and determinism. https://rapier.rs/docs/user_guides/javascript/
- Model Context Protocol tools specification: typed tool inputs/results for the agent-facing control layer. https://modelcontextprotocol.io/specification/
- Playwright: browser E2E control, screenshots, video, and automated regression driving. https://playwright.dev/

## 35. Closing Principle

Do not optimize for the appearance of intelligence by letting an LLM improvise around an under-specified world. Optimize for a world that is semantically explicit, testable, versioned, collision-aware, and dependable enough that a capable director agent can compose sophisticated behavior from it.

The desired system should feel expressive like a game engine but opinionated like a domain tool: it knows what Mars College components are, how Mars people plausibly use them, what historical evidence supports, how a campus changes through construction, and how to preserve and replay those changes. The sophistication should live in robust reusable primitives and verified behavior, not in hidden magic.
