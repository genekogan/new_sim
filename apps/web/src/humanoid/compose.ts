// composeHumanoid: a core/humanoid@2 look → a people.ts Template. One shared rig per frame (skeleton + the
// 51 clips, loaded once), the look's kit parts (merged per slot: head = face + hair + hat + glasses, top = top +
// bag, bottom, shoes → four draws), one palette material. fit/fitArms/measureWalk/createRig run unchanged via
// people.ts templateFromParts. Identical looks share one template; parts and merged geometry are shared.
import * as THREE from 'three';
import type {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone as cloneSkinned} from 'three/addons/utils/SkeletonUtils.js';
import {templateFromParts, type Template} from '../../../../mars/viewer/app/engine-view/people.ts';
import {resolveLook, lookKey, paletteOf, type Look, type Slot} from './look.ts';
import {humanoidMaterial} from './material.ts';
import {hatPieces, glassesPieces, bagPieces, skinned, type HeadFit} from './props.ts';

type Landmarks = {min: number[]; max: number[]; cz?: number; rx?: number; rz?: number; top?: number; eye?: [number, number, number]; eyeX?: number; templeX?: number; back?: number; front?: number};
type PartEntry = {label: string; native: string; tris: number; verts: number; licence: string; files: Record<string, {file: string; bytes: number; sha256: string}>; landmarks: Record<string, Landmarks>};
export type KitManifest = {contract: 'humanoid-kit/1'; version: number; slots: string[]; licence: string;
  frames: Record<string, {rig: string; bytes: number; sha256: string; bones: number; clips: number; joints: Record<string, [number, number, number]>; index: {head: number; chest: number; hips: number; torso: number}}>;
  parts: Record<string, Record<string, PartEntry>>; presets: Record<string, {palette: Partial<Record<Slot, number[]>>}>};
/** A frame's rig: armature, bind inverses, clips, and per bone its rest joint and its first child joint (kit space). */
type Rig = {root: THREE.Object3D; ib: THREE.Matrix4[]; clips: THREE.AnimationClip[]; names: string[]; joints: THREE.Vector3[]; ends: (THREE.Vector3 | null)[]};
export const KIT_URL = '/modular/humanoid/';
const HIDE_UNDER_HAT = 1;
const ARM_TRACK = /^(LowerArm|Wrist)[LR]\.position$/;

/** Merge kit-format geometries (position f32, normal i8n, skinIndex u8, skinWeight u8n, hinfo u8) into one. */
export function mergeParts(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const n = geos.reduce((a, g) => a + g.attributes.position.count, 0), idx = geos.reduce((a, g) => a + (g.index ? g.index.count : 0), 0);
  const out = new THREE.BufferGeometry();
  const spec = {position: [Float32Array, 3, false], normal: [Int8Array, 3, true], skinIndex: [Uint8Array, 4, false], skinWeight: [Uint8Array, 4, true], hinfo: [Uint8Array, 4, false]} as const;
  const attrs = Object.fromEntries(Object.entries(spec).map(([k, [T, size, norm]]) => [k, new THREE.BufferAttribute(new T(n * size), size, norm)])) as Record<keyof typeof spec, THREE.BufferAttribute>;
  const index = new (n < 65536 ? Uint16Array : Uint32Array)(idx);
  let v = 0, t = 0;
  for (const g of geos) {
    const c = g.attributes.position.count;
    for (const [k, a] of Object.entries(attrs)) {
      const src = g.getAttribute(k); if (!src) throw Error('kit geometry lacks ' + k);
      for (let i = 0; i < c; i++) for (let j = 0; j < a.itemSize; j++) a.setComponent(v + i, j, src.getComponent(i, j));
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) index[t++] = g.index.getX(i) + v;
    v += c;
  }
  for (const [k, a] of Object.entries(attrs)) out.setAttribute(k, a);
  out.setIndex(new THREE.BufferAttribute(index, 1));
  return out;
}
/** Copy without the triangles whose vertices are flagged (e.g. a mohawk's spike under a hat). */
function withoutFlag(g: THREE.BufferGeometry, flag: number): THREE.BufferGeometry {
  const info = g.getAttribute('hinfo'), keep: number[] = [], I = g.index!;
  for (let i = 0; i < I.count; i += 3) { const a = I.getX(i), b = I.getX(i + 1), c = I.getX(i + 2); if (!((info.getW(a) | info.getW(b) | info.getW(c)) & flag)) keep.push(a, b, c); }
  const out = g.clone(); out.setIndex(keep); return out;
}
/** Girth per bone for `build` (0 = untouched): the trunk widens about the body's vertical axis, limbs about their
 *  bone line; hands, feet and head keep their size. Blended by skin weight, so seams between parts stay closed. */
const GIRTH: Record<string, [number, 'trunk' | 'limb']> = {
  Hips: [1, 'trunk'], Abdomen: [1, 'trunk'], Torso: [1, 'trunk'], Chest: [1, 'trunk'], Neck: [0.45, 'trunk'], ShoulderL: [0.7, 'trunk'], ShoulderR: [0.7, 'trunk'],
  UpperArmL: [0.85, 'limb'], UpperArmR: [0.85, 'limb'], LowerArmL: [0.55, 'limb'], LowerArmR: [0.55, 'limb'],
  UpperLegL: [1, 'limb'], UpperLegR: [1, 'limb'], LowerLegL: [0.7, 'limb'], LowerLegR: [0.7, 'limb'],
};
/** A copy of `g` widened (build > 1) or slimmed (build < 1) by the GIRTH table in the rig's rest (bind) space. */
export function withGirth(g: THREE.BufferGeometry, build: number, rig: Pick<Rig, 'names' | 'joints' | 'ends'>): THREE.BufferGeometry {
  if (build === 1) return g;
  const out = g.clone(), P = out.attributes.position, J = out.attributes.skinIndex, W = out.attributes.skinWeight, k = build - 1;
  const spec = rig.names.map((n, i) => { const e = GIRTH[n]; if (!e) return null; const end = rig.ends[i]; const dir = e[1] === 'limb' && end ? end.clone().sub(rig.joints[i]).normalize() : null; return {g: e[0], at: rig.joints[i], dir}; });
  const p = new THREE.Vector3(), d = new THREE.Vector3(), off = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) {
    p.fromBufferAttribute(P, i); d.set(0, 0, 0);
    for (let c = 0; c < 4; c++) {
      const w = W.getComponent(i, c), s = w > 0 ? spec[J.getComponent(i, c)] : null; if (!s) continue;
      off.subVectors(p, s.at);
      if (s.dir) off.addScaledVector(s.dir, -off.dot(s.dir)); else off.y = 0;
      d.addScaledVector(off, w * s.g);
    }
    P.setXYZ(i, p.x + k * d.x, p.y + k * d.y, p.z + k * d.z);
  }
  return out;
}
/** Scale the head about its joint, per vertex by its Head-bone weight (clips key the Head bone's scale). */
function scaleHead(g: THREE.BufferGeometry, s: number, joint: [number, number, number], head: number) {
  if (s === 1) return g;
  const P = g.attributes.position, J = g.attributes.skinIndex, W = g.attributes.skinWeight;
  for (let i = 0; i < P.count; i++) {
    let w = 0; for (let k = 0; k < 4; k++) if (J.getComponent(i, k) === head) w += W.getComponent(i, k);
    if (!w) continue; const f = 1 + w * (s - 1);
    P.setXYZ(i, joint[0] + (P.getX(i) - joint[0]) * f, joint[1] + (P.getY(i) - joint[1]) * f, joint[2] + (P.getZ(i) - joint[2]) * f);
  }
  return g;
}

export type KitReader = (url: string) => Promise<ArrayBuffer>;
let shared: HumanoidKit | null = null;
/** The page's kit (one cache for the world view, the picker and portraits). */
export function humanoidKit(loader: GLTFLoader): HumanoidKit { return shared ??= new HumanoidKit(loader); }
/** True for templates composed by a kit (their geometry belongs to the kit's cache, not to the template). */
export const isComposed = (t: Template) => !!t.gltf.scene.userData.humanoid;
/** One kit per base URL: caches rigs, parts, merged geometry and templates; counts fetched bytes. */
export class HumanoidKit {
  readonly base: string; readonly loader: GLTFLoader; private read: KitReader;
  private manifestP?: Promise<KitManifest>;
  private rigs = new Map<string, Promise<Rig>>(); private parts = new Map<string, Promise<THREE.BufferGeometry>>();
  private merged = new Map<string, Promise<THREE.BufferGeometry>>(); private templates = new Map<string, Promise<Template>>();
  bytes = 0; files = 0;
  constructor(loader: GLTFLoader, base = KIT_URL, read?: KitReader) {
    this.loader = loader; this.base = base;
    this.read = read ?? (async url => { const r = await fetch(url); if (!r.ok) throw Error(`humanoid kit ${url}: HTTP ${r.status}`); return r.arrayBuffer(); });
  }
  private async fetch(path: string) { const b = await this.read(this.base + path); this.bytes += b.byteLength; this.files++; return b; }
  manifest(): Promise<KitManifest> {
    return this.manifestP ??= this.fetch('kit.json').then(b => { const m = JSON.parse(new TextDecoder().decode(b)) as KitManifest; if (m.contract !== 'humanoid-kit/1') throw Error('unsupported humanoid kit'); return m; });
  }
  rig(frame: string): Promise<Rig> {
    let p = this.rigs.get(frame);
    if (!p) this.rigs.set(frame, p = (async () => {
      const m = await this.manifest(), f = m.frames[frame]; if (!f) throw Error('unknown frame ' + frame);
      const gltf = await this.loader.parseAsync(await this.fetch(f.rig), '');
      const bin = await gltf.parser.getDependency('buffer', 0) as ArrayBuffer;
      let binder: THREE.SkinnedMesh | undefined; gltf.scene.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) binder = o as THREE.SkinnedMesh; });
      if (!binder) throw Error('humanoid rig has no skin');
      const bones = binder.skeleton.bones.map(b => b.name), PROP = ['position', 'quaternion', 'scale'];
      const table = (gltf.userData as {humanoid?: {clips?: [string, number, number[][]][]}}).humanoid?.clips ?? [];
      const clips = table.map(([name, , channels]) => new THREE.AnimationClip(name, -1, channels.map(([bone, path, interp, tOff, n, vOff]) => {
        const times = new Float32Array(bin.slice(tOff, tOff + 4 * n)), track = bones[bone] + '.' + PROP[path], mode = interp ? THREE.InterpolateLinear : THREE.InterpolateDiscrete;
        if (path === 1) { const q = new Int16Array(bin, vOff, 4 * n); return new THREE.QuaternionKeyframeTrack(track, times, Float32Array.from(q, x => Math.max(x / 32767, -1)), mode); }
        return new THREE.VectorKeyframeTrack(track, times, new Float32Array(bin.slice(vOff, vOff + 12 * n)), mode);
      })));
      const root = gltf.scene.getObjectByName('CharacterArmature'); if (!root) throw Error('humanoid rig has no armature');
      gltf.scene.updateMatrixWorld(true);
      const sk = binder.skeleton.bones, joints = sk.map(b => b.getWorldPosition(new THREE.Vector3()));
      const ends = sk.map(b => { const c = b.children.find(o => (o as THREE.Bone).isBone && sk.includes(o as THREE.Bone)); return c ? c.getWorldPosition(new THREE.Vector3()) : null; });
      return {root, ib: binder.skeleton.boneInverses, clips, names: bones, joints, ends};
    })());
    return p;
  }
  part(slot: string, id: string, frame: string): Promise<THREE.BufferGeometry> {
    const key = `${slot}-${id}.${frame}`; let p = this.parts.get(key);
    if (!p) this.parts.set(key, p = (async () => {
      const m = await this.manifest(), e = m.parts[slot]?.[id]; if (!e) throw Error(`unknown ${slot} ${id}`);
      const gltf = await this.loader.parseAsync(await this.fetch(e.files[frame].file), '');
      let geo: THREE.BufferGeometry | undefined; gltf.scene.traverse(o => { if ((o as THREE.Mesh).isMesh) geo = (o as THREE.Mesh).geometry; });
      if (!geo) throw Error(`empty part ${key}`);
      const info = geo.getAttribute('_hinfo'); if (info) { geo.setAttribute('hinfo', info); geo.deleteAttribute('_hinfo'); }
      return geo;
    })());
    return p;
  }
  private head(look: Look): Promise<THREE.BufferGeometry> {
    const key = ['head', look.frame, look.face, look.hair, look.hat, look.glasses, look.headSize].join(':'); let p = this.merged.get(key);
    if (!p) this.merged.set(key, p = (async () => {
      const m = await this.manifest(), fr = m.frames[look.frame], face = await this.part('face', look.face, look.frame);
      const hair = look.hair === 'bald' ? null : await this.part('hair', look.hair, look.frame);
      const lf = m.parts.face[look.face].landmarks[look.frame], lh = hair ? m.parts.hair[look.hair].landmarks[look.frame] : null;
      const fit: HeadFit = {cz: (lh ?? lf).cz!, rx: Math.max(lf.rx!, lh?.rx ?? 0), rz: Math.max(lf.rz!, lh?.rz ?? 0), top: Math.max(lf.top!, lh?.top ?? 0), eye: lf.eye!, eyeX: lf.eyeX!, templeX: lf.templeX ?? lf.rx!};
      const pieces = [...hatPieces(look.hat as Look['hat'], fit, fr.index.head), ...glassesPieces(look.glasses as Look['glasses'], fit, fr.index.head)].map(skinned);
      const geo = mergeParts([face, ...(hair ? [look.hat !== 'none' ? withoutFlag(hair, HIDE_UNDER_HAT) : hair] : []), ...pieces]);
      return scaleHead(geo, look.headSize, fr.joints.head, fr.index.head);
    })());
    return p;
  }
  private top(look: Look): Promise<THREE.BufferGeometry> {
    if (look.bag === 'none') return this.part('top', look.top, look.frame);
    const key = ['top', look.frame, look.top, look.bag].join(':'); let p = this.merged.get(key);
    if (!p) this.merged.set(key, p = (async () => {
      const m = await this.manifest(), fr = m.frames[look.frame], top = await this.part('top', look.top, look.frame), lt = m.parts.top[look.top].landmarks[look.frame];
      return mergeParts([top, ...bagPieces(look.bag as Look['bag'], {back: lt.back!, front: lt.front!, chestY: fr.joints.chest[1], hipsY: fr.joints.hips[1]}, fr.index, top).map(skinned)]);
    })());
    return p;
  }
  /** The look's template (cached by look key). */
  template(params: unknown): Promise<Template> {
    const look = resolveLook(params), key = lookKey(look); let p = this.templates.get(key);
    if (!p) this.templates.set(key, p = this.compose(look, key));
    return p;
  }
  /** Tris of a look (budget checks), from the manifest plus prop geometry. */
  async tris(params: unknown) { const look = resolveLook(params), [head, top, b, s] = await this.geometries(look); return [head, top, b, s].reduce((a, g) => a + g.index!.count / 3, 0); }
  private async geometries(look: Look) {
    const base = await Promise.all([this.head(look), this.top(look), this.part('bottom', look.bottom, look.frame), this.part('shoes', look.shoes, look.frame)]);
    if (look.build === 1) return base;
    const rig = await this.rig(look.frame), keys = [['head', look.frame, look.face, look.hair, look.hat, look.glasses, look.headSize], ['top', look.frame, look.top, look.bag], ['bottom', look.frame, look.bottom], ['shoes', look.frame, look.shoes]];
    return Promise.all(base.map((g, i) => { const key = [...keys[i], 'build', look.build].join(':'); let p = this.merged.get(key); if (!p) this.merged.set(key, p = Promise.resolve(withGirth(g, look.build, rig))); return p; }));
  }
  private async compose(look: Look, key: string): Promise<Template> {
    const m = await this.manifest(), [rig, geos] = await Promise.all([this.rig(look.frame), this.geometries(look)]);
    const armature = cloneSkinned(rig.root);
    let binder: THREE.SkinnedMesh | undefined; armature.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) binder = o as THREE.SkinnedMesh; });
    const bones = binder!.skeleton.bones; binder!.removeFromParent();
    const {palette, pattern} = paletteOf(look, look.preset !== 'none' ? m.presets[look.preset]?.palette : undefined);
    const material = humanoidMaterial(palette, pattern);
    const meshes = geos.map((g, i) => { const mesh = new THREE.SkinnedMesh(g, material); mesh.name = ['head', 'top', 'bottom', 'shoes'][i]; armature.add(mesh); return mesh; });
    // Same child order as the shipped GLBs (meshes before the Root bone): people.ts fit() measures its box in
    // traversal order, so this keeps today's placement exactly (the box sees the bind pose, as it does today).
    armature.children.sort((a, b) => Number((a as THREE.Bone).isBone ?? false) - Number((b as THREE.Bone).isBone ?? false));
    armature.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(bones, rig.ib.map(b => b.clone()));
    for (const mesh of meshes) mesh.bind(skeleton, mesh.matrixWorld);
    const scene = new THREE.Group(); scene.name = 'Scene'; scene.add(armature);
    scene.userData.humanoid = {key, look};
    // fitArms rescales the arm position tracks per template: those (only) are copied, the rest is shared.
    const clips = rig.clips.map(c => c.tracks.some(t => ARM_TRACK.test(t.name)) ? new THREE.AnimationClip(c.name, c.duration, c.tracks.map(t => ARM_TRACK.test(t.name) ? t.clone() : t)) : c);
    return templateFromParts(key, scene, clips);
  }
}
