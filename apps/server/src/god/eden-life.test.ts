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
      const r: any = edge.receipt(s.soulId, id); if (r && !['waiting', 'started'].includes(r.phase) && i % 20 === 0) return { r, seen };
    }
    return { r: edge.receipt(s.soulId, id) as any, seen };
  };
  return { ...f, god, edge, bridge, settle, soul, byName, body, act, souls };
}

test('B6: a resident warms up by a god-built core campfire, and not by one that is put out', { timeout: 600000 }, async (t) => {
  const w = await lifeWorld(t, [{ op: 'place', def: coreRef('campfire'), name: 'commons-fire', p: [0, 0] }]);
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
  // put out: refused with the reason and the way to light it
  assert.equal((w.god.act({ ops: [{ op: 'set', id: fire.id, state: { lit: false } }] }, 'put it out') as any).accepted, true);
  await w.settle(2);
  const out = w.edge.capabilities(ana).find((c: any) => c.id === `warm-by-fire:${fire.id}`);
  assert.equal(out?.available, false); assert.equal(out?.blocked?.code, 'fire.out');
  assert.deepEqual((w.host.engine as any).runtime.violations, []);
});
