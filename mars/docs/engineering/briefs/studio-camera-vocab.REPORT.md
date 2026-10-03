# W61 follow-up — Studio camera vocabulary and checkpoint geometry

2026-09-29 · `codex/studio-camera-vocab` · based on integration `e46ec14` (includes the fixture extension).

## Behavior

The Studio Say-it panel now parses and resolves against the active file take/chapter using exactly the
shared op helper (`cameraVocab` / `activitiesOf` / `parseCameraSentences`). It needs no room. Rack aliases
become concrete structure IDs; a missing kitchen on 2026 refuses before appending; the 2024 sink resolves
and compiles as a fixture. Mixed requests append all or nothing. The fixture subject form is available.

The same cached take camera scene serves parsing and compilation. It applies the lead's `sceneForWorld`
helper, so checkpoint obstacle edits affect both. Parsed fixture phrases retain cluster geometry. In-flight
parses are discarded on file/chapter changes, newer parse requests, changed text/JSON, form additions or Compute.

Files: `app/studio/direct-camera.ts`, `direct-panel.tsx`, `take-host.ts`; shared clause splitter in
`engine/camera/parse.ts`; `camera-parse-studio.test.ts` + `camera-studio-fixtures.ts`; new
`e2e/studio-camera-vocab.spec.ts`; updated sentence e2e expectations; `STUDIO_REPLAY.md` sentence section.
No controller edits or copies of lead files. No historical content changes, pin changes, or deployment.

## Validation

- `node --test engine/test/camera-parse-studio.test.ts engine/test/camera-parse.test.ts`: 7 passed, 0 failed.
- After adding empty-clause refusal coverage, `node --test engine/test/camera-parse-studio.test.ts`: 2 passed.
- `npx tsc --noEmit -p .`: clean; `npm run lint`: clean.
- `E2E_VITE_PORT=5495 E2E_RUN=codex-studio-camera-vocab-1 npx playwright test -c e2e/playwright.config.ts studio-camera-vocab.spec.ts studio-direct-sentences.spec.ts`:
  sentence spec passed. New spec initially failed only because its CSS selector required an explicit option value
  attribute; the live accessibility snapshot showed the fixture option with its valid implicit value. Assertion
  corrected to match the option text; no product assertion weakened.
- `E2E_VITE_PORT=5495 E2E_RUN=codex-studio-camera-vocab-2 npx playwright test -c e2e/playwright.config.ts studio-camera-vocab.spec.ts`:
  1 passed in 9.7 s. No console/page errors.
- Full engine/gate deliberately deferred to the lead's serialized consolidated gate, as instructed to avoid
  concurrent wall-clock test failures. No claim of a full gate for this follow-up.

## Captures inspected

Opened both `codex-studio-camera-vocab-2/studio-camera-vocab-{sink,refused}.png`: the sink is visible on the
counter with the directed track selected, final-state check green and zero violations. The refusal view shows
Sentence 2/2 unknown-verb and "Nothing added", retaining the prior fixture direction. Also opened both
`codex-studio-camera-vocab-1/studio-direct-sentences-{refused,orbit}.png`: deictic words highlighted and directed
rack orbit visible. All artifacts live under `viewer/e2e/artifacts/`; none committed.

Approximate worker usage: 9k reasoning/output tokens, 13 minutes wall time; estimate, not an account meter.
