# W61 — fixture camera subjects and NL refusal contract

2026-09-29 · branch `codex/camera-fixtures` · base `28683cb0d25ac04967f4790df668a28681657614`.
Implementation and this report ship together under `camera: resolve fixture subjects and document NL refusals`.

## Changes

- `engine/camera/direct.ts`: lead-authorized schema extension `subject.kind: 'fixture'` delegates resolution to
  the existing fixture resolver. Touching component boxes form one static subject; separated fixtures ask which.
  Existing synthesis already handles static boxes, so no synthesis algorithm or output changed.
- `engine/camera/parse.ts`: consumes fixture vocabulary, including short component queries such as `sink`;
  cross-kind matches refuse, and unknown-subject questions now offer fixture as an explicit kind.
- `engine/api/camera-vocab.ts`: retains fixture query text in the direction. Rewriting a clustered sink query
  to its first component's ID would silently drop the rim when recompiling. The subject record still returns
  its resolved ID, label and original words.
- `camera-parse-fixtures.test.ts`: exact schema parse, cross-kind ambiguity, separate/missing fixtures,
  clustered geometry, exact typed/sentence compilation equivalence and no world/scene mutation. Includes
  the existing 2024 kitchen, read-only; no historical content values were changed.
- `camera-parse.test.ts`: names the 20 deliberately refused examples as the executable LM-010 contract,
  with explicit wide-lens note/no-invented-FOV assertions. Existing 52 successful language cases remain.
- `e2e/camera-fixture.spec.ts`: existing studio `directOnYear` harness compiles a parsed sink hold; verifies
  rendered mesh visibility and captures the actual computed pose. `studio-direct-sentences.spec.ts` only
  changes its unknown-subject candidate assertion to include fixture (lead approved).
- `CODEX.md` §7 logs the schema extension; the parser brief records the new contract.

## Validation

- `node --test viewer/engine/test/camera-parse*.test.ts`: 9 passed, 0 failed (before final capitalization edge; covered again by final suite).
- `npx tsc --noEmit -p .`: passed.
- `E2E_VITE_PORT=5495 E2E_RUN=codex-camera-fixtures-1 npx playwright test -c e2e/playwright.config.ts camera-fixture.spec.ts`: 1 passed.
- `E2E_VITE_PORT=5495 E2E_RUN=codex-camera-fixtures-contract npx playwright test -c e2e/playwright.config.ts studio-direct-sentences.spec.ts`: 1 passed (2.4 minutes under concurrent engine load).
- First full engine run: 419 pass / 0 fail / 6 skip / 11 TODO. After the final two added tests, a concurrent full
  run produced 420 pass / 1 fail / 6 skip / 11 TODO: only `planning.test.ts` stress-30 exact max tick 469.3 ms
  exceeded its existing 250 ms wall-clock bound. No pin mismatch. No thresholds changed. The isolated planning
  suite then passed 7/7 in 11.1 s. The lead granted a serialized full-suite slot for final acceptance below.

**Final serialized acceptance:** `npm run test:engine` → **421 pass / 0 fail / 6 skip / 11 TODO**, 59.3 s,
with the capitalization regression included. `npx tsc --noEmit -p .` → clean. `main` remains the recorded base;
no rebase delta. The prior failure was load-sensitive wall-clock cost; pins, test limits and golden files were
not edited. Existing skipped/TODO historical tests remain documented upstream.

## Capture inspected

`viewer/e2e/artifacts/codex-camera-fixtures-1/camera-fixture-sink.png` was opened and inspected: the sink bowl
and rim are clearly framed on the kitchen counter, faucet visible, with no obstructing wall or visible camera
clipping. The accompanying JSON records 11 rendered verification samples, 0 hidden-by-real-mesh samples,
0 framing-model mismatches and mean real readability 0.875. The compiler has 51 samples, 0 invalid samples,
0 swept crossings and no corrections. The Playwright test passed in 9.0 s, including server startup.

Also inspected the two `codex-camera-fixtures-contract` captures: the deictic refusal visibly highlights "this"
and appends nothing; the directed rack orbit plays with the directed camera selected and normal scene visibility.

The legacy standalone studio Say-it panel still calls the parser without vocabulary; this change does not
claim that panel can infer a sink. The op API's `engine_parse_camera` / `sentences[]` path supplies the semantic
vocabulary. The lead's one-control-path work can connect that panel to the same path.

## Accounting / remaining scope

No pins, historical values, remotes, main checkout or deployment touched. LM-009 and LM-010 have focused
proof; lead must run the full gate before merge and publication. Worker usage estimate: approximately 12k
reasoning/output tokens and 25 minutes wall time (unmetered estimate; includes reading and test waits).

LM-012 read-only finding: `camera-direct-identity.test.ts` currently omits the D2 chapter fixture when
`chapterBaseCurrent` finds the recorded scene differs from the re-seeded 2022 file. An exact 2,424 sampler-call
assertion cannot provide live D2 proof until the take is re-recorded. A later history-independent long-lead-in
sampler proxy could guard the same performance mechanism; LM-012 is not marked fixed by this branch.
