// Lane W3 (2026-10-19): the viewer loads each character as its mesh file plus its rig's shared clips file
// (tools/blobs/character-wire.mjs). Here: the committed files are exactly what the tool makes from the source GLBs, and
// mesh + clips load into the same scene, the same clips, the same template and the same preset bindings as the source.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {templateFromGltf} from '../../../mars/viewer/app/engine-view/people.ts';
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
