# Paired regroup continuity — focused combined candidate, unreleased

2026-10-01. Own detached worktree `<mars-worktrees>/paired-regroup-continuity`, base `879c88ac0354b47eee81ce766401160d2503753d`. No commits, main/release worktree edits, browser, gate, deployment, camera/rig, historical assets, walker/Runtime or generalized coordination changes.

## Recovery and preservation

Recovered only `viewer/engine/activities/paired-walk.ts` and `viewer/engine/test/paired-walk.test.ts` from reviewed clean core `5fcf1ff` (selected via root `248c626`). Byte-copied these enumerated parent draft paths solely for local combined testing from `paired-day-lab`: `viewer/app/lab/activity-example.ts`, `viewer/app/lab/purposeful-routine-hud.tsx`, `viewer/e2e/purposeful-routine.spec.ts`, `viewer/engine/activities/index.ts`, `viewer/engine/activities/purposeful-routine.ts`, `viewer/engine/api/registry.ts`, `viewer/engine/test/design-studio.test.ts`, `viewer/engine/test/purposeful-routine.test.ts`, and `viewer/engine/scenarios/paired-meal-walk.ts`. Read the original paired-day and paired-break reports; did not overwrite them. All nine original draft hashes still match after testing. The separate dirty paired-break source/tests/report remain untouched.

Exact source SHA manifest: `viewer/.cloudflare/paired-regroup/copied-source-sha256.json`; preservation verification: `source-preservation-check.json`. Dependency symlink points to checkpoint's existing `viewer/node_modules`. Parent-owned copied paths are not this worker's changes and must not be committed as worker-owned files.

## Cause and bounded correction

The clean core combined with the parent's actual studio journey reproduces the reported failure: the project editor's ordinary child `a58` encounters `traffic.person` naming `form-reviewer` during regroup, while the separately owned reviewer discussion continues. The prior pair coordinator treated every blocked child as terminal and cancelled it before the existing ordinary walker could recover. Pair grace/readout is observable at tick 2972; the old routine propagated sticky waiting at tick 2973.

Applied the previously drafted narrow activity proposal, without rebuilding the motion system: only an owned ordinary `walk_to` child blocked with exactly `traffic.person`, and only during `regrouping`, remains alive. `paired_walk.regroup-traffic` retains the named underlying cause in authoritative readout. Existing walker recovery continues. Other blocked diagnostics, failed/cancelled children, main paired travel, separation, clearance, drain, foreign directives, admission and explicit retry retain their behavior. The original aggregate physical no-progress clock remains 100 ticks; it resets on actual progress of either pair member, as before. No per-child clock or broader retry policy was added.

Actual combined studio acceptance now retains the same child `a58` and trip `a57`, recovers in 10 ticks from the observed grace state, and completes at tick 5947, zero violations. Observed final state hash `3e8d27d975d4d74079136d3244d9a326466813d237aec45438ebe9ee46cb29b1` is evidence, not a new pin. The same trip jointly arrives, the same meal is served/consumed/returned, the same interrupted notes reach 30 seconds, and reviewer/follow-up continuations complete. No actors were repositioned to hide the interaction.

## Validation

- Before correction: 58 executed / 57 pass / one actual combined studio failure / no skip or TODO, 14.809s. Preserved `before.log`.
- Existing proposal plus unchanged original tests: serial 58/58 pass, 19.803s, no skip/TODO. Preserved `proposal-combined.log`.
- Five added owned-path regressions: actual transient crossing retains the same ordinary child and completes the parent journey; actual traffic Pause then End drains only owned children; actual traffic directive preserves foreign movement/discussion and refuses Resume while busy; deliberate no-progress fault injection preserves the 100-tick bound (102 ticks including dispatch/drain); hard-failed child drains promptly (three ticks including dispatch/child/coordinator). The two clock/hard-failure tests deliberately inject ordinary child step outcomes, matching the existing lag-test technique; they are not claimed as physical persistent-crowd proof.
- Final serial command: `node --test --test-concurrency=1 engine/test/paired-walk.test.ts engine/test/purposeful-routine.test.ts engine/test/design-studio.test.ts` — **63/63 pass**, zero fail/skip/TODO, 21.454s. Includes all original 20 core tests, actual Mars 4/8 departure and lunch/notes journeys, actual independent studio, legacy pair disruption and parent Pause/End/direct-child End safeguards. Preserved `final-combined.log`.
- Scoped type-aware oxlint of the two owned files and viewer TypeScript clean. Preserved `scoped-lint.log` / `tsc.log`.

All logs are under `viewer/.cloudflare/paired-regroup/`. New-regression first RED guessed the already-propagated routine tick 2973 instead of grace observation 2972, and two-tick cleanup instead of the actual three-stage lifecycle; only new harness expectations were corrected. Those RED results remain `new-regressions.log`. Scoped lint then caught an erased-map `unknown` test executor; it was typed `typeof walkTo`. No original assertions, tolerances, physical outcomes or source geometry changed. Final `new-regressions-2.log` and combined result preserve the correction trail.

The previously failed new `take_slot` feeder fixtures were not copied or expanded. No physical persistent-blocker completion claim is made. Parent/UI drafts remain uncommitted and unreleased; browser actual Play and root's combined review/full gate are still necessary before integration/publication. Reviewable deltas from `5fcf1ff` are saved as `paired-walk.ts.patch` / `paired-walk.test.ts.patch` in the ignored proof directory. Owned final files are the two pair paths and this report only.


## Root combined UI review

Actual UI Play3/3PASS30.3s on5493: both Mars4/8 paired lunch paths pause/resume the same trip and continue the same meal/notes; studio actual reviewer crossing waits coherently, ordinary child recovers, pair travels and all original/follow-up purposes finish. One correctedstudio-camera-only rerun1/1PASS15.9s framed the actualpair from their positions rather than leaving them offscreen; root inspected both physicallywalkingcurrentrigs. Initial browser launch3failedbeforetests because root-relativebrowserpath was used; correctedcwdviewer withoutsource/assertion changes and retainedlog. No interaction anatomy/camera-policy edits. Flagshiptakecheck unchangedPASS beforefullgate. Source/visual limits: one authored9.85m groundcorridor,0.9m spacing/freehands, explicitpair and alternatives/refusals; no stairescort, autonomouscompanion choice or arbitrarycorridor solver. ParentUI option is optin, normal routine unchanged. Completecombinedclean gate/main/publication remain pending.

Root scopedlint invocation initially usedrepo-rootcwd and rejectednestedtypeAwareconfig; rerunningfromviewer passed unchanged6files. ViewerTScpassed. Candidate rebased onto receipt9638489 before combinedgate; no pin changes, flagship--check remainsgreen.

## Root integration and release28 proof

Recovered candidate9b85793 rebasedonto9638489; clean combined gate passes206unit,
893engine/0fail/6skip/11TODO and150browser/0fail/7skip, lint/bothTSc/unchanged
take/probe/all36localMCP; interruptednull/cleanupnull. Original worker notes above
remain the focused-review provenance, not current shipment status. MainFF preserves
all89pending owner paths byte-for-byte; no overlapping historical files were changed.
Release28 version657cce5b is100% live from exact9bsource. Published actualPlay
Mars4/8pair2/2PASS16.7s and independentstudio crossing/recovery1/1PASS15.9s.
Root reviewed all7runtimePNG/contactsheet and full walking images. Production
assets/API/director proofs and original performance ceilings pass; see release28
record for scope, transport settings, skips and exact evidence locations.
