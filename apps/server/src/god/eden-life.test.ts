// E-life (overnight 2026-10-17): residents of a god-built world (Eden 2026) do what they did in old Eden, through the
// real host, compiler, engine bridge and ledger. One focused case per behaviour; each fails on the trunk before its fix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { coreRef } from '@sim/world-compiler';
import { fixture, invite, accept, factory } from '../../test/native-owner-fixture.ts';
import { EdgeLedger } from '../edge/ledger/ledger.ts';
import { GodMode } from './god.ts';
import { installEngineBridge } from './engine-bridge.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function lifeWorld(t: any, ops: any[]) {
  const f = fixture(':memory:', factory, { durableClockV1: true });
  const god = new GodMode(f.db, { worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit: () => {} });
  const edge = new EdgeLedger(f.host, f.db);
  const bridge = installEngineBridge({ host: f.host, god, edge, log: () => {}, worldLore: true });
  const settle = async (n = 4) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  f.brain.quiesce();
  t.after(() => { f.brain.quiesce(); f.host.stop(); f.db.close(); });
  await settle(2);
  const r: any = god.act({ ops }, 'set the scene');
  assert.equal(r.accepted, true, JSON.stringify(r).slice(0, 800));
  await settle(3);
  const residents: any[] = [];
  const soul = async (name: string) => {
    await invite(f, name.toLowerCase());
    const row: any = await accept(f.host, f.souls.create(`dev:${name.toLowerCase()}`, { name, description: 'a resident' }));
    const s = { soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner }; residents.push(s); await settle(3); return s;
  };
  const byName = (n: string) => [...god.model.entities.values()].find((e: any) => e.name === n) as any;
  const body = (s: any) => (f.host.engine.world as any).entities[s.entityId];
  /** Act and tick until the receipt ends (or `until` holds while it runs); returns the receipt and what `until` saw. */
  const act = async (s: any, capability: string, params: Record<string, unknown> = {}, until?: () => unknown) => {
    const a: any = await accept(f.host, edge.act(s, { capability, params }));
    assert.equal(a.accepted, true, JSON.stringify(a).slice(0, 600));
    const id = a.receipt.id; let seen: unknown;
    for (let i = 0; i < 8000; i++) {
      f.host.tickOnce();
      if (i % 20 === 0) { await setImmediate(); f.host.drainInputs(); }
      if (until && !seen) { const v = until(); if (v) seen = v; }
      if ((f.host.engine as any).runtime.violations?.length) { console.error('[eden-life] engine violation', capability, JSON.stringify((f.host.engine as any).runtime.violations).slice(0, 1500)); break; }
      const r: any = edge.receipt(s.soulId, id); if (r && !['waiting', 'started'].includes(r.phase) && i % 20 === 0) return { r, seen };
    }
    return { r: edge.receipt(s.soulId, id) as any, seen };
  };
  return { ...f, god, edge, bridge, settle, soul, byName, body, act, residents };
}

test('B6: a resident warms up by a god-built core campfire, and not by one that is put out', { timeout: 600000 }, async (t) => {
  const w = await lifeWorld(t, [{ op: 'place', def: coreRef('campfire'), name: 'commons-fire', p: [0, 0] },
    { op: 'place', def: coreRef('bookcase'), name: 'camp-books', p: [8, 0] }, { op: 'place', def: coreRef('armchair'), name: 'camp-chair', p: [8, 3], r: Math.PI }]);
  const ana = await w.soul('Ana');
  const fire = w.byName('commons-fire');
  const caps = w.edge.capabilities(ana), cap = caps.find((c: any) => c.id === `warm-by-fire:${fire.id}`);
  assert.ok(cap?.available, 'warm-by-fire offered at the god campfire: ' + caps.filter((c: any) => /fire/.test(c.id)).map((c: any) => c.id).join(' '));
  assert.match(cap!.label, /commons fire/);
  assert.ok(caps.find((c: any) => c.id === `sit:${fire.id}`)?.available, 'its three logs are seats');
  const { r, seen } = await w.act(ana, cap!.id, { seconds: 10 }, () => {
    const b = w.body(ana), h = b?.human; if (h?.activity !== 'warm') return null;
    return { d: Math.hypot(b.pose.p[0], b.pose.p[2]) };
  });
  assert.ok(seen, 'the body took a place at the fire and warmed itself (activity warm)');
  assert.ok((seen as any).d > 1.2 && (seen as any).d < 2.4, `stood round the fire: ${JSON.stringify(seen)}`);
  assert.equal(r.phase, 'completed', JSON.stringify(r));
  // E-life proof: still holding a place at the fire, the next seated activity first leaves the circle (it faulted)
  assert.equal(w.body(ana).human.activity, 'warm');
  const read = w.edge.capabilities(ana).find((c: any) => c.id.startsWith('read:read.'))!;
  const rd = await w.act(ana, read.id, { seconds: 5 });
  assert.equal(rd.r.phase, 'completed', JSON.stringify(rd.r));
  // put out: refused with the reason and the way to light it
  assert.equal((w.god.act({ ops: [{ op: 'set', id: fire.id, state: { lit: false } }] }, 'put it out') as any).accepted, true);
  await w.settle(2);
  const out = w.edge.capabilities(ana).find((c: any) => c.id === `warm-by-fire:${fire.id}`);
  assert.equal(out?.available, false); assert.equal(out?.blocked?.code, 'fire.out');
  assert.deepEqual((w.host.engine as any).runtime.violations, []);
});

test('B1/B4/B8/B2/B3: god-built shelves, desks, easels, postboxes, tables and a piano are activity spots', { timeout: 900000 }, async (t) => {
  const w = await lifeWorld(t, [
    { op: 'world', state: { constitution: '# Eden (test)\nA small village.' } },
    { op: 'place', def: coreRef('bookcase'), name: 'oak-bookcase', p: [0, 12] },
    { op: 'place', def: coreRef('armchair'), name: 'reading-chair', p: [1.5, 15], r: Math.PI },
    { op: 'place', def: coreRef('desk'), name: 'writing-desk', p: [8, 12] },
    { op: 'place', def: coreRef('chair'), name: 'desk-chair', p: [8, 12.8], r: Math.PI },
    { op: 'place', def: coreRef('easel'), name: 'easel', p: [-8, 12] },
    { op: 'place', def: coreRef('postbox'), name: 'postbox', p: [-8, 20] },
    { op: 'place', def: coreRef('stove'), name: 'stove', p: [14, 20] },
    { op: 'place', def: coreRef('picnic-table'), name: 'picnic-table', p: [0, 2] },
    { op: 'place', def: coreRef('piano'), name: 'piano', p: [14, 6] },
    { op: 'place', def: coreRef('podium'), name: 'podium', p: [-20, 0] },
    { op: 'place', def: coreRef('bench'), name: 'audience-bench', p: [-20, 6], r: Math.PI },
    { op: 'place', def: coreRef('swings'), name: 'swings', p: [-20, 24] },
  ]);
  const ana = await w.soul('Ana');
  const caps = w.edge.capabilities(ana), ids = caps.map((c: any) => c.id);
  const want = ['read:read.', 'write:write.', 'paint:paint.', 'post-letter:post-letter.', 'cook:cook.', 'eat:eat.', 'drink:eat.', 'play-piano:play-piano.'];
  for (const p of want) assert.ok(ids.some((id: string) => id.startsWith(p)), `${p} offered: ${ids.filter((i: string) => /^(read|write|paint|post|cook|eat|drink|play)/.test(i)).join(' ')}`);
  t.diagnostic(JSON.stringify(w.bridge.activitySpots.stats));
  const outcomes: Record<string, string> = {};
  for (const p of ['read:read.', 'write:write.', 'paint:paint.', 'post-letter:post-letter.', 'cook:cook.', 'eat:eat.', 'play-piano:play-piano.', 'listen:listen.', 'swing:swing.']) {
    const cap = w.edge.capabilities(ana).find((c: any) => c.id.startsWith(p))!, pose = p.split(':')[0].replace('post-letter', 'post-letter');
    const { r, seen } = await w.act(ana, cap.id, { seconds: 6 }, () => w.body(ana)?.human?.activity === pose ? { at: w.body(ana).pose.p, base: w.body(ana).human.baseActivity } : null);
    if (p === 'read:read.') assert.match(String(r.outcome?.summary), /^Read .+, passage 1 of \d+\.$/, 'a book from the Eden library, not the constitution');
    if (p === 'read:read.') assert.ok(seen && Math.hypot((seen as any).at[0] - 1.5, (seen as any).at[2] - 15) < 1.0 && (seen as any).base === "sit", `read sitting in the armchair: ${JSON.stringify(seen)}`);
    if (p === 'play-piano:play-piano.') assert.ok(seen && Math.hypot((seen as any).at[0] - 14, (seen as any).at[2] - 6) < 1.2, `played from the piano bench: ${JSON.stringify(seen)}`);
    outcomes[p] = `${r.phase}${r.code ? ':' + r.code : ''}${seen ? ' seen' : ' NOT-SEEN'}`; console.error('[eden-life]', cap.id, outcomes[p], JSON.stringify(cap.label));
    if ((w.host.engine as any).runtime.violations?.length) break;
  }
  t.diagnostic(JSON.stringify(outcomes));
  for (const [k, v] of Object.entries(outcomes)) assert.equal(v, 'completed seen', `${k}: ${v}`);
  assert.deepEqual((w.host.engine as any).runtime.violations, []);
});

test('B5/B3: the E-life patch gym, courts and band things are activity spots residents use', { timeout: 900000 }, async (t) => {
  const { readFileSync } = await import('node:fs');
  const batch = JSON.parse(readFileSync(new URL('../../../../worlds/patches/eden-life-20261017/batch.json', import.meta.url), 'utf8'));
  const defines = batch.ops.filter((o: any) => o.op === 'define');
  const w = await lifeWorld(t, [...defines,
    { op: 'place', def: 'eden-pull-up-bar@1', name: 'pull-up-bar', p: [6, 10], r: 0 },
    { op: 'place', def: 'eden-weight-bench@1', name: 'bench-press', p: [10, 10], r: Math.PI / 2 },
    { op: 'place', def: 'eden-dumbbell-rack@1', name: 'dumbbells', p: [14, 10], r: 0 },
    { op: 'place', def: 'eden-microphone@1', name: 'mic', p: [-6, 10], r: 0 },
    { op: 'place', def: 'eden-music-stand-violin@1', name: 'violin', p: [-10, 10], r: 0 },
    { op: 'place', def: 'eden-volleyball-net@1', name: 'volleyball', p: [0, 30], r: 0 },
    { op: 'place', def: coreRef('see-saw'), name: 'see-saw', p: [-14, 22], r: 0 },
  ]);
  const ana = await w.soul('Ana'), bo = await w.soul('Bo');
  const ids = w.edge.capabilities(ana).map((c: any) => c.id);
  for (const p of ['pull-ups:', 'bench-press:', 'lift-weights:', 'sing:', 'play-music:', 'play-volleyball:', 'seesaw:']) assert.ok(ids.some((id: string) => id.startsWith(p)), `${p} offered: ${ids.filter((i: string) => /^(pull|bench|lift|sing|play|seesaw)/.test(i)).join(' ')}`);
  const outcomes: Record<string, string> = {};
  for (const [p, pose] of [['pull-ups:', 'pull-ups'], ['bench-press:', 'bench-press'], ['lift-weights:', 'lift-weights'], ['sing:', 'sing'], ['play-music:', 'play-music']] as const) {
    const cap = w.edge.capabilities(ana).find((c: any) => c.id.startsWith(p))!;
    const { r, seen } = await w.act(ana, cap.id, { seconds: 6 }, () => w.body(ana)?.human?.activity === pose ? { inst: w.body(ana).human.instrument ?? null } : null);
    outcomes[p] = `${r.phase}${r.code ? ':' + r.code : ''}${seen ? ' seen' : ' NOT-SEEN'}`; console.error('[eden-life]', cap.id, outcomes[p], JSON.stringify(seen));
    if (p === 'play-music:') assert.equal((seen as any)?.inst, 'violin');
  }
  for (const [k, v] of Object.entries(outcomes)) assert.equal(v, 'completed seen', `${k}: ${v}`);
  // volleyball: two residents play across the net (a game needs a partner: both receipts complete, both seen playing)
  const va = w.edge.capabilities(ana).find((c: any) => c.id.startsWith('play-volleyball:'))!;
  const a1: any = await accept(w.host, w.edge.act(ana, { capability: va.id, params: { seconds: 20 } }));
  assert.equal(a1.accepted, true, JSON.stringify(a1));
  await w.settle(20);
  const vb = w.edge.capabilities(bo).find((c: any) => c.id.startsWith('play-volleyball:') && c.available)!;
  const b1 = await w.act(bo, vb.id, { seconds: 20 }, () => w.body(ana)?.human?.activity === 'play-volleyball' && w.body(bo)?.human?.activity === 'play-volleyball' ? true : null);
  assert.ok(b1.seen, 'both played volleyball at once');
  assert.equal(b1.r.phase, 'completed', JSON.stringify(b1.r));
  assert.deepEqual((w.host.engine as any).runtime.violations, []);
});

test('B2: a resident cooks a pot (4 portions) at a prep table; eating draws them; none left refuses', { timeout: 900000 }, async (t) => {
  const w = await lifeWorld(t, [
    { op: 'place', tmp: '$prep', def: coreRef('long-table'), name: 'prep-table', p: [0, 14] },
    { op: 'place', def: coreRef('pot'), name: 'cooking-pot', in: { parent: '$prep', slot: 'top' }, p: [0, 0, 0] },
    { op: 'place', def: coreRef('picnic-table'), name: 'picnic-table', p: [8, 14] },
  ]);
  const ana = await w.soul('Ana');
  const eatCap = () => w.edge.capabilities(ana).find((c: any) => c.id.startsWith('eat:eat.'))!;
  const cook = w.edge.capabilities(ana).find((c: any) => c.id.startsWith('cook:cook.'));
  assert.ok(cook?.available, 'cook offered at the prep table with a pot: ' + w.edge.capabilities(ana).filter((c: any) => /^(cook|eat)/.test(c.id)).map((c: any) => c.id).join(' '));
  assert.match(cook!.label, /makes 4 portions/);
  assert.equal(eatCap().available, false); assert.equal(eatCap().blocked?.code, 'meal.none');
  const ck = await w.act(ana, cook!.id, { seconds: 5 });
  assert.equal(ck.r.phase, 'completed', JSON.stringify(ck.r));
  await w.settle(2);
  const e1 = eatCap(); assert.equal(e1.available, true, JSON.stringify(e1)); assert.match(e1.label, /\(4 portions left\)/);
  const ate = await w.act(ana, e1.id, { seconds: 5 });
  assert.equal(ate.r.phase, 'completed', JSON.stringify(ate.r));
  assert.equal(ate.r.meal?.left, 3, JSON.stringify(ate.r.meal));
  await w.settle(2);
  assert.match(eatCap().label, /\(3 portions left\)/);
  // three more, then none: the fifth is refused until someone cooks again
  for (let i = 0; i < 3; i++) { const r = await w.act(ana, eatCap().id, { seconds: 5 }); assert.equal(r.r.phase, 'completed'); await w.settle(2); }
  assert.equal(eatCap().blocked?.code, 'meal.none');
  // a drink needs no kitchen
  assert.ok(w.edge.capabilities(ana).find((c: any) => c.id.startsWith('drink:eat.'))?.available);
  // on a world with days, every kitchen starts each day with a morning pot (4 portions), never more than it had
  const { GodMeals } = await import('./meals.ts');
  let day = 'd1'; const m = new GodMeals({ db: w.db, worldId: 'morning-pot', spots: () => w.edge.spots, place: (id) => w.edge.places.byId.get(id) as never, day: () => day });
  const spot = w.edge.spots.spots.find((s: any) => s.activity === 'eat')!, k = m.kitchenFor(spot)!;
  assert.equal(m.stock(k.key).portions, 4);
  assert.ok(m.reserve(`eat:${spot.id}`, 'r_1')); assert.equal(m.stock(k.key).portions, 3);
  day = 'd2'; assert.equal(m.stock(k.key).portions, 4);
});

test('B9: a resident gives a talk at the podium; another attends it from a seat, only while it is given', { timeout: 900000 }, async (t) => {
  const w = await lifeWorld(t, [
    { op: 'place', def: coreRef('podium'), name: 'podium', p: [0, 14], r: Math.PI },
    { op: 'place', def: coreRef('bench'), name: 'front-bench', p: [0, 9] },
  ]);
  const ana = await w.soul('Ana'), bo = await w.soul('Bo');
  const attend = () => w.edge.capabilities(bo).find((c: any) => c.id.startsWith('attend:'))!;
  assert.equal(attend()?.available, false, 'nothing to attend yet: ' + JSON.stringify(attend()));
  assert.equal(attend().blocked?.code, 'together.nobody-leading');
  const talk = w.edge.capabilities(ana).find((c: any) => c.id.startsWith('lecture:'))!;
  assert.ok(talk?.available, 'lecture offered at the podium');
  const a: any = await accept(w.host, w.edge.act(ana, { capability: talk.id, params: { seconds: 120 } }));
  assert.equal(a.accepted, true, JSON.stringify(a));
  for (let i = 0; i < 400 && w.body(ana)?.human?.activity !== 'tell-story'; i++) { w.host.tickOnce(); if (i % 20 === 0) await w.settle(1); }
  assert.equal(w.body(ana).human.activity, 'tell-story', 'Ana is giving the talk');
  await w.settle(2);
  const at = attend(); assert.equal(at.available, true, JSON.stringify(at));
  const { r, seen } = await w.act(bo, at.id, { seconds: 10 }, () => w.body(bo)?.human?.activity === 'listen' && w.body(ana)?.human?.activity === 'tell-story' ? w.body(bo).human.baseActivity : null);
  assert.equal(seen, 'sit', 'Bo listened seated while Ana talked');
  assert.equal(r.phase, 'completed', JSON.stringify(r));
  assert.deepEqual((w.host.engine as any).runtime.violations, []);
});

test('B7: a god-built balloon is a native ride: a resident joins, flies its loop and steps out back home', { timeout: 900000 }, async (t) => {
  const { Hono } = await import('hono');
  const { mountEdgeRoutes, edgeSoulResolver } = await import('../edge/routes.ts');
  const w = await lifeWorld(t, [{ op: 'place', def: coreRef('balloon'), name: 'sky-balloon', p: [20, 20] }]);
  const app = new Hono(), comms = mountEdgeRoutes(app, { host: w.host, db: w.db, souls: w.souls, soul: edgeSoulResolver(w.host, w.souls, () => undefined), ledger: w.edge } as never);
  t.after(() => comms.close());
  const ana = await w.soul('Ana');
  for (let i = 0; i < 60; i++) await w.settle(1);
  const carrier = (w.host.engine as any).world.entities['sky-balloon'];
  assert.ok(carrier?.carrier, 'a native carrier was installed at the god balloon: ' + JSON.stringify(Object.keys((w.host.engine as any).world.entities).filter((k) => /balloon/.test(k))));
  assert.deepEqual([Math.round(carrier.pose.p[0]), Math.round(carrier.pose.p[2])], [20, 20]);
  const join = w.edge.capabilities(ana).find((c: any) => c.id === 'object:ride-sky-balloon:join');
  assert.ok(join?.available, 'join offered: ' + w.edge.capabilities(ana).filter((c: any) => /ride|balloon/.test(c.id)).map((c: any) => c.id).join(' '));
  const { r } = await w.act(ana, join!.id);
  assert.equal(r.phase, 'completed', 'seated in the basket: ' + JSON.stringify(r));
  let maxY = 0, landed = false;
  for (let i = 0; i < 20 * 420; i++) { w.host.tickOnce(); if (i % 20 === 0) await w.settle(1); const b = w.body(ana); maxY = Math.max(maxY, b.pose.p[1]); if (maxY > 20 && !b.human.carrier) { landed = true; break; } }
  assert.ok(maxY > 50, `flew up (max ${maxY.toFixed(1)} m)`);
  assert.ok(landed, 'landed and stepped out');
  assert.ok(Math.hypot(w.body(ana).pose.p[0] - 20, w.body(ana).pose.p[2] - 20) < 5, 'back at the launch spot');
  assert.deepEqual((w.host.engine as any).runtime.violations, []);
});
