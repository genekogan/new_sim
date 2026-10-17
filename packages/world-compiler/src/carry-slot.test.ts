import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CORE_KIT, WorldModel, applyBatch } from './index.ts';

// Lane M 2026-10-17 (finding from lane mars, 2026-10-16): a catalogue carryable without the `item` tag (core-watering-can,
// tagged object/tool) held by a Soul was refused on the engine's entity-world write-back every tick (slot.incompatible),
// so viewers drew it on the ground. A carry slot takes anything a body can carry.
test('a body\'s carry slot accepts any carryable def; things that are not carryable stay refused', () => {
  const w = new WorldModel({ constants: { ground: 'land' }, seed: 'carry-slot' });
  for (const d of CORE_KIT) w.defineDef(d, 'core', 0);
  const can = CORE_KIT.find((d) => d.name === 'core-watering-can')!;
  assert.ok(can.components?.carryable && !(can.tags ?? []).includes('item'), 'fixture: a carryable without the item tag');
  assert.equal(applyBatch(w, { ops: [{ op: 'place', def: 'core/humanoid@1', name: 'ana', p: [0, 0] }, { op: 'place', def: `core/watering-can@${can.version}`, name: 'can', p: [3, 0] }, { op: 'place', def: 'core/table@1', name: 'table', p: [6, 0] }] }, 'god', 1).result.accepted, true);
  const ana = w.get('ana')!.id;
  const held = applyBatch(w, { ops: [{ op: 'move', id: w.get('can')!.id, in: { parent: ana, slot: 'carry' }, p: [0, 0, 0], r: 0 }] }, 'engine', 2).result;
  assert.equal(held.accepted, true, JSON.stringify(held));
  assert.equal(w.entities.get(w.get('ana/can')!.id)!.in.slot, 'carry');
  const table = applyBatch(w, { ops: [{ op: 'move', id: w.get('table')!.id, in: { parent: ana, slot: 'carry' }, p: [0, 0, 0], r: 0 }] }, 'engine', 3).result;
  assert.equal(table.accepted, false); assert.equal((table as { failures: { code: string }[] }).failures[0].code, 'slot.incompatible');
});
