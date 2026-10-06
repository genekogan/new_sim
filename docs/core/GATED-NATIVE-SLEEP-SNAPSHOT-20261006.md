# Gated native sleep snapshot component

Native component source only. No Eden main/reader/header/operator flag is added,
no current Root code/settings/checkpoint is changed, and no historical source
outside this worktree is edited. Default active sleep remains non-resumable.

The explicit runtime service marker nativeSleepSnapshotV1 must equal
native-sleep-snapshot/1 before either physical hold or retained sleep purpose
can serialize or restore. This marker is currently set only by isolated tests.
The graph codec preserves the same plain execution objects shared by action live
entries and the sleep service store. Serializers and restore validators check
action ID, original params/actor/mat, child provenance, store identity, phase,
bounded elapsed/fraction and owned-action references. No pose reset, wake, clock
change, blanket action drop or renderer/controller replacement occurs.

Seven focused checks pass: approach, lie-down, sleep, wake, return and pause each
survive a JSON round trip and300 exact subsequent ticks with matching world hashes,
readSleep state, physical mat holders and clear invariants. Pause resumes its
remaining purpose in both copies. The negative case refuses missing policy,
changed actor, out-of-range progress and a replaced service-store object.
Default snapshot refusal remains. Native type checking passes using the original
Mars ES2022 target plus its existing dom/dom.iterable/esnext library set; the first
root-only type config encountered the pre-existing workshop findLast use and was
corrected to match the native project's actual library contract, without editing
that unrelated activity. An initial negative assertion used case-sensitive
regex for a correctly rejected Sleep diagnostic; the assertion was corrected.
Existing sleep/footprint/director/refusal regressions50 pass.

A concrete explicit allowDrop defect was reproduced: default sleep controllers
could be discarded while the body's fully prone pose remained. Snapshot safety
now follows the body's current sleep action and ancestor ownership chain; dropping
either hold or parent while the physical pose depends on it refuses snapshot.drop-unsafe.
The failed snapshot leaves the original state unchanged. This is a snapshot
refusal, not forced cancellation/cleanup. Ordinary serialization with the opted
codec still retains the complete action graph.

This component does not qualify whole-world/SQLite active sleep snapshot capture,
canonical named policy and history marker, compatibility/keeper selection,
compaction/quiet policy propagation, Root activation or full crash recovery.
Those must be supplied as a separately reviewed Core composition. Existing
journal-replay cohort evidence remains valid at its original scope. All models
fake/no provider calls; no UI/save-load feature or live model bill claimed.
