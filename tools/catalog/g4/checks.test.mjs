import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateExit, viewErrors } from './checks.mjs';

test('busy terrain cannot disguise an empty crop or an unmeasured instance', () => {
  assert.equal(viewErrors({ live: true, cover: 0.4, top: 0.6 }, 'front').length, 0);
  assert.ok(viewErrors({ live: true, cover: 0.0001, top: 0.3 }, 'front').some((e) => e.includes('blank')));
  assert.ok(viewErrors({ live: true, cover: null, top: 0.3 }, 'front').some((e) => e.includes('unqualified')));
  assert.ok(viewErrors({ live: false, cover: 0.4, top: 0.3 }, 'front').some((e) => e.includes('unqualified')));
  assert.ok(viewErrors({ live: true, cover: 0.4, missingAsset: true, top: 0.3 }, 'front').some((e) => e.includes('missing asset')));
});

test('item failures and missing pictures fail the gate despite a successful Chrome run', () => {
  const report = { gpu: 'ANGLE (NVIDIA L4, Vulkan)', items: [{ ok: true, views: [{}] }] };
  assert.equal(gateExit(report), 0);
  assert.equal(gateExit({ ...report, items: [{ ok: false, views: [{}] }] }), 2);
  assert.equal(gateExit({ ...report, items: [{ ok: true, views: [] }] }), 2);
});

test('empty runs and software rendering cannot qualify G4', () => {
  for (const gpu of ['', 'SwiftShader', 'llvmpipe', 'software rasterizer']) assert.equal(gateExit({ gpu, items: [{ ok: true, views: [{}] }] }), 3);
  assert.equal(gateExit({ gpu: 'NVIDIA', items: [] }), 3);
});

test('incomplete or duplicate catchup coverage fails even when each rendered item passed', () => {
  const report = { gpu: 'NVIDIA', items: [{ ok: true, views: [{}] }], coverage: { requested: 768, accounted: 767, missing: ['last'], duplicate: [], unexpected: [] } };
  assert.equal(gateExit(report), 2);
  assert.equal(gateExit({ ...report, coverage: { requested: 1, accounted: 1, duplicate: ['first'] } }), 2);
});
