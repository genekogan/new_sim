# Rotated planting: complete both finite plots

Extended the existing rotated actual Play disruption journey after every original A-completed/B-untouched assertion. It now starts B with the exposed Start plant B control and actual Play, preserving the original source bowl, actor, fixture poses, return support, A purpose/deposits and physical cleanup. It verifies four finite 1/16 deposits into each plot, 1/4 material per plot, an empty original bowl, conservation, rotated visible marker positions, no held items, slot claims, observed claim holders or violations, terminal cleanup, disabled completed-plot controls, and a fresh Reset capture. No engine/app/content files changed.

## Source and validation

- Isolated branch `codex/seed-rotated-both-alpha`, based on `43d07eca74d684a4e4cf4b25c5cc0b2e1dfa2114`.
- Executed spec SHA-256: `4fa21562651c71d612019d5e5b47f844dde140703585558ac7c6796965ab4f84`. Artifact source labels record the base HEAD; the run included this uncommitted spec delta. The committed functional spec bytes are identical.
- `npm run typecheck`: PASS. `./node_modules/.bin/oxlint e2e/seed-planting.spec.ts`: PASS. `git diff --check`: PASS.
- Sole actual browser execution: PASS, one expected case, zero unexpected/skipped/flaky, retry 0; case 43,157 ms, complete runner 44,792.517 ms. Original 120-second case timeout, 15-second expect timeout, 2x speed, fixed engine DT=1/20 and all original assertions retained.

```sh
E2E_VITE_PORT=5421 MARS_SIMULATION_PORT=8921 E2E_RUN=codex-seed-rotated-both-alpha-2 ./node_modules/.bin/playwright test -c e2e/playwright.config.ts e2e/seed-planting.spec.ts --grep 'rotated actual Play:' --workers=1 --reporter=json
```

The first command used anchored grep `^rotated actual Play:` and selected zero tests because the full matching title includes the file prefix; no browser launched. Its native failure receipt is preserved. Corrected `--list` selected exactly the rotated case before the one actual execution. This was a selection correction, not an acceptance retry.

## Inspected evidence and limits

Evidence directory: `viewer/e2e/artifacts/codex-seed-rotated-both-alpha-2/`. Native runner JSON: `native-playwright-result.json`; initial no-tests receipt: `initial-zero-selected-result.json`. Original disruption captures and proof are retained alongside `seed-planting-rotated-both-plots-empty-finite-bowl.{json,png,a11y.yml}` and `seed-planting-rotated-both-plots-reset.{json,png,a11y.yml}`.

Inspected endpoint screenshot shows B's four soil markers and the finite-bowl HUD; machine evidence at tick 1501/time 75.05 confirms both A and B completed with four deposits/0.25 each, bowl fraction 0 returned on original `seed-table#r0c2`, A purpose `a1` unchanged, B purpose `a22`, no observed claim holders/held items/violations. Reset screenshot shows both empty beds, original actor/table/bowl; tick 1 evidence confirms bowl 0.5, zero deposits/markers and clean ownership. These are hypothetical fixtures, not historical planting claims.

The garden claim hook observes its enumerated actor/entity/hand/hold aliases; it is not an arbitrary-registry inventory. The endpoint image crops A and the bowl, so their assertions rely on paired state evidence. Only the extended rotated case ran. The default planting case and combined gate were not rerun here; root owns integration and full acceptance. No resource-counter guarantee beyond the existing test's physical ownership/terminal cleanup assertions is claimed.
