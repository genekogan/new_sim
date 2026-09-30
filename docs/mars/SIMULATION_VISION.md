# Simulation vision

Owner direction: Gene, 2026-09-29. This supersedes the requirement to close every
LAST_MILE row or follow its former wave order before building playable activities.

## Product goal

Build a fully playable, flexible, real-time simulation of life at Mars College:
building, learning, working, eating, socializing, celebrating, resting, exercising,
animal care and arranging surroundings. Mars is the first substantial application
of a reusable world and activity framework. The Sims, GTA and Second Life are
references for expressivity and agency; this tranche does not reproduce their
entire graphics, physics, multiplayer or economic scope.

The primary progress question is: **What meaningful activities can Gene now
initiate, participate in, modify, interrupt and watch unfold convincingly?**
Technical counts support that answer. Deferred work remains wanted and recoverable.

## Direction and boundaries

Derive a small reusable activity layer from working experiences. Separate intent,
coordination, authoritative physical execution and visual expression. Activities
bind roles to eligible people, capable objects and usable arrangements. Describe
hard constraints separately from preferences, with explicit alternatives and
completion/cleanup conditions. Use bounded planning, stable commitments, relevant
invalidation and local recovery; moving a chair should not restart a whole event.

Directed commands, authored scenarios, player input and autonomy share the same
world, claims and action execution. Player/director intervention takes precedence
through controlled handoff. Nobody is moved by a competing controller. Explain
what people are doing, attending to, waiting for, and what lets them continue.

First deliver **classroom → lightning talks → conversation**: usable seating,
host/presenter roles, meaningful display state, arrivals, questions, presenter
rotation, smaller conversations, departure and cleanup. Start with constrained
existing furniture and clearly hypothetical arrangements. Then connect a communal
day (rest/work/breaks/shared food/social life/sleep), with unfinished intentions
and persistent object state. Demonstrate reuse in a small non-Mars environment.
Needs, interests, relationships and commitments start lightweight. Routine behavior
uses deterministic simulation, not continuous LLM calls. Later extensions include
exercise, parties, dogs and gardening; dogs need species-appropriate behavior.

Objects separate appearance, dimensions/collision, support/attachments,
articulation, capabilities, interaction locations and state. Inspect catalogs at
`<lm-3d-models>`; select a few useful attributed assets,
preserve originals and provenance, and validate them as usable objects. A mesh
alone does not establish a capability. Do not bulk-import the archive.

## Confirmed owner preferences (2026-09-29 interview)

The primary play mode combines complex semi-planned/choreographed scenarios with
watching convincing execution and intervening while the event is running. Runtime
binding and changes in the world may produce different feasible versions of the
same intent. Individual people interacting with usable objects are a prerequisite
and a parallel strand, not a separate control system.

Advance these strands together: approximately **50% complete coherent experiences,
30% breadth of activities/usable objects, 20% visible social believability**. Pick
high-value work from each; never exhaust one strand before improving the others.
This product allocation complements the enabling-foundation/maintenance guidance
below rather than manufacturing contradictory time accounting.

Continue in **/lab** with simpler maps, buildings and arrangements. The historical
Mars Studio is the museum side for now. UI remains moldable; all surfaces ultimately
share one simulation. No new separate game simulation or historical-room reconstruction
is required to deliver the first activity.

## Allocation and judgment

Aim approximately at 70% next playable experience, 20% directly enabling foundations
or serious failures, and 10% polish/maintenance/docs. These are judgment guidelines,
not fabricated accounting. Promote work that unlocks the experience, fixes a serious
failure, reduces repeated cost, or produces substantial visible value cheaply.
Before expanding: what user-visible capability does this unlock, and is this level
of generality or precision necessary now?

Keep the active queue small. Timebox investigations and preserve findings when a
small task exposes large prerequisites. Fine anatomical/contact/camera/construction
fidelity can be deferred. Authoritative ownership/support, major-volume collision,
continuous movement, coherent interruption/cleanup, named infeasibility and documented
replay/persistence guarantees remain mandatory. Define a bounded visual standard for
the featured viewing distance; visible major clipping still deserves correction.
Never weaken tests or silently change baselines to conceal a failure. A fidelity
requirement beyond the milestone must be explicitly reclassified and preserved.

## Collaboration and lasting safeguards

Interview Gene before decisions that need his preferences, especially effort
allocation and product priorities; then work autonomously within the answers.
Prefer **GPT-6.1 Sol medium** for bounded implementation; use Astra medium for
architecture, hard geometry/concurrency and critical review, and Luna for clear
metadata/docs/UI wiring. Use supported model versions, identify unavailable
selection instead of claiming savings, and judge completed work/rework/review cost.
At most three parallel workers, each with deliverable, ownership, acceptance,
dependencies and a stopping/escalation condition. Avoid expensive inherited context.

Repository: `<mars-campus-repo>`, primarily `viewer/`.
Local Git only: never push or add remotes. Preserve branches, worktrees and other
agents' changes. Small reviewed commits, author genekogan, established co-author.
Historical content has separate ownership; never invent historical facts and label
hypothetical scenes. Retain deterministic fixed DT=1/20s, strip-types TypeScript,
zod-only engine dependencies, deterministic core math and named diagnostics.
Focused tests and actual inspected captures during development; established full
gate on the combined release candidate before main integration; deploy meaningful
green milestones through RELEASE_CHECKLIST. Change goldens only after explaining
and verifying intended behavior. Batch compatible validation; do not remove checks.

## Document authority

- `ACTIVE_ROADMAP.md`: current experience, small queue, acceptance and preferences.
- `RAINY_DAY_BACKLOG.md`: authoritative current disposition of every original ID.
- `LAST_MILE.md`: retained original descriptions, provenance and historical rulings.
- `PROGRESS.md` and brief reports: dated evidence, checkpoints and limitations.

Reports lead with what is playable/visible, scenario status, awkward or impossible
behavior, the next blocker, deliberate deferrals, validation/release, and material
scope/cost concerns. A good playable milestone outranks a perfect old checklist score.

## Future-facing reference

[SIMULATION_FRONTIER.md](SIMULATION_FRONTIER.md) preserves the 2026-09-30 owner
discussion of multi-day projects, relationships, shared intentions and persistent
consequences. [SIMULATION_FRONTIER_APPLICATIONS.md](SIMULATION_FRONTIER_APPLICATIONS.md)
distinguishes proposed Mars scenarios from reusable mechanisms and broader Eden
world possibilities. These references do not expand the current active tranche.
