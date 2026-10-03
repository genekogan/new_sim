# LM-012 — browser worker for file-take camera compilation

2026-09-29 · branch `codex/camera-worker` · base `61cd7cc` (current integration at branch creation).

`directForTake` now runs a one-shot module worker in browsers. A shared app-only compile kernel preserves
engine inputs, full outputs and track-ID keys. Node callers use that same kernel synchronously. The existing
scene loader/cache stays with the caller, shared with parsing; no worker campus loader was added. Caller scene
preparation and structured cloning remain; take-less `directOnYear` remains synchronous.

The worker terminates on completion, cancellation, creation/posting/runtime/decoding failures. These failures
produce named `camera.worker.*` diagnostics, not a blocking browser fallback. Abort listeners and callback
references are removed. Host new requests, closing and active chapter changes cancel pending work; file identity
and request identity prevent stale results from being applied. Lifecycle options do not enter track IDs.

`camera-sampler-budget.test.ts` is a synthetic regression proxy: the same 20 s dynamic-subject hold at zero and
after 2728.8 s has identical sampler counts; zero samples occur in the lead-in, despite >27k additional output
samples. It makes no historical D2/2,424-call claim while that take's scene remains parked. SHA/per-id sampling
optimizations were not attempted; engine motion/framing/synthesis algorithms are unchanged.

## Tests and evidence

- `node --test engine/test/camera-worker.test.ts engine/test/camera-parse-studio.test.ts`: 6 passed, 0 failed.
  Covers full synchronous output equality, read-only inputs, successful cleanup, abort before/during start,
  creation failure, postMessage failure, worker runtime failure, message decoding failure and invalid reply.
- After adding the typed started/result envelope, `node --test engine/test/camera-worker.test.ts`: 4 passed.
- `node --test engine/test/camera-sampler-budget.test.ts`: 1 passed.
- `npx tsc --noEmit -p .` and `npm run lint`: clean.
- `E2E_VITE_PORT=5495 E2E_RUN=codex-camera-worker-1 npx playwright test -c e2e/playwright.config.ts camera-worker.spec.ts studio-camera-vocab.spec.ts`:
  **2 passed**, 20.0 s. The long synthetic take produced identical entire result/track hashes to the synchronous
  kernel. **3 animation frames** occurred after worker compilation started and before its result arrived.
  Closing during the second compile returned null, applied no result, and left 0 active workers / 2 terminated
  workers / 1 completed result. No console/page errors. The native worker is observed directly.
- Full suite/gate deferred per lead's instruction to serialize expensive checks; no full-gate claim here.

Opened and inspected all three PNGs under `viewer/e2e/artifacts/codex-camera-worker-1/`: `camera-worker-sink.png`
shows the directed sink hold at 45:28 with the sink/faucet clearly visible and final-state check green;
`studio-camera-vocab-sink.png` shows normal short-take playback; `studio-camera-vocab-refused.png` shows the
invalid second clause and unchanged prior fixture direction. `camera-worker.json` records lifecycle counts and
identity hashes. Artifacts are ignored, not committed.

No pins, golden files, historical content, deployment or remotes changed. Approximate worker usage: 10k
reasoning/output tokens and 18 minutes wall time (estimate, not account telemetry).
