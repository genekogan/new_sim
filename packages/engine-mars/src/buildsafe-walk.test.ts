// BUILDSAFE (lane BS3): Souls never stuck. (a) A jog/run slows to walking pace before and in shallow water on every
// paged chunk, not only the first one walk_to.plan checks (eden-2026: "run to the lighthouse" faulted motion.overspeed
// 2.25 m/s in activity wade on its third chunk).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marsFactory, GREEN_FIELD_WORLD } from './engine.ts';
import { groundFact } from './ground-bridge.ts';
import { emptyGround } from '../../ground/src/index.ts';

const factory = await marsFactory(GREEN_FIELD_WORLD);
type Body = { pose: { p: [number, number, number] }; human: { activity: string; speed?: number } };
type Eng = ReturnType<typeof factory.create> & { installGroundV1(f: unknown): unknown; world: { entities: Record<string, Body> }; runtime: { violations: unknown[] } };
const done = (e: Eng, id: string) => (e.step().programs as { id: string; kind: string; code?: string; message?: string }[]).find((p) => p.id === id && ['completed', 'failed', 'cancelled'].includes(p.kind));

/** A 2 km paged world with a shallow ford (0.2 m deep) across the whole world 150 m east of the arrival: no dry way round. */
function ford(seed: string): Eng {
  const g = emptyGround(2000);
  g.extent = [-200, -1000, 1800, 1000];
  const area: [number, number][] = [[140, -1000], [152, -1000], [152, 1000], [140, 1000]];
  g.landforms.push({ id: 'ford', kind: 'carve', area, bed: -0.2, edge: 1 });
  g.waters.push({ id: 'ford', area, level: 0 });
  const e = factory.create(factory.genesis(seed)) as never as Eng;
  e.installGroundV1(groundFact(g, 1, { paged: true }));
  e.spawnHuman({ id: 'h', label: 'Runner', soul: 's_h' });
  return e;
}

for (const gait of ['run', 'jog'] as const) test(`paged: a ${gait} across a ford on a later chunk wades at walking pace and runs on the far side`, () => {
  const e = ford(`ford-${gait}`), b = e.world.entities.h, from = [...b.pose.p];
  const adm = e.perform({ actor: 'h', label: gait, steps: [{ verb: 'walk_to', params: { to: [from[0] + 260, from[2]], gait } }] });
  assert.ok(adm.ok, JSON.stringify(adm));   // the first chunk is dry: admitted
  let end, wadeMax = 0, fast = 0, fastAfter = 0;
  for (let n = 0; n < 20 * 400 && !end; n++) {
    end = done(e, adm.id);
    const sp = b.human.speed ?? 0;
    if (b.human.activity === 'wade') wadeMax = Math.max(wadeMax, sp);
    if (b.human.activity === gait) { fast++; if (b.pose.p[0] > 155) fastAfter++; }
  }
  assert.equal(end?.kind, 'completed', JSON.stringify(end));
  assert.deepEqual(e.runtime.violations, []);
  assert.ok(wadeMax > 0.5 && wadeMax <= 1.4 + 1e-9, `waded at ${wadeMax} m/s`);
  assert.ok(fast > 0 && fastAfter > 0, `ran before and after the ford (${fast}, ${fastAfter})`);
  assert.ok(Math.hypot(b.pose.p[0] - from[0] - 260, b.pose.p[2] - from[2]) < 0.5, `arrived: ${b.pose.p}`);
});
