// Lane BS1 (BUILDSAFE item 5): the use-check says a seat or bed can be used exactly when a body can actually sit or lie on
// it. A free bench and bed pass and a Soul sits and lies on them; a bench hemmed in by walls (no room to stand), one ringed
// by a thin wall (the sit/stand slide would cross it) and one sealed in a walled yard (cut off from the main ground) fail
// with a god-readable line each, and a Soul sent to sit on them never does. In-process CPU checks.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { coreRef } from '@sim/world-compiler';
import { fixture, invite, accept, factory } from '../../test/native-owner-fixture.ts';
import { EdgeLedger } from '../edge/ledger/ledger.ts';
import { GodMode } from './god.ts';
import { installEngineBridge } from './engine-bridge.ts';
import { useCheck } from './use-check.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
async function setup(t: TestContext) {
  const f = fixture(':memory:', factory, { durableClockV1: true });
  f.brain.quiesce();
  t.after(() => { f.brain.quiesce(); f.host.stop(); f.db.close(); });
  const god = new GodMode(f.db, { worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit: () => {} });
  const edge = new EdgeLedger(f.host, f.db);
  installEngineBridge({ host: f.host, god, edge, log: () => {} });
  const settle = async (n = 3) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  await settle();
  await invite(f, 'rowan');
  const row = await accept(f.host, f.souls.create('dev:rowan', { name: 'Rowan', description: 'use-check control' }));
  const soul = { soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner };
  await settle();
  const act = (ops: any[]) => { const r = god.act({ ops }) as any; assert.equal(r.accepted, true, JSON.stringify(r)); return r; };
  const until = async (ok: () => boolean, max = 1500) => { for (let i = 0; i < max && !ok(); i++) await settle(1); return ok(); };
  const human = () => f.host.engine.world.entities[soul.entityId].human as { activity: string; berth?: string };
  return { ...f, god, edge, soul, settle, act, until, human, E: f.host.engine as any };
}

// core-bench-seat: 1.37 × 0.31 m, two seats facing +z at x = ±0.35. Walls are core walls (w ≥ 0.5 m along x, d along z; turned a quarter for the ends).
const wall = (name: string, p: [number, number], w: number, d: number, r = 0) => ({ op: 'place', def: coreRef('wall'), name, p, r, params: { w, h: 2.6, d } });
const ring = (name: string, c: [number, number], hx: number, hz: number, d: number) => [
  wall(`${name}-n`, [c[0], c[1] + hz + d / 2], 2 * hx, d), wall(`${name}-s`, [c[0], c[1] - hz - d / 2], 2 * hx, d),
  wall(`${name}-e`, [c[0] + hx + d / 2, c[1]], 2 * (hz + d), d, Math.PI / 2), wall(`${name}-w`, [c[0] - hx - d / 2, c[1]], 2 * (hz + d), d, Math.PI / 2),
];

test('use-check: a seat or bed is usable exactly when a body can sit or lie on it', { timeout: 300_000 }, async (t) => {
  const w = await setup(t);
  w.act([
    { op: 'place', def: coreRef('bench-seat'), name: 'free-bench', p: [10, 10] },
    { op: 'place', def: coreRef('bed'), name: 'free-bed', p: [16, 10] },
    // hemmed in: 0.2 m of floor round the bench, then 1 m thick walls (every candidate stand point has < 0.34 m clear)
    { op: 'place', def: coreRef('bench-seat'), name: 'hemmed', p: [-20, 10] }, ...ring('hem', [-20, 10], 0.685 + 0.2, 0.155 + 0.2, 1),
    // ringed: a thin wall 3 cm off the bench all round; outside it there is standing room, but sliding on would cross it
    { op: 'place', def: coreRef('bench-seat'), name: 'ringed', p: [-20, -10] }, ...ring('rim', [-20, -10], 0.685 + 0.03, 0.155 + 0.03, 0.1),
    // sealed: a free bench in the middle of a 6 m walled yard with no way in
    { op: 'place', def: coreRef('bench-seat'), name: 'sealed', p: [20, -20] }, ...ring('yard', [20, -20], 3, 3, 0.3),
  ]);
  await w.settle(4);
  const id = (n: string) => w.god.model.get(n)!.id;
  const names = ['free-bench', 'free-bed', 'hemmed', 'ringed', 'sealed'];
  const all = useCheck(w.E, names.map(id), w.god.model);
  const by = (n: string) => all.filter((v) => v.of === id(n));
  console.log(all.map((v) => `${w.god.model.pathOf(v.of)} ${v.id.split('#')[1]} ${v.ok ? 'ok' : v.code}${v.line ? ` | ${v.line}` : ''}`).join('\n'));
  assert.deepEqual(by('free-bench').map((v) => [v.kind, v.ok]), [['seat', true], ['seat', true]]);
  assert.deepEqual(by('free-bed').map((v) => [v.kind, v.ok]), [['berth', true], ['berth', true]]);
  assert.deepEqual(by('hemmed').map((v) => v.code), ['use.no-approach', 'use.no-approach']);
  assert.deepEqual(by('ringed').map((v) => v.code), ['use.transition-blocked', 'use.transition-blocked']);
  assert.deepEqual(by('sealed').map((v) => v.code), ['nav.disconnected', 'nav.disconnected']);
  for (const v of all.filter((x) => !x.ok)) assert.match(v.line ?? '', /^(hemmed|ringed|sealed) seat-\d: cannot be sat on: /);
  assert.match(by('hemmed')[0].line!, /in the way: hem-n, hem-s\.$/);
  assert.match(by('ringed')[0].line!, /in the way: rim-[nsew]\.$/);
  // all fixtures by default (the walls have no slots), and the seat-top read: the bench's 0.465 m seat fits the standard body
  assert.equal(useCheck(w.E).length, all.length);
  assert.deepEqual(w.E.useCheckV1({ of: [id('free-bench')], seatTop: () => 1.3 }).map((v: any) => v.code), ['use.seat-fit', 'use.seat-fit'], 'a 1.3 m seat top is too high for the standard body (it sits on 0.2–1.2 m)');
  // what a body actually does: sits on the free bench and lies on the free bed, never gets onto the others
  const send = async (cap: string) => { const out = await accept(w.host, w.edge.act(w.soul, { capability: cap, params: { seconds: 2 } })) as any; return out; };
  const done = async (r: any) => { if (r.accepted) await w.until(() => ['completed', 'failed', 'cancelled'].includes(w.edge.receipt(w.soul.soulId, r.receipt.id)?.phase ?? '')); };
  let r = await send(`sit:${id('free-bench')}`);
  assert.equal(r.accepted, true, JSON.stringify(r));
  assert.ok(await w.until(() => w.human().activity === 'sit'), 'sits on the free bench');
  await done(r);
  r = await send(`lie:${id('free-bed')}`);
  assert.equal(r.accepted, true, JSON.stringify(r));
  assert.ok(await w.until(() => !!w.human().berth), 'lies on the free bed');
  await done(r);
  for (const n of ['hemmed', 'ringed', 'sealed']) {
    r = await send(`sit:${id(n)}`);
    let sat = false;
    if (r.accepted) { await w.until(() => (sat ||= w.human().activity === 'sit') || ['completed', 'failed', 'cancelled'].includes(w.edge.receipt(w.soul.soulId, r.receipt.id)?.phase ?? ''), 3000); }
    assert.equal(sat, false, `${n}: the body never sits (${JSON.stringify(r.accepted ? w.edge.receipt(w.soul.soulId, r.receipt.id) : r)})`);
  }
});
