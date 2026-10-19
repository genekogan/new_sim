import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { splitSnapshot } from '../../server/src/god/snapshot-wire.ts';
import { expandSnapshot } from './snapshot-wire.ts';

const sample = {
  contract: 'world/1', worldId: 'w', seq: 7, counter: 3, seed: 's', tick: 42, constants: {}, state: {},
  ground: { kind: 'hills', h: [1, 2] },
  defs: [{ name: 'core-barrel', version: 1, params: { wood: { default: '#8c5f3a' }, iron: { default: '#3b3a36' } } }, { name: 'core-rock', version: 2 }],
  entities: [
    { id: 'e_1', def: 'core-barrel@1', in: { parent: 'world' }, p: [1, 0, 2], params: { wood: '#8c5f3a', iron: '#000000' } },
    { id: 'e_2', def: 'core-barrel@1', in: { parent: 'world' }, p: [3, 0, 2] },
    { id: 'e_3', def: 'core-rock@2', in: { parent: 'e_1', slot: 'top' }, params: { size: 2 } },
  ],
  assetBytes: {}, builds: [], buildsRev: 0, now: 1792414016708,
};
const roundTrip = (snap: Record<string, unknown>) => { const s = splitSnapshot(structuredClone(snap)); return expandSnapshot(JSON.parse(JSON.stringify(s.body)), s.parts.defs as never, s.parts.ground); };

test('split on the server then expand on the client gives the plain snapshot back', () => {
  assert.deepEqual(roundTrip(sample), sample);
});
test('the live Eden 2026 snapshot round-trips exactly (when a copy is at hand)', { skip: !existsSync('<team>/scratch/t4/w3/snap-eden.json') }, () => {
  const live = JSON.parse(readFileSync('<team>/scratch/t4/w3/snap-eden.json', 'utf8'));
  assert.deepEqual(roundTrip(live), live);
});
