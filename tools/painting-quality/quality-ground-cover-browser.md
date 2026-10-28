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

`session` is the callback object from existing `createFixtureSessions`; its request method remains responsible for bounded local HTTP access. The browser process must already be registered with the owner session. The module creates four serial fresh browser contexts, closes only those contexts and never closes/kills the owner's shared browser/server. Root retains the independent owned-process cleanup fallback. It is never safe to kill a process just because it owns a port.

The work deadline is the earlier of the owner's absolute deadline and 150 seconds from entry. On timeout/abort it closes owned contexts immediately. Cleanup has a five-second ceiling and records incomplete/late context creation rather than killing shared processes. There are exactly two architectural `contextRender` calls and two live-viewer contexts; no automatic retries or extra capture are scheduled on failure.

The retained before receipt supplies the actual chosen enclosed-room and fountain camera/field of view, rather than inferring them from the screenshot. Both before PNGs are copied byte-for-byte and hashed. The current production `contextScene`, room and front helpers derive a detached architectural snapshot; each camera is fixed to that retained camera. Every capture starts with a fresh renderer and performs its first `contextRender` invocation without a warmup capture. The normal architecture pipeline itself can include occlusion passes; this is not a claim that its final PNG is literally the first WebGL draw call. Payload, full fixture snapshot, hashes, camera, photo metadata, build identity, browser resources and console errors are retained. The historical baseline is source `33cefaf029db4ef9904743ff39874a368c56c1f9`; runtime/browser/platform differences remain explicit and no pixel-equality or performance claim is made.

Desktop and phone viewports then load the ordinary live viewer at the same explicit outdoor fixture camera, using existing quality settings. Phone is viewport/touch emulation on the owner's browser; physical-phone qualification is separate. Checks require a settled entity layer, one visible canvas, no document overflow, no WebGL loss or console errors, and a real mouse/touch drag that changes camera position. Desktop must retain outdoor cover instances. Phone must retain its existing phone tier with cover disabled; there is no `cover=1` or global-quality override. A11y snapshots precede input and screenshots follow each state.

Outputs are `summary.json`, `snapshot.json`, two `*-input.json` files, before/after room and landmark PNGs, desktop/phone before/after-input PNGs and a11y snapshots, and `index.html`. Machine success and visual acceptance remain distinct. Root must inspect the gallery: the room has no origin sprigs, the matched outdoor image retains legitimate grass, and both live viewports remain usable. A passing machine receipt leaves `visualQualification: pending-root-review`; no colour-count heuristic substitutes for inspection. Failures retain the same artifacts, and a new run requires root diagnosis/scheduling.

Before execution follow the existing `E2E.md` and e2e skill custody conventions; retain the runtime/build receipt and exact run folder. This source-only preparation was checked with `node --check`; it has not launched a runtime or browser and has no visual result yet.
