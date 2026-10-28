# Bounded ground-cover browser proof

Prepared runner: `quality-ground-cover-browser.mjs`. This is a suite module, with no launcher or CLI entrypoint. It has not been run. Root owns admission, the existing fake-mind context fixture, the Chrome lease, source/build receipt, process registry and final runtime teardown. No new world, dependency install, Modal job, source patch, cache reset, simulation pause or performance battery belongs to this runner.

Run only after R combines Q's source fix with both scene adapters on the actual released A. Use one quiet runtime/browser serially with painting qualification where practical. Q runs first, while the context fixture still has its five unchanged subjects. P may add its easel afterward; P's completion/credit/refresh oracle stays separate. The runner deliberately rejects a fixture with extra entities instead of silently changing the comparison scene.

From the existing fixture-session callback, after root has admitted the runtime and browser:

```js
import { runQualityGroundCoverProof } from './tools/painting-quality/quality-ground-cover-browser.mjs';
const quality = await runQualityGroundCoverProof({
  browser, session, deadline, signal,
  out: '/absolute/.e2e/runs/ROOT_RUN/quality-ground-cover', // new directory; parent exists
  beforeDir: '<team>/scratch/t4/world-context-views/linux-preflight-v1',
  identity: {
    sourceSha: 'EXACT_INTEGRATED_B_40_HEX_SHA',
    build: 'EXACT_EXPECTED_FIXTURE_HEALTHZ_BUILD',
    webReceiptPath: '/absolute/verified-build-receipt.json',
    webReceiptSha256: 'EXACT_RECEIPT_FILE_SHA256',
  },
});
```

`session` is the callback object from existing `createFixtureSessions`; its request method remains responsible for bounded local HTTP access and its ordinary fixture-owner God authorization. The browser process must already be registered with the owner session. The module creates four serial fresh browser contexts, closes only those contexts and never closes/kills the owner's shared browser/server. Root retains the independent owned-process cleanup fallback. It is never safe to kill a process just because it owns a port.

The work deadline is the earlier of five seconds before the owner's absolute deadline and 150 seconds from entry. On timeout/abort it closes owned contexts immediately. Cleanup has a five-second ceiling, restores fixture media and records incomplete/late context creation rather than killing shared processes. A failed/incomplete restoration blocks P; root must retain cleanup custody. There are at most two architectural `contextRender` calls and two live-viewer contexts; no automatic retries or extra capture are scheduled on failure.

`createFixtureSessions` uploads `artwork(0)` before its callback, while the retained Linux run used untouched genesis. The runner validates a source-reconstructed identity for all five entities, allowing only that uploaded media difference. It sets only the resolved artwork entity's `state.media` to the original empty string through ordinary `POST /v1/god/act`, checks the snapshot, and restores the exact prior string in `finally`, checking all fixture facts again before P may proceed. It never calls the general art-clear route or changes title/maker. Interrupted alignment responses still trigger restoration.

`quality-ground-cover-expected.json` pins effective definition hashes, instance pose/parent/slot/params/state/shape/entity seed, baked physical output, ground recipe and constants. Generated IDs are normalized to fixture names; editor bookkeeping is omitted. The world seed is not an appearance input for this unseeded fixture: entity seeds remain in the comparison, generator default seeds are zero, and the complete ground recipe is compared. Twelve targeted fixture/mesh/material/generator source files remain byte-identical to retained source `33cefaf029db4ef9904743ff39874a368c56c1f9`. The thirteenth, `building.mesh.ts`, has a reviewed worker-lifecycle-only change (original `4b398325`, integrated `84eac557a`): idle retirement and worker failure cleanup, with unchanged geometry generation, template keys, materials and emission. Baseline pins, exact accepted candidate pins and the exception reason are recorded separately in the proof; every candidate pin is checked before capture. This establishes a source-backed expectation of scene equivalence, pending visual inspection, and makes no pixel-equality claim. This is a source-reconstructed comparison: the old run has no retained world snapshot, so direct old/new snapshot equality is not claimed. Any changed pinned source or fixture fact aborts before capture.

The retained before receipt supplies the actual chosen enclosed-room and fountain camera/field of view (64 and 38 degrees), rather than inferring them from the screenshot. Its file hash is pinned. Both before PNGs must match their fixed pins and the receipt's own image hashes (`75fee140…` room, `47adddaf…` fountain), then are copied byte-for-byte. The current production `contextScene`, room and front helpers derive a detached architectural snapshot; production `contextEnclosed` supplies the enclosure fact required by the shared fixture binder, and each camera is fixed to its retained camera. Every capture starts with a fresh renderer and performs its first `contextRender` invocation without a warmup capture. The normal architecture pipeline itself can include occlusion passes; this is not a claim that its final PNG is literally the first WebGL draw call. Payload, full fixture snapshot, hashes, camera, photo metadata, build identity, browser resources and console errors are retained. Runtime/browser/platform differences remain explicit and no pixel-equality or performance claim is made.

Desktop and phone viewports then load the ordinary live viewer at the same explicit outdoor fixture camera, using existing quality settings. Phone is viewport/touch emulation on the owner's browser; physical-phone qualification is separate. Checks require a settled entity layer, one visible canvas, no document overflow, no WebGL loss or console errors, and a real mouse/touch drag that changes camera position. Desktop must retain outdoor cover instances. Phone must retain its existing phone tier with cover disabled; there is no `cover=1` or global-quality override. A11y snapshots precede input and screenshots follow each state.

Outputs are `summary.json`, `snapshot.json`, two `*-input.json` files, before/after room and landmark PNGs, desktop/phone before/after-input PNGs and a11y snapshots, and `index.html`. Machine success and visual acceptance remain distinct. Root must inspect the gallery: the room has no origin sprigs, the matched outdoor image retains legitimate grass, and both live viewports remain usable. A passing machine receipt leaves `visualQualification: pending-root-review`; no colour-count heuristic substitutes for inspection. Failures retain the same artifacts, and a new run requires root diagnosis/scheduling.

Before execution follow the existing `E2E.md` and e2e skill custody conventions; retain the runtime/build receipt and exact run folder. Preparation was syntax-checked and verified with focused pure tests (`node --test tools/painting-quality/quality-ground-cover-fixture.test.mjs`); it has not launched a runtime or browser and has no visual result yet.
