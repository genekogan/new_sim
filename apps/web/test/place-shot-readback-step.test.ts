// The Explore picture's GPU read-back runs in its own paced step, after the step that rendered it: on a cold context reading
// the shot back in the same task blocked the main thread for >1 s (explore-shots2, 2026-10-23).
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {WorldPlacePreviews} from '../src/WorldPlacePreviews.ts';

test('a place picture is rendered in one paced step and read back in a later one', async () => {
  let turn = 0, target: unknown = null; const log: string[] = [];
  const v = new THREE.Vector4(), c = new THREE.Color();
  const known: Record<string, unknown> = {autoClear: true, shadowMap: {autoUpdate: true, needsUpdate: false},
    getRenderTarget: () => target, setRenderTarget: (t: unknown) => { target = t; }, getViewport: (x: THREE.Vector4) => x.copy(v), getScissor: (x: THREE.Vector4) => x.copy(v),
    getScissorTest: () => false, getClearColor: (x: THREE.Color) => x.copy(c), getClearAlpha: () => 1, compileAsync: async () => {},
    render: () => { log.push(`render:${(target as THREE.WebGLRenderTarget | null)?.width}:${turn}`); },
    readRenderTargetPixels: (t: THREE.WebGLRenderTarget, _x: number, _y: number, _w: number, _h: number, out: Uint8Array) => { out.fill(255); log.push(`read:${t.width}:${turn}`); }};
  const renderer = new Proxy(known, {get: (o, k) => (k in o ? o[k as string] : () => {})}) as unknown as THREE.WebGLRenderer;
  const box = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4), new THREE.MeshBasicMaterial()); box.position.set(10, 2, 10);
  const previews = new WorldPlacePreviews(renderer, () => [box]);
  (previews as unknown as {pacer: unknown}).pacer = {turn: async () => { turn++; return true; }, done() {}};
  await previews.captureLocation({id: 'p', label: 'P', regionId: 'p', p: [20, 6, 20], target: [10, 2, 10], radius: 6}, 'k').catch(() => null);
  const widths = log.map((l) => +l.split(':')[1]), W = Math.max(...widths);
  const shotRender = log.find((l) => l.startsWith(`render:${W}:`)), shotRead = log.find((l) => l.startsWith(`read:${W}:`));
  assert.ok(shotRender && shotRead, `the shot was rendered and read back: ${log.join(' ')}`);
  assert.ok(+shotRead.split(':')[2] > +shotRender.split(':')[2], `read-back in a later paced step: ${log.join(' ')}`);
});
