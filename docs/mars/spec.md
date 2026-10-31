# Mars engine specification

Architecture targets and proof obligations the engine was built against. It describes outcomes, invariants and
boundaries more than source-level mechanics; the other docs in this folder and the code describe what exists.
Section numbers are stable because code comments cite them as "SPEC §N".

- Treat "must" and "non-negotiable" as requirements.
- Named libraries are candidates to evaluate, not requirements ([design-decisions.md](design-decisions.md)).
- Every claim of competence needs a test, a deterministic state assertion, a visual capture or an end-to-end run.

## 1. Purpose

Target ideals, architectural constraints and proof obligations for a browser-based 3D world simulation and
cinematic engine. Work validates itself continuously through automated tests, deterministic checks, visual
evaluation and end-to-end runs.

## 2. Product definition

One coherent, versioned, semantic world model that serves three uses: recorded reference states of a site, an
editable design workspace using reusable construction components, and a simulation and directing engine that
stages believable human activity, construction, vehicles, environment and camera choreography.

> Canonical states are published world states. Workspaces fork them. Actions create transitions. Takes preserve
> what happened. Cameras are independently editable ways of witnessing those performances.

## 3. Existing system context

- Frontend: TypeScript, React 19, Vite, three.js.
- One scene is a GLB derived from CAD; other scenes are procedural three.js geometry built from a reusable
  component kit. Components have ids, assemblies, materials and layers for selection, editing, cutaways, saved
  layouts and GLB export.
- A Cloudflare Worker serves the app and the control API; one Durable Object per room holds shared room state;
  large models live in object storage.
- Client-local exploration and persistent shared rooms are distinct.

## 4. Canonical states and provenance

Published canonical states are protected checkpoints: experiments fork them and never overwrite them. Keep
reconstruction edits (changing what a canonical state contains) distinct from in-world events (people moving
things during a run): they are different checkpoint causes. Attach provenance and confidence where practical,
especially to inferred dimensions, hidden interiors and generated sequences. Unknown geometry stays marked
provisional rather than being filled in; unknown is never walkable. Dimensional precision and certainty are
separate fields.

## 5. Domain vocabulary and semantic world model

A mesh is not enough: important objects need identities, affordances, support relationships, navigation
implications and simulation state.

| Concept | Responsibility |
| --- | --- |
| Asset definition | Reusable description of a beam, frame, plywood sheet, stair, couch, trailer, vehicle, character, solar component, … |
| World placement | Instance in a specific state: transform, assembly, material state, provenance, labels |
| Simulation state | Transient run state: reserved by, held by, supported by, occupied, connected, moving, installed, blocked |
| Named region | Queryable area: staging zone, material pile, courtyard, walkable zone, fire circle, audience area |
| Interaction affordance | Grip point, seat, work position, stair entry, connection socket, vehicle mount, projection surface |

## 6. Construction and material vocabulary

A constrained, recurring vocabulary: pallet-rack frames and beams, plywood, 2x4 timber, doors, windows, stairs,
furniture, screens, solar equipment, trailers, vehicles, tents, people, bicycles and EUCs. A catalog "upright" is
a complete two-column frame, not a single post. Structural assets gradually gain sockets, grip positions,
clearance envelopes, support requirements and construction roles. These make staging believable; they are not
structural certification.

## 7. The first gold-standard scenario

Crews of 2–4 collect rack components, plywood and timber from piles, carry them to a staging area and assemble a
structure. A tall frame is raised with credible support and held until stabilizing connections exist. Beams
extend the structure; timber framing goes in before plywood; stairs are built progressively and become
traversable only when their pieces and landing exist; a forklift may lift loads to upper levels.

Physical believability, not rigid-body simulation: nothing passes through walls, crews do not do impossible
manoeuvres, loads stay supported during rotations, and no invisible floor or stair activates early.

> **Acceptance test:** can the system explain and show how every person and material reached its state, what
> supported each intermediate state, and why the next construction action was allowed?

## 8. Constraint-aware choreography, not full physics

Closer to authored kinematic choreography than to mechanical simulation, while enforcing enough geometry,
support, reach, route and interaction constraints to prevent visibly impossible outcomes. A physics library may
be a query substrate, not a sandbox; kinematic bodies do not respect obstacles by themselves. Prefer conservative
failure over impossible success: if a formation cannot make a turn, reject or replan.

## 9. Research mature patterns first

Study how engines solve navigation (navmesh corridors, links), local movement (steering, yielding, arrival),
contextual traversal (stairs, mounts, seats), dynamic construction, reservable interaction slots, animation
ownership, cameras (decollision vs deocclusion, shot scoring) and replay/versioning. Record which patterns are
adopted, which libraries are prototyped and what stays project-specific.

## 10. Navigation and locomotion

Collision response is not navigation: major obstacles shape the plan before movement; local avoidance only handles
moving actors and transient conflicts. Routes are corridors, not brittle point lists. Replan when something
material changes, not every frame. Approach doors and stairs sensibly, turn before narrow structures, never jitter
or oscillate, wait or yield when passing is impossible. Separate global planning, local avoidance and animation.
Handle arrival, orientation, turn radius, stairs and level identity. Construction changes navigation. Failures are
useful: blocked route, insufficient clearance, unreachable work position.

## 11. Coordinated carrying

When 2–4 people carry a long load, crew and load are one formation planned and validated as a whole. A path is
invalid if the load cannot clear a corner even when the people fit. Local avoidance must not break hand contact.
Each carry behaviour defines crew sizes, grip slots, formations, orientation limits, clearance and release rules.

## 12. Interaction and construction recipes

Compose explicit recipes rather than inferring procedures from a finished mesh. A recipe has prerequisites,
reservations, ordered and parallel tasks, intermediate support states, success and release conditions, driven by
state and events rather than timestamps. Examples: hold a raised frame until the support predicate passes; joists
before plywood; work only from a reachable station; stairs usable only when complete; forklift actions need route,
turning clearance, fork engagement and lift range. Fail intelligibly on staffing, access, support, inventory or
clearance.

## 13. Action runtime and controller contract

Natural language stays outside the controller. The controller exposes explicit, composable operations over
id-addressable objects; an external director composes them. Runtime behaviours (planning, collision-aware motion,
grip maintenance, reservations, validation) are still intelligent. Every action has a machine-readable contract:
inputs, preconditions, reservations, phases, completion, recoverable blockers, failure reasons, cancellation
semantics and outputs.

| Lifecycle | Meaning |
| --- | --- |
| requested | Command received |
| validated | Preconditions and planning checks pass against the referenced state |
| reserved | Actors, objects, slots and work zones are held |
| executing | The runtime is advancing it |
| completed | Its completion condition holds |
| blocked / paused | Cannot continue now; state stays valid |
| failed | Cannot complete under its contract |
| cancelled | Reached an allowed stop state; never silently drops unsupported loads |

## 14. Sequence and choreography model

A scene composes actions, conditions, parallel branches, barriers, triggers and optional exact timing. Sequences are
serializable, replayable, parameterized and rebindable. A reusable template is distinct from a bound plan validated
against one starting state and concrete bindings. Prefer a growing registry of typed verbs over a "script anything"
API.

## 15. External director and MCP/API layer

An external agent is the director: it queries the world, composes actions, rehearses, inspects, revises and
executes. The MCP/API layer wraps the same action registry used internally; no parallel control system. Give the
director structured queries (identities, states, supports, routes, visibility) and visual previews.

## 16. Rehearsal before execution

Snapshot → fork → plan → simulate → inspect → revise → execute from the validated baseline. Rehearsal and execution
share the same action implementations and constraint logic; rehearsal is never a fast path. Before execution,
verify the baseline still matches the plan's assumptions; camera-only changes do not invalidate a plan.

## 17. Characters and activities

Keep the quality of the existing humanoids. The vocabulary grows from construction to walking, stairs, sitting,
riding, dancing, reading, conversing, campfires, teaching and watching projections. Explicit director commands take
precedence over background autonomy, and critical responsibilities (supporting an upright) are never abandoned
because an autonomous behaviour fired.

## 18. Camera and cinematography

The camera observes and never owns world state; a performance runs correctly with no camera. Separate manual,
recording and inspection cameras. Camera tracks attach to a take and never change it. Separate placement validity,
readability and temporal coherence. Support trajectories and semantic shots (follow, orbit, frame group, reveal,
establishing). Visibility considers the action's actual points. If a shot becomes obstructed, choose an alternate or
cut; never fly through a wall except in an explicit cutaway. Use future knowledge in rehearsed scenes.

## 19. Environment, weather, time and infrastructure

Environment is visual and cinematic: sun position, lighting, shadows, day and night, clouds, rain, wet ground, fires,
screens, time of day. Solar equipment stays semantically identifiable and configurable, without a power simulation.
Environmental date/time is separate from simulation time, so a take can be presented under different lighting.

## 20. Inventory and design workspaces

Workspaces run in finite-inventory or unlimited mode with the same geometry, handling and action rules. Unlimited
inventory creates parts explicitly; it never grants unlimited strength or ignores collisions.

## 21. Versioned world state

A versioned world-state system, not a set of mutable scenes. A plan is valid only against the exact state it was
validated for: start state + ordered inputs + runtime rules version → successor state. Separately recorded
canonical states are not a causal chain; the engine does not invent transitions between them.

| Artifact | Meaning |
| --- | --- |
| World state | Everything needed to describe the world at a point |
| Checkpoint | Immutable state with parent, provenance and version ids |
| Workspace | Editable branch from a checkpoint |
| Sequence template | Reusable parameterized choreography |
| Bound plan | Template bound to concrete actors, objects and a starting checkpoint, then validated |
| Take | What happened in one execution, with resolved timing and motion |
| Camera track | Separately versioned presentation of a take |

## 22. Branching, checkpoints, replay and forking

Browse canonical states, fork, edit, checkpoint, execute, inspect history, replay takes and fork alternatives. No
automatic merge. Replaying a take shows what happened without invoking the planner; rerunning a plan is a new take.
Replay is camera-independent and isolated from live rooms. Forking mid-performance needs a resumable checkpoint
(tasks, reservations, supports, grips, RNG, controller phases); support a defined subset and state the limits.
Never label a visual snapshot as resumable.

## 23. Determinism and reproducibility

Fixed timestep, explicit seeds, ordered inputs, pinned rules and assets, captured resolved decisions. A language
model is never re-invoked during replay. Do not overclaim determinism; persist resolved motion when exact replay
matters.

## 24. Persistence and shared rooms

Local exploration and joined shared rooms stay distinct. In a shared room exactly one authority orders
world-changing actions; browsers never decide outcomes. No per-frame motion over the network: submit high-level
actions to the authoritative runtime. Persist important state explicitly.

## 25. Assets, source control and deployment

Version control, intentional asset boundaries, a reproducible build, release identifiers and rollback. Keep
credentials and private media out of source control. Canonical states, runs and plans reference pinned asset and
behaviour versions when replay fidelity matters.

## 26. Frameworks to evaluate

Prototype narrow libraries against the real code before integrating; keep domain semantics in project code.
Candidates: Recast/Detour (navigation), Rapier (collision queries), three.js IK, Playwright (E2E and capture), the
MCP specification (agent control), replay systems (event log + checkpoints). Outcomes:
[design-decisions.md](design-decisions.md).

## 27. Self-evaluation is part of the product

Every major capability arrives with evidence. Layered verification: unit tests for state machines and geometry,
deterministic simulation tests, integration tests for the controller and persistence, browser E2E, and recorded
visual evaluation. Build diagnostic modes: collision volumes, corridors, supports, slots, reservations, ids, camera
rays, action phases and failure reasons.

## 28. Mandatory behavioural regression suite

A compact proving-ground scene (`engine/scenes/proving-ground.ts`) exercises these cases as persistent regressions:

| Test | Required proof |
| --- | --- |
| Wall avoidance | Routes around a wall before contact; no penetration or prolonged sliding |
| U-shaped trap | Global planning escapes; no indefinite oscillation |
| Narrow passage, two agents | Pass if clearance allows, else one yields without jitter |
| Stair approach | Enter from the entry region, climb valid steps, exit at the landing; never from the side |
| Multiple floors | Stay on the correct level; use real vertical connections |
| Long load around a corner | Crew + load collision-free through the manoeuvre, else rejected |
| Raise tall frame | Supported through the arc; no release before the support predicate passes |
| Construction changes navigation | A wall invalidates routes; usable stairs or floors create them |
| Incomplete floor or stairs | No invisible traversable surface |
| Reservation conflict | No two incompatible owners of an actor, object, seat or work position |
| Graceful cancellation | Cancelling a carry or raise never drops or floats a load |
| Camera collision | No camera through opaque architecture in a normal shot |
| Camera readability | The action stays readable, or the camera replans or cuts; no oscillation |
| Replay independence | Camera changes never alter routes, results, inventory or final state |
| Fork isolation | Workspace edits never mutate canonical or sibling states |
| Plan invalidation | A relevant change after rehearsal fails validation before execution |
| Replay isolation | Viewing a take cannot mutate a live room |

## 29. Visual and cinematic evaluation

Capture representative sequences from fixed diagnostic cameras and compare across versions, alongside structured
invariants. Inspect captures: no collider overlap does not prove a natural stair approach, and visual plausibility
does not excuse a hidden geometry violation. Useful signals: path efficiency, clearance margins, replans, heading
changes, foot sliding, hand-to-grip error, occlusion, camera jitter, completion times, violation counts.

## 30. Proof-of-competence milestones

Each milestone ships with regression tests and a short evidence report.

| Milestone | Demonstration |
| --- | --- |
| A. Audited foundation | Documented architecture, reproducible build, proving-ground scene |
| B. Natural individual movement | Routes around obstacles, stairs and levels, no oscillation, yielding, no wall walking |
| C. Coordinated carry | 2–4 people carry a component around obstacles with stable grips |
| D. Supported rack bay | Raise, hold, connect and release a frame only after the predicate passes |
| E. Progressive construction | Bays, subfloor, plywood, progressive stairs, updated walkable world, optional forklift |
| F. Rehearsal + execution | Private rehearsal, fixes, then execution from a matching baseline |
| G. Replay + branching | Save a take, replay from independent cameras, fork at a checkpoint |
| H. Inhabited scenes | Campfire, class, party, dance, riding and social activities in the same framework |

## 31. Non-negotiable invariants

- Canonical states are protected and forkable, not casually mutated.
- No visible human, vehicle, camera or carried object passes through solid boundaries in normal simulation.
- Navigation chooses sensible routes; collision sliding is never the pathfinding strategy.
- Intermediate construction states stay supported under explicit approximate rules; no floating materials.
- Access surfaces change as construction progresses; incomplete floors and stairs are not traversable.
- The controller uses explicit structured actions; the director interprets language and composes them.
- Plans are rehearsable and state-bound; relevant baseline changes require revalidation.
- Replaying a take is distinct from re-executing a plan.
- Camera choreography never alters the simulation.
- Tests and self-evaluation are part of every substantial feature; compiling or a happy-path demo is not acceptance.
- Generic frameworks for generic geometry problems when they prove useful; domain semantics in project code.

## 32. Explicit non-goals

Structural analysis or safety certification; full rigid-body dynamics; electrical simulation; a timeline editor;
automatic branch merging; photorealistic scans of real people; a generic browser game engine; inference of
undocumented build sequences.

## 33. Working method

Read this spec, the agent guide and the source; run the app before proposing architecture changes. Map the ideals
onto the codebase with a concrete plan. When a decision is reversible, choose, document, prototype, measure and
continue. Prefer executable proof to architectural claims: if humans no longer walk through walls, write the E2E
that tries to make them; if replays are camera-independent, prove identical hashes under several tracks; if a frame
cannot be released early, test the invalid release. Record failed approaches and add a regression for every fixed
edge case.

> A director agent says what should happen, interrogates the world, rehearses and validates a plan, has the runtime
> execute physically believable actions, inspects the result, revises, performs it in the official state, saves the
> successor state and take, and reshoots or forks that history without corrupting the source world.

## 34. Reference starting points

Unity AI Navigation and Cinemachine; Unreal Smart Objects and Replay System; Recast & Detour
(<https://recastnav.com/>); recast-navigation-js; Rapier JavaScript; the Model Context Protocol specification
(<https://modelcontextprotocol.io/specification/>); Playwright (<https://playwright.dev/>).

## 35. Closing principle

Do not let an LLM improvise around an under-specified world. Build a world that is semantically explicit, testable,
versioned and collision-aware, so a director can compose sophisticated behaviour from dependable primitives.
