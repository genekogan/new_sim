# Active roadmap

Owner direction: [SIMULATION_VISION.md](SIMULATION_VISION.md), 2026-09-29.
Current product milestone: **a playable classroom that becomes lightning talks,
questions and smaller conversations**. Preferences confirmed: semi-planned events with adaptable execution and live
intervention; advance complete experiences / activity-object breadth / social
believability together at approximately **50 /30 /20**. Continue in **/lab** with
simple configurable maps; historical Studio remains the museum side.

## Small active queue

| Deliverable | Ownership / model | Acceptance | Dependency / stop condition |
|---|---|---|---|
| Preserve inventory and durable direction | Lead; Luna audits original IDs | All 216 IDs recoverable; candidate work distinguished from released work; exact worktrees/WIP retained | One bounded planning pass; no broad doc cleanup |
| Classroom activity coordination | Sol implementation, lead architecture/review | Actual seating/role binding, explicit attention and questions, presenter rotation, coherent departure/interruption/cleanup in two arrangements | Existing release13 social actions; surface large missing prerequisites |
| Play controls, meaningful display and visible attention | Lead plus GPT-6.1 Sol bounded worker | Start/intervene while running; clearly communicate speaker, listeners, phase and waiting reason | Confirmed /lab direction + coordinator interface; no universal editor |
| Combined validation and release | Lead | Focused disruptions/captures, full established gate, production checks and release record | Review compatible near-complete changes; preserve failing deferred requirements |

## First supported experience

Begin with existing camp chairs/benches and a clearly hypothetical gathering space.
Two presenters and a small audience should arrive, take usable places, attend a
presentation, ask/answer a question, rotate presenters and transition into small
conversations. A display has explicit available/active/content state, rather than
being a decorative mesh. Required equipment cannot silently be substituted.

Player/director commands use the same Runtime and resource rules. The player can
intervene during the session and see what was interrupted and whether someone plans
to return. Add one intervention at a time; do not promise a complete life simulator
from the first classroom. Constrained furniture arrangements are acceptable initially.

Representative checks: two layouts/audience sizes, occupied seats, a late arrival,
missing/unavailable display, blocked route, departure, directed interruption and
resumption. Feasible sessions finish; infeasible sessions wait with reason, refuse
before commitment, or end with coherent cleanup. No leaked resources, unsupported
objects, forced teleports or permanently stranded people. Inspect actual runtime
captures to assess shared attention and pacing.

## Current baseline and preserved work

Production remains **release13**, main `3bd40f2`, deployed version
`3b93cbd2-bc84-4484-a3e8-21705a069b25`. Last shipped accounting was 38 fixed /
36 reclassified /142 remaining; this is historical release accounting, not a count
of untouched current work. Main also contains another agent's uncommitted historical
reconstruction changes; do not overwrite them.

The old combined candidate is preserved on branch `codex/wave2-consolidation` at
`ec3aa6f`. The studio-integration checkout now hosts the new classroom branch. It includes useful unreleased work and unresolved
baseline/construction failures; it is not a green release. A classroom branch starts
from stable main so specialized construction fidelity does not become a dependency.
Compatible useful work can be selected with explicit provenance and the full gate.

Finished current row: LM-117 bounded step-and-turn dance candidate `2af7a67`
(integration `ec3aa6f`), five party checks, combined social checks, inspected browser
1/1, typecheck/lint. It remains awaiting release and is narrower than expressive
party animation. See `briefs/party.REPORT.md`.

Preserved exact item entry: `codex/item-entry-bridge`, `deadlock-tails`, HEAD52286a0
plus uncommitted files. See its `briefs/item-entry.REPORT.md`. Source-hold exit/guard
is incomplete: do not merge it merely because fine finger fidelity is deferred.
Existing standalone supported item placement is available for a constrained classroom.

Exact beam/joist contact, complex stair carrying, detailed vehicle recovery,
automatic cinematography refinements and broad evidence cleanup are deferred unless
a conspicuous failure in the featured experience makes them necessary. Their
individual dispositions and promotion triggers belong in RAINY_DAY_BACKLOG.

## Next increments

After the classroom is usable: communal day with rest/work/food/social continuity,
then reuse the activity/capability model in a gallery, workshop or office. Introduce
needs/interests/relationships and additional assets only as those experiences demand.

## Current implementation checkpoint

The combined classroom candidate now implements two usable /lab arrangements, typed activity controls/readout, real display state and head attention. Focused coordinator19/object4/map5/claim1 and browser2/2 pass; final four captures inspected. Full gate/main integration/release are next. Initial constraints: ground-only, fixed furniture, explicit refusal for held objects/required missing equipment; departure excludes membership, no join/resume yet. Next experience work should add continuity/rejoining and richer shared attention while introducing useful individual workstation interaction, retaining the confirmed50/30/20 balance.
