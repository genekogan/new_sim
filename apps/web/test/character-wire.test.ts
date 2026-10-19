// Lane W3 (2026-10-19): the viewer loads each character as its mesh file plus its rig's shared clips file
// (tools/blobs/character-wire.mjs). Here: the committed files are exactly what the tool makes from the source GLBs, and
// mesh + clips load into the same scene, the same clips, the same template and the same preset bindings as the source.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {loadTemplates, templateFromGltf} from '../../../mars/viewer/app/engine-view/people.ts';
import {ThreeResources} from '../../../mars/viewer/lib/three-resources.ts';
import {collectTemplateAppearance} from '../../../mars/viewer/app/engine-view/human-appearance.ts';
import {CHARACTER_CLIPS, CHARACTER_WIRE} from '../../../mars/viewer/app/engine-view/character-wire.ts';
// @ts-expect-error a plain .mjs tool without types
import {build, DIR, MODULE} from '../../../tools/blobs/character-wire.mjs';

const file = (name: string) => readFileSync(`${DIR}/${name}`);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const parse = (b: Buffer): Promise<GLTF> => new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, '');
const bytes = (a: ArrayLike<number> & { buffer: ArrayBufferLike; byteOffset: number; byteLength: number }) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');
/** Names, types, hierarchy, rest transforms, materials, vertex/index bytes, bones and bind matrices. */
function fingerprint(root: THREE.Object3D) {
  const h = createHash('sha256');
  root.traverse((o) => {
    h.update(`${o.type}|${o.name}|${o.children.length}|${o.position.toArray()}${o.quaternion.toArray()}${o.scale.toArray()}`);
    const m = o as THREE.SkinnedMesh; if (!m.isMesh) return;
    for (const [k, a] of Object.entries(m.geometry.attributes)) h.update(k + bytes((a as THREE.BufferAttribute).array as Float32Array));
    if (m.geometry.index) h.update(bytes(m.geometry.index.array as Uint16Array));
    for (const mat of [m.material].flat()) h.update(JSON.stringify((mat as THREE.MeshStandardMaterial).color.toArray()) + mat.name + mat.side);
    if (m.isSkinnedMesh) { h.update(m.skeleton.bones.map((b) => b.name).join()); for (const b of m.skeleton.boneInverses) h.update(b.elements.join()); }
  });
  return h.digest('hex');
}
const clipsOf = (g: GLTF) => g.animations.map((c) => [c.name, c.duration, c.tracks.map((t) => [t.name, t.ValueTypeName, t.getInterpolation(), bytes(t.times), bytes(t.values)])]);
const measured = (t: ReturnType<typeof templateFromGltf>) => JSON.stringify({ ...t, gltf: undefined, appearance: undefined });

test('the committed wire files and character-wire.ts are exactly what the tool makes from the source GLBs', () => {
  const {files, text} = build() as {files: Map<string, Buffer>; text: string};
  for (const [name, b] of files) assert.ok(file(name).equals(b), name);
  assert.equal(readFileSync(MODULE, 'utf8'), text);
  for (const [name, w] of Object.entries(CHARACTER_WIRE)) {
    assert.equal(sha(file(w.mesh)), w.meshSHA256, name); assert.equal(sha(file(`animated-${name}.glb`)), w.sourceSHA256, name);
  }
  for (const [name, c] of Object.entries(CHARACTER_CLIPS)) assert.equal(sha(file(name)), c.sha256, name);
  assert.equal(CHARACTER_WIRE.casual.clips, CHARACTER_WIRE.punk.clips, 'casual and punk share one clips file');
});

test('loadTemplates (mesh files + one parse of each shared clips file) = templates from the source GLBs, after every fit', async () => {
  const g = globalThis as unknown as {fetch: typeof fetch; location?: {href: string}}, realFetch = g.fetch, hadLocation = 'location' in g;
  g.location ??= {href: 'http://local/'}; const asked: string[] = [];
  g.fetch = (async (url: string) => { const name = String(url).split('/').pop()!.split('?')[0]; asked.push(name); const b = file(name); return new Response(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer); }) as typeof fetch;
  try {
    const wire = await loadTemplates(new AbortController().signal, new ThreeResources());
    assert.deepEqual(asked.sort(), ['animated-casual.mesh.glb', 'animated-punk.mesh.glb', 'animated-woman.mesh.glb', 'clips-ual-woman.glb', 'clips-ual.glb'], 'each clips file once');
    for (const t of wire) {
      const source = templateFromGltf(t.name, await parse(file(`animated-${t.name}.glb`)));
      assert.equal(measured(t), measured(source), t.name);
      assert.deepEqual(clipsOf(t.gltf), clipsOf(source.gltf), `${t.name}: clips after this body's arm fit`);
      assert.equal(fingerprint(t.gltf.scene), fingerprint(source.gltf.scene), t.name);
    }
  } finally { g.fetch = realFetch; if (!hadLocation) delete g.location; }
});

test('a server without the wire files (3.19 legacy) still draws everyone from the source GLBs', async () => {
  const g = globalThis as unknown as {fetch: typeof fetch; location?: {href: string}}, realFetch = g.fetch, realWarn = console.warn, hadLocation = 'location' in g;
  g.location ??= {href: 'http://local/'}; const asked: string[] = []; console.warn = () => {};
  g.fetch = (async (url: string) => {
    const name = String(url).split('/').pop()!.split('?')[0]; asked.push(name);
    if (/\.mesh\.glb$|^clips-/.test(name)) return new Response('{"ok":false}', {status: 404});
    const b = file(name); return new Response(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  }) as typeof fetch;
  try {
    const got = await loadTemplates(new AbortController().signal, new ThreeResources(), {appearances: true});
    assert.deepEqual(got.map((t) => t.name).sort(), ['casual', 'punk', 'woman']);
    for (const name of ['casual', 'punk', 'woman']) assert.ok(asked.includes(`animated-${name}.glb`), name);
    for (const t of got) {
      const source = templateFromGltf(t.name, await parse(file(`animated-${t.name}.glb`)));
      assert.equal(measured(t), measured(source), t.name);
      assert.deepEqual(clipsOf(t.gltf), clipsOf(source.gltf), t.name);
      assert.ok(t.appearance, `${t.name}: presets still bind the source`);
    }
  } finally { g.fetch = realFetch; console.warn = realWarn; if (!hadLocation) delete g.location; }
});

for (const name of ['casual', 'punk', 'woman'] as const) {
  test(`${name}: mesh + shared clips load as the source — scene, clips, template and preset bindings`, async () => {
    const w = CHARACTER_WIRE[name], source = await parse(file(`animated-${name}.glb`)), wire = await parse(file(w.mesh));
    assert.equal(wire.animations.length, 0, 'the mesh file carries no clips');
    wire.animations = (await parse(file(w.clips))).animations;
    assert.equal(fingerprint(wire.scene), fingerprint(source.scene));
    assert.deepEqual(clipsOf(wire), clipsOf(source));
    assert.equal(measured(templateFromGltf(name, wire)), measured(templateFromGltf(name, source)));
    const a = await collectTemplateAppearance(wire, name, w.sourceSHA256), b = await collectTemplateAppearance(source, name, w.sourceSHA256);
    assert.ok(a && b, 'the presets bind the mesh file under its source hash');
    assert.deepEqual(a.primitives.map((p) => [p.node, p.meshIndex, p.primitiveIndex, p.slot]), b.primitives.map((p) => [p.node, p.meshIndex, p.primitiveIndex, p.slot]));
    assert.equal(await collectTemplateAppearance(wire, name, w.meshSHA256), undefined, 'the mesh hash alone is not a pinned source');
  });
}
