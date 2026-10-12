// Unit tests for deploy/host-health.mjs (lane OPS2). No ports.
import test from 'node:test'; import assert from 'node:assert/strict';
import { evaluate, memAvailableMb } from './deploy/host-health.mjs';
const GB = 1e9;
test('MemAvailable parses from /proc/meminfo', () => {
  assert.equal(memAvailableMb('MemTotal:       16000000 kB\nMemAvailable:    8429280 kB\n'), 8232);
  assert.equal(memAvailableMb('MemTotal: 1 kB\n'), null);
});
test('thresholds: disk <15% or <20 GB, MemAvailable <1.5 GB', () => {
  assert.equal(evaluate({ diskTotalBytes: 301 * GB, diskFreeBytes: 48 * GB, memMb: 8232 }).ok, true);
  assert.match(evaluate({ diskTotalBytes: 301 * GB, diskFreeBytes: 40 * GB, memMb: 8232 }).problems.join(), /13.3% < 15%/);
  assert.match(evaluate({ diskTotalBytes: 100 * GB, diskFreeBytes: 19 * GB, memMb: 8232 }).problems.join(), /19 GB < 20 GB/);
  assert.match(evaluate({ diskTotalBytes: 301 * GB, diskFreeBytes: 48 * GB, memMb: 1200 }).problems.join(), /1200 MB < 1536 MB/);
  assert.equal(evaluate({ diskTotalBytes: 301 * GB, diskFreeBytes: 48 * GB, memMb: null }).ok, false);
});
