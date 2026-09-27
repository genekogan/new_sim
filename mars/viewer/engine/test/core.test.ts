import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { sha256, stableStringify, hashOf } from '../core/hash.ts';
import { seedRng, nextRandom } from '../core/rng.ts';
import { WorldHistory } from '../history/store.ts';
import { Runtime } from '../runtime/runtime.ts';
import type { ActionDef } from '../actions/types.ts';
import { WORLD_SCHEMA, type WorldState } from '../world/types.ts';

const world = (): WorldState => ({
  schema: WORLD_SCHEMA,
  base: { campus: 'test', staticHash: 'x' },
  tick: 0,
  entities: {
    crate: { id: 'crate', def: 'crate', kind: 'component', pose: { p: [0, 0, 0], yaw: 0 }, provenance: { origin: 'test-fixture', confidence: 'hypothetical' }, support: { kind: 'ground' } },
  },
  regions: {},
  env: { datetime: '2026-03-01T16:00', weather: { clouds: 0, rain: 0, wind: 0, dust: 0, wet: 0 } },
  inventory: 'finite',
  rng: seedRng('t'),
});

test('sha256 matches node:crypto', () => {
  for (const s of ['', 'abc', 'x'.repeat(1000), 'ünïcødé 🚀', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64)])
    assert.equal(sha256(s), createHash('sha256').update(s).digest('hex'));
});

test('stableStringify is key-order independent and rejects NaN', () => {
  assert.equal(stableStringify({ b: 1, a: [1, { d: 2, c: -0 }] }), stableStringify({ a: [1, { c: 0, d: 2 }], b: 1 }));
  assert.throws(() => stableStringify({ x: NaN }));
});

test('rng is seeded, resumable and uniform-ish', () => {
  const a = seedRng('mars'), b = seedRng('mars');
  const xs = Array.from({ length: 1000 }, () => nextRandom(a));
  assert.deepEqual(xs, Array.from({ length: 1000 }, () => nextRandom(b)));
  const snap = [...a] as typeof a;
  const next = nextRandom(a);
  assert.equal(nextRandom(snap), next);
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  assert.ok(Math.abs(mean - 0.5) < 0.05);
});

test('fork isolation: canonical protected; sibling branches independent', () => {
  const h = new WorldHistory('rules/1');
  h.publishCanonical('mars-2026', 'Mars 2026 (canonical)', world(), 'test');
  assert.throws(() => h.commit('mars-2026', world(), { kind: 'design-edit', note: 'x' }), /protected/);
  h.fork('mars-2026', 'a', 'A');
  h.fork('mars-2026', 'b', 'B');
  const wa = h.read('a');
  wa.entities.crate.pose.p = [5, 0, 0];
  h.commit('a', wa, { kind: 'design-edit', note: 'move crate' });
  assert.deepEqual(h.read('mars-2026').entities.crate.pose.p, [0, 0, 0]);
  assert.deepEqual(h.read('b').entities.crate.pose.p, [0, 0, 0]);
  assert.deepEqual(h.read('a').entities.crate.pose.p, [5, 0, 0]);
  // mutating a read copy never mutates history
  const r = h.read('a');
  r.entities.crate.pose.p[0] = 99;
  assert.equal(h.read('a').entities.crate.pose.p[0], 5);
  assert.equal(h.log('a').length, 2);
  // round trip through JSON persistence
  const h2 = WorldHistory.fromJSON(JSON.parse(JSON.stringify(h.toJSON())));
  assert.equal(hashOf(h2.read('a')), hashOf(h.read('a')));
});

test('reconstruction edits and simulation events are distinct causes', () => {
  const h = new WorldHistory('rules/1');
  h.publishCanonical('c', 'C', world(), 't');
  h.fork('c', 'w', 'W');
  h.commit('w', world(), { kind: 'reconstruction-edit', note: 'learned wall 6 ft east', evidence: ['photo'] });
  const s = world();
  s.tick = 10;
  h.commit('w', s, { kind: 'simulation-run', take: 'take-1' });
  assert.deepEqual(h.log('w').map((c) => c.cause.kind), ['simulation-run', 'reconstruction-edit', 'canonical-publish']);
});

const nudge: ActionDef<{ id: string; dx: number }, { steps: number }, { id: string; left: number; dx: number }> = {
  verb: 'nudge',
  description: 'test',
  schema: z.strictObject({ id: z.string(), dx: z.number().min(-1).max(1) }),
  reservations: (_w, p) => [{ resource: `entity:${p.id}`, mode: 'exclusive' }],
  plan: (rt, p) => (rt.world.entities[p.id] ? { ok: true, program: { steps: 10 } } : { ok: false, diagnostic: { code: 'entity.unknown', message: `no ${p.id}` } }),
  start: (_rt, p, prog) => ({ id: p.id, left: prog.steps, dx: p.dx }),
  step: (rt, ex) => {
    rt.world.entities[ex.id].pose.p[0] += ex.dx / 10;
    return --ex.left > 0 ? { status: 'running', phase: 'moving' } : { status: 'completed' };
  },
  cancel: () => ({ ok: true }),
};

test('action lifecycle, reservations and diagnostics', () => {
  const rt = new Runtime(world(), new Map([['nudge', nudge]]), {});
  const a = rt.submit('nudge', { id: 'crate', dx: 1 });
  assert.equal(a.status, 'executing');
  assert.deepEqual(a.history.map((h) => h.status), ['requested', 'validated', 'reserved', 'executing']);
  const b = rt.submit('nudge', { id: 'crate', dx: -1 });
  assert.equal(b.status, 'failed');
  assert.equal(b.diagnostic?.code, 'reservation.conflict');
  assert.equal(rt.submit('nudge', { id: 'crate', dx: 5 }).diagnostic?.code, 'action.invalid-params');
  assert.equal(rt.submit('nudge', { id: 'ghost', dx: 1 }).diagnostic?.code, 'entity.unknown');
  assert.equal(rt.submit('fly', {}).diagnostic?.code, 'action.unknown-verb');
  assert.ok(rt.runUntilIdle());
  assert.equal(a.status, 'completed');
  assert.ok(Math.abs(rt.world.entities.crate.pose.p[0] - 1) < 1e-9);
  assert.equal(rt.submit('nudge', { id: 'crate', dx: 1 }).status, 'executing'); // released after completion
});
