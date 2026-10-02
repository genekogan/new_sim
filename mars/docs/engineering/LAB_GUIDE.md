# Lab play and inspection guide

Current public baseline is release35. **Living days, garden care, dance and expanded
camera observations below are a locally tested candidate until the new combined
release/public receipt is recorded.** Deployment truth is `viewer/deploy/deployment.json`.
The final entry target is `https://sim.mars.college/lab`; the existing Worker `/lab`
is the same application. Do not recreate the removed mars.college/simulation page.
The [release5 guide](archive/LAB_GUIDE_release5.md) is preserved as historical evidence.

## Begin

Choose a Scenario in `/lab`, or use its Quick tour. Play advances authoritative
20Hz simulation; Step advances one fixed tick; Pause freezes the whole world.
Speed changes playback rate, not timestep. Reset or loading another scenario
replaces the current world, including all retained intentions and object states.
Continuous activity presets require their own Start control. Scripted movement
and construction presets start their sequence through Play.

Individual Pause/Interrupt requests safe physical cleanup while others continue.
Keep Play running until cleanup finishes. Resume is explicit after intervention.
Director/player commands use the same admission, claims, support and execution;
refusal explains the named resource or geometry. End retains partial effects and
releases resources safely; it does not claim unfinished purposes completed.
No active save/load or reload-restoration guarantee is provided.

## Combined runs

| Selector name | What to initiate and watch | Supported variation |
| --- | --- | --- |
| `living-day-4`, `living-day-studio` | Start connected day: notes → gathering/questions/rotation/conversations → shared walk → cold preparation/two servings → sleep → same unfinished notes. Reader and carer have separate schedules; music/dance begins during rest. | Original worker or project assistant; room/auxiliary computer preferences with explicitly allowed alternative; Mars classroom or hypothetical independent studio. |
| `prepared-day-4`, `prepared-day-8`, `prepared-day-studio` | Start notes, interrupt after progress, Start session, then Start purposeful routine during presentations. Optional attendee continuations retain separate discussion/follow-up work. | Authored room sizes/environment; eight-guest side layout requires physical setup described in the tour. |
| `work-break-4`, `work-break-8` | Work, talks, shared food, quiet rest and return to the original project; separate guest continuations. | Two authored gathering sizes and furniture layouts. |
| `design-studio` | Critique, questions, shared food and return to continuing projects. | Reuse of the same activity/object mechanisms in a non-Mars room. |

Living-day controls show each person's purpose, progress, waiting reason and
completed/skipped blocks. Pause/direct the reader while plant care continues;
Resume retains the same bookmark. Pause the main routine during preparation or
sleep; Resume retains deposits and the same rest purpose. Music has separate
Pause/Resume and audio controls. A refused day transition requires intervention
and explicit Retry. An ended required commitment yields an explicitly ended
partial day; Reset stages another one. Bindings are bounded authored choices,
not arbitrary people/equipment, autonomous needs or a universal planner.

## Individual activities and objects

| Selector | Meaningful interaction | Bounded contract |
| --- | --- | --- |
| `classroom-4`, `classroom-8` | Audience approaches real seats, host/presenter floor, questions, rotation, smaller conversations, late joining/leaving. Move spare chair/cleared table and use the new arrangement. | Two authored ground layouts; occupied/reserved/hands-full furniture moves refuse. Table contents must be explicitly removed. |
| `quiet-reading` | Seated reading and retained bookmark, player direction and explicit Resume. | Same flat book on grounded table; no held-book reading. |
| `computer-music` | Seated performance, listeners and audible original score. | Enable sound through browser gesture; interrupted score retained, no acoustic instrument simulation. |
| `music-dance` | Performer, seated listener and two invited dance places; late Join/Leave, attention, independent player directions. | Planted ground stance and rhythmic arms, not travelling choreography. Safe pause retains score and departures; same bound places on Resume. |
| `garden-care` | Pick up the same finite water bowl, approach planter, reach/deposit water, return bowl; interrupt/resume and recurring care. | Ground planter, four total quarter-bowl cycles; care state and due time, no fluid/growth/refill simulation. |
| `tabletop-chess` | Two physical players take turns moving the same pieces; captured pieces remain in tray. | Standing tabletop play; no castling or physical promotion. Select proposed moves for different games. |
| `cold-preparation`, `cold-preparation-rotated` | Transfer two finite ingredients and mix the same pot; retained deposits, serve/eat and return utensils. | One cold recipe, two servings, grounded table; no heat/chopping. |
| `ground-sleep`, `ground-sleep-rotated` | Approach mat, lie down, rest, wake; safe interruption and retained elapsed rest. | Flat grounded mat and current rigs; no bed or rig migration. |

All new staging/participants are hypothetical, not historical reconstruction.
Objects retain identity/support/ownership; a visible prop alone is not a capability.
Fine fingers/clothing and planted dance expression remain current-animation limits.

## Camera and sound

Live camera supports classroom, prepared/living days, garden care and music/dance.
Choose Clear activity coverage or Restrained observation. It reads actual people,
objects and phase facts; it never moves actors or owns their tasks. Follow activity
person (Follow guest2 in classroom) takes operator precedence. Return camera to auto
releases it. Dragging the view also takes temporary operator control. Manual control expires
after six simulation seconds; while paused, that clock does not advance. Escape
or Return camera to auto releases it immediately. Global Pause
freezes simulation; camera attachment must not mutate world/tick.

Clear favors readable action; Restrained holds wider/longer coverage. These are
bounded procedural editorial policies, not a human cinematographer or guaranteed
close-up of every simultaneous event. Camera replay links are recorded demonstrations,
not a second playable world. Enable sound requires a browser gesture; global Pause,
Reset and disposed sessions silence audio. Music remains physically usable muted.

## Diagnostics, probes and historical builds

Movement presets cover wall/U-trap/narrow passage/stairs/deck, mid-walk obstruction,
three walkers and continuous stress. `incomplete-stairs` intentionally refuses
with `route.link-unusable`; this never excuses invariant violations.

`body` is a renderer Reach measurement probe with an explicit synthetic/authoritative
contract in its controls. Fresh load, Reset and first Step must be coherent. It is
not evidence that arbitrary anatomy/interaction poses are valid.

Year walkabouts use the loaded historical obstacle scene. Current 2022 first-bay
and whole-house scenarios validate staging admission. If required current content
is unsupported, they name omitted/blocking entities and do not start physical work.
Supported current whole-house completion has separate executed browser coverage;
old W51 FIXME fixtures remain unproved and must never be cited as passing evidence.
Material pile/component identity and appearance continuity are engine/renderer
contracts; historical colors/geometry must not be changed to conceal a defect.

## Inspect and develop

Overlays expose routes, clearance, actor/obstacle footprints, levels/stairs, slots,
phases and violations. Logs distinguish requested/validated/reserved/executing/
completed from blocked waits, refusals and cancellation. Red invariant/error banners
are actionable; intentional diagnostic demonstrations are explicitly labeled.

`window.__marsEngine` offers scenario loading, fixed stepping, detached records/world,
violations, intention/day/garden readouts and camera facts. Programmatic stepping
is useful but does not establish natural rendering or automatic Play timing.
The selector startup audit passed fresh-load/Reset/first-Step for all45
selectable presets (46cases including parity,198.9s); it is deliberately not completion evidence. See [current evidence index](INDEX.md).

Local: `cd viewer && npm run dev`, then `/lab`. Contributor rules:
[ENGINE_GUIDE](ENGINE_GUIDE.md). Required clean combined integration:
[release checklist](RELEASE_CHECKLIST.md). MCP/director commands use the same runtime;
see `/simulation-agent-guide.md` and `viewer/deploy/README.md`. Never Git push/add a remote.
