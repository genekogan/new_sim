// L4 (c): engine.step reuses the entity-table listing the last step ended with while no other MarsEngine method ran.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marsFactory, GREEN_FIELD_WORLD } from './engine.ts';
import { listTable } from '../../../mars/viewer/engine/world/entity-list.ts';

const factory = await marsFactory(GREEN_FIELD_WORLD);
type Probe = { tableReusesV1: number; tableCacheV1: { keys: string[]; list: unknown[]; entities: object } | null };

test('table cache: idle steps reuse one listing; any engine write path voids it; the reused listing equals a fresh one', () => {
  const e = factory.create(factory.genesis('table-cache')), p = e as unknown as Probe;
  e.spawnHuman({ id: 'h_A', label: 'Alice', soul: 's_A' });
  e.step(); e.step();
  const r0 = p.tableReusesV1;
  for (let i = 0; i < 5; i++) e.step();
  assert.equal(p.tableReusesV1 - r0, 5, 'idle steps reuse the listing');
  e.takeChunks?.(-1); e.step();   // a TABLE_PURE read keeps it
  assert.equal(p.tableReusesV1 - r0, 6);
  e.spawnHuman({ id: 'h_B', label: 'Bob', soul: 's_B' }); e.step();   // a birth is engine code: no reuse
  assert.equal(p.tableReusesV1 - r0, 6, 'a birth voids the listing');
  e.removeEntity('h_A'); e.step();
  assert.equal(p.tableReusesV1 - r0, 6, 'a retire voids the listing');
  e.step();
  assert.equal(p.tableReusesV1 - r0, 7);
  const fresh = listTable(e.world.entities), c = p.tableCacheV1!;
  assert.equal(c.entities, e.world.entities);
  assert.deepEqual(c.keys, fresh.keys);
  assert.ok(c.list.every((x, i) => x === fresh.list[i]));
  assert.ok(!c.keys.includes('h_A') && c.keys.includes('h_B'));
});
