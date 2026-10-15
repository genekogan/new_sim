import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldModel } from '@sim/world-compiler';
import { MaterialLib } from '../materials.ts';
import { meshFor, type MeshCtx } from '../registry.ts';

test('sign media loads only the current world’s content-addressed image assets; all other URLs use the fallback', async () => {
  const globals = globalThis as unknown as { location?: URL; document?: unknown };
  const previousLocation = globals.location, previousDocument = globals.document, originalLoad = THREE.TextureLoader.prototype.load;
  const loads: string[] = [];
  globals.location = new URL('http://offline.invalid/w/fixture?shot=1');
  const context = { font: '', fillStyle: '', textAlign: '', textBaseline: '', fillRect() {}, beginPath() {}, arc() {}, fill() {}, moveTo() {}, quadraticCurveTo() {}, lineTo() {}, measureText: (s: string) => ({ width: s.length * 12 }), fillText() {} };
  globals.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
  THREE.TextureLoader.prototype.load = function(url) { loads.push(url); return new THREE.Texture(); };
  const materials = new MaterialLib();
  try {
    const { signMediaPath } = await import('./sign.mesh.ts');
    const path = `/assets/${'a'.repeat(64)}.png`, jpg = `/assets/${'b'.repeat(64)}.jpg`;
    assert.equal(signMediaPath(path), `/w/fixture${path}`); assert.equal(signMediaPath(jpg), `/w/fixture${jpg}`);
    const denied: unknown[] = [undefined, null, 123, '', 'https://external.invalid/pic.png', `http://offline.invalid/w/fixture${path}`, `//external.invalid${path}`, `data:image/png;base64,abc`, 'blob:http://offline.invalid/image', 'javascript:alert(1)', `/w/other${path}`, `/w/fixture${path}`, `/assets/../${'a'.repeat(64)}.png`, `/assets/%2e%2e/${'a'.repeat(64)}.png`, `${path}?url=https://external.invalid`, `${path}#image`, `${path}\n`, path.replace('/assets/', '/assets\\'), '/assets/not-a-sha.png', `/assets/${'a'.repeat(64)}.glb`, `/assets/${'a'.repeat(64)}.svg`];
    for (const url of denied) assert.equal(signMediaPath(url), null, String(url));
    const model = new WorldModel({ constants: { ground: 'land' }, seed: 'offline-sign-media' });
    model.defineDef({ schema: 'def/1', name: 'safe-sign', tags: ['sign-text'], layer: 'decor', size: { box: [1, 1, 1] },
      make: { kind: 'gen', gen: 'kit/2', args: { shapes: [{ kind: 'box', at: [0, 0.5, 0], size: [1, 1, 0.1] }], faces: [{ at: [0, 0.5, 0.06], w: 1, h: 1, media: true }] } } }, 'god', 0);
    const def = model.resolvedDef('safe-sign@1')!;
    const build = (media: unknown, text?: string) => {
      const root = meshFor(def)!.build({ def, entity: { id: 'e_sign', def: 'safe-sign@1', in: { parent: 'world' }, by: 'god', born: 0, v: 1, state: { media, ...(text ? { text } : {}) } },
        args: def.make.kind === 'gen' ? def.make.args : {}, params: {}, model, materials, tint: (_key: string | undefined, fallback: string) => fallback } as unknown as MeshCtx)!;
      const face = root.getObjectByName('sign-face') as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
      assert.ok(face.material.map); return face.material.map!;
    };
    for (const url of denied) build(url);
    assert.deepEqual(loads, []);
    build(path); build(path); build(jpg);
    assert.deepEqual(loads, [`/w/fixture${path}`, `/w/fixture${jpg}`], 'only admitted paths reach TextureLoader and repeated assets reuse the cache');
    const fallback = build('https://external.invalid/pic.png', 'Owner’s caption');
    assert.ok(fallback instanceof THREE.CanvasTexture); assert.equal(loads.length, 2);
  } finally { THREE.TextureLoader.prototype.load = originalLoad; globals.location = previousLocation; globals.document = previousDocument; materials.dispose(); }
});
