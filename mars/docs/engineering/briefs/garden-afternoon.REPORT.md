# Garden and reading afternoon candidate

Base `0081ad9f08a06a336ace9597f8a7360d21c3ed39`; isolated worktree `<mars-worktrees>/garden-afternoon`, branch `codex/garden-afternoon`. Only five assigned new paths changed. Saved candidate, not deployed or visually accepted.

## Supported experience

Two ordinary registered living intentions in a hypothetical anonymous ground fixture. The gardener takes the existing finite seed-bowl (initial .5), deposits .25 in planter-a, returns the same bowl, walks independently to the courtyard and waters the same bed with .25 from a separate finite water-bowl (initial .5). Both bowls return to declared original slots. The other staged plot remains empty.

The reader reads four seconds of a stable 24-second task on book, safely releases the chair, walks independently to the courtyard and returns to the same unfinished book/task to finish. These nearby walks are separate ordinary walks, not a shared walk or claimed conversation. A conversation between independently interruptible branches would require extra cross-branch policy and was cut from this bound.

Partial sowing is exposed through local Pause/player direction followed by explicit Resume. Finite seed progress correctly refuses seconds slicing; the authored planting objective completes unless interrupted. The actual original actor/source/return slot/purpose remain authoritative; completed material is a checkpoint and cannot become a new source. Markers represent deposited material, not seedlings/growth. End stops that branch permanently within this afternoon, retaining effects; it cannot be Resumed. Reset stages a fresh world.

Both yaw0/pi2 fixtures share mechanisms. Ordinary leaves own motion, hands, routes, support, chair release and safe cleanup. No new rig/poses, terrain, replacement props, refill, washing, deletion, growth, dialogue generation or active save/load.

## Integration API

- gardenAfternoonWorld(angle=0), gardenAfternoonScene(), gardenAfternoonRuntime(angle=0).
- gardenAfternoonBindings(angle=0): fixed gardener/reader LivingIntentionParams.
- gardenAfternoonDirection(branch,angle=0): safe ordinary player walk parameters.
- startGardenAfternoon(rt,angle=0): preflights both logical branches before dispatch; leaf failures remain bounded intention waits.
- controlGardenAfternoon(rt,'gardener'|'reader','pause'|'resume'|'end'): same registered control.
- readGardenAfternoon(rt): detached actual branch IDs, active/status/intention readouts, current seed leaf and concrete cleanup/leaf diagnostic, actual seedbed/garden/book, complete same-ID seed/water bowls and bookEntity with pose/support/contents. Overall active includes draining/ending; completed requires both intentions truly completed, otherwise terminal ended.
- GardenAfternoonHud({sim,refresh}): visible only garden-afternoon/garden-afternoon-rotated; authoritative controls rechecked at click time, runtime/epoch freshness and pending-control/walk guards. Local Pause leaves the other branch progressing; global Pause freezes time.

Root owns shared registry/rules/selector/panel/camera wiring. No custom tick coordinator. Read-only hook needed: gardenAfternoon: () => readGardenAfternoon(sim.rt) ?? null. Existing seedMarkers/records/heldItems/slots/humanFields/bones/cameraEntities supply other evidence. No logical claim/mutation hook.

## Checks and remaining acceptance

10 new Node cases pass: complete chains in both orientations; partial Pause/direction/Resume in both; reader directive preserves bookmark while gardener finishes independently; unavailable source bounded retry/no failed children; rapid Pause/End before first tick; partial End preserves effects and refuses resurrection; exact deterministic replay; blocked cleanup preserves actual held ownership until support intervention.

Combined garden-afternoon + planting-intention + seed-planting + original living-intention: **68/68 PASS**, approximately1.65s. Per-tick finite seed/water conservation and zero invariant violations. Terminal item/actor/hand/routine claims and supported bowl returns checked. Viewer TSC, focused oxlint, oxfmt/diff checks pass.

Two strict actual Play cases authored with original harness limits:120s/case,15s waits/assertions,zero retries. Fresh Reset/readiness Step only; journey uses actual Play. Planned durable PNG/a11y/JSON captures show partial reach/markers, supported safe return with independent reader progress, same unfinished book return, reader local Pause, final finite care/book completion, End before first step and Reset. Receipts record actual Git HEAD. Camera moves observe actual seed/book positions only.

**Browser/performance/full gate not run**, as root owns serialized slot; selector/hook/panel wiring is absent here. Authored Play cases are not claimed passing. Physical clipping/fine fingers/sparse gestures need root inspection of actual captures; Node invariants do not establish visual quality.


## Actual Play failure and cause-specific acceptance repair

Root's frozen `cea39b5eff0e4ec874d47308a74576084bf89926` serial batch produced
11 PASS / 4 FAIL, including both garden orientations. Both failed the same final
`wait(page, 'completed')` at garden-afternoon.spec.ts:275, helper:94, with the
original 15-second timeout. Earlier partial sowing, safe Pause/direction, independent
reader advance, same-book return and local reader Pause captures succeeded.

The default failure receipt showed tick 1000 / 50 simulated seconds: original seed
purpose a3 completed with .25 deposited, same book completed 24 seconds, gardener
water-care child a30 walking with the finite water bowl; zero violations and no
leaf diagnostic. Reader Resume was tick 398, resumed seed returned tick 688, care
started tick 825. Rotated failure was tick 1078 / 53.9 seconds: same completed seed
purpose a3/.25 and book 24, gardener care child a31 taking/walking; zero violations
and no leaf diagnostic. Reader Resume tick 475, resumed seed return tick 913, care
start tick 1050. The single completion deadline covered remaining seed handling,
authored courtyard walk and all subsequent finite water handling. Runtime evidence
showed normal physical progress, not a support/refusal/invariant failure.

The test-only repair adds two serial meaningful checkpoints after reader Resume:
actual completed seedbed plus original seed-bowl supported on its declared return
slot; then an actual partial finite water deposit during ordinary watering with
same water-bowl ownership. Both get durable PNG/a11y/actual-HEAD JSON captures,
conservation checks and exact purpose/entity/support assertions. The final
completion and all previous outcomes/cleanup checks remain required. No timeout,
speed, layout, action duration, tolerance or outcome was changed: 120 seconds whole
case, 15 seconds per phase/assertion, zero retries. This uses the original bounded
phase harness for distinct physical obligations and improves later-care evidence.

Read-only failure receipt: frozen viewer's ignored
`.cloudflare/garden-afternoon-play-failure-analysis.json`. Trace/error-context and
JSON evidence were inspected without browser reruns or tracked frozen edits.
Repair candidate is separate worktree `codex/garden-afternoon-play-repair` from
cea39b5; only spec and this report changed. TypeScript, focused lint, formatting
and diff checks pass. Root will run serialized actual Play and inspect captures;
no passing-browser or visual-quality claim is made for this repair.
