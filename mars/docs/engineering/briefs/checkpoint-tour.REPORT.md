# Checkpoint quick tour

2026-09-29 · branch `codex/checkpoint-tour` · base `2da734f`.

The Lab panel now exposes two hypothetical classroom launch buttons near its top,
followed by a native expandable quick tour. Loading a room explicitly resets the
current world. The guide directs the owner to the existing live controls for
talks/questions/presenter rotation/conversations, interrupted workstation return,
explicit bowl/spoon preparation, chair move/cancel/reseat and two-person empty
table movement/use. It also links the optional live camera review and clearly
labels the six-scene camera suite as recorded replay rather than a playable world.

## Files and scope

- `viewer/app/lab/checkpoint-tour.tsx`: compact discovery component. Native
  buttons, heading/labelled section, details/summary and links; no duplicate
  action execution, simulation, controller, tour engine or assets. Calls only
  the existing `onScenario` loader using verified IDs `classroom-4` and
  `classroom-8`. Camera links use the selected classroom or default to four guests.
- `viewer/app/lab/panel.tsx`: import and top-of-panel placement only.

Source review checked scenario IDs, control labels and classroom phases against
the existing classroom, fixture-move and belongings HUDs. Table control labels,
crew choice and cleared-table return sequence came from the lead's separately
verified two-person table UI checkpoint. The table engine/UI and recorded camera
entry are parallel release dependencies, not implemented on this branch.

## Validation

Commands from this branch's `viewer/`, both exit 0:

```sh
npx tsc --noEmit -p .
npx oxlint app/lab/panel.tsx app/lab/checkpoint-tour.tsx
```

`git diff --check` passed. Manual source review confirmed that the tour imports
no engine/runtime module and changes no world state except through the existing
scenario loader. Native controls remain keyboard operable; expanding the guide
does not execute actions. No tests or pinned values were changed.

The assigned acceptance deliberately reserves actual browser captures, engine
tests, full gate, camera-entry verification and deployment for the lead's combined
candidate. None were run or claimed here. No browser captures inspected.

## Remaining integration work

Integrate alongside the table UI and camera replay packaging, then verify the
top-panel layout/keyboard discovery and both links in the combined browser build.
No shared `ClassroomHud` edits needed. Approximately 10 minutes implementation,
source review and validation; token use not measured.

Root fullgate caught global nonclassroom screenshot changes. Tour is narrowed to classroom4/8; no baseline or tolerance edits. Firstred/partialgate and traces retained. Representative historical/fire and classroom discovery checks rerun beforecombinedfullgate.
