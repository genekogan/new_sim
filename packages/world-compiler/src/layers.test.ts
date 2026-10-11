import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CORE_KIT, WorldModel, applyBatch, coreRef, describeSchedule, eventsOn, followPatch, isOpen, scheduleSlots, type Accepted, type Op, type Refused } from './index.ts';

function fresh() {
  const w = new WorldModel({ constants: { extent: 1000, ground: 'land' }, seed: 'layers' });
  for (const d of CORE_KIT) w.defineDef(d, 'core', 0);
  return w;
}
const ok = (r: ReturnType<typeof applyBatch>) => { assert.equal(r.result.accepted, true, JSON.stringify((r.result as Refused).failures)); return r; };
const refused = (r: ReturnType<typeof applyBatch>) => { assert.equal(r.result.accepted, false, 'expected refusal'); return (r.result as Refused).failures; };
const undo = (w: WorldModel, inv: Op[]) => ok(applyBatch(w, { ops: inv }, 'god', 9, { trusted: true }));

test('schedule clock: hours, past midnight, weekdays, events, follow', () => {
  const s = { open: [{ from: '07:00', to: '15:00' }, { from: '22:00', to: '02:00', days: ['fri' as const] }], events: [{ name: 'market', at: '09:00', minutes: 240, days: ['sat' as const] }], follow: [{ field: 'locked', when: 'open' as const, is: false, else: true }, { field: 'on', when: 'dark' as const, is: true, else: false }] };
  assert.equal(isOpen(s, 6 * 60 + 59, 1), false);
  assert.equal(isOpen(s, 7 * 60, 1), true);
  assert.equal(isOpen(s, 15 * 60, 1), false);
  assert.equal(isOpen(s, 23 * 60, 5), true, 'friday late');
  assert.equal(isOpen(s, 60, 6), true, 'saturday 01:00 is friday night');
  assert.equal(isOpen(s, 60, 0), false, 'sunday 01:00 is not');
  assert.deepEqual(eventsOn(s, 10 * 60, 6).map((e) => e.name), ['market']);
  assert.equal(eventsOn(s, 10 * 60, 5).length, 0, 'market only saturdays');
  assert.deepEqual(followPatch(s, 8 * 60, 1), { locked: false, on: false });
  assert.deepEqual(followPatch(s, 21 * 60, 1), { locked: true, on: true });
  assert.equal(describeSchedule(s), 'open 07:00–15:00; open 22:00–02:00 fris; market 09:00–13:00 sats');
  assert.deepEqual(scheduleSlots(s, 6, 'cafe').map((x) => [x.cron, x.durationMinutes, x.label]), [['0 7 * * *', 480, 'cafe open'], ['0 9 * * *', 240, 'market']]);
  assert.deepEqual(scheduleSlots(s, 1, 'cafe').map((x) => x.label), ['cafe open']);
});

test('owner, access, schedule, price: placed, set, cleared, undone exactly; follow fields checked', () => {
  const w = fresh();
  const r = ok(applyBatch(w, { ops: [
    { op: 'place', def: coreRef('door'), name: 'back-door', p: [0, 0], owner: 'soul:ana', access: 'private' },
    { op: 'place', def: coreRef('loaf'), name: 'loaf', p: [5, 0], owner: 'soul:ana', price: { amount: 3 } },
  ] }, 'god', 1));
  const door = w.get('back-door')!, before = structuredClone(door);
  assert.equal(door.owner, 'soul:ana'); assert.equal(door.access, 'private');
  assert.deepEqual(w.get('loaf')!.price, { amount: 3 });
  assert.ok(r.inverse!.length);
  const sched = { open: [{ from: '07:00', to: '15:00' }], follow: [{ field: 'locked', when: 'open', is: false, else: true }] };
  const s1 = ok(applyBatch(w, { ops: [{ op: 'set', id: 'back-door', schedule: sched, owner: 'group:bakers', access: null }] }, 'god', 2));
  assert.equal(w.get('back-door')!.owner, 'group:bakers'); assert.equal(w.get('back-door')!.access, undefined);
  assert.equal(w.get('back-door')!.schedule!.open![0].from, '07:00');
  undo(w, s1.inverse!);
  const back = w.get('back-door')!;
  assert.equal(back.owner, 'soul:ana'); assert.equal(back.access, 'private'); assert.equal(back.schedule, undefined);
  assert.deepEqual({ ...back, v: 0 }, { ...before, v: 0 });
  // follow names a field the def does not have / a wrong value
  assert.equal(refused(applyBatch(w, { ops: [{ op: 'set', id: 'back-door', schedule: { follow: [{ field: 'lit', when: 'dark', is: true }] } }] }, 'god', 3))[0].code, 'state.invalid');
  assert.equal(refused(applyBatch(w, { ops: [{ op: 'set', id: 'back-door', schedule: { follow: [{ field: 'locked', when: 'open', is: 'yes' }] } }] }, 'god', 3))[0].code, 'state.invalid');
  assert.equal(refused(applyBatch(w, { ops: [{ op: 'set', id: 'back-door', owner: 'ana' }] }, 'god', 3))[0].code, 'schema');
  assert.equal(refused(applyBatch(w, { ops: [{ op: 'set', id: 'back-door', schedule: { open: [{ from: '7am', to: '15:00' }] } }] }, 'god', 3))[0].code, 'schema');
});

test('economy: currency, mint, pay never below zero, all inverses exact', () => {
  const w = fresh();
  assert.equal(w.state.layers, undefined, 'a world without layers has no layers state');
  const c = ok(applyBatch(w, { ops: [{ op: 'economy', currency: 'shells' }, { op: 'mint', to: 'soul:ben', amount: 10 }, { op: 'mint', to: 'soul:ana', amount: 2 }] }, 'god', 1));
  assert.equal(w.state.layers!.currency, 'shells');
  assert.deepEqual(w.state.layers!.wallets, { 'soul:ben': 10, 'soul:ana': 2 });
  assert.equal(c.diff!.layers, true);
  assert.equal(c.diff!.world, undefined, 'viewers are not told about wallets');
  const p = ok(applyBatch(w, { ops: [{ op: 'pay', from: 'soul:ben', to: 'soul:ana', amount: 3, for: 'a loaf' }] }, 'engine', 2));
  assert.deepEqual(w.state.layers!.wallets, { 'soul:ben': 7, 'soul:ana': 5 });
  const f = refused(applyBatch(w, { ops: [{ op: 'pay', from: 'soul:ben', to: 'soul:ana', amount: 8 }] }, 'engine', 3));
  assert.equal(f[0].code, 'wallet.insufficient'); assert.match(f[0].detail, /7 shells/);
  assert.equal(refused(applyBatch(w, { ops: [{ op: 'mint', to: 'soul:ana', amount: -6 }] }, 'god', 3))[0].code, 'wallet.insufficient');
  assert.equal(refused(applyBatch(w, { ops: [{ op: 'pay', from: 'soul:ben', to: 'soul:ben', amount: 1 }] }, 'god', 3))[0].code, 'schema');
  undo(w, p.inverse!);
  assert.deepEqual(w.state.layers!.wallets, { 'soul:ben': 10, 'soul:ana': 2 });
  undo(w, c.inverse!);
  assert.deepEqual(w.state.layers, { wallets: {}, relations: [] });
});

test('relationships: on, idempotent, off, thing ends stored by id, undo', () => {
  const w = fresh();
  ok(applyBatch(w, { ops: [{ op: 'place', def: coreRef('zone'), name: 'old-town', shape: { area: [[0, 0], [60, 0], [60, 60], [0, 60]] }, params: { use: 'commercial' } }] }, 'god', 1));
  const zone = w.get('old-town')!;
  assert.equal(zone.params?.use, 'commercial');
  const r = ok(applyBatch(w, { ops: [{ op: 'relate', a: 'soul:ana', rel: 'works-at', b: 'thing:old-town' }, { op: 'relate', a: 'soul:ana', rel: 'friend', b: 'soul:ben' }] }, 'god', 2));
  assert.deepEqual(w.state.layers!.relations, [{ a: 'soul:ana', rel: 'works-at', b: `thing:${zone.id}` }, { a: 'soul:ana', rel: 'friend', b: 'soul:ben' }]);
  const again = ok(applyBatch(w, { ops: [{ op: 'relate', a: 'soul:ana', rel: 'friend', b: 'soul:ben' }] }, 'god', 3));
  assert.equal(again.inverse!.length, 0, 'already so: nothing to undo');
  assert.equal(refused(applyBatch(w, { ops: [{ op: 'relate', a: 'soul:ana', rel: 'lives-at', b: 'thing:nowhere' }] }, 'god', 3))[0].code, 'relation.invalid');
  assert.equal(refused(applyBatch(w, { ops: [{ op: 'relate', a: 'soul:ana', rel: 'enemy', b: 'soul:ben' }] }, 'god', 3))[0].code, 'schema');
  undo(w, r.inverse!);
  assert.deepEqual(w.state.layers!.relations, []);
});

test('a world that never uses layers is unchanged (state and entities carry no layer keys)', () => {
  const w = fresh();
  ok(applyBatch(w, { ops: [{ op: 'place', def: coreRef('bench'), name: 'b', p: [0, 0] }, { op: 'world', state: { sky: { palette: 'dusk' } } }] }, 'god', 1));
  assert.equal('layers' in w.state, false);
  const e = w.get('b')!; for (const k of ['owner', 'access', 'schedule', 'price']) assert.equal(k in e, false);
});
