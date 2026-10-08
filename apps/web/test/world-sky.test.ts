import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { skyBodies, moonPhase, civilMs } from '../src/atmosphere/astro.ts';
import { GRADE_A, GRADE_B, setGrade, clearGrade } from '../src/atmosphere/grade.ts';
import { Halos } from '../src/atmosphere/halos.ts';
import { installNightLighting, NIGHT_MAP_BOUNDS } from '../src/WorldNightLights.ts';
import { paintGroundOcclusion } from '../src/WorldGroundOcclusion.ts';

test('moon phase (mean synodic month): new moon about 10–11 Oct 2026, full about 25–26 Oct', () => {
  const p = (iso: string) => moonPhase(civilMs(iso)!);
  const newMoon = p('2026-10-10T08:50:00'), fullMoon = p('2026-10-25T21:12:00');
  assert.ok(Math.min(newMoon, 1 - newMoon) < 0.04, `new ${newMoon}`);
  assert.ok(Math.abs(fullMoon - 0.5) < 0.04, `full ${fullMoon}`);
});

test('sky bodies: the full moon stands opposite the sun; the star rotation is a rotation', () => {
  const b = skyBodies('2026-10-25T23:00:00')!;
  assert.ok(b.sun.dot(b.moon) < -0.9, `sun·moon ${b.sun.dot(b.moon)}`);
  assert.ok(b.illumination > 0.98);
  assert.ok(b.moon.y > 0 && b.sun.y < 0, 'night: moon up, sun down');
  const m = b.starRotation, v = new THREE.Vector3(0.3, 0.8, -0.5).normalize().applyMatrix3(m);
  assert.ok(Math.abs(v.length() - 1) < 1e-6 && Math.abs(m.determinant() - 1) < 1e-6);
  // an hour later the field has turned ~15 degrees about the pole
  const later = skyBodies('2026-10-26T00:00:00')!, d = new THREE.Vector3(0, 1, 0);
  const a1 = d.clone().applyMatrix3(b.starRotation), a2 = d.clone().applyMatrix3(later.starRotation);
  const deg = (a1.angleTo(a2) * 180) / Math.PI;
  assert.ok(deg > 3 && deg < 15.1, `turned ${deg}`);
  assert.equal(skyBodies('not a clock'), null);
});

test('grade: identity until set; night deepens and desaturates dim areas, never a brightening lift', () => {
  clearGrade();
  assert.equal(GRADE_A.x, 0);
  setGrade(1, 0, 0, 0);
  const day = { ...GRADE_A }, dayB = { ...GRADE_B };
  setGrade(0, 0, 0, 0);
  assert.ok(GRADE_B.w > 0.4 && dayB.w === 0, 'rod-vision desaturation only at night');
  assert.ok(GRADE_A.y >= day.y, 'stronger S-curve (deeper darks) at night');
  assert.ok(Math.abs(GRADE_B.x) + Math.abs(GRADE_B.y) + Math.abs(GRADE_B.z) < 0.05, 'shadow tint stays tiny');
  setGrade(0.6, 0.8, 0, 0);
  assert.ok(GRADE_A.w > day.w, 'golden hour warms the highlights');
  clearGrade();
});

test('halos: one sprite per published lamp/lantern/fire, heads at the lamp-head height; none by day', () => {
  const h = new Halos();
  h.setSources([[1, 0, 2, 'lamp', 1], [5, 2, 5, 'lantern', 1], [9, 0, 9, 'fire', 1], [9, 0, 9, 'window', 1], [1, 0, 2, 'lamp', 1]]);
  assert.equal(h.size, 3);
  const m = new THREE.Matrix4(), p = new THREE.Vector3();
  h.mesh.getMatrixAt(0, m); p.setFromMatrixPosition(m); assert.ok(Math.abs(p.y - 3.2) < 1e-6);
  h.mesh.getMatrixAt(1, m); p.setFromMatrixPosition(m); assert.ok(Math.abs(p.y - 3.6) < 1e-6);
  h.update(10, 0); assert.equal(h.mesh.visible, false);
  h.update(10, 1); assert.equal(h.mesh.visible, true);
  h.dispose();
});

test('ground occlusion: darkest at a wall, gone ~3 m out, height channel carries the ground under it', () => {
  installNightLighting();
  const lib = THREE.ShaderLib.standard.uniforms as Record<string, { value: unknown }>;
  const tex = lib.uEdenAoMap.value as THREE.DataTexture;
  assert.ok(THREE.ShaderChunk.lights_fragment_end.includes('uEdenAo'), 'patched');
  const n = paintGroundOcclusion([{ corners: [[40, 10], [46, 10], [46, 16], [40, 16]] }], () => 2);
  assert.equal(n, 1);
  const { width: w, height: hgt, data } = tex.image as { width: number; height: number; data: Uint8Array };
  const { x0, z0, x1, z1 } = NIGHT_MAP_BOUNDS, at = (x: number, z: number) => { const i = Math.floor(((x - x0) / (x1 - x0)) * w), j = Math.floor(((z - z0) / (z1 - z0)) * hgt); return [data[(j * w + i) * 4], data[(j * w + i) * 4 + 1]]; };
  const wall = at(46.2, 13)[0], mid = at(47.5, 13)[0], far = at(50, 13)[0], inside = at(43, 13)[0];
  assert.ok(wall > mid && mid > far, `${wall}>${mid}>${far}`);
  assert.equal(far, 0);
  assert.ok(inside < wall);
  assert.ok(Math.abs(at(46.2, 13)[1] - Math.round((255 * 12) / 100)) <= 1, 'ground 2 m stored');
});

test('lighthouse: sweeps once every 12 s, only at night', async () => {
  const { Lighthouse } = await import('../src/atmosphere/lighthouse.ts');
  const l = new Lighthouse();
  l.update(3, 0, 0); assert.equal(l.group.visible, false);
  l.update(3, 1, 0); assert.equal(l.group.visible, true); assert.ok(Math.abs(l.angle - Math.PI / 2) < 1e-6);
  l.dispose();
});

test('ground details: grass mask keeps paths, buildings and the lake clear; the meadow follows a low camera only', async () => {
  const { groundMask, createWorldGroundDetails } = await import('../src/WorldGroundDetails.ts');
  const m = groundMask(), B = [-100, -65, 105, 85], W = Math.round((B[2] - B[0]) / 0.5), at = (x: number, z: number) => m[Math.floor((z - B[1]) / 0.5) * W + Math.floor((x - B[0]) / 0.5)];
  assert.equal(at(50, 4), 3, 'east spine path');
  assert.equal(at(34, 15), 0, 'house 1');
  assert.equal(at(-81, 1), 0, 'lake');
  assert.equal(at(-10, 60), 1, 'south lawn grass');
  const d = createWorldGroundDetails(), cam = new THREE.PerspectiveCamera();
  cam.position.set(-10, 1.7, 60); cam.updateMatrixWorld(); d.meadow.follow(cam);
  assert.ok(d.meadow.counts.tufts > 1000 && d.meadow.counts.blooms > 50, JSON.stringify(d.meadow.counts));
  cam.position.set(-10, 60, 60); cam.updateMatrixWorld(); d.meadow.follow(cam);
  assert.equal(d.meadow.counts.tufts, 0);
  d.dispose();
});
