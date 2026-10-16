// r2.1 fix 4b (release 2 → 2.1): building/1 moved its facade frames onto solid wall. A wall run with no clear wall keeps
// its release-2 frame as a *retired* slot, so a lantern a god mounted there in release 2 loads where it was and stays
// editable, while nothing new can be mounted there (refused as slot.unknown, naming the live frames). Undo/trusted ops
// are never refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CORE_KIT, WorldModel, applyBatch, type Accepted, type Refused } from './index.ts';

function fresh() { const w = new WorldModel({ constants: { extent: 1000, ground: 'land' }, seed: 'retired' }); for (const d of CORE_KIT) w.defineDef(d, 'core', 0); return w; }
const ok = (r: ReturnType<typeof applyBatch>) => { assert.equal(r.result.accepted, true, JSON.stringify((r.result as Refused).failures)); return r.result as Accepted; };
const refused = (r: ReturnType<typeof applyBatch>) => { assert.equal(r.result.accepted, false, 'expected a refusal'); return (r.result as Refused).failures[0]; };

/** A release-2 world: the default cottage with lanterns on facade-f0-w-1 (retired in 2.1) and facade-f0-w-2 (live). */
function release2World() {
  const w = fresh();
  ok(applyBatch(w, { ops: [{ op: 'place', def: 'core/cottage@1', name: 'house', p: [0, 0] }] }, 'god', 1));
  const house = w.get('house')!;
  const slots = w.slotsOf(house);
  assert.equal(slots.find((s) => s.id === 'facade-f0-w-1')?.retired, true, 'the default cottage retires facade-f0-w-1');
  assert.ok(slots.find((s) => s.id === 'facade-f0-w-2' && !s.retired), 'facade-f0-w-2 stays live');
  // release 2 accepted both mounts; write them straight into a snapshot (as the release-2 DB has them) and load it
  const snap = w.snapshot();
  const mount = (id: string, name: string, slot: string) => ({ id, def: 'core/lantern@1', in: { parent: house.id, slot }, by: 'god', born: 2, v: 1, name, p: [0, 0] as [number, number] });
  snap.entities.push(mount('e_lan_w1', 'lan-w-1', 'facade-f0-w-1') as never, mount('e_lan_w2', 'lan-w-2', 'facade-f0-w-2') as never);
  return WorldModel.fromSnapshot(snap);
}

test('a release-2 mount on a retired frame loads at its release-2 spot (not the building origin)', () => {
  const w = release2World();
  const lan = w.get('house/lan-w-1')!; assert.ok(lan, 'the mount loads');
  const pose = w.worldPose(lan);
  // release 2 had facade-f0-w-1 at (-4.02, 1.4, -1.445) in the cottage frame; the cottage stands at the origin, unrotated
  assert.ok(Math.abs(pose.x - -4.02) < 0.05 && Math.abs(pose.y - 1.4) < 0.05 && Math.abs(pose.z - -1.445) < 0.05, JSON.stringify(pose));
});

test('the mount stays editable inside its retired frame (set, nudge) and can leave it', () => {
  const w = release2World();
  ok(applyBatch(w, { ops: [{ op: 'move', id: 'house/lan-w-1', p: [0.1, 0, 0] }] }, 'god', 3));
  assert.equal(w.get('house/lan-w-1')!.in.slot, 'facade-f0-w-1');
  ok(applyBatch(w, { ops: [{ op: 'move', id: 'house/lan-w-1', in: { parent: 'house', slot: 'facade-f0-s-1' }, p: [0, 0] }] }, 'god', 4));
  assert.equal(w.get('house/lan-w-1')!.in.slot, 'facade-f0-s-1');
});

test('nothing new can be mounted on a retired frame: place and move-in are refused, naming the live frames', () => {
  const w = release2World();
  const f = refused(applyBatch(w, { ops: [{ op: 'place', def: 'core/lantern@1', name: 'new', in: { parent: 'house', slot: 'facade-f0-w-1' }, p: [0, 0] }] }, 'god', 3));
  assert.equal(f.code, 'slot.unknown');
  assert.match(f.detail, /retired/); assert.match(f.detail, /facade-f0-w-2/);
  assert.equal(f.field, 'in.slot'); assert.match(f.fix ?? '', /Mount on facade-/);
  const g = refused(applyBatch(w, { ops: [{ op: 'move', id: 'house/lan-w-2', in: { parent: 'house', slot: 'facade-f0-w-1' }, p: [0, 0] }] }, 'god', 4));
  assert.equal(g.code, 'slot.unknown');
});

test('trusted ops (undo/redo) may still put a thing back on a retired frame', () => {
  const w = release2World();
  ok(applyBatch(w, { ops: [{ op: 'remove', id: 'house/lan-w-1' }] }, 'god', 3));
  ok(applyBatch(w, { ops: [{ op: 'place', def: 'core/lantern@1', name: 'back', in: { parent: 'house', slot: 'facade-f0-w-1' }, p: [0, 0] }] }, 'god', 4, { trusted: true }));
  assert.equal(w.get('house/back')!.in.slot, 'facade-f0-w-1');
});
