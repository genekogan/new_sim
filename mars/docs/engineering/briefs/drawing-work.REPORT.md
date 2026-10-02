# Bounded drawing work — implementation report

Source inheritance: `codex/drawing-work`, isolated worktree forked from
`codex/activity-vocabulary` checkpoint `a509b65`. No shared registry, catalog,
world types, renderer, Lab, historical content, camera or browser files changed.

## Usable interaction

`drawing_work` accepts `{ actor, pad, pencil, returnSlot, task?, resume? }`.
One idle ground actor uses an existing `drawing-pencil` and `drawing-pad` on a
flat, grounded `table-6ft`. The pad occupies one real surface slot; the pencil
has a separate real return slot on that same table. Ordinary `take_item` grasps
the same pencil, `walk_to` approaches the supported pad, the existing right-hand
reach contract sweeps eight connected strokes, and ordinary `put_item` returns
the same pencil. No new entities, replacement tools, teleport, new rig or anatomy
controller are introduced. The pencil's bottom tip lies at the pad top while its
hand grip is 0.08 m above it.

Eight seconds of fixed-step strokes produce a bounded hypothetical shelter
study. Pad `equipment.kind = 'drawing'` retains primitive `drawTicks`, user,
task, pencil ID and status. Safe cancellation before grasp or mid-stroke drains
children, smoothly withdraws the existing hand, returns the pencil and retains
exact partial progress. Explicit same-user/task/pencil `resume: true` continues
that same pad. A completed pad refuses erasure/new work. Ordinary competing walk
directives preempt through this same safe-release path.

A blocked return stays blocked, names the actual obstruction, retains held tool
ownership and committed marks, and retries when the obstruction is explicitly
removed. It does not create a stream of failed child records or spawn a tool.
Physically deleting/moving externally owned resources can require explicit
resource repair; the activity cannot fabricate a safe return support.

## Integration API

- `world/catalog-drawing.ts`: `DRAWING_ASSETS` for canonical CATALOG registration.
- `activities/drawing.ts`: `drawingWork`, `DRAWING_ACTIONS`, `DrawingWorkParams`.
- `objects/drawing.ts`: `readDrawing`, `DrawingReadout`, `DRAWING_MARKS`,
  `DRAWING_MARK_TICKS`, `DRAWING_TOTAL_TICKS`, support diagnostic/point helpers.
- `scenarios/drawing-work.ts`: `drawingWorkScene()`, `drawingWorkWorld()`,
  `drawingWorkParams()`, `drawingWorkRuntime()`.

The scenario runtime filters canonical action registrations before adding local
extras, so it also works once root integrates `DRAWING_ACTIONS`. Its world builder
requires CATALOG asset registration; focused tests register those assets locally.

`readDrawing(rt, pad)` is detached and exposes actual `id`, `pad`, `pencil`,
`task`, `user`, `action`, `status`, `phase`, `ticks`, `progress`, `totalMarks`,
`completedMarks` and `activeMark { index, progress, points }`. Mark points are
pad-local metres in x/z, ready to transform by the actual pad pose at its top
height 0.012 m. The returned arrays do not alias authoritative state. Completed
marks remain visible after action release; partial stroke progress also persists.

## Provenance and limits

General practice inspiration only:
`~/Mars/docs/archive/events/drawing-klerb-2024-01-12.md` describes a
recurring low-pressure drawing club. This feature does not reenact that event.
All staging, anonymous participant, pencil, pad, timings and generated artwork
are explicitly hypothetical. No historical participant/placement claim is made.

Bounded to one grounded tabletop setup and current supported hand points; no
universal drawing tool, freehand input, material consumption, art history,
psychology, seated drawing, tool handoff, new anatomy or active save/load proof.
Root owns registry/catalog exports, renderer marks, Lab/browser review, combined
gate and release publication. No browser, performance run or full gate was run
in this isolated worker.

## Focused validation

`node --test engine/test/drawing.test.ts`: 10 passing tests, zero failures,
skips or TODOs. Covers actual take/walk/put sequence, moving stroke points,
same identities and flat pad support, detached arrays, retained exact partial
strokes, explicit resume, competing walk intervention, deterministic state and
record replay, missing/wrong/unsupported/unavailable/occupied resources,
occupied hands, moved pad, cancellation before grasp, a blocked table naming its
obstacle, and recoverable occupied return. Completed and drained disruption runs
assert zero ENGINE_INVARIANTS violations and released actor/hand/entity/surface
reservations.

Viewer `npm run typecheck` and focused oxlint over the five TypeScript files pass.
Initial authoring command used the wrong cwd (no files written); an initial
blocked-table test used a nonexistent spatial invalidation API. Both were fixed
before the final passing checks. No dependency installs, remotes or pushes.
