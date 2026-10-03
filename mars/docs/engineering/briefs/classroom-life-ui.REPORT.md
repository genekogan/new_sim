# Classroom life UI checkpoint

Source: `d47786b`, branch `codex/classroom-life-ui`, raise-cancel checkout. Local Git only; integration and release gate remain with the lead.

## Delivered

Lab exposes all world humans, authoritative audience joining with explicit departure, disabled questions until actual seating, leaving, and courtyard directives. The original classroom audience-seat lists remain unchanged. New visitor (-7,10), worker (8,-6), workstation (6,-5), and compatible work chair (6,-6.2), yaw 0, support transitions between work and class.

`WORKSTATION_ACTIONS` is registered in the common engine. Activities rules version advances from 1 to 2: bound plans carrying the old rules version must rebind. No physics golden was changed.

Work controls request the existing 30-second Sketch notes action, safely interrupt it, and explicitly resume the same actor/task/duration. The HUD shows unfinished progress, arrival/stand-up waits, and named refusal diagnostics. Directing the selected human to the courtyard works without a classroom session and uses the authoritative walk action.

The generic composite renderer follows the catalog dimensions: 1.4m desk width, .74m desktop height, 1.3m overall height, .75m depth. Monitor canvas shows actual task/status/progress and updates only when semantic state or rounded progress changes. It introduces no actor movement or pose controller.

## Checks and evidence

- Focused TypeScript check and oxlint pass.
- Classroom coordinator/workstation tests: 30/30 pass; classroom map/joining tests: 11/11 pass.
- Final isolated browser run `classroom-life-2026-09-30-final`, port 5495: 3/3 pass. Worker works, interrupts, joins, leaves, resumes; late visitor actually seats. Courtyard directive safely interrupts work without a session. Separate visual journey captures seated and resumed active work.
- Browser assertions reject failed action records and invariant violations. Main journey ends without claimed interaction slots; workstation and worker claims release on completion. Directive journey verifies workstation/actor/seat claims all release. Resume starts at or above saved elapsed time and completes with the same worker, Sketch notes task, and 30-second duration.
- Final identity/claim assertion run `classroom-life-2026-09-30-final-identity`, port 5495: 2/2 pass, strengthening completed task/user/duration and directive claim checks.

Initial browser attempts exposed test pacing mistakes: join was attempted during arrival and later during presenter rotation. Tests now wait for advertised presenting/question admission before clicking join. No runtime assertions or movement tolerances were relaxed.

Captures inspected locally (absolute artifact directory `<mars-worktrees>/raise-cancel/viewer/e2e/artifacts/`):

- `classroom-life-2026-09-30-visual/workstation-seated-clear.png`
- `classroom-life-2026-09-30-visual/workstation-resumed-clear.png`
- `classroom-life-2026-09-30-attempt3/classroom-visitor-joined.png`

The clear workstation captures show unobscured seated body, chair, desk and live monitor progress (10% then 12%), without major visible clipping at this distance. Hands rest on the lap: this supports reading/quiet seated work, not typing precision. Final run repeats these capture names and stores JSON proof for the three journeys. Browser server teardown completes after each run.

## Smallest supported scope

Fixed ground-floor Lab arrangements and one nearby compatible chair; no access links, hand typing animation, autonomous rejoining, or universal object editing. Only one spare classroom seat is available at once; the worker leaves before the visitor joins. Joining waits for current coordinator admission controls. Work continuity is explicit and same-user/task/duration. No browser full gate, deployment, shared roadmap, historical scenario, or golden edits.
