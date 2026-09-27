import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { sha256, stableStringify, hashOf } from '../core/hash.ts';
import { seedRng, nextRandom } from '../core/rng.ts';
import { dacos, dasin, datan, datan2, dcos, dexp, dlog, dsin, dtan } from '../core/math.ts';
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

// ---- deterministic transcendentals (core/math.ts) --------------------------
// The host's Math.* is only the accuracy reference here (reached by name so the
// source scan below stays clean); the engine itself must never call it.
const libm = Math as unknown as Record<string, (...a: number[]) => number>;
const F = new Float64Array(1), B = new BigUint64Array(F.buffer);
const bits = (x: number) => { F[0] = x; return '0x' + B[0].toString(16).padStart(16, '0'); };
/** Distance in units in the last place between two finite doubles (signed-magnitude -> ordered integers). */
const ulps = (a: number, b: number) => {
  if (a === b) return 0;
  const ord = (x: number) => { F[0] = x; const v = B[0]; return v >= 1n << 63n ? -(v - (1n << 63n)) : v; };
  const d = ord(a) - ord(b);
  return Number(d < 0n ? -d : d);
};

test('deterministic trig: <= 2 ulp of Math.* over 100k seeded inputs per function, incl. large arguments', () => {
  const rng = seedRng('det-math');
  const u = () => nextRandom(rng);
  const cases: [string, (x: number) => number, string, () => number][] = [
    ['dsin small', dsin, 'sin', () => (u() - 0.5) * 8],
    ['dsin large', dsin, 'sin', () => (u() - 0.5) * 2e6],
    ['dcos small', dcos, 'cos', () => (u() - 0.5) * 8],
    ['dcos large', dcos, 'cos', () => (u() - 0.5) * 2e6],
    ['dtan', dtan, 'tan', () => (u() - 0.5) * 2e3],
    ['datan', datan, 'atan', () => (u() - 0.5) * 10 ** (u() * 8 - 4)],
    ['dasin', dasin, 'asin', () => (u() < 0.2 ? 1 - u() * 1e-4 : 2 * u() - 1)],
    ['dacos', dacos, 'acos', () => (u() < 0.2 ? -1 + u() * 1e-4 : 2 * u() - 1)],
    ['dexp', dexp, 'exp', () => (u() - 0.5) * 1400],
    ['dlog', dlog, 'log', () => 10 ** ((u() - 0.5) * 600)],
  ];
  const worst: Record<string, number> = {};
  for (const [name, f, ref, gen] of cases) {
    let max = 0;
    for (let i = 0; i < 100_000; i++) {
      const x = gen(), got = f(x), want = libm[ref](x);
      const e = ulps(got, want);
      if (e > max) max = e;
      if (e > 2 && Math.abs(got - want) > 4e-16 * Math.abs(want)) assert.fail(`${name}(${x}) = ${got}, Math.${ref} = ${want} (${e} ulp)`);
    }
    worst[name] = max;
  }
  // atan2 over all quadrants and magnitude ratios
  let max2 = 0;
  for (let i = 0; i < 100_000; i++) {
    const y = (u() - 0.5) * 10 ** (u() * 6 - 3), x = (u() - 0.5) * 10 ** (u() * 6 - 3);
    const e = ulps(datan2(y, x), libm.atan2(y, x));
    if (e > 2) assert.fail(`datan2(${y}, ${x}) = ${datan2(y, x)}, host atan2 = ${libm.atan2(y, x)} (${e} ulp)`);
    max2 = Math.max(max2, e);
  }
  worst.datan2 = max2;
  for (const k of ['dsin small', 'dsin large', 'dcos small', 'dcos large', 'datan', 'datan2', 'dexp', 'dlog']) assert.ok(worst[k] <= 1, `${k}: ${worst[k]} ulp`);
});

test('deterministic trig: edge cases (signed zeros, pi, tiny, huge, non-finite)', () => {
  for (const f of [dsin, dtan, datan, dasin]) {
    assert.ok(Object.is(f(0), 0) && Object.is(f(-0), -0), `${f.name} keeps the sign of zero`);
    for (const x of [1e-300, -1e-300, 5e-324, 1e-10, -3e-9]) assert.equal(f(x), x, `${f.name}(${x})`);
  }
  assert.equal(dcos(0), 1);
  assert.equal(dcos(-0), 1);
  assert.equal(dcos(1e-10), 1);
  assert.equal(dsin(Math.PI), 1.2246467991473532e-16); // pi - fl(pi), exactly
  assert.equal(dsin(-Math.PI), -1.2246467991473532e-16);
  assert.equal(dcos(Math.PI), -1);
  assert.equal(dcos(-Math.PI), -1);
  assert.equal(dsin(Math.PI / 2), 1);
  assert.equal(dcos(Math.PI / 2), 6.123233995736766e-17);
  for (const x of [Math.PI / 4, -Math.PI / 4, 0.7853981633974484, 3 * Math.PI / 4, 1e6, -1e6, 1234567.891])
    for (const [f, r] of [[dsin, 'sin'], [dcos, 'cos'], [dtan, 'tan']] as const) assert.ok(ulps(f(x), libm[r](x)) <= 2, `${r}(${x})`);
  for (const f of [dsin, dcos, dtan]) for (const x of [NaN, Infinity, -Infinity]) assert.ok(Number.isNaN(f(x)), `${f.name}(${x})`);
  for (const x of [1e8, 1e15, 1e300]) for (const f of [dsin, dcos]) { const v = f(x); assert.ok(v >= -1 && v <= 1, `${f.name}(${x}) finite, in range`); } // beyond exact reduction: deterministic, bounded
  assert.equal(datan(Infinity), Math.PI / 2);
  assert.equal(datan(-Infinity), -Math.PI / 2);
  assert.equal(datan(1), Math.PI / 4);
  assert.ok(Number.isNaN(datan(NaN)));
  assert.equal(dasin(1), Math.PI / 2);
  assert.equal(dasin(-1), -Math.PI / 2);
  assert.equal(dacos(1), 0);
  assert.equal(dacos(-1), Math.PI);
  assert.equal(dacos(0), Math.PI / 2);
  for (const x of [1.0000001, -2, NaN]) assert.ok(Number.isNaN(dasin(x)) && Number.isNaN(dacos(x)), `asin/acos(${x}) = NaN`);
  assert.equal(dexp(0), 1);
  assert.equal(dexp(-Infinity), 0);
  assert.equal(dexp(Infinity), Infinity);
  assert.equal(dexp(710), Infinity);
  assert.equal(dexp(-746), 0);
  assert.ok(ulps(dexp(709.7), libm.exp(709.7)) <= 1 && ulps(dexp(-740), libm.exp(-740)) <= 1, 'exp near overflow / into subnormals');
  assert.equal(dlog(1), 0);
  assert.equal(dlog(0), -Infinity);
  assert.equal(dlog(Infinity), Infinity);
  assert.ok(Number.isNaN(dlog(-1)));
  assert.ok(ulps(dlog(5e-324), libm.log(5e-324)) <= 1, 'log of a subnormal');
});

test('datan2: quadrants, signed zeros, axes and infinities match ECMAScript', () => {
  const PI = Math.PI, H = Math.PI / 2, Q = Math.PI / 4;
  const same = (y: number, x: number, want: number) => assert.ok(Object.is(datan2(y, x), want), `datan2(${Object.is(y, -0) ? '-0' : y}, ${Object.is(x, -0) ? '-0' : x}) = ${datan2(y, x)}, want ${want}`);
  same(0, -1, PI);
  same(-0, -1, -PI);
  same(0, 1, 0);
  same(-0, 1, -0);
  same(0, 0, 0);
  same(-0, 0, -0);
  same(0, -0, PI);
  same(-0, -0, -PI);
  for (const y of [1, 1e-300, 1e300]) { same(y, 0, H); same(y, -0, H); same(-y, 0, -H); same(-y, -0, -H); }
  same(1, 1, Q);
  same(-1, -1, -3 * Q);
  same(1, -1, 3 * Q);
  same(-1, 1, -Q);
  same(1, Infinity, 0);
  same(-1, Infinity, -0);
  same(1, -Infinity, PI);
  same(-1, -Infinity, -PI);
  same(Infinity, 5, H);
  same(-Infinity, -5, -H);
  same(Infinity, Infinity, Q);
  same(Infinity, -Infinity, 3 * Q);
  same(-Infinity, Infinity, -Q);
  same(-Infinity, -Infinity, -3 * Q);
  same(1e-300, -1e300, PI);
  same(-1e-300, -1e300, -PI);
  same(1e300, 1e-300, H);
  assert.ok(Number.isNaN(datan2(NaN, 1)) && Number.isNaN(datan2(1, NaN)));
  // sign pattern of every quadrant, and agreement with the host to <= 1 ulp
  for (const [y, x] of [[3, 4], [3, -4], [-3, -4], [-3, 4], [1e-5, -2], [-1e-5, -2], [7, 1e-9], [2, 1]] as const) {
    const a = datan2(y, x);
    assert.equal(Math.sign(a), Math.sign(y));
    assert.equal(Math.abs(a) > H, x < 0);
    assert.ok(ulps(a, libm.atan2(y, x)) <= 1, `datan2(${y}, ${x})`);
  }
});

test('deterministic trig: golden bit patterns (any engine / refactor drift fails here)', () => {
  const golden: [string, number | [number, number], string][] = [
    ['dsin', 0.5, '0x3fdeaee8744b05f0'],
    ['dsin', 1, '0x3feaed548f090cee'],
    ['dsin', 2, '0x3fed18f6ead1b446'],
    ['dsin', 3, '0x3fc210386db6d55b'],
    ['dsin', Math.PI, '0x3ca1a62633145c07'],
    ['dsin', 100, '0xbfe03425b78c4db8'],
    ['dsin', -7.25, '0xbfea56adb62a27b9'],
    ['dsin', 1000000, '0xbfd6664b2568d867'],
    ['dsin', 12345.678, '0xbfe687d5890974a5'],
    ['dcos', 0.5, '0x3fec1528065b7d50'],
    ['dcos', 1, '0x3fe14a280fb5068c'],
    ['dcos', 2, '0xbfdaa22657537205'],
    ['dcos', Math.PI / 2, '0x3c91a62633145c07'],
    ['dcos', 100, '0x3feb981dbf665fdf'],
    ['dcos', -7.25, '0x3fe22c6f50dc3fbe'],
    ['dcos', 1000000, '0x3fedf9df9906d32c'],
    ['dtan', 0.5, '0x3fe17b4f5bf3474a'],
    ['dtan', 1.5, '0x402c33ed50b88778'],
    ['dtan', -3, '0x3fc23ef71254b86f'],
    ['datan', 0.3, '0x3fd2a73a661eaf06'],
    ['datan', 1, '0x3fe921fb54442d18'],
    ['datan', 2, '0x3ff1b6e192ebbe44'],
    ['datan', -10, '0xbff789bd2c160054'],
    ['dasin', 0.3, '0x3fd380159e14f6ff'],
    ['dasin', -0.99, '0xbff6de3c6f33d51d'],
    ['dacos', 0.3, '0x3ff441f5ecbeef58'],
    ['dacos', 0.9999, '0x3f8cf69d216bd74b'],
    ['dexp', 1, '0x4005bf0a8b14576a'],
    ['dexp', -2.5, '0x3fb50385c094f425'],
    ['dexp', 10, '0x40d5829dcf950560'],
    ['dlog', 2, '0x3fe62e42fefa39ef'],
    ['dlog', 0.1, '0xc0026bb1bbb55515'],
    ['dlog', 10000000000, '0x4037069e2aa2aa5b'],
    ['datan2', [1, 2], '0x3fddac670561bb4f'],
    ['datan2', [-3, -4], '0xc003fc176b7a8560'],
    ['datan2', [2, -0.5], '0x3ffd0d6a1369bd34'],
    ['datan2', [-0.1, 5], '0xbf947a2e5dafff07'],
  ];
  const fns: Record<string, (x: number) => number> = { dsin, dcos, dtan, datan, dasin, dacos, dexp, dlog };
  for (const [name, arg, want] of golden) {
    const got = Array.isArray(arg) ? datan2(arg[0], arg[1]) : fns[name](arg);
    assert.equal(bits(got), want, `${name}(${arg}) = ${got}`);
  }
});

test('engine source never calls the host transcendentals (use core/math.ts d* versions)', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const banned = /\bMath\s*\.\s*(sin|cos|tan|asin|acos|atan2?|sinh|cosh|tanh|asinh|acosh|atanh|exp|expm1|log|log1p|log2|log10|cbrt|pow)\b/;
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (/\.(ts|tsx|mts|js|mjs)$/.test(ent.name)) {
        let src = readFileSync(p, 'utf8');
        // core/math.ts explains what it replaces in comments; only its code must be clean
        if (path.relative(root, p) === path.join('core', 'math.ts')) src = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
        src.split('\n').forEach((line, i) => { if (banned.test(line)) hits.push(`${path.relative(root, p)}:${i + 1}: ${line.trim()}`); });
      }
    }
  };
  walk(root);
  assert.deepEqual(hits, [], `host Math transcendentals differ across JS engines (last-bit), breaking cross-host state hashes; use dsin/dcos/dtan/dasin/dacos/datan/datan2/dexp/dlog from engine/core/math.ts:\n${hits.join('\n')}`);
});
