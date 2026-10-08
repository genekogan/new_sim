# Optional direct-courtyard-access house 1 variant

Original house/furniture modules and `house-one-physical-proposal.json` stay immutable. `createAccessibleHouseOne(verifyOriginal)` is a separate optional replacement: caller verifies exact house1 root[34,0,15]/yaw0, replaces ONLY its original visual group and three furnishings atomically, never overlays both versions. Same house/furniture IDs, no native actors/poses/physics changes.

Exact Core delta:

| Change | Source geometry / request |
|---|---|
| West courtyard door | wallplaneX32.43, Z15.3..16.5, floorY.12 to head2.32; width1.2 |
| Rear courtyard door | wallplaneZ16.57, X33.4..34.6, floorY.12 to head2.32; width1.2 |
| Thresholds | west centre[32.43,.10,15.9],size[.22,.04,1.2]; rear centre[34,.10,16.57],size[1.2,.04,.22], tops.12/frompatio.08: actual4cm STEP, not ramp |
| Bed ID unchanged | root[31.5,.12,14.7],30cm south of original; northfoot gap.73m before wall/floor edge. No native bed/rest definition invented |
| Desk ID unchanged | root[33.4,.12,17.48],rendererYaw−π, desk front−Z; work approach lies in new rear doorway aperture |
| Unchanged | all5floorrectangles, original2street/courtfrontdoors/eastwindow/exteriorwalls/roof, original courtyardlowtable and eligiblefrontcampchair proposal |

New original-owner adapter invokes actual createDwelling then masks ONLY eight named plaster window-wall instances in its FRESH OWNED instance buffer; five new exact plaster piers/heads replace them, plus two timber thresholds. Original geometry/materials/factories are neither edited nor borrowed/mutated. Source membership guard verifies exact original part-name order/count, otherwise drains returned owners. No copied full house builder or new house family. New allocations recorded before graph membership; cleanup independently attempts each owner/instance/geometry/material/removal and aggregates errors. Original factory pre-return allocation coverage remains UNKNOWN.

Important historical correction: earlier report of whole-room inaccessibility was too broad. The west/rear courtyard walls were window-only, but front/rear floor strips join the side floors at their corners without full separating partitions. The original had INDIRECT corner routes. This variant improves DIRECT readable courtyard access and turning/desk approach; it does not retrospectively prove the original inaccessible. The old original proposal/receipts remain unchanged.

`accessibleHouseOneProposal()` supplies updated exact physical request, real aperture bounds, thresholds, furniture envelopes and .28radius/1.75height route waypoints. Core must admit actual floor/support/4cmstep links and evaluate native movement/rest/contact. The source-only swept geometric route is not native traversal, stair/load/bed/desk/actor qualification.

Two immediate source-build lease attempts deferred exit75 (busy), retained checkpoint; no polling/bypass. Then genuine ordinary source CPU executed via existing Node22 native TypeScript strip mode, with NO bundling/build/timing/GPU: PASS fourdoors/33walls/twothresholds, 404 sampled swept-standing route points/floor coverage, exactly8 fresh-owner masks, bed/desk transforms and normal returned cleanup. Executed native-source-check.mjs byteequals committed accessible-house-check.mjs; run `node --experimental-strip-types mars/viewer/app/engine-view/content/assets/eden-expansion-assets/accessible-house-check.mjs`. Scoped types remain DEFERRED, not PASS. No old house/resource suite repeat. No old house/frame/resource healthy proof or graphics. $0/fake0/no shared/Core/PM edits. Pending proof status must be updated from actual check output, not inferred from source.

Exact pins:
```json
{
  "<worktrees>/world-assets/mars/viewer/app/engine-view/content/assets/eden-expansion-assets/accessible-house-one.ts": "e6c26b59778a8209b20c824d997d30fd7ab9f9925bcb0dae007d4383238ef51c",
  "<worktrees>/world-assets/mars/viewer/app/engine-view/content/assets/eden-expansion-assets/accessible-house-check.mjs": "3b4a757ead5ff12ca8b64f9245993499fdb4d8f54400075c4632cc2a1c6d7073",
  "<worktrees>/world-assets/mars/viewer/app/engine-view/content/assets/eden-expansion-assets/house-one-access-variant.json": "112c1a5c82d860c52308f6d9bd87449b41507b15e9fc8ef3765217e33e1e8ea0",
  "<worktrees>/world-assets/.e2e/runs/eden-house-one-access-variant/native-source-receipt.json": "d51ec65c627559e9266c1a054da69e7df98508aa6d2b623162189abcc5485c4b",
  "<worktrees>/world-assets/.e2e/runs/eden-house-one-access-variant/native-source-check.mjs": "3b4a757ead5ff12ca8b64f9245993499fdb4d8f54400075c4632cc2a1c6d7073"
}
```
