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

/** Admit a ~30 m walk from the arrival to the first open spot among a few directions (the Green field has buildings). */
function walk30(e: Eng, from: number[]) {
  for (const [dx, dz] of [[30, 0], [-30, 0], [0, 30], [0, -30], [21, 21], [-21, 21], [21, -21], [-21, -21], [25, 5], [5, 25]]) {
    const adm = e.perform({ actor: 'h', label: 'walk', steps: [{ verb: 'walk_to', params: { to: [from[0] + dx, from[2] + dz] } }] });
    if (adm.ok) return adm;
  }
  assert.fail('no open spot 30 m from the arrival');
}

// BUILDSAFE (lane BS3) watchdog: a walk that makes no headway (here: its exec's pace forced to 0, so it stands 'running'
// for ever, the shape of every live "walking on the spot" report) replans once from where it stands after 15 s and ends
// honestly as walk.stuck after 30 s, instead of holding the Soul's receipt open for ever.
test('a walk with no headway replans once at 15 s and fails walk.stuck at 30 s', () => {
  const e = factory.create(factory.genesis('watchdog')) as never as Eng & { runtime: { services: { walkExecs?: Map<string, { speed: number; replans: number; watch?: { n: number; replanned: boolean } }> } } };
  e.spawnHuman({ id: 'h', label: 'Walker', soul: 's_h' });
  const b = e.world.entities.h, from = [...b.pose.p];
  const adm = walk30(e, from);
  e.step();
  const ex = [...(e as never as { rt: { services: { walkExecs?: Map<string, any> } } }).rt.services.walkExecs!.values()][0];
  assert.ok(ex, 'the walk has an exec');
  let end, n = 0, replannedAt = -1;
  for (; n < 900 && !end; n++) {
    ex.speed = 0;
    end = done(e, adm.id);
    if (replannedAt < 0 && ex.watch?.replanned) replannedAt = n;
  }
  assert.equal(end?.kind, 'failed', JSON.stringify(end));
  assert.equal(end?.code, 'walk.stuck', JSON.stringify(end));
  assert.match(end?.message ?? '', /made no headway for 30 s/);
  assert.ok(replannedAt >= 295 && replannedAt <= 310, `one forced replan near 15 s (tick ${replannedAt})`);
  assert.ok(n >= 595 && n <= 615, `ended near 30 s (tick ${n})`);
  assert.ok(Math.hypot(b.pose.p[0] - from[0], b.pose.p[2] - from[2]) < 0.5, 'it never moved');
  assert.equal((e as never as { rt: { services: { walkExecs?: Map<string, any> } } }).rt.services.walkExecs!.size, 0, 'the exec is gone');
});

test('a normal 30 m walk is never touched by the watchdog', () => {
  const e = factory.create(factory.genesis('watchdog-ok')) as never as Eng;
  e.spawnHuman({ id: 'h', label: 'Walker', soul: 's_h' });
  const from = [...e.world.entities.h.pose.p];
  const adm = walk30(e, from);
  let end; for (let n = 0; n < 2000 && !end; n++) end = done(e, adm.id);
  assert.equal(end?.kind, 'completed', JSON.stringify(end));
});
