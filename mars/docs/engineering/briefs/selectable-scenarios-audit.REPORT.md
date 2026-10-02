> Release36 update: integrated functional source `cfea591` passed the clean combined
> gate and fresh public acceptance. [Final handoff](../MARS_MVP_HANDOFF.md) and the
> latest release receipt own current status; earlier local/candidate/RED claims
> below are preserved provenance, not the final public disposition.

# Selectable scenarios: boot smoke audit

Authored inventory base: `c7ae4868e47a20fb717ccd3eba18d8e99579424e`. Serialized browser smoke ran against frozen runtime `dbc18bfa60519315e0563af4584671be4b2aedec` plus the owned test-only fix `03e1a929d9002243498abb644ec4208982e09a8c` (capture HEAD `b256e2e5694b76faa2dae593fbf2392ecdaa4eef`). **46 cases passed; this is initial-state smoke, not journey completion.** No broad runtime suite, performance audit, or build ran in this lane.

[The new spec](../../../viewer/e2e/selectable-scenarios-audit.spec.ts) imports the authoritative [selector inventory](../../../viewer/app/lab/scenarios.ts) and authors 45 independent cases plus one selector/hook parity case. Each case creates a fresh paused target Runtime, checks Reset and the first fixed Step, and rejects page errors, renderer errors, unexpected initial action failures, and any authoritative violation. Independent cases keep one failure from skipping the remaining inventory. Each stage retains state, records, named diagnostics and admission; disk receipts survive worker restarts. Only failures and one representative `wall` boot state receive screenshots. Use a fresh `E2E_RUN` directory for each execution.

## Exact source inventory

| Authored mode | Count | Exact scenario names |
| --- | ---: | --- |
| Continuous, manual start | 19 | `living-day-4`, `living-day-studio`, `garden-care`, `music-dance`, `classroom-4`, `classroom-8`, `work-break-4`, `work-break-8`, `prepared-day-4`, `prepared-day-8`, `prepared-day-studio`, `quiet-reading`, `computer-music`, `tabletop-chess`, `design-studio`, `ground-sleep`, `ground-sleep-rotated`, `cold-preparation`, `cold-preparation-rotated` |
| Continuous, manual probe | 1 | `body` |
| Continuous, autonomous | 1 | `stress-30` |
| Scripted | 21 | `wall`, `u-trap`, `narrow-passage`, `stairs`, `deck-to-ground`, `construction`, `trio`, `build-bay`, `hand-up`, `prone`, `prone-forks`, `campfire-evening`, `meal`, `year-2020`, `year-2021`, `year-2022`, `year-2023`, `year-2024`, `year-2025`, `year-2026`, `solar-paint` |
| Intentional named diagnostic demo | 1 | `incomplete-stairs` |
| Conditional admission | 2 | `year-build-2022`, `year-build-2022-house` |

Total: **45** (21 continuous, 24 noncontinuous). Observed **45 scenario cases plus selector parity passed, 0 failures/skips/flaky**: 44 boot-smoke results and one expected named diagnostic. Neither current conditional-admission profile refused startup; unsupported admission count is 0, not an unsupported activity PASS. Manual-start presets must remain idle on the first Step. `incomplete-stairs` must report exactly `route.link-unusable`, name its stairs, and leave the actor unmoved; that diagnostic never excuses an invariant violation. Campfire's later authored full-circle refusals are outside the one-tick window and do not waive initial failures.

A real `year-build.unsupported` admission must name omitted parts and acquire no action; receipts label it `unsupported-admission`, never an activity PASS. Supported current 2022 whole-house construction retains its existing full [year-build journey gate](../../../viewer/e2e/year-build.spec.ts), including its canonical continuity checks. No historical fixture, completion threshold, or existing test changed. New activity completion/disruption proof remains in its dedicated tests; this smoke only checks discoverable initial states.

## Scoped validation and browser receipts

Strict standalone TypeScript compilation of the spec and its imports passed (`tsc --noEmit --incremental false --strict --skipLibCheck --target ES2022 --lib dom,dom.iterable,esnext --module esnext --moduleResolution bundler --allowImportingTsExtensions --jsx react-jsx --esModuleInterop --types node,vite/client e2e/selectable-scenarios-audit.spec.ts`). Scoped `oxlint` passed; `oxfmt` applied. Owned changes are only this report and the new spec.

The single fresh corrected run used isolated port `59312`, `E2E_RUN=codex-selectable-audit-dbc18bf-2`, and the existing one-worker/no-retry configuration. Measured runner duration: **198897.689 ms (3m18.9s)**. All 45 presets passed fresh paused load, Reset, and first fixed Step with zero authoritative violations, page errors, unexpected initial action failures, or nonempty renderer errors. Both current 2022 construction profiles admitted normally. Every receipt retains `completionProven: false`; existing full journeys remain required.

Proof worktree: `<mars-worktrees>/selectable-audit-proof`. Receipts: `viewer/.cloudflare/selectable-audit-2.json`, `selectable-audit-2.log`, `selectable-audit-receipt.json`; exact-name stages/classifications: `viewer/e2e/artifacts/codex-selectable-audit-dbc18bf-2/selectable-audit/summary.json` and per-preset JSON. Personally inspected the representative `wall` first-Step PNG: actor/wall visible, tick 1 paused, zero violations; incomplete journey expectations are correctly still unfulfilled.

The retained first attempt (`selectable-audit.json`/`.log` and the unsuffixed artifact run) stopped after a common **own test contract error**: renderer `view.error` initializes to `''`, while the spec expected null. Three initial failures and one interruption were preserved. The two-line repair asserts exact `''`, still rejecting every nonempty error; no runtime change or diagnostic waiver. All three failure PNGs were personally inspected and show healthy loaded scenes. Only this corrected fresh rerun was performed. Frozen GLB/br hashes match the prior music proof. Harness exited, port 59312 had no listener, and the serialized slot was returned to root. No public release, long-run stability, or completion claim.
