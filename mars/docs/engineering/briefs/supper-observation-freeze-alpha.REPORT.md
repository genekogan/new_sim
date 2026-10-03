# Atomic supported-mealware observation

Isolated branch `codex/supper-observation-freeze-alpha` from `00bd041`; only communal-supper.spec.ts and this report changed. No root candidate, old worktree, baseline, app, engine or content edits.

## Diagnosis

Root's public release41 case35 failed the original exact support assertion at communal-supper.spec.ts:488. Read-only trace: `world-alpha-stabilization/viewer/.cloudflare/alpha-public-traces/communal-supper-retained-p-a1c61-n-vessel-storage-under-Play/trace.zip`; paired artifact: `viewer/e2e/artifacts/alpha-public-release41/retained-same-mealware-supported-return.json` in that worktree.

Trace monotonic times: meal-return wait call@5033 resolved at 1276884.7 ms; frozen-state evaluation began 1276888.458; Pause click began 1276890.959, waited for stability 1276894.176–1277206.66 and performed at 1277210.087. Thus ~325 ms elapsed after the successful original predicate before the Pause click. At 4x, ordinary cleanup legitimately progressed during this interval.

Actual action history establishes the supported return followed by new cleanup: resumed meal a53 completed tick2368, returning all four original utensils; tidy_table a65 requested2369; its cook-bowl take a67 requested2371, reached2374, withdrew2381, completed2389 with in-hand support cook/right. Captured tick2400 was storing-mealware, tidy a65 putting; zero violations. The expected meal-table support was a real committed transient, then legitimately changed before capture. This evidence supports a test observation race, not an ownership defect or replacement material.

## Bounded repair and limits

Only meal-return's branch now saves the unchanged original predicate result, calls the existing EngineHook.pause() if true, then returns that result. Observation and freezing occur in the same browser task, as in garden-circuit's committed-refill observation. The hook only sets simulation paused; no stepping, forced phase, pose/support write, material mutation or new tolerance. The sole meal-return caller immediately captures, then uses normal Play to continue ordinary cleanup.

Reviewed other wait uses: some intentionally chain partial/prepared/served without an intervening Play, so globally freezing every successful wait would change journey sequencing. Persistent prepared/meal-stored/finished/ended observations and local mode-paused waits remain unchanged. Other partial/served/consumed/transfer captures retain their original predicates and existing freeze path; this smallest patch does not claim universal capture-race elimination. All original exact supported-return, identity, material, conservation, receipt/purpose, cleanup continuation, terminal, error and Reset assertions remain unchanged. Original 4x, fixed DT1/20, 120s case, 15s wait/expect and retries0 remain unchanged.

Source/diff inspection and `git diff --check` PASS. No browser, TypeScript, engine, build or performance execution while root's public run is active. Focused public repeat and fresh combined gate remain root-owned and pending; no PASS claimed for this repair.
