// RESOLVE2 (Soul tranche 2026-10-22): a bench on a hotel's roof is reached from the roof, not the lobby under it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { supportY } from './god/nav.ts';

const model = (slotKind: string) => {
  const hotel = { id: 'hotel', in: { parent: 'world' }, y: 0 }, bench = { id: 'bench', in: { parent: 'hotel', slot: 's1' }, y: 9.32 };
  const entities = new Map<string, any>([['hotel', hotel], ['bench', bench]]);
  return { m: { entities, slotsOf: (e: any) => (e.id === 'hotel' ? [{ id: 's1', kind: slotKind }] : []), worldPose: (e: any) => ({ y: e.y }) }, bench };
};

test('supportY: a thing on a roof slot is reached at its own height (the roof), not at the ground under it', () => {
  const { m, bench } = model('roof');
  assert.equal(supportY(m as any, bench as any), 9.32);
});

test('supportY: a thing on a plain (non-floor) slot is still reached from its support', () => {
  const { m, bench } = model('top');
  assert.equal(supportY(m as any, bench as any), 0);
});
