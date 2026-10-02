# Selectable scenarios: boot smoke audit

Source candidate: `c7ae4868e47a20fb717ccd3eba18d8e99579424e`. This is an authored audit, **not browser acceptance or journey completion**. Browser execution awaits the serialized camera/day slot; no server, browser, runtime suite, performance measurement, or build ran in this lane.

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

Total: **45** (21 continuous, 24 noncontinuous). Currently **0 browser cases executed, 0 explicit skips; supported/unsupported runtime observations pending**. Neither conditional-admission profile is preclassified as unsupported. Manual-start presets must remain idle on the first Step. `incomplete-stairs` must report exactly `route.link-unusable`, name its stairs, and leave the actor unmoved; that diagnostic never excuses an invariant violation. Campfire's later authored full-circle refusals are outside the one-tick window and do not waive initial failures.

A real `year-build.unsupported` admission must name omitted parts and acquire no action; receipts label it `unsupported-admission`, never an activity PASS. Supported current 2022 whole-house construction retains its existing full [year-build journey gate](../../../viewer/e2e/year-build.spec.ts), including its canonical continuity checks. No historical fixture, completion threshold, or existing test changed. New activity completion/disruption proof remains in its dedicated tests; this smoke only checks discoverable initial states.

## Scoped source validation and pending execution

Strict standalone TypeScript compilation of the spec and its imports passed (`tsc --noEmit --incremental false --strict --skipLibCheck --target ES2022 --lib dom,dom.iterable,esnext --module esnext --moduleResolution bundler --allowImportingTsExtensions --jsx react-jsx --esModuleInterop --types node,vite/client e2e/selectable-scenarios-audit.spec.ts`). Scoped `oxlint` passed; `oxfmt` applied. Owned changes are only this report and the new spec.

After explicit slot grant, run the exact spec with an available isolated `E2E_VITE_PORT`, fresh `E2E_RUN`, and existing frozen campus assets/browser dependencies, using `e2e/playwright.config.ts` (one worker, no retries). `selectable-audit/summary.json` will report every exact name as `not-run`, `boot-smoke-passed`, `expected-diagnostic-observed`, `unsupported-admission`, or `unexpected-failure`, all with `completionProven: false`. A source failure should be handed to the root with that candidate, stage, named diagnostic/violation and failure capture; this lane does not redesign the activity or shared Runtime.
