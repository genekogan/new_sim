# Music session history repair

Bounded repair based on creative-afternoon capture source `61b236ec4eae98aaa4ec11502ab2f4c6adf90027`; implementation worktree starts from `11cb5d6`.

The captured second-performer handoff exposed a completed first music session reporting the later performer's 1.55 seconds and current note instead of its retained seven-second result. `readComputerMusic` previously read mutable station state without tying that progress to its own work action. The completion path also used current station status and elapsed time while listeners drained.

Each session now retains its own elapsed progress and reads authoritative terminal `work_at` child outputs (`workedSeconds`, `finished`) when available. Live progress requires the exact child action and program action, performer and task. Duration and pulse use the session's declared duration and period. A resume starts from the admitted unfinished bookmark; interruption retains that session's progress after later explicit continuation. Inactive sessions have a null note. Completion `playedSeconds` and `finished` use the session's own work result even if another ordinary task has already reused the station.

The existing `musicStation` live audio contract, ordinary work/sit physical actions, admission, cancellation and player precedence remain intact. No shared renderer, UI, registry, workstation, save/load or support changes were made. Session history remains scoped to the same Runtime; this does not add active reload support.

## Verification

Four new regressions failed against the original activity, then passed after repair; the twelve existing computer music assertions were preserved:

- Completed first session remains unchanged during and after a different performer/score/duration reuses the same station.
- Completed same-performer, identically labelled session retains its original duration, elapsed time, pulse and null note during later reuse.
- Interrupted history retains the exact bookmark under explicit same-purpose resume, while the current session's live note and elapsed time match the station.
- Completion output remains the original child's two-second finished result while listeners drain and a later ordinary workstation task begins.

`node --test engine/test/computer-music.test.ts engine/test/open-jam.test.ts engine/test/music-gathering.test.ts engine/test/creative-afternoon.test.ts`: 67/67 pass, about 3.7 seconds. Tests include resource cleanup, deterministic replay, interruption and invariants. `npm run typecheck`, focused `oxlint`, formatting and `git diff --check` pass. No browser, performance run or full gate was launched; the parent retains that serialized slot. Visual capture proof belongs to the prior source and does not claim browser verification of this repair.
