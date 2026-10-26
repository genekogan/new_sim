import test, { type TestContext } from 'node:test'; import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { captureTexturePreparation, compileModel, compileObject, compileSceneAsync, setTextureRenderer, uploadTextures, waitForPrograms, warmSceneChange } from './texture-budget.ts';
// production 2026-10-11: three's compileAsync threw "Cannot read properties of undefined (reading 'isReady')" in its own
// timer when LiveWorld re-mounted mid-compile (old renderer disposed: its material properties have no currentProgram)
test('a material without a program (disposed renderer) resolves, never throws', async () => {
  const r = { properties: { get: () => ({}) } };
  await waitForPrograms(r, new Set([{}, {}]), () => true, 1000);
});
test('waits for programs to be ready, then resolves', async () => {
  let ready = false; const r = { properties: { get: () => ({ currentProgram: { isReady: () => ready } }) } };
  let done = false; const p = waitForPrograms(r, new Set([{}]), () => true, 5000).then(() => { done = true; });
  await new Promise((res) => setTimeout(res, 50)); assert.equal(done, false);
  ready = true; await p; assert.equal(done, true);
});
test('stops when the renderer is replaced, when it throws, or at the timeout', async () => {
  let current = true; const never = { properties: { get: () => ({ currentProgram: { isReady: () => false } }) } };
  const a = waitForPrograms(never, new Set([{}]), () => current, 10_000); current = false; await a;
  await waitForPrograms({ properties: { get: () => { throw new Error('disposed'); } } }, new Set([{}]), () => true, 10_000);
  const t0 = Date.now(); await waitForPrograms(never, new Set([{}]), () => true, 100); assert.ok(Date.now() - t0 < 1000);
});

// 3.32/3.33 phones: a material disposed while the whole scene compiles (LiveWorld, the initial gate, Eyes, the expansion)
test('compileSceneAsync: a material disposed mid-compile, or a compile that throws, still resolves', async () => {
  let ready = false; const m1 = {}, m2 = {};
  const props = new Map<object, unknown>([[m1, { currentProgram: { isReady: () => ready } }], [m2, { currentProgram: { isReady: () => false } }]]);
  const r = { compile: () => new Set([m1, m2]), properties: { get: (m: object) => props.get(m) ?? {} } };
  let done = false; const p = compileSceneAsync(r as never, {} as never, {} as never, 5000).then(() => { done = true; });
  await new Promise((res) => setTimeout(res, 40)); assert.equal(done, false);
  props.delete(m2); ready = true; await p;   // m2 disposed: no program to wait for
  await compileSceneAsync({ compile: () => { throw Error('lost context'); }, properties: { get: () => ({}) } } as never, {} as never, {} as never);
});

// B2: the shared bolt light's programs are linked before the light is in a drawn frame
test('warmSceneChange: compiles with the change in, takes it out before returning, resolves once linked', async () => {
  assert.equal(await warmSceneChange(() => {}, () => {}), false);   // no renderer handed over: nothing compiled
  const log: string[] = []; let ready = false; const m = {};
  const r = { compile: () => { log.push('compile'); return new Set([m]); }, properties: { get: () => ({ currentProgram: { isReady: () => ready } }) } };
  setTextureRenderer(r as never, {} as never, {} as never);
  let done: boolean | null = null; const p = warmSceneChange(() => log.push('add'), () => log.push('remove')).then((v) => { done = v; });
  assert.deepEqual(log, ['add', 'compile', 'remove']);
  await new Promise((res) => setTimeout(res, 40)); assert.equal(done, null);
  ready = true; await p; assert.equal(done, true);
  const r2 = { compile: () => { throw Error('lost context'); }, properties: { get: () => ({}) } }; log.length = 0;
  setTextureRenderer(r2 as never, {} as never, {} as never);
  assert.equal(await warmSceneChange(() => log.push('add'), () => log.push('remove')), false); assert.deepEqual(log, ['add', 'remove']);
  setTextureRenderer(null);
});

function frames(t: TestContext) {
  const pending = new Map<number, FrameRequestCallback>(); let next = 0;
  const raf = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame'), caf = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame');
  globalThis.requestAnimationFrame = fn => { pending.set(++next, fn); return next; };
  globalThis.cancelAnimationFrame = id => { pending.delete(id); };
  t.after(() => {
    setTextureRenderer(null);
    if (raf) Object.defineProperty(globalThis, 'requestAnimationFrame', raf); else Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
    if (caf) Object.defineProperty(globalThis, 'cancelAnimationFrame', caf); else Reflect.deleteProperty(globalThis, 'cancelAnimationFrame');
  });
  return { pending, flush() { const callbacks = [...pending.values()]; pending.clear(); for (const fn of callbacks) fn(performance.now()); } };
}
function model() {
  const scene = new THREE.Group(), texture = new THREE.Texture({ width: 1024, height: 1024 });
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map: texture, normalMap: texture })));
  return { scene } as GLTF;
}
function renderer(log: string[], name: string) {
  return { initTexture: () => { log.push(name + ':upload'); }, compile: () => { log.push(name + ':compile'); return new Set([{}]); }, properties: { get: () => ({ currentProgram: { isReady: () => true } }) } } as unknown as THREE.WebGLRenderer;
}

test('leaving settles queued uploads, cancels their frame and releases scene references', async t => {
  const raf = frames(t), log: string[] = [], release = setTextureRenderer(renderer(log, 'A'), new THREE.Scene(), new THREE.Camera());
  const owner = captureTexturePreparation()!;
  let settled = 0; const a = uploadTextures(model()).then(() => { settled++; }), b = uploadTextures(model()).then(() => { settled++; });
  assert.equal(raf.pending.size, 1);
  const stale = [...raf.pending.values()][0];
  release(); release(); await Promise.all([a, b]);
  assert.equal(settled, 2); assert.equal(raf.pending.size, 0);
  assert.equal(captureTexturePreparation(), null);
  assert.deepEqual([owner.renderer, owner.scene, owner.camera], [null, null, null]);
  stale(0); assert.deepEqual(log, []);
});

test('replacement and an older release preserve only the new mount, including the same renderer', async t => {
  const raf = frames(t), log: string[] = [], r = renderer(log, 'shared');
  const releaseA = setTextureRenderer(r), ownerA = captureTexturePreparation(), a = uploadTextures(model());
  const releaseB = setTextureRenderer(r), ownerB = captureTexturePreparation(), b = uploadTextures(model());
  assert.notEqual(ownerA, ownerB);
  releaseA(); releaseA(); await a;
  assert.equal(captureTexturePreparation(), ownerB); assert.equal(raf.pending.size, 1);
  raf.flush(); await b; assert.deepEqual(log, ['shared:upload']);
  releaseB(); assert.equal(captureTexturePreparation(), null);
});

test('late preparation keeps its original lifetime and does not upload or compile in the next view', async t => {
  const raf = frames(t), log: string[] = [];
  const release = setTextureRenderer(renderer(log, 'A'), new THREE.Scene(), new THREE.Camera()), old = captureTexturePreparation();
  release(); setTextureRenderer(renderer(log, 'B'), new THREE.Scene(), new THREE.Camera());
  await compileModel(model(), old); await uploadTextures(model(), old);
  assert.deepEqual(log, []); assert.equal(raf.pending.size, 0);
  await compileModel(model()); const b = uploadTextures(model()); raf.flush(); await b;
  assert.deepEqual(log, ['B:compile', 'B:upload']);
});

test('release immediately stops program polling and a canceled scene warmup reports false', async t => {
  frames(t); let reads = 0;
  const r = { compile: () => new Set([{}]), properties: { get: () => { reads++; return { currentProgram: { isReady: () => false } }; } } } as unknown as THREE.WebGLRenderer;
  const release = setTextureRenderer(r, new THREE.Scene(), new THREE.Camera());
  const compiling = compileObject(model().scene), log: string[] = [];
  const warming = warmSceneChange(() => log.push('add'), () => log.push('remove'));
  const before = reads; release();
  await compiling; assert.equal(await warming, false); assert.deepEqual(log, ['add', 'remove']);
  await new Promise(resolve => setTimeout(resolve, 35)); assert.equal(reads, before);
});

test('empty uploads and renderer upload failures settle without stranding later work', async t => {
  const raf = frames(t), log: string[] = [], r = renderer(log, 'A');
  r.initTexture = () => { throw Error('context lost'); }; setTextureRenderer(r);
  await uploadTextures({ scene: new THREE.Group() } as GLTF);
  assert.equal(raf.pending.size, 0);
  const a = uploadTextures(model()); raf.flush(); await a;
  setTextureRenderer(null); await uploadTextures(model()); assert.equal(raf.pending.size, 0);
});

test('replacement inside a texture upload keeps the next mount on its own single cancellable frame', async t => {
  const raf = frames(t), log: string[] = [], a = renderer(log, 'A');
  let b!: Promise<void>, releaseB!: () => void;
  a.initTexture = () => {
    log.push('A:upload'); releaseB = setTextureRenderer(renderer(log, 'B'));
    b = uploadTextures(model());
  };
  setTextureRenderer(a); const first = uploadTextures(model());
  raf.flush(); await first;
  assert.deepEqual(log, ['A:upload']); assert.equal(raf.pending.size, 1);
  releaseB(); await b; assert.equal(raf.pending.size, 0);
});

test('release inside a program lookup stops the current poll before further renderer reads', async t => {
  frames(t); let reads = 0, readyCalls = 0, release!: () => void;
  const r = { compile: () => new Set([{}, {}]), properties: { get: () => { reads++; release(); return { currentProgram: { isReady: () => { readyCalls++; return false; } } }; } } } as unknown as THREE.WebGLRenderer;
  release = setTextureRenderer(r, new THREE.Scene(), new THREE.Camera());
  await warmSceneChange(() => {}, () => {});
  assert.equal(reads, 1); assert.equal(readyCalls, 0);
  await new Promise(resolve => setTimeout(resolve, 35)); assert.equal(reads, 1);
});

test('replacement during texture traversal cannot enqueue a dead owner ahead of the new view', async t => {
  const raf = frames(t), log: string[] = []; setTextureRenderer(renderer(log, 'A'));
  const g = model(); let b!: Promise<void>;
  Object.defineProperty((g.scene.children[0] as THREE.Mesh).material, 'callbackTexture', { enumerable: true, get() {
    setTextureRenderer(renderer(log, 'B')); b = uploadTextures(model()); return new THREE.Texture();
  } });
  await uploadTextures(g); assert.equal(raf.pending.size, 1);
  raf.flush(); await b; assert.deepEqual(log, ['B:upload']); assert.equal(raf.pending.size, 0);
});

test('a scene change that releases its view is removed without compiling the disposed renderer', async t => {
  frames(t); const log: string[] = [], release = setTextureRenderer(renderer(log, 'A'), new THREE.Scene(), new THREE.Camera());
  const warmed = await warmSceneChange(() => { log.push('add'); release(); }, () => log.push('remove'));
  assert.equal(warmed, false); assert.deepEqual(log, ['add', 'remove']);
});
