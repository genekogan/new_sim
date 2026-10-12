import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateExit } from './checks.mjs';

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
