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

// A restore rebuilds the paged windows and re-bases the planner; neither may move the navigation epoch the snapshot
// recorded, or every walker in flight re-verifies its corridor, re-keys its narrows and re-smooths at once — a live world
// that kept running never does (Eden 2026 copy, 2026-10-31: a Soul restored mid-walk ended 0.2 m off the live one).
test('paged: a mid-walk restore keeps the navigation epoch, so the walk goes on exactly as live', () => {
  const a = wide('epoch-snap', ['h_ana']);
  const p0 = a.world.entities.h_ana.pose.p;
  a.perform({ actor: 'h_ana', label: 'far', steps: [{ verb: 'walk_to', params: { to: [p0[0] + 300, p0[2] + 60] } }] });
  for (let i = 0; i < 200; i++) a.step();
  const b = factory.restore(a.snapshot()) as never as Eng;
  const epoch = (e: Eng) => (e as never as { rt: { services: { spatial: { epoch: number } } } }).rt.services.spatial.epoch;
  assert.equal(epoch(b), epoch(a));
  for (let i = 0; i < 40; i++) { a.step(); b.step(); }
  // everything but the event-log cursor (a restored runtime starts its own log): the walk's epoch, narrows and smoothing too
  const body = (e: Eng) => { const s = e.snapshot() as never as { mars: { eventCursor?: number } }; delete s.mars.eventCursor; return s; };
  assert.deepEqual(body(b), body(a));
});

// A god world on the empty plain (the launcher's "Empty plain"): no bodies and no obstacle fixtures, so nothing but the
// world-edit changes. A new floor height re-bases the planner (refreshForWorld); the windows it already faced must be
// rebuilt with the new level and the new walls, not kept from before (release 1.1: every upper floor of a lighthouse and
// a cottage had "no standing room" until the world restarted, and the ground-floor walls were not there either).
test('paged: a world-edit that adds an upper floor to an empty world rebuilds the faced windows (floor standable, walls solid)', async () => {
  const { nextEntityPhysics } = await import('./entity-physics.ts');
  type Ev = Parameters<typeof nextEntityPhysics>[1];
  const e = factory.create(factory.genesis('empty-plain')) as never as Eng & {
    applyWorldEditV1(ev: Ev): { hash: string }; standableNearV1(at: [number, number], level?: number, except?: string, minClear?: number, maxRing?: number): [number, number] | null;
    reachV1(a: { p: [number, number]; level?: number }, b: { p: [number, number]; level?: number }): { ok: boolean; code?: string; message?: string };
  };
  e.installGroundV1(groundFact(emptyGround(1000), 1, { paged: true }));
  assert.equal(Object.keys(e.world.entities).length, 0, 'an empty plain');
  assert.equal(e.standableNearV1([20, 30], 0, undefined, 0.4, 0)?.join(), '20,30', 'the window is faced before the edit');
  const [cx, cz] = [20, 30];
  const wall = (id: string, c: [number, number], half: [number, number]) => ({ id, obb: { c, half, yaw: 0 }, y0: 0, y1: 5.6, kind: 'fixture' as const, label: 'house wall' });
  const set: Ev['set'] = { e_house1: {
    surfaces: [{ id: 'house:floor-1', level: 1, y: 2.85, obb: { c: [cx, cz], half: [3.9, 2.9], yaw: 0 } }],
    solids: [wall('house:n', [cx, cz - 3], [4, 0.11]), wall('house:e', [cx + 4, cz], [0.11, 3]), wall('house:w', [cx - 4, cz], [0.11, 3]), wall('house:s1', [cx - 2.275, cz + 3], [1.725, 0.11]), wall('house:s2', [cx + 2.275, cz + 3], [1.725, 0.11])],
    links: [{ id: 'house:stairs', kind: 'stairs', from: { level: 0, p: [cx + 3.2, cz + 1.6], y: 0 }, to: { level: 1, p: [cx + 3.2, cz - 1.6], y: 2.85 }, width: 1.1, heading: -Math.PI / 2, path: Array.from({ length: 17 }, (_, i) => [cx + 3.2, (2.85 * i) / 16, cz + 1.6 - (3.2 * i) / 16] as [number, number, number]), usable: true }],
  } };
  const ev: Ev = { contract: 'world-edit/1', seq: 1, hash: '', levels: [{ id: 1, y: 2.85, label: 'floor at 2.85 m' }], set, assets: {} };
  ev.hash = nextEntityPhysics(undefined, ev).hash;
  assert.equal(e.applyWorldEditV1(ev).hash, ev.hash);
  // the same answers as a world restored from a snapshot (which builds its windows fresh)
  const fresh = factory.restore(e.snapshot()) as never as typeof e;
  for (const w of [e, fresh]) {
    assert.ok(w.standableNearV1([cx - 2, cz - 1], 1, undefined, 0.4, 40), 'standing room on the new upper floor');
    assert.equal(w.standableNearV1([cx, cz - 3], 0, undefined, 0.4, 0), null, 'the north wall is solid on the ground');
    const up = w.reachV1({ p: [cx, cz + 8] }, { p: [cx - 2, cz - 1], level: 1 });
    assert.equal(up.ok, true, JSON.stringify(up));
  }
});
