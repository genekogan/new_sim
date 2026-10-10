// P4 (party lane): a Soul walks to what the god built, by name, with no flags — through the real host, sequencer,
// edge ledger and compiler. The god builds a fountain, a cottage "rose-house", a plaza with a bench, a pond with a
// bench by it (and an unnamed bench elsewhere); the Soul is told in plain words to walk to the fountain, go into
// rose-house and sit on the bench by the pond. Names resolve to offered `walk:<path>` / `sit:<id>` capabilities.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { coreRef } from '@sim/world-compiler';
import { fixture, invite, accept, factory } from '../../test/native-owner-fixture.ts';
import { EdgeLedger } from '../edge/ledger/ledger.ts';
import { GodMode } from './god.ts';
import { installEngineBridge } from './engine-bridge.ts';
import { parseNavWords } from './nav.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
test('nav words: verbs, targets and landmarks', () => {
  assert.deepEqual(parseNavWords('walk to the fountain'), { verb: 'walk', rest: 'the fountain', target: 'the fountain' });
  assert.equal(parseNavWords('go into rose-house')?.verb, 'enter');
  assert.equal(parseNavWords('enter rose-house')?.verb, 'enter');
  assert.deepEqual(parseNavWords('sit on the bench by the pond'), { verb: 'sit', rest: 'the bench by the pond', target: 'the bench', by: 'pond' });
  assert.deepEqual(parseNavWords('walk:plaza/bench-2'), { verb: 'walk', rest: 'plaza/bench-2', target: 'plaza/bench-2' });
  assert.equal(parseNavWords('sit:plaza/bench-2')?.verb, 'sit');
  assert.equal(parseNavWords('pray: please'), null);
  assert.equal(parseNavWords('wave to Bill'), null);
});

test('a Soul walks to the fountain, goes into rose-house and sits on the bench by the pond, by name, without flags', { timeout: 600000 }, async (t) => {
  const f = fixture(':memory:', factory, { durableClockV1: true });
  const god = new GodMode(f.db, { worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit: () => {} });
  const edge = new EdgeLedger(f.host, f.db);
  const bridge = installEngineBridge({ host: f.host, god, edge, log: () => {} });
  const settle = async (n = 4) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  f.brain.quiesce();
  t.after(() => { f.brain.quiesce(); f.host.stop(); f.db.close(); });
  await settle(2);
  const r = god.act({ ops: [
    { op: 'place', def: coreRef('fountain'), name: 'fountain', p: [8, 8] },
    { op: 'place', def: coreRef('cottage'), name: 'rose-house', p: [-14, 8] },
    { op: 'place', tmp: '$pl', def: coreRef('plaza'), name: 'plaza', shape: { area: [[0, -24], [16, -24], [16, -10], [0, -10]] } },
    { op: 'place', def: coreRef('bench'), name: 'bench-2', in: { parent: '$pl' }, p: [6, -16] },
    { op: 'place', def: coreRef('pond'), name: 'pond', shape: { area: [[-26, -24], [-16, -24], [-16, -14], [-26, -14]] }, params: { depth: 0.3, level: 0, edge: 1 } },
    { op: 'place', def: coreRef('bench'), name: 'pond-bench', p: [-21, -11] },
    { op: 'place', def: coreRef('bench'), p: [20, 14] },
  ] }, 'a little town') as any;
  assert.equal(r.accepted, true, JSON.stringify(r));
  await settle(3);
  const E = f.host.engine as any, id = (p: string) => god.model.get(p)!.id;

  await invite(f, 'ana');
  const row: any = await accept(f.host, f.souls.create('dev:ana', { name: 'Ana', description: 'curious' }));
  await settle(3);
  const soul = { soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner };
  const caps = edge.capabilities(soul).map((c) => c.id);
  for (const want of ['walk:fountain', 'walk:rose-house', 'walk:rose-house/living', 'walk:rose-house/kitchen', 'walk:plaza', 'walk:plaza/bench-2', 'walk:pond', 'walk:pond-bench'])
    assert.ok(caps.includes(want), `${want} offered: ${caps.filter((c) => c.startsWith('walk:')).join(' ')}`);
  const obs: any = edge.observe(soul, new Set());
  assert.ok(obs.built?.near?.some((x: any) => x.name === 'fountain' && x.walk === 'walk:fountain'), JSON.stringify(obs.built));
  assert.ok((edge as any).map().some((p: any) => p.id === 'rose-house/living' && p.capability === 'walk:rose-house/living'), 'the map lists rooms');

  const me = () => E.world.entities[row.entity_id];
  const done = async (n = 6000) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); if (i % 20 === 0) { await setImmediate(); f.host.drainInputs(); const o: any = edge.observe(soul, new Set()); if (i > 40 && !o.self.receipts.length) break; } } await settle(2); };

  // 1. "walk to the fountain"
  const a1: any = await accept(f.host, edge.act(soul, { capability: 'walk to the fountain' }));
  assert.equal(a1.accepted, true, JSON.stringify(a1)); assert.equal(a1.resolved?.to, 'walk:fountain', JSON.stringify(a1.resolved));
  await done();
  assert.ok(Math.hypot(me().pose.p[0] - 8, me().pose.p[2] - 8) < 3.2, `at the fountain: ${me().pose.p}`);

  // 2. "go into rose-house": through its front door into the room behind it
  const a2: any = await accept(f.host, edge.act(soul, { capability: 'go into rose-house' }));
  assert.equal(a2.accepted, true, JSON.stringify(a2)); assert.match(a2.resolved?.to, /^walk:rose-house\//);
  await done();
  const inside: any = (edge.observe(soul, new Set()) as any).built?.inside;
  assert.equal(inside?.building, 'rose-house', JSON.stringify(inside)); assert.equal(inside.room, a2.resolved.to.slice(5));

  // 3. "sit on the bench by the pond": the pond's bench, not the plaza's or the unnamed one
  const a3: any = await accept(f.host, edge.act(soul, { capability: 'sit on the bench by the pond', params: { seconds: 300 } }));
  assert.equal(a3.accepted, true, JSON.stringify(a3)); assert.equal(a3.resolved?.to, `sit:${id('pond-bench')}`);
  for (let i = 0; i < 6000 && me().human.activity !== 'sit'; i++) { f.host.tickOnce(); if (i % 20 === 0) { await setImmediate(); f.host.drainInputs(); } }
  assert.equal(me().human.activity, 'sit');
  assert.equal(E.bodyUsesV1(id('pond-bench'))?.body, row.entity_id, 'seated on the pond bench');

  // 4. ids work too: walk:<path>, sit:<path>, case/space slips; intents {verb:'go', target:{place}}
  const b: any = bridge;
  assert.equal(b.navResolve(edge, soul, { capability: 'walk:Rose House' })?.capability, 'walk:rose-house');
  assert.equal(b.navResolve(edge, soul, { capability: 'sit:plaza/bench-2' })?.capability, `sit:${id('plaza/bench-2')}`);
  assert.equal(b.navResolve(edge, soul, { verb: 'go', target: { place: 'fountain' } })?.capability, 'walk:fountain');
  assert.equal(b.navResolve(edge, soul, { capability: 'walk to the kitchen in rose-house' })?.capability, 'walk:rose-house/kitchen');
  assert.equal(b.navResolve(edge, soul, { capability: 'walk:fountain' }), null, 'an exact id is left alone');
  assert.equal(b.navResolve(edge, soul, { capability: 'walk to the moon' }), null, 'unknown names go to the ledger as before');
  assert.deepEqual(E.runtime.violations, []);
});
