// Lane L5: boot progress slots decode to LOAD-CONTRACT §4's `phase` and `boot.{stage,tick,target}`, and a boot writes them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { attachBootSlots, bootPhase, bootSlots, bootTick, readBootProgress, BOOT_SLOT_COUNT } from './load/boot-progress.ts';

test('boot slots: phase, replay progress and serving decode as live.json fields', () => {
  bootPhase('boot:replay', 100, 250);
  bootTick(128);
  const { view, offset } = bootSlots();
  assert.ok(view.buffer instanceof SharedArrayBuffer);
  const r = readBootProgress(view, offset);
  assert.equal(r.phase, 'boot:replay');
  assert.deepEqual(r.boot, { stage: 'replay', tick: 128, target: 250 });
  bootPhase('serving', 300);
  assert.deepEqual(readBootProgress(view, offset), { phase: 'serving', at: view[offset + 3] });
});

test('boot slots: attaching another buffer copies the state and receives later writes', () => {
  bootPhase('boot:restore');
  const other = new Float64Array(new SharedArrayBuffer(16 * 8));
  attachBootSlots(other, 8);
  assert.equal(readBootProgress(other, 8).phase, 'boot:restore');
  bootPhase('boot:prepare', 7);
  assert.equal(readBootProgress(other, 8).boot?.stage, 'prepare');
  assert.equal(bootSlots().view, other);
  assert.equal(BOOT_SLOT_COUNT, 4);
});
