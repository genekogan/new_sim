import { test } from 'node:test';
import assert from 'node:assert/strict';
import { obbOverlap, type OBB } from './model.ts';

// Frozen original obbOverlap from09d74fa/current main; differential oracle only.
function legacy(a: OBB, b: OBB): boolean {
  if (a.y1 <= b.y0 || b.y1 <= a.y0) return false;
  const axes: [number, number][] = [[Math.cos(a.yaw), -Math.sin(a.yaw)], [Math.sin(a.yaw), Math.cos(a.yaw)], [Math.cos(b.yaw), -Math.sin(b.yaw)], [Math.sin(b.yaw), Math.cos(b.yaw)]];
  const corners = (o: OBB) => {
    const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
    return ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([i, j]) => [o.c[0] + i * o.half[0] * c + j * o.half[1] * s, o.c[1] - i * o.half[0] * s + j * o.half[1] * c] as [number, number]);
  };
  const ca = corners(a), cb = corners(b);
  for (const [ax, az] of axes) {
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const [x, z] of ca) { const p = x * ax + z * az; a0 = Math.min(a0, p); a1 = Math.max(a1, p); }
    for (const [x, z] of cb) { const p = x * ax + z * az; b0 = Math.min(b0, p); b1 = Math.max(b1, p); }
    if (a1 <= b0 + 1e-6 || b1 <= a0 + 1e-6) return false;
  }
  return true;
}


const box = (x = 0, z = 0, yaw = 0): OBB => ({ c: [x, z], half: [1, 1], yaw, y0: 0, y1: 1 });
const check = (a: OBB, b: OBB) => {
  assert.equal(obbOverlap(a, b), legacy(a, b));
  assert.equal(obbOverlap(b, a), legacy(b, a));
};
function adjacent(x: number, dir: number) {
  if (x === 0) return dir * Number.MIN_VALUE;
  const bits = new DataView(new ArrayBuffer(8)); bits.setFloat64(0, x);
  bits.setBigUint64(0, bits.getBigUint64(0) + ((x > 0) === (dir > 0) ? 1n : -1n));
  return bits.getFloat64(0);
}

test('OBB allocation reduction preserves the original SAT at ULP contacts and extreme scales', () => {
  for (const cx of [0, 1e-12, 1, 1e6, 1e12]) for (const yaw of [0, Math.PI / 2, -Math.PI / 2, Math.PI, 1e-16])
    for (const h of [0, 1e-12, 1, 100]) for (const delta of [0, 1e-6, adjacent(1e-6, -1), adjacent(1e-6, 1), -1e-6]) {
      const a = { ...box(cx, 0, yaw), half: [h, h] as [number, number] }, b = { ...a, c: [cx + h * 2 - delta, 0] as [number, number] };
      check(a, b); check(a, a);
    }
  let seed = 0x3ab18671;
  const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  const randomBox = (scale: number): OBB => ({ c: [(rand() - 0.5) * scale * 20, (rand() - 0.5) * scale * 20], half: [rand() * scale * 3, rand() * scale * 3], yaw: (rand() - 0.5) * Math.PI * 4, y0: 0, y1: 1 });
  for (let i = 0; i < 10000; i++) { const scale = 10 ** (Math.floor(rand() * 18) - 9); check(randomBox(scale), randomBox(scale)); }
  for (const value of [-0, NaN, Infinity, -Infinity]) {
    for (const key of ['yaw', 'y0', 'y1'] as const) { const a = box(); a[key] = value; check(a, box()); }
    for (const key of ['c', 'half'] as const) for (const i of [0, 1]) { const a = box(); a[key][i] = value; check(a, box()); }
  }
});

test('OBB reads current mutable inputs and preserves accessor order, side effects and reentrancy', () => {
  const a = box(), b = box(3); check(a, b);
  a.c[0] = 1.5; check(a, b); a.half[0] = 0.01; check(a, b); a.yaw = 0.7; check(a, b);
  a.y1 = 0; check(a, b); a.y1 = 1; a.c = [-0, 0]; check(a, b);
  const traced = (fn: typeof obbOverlap) => {
    const trace: string[] = [], a = box(0, 0, 0.7), b = box(0.5, 1, 0.8);
    let reads = 0;
    Object.defineProperty(a, 'yaw', { get() {
      trace.push('yaw getter'); a.c[0] += 0.001;
      assert.equal(fn(box(100), box(-100)), false, 'reentrant call');
      return 0.7 + ++reads * 0.01;
    } });
    const wrap = <T extends object>(value: T, path: string): T => new Proxy(value, { get(t, k, r) {
      trace.push(path + '.' + String(k)); const v: unknown = Reflect.get(t, k, r);
      return v && typeof v === 'object' ? wrap(v, path + '.' + String(k)) : v;
    } });
    return { result: fn(wrap(a, 'a'), wrap(b, 'b')), trace, a: a.c };
  };
  assert.deepEqual(traced(obbOverlap), traced(legacy));
});
