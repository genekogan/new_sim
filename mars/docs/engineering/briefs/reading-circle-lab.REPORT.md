# Reading circle HUD and Play authoring

**Future, unshipped candidate; actual Play and visual proof pending.** The isolated
`codex/reading-circle-lab` worktree starts at core commit
`fa0aee4ca0a64627bce3c66f259b84a3e3ee8dbc`. Only the new HUD, e2e spec and this report
belong to this deliverable. Root owns registry, selector, panel, camera/attention,
rig and hook integration. No engine/shared files, historical values or dependencies
were changed; no browser/performance checks were run during the frozen release37
gate.

## HUD contract

`ReadingCircleHud({sim,refresh})` renders only `reading-circle` and
`reading-circle-rotated`. It uses the latest retained registered circle and the
actual same-book readout. It shows status/mode, real elapsed bookmark/page/task/
reader, tabletop support, floor/shared attention, listener roles/membership,
question/answer linkage and effects, prior retained circle summaries and concrete
wait/admission diagnostics. Staging is explicitly hypothetical; generic book and
anonymous people do not reconstruct a historical text or event.

**Start shared reading** submits `reading_circle` with the existing scenario binding. Live
Pause/Resume/End and Ask/Answer/Floor/declared Join/Leave use
`reading_circle_control` and actual plan/lifecycle checks. A later
**Resume unfinished book** explicitly submits a new circle with `resume:true`,
the same reader/task/12-second duration and retained bookmark. It is distinct from
live Resume; prior circle records/effects remain. Completed books cannot silently
restart. Ending after the book completes but before final discussion is reported
as an ended discussion around a completed book, without offering unfinished-book
continuation.

Direct reader away uses ordinary registered `walk_to`; existing directive/yield
hooks own safe standing and the handoff. Reader and listener departure destinations
rotate with the 90-degree preset and remain inside the supported floor. Handler
checks include runtime identity, scenario epoch, pending controls/directions,
current live state and refreshed admission. Feedback is keyed by runtime/epoch;
no delayed effect dispatches after Reset and no private executor or actor/book
mutation is introduced.

## Authored acceptance

Two strict tests retain the established 120-second timeout, one worker and no
retries. They use actual Play at 2x; global Pause freezes inspection/intervention
boundaries. Step checks only fresh Reset/tick 1 readiness, never activity execution.

- Default: capture seated partial reading and real supported listener positions;
  safe Pause retains the exact actual elapsed bookmark/page/task/user and effects;
  declared late Join while paused and explicit Resume restore the same circle.
  Ask from the actual late listener and explicit eligible Answer retain linked
  contributions at the real book's exact bookmark. A requested listener Floor
  produces a real retained comment. Late Leave completes its independent walk and
  persists. Reader direction safely waits with the named reason and unchanged
  bookmark/effects; explicit Resume finishes reading and final discussion, then
  releases physical resources before completion/Reset assertions.
- Rotated: after real question/answer effects and further actual reading, End
  safely preserves an unfinished page/bookmark and prior contributions. Explicit
  new-circle continuation is admitted at that exact bookmark with `resume:true`.
  Actual resumed reading advances monotonically on the same book and reader/task;
  completion retains prior-circle output effects, leaves no claims/held tools/
  tasks/hand drivers, and Reset restores the unused book.

Assertions include fixed book/chair/table identities/poses/support, physical seat
occupancy, current-rig seated support and planted listener talk/listen poses,
authoritative ground height and actual attention, exact retained effects/bookmark,
real final page 4/elapsed 12, all records terminal and no violations or page/console
errors. Contributions compare their bookmark with the actual book readout rather
than fabricating a rounded interval time. Completion waits for both finished and
completed mode, after ordinary stand-up/release.

## Root hook and evidence handoff

Only the agreed read-only `readingCircle(): latest detached readout | null` hook
is needed. A local intersection cast in the spec keeps shared `EngineHook`
untouched until root wires it.

Each execution receipt derives exact source from `git rev-parse HEAD` and records
the run id. The planned six default/four rotated views each save PNG, accessibility
YAML and detached state JSON under `viewer/e2e/artifacts/$E2E_RUN`. Proof/result
JSON also preserves admissions, prior output records, controls, support/entities,
actual body/attention facts, slots, held items, violations and page/console errors.
Standard failure captures/traces preserve failure state. Save runner logs and
personally inspect all real images before claiming visual acceptance; no captures
exist from authoring.

Dependency and browser paths are symlinks to the existing main checkout. The core
worktree had no frozen campus model, so `.glb`/`.br` were copied from the existing
`creative-afternoon` worktree, not symlinked or installed. Root should confirm the
frozen asset source when granting execution. Copied SHA-256: `.glb`
`675f4bebed89d73fb579493e708476f0dfd4c44c0106958a1aad1a92c932a8c4`;
`.br` `36ad67f72f9b1f1678a5293c735b5667cfb8053c3a1f8b6981d6340af436f304`. Do not change shared source, weaken
assertions, or increase timeout without measured failure evidence.

After root grants the serialized browser slot and frozen source, from `viewer/`:

```sh
E2E_VITE_PORT=<assigned> MARS_SIMULATION_PORT=<assigned> E2E_RUN=<fresh-source-run> \
  npm run e2e -- reading-circle.spec.ts --workers=1
```

## Authoring checks and limits

Viewer typecheck, focused type-aware HUD/spec lint, formatting and whitespace diff
checks: PASS. Browser/performance/full gate: deliberately not run. Exact live
controls, timing windows and rendered attention/seated reading remain unverified
until root integration and actual Play. Existing seated reading poses are reused;
no hand-held reading gestures, dialogue text, speech synthesis, reader handoff or
active save/load is claimed.


## First integrated Play diagnosis — October2

Clean ce2213c actualPlay failed both variants at the first seating measurement,
not the authoritative read action. `bones.on` is explicitly the rack-structure
link stood on (`humans.ts`), and ordinary social seating intentionally does not
publish that field. Saved same-book progress, claimed/occupied chair, actual
owned occupied sit child and rendered seated posture were valid. Root and helper
inspected both partial/failure images; the existing crossed-leg sitting variant
remains a visual limitation, not a new posing redesign.

Replace the unrelated rack-link assertion with stricter actual seat claimant/
claim owner, owned occupied sit child, exact seat position, activity/base sit,
zero walk weight, actual .53m chair/pelvis height and original .03m planted-sole
limit. No simulation, renderer, expected outcome, timeout or tolerance change.
Later lifecycle assertions remain mandatory and unproved until fresh actualPlay;
original failures and missing later captures are retained.
