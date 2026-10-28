import test from 'node:test';
import assert from 'node:assert/strict';
import { processRoles, resourceSummary } from './process-roles.mjs';
const row = (pid, parent, executable, start = 'a') => ({ pid, parent, executable, start, rssMiB: 10 });
test('roles follow owned ancestry and survive reparenting, never PID reuse', () => {
  const registry = new Map();
  const first = processRoles([row(1, 0, 'node'), row(2, 1, '/Applications/Google Chrome'), row(3, 2, 'Google Chrome Helper (GPU)'), row(4, 0, 'Google Chrome'), row(5, 4, 'Google Chrome Helper'), row(6, 1, 'unrecognized')], 1, registry, [{ pid: 4, role: 'viewer' }]);
  assert.deepEqual(first.rssByRoleMiB, { server: 10, capture: 20, viewer: 20, other: 10 });
  const later = processRoles([row(3, 0, 'Google Chrome Helper (GPU)'), row(5, 0, 'Google Chrome Helper'), row(2, 0, 'other', 'reused')], 1, registry);
  assert.deepEqual(later.processes.map(p => p.role), ['capture', 'viewer', 'other']);
  assert.equal(later.serverCaptureRssMiB, 10);
});

test('resource qualification fails closed on missing/error/unattributed sampling', () => {
  const valid = { phase: 'explore-ui', rssMiB: 2700, serverCaptureRssMiB: 1700, rssByRoleMiB: { server: 300, capture: 1400, viewer: 1000, other: 0 }, processes: [] };
  assert.equal(resourceSummary([], ['startup']).verdict, 'unknown-insufficient-sampling');
  const measured = resourceSummary([valid], ['explore-ui']);
  assert.equal(measured.combinedWithinBound, false);
  assert.equal(measured.serverCaptureWithinBound, true);
  assert.equal(measured.verdict, 'fail');
  assert.equal(resourceSummary([valid, { phase: 'explore-ui', error: 'missed sample' }], ['explore-ui']).verdict, 'unknown-insufficient-sampling');
  assert.equal(resourceSummary([{ ...valid, processes: [{ role: 'other', pid: 9, start: 'a', executable: 'unknown' }] }], ['explore-ui']).samplingSufficient, false);
  assert.equal(resourceSummary([valid, { error: 'cleanup abort', abortedForCleanup: true }], ['explore-ui']).samplingSufficient, true);
});
