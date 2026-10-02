# Art-sharing HUD

Built from creative-afternoon source5bc3c66 in isolated worktree
`<mars-worktrees>/art-sharing-hud`, branch `codex/art-sharing-hud`.
Only the new `viewer/app/lab/art-sharing-hud.tsx` and this report are owned.

Exports `ArtSharingHud({sim,refresh})`, matching other Lab HUD props/classes.
Root must import/mount it in the shared panel, with scenarioEpoch as its key for
fresh feedback on Reset. Root owns hooks, presets, engine and browser proof.

Visible only for `art-sharing` and `creative-afternoon`. Standalone Start calls
`artSharingBinding()` and the authoritative `art_sharing` action. It clearly
labels the existing pre-made hypothetical study. Combined afternoons have no
independent Start; the latest retained `art_sharing` record supplies the existing
child session, whose pad was drawn earlier by the combined experience. Failed
admission records expose diagnostics without replacing retained session state.

Readouts show the actual pad ID, retained completed mark count/progress/status/task,
supported table/slot, elapsed discussion time, real floor/turn/attention, pending
question, role membership/physical viewing and retained contribution/answer history.
Completed versus ended-early messages follow `finished`; no imagined contributions,
marks, direct actor movement or new renderer/camera controller are created.

Each role exposes Ask/Answer/Floor; visitors additionally expose Join/Leave,
including the declared late `art-visitor3`. Pause/Resume/End target only the actual
active session. Exact enabled-state checks call `artSharingControl.plan` in
addition to current lifecycle/physical-viewing checks, so engine question, answer,
queue, ownership, artifact and route constraints remain authoritative. Pending
control records temporarily disable another submission until Play processes it;
this prevents the HUD from queuing actions against draining/ended sessions.
Click-time registered admission rechecks all requirements.

Leave sends the existing `leave` intent with ordinary bounded departure targets:
visitor1(-4,-4), visitor2(4,-4), visitor3(4,4). The engine performs safe hold release
and ordinary walking. Resume operates in the same runtime on retained discussion;
active reload/save-load remains deferred. Engine state is never hand-edited.

Verification: viewer `npm run typecheck` and focused
`node_modules/.bin/oxlint app/lab/art-sharing-hud.tsx` pass. Formatting and diff
checks pass. Dependencies were symlinked from main, never installed. No browser,
performance or full gate run overlaps root's release37 validation. UI integration,
actual Play/capture review and combined release validation remain unproved here.
No engine API gap or shared-file change was required.
