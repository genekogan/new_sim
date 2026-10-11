// Paged navigation (lane NAV): every ground test again with `nav: 'paged/1'`, then the far walks it exists for — a Soul
// crosses 800 m of new land without stopping, a mid-walk snapshot restores identically, Souls far apart walk at once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.GROUND_PAGED = '1';
if (process.env.NAV_ONLY !== '1') await import('./ground.test.ts');
const { marsFactory, GREEN_FIELD_WORLD } = await import('./engine.ts');
const { groundFact } = await import('./ground-bridge.ts');
const { emptyGround } = await import('../../ground/src/index.ts');

const factory = await marsFactory(GREEN_FIELD_WORLD);
type Body = { pose: { p: [number, number, number] }; human: { activity: string; speed?: number } };
type Eng = ReturnType<typeof factory.create> & { installGroundV1(f: unknown): unknown; world: { entities: Record<string, Body> } };
function wide(seed: string, ids: string[]): Eng {
  const g = emptyGround(2000);
  g.extent = [-200, -1000, 1800, 1000];   // 2 km a side, the arrival near its west edge (as after `land extend east`)
  g.landforms.push({ id: 'ridge', kind: 'bump', c: [400, 30], r: 60, h: 6, peak: 1 });
  const e = factory.create(factory.genesis(seed)) as never as Eng;
  e.installGroundV1(groundFact(g, 1, { paged: true }));
  for (const id of ids) e.spawnHuman({ id, label: id, soul: `s_${id}` });
  return e;
}
const done = (e: Eng, id: string) => (e.step().programs as { id: string; kind: string; code?: string; message?: string }[]).find((p) => p.id === id && ['completed', 'failed', 'cancelled'].includes(p.kind));

test('paged: a Soul walks 800 m east to the far side of the world without stopping, along a near-straight line', () => {
  const e = wide('far', ['h_ana']);
  const b = e.world.entities.h_ana, from = [...b.pose.p];
  const adm = e.perform({ actor: 'h_ana', label: 'far', steps: [{ verb: 'walk_to', params: { to: [from[0] + 800, from[2]] } }] });
  assert.ok(adm.ok, JSON.stringify(adm));
  let end, slow = 0, n = 0, len = 0, last = [...b.pose.p];
  for (; n < 20 * 900 && !end; n++) {
    end = done(e, adm.id);
    const p = b.pose.p; len += Math.hypot(p[0] - last[0], p[2] - last[2]); last = [...p];
    if (n > 40 && !end && Math.hypot(p[0] - from[0] - 800, p[2] - from[2]) > 3 && (b.human.speed ?? 1) < 0.5) slow++;
  }
  assert.equal(end?.kind, 'completed', JSON.stringify(end));
  assert.ok(Math.hypot(b.pose.p[0] - from[0] - 800, b.pose.p[2] - from[2]) < 0.5, `arrived: ${b.pose.p}`);
  assert.ok(len < 800 * 1.03, `path ${len.toFixed(1)} m for 800 m`);
  assert.equal(slow, 0, 'never slows to a stop between chunks');
  assert.deepEqual((e as never as { runtime: { violations: unknown[] } }).runtime.violations, []);
});

test('paged: a snapshot taken mid far-walk restores and continues identically', () => {
  const a = wide('far-snap', ['h_ana']);
  const p0 = a.world.entities.h_ana.pose.p;
  a.perform({ actor: 'h_ana', label: 'far', steps: [{ verb: 'walk_to', params: { to: [p0[0] + 500, p0[2] + 120] } }] });
  for (let i = 0; i < 20 * 60; i++) a.step();
  const b = factory.restore(a.snapshot()) as never as Eng;
  for (let i = 0; i < 20 * 120; i++) { a.step(); b.step(); }
  assert.deepEqual(b.world.entities.h_ana.pose.p, a.world.entities.h_ana.pose.p);
  assert.equal(b.stateHash(), a.stateHash());
});
