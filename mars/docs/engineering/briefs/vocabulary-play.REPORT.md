# Activity vocabulary actual Play proof

Frozen functional source: `65ee6939cc6d7f9ea01ffb6c64e103a1a7013fea`.
Proof worktree: `<mars-worktrees>/vocabulary-play-proof`, branch
`codex/vocabulary-play-proof`. Its cherry-picked source tree matches root source
exactly (`git diff 65ee693 HEAD` before proof commit had no differences).
The proof owns only the new e2e spec and this report. Dependencies and browser
runtime are symlinked from main; campus.glb and .br were copied from the frozen
activity-vocabulary worktree. No installation, source repair, performance/full
gate, baseline update or public deployment was performed by this proof task.

## Execution and evidence

Command, executed from viewer:

```
E2E_VITE_PORT=5407 MARS_SIMULATION_PORT=8942 E2E_RUN=vocabulary-65ee693 npm run e2e -- activity-vocabulary.spec.ts --workers=1
```

Every activity advances through actual Play at UI speed 2. Step is used only
for the requested initial/Reset first fixed tick; no synchronous runToEnd,
step batches or fabricated pose probes substitute for activity completion.

Evidence folder:
`<mars-worktrees>/vocabulary-play-proof/viewer/e2e/artifacts/vocabulary-65ee693/`.
It contains actual screenshots, accessibility snapshots, detached state/record
JSON, log and a source/hash/inspection manifest. Generated files remain ignored;
retained proof depends on this preserved worktree.

## Result and personal visual review

3/3 tests passed in the fresh repaired-source run (1.2 minutes): drawing12.7s,
warm-up17.9s, jam38.3s. No skipped assertions. All three assert zero page/console
errors, zero accumulated invariant violations, initial/Reset first tick and clean
physical resources. Own spec focused oxlint and source `npm run typecheck` pass.

Ten fresh actual PNGs were personally inspected individually, not inferred from
readout JSON: drawing held-pencil, retained partial-pad and completed-eight-marks;
warm-up five-independent-phases, safe-pause-clock-retained and complete-released;
jam first-performer-real-station, directive-retained-score, physical-performer-handoff
and second-performer-same-computer. Close pad views show the actual shelter outline
and partial stroke; the renderer draws eight retained segments, including an
intentionally overlapping segment, so eight marks need not be eight visually
separate lines. Warm-up views show all five people, different arm phases and arms
at rest after Pause/completion. Jam views show first performer seated, safe directed
vacancy, ordinary first exit and the second performer seated at the same equipment.
The repaired jam views have no failed-action red banner. `index.html` is a gallery,
`manifest.json` records source/assets/capture hashes and explicit inspection, and
proof/final-evidence JSON preserves lifecycle, identities, marks, history and audio.

## Failure provenance

The initial `a711aaf401a88aa1b64fe055664b8286422278bc` run passed drawing but
failed two strict assertions: warm-up clock advanced one DT after requesting
Pause, and rapid Leave dance floor → Direct performer refused the still-queued
Leave after the gathering stopped. Seven actual initial captures were inspected.
Trace/error contexts and log are preserved under sibling
`vocabulary-a711aaf/failed-first/`; the red named jam refusal is visible in its
captures. Root repaired accepted intent timing at ActionDef.start and idempotent
physical cleanup in65ee693. The strict assertions and rapid action order remain
unchanged; commands were not reordered to hide the supported interaction race.

A launch from the repository root using npm --prefix failed before any browser
opened because its relative .pw-browsers resolved against the root. The diagnostic
is preserved under `vocabulary-65ee693/boot-cwd-failure/`. The actual proof command
above runs from viewer and uses the existing browser runtime; no install followed.

## Bounded claims

Drawing covers original pen/pad identity and support, actual held pencil and
rendered palm readout, exact retained partial ticks/committed and partial marks,
Resume to eight visible marks and ordinary return to the same table pose.
Warm-up covers five independently arriving current rigs with hand-driver and
reach-ratio assertions, actual shared attention and distinct phases, follower
Leave/Join, exact pause clock and Resume binding, natural completion and physical
resource cleanup. Open jam covers real audio RMS, actual chair occupancy by both
performers at the same computer, preserved first score after player direction,
physical first exit, completed round history, accepted dancer withdrawal respected
in the later round, natural completion and Reset audio disposal.

Fresh load, Reset/firstStep and zero page/console errors are asserted in each
case. These are hypothetical practices: Drawing Klerb-inspired shelter study,
neighbouring-Bombay-wellness-inspired standing practice (not historical
Mars-organized yoga), and Open Jacks-inspired digital sound exchange. They do not
certify arbitrary freehand art, advanced yoga, acoustic instruments, active
save/load, real-user hardware audio, camera direction, exhaustive anatomy or
whole-tranche release readiness.
