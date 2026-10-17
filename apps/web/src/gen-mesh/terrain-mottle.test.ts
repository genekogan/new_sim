// Phone arrival (lane L3): the playa's mottling split off (the worker runs playa-mottle.ts mottleColors) must give the
// same floats as terrainColorFor in one go; other palettes are never deferred.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { terrainColorFor, terrainColorDeferred, GROUND_PALETTES } from './ground-palette.ts';
import { mottleColors } from './playa-mottle.ts';

test('deferred playa colours + mottleColors equal terrainColorFor (float32), other palettes not deferred', () => {
  for (const p of GROUND_PALETTES) if (p !== 'playa') assert.equal(terrainColorDeferred(p), null, p);
  const whole = terrainColorFor('playa'), part = terrainColorDeferred('playa')!;
  let s = 7; const r = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  const n = 20000, base = -3, rgb = new Float64Array(n * 3), xz = new Float64Array(n * 2), out = new Float32Array(n * 3), want = new Float32Array(n * 3), idx: number[] = [];
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const x = (r() - 0.5) * 900, z = (r() - 0.5) * 900, y = base + (r() - 0.3) * 60, slope = r() * 1.6;
    whole(c, y, slope, base, x, z); want[i * 3] = c.r; want[i * 3 + 1] = c.g; want[i * 3 + 2] = c.b;
    if (part(c, y, slope, base)) idx.push(i);
    rgb[i * 3] = c.r; rgb[i * 3 + 1] = c.g; rgb[i * 3 + 2] = c.b; out[i * 3] = c.r; out[i * 3 + 1] = c.g; out[i * 3 + 2] = c.b; xz[i * 2] = x; xz[i * 2 + 1] = z;
  }
  assert.ok(idx.length > n / 2 && idx.length < n, `mottled ${idx.length}`);
  mottleColors(rgb, xz, out, Uint32Array.from(idx));
  assert.deepEqual(out, want);
});
