import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { coreRef } from '@sim/world-compiler';
import { Hono } from 'hono';
import { fixture, invite, accept, factory } from '../../test/native-owner-fixture.ts';
import { EdgeLedger } from '../edge/ledger/ledger.ts';
import { GodMode, type WorldBuildMessage, type WorldDiffMessage } from './god.ts';
import { installEngineBridge } from './engine-bridge.ts';
import { VerifyUse } from './verify-use.ts';
import { inSite } from './builds.ts';
import { registerEdgeComms } from '../edge/comms/index.ts';
import { edgeSoulResolver } from '../edge/routes.ts';
import type { EdgeCapability } from '../edge/contract.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
function world(t: TestContext) {
  const w = fixture(':memory:', factory, { durableClockV1: true }); w.brain.quiesce();
  let now = 1_000_000;
  const emitted: (WorldBuildMessage | WorldDiffMessage)[] = [];
  const god = new GodMode(w.db, { worldId: w.host.worldId, ownerId: 'owner', tick: () => w.host.engine.world.tick, now: () => now, buildPauseMs: 50, buildClosureMs: 500, emit: (m: WorldBuildMessage | WorldDiffMessage) => emitted.push(m) });
  const edge = new EdgeLedger(w.host, w.db), bridge = installEngineBridge({ host: w.host, god, edge, log() {}, worldClock: false, worldLore: false });
  const token = god.mintFor({ id: 'owner', role: 'user' }, 'builder'), caller = god.godIdentity(token)!;
  t.after(() => { w.brain.quiesce(); w.host.stop(); edge.comms?.close(); w.db.close(); });
  const settle = async (n = 3) => { for (let i = 0; i < n; i++) { w.host.tickOnce(); await setImmediate(); w.host.drainInputs(); } };
  const soul = async (owner = 'ana', name = 'Ana') => { await invite(w, owner); const row: any = await accept(w.host, w.souls.create(`dev:${owner}`, { name, description: 'curious' })); await settle(3); return { soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner }; };
  const move = async (s: any, to: [number, number]) => { await accept(w.host, w.host.enqueue('edge-relocate', 'test:build', { soulId: s.soulId, entityId: s.entityId, to, why: 'build resident fixture' })); await settle(2); };
  const build = async () => {
    const r = god.act({ ops: [
      { op: 'define', def: { schema: 'def/1', name: 'resident-house', version: 1, tags: ['building'], size: { box: [8, 3, 6] }, make: { kind: 'gen', gen: 'building/1', args: { style: 'shed' } }, params: { floors: { type: 'int', min: 1, max: 6, default: 1 } }, components: { foundation: { kind: 'none' } } } },
      { op: 'place', tmp: '$h', def: 'resident-house@1', name: 'church', p: [10, 0] },
      { op: 'place', def: coreRef('chair'), name: 'pew', in: { parent: '$h', slot: 'ground' }, p: [-2, 0, -1] },
      { op: 'place', def: coreRef('bed'), name: 'bed', in: { parent: '$h', slot: 'ground' }, p: [2, 0, -1] },
    ] }); assert.equal(r.accepted, true, JSON.stringify(r)); await settle();
  };
  const start = (extra = {}) => { const r = god.builds.start({ id: 'church', title: 'Stone church', steps: ['shell', 'roof'], root: 'church', site: { at: [10, 0], size: [14, 12] }, ...extra }, caller) as any; assert.equal(r.ok, true, JSON.stringify(r)); return r; };
  const pos = (s: any): [number, number] => { const p = (w.host.engine.world as any).entities[s.entityId].pose.p; return [p[0], p[2]]; };
  const drive = async <T>(work: Promise<T>): Promise<T> => { let done = false; void work.then(() => { done = true; }, () => { done = true; }); const deadline = performance.now() + 15_000; while (!done && performance.now() < deadline) { for (let i = 0; i < 4; i++) w.host.tickOnce(); await new Promise(r => setTimeout(r, 1)); } assert.ok(done, 'native fixture drive completed'); return work; };
  return { ...w, god, edge, bridge, emitted, caller, token, settle, soul, move, build, start, pos, drive, advance: (ms: number) => { now += ms; } };
}
const cap = (w: ReturnType<typeof world>, s: any, id: string) => { const c = w.edge.capabilities(s).find(c => c.id === id); assert.ok(c, `${id} offered`); return c; };
const blocked = (c: EdgeCapability, code: string) => { assert.equal(c.available, false); assert.equal(c.blocked?.code, code); };

test('resident walk/hang-out, sit, lie and sleep refuse with the actual construction code at act time', async t => {
  const w = world(t); await w.build(); const s = await w.soul(); await w.move(s, [10, 9]); w.start(); await w.settle(1);
  const ids = ['walk:church', 'hang-out:church', `sit:${w.god.model.get('church/pew')!.id}`, `lie:${w.god.model.get('church/bed')!.id}`, `sleep:${w.god.model.get('church/bed')!.id}`];
  for (const id of ids) { blocked(cap(w, s, id), 'site.under-construction'); const r = await accept(w.host, w.edge.act(s, { capability: id })); assert.equal(r.accepted, false, JSON.stringify(r)); assert.equal((r as any).code, 'site.under-construction', id); }
  assert.match(w.bridge.layers.tag(w.god.model.get('church/pew')!), /^under construction \(step 1\/2: shell\)/);
  // A body born inside a site is never adopted into roots.
  const roots = JSON.parse(w.god.store.build('church')!.body).roots; assert.ok(!roots.includes(s.entityId));
});

test('construction outranks private access, then done exposes private refusals for every protected verb', async t => {
  const w = world(t); await w.build(); const s = await w.soul(); await w.move(s, [10, 9]);
  const r = w.god.act({ ops: [{ op: 'set', id: 'church', owner: 'soul:Other', access: 'private' }] }); assert.equal(r.accepted, true); w.start(); await w.settle(1);
  const ids = ['walk:church', 'hang-out:church', `sit:${w.god.model.get('church/pew')!.id}`, `lie:${w.god.model.get('church/bed')!.id}`, `sleep:${w.god.model.get('church/bed')!.id}`];
  for (const id of ids) blocked(cap(w, s, id), 'site.under-construction');
  w.god.builds.done('church', {}, w.caller); await w.settle(1);
  for (const id of ids) { blocked(cap(w, s, id), 'object.private'); const out = await accept(w.host, w.edge.act(s, { capability: id })); assert.equal((out as any).code, 'object.private', id); }
});

test('stroll and non-enclosed walk targets are closed; probe exemption preserves plans', async t => {
  const w = world(t); assert.equal(w.god.act({ ops: [{ op: 'place', def: coreRef('bench'), name: 'bench', p: [0, 0] }] }).accepted, true); await w.settle();
  w.start({ root: 'bench', site: { at: [0, 0], size: [10, 10] } });
  const target = w.god.model.get('bench')!.id, soul = { soulId: 's_test', entityId: 'h_test', name: 'Test', owner: 'owner' };
  for (const probe of [false, true]) {
    const caps = ['walk', 'hang-out', 'stroll'].map(verb => ({ id: `${verb}:bench`, verb, label: verb, available: true, target: { id: target, kind: 'object' } })) as EdgeCapability[];
    const plans = new Map(caps.map(c => [c.id, { label: c.label, steps: [] }]));
    w.bridge.layers.capabilities({ ...soul, soulId: probe ? 's_vp0000000001' : soul.soulId }, caps, plans, [10, 0]);
    for (const c of caps) if (probe) { assert.equal(c.available, true); assert.ok(plans.has(c.id)); } else { blocked(c, 'site.under-construction'); assert.ok(!plans.has(c.id)); }
  }
});

test('verify-use enters and sits at an open build; probe body never evacuates or becomes a root', { timeout: 30_000 }, async t => {
  const w = world(t); await w.build(); w.start();
  const verify = new VerifyUse(w.host, w.souls, w.god, w.edge);
  const r = await w.drive(verify.run({ target: 'church', seat: 'church/pew', timeoutMs: 12_000 }));
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.probe.removed, true);
  const events = w.db.events(w.host.worldId, 0, 10000); assert.ok(!events.some(e => e.kind === 'edge-relocate' && (e.payload as any).why === 'the god started building here: stepped off the site' && String((e.payload as any).soulId).startsWith('s_vp')));
  assert.equal(JSON.parse(w.god.store.build('church')!.body).roots.some((id: string) => id.startsWith('h_vp')), false);
});

test('idle resident steps off a newly marked site within 15 ticks; probes, busy, sleeping and upper bodies are skipped', async t => {
  const w = world(t), s = await w.soul(); await w.move(s, [0, 0]);
  w.start({ root: undefined, site: { at: [0, 0], size: [10, 10], yaw: .4 } });
  await w.settle(15); assert.equal(inSite({ at: [0, 0], size: [10, 10], yaw: .4 }, w.pos(s), .5), false, JSON.stringify(w.pos(s)));
  const ev = w.db.events(w.host.worldId, 0, 10000).filter(e => e.kind === 'edge-relocate' && (e.payload as any).why === 'the god started building here: stepped off the site'); assert.ok(ev.length > 0);
  const E = w.host.engine as any;
  // The same pass is exercised against the real body with transient busy postures, without scheduling an illegal activity.
  for (const patch of [{ sleepPose: {} }, { level: 1 }, { activity: 'sit' }]) { await accept(w.host, w.host.enqueue('edge-relocate', 'test:posture', { soulId: s.soulId, entityId: s.entityId, to: [0, 0], why: 'fixture posture' })); const b = E.world.entities[s.entityId], saved = structuredClone(b.human); Object.assign(b.human, patch); w.bridge.evacuateSites(); b.human = saved; w.host.drainInputs(); assert.ok(inSite({ at: [0, 0], size: [10, 10], yaw: .4 }, w.pos(s))); }
});

test('seated resident is kept in place and protects occupied building; after stand, cadence evacuates without another god edit', { timeout: 30_000 }, async t => {
  const w = world(t); await w.build(); const s = await w.soul(); await w.move(s, [10, 8]); const E = w.host.engine as any;
  const sit = await accept(w.host, w.edge.act(s, { capability: `sit:${w.god.model.get('church/pew')!.id}`, params: { seconds: 1 } })); assert.equal(sit.accepted, true, JSON.stringify(sit));
  for (let i = 0; i < 3000 && E.world.entities[s.entityId].human.activity !== 'sit'; i++) { w.host.tickOnce(); if (i % 20 === 0) { await setImmediate(); w.host.drainInputs(); } }
  await w.settle(40); assert.equal(E.world.entities[s.entityId].human.activity, 'sit'); const before = w.pos(s), start = w.start(); await w.settle(45); assert.deepEqual(w.pos(s), before);
  const edit = w.god.act({ ops: [{ op: 'set', id: 'church', params: { floors: 2 } }], build: { id: 'church', lease: start.lease } }) as any; assert.equal(edit.accepted, false); assert.equal(edit.failures[0].code, 'occupied.by-body');
  assert.equal((await accept(w.host, w.edge.act(s, { capability: 'stand:here' }))).accepted, true); await w.settle(40);
  if (E.world.entities[s.entityId].human.activity === 'sit') { assert.equal((await accept(w.host, w.edge.act(s, { capability: 'stand:here' }))).accepted, true); await w.settle(40); }
  await w.settle(40);
  assert.equal(inSite({ at: [10, 0], size: [14, 12], yaw: 0 }, w.pos(s), .5), false, JSON.stringify({ p: w.pos(s), human: E.world.entities[s.entityId].human, program: E.programOf(s.entityId), reach: [[1.5,0],[18.5,0],[10,7.5],[10,-7.5]].map(p => E.reachV1({p:w.pos(s),level:0},{p,level:0})) }));
});

test('closure lift, done and abandon reopen capabilities; lifted build keeps its slot', async t => {
  const w = world(t); await w.build(); const s = await w.soul(); await w.move(s, [10, 9]); w.start(); await w.settle(1); blocked(cap(w, s, 'walk:church'), 'site.under-construction');
  w.advance(501); w.god.builds.sweep(); await w.settle(1); assert.equal(cap(w, s, 'walk:church').available, true); assert.equal(w.bridge.layers.active(), false); assert.equal(w.god.builds.list().open.length, 1);
  assert.ok(w.emitted.some(m => m.kind === 'world-build' && m.event === 'closure-lifted' && m.delta?.closed === false));
  const resume = w.god.builds.resume('church', {}, w.caller); assert.equal(resume.ok, true); await w.settle(1); blocked(cap(w, s, 'walk:church'), 'site.under-construction');
  w.god.builds.done('church', {}, w.caller); await w.settle(1); assert.equal(cap(w, s, 'walk:church').available, true); assert.equal(w.bridge.layers.active(), false);
  w.start({ id: 'renovation' }); await w.settle(1); blocked(cap(w, s, 'walk:church'), 'site.under-construction'); w.god.builds.abandon('renovation', {}, () => ({ accepted: true, reverted: [], notReverted: [] })); await w.settle(1); assert.equal(cap(w, s, 'walk:church').available, true);
});

test('bench: capabilities for 20 Souls, idle evacuation with 8 sites', { skip: process.env.BUILD_BENCH !== '1', timeout: 120_000 }, async t => {
  const w = world(t); await w.build();
  const souls: Awaited<ReturnType<typeof w.soul>>[] = []; for (let i = 0; i < 20; i++) souls.push(await w.soul(`bench${i}`, `Resident${i}`));
  const stats = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return { p50: s[Math.floor(s.length * .5)], p95: s[Math.floor(s.length * .95)] }; };
  const measure = () => { const samples: number[] = []; for (let i = 0; i < 30; i++) { w.host.engine.world.tick++; const start = performance.now(); for (const soul of souls) w.edge.capabilities(soul); samples.push(performance.now() - start); } return stats(samples); };
  measure(); const plain = measure(); w.start(); measure(); const build = measure();
  for (let i = 1; i < 8; i++) w.start({ id: `site-${i}`, root: undefined, site: { at: [i * 20 - 80, 40], size: [10, 10] } });
  const samples: number[] = []; for (let i = 0; i < 100; i++) { const start = performance.now(); w.bridge.evacuateSites(); samples.push(performance.now() - start); }
  console.log('RESIDENT_BENCH ' + JSON.stringify({ capabilities20Ms: { plain, build }, evacuate20x8Ms: stats(samples) }));
});

test('C1b #9: plans into a closing site are blocked even when their named plaza surrounds it', async t => {
  const w = world(t);
  assert.equal(w.god.act({ ops: [{ op: 'place', def: coreRef('plaza'), name: 'square', shape: { area: [[-16, -16], [16, -16], [16, 16], [-16, 16]] } }] }).accepted, true); await w.settle();
  const s = await w.soul(); await w.move(s, [0, 30]);
  w.start({ root: undefined, site: { at: [0, 0], size: [10, 10] } }); await w.settle(1);
  for (const id of ['walk:square', 'hang-out:square']) {
    blocked(cap(w, s, id), 'site.under-construction');
    const result = await accept(w.host, w.edge.act(s, { capability: id })); assert.equal((result as any).code, 'site.under-construction');
  }
  // Stroll routes vary with the plaza seed. Every retained stop must be outside the closure.
  const stroll = cap(w, s, 'stroll:square'), plan = w.edge.coreA.binds(s).plans.get(stroll.id);
  if (stroll.available) { assert.ok(plan); for (const step of plan.steps) if (step.verb === 'walk_to') assert.equal(inSite({ at: [0, 0], size: [10, 10], yaw: 0 }, step.params.to as [number, number], .5), false); }
  else { blocked(stroll, 'site.under-construction'); assert.equal(plan, undefined); }
  const synthetic = { id: 'stroll:square', verb: 'stroll', label: 'stroll', available: true } as EdgeCapability;
  const plans = new Map([[synthetic.id, { label: 'stroll', steps: [{ verb: 'walk_to', params: { to: [20, 20] } }, { verb: 'mars:walk_to', params: { x: 0, z: 0 } }] }]]);
  w.bridge.layers.capabilities(s, [synthetic], plans, [0, 30]); blocked(synthetic, 'site.under-construction'); assert.equal(plans.size, 0);
  w.god.builds.done('church', {}, w.caller); await w.settle(1); assert.equal(cap(w, s, 'walk:square').available, true);
});

test('C1b #10: approach by id/name and go-near cannot bypass membership or destination closure', async t => {
  const w = world(t); assert.equal(w.god.act({ ops: [{ op: 'place', def: coreRef('bench'), name: 'bench', p: [30, 0] }] }).accepted, true); await w.settle();
  const s = await w.soul(), other = await w.soul('bo', 'Bo'); await w.move(s, [30, 12]); await w.move(other, [30, 7.5]);
  const bench = w.god.model.get('bench')!.id, E = w.host.engine as any;
  assert.equal((await accept(w.host, w.edge.act(other, { capability: `sit:${bench}`, params: { seconds: 1 } }))).accepted, true);
  for (let i = 0; i < 3000 && E.world.entities[other.entityId].human.activity !== 'sit'; i++) { w.host.tickOnce(); if (i % 20 === 0) { await setImmediate(); w.host.drainInputs(); } }
  await w.settle(40); assert.equal(E.world.entities[other.entityId].human.activity, 'sit');
  w.start({ root: 'bench', site: { at: [30, 0], size: [10, 10] } }); await w.settle(1);
  for (const target of [bench, 'bench', other.soulId]) {
    const dry = w.edge.intents.resolve(s, { verb: 'approach', target }); assert.equal(dry.ok, false, JSON.stringify({ target, dry })); assert.equal(!dry.ok && dry.code, 'site.under-construction');
    const result = await accept(w.host, w.edge.act(s, { verb: 'approach', target })); assert.equal(result.accepted, false); assert.equal((result as any).code, 'site.under-construction');
  }
  const near = `go-near:${other.soulId}`; blocked(cap(w, s, near), 'site.under-construction');
  assert.equal((await accept(w.host, w.edge.act(s, { capability: near })) as any).code, 'site.under-construction');
  assert.equal(E.programOf(s.entityId), null);
  w.god.builds.done('church', {}, w.caller); await w.settle(1); assert.equal(w.edge.intents.resolve(s, { verb: 'approach', target: bench }).ok, true); assert.equal(cap(w, s, near).available, true);
});

test('C1b #11: read and every model-object target honor closure while private access keeps its verb scope', async t => {
  const w = world(t);
  const comms = registerEdgeComms(new Hono(), { host: w.host, db: w.db, souls: w.souls, soul: edgeSoulResolver(w.host, w.souls, () => undefined), ledger: w.edge } as any, { sweepMs: 0 } as any); w.edge.attachComms(comms as any);
  try {
    assert.equal(w.god.act({ ops: [{ op: 'place', def: coreRef('sign'), name: 'notice', p: [10, 0], state: { text: 'Opening soon' }, owner: 'soul:Other', access: 'private' }] }).accepted, true); await w.settle();
    const s = await w.soul(); await w.move(s, [10, 12]); w.start({ root: 'notice' }); await w.settle(1);
    const target = w.god.model.get('notice')!.id, read = `read:${target}`;
    blocked(cap(w, s, read), 'site.under-construction'); assert.equal((await accept(w.host, w.edge.act(s, { capability: read })) as any).code, 'site.under-construction');
    const caps = ['read', 'inspect', 'play'].map(verb => ({ id: `${verb}:${target}`, verb, label: verb, target: { id: target, kind: 'object' }, available: true })) as EdgeCapability[];
    const plans = new Map(caps.map(c => [c.id, { label: c.label, steps: [] }]));
    w.bridge.layers.capabilities(s, caps, plans, [10, 12]); for (const c of caps) blocked(c, 'site.under-construction');
    w.god.builds.done('church', {}, w.caller); await w.settle(1); assert.equal(cap(w, s, read).available, true, 'read is not subject to private-seat/hand restrictions');
  } finally { (comms as any).close(); }
});

test('C1b #12: sit:here chooses the nearest usable seat and named sit reports the construction code', async t => {
  const w = world(t);
  assert.equal(w.god.act({ ops: [{ op: 'place', def: coreRef('bench'), name: 'inner', p: [30, 0] }, { op: 'place', def: coreRef('bench'), name: 'outer', p: [30, 17] }] }).accepted, true); await w.settle();
  const s = await w.soul(); await w.move(s, [30, 7.5]); w.start({ root: 'inner', site: { at: [30, 0], size: [6, 6] } }); await w.settle(1);
  const inner = w.god.model.get('inner')!.id, outer = w.god.model.get('outer')!.id;
  blocked(cap(w, s, `sit:${inner}`), 'site.under-construction'); assert.equal(cap(w, s, `sit:${outer}`).available, true);
  const here = cap(w, s, 'sit:here'); assert.equal(here.available, true); assert.equal(here.target?.id, outer); assert.equal(here.blocked, undefined);
  const named = await accept(w.host, w.edge.act(s, { verb: 'sit', target: inner })); assert.equal(named.accepted, false); assert.equal((named as any).code, 'site.under-construction');
  const result = await accept(w.host, w.edge.act(s, { capability: 'sit:here' })); assert.equal(result.accepted, true, JSON.stringify(result));
});
