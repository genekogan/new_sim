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
  const bridge = installEngineBridge({ host: f.host, god, edge, log: () => {} });
  const settle = async (n = 4) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  f.brain.quiesce();
  t.after(() => { f.brain.quiesce(); f.host.stop(); f.db.close(); });
  await settle(2);
  const r: any = god.act({ ops }, 'set the scene');
  assert.equal(r.accepted, true, JSON.stringify(r).slice(0, 800));
  await settle(3);
  const souls: any[] = [];
  const soul = async (name: string) => {
    await invite(f, name.toLowerCase());
    const row: any = await accept(f.host, f.souls.create(`dev:${name.toLowerCase()}`, { name, description: 'a resident' }));
    const s = { soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner }; souls.push(s); await settle(3); return s;
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
  return { ...f, god, edge, bridge, settle, soul, byName, body, act, souls };
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
  for (const p of ['read:read.', 'write:write.', 'paint:paint.', 'post-letter:post-letter.', 'eat:eat.', 'play-piano:play-piano.', 'cook:cook.', 'listen:listen.', 'swing:swing.']) {
    const cap = w.edge.capabilities(ana).find((c: any) => c.id.startsWith(p))!, pose = p.split(':')[0].replace('post-letter', 'post-letter');
    const { r, seen } = await w.act(ana, cap.id, { seconds: 6 }, () => w.body(ana)?.human?.activity === pose ? { at: w.body(ana).pose.p, base: w.body(ana).human.baseActivity } : null);
    if (p === 'read:read.') assert.ok(seen && Math.hypot((seen as any).at[0] - 1.5, (seen as any).at[2] - 15) < 1.0 && (seen as any).base === "sit", `read sitting in the armchair: ${JSON.stringify(seen)}`);
    if (p === 'play-piano:play-piano.') assert.ok(seen && Math.hypot((seen as any).at[0] - 14, (seen as any).at[2] - 6) < 1.2, `played from the piano bench: ${JSON.stringify(seen)}`);
    outcomes[p] = `${r.phase}${r.code ? ':' + r.code : ''}${seen ? ' seen' : ' NOT-SEEN'}`; console.error('[eden-life]', cap.id, outcomes[p], JSON.stringify(cap.label));
    if ((w.host.engine as any).runtime.violations?.length) break;
  }
  t.diagnostic(JSON.stringify(outcomes));
  for (const [k, v] of Object.entries(outcomes)) assert.equal(v, 'completed seen', `${k}: ${v}`);
  assert.deepEqual((w.host.engine as any).runtime.violations, []);
});
