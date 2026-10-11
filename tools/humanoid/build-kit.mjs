// WP1 stage 2: build the humanoid@2 kit from the Quaternius "Ultimate Modular" characters.
//   node tools/humanoid/build-kit.mjs [--parts DIR]
// Inputs: the shipped animated-{casual,punk,woman}.glb (skeletons + the 51 clips), and per-character part
// GLBs exported headless from the .blend sources by export_parts.py (DIR, default .lane/t2/src). A character
// with no export falls back to its shipped GLB (same meshes; verified identical).
// Outputs (mars/viewer/public/modular/humanoid/):
//   rig-masc.glb, rig-fem.glb   one skeleton each (casual/punk bind pose; woman bind pose) + 51 clips, no mesh
//   parts/<slot>-<id>.<frame>.glb  one merged skinned part per slot and frame (no skin node: joints index the
//                                  rig's bone order), per-vertex _HINFO = [palette slot, finish role, roughness, flags]
//   kit.json                    manifest: frames, parts (label, native frame, tris, bytes, sha256, licence, landmarks)
import {readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {THREE, ENV_DIR, parseGlb} from './three.mjs';
import {GlbWriter} from './glb.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const OUT = ROOT + 'mars/viewer/public/modular/humanoid/';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const PARTS_DIR = arg('--parts', ROOT + '.lane/t2/src/');
const LICENCE = 'CC0-1.0 — Quaternius, Ultimate Modular Men / Women packs (quaternius.com)';

// Palette slots (index into the shader palette) and finish roles (finish.ts ROLE_ID).
export const SLOTS = ['skin', 'skinShade', 'hair', 'hairShade', 'brows', 'eyes', 'top1', 'top2', 'bottom', 'shoes', 'soles', 'accent', 'gear', 'gearDark', 'lens', 'spare'];
const ROLE = {skin: 1, cloth: 2, denim: 3, leather: 4, sole: 5, hair: 6, brow: 7, eye: 8, trinket: 9};
const S = n => SLOTS.indexOf(n);
const HIDE_UNDER_HAT = 1;

// Per character: native frame, source files, and per part node → output part, material → [slot, role, roughness].
// Roles and roughness are finish.ts HUMAN_FINISH (asserted equal in apps/web/test/humanoid-kit.cpu.mjs).
export const CHARACTERS = [
  {source: 'Casual_2', shipped: 'casual', frame: 'masc', parts: {
    Head: {face: 'open', hair: 'short'}, Body: {top: 'shirt'}, Legs: {bottom: 'jeans'}, Feet: {shoes: 'sneakers'}},
   materials: {Skin: ['skin', 'skin', .62], Skin_Darker: ['skinShade', 'skin', .62], Eyebrows: ['brows', 'brow', .82], Hair: ['hair', 'hair', .58, 'hair'],
     Eye: ['eyes', 'eye', .22], LightBrown: ['top1', 'cloth', .88], Red_Dark: ['shoes', 'leather', .6], White: ['soles', 'sole', .9], LightBlue: ['bottom', 'denim', .9]}},
  {source: 'Punk', shipped: 'punk', frame: 'masc', parts: {
    Head: {face: 'pierced', hair: 'mohawk'}, Body: {top: 'jacket'}, Legs: {bottom: 'ripped'}, Feet: {shoes: 'boots'}},
   materials: {Skin: ['skin', 'skin', .62], White: ['top2', 'cloth', .88], Black: ['top1', 'leather', .6], Eye: ['eyes', 'eye', .22], Eyebrows: ['brows', 'brow', .82],
     Red_Dark: ['hairShade', 'hair', .58, 'hair'], Red: ['hair', 'hair', .58, 'hair', HIDE_UNDER_HAT], Earrings: ['accent', 'trinket', .36], LightBlue: ['bottom', 'denim', .9]},
   // the punk's boots are Black like its jacket: on the Feet part Black is the shoe colour
   partMaterials: {Feet: {Black: ['shoes', 'leather', .6]}}},
  {source: 'Woman_Casual', shipped: 'woman', frame: 'fem', parts: {
    Head: {face: 'soft', hair: 'bob'}, Body: {top: 'tank'}, Legs: {bottom: 'slacks'}, Feet: {shoes: 'flats'}},
   materials: {Skin: ['skin', 'skin', .62], White: ['top1', 'cloth', .86], Grey: ['shoes', 'leather', .62], Hair_Brown: ['brows', 'brow', .82], Brown: ['eyes', 'eye', .22],
     Hair_Blond: ['hair', 'hair', .58, 'hair'], Orange: ['bottom', 'cloth', .88]}},
];
export const LABELS = {
  face: {open: 'Open face', pierced: 'Pierced ears', soft: 'Soft features'},
  hair: {short: 'Short hair', mohawk: 'Mohawk', bob: 'Bob'},
  top: {shirt: 'Long-sleeve shirt', jacket: 'Jacket over tee', tank: 'Tank top'},
  bottom: {jeans: 'Jeans', ripped: 'Ripped jeans', slacks: 'Slacks'},
  shoes: {sneakers: 'Sneakers', boots: 'Boots', flats: 'Flats'},
};
const FRAMES = {masc: 'casual', fem: 'woman'}; // frame → shipped GLB that defines its skeleton + clips

// ---------- more characters (the other 18 Quaternius blends, when they are on disk) ----------
// build-kit.sh exports every .blend under SOURCE_DIR, SOURCE_DIR/men and SOURCE_DIR/women to PARTS_DIR and writes
// PARTS_DIR/frames.json {Name: 'masc'|'fem'} (men → masc, women → fem). Every exported character that is not one
// of the three hand-mapped ones above gets an automatic row: part ids from its name (adventurer → face-adventurer,
// hair-adventurer, top-adventurer, …) and palette slots from its material names and sizes (skin, brows, eyes and
// hair by name; the largest other material of a part is its main colour, the next its accent).
const slug = name => name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
const nameOf = file => file.replace(/\.glb$/, '');
const autoFrames = existsSync(PARTS_DIR + 'frames.json') ? JSON.parse(readFileSync(PARTS_DIR + 'frames.json', 'utf8')) : {};
function autoCharacter(source, g) {
  const id = slug(source), bySuffix = {};
  g.scene.traverse(o => { if (!o.isSkinnedMesh) return; const holder = o.parent && !o.parent.isBone && o.parent.name !== 'CharacterArmature' ? o.parent.name : o.name, suffix = holder.slice(holder.lastIndexOf('_') + 1);
    (bySuffix[suffix] ??= {})[o.material.name] = (bySuffix[suffix][o.material.name] ?? 0) + o.geometry.attributes.position.count; });
  const partMaterials = {};
  for (const [suffix, mats] of Object.entries(bySuffix)) {
    const out = partMaterials[suffix] = {}, rest = [];
    for (const [m] of Object.entries(mats).sort((a, b) => b[1] - a[1])) {
      if (/skin/i.test(m)) out[m] = /dark/i.test(m) ? ['skinShade', 'skin', .62] : ['skin', 'skin', .62];
      else if (/brow/i.test(m)) out[m] = ['brows', 'brow', .82];
      else if (/^eye/i.test(m)) out[m] = ['eyes', 'eye', .22];
      else if (suffix === 'Head' && /hair|beard|mustache|moustache/i.test(m)) out[m] = ['hair', 'hair', .58, 'hair'];
      else rest.push(m);
    }
    const main = {Head: [['accent', 'trinket', .36]], Body: [['top1', 'cloth', .88], ['top2', 'cloth', .88]], Legs: [['bottom', 'cloth', .9], ['top2', 'cloth', .88]], Feet: [['shoes', 'leather', .6], ['soles', 'sole', .9]]}[suffix] ?? [];
    rest.forEach((m, i) => { out[m] = main[i] ?? ['accent', 'trinket', .36]; });
  }
  return {source, frame: autoFrames[source] ?? 'masc', auto: true, parts: {Head: {face: id, hair: id}, Body: {top: id}, Legs: {bottom: id}, Feet: {shoes: id}}, materials: {}, partMaterials};
}
const known = new Set(CHARACTERS.map(c => c.source));
const extra = existsSync(PARTS_DIR) ? readdirSync(PARTS_DIR).filter(f => f.endsWith('.glb') && !known.has(nameOf(f))).map(nameOf).sort() : [];

const sha = b => createHash('sha256').update(b).digest('hex');
const load = async file => parseGlb(readFileSync(file));
const shipped = {}; for (const n of ['casual', 'punk', 'woman']) shipped[n] = await load(ENV_DIR + `animated-${n}.glb`);
const skeletonOf = g => { let s; g.scene.traverse(o => { if (o.isSkinnedMesh && !s) s = o.skeleton; }); return s; };

// ---------- rigs ----------
const frames = {};
for (const [frame, src] of Object.entries(FRAMES)) {
  const g = shipped[src], sk = skeletonOf(g), bones = sk.bones;
  const names = bones.map(b => b.name);
  const w = new GlbWriter();
  const index = new Map(bones.map((b, i) => [b, i]));
  bones.forEach(b => w.node({name: b.name, translation: b.position.toArray(), rotation: b.quaternion.toArray(), ...(b.scale.equals(new THREE.Vector3(1, 1, 1)) ? {} : {scale: b.scale.toArray()})}));
  bones.forEach((b, i) => { const ch = b.children.filter(c => index.has(c)).map(c => index.get(c)); if (ch.length) w.json.nodes[i].children = ch; });
  const roots = bones.filter(b => !index.has(b.parent)).map(b => index.get(b));
  // A one-triangle binder mesh carries the skin so GLTFLoader builds Bones and the bind inverses.
  const ibm = new Float32Array(bones.length * 16); sk.boneInverses.forEach((m, i) => ibm.set(m.elements, i * 16));
  const skin = w.skin({name: 'humanoid', joints: bones.map((_, i) => i), inverseBindMatrices: ibm});
  const binderMesh = w.mesh({name: 'binder', attributes: {
    POSITION: {array: new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0]), size: 3},
    JOINTS_0: {array: new Uint8Array(12), size: 4}, WEIGHTS_0: {array: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0]), size: 4, normalized: true}},
    indices: new Uint16Array([0, 1, 2])});
  const binder = w.node({name: 'binder', mesh: binderMesh, skin});
  const armature = w.node({name: 'CharacterArmature', children: [...roots, binder]});
  w.json.scenes[0].nodes = [armature];
  const node = new Map(names.map((n, i) => [n, i]));
  // Clips as a compact table over raw BIN data (glTF animation JSON would be ~0.7 MB for 3.7k channels):
  // clip = [name, duration, channels], channel = [bone, path 0 position|1 quaternion|2 scale, interp 0 STEP|1 LINEAR,
  // timesOffset, keyCount, valuesOffset]; times float32, quaternions int16 normalized (≤ 3e-5), others float32.
  const PATH = {position: 0, quaternion: 1, scale: 2};
  let channels = 0; const clips = [];
  for (const clip of g.animations) {
    const ch = clip.tracks.map(t => {
      const dot = t.name.lastIndexOf('.'), bone = t.name.slice(0, dot), prop = t.name.slice(dot + 1);
      if (!node.has(bone) || PATH[prop] === undefined) throw Error(`unexpected track ${t.name}`);
      const interp = t.getInterpolation() === THREE.InterpolateDiscrete ? 0 : t.getInterpolation() === THREE.InterpolateLinear ? 1 : -1;
      if (interp < 0) throw Error(`unexpected interpolation on ${t.name}`);
      const values = prop === 'quaternion' ? Int16Array.from(t.values, v => Math.round(Math.max(-1, Math.min(1, v)) * 32767)) : Float32Array.from(t.values);
      return [node.get(bone), PATH[prop], interp, w.raw(Float32Array.from(t.times)), t.times.length, w.raw(values)];
    });
    channels += ch.length; clips.push([clip.name, +clip.duration.toFixed(6), ch]);
  }
  const bytes = w.finish({humanoid: {contract: 'humanoid-rig/1', frame, source: `animated-${src}.glb`, licence: LICENCE, clips}});
  mkdirSync(OUT, {recursive: true}); writeFileSync(OUT + `rig-${frame}.glb`, bytes);
  const world = n => { const b = bones[names.indexOf(n)]; b.updateWorldMatrix(true, false); return b.getWorldPosition(new THREE.Vector3()).toArray().map(v => +v.toFixed(5)); };
  frames[frame] = {rig: `rig-${frame}.glb`, bytes: bytes.length, sha256: sha(bytes), bones: names.length, clips: g.animations.length, channels, ib: sk.boneInverses, names,
    joints: {head: world('Head'), neck: world('Neck'), chest: world('Chest'), hips: world('Hips'), shoulderL: world('UpperArmL'), shoulderR: world('UpperArmR')},
    index: {head: names.indexOf('Head'), chest: names.indexOf('Chest'), hips: names.indexOf('Hips'), torso: names.indexOf('Torso')}};
}
if (frames.masc.names.join() !== frames.fem.names.join()) throw Error('frames must share one bone order');
// casual and punk share skeleton and clips exactly (that is why the masc frame serves both)
{
  const a = skeletonOf(shipped.casual), b = skeletonOf(shipped.punk);
  a.boneInverses.forEach((m, i) => { if (!m.equals(b.boneInverses[i])) throw Error('punk bind pose differs from casual'); });
  if (shipped.casual.animations.some((c, i) => c.tracks.some((t, k) => { const u = shipped.punk.animations[i].tracks[k]; return t.name !== u.name || t.values.some((v, j) => v !== u.values[j]); }))) throw Error('punk clips differ from casual');
}

// ---------- parts ----------
const parts = {};
const quantWeights = (w4) => { // uint8 weights summing to exactly 255 (largest remainder)
  const raw = w4.map(v => Math.max(0, v)), sum = raw.reduce((a, b) => a + b, 0) || 1, s = raw.map(v => v / sum * 255);
  const q = s.map(Math.floor); let left = 255 - q.reduce((a, b) => a + b, 0);
  const order = s.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0; k++, left--) q[order[k % 4][1]]++;
  return q;
};
const repose = (from, to) => from.ib.map((ibFrom, j) => new THREE.Matrix4().copy(frames[to].ib[j]).invert().multiply(ibFrom));

const skipped = [];
for (const source of extra) CHARACTERS.push(autoCharacter(source, await load(PARTS_DIR + source + '.glb')));
for (const ch of CHARACTERS) {
  const file = PARTS_DIR + ch.source + '.glb', g = existsSync(file) ? await load(file) : shipped[ch.shipped];
  if (ch.auto) { // an automatic character whose skeleton is not one of the two frames' bind poses is skipped, named
    let bad = null; g.scene.traverse(o => { if (bad || !o.isSkinnedMesh) return; o.skeleton.bones.forEach((b, i) => { const j = frames[ch.frame].names.indexOf(b.name); if (j < 0) bad = 'bone ' + b.name; else if (o.skeleton.boneInverses[i].elements.some((v, k) => Math.abs(v - frames[ch.frame].ib[j].elements[k]) > 1e-4)) bad ??= 'bind pose of ' + b.name; }); });
    if (bad) { skipped.push(`${ch.source}: ${bad} differs from frame ${ch.frame}`); continue; }
  }
  const via = existsSync(file) ? 'blend export' : 'shipped GLB';
  const groups = new Map(); // part node suffix → [skinned meshes]
  g.scene.traverse(o => {
    if (!o.isSkinnedMesh) return;
    const holder = o.parent && !o.parent.isBone && o.parent.name !== 'CharacterArmature' ? o.parent.name : o.name;
    const suffix = holder.slice(holder.lastIndexOf('_') + 1);
    if (!ch.parts[suffix]) throw Error(`${ch.source}: unknown part node ${holder}`);
    if (!groups.has(suffix)) groups.set(suffix, []); groups.get(suffix).push(o);
  });
  for (const [suffix, meshes] of groups) for (const [slot, id] of Object.entries(ch.parts[suffix])) {
    // which primitives go to this output part: Head splits into face (all but hair) and hair
    const pick = meshes.filter(m => { const def = ch.partMaterials?.[suffix]?.[m.material.name] ?? ch.materials[m.material.name]; if (!def) throw Error(`${ch.source}: no slot for ${m.material.name}`);
      return slot === 'hair' ? def[3] === 'hair' : slot === 'face' ? def[3] !== 'hair' : true; });
    if (!pick.length) continue;
    const pos = [], nor = [], joi = [], wei = [], info = [], idx = [];
    for (const m of pick) {
      const def = ch.partMaterials?.[suffix]?.[m.material.name] ?? ch.materials[m.material.name];
      const geo = m.geometry, base = pos.length / 3, sk = m.skeleton;
      const remap = sk.bones.map(b => { const i = frames[ch.frame].names.indexOf(b.name); if (i < 0) throw Error('unknown bone ' + b.name); return i; });
      // the source skin must be the native frame's bind pose (within float noise)
      sk.boneInverses.forEach((ib, i) => { const ref = frames[ch.frame].ib[remap[i]]; if (ib.elements.some((v, k) => Math.abs(v - ref.elements[k]) > 1e-4)) throw Error(`${ch.source}: bind pose of ${sk.bones[i].name} differs from frame ${ch.frame}`); });
      const P = geo.attributes.position, N = geo.attributes.normal, J = geo.attributes.skinIndex, W = geo.attributes.skinWeight;
      for (let i = 0; i < P.count; i++) {
        pos.push(P.getX(i), P.getY(i), P.getZ(i)); nor.push(N.getX(i), N.getY(i), N.getZ(i));
        joi.push(remap[J.getX(i)], remap[J.getY(i)], remap[J.getZ(i)], remap[J.getW(i)]); wei.push(W.getX(i), W.getY(i), W.getZ(i), W.getW(i));
        info.push(S(def[0]), ROLE[def[1]], Math.round(def[2] * 255), def[4] ?? 0);
      }
      const I = geo.index; for (let t = 0; t < I.count; t++) idx.push(base + I.getX(t));
    }
    const count = pos.length / 3;
    parts[slot] ??= {}; const entry = parts[slot][id] = {label: LABELS[slot]?.[id] ?? `${ch.source.replace(/_/g, ' ')} ${slot}`, native: ch.frame, source: `${ch.source}.blend (${via})`, licence: LICENCE, tris: idx.length / 3, verts: count, files: {}, landmarks: {}};
    for (const frame of Object.keys(frames)) {
      let P = Float32Array.from(pos), Nn = Float32Array.from(nor);
      if (frame !== ch.frame) { // re-pose into the other frame's bind pose: v' = Σ w · inv(IB_to)·IB_from · v
        const M = repose(frames[ch.frame], frame), v = new THREE.Vector3(), n = new THREE.Vector3(), acc = new THREE.Vector3(), accn = new THREE.Vector3(), m3 = new THREE.Matrix3();
        for (let i = 0; i < count; i++) {
          acc.set(0, 0, 0); accn.set(0, 0, 0);
          for (let k = 0; k < 4; k++) { const wk = wei[i * 4 + k]; if (!wk) continue; const Mk = M[joi[i * 4 + k]];
            acc.addScaledVector(v.fromArray(pos, i * 3).applyMatrix4(Mk), wk); accn.addScaledVector(n.fromArray(nor, i * 3).applyMatrix3(m3.getNormalMatrix(Mk)), wk); }
          acc.toArray(P, i * 3); accn.normalize().toArray(Nn, i * 3);
        }
      }
      const w = new GlbWriter();
      const qn = Int8Array.from(Nn, x => Math.round(Math.max(-1, Math.min(1, x)) * 127));
      const qw = new Uint8Array(count * 4); for (let i = 0; i < count; i++) qw.set(quantWeights(wei.slice(i * 4, i * 4 + 4)), i * 4);
      const mesh = w.mesh({name: `${slot}-${id}`, attributes: {
        POSITION: {array: P, size: 3}, NORMAL: {array: qn, size: 3, normalized: true},
        JOINTS_0: {array: Uint8Array.from(joi), size: 4}, WEIGHTS_0: {array: qw, size: 4, normalized: true},
        _HINFO: {array: Uint8Array.from(info), size: 4}},
        indices: count < 65536 ? Uint16Array.from(idx) : Uint32Array.from(idx)});
      w.json.scenes[0].nodes = [w.node({name: `${slot}-${id}`, mesh})];
      const bytes = w.finish({humanoid: {contract: 'humanoid-part/1', slot, id, frame, native: ch.frame, licence: LICENCE}});
      const name = `parts/${slot}-${id}.${frame}.glb`; mkdirSync(OUT + 'parts', {recursive: true}); writeFileSync(OUT + name, bytes);
      entry.files[frame] = {file: name, bytes: bytes.length, sha256: sha(bytes)};
      // landmarks (bind space of this frame) for props and budgets
      const box = new THREE.Box3(); for (let i = 0; i < count; i++) box.expandByPoint(new THREE.Vector3().fromArray(P, i * 3));
      const lm = {min: box.min.toArray().map(v => +v.toFixed(4)), max: box.max.toArray().map(v => +v.toFixed(4))};
      if (slot === 'face' || slot === 'hair') { // horizontal radius of the head above the brow line (hat fit)
        const eyes = []; let rx = 0, rz = 0, cz = 0, n = 0;
        for (let i = 0; i < count; i++) { const y = P[i * 3 + 1]; if (info[i * 4] === S('eyes')) eyes.push([P[i * 3], y, P[i * 3 + 2]]); if (y > 1.66) { cz += P[i * 3 + 2]; n++; } }
        cz = n ? cz / n : 0;
        for (let i = 0; i < count; i++) { const y = P[i * 3 + 1]; if (y > 1.66 && !(info[i * 4 + 3] & HIDE_UNDER_HAT)) { rx = Math.max(rx, Math.abs(P[i * 3])); rz = Math.max(rz, Math.abs(P[i * 3 + 2] - cz)); } }
        Object.assign(lm, {cz: +cz.toFixed(4), rx: +rx.toFixed(4), rz: +rz.toFixed(4)});
        if (eyes.length) { const e = eyes.reduce((a, p) => a.map((v, k) => v + p[k] / eyes.length), [0, 0, 0]); lm.eye = e.map(v => +v.toFixed(4)); lm.eyeX = +Math.max(...eyes.map(p => Math.abs(p[0]))).toFixed(4);
          // half width of the face at the eye line, behind the eyes (glasses temples)
          let tx = 0; for (let i = 0; i < count; i++) if (Math.abs(P[i * 3 + 1] - e[1]) < 0.015 && P[i * 3 + 2] < e[2] - 0.02 && P[i * 3 + 2] > e[2] - 0.1 && info[i * 4] === S("skin")) tx = Math.max(tx, Math.abs(P[i * 3])); lm.templeX = +tx.toFixed(4); }
        let top = -Infinity; for (let i = 0; i < count; i++) if (!(info[i * 4 + 3] & HIDE_UNDER_HAT)) top = Math.max(top, P[i * 3 + 1]); lm.top = +top.toFixed(4);
      }
      if (slot === 'top') { // back of the chest (backpack) and chest front (strap)
        let back = Infinity, front = -Infinity; for (let i = 0; i < count; i++) { const y = P[i * 3 + 1]; if (y > 1.15 && y < 1.4 && Math.abs(P[i * 3]) < 0.12) { back = Math.min(back, P[i * 3 + 2]); front = Math.max(front, P[i * 3 + 2]); } }
        Object.assign(lm, {back: +back.toFixed(4), front: +front.toFixed(4)});
      }
      entry.landmarks[frame] = lm;
    }
  }
}
// Legacy looks (presets casual/punk/woman): parts and the exact linear baseColorFactor of every material slot.
const presets = {};
for (const ch of CHARACTERS.filter(c => c.shipped)) {
  const palette = {}, g = shipped[ch.shipped];
  g.scene.traverse(o => { if (!o.isSkinnedMesh) return; const holder = o.parent && !o.parent.isBone && o.parent.name !== 'CharacterArmature' ? o.parent.name : o.name, suffix = holder.slice(holder.lastIndexOf('_') + 1);
    const def = ch.partMaterials?.[suffix]?.[o.material.name] ?? ch.materials[o.material.name], c = o.material.color.toArray().map(v => +v.toFixed(6));
    if (palette[def[0]] && palette[def[0]].some((v, i) => Math.abs(v - c[i]) > 1e-6)) throw Error(`${ch.source}: slot ${def[0]} has two colours`); palette[def[0]] = c; });
  presets[ch.shipped] = {frame: ch.frame, ...Object.fromEntries(Object.values(ch.parts).flatMap(p => Object.entries(p))), palette};
}
const kit = {contract: 'humanoid-kit/1', version: 1, licence: LICENCE, slots: SLOTS, roles: ROLE, presets,
  frames: Object.fromEntries(Object.entries(frames).map(([k, f]) => [k, {rig: f.rig, bytes: f.bytes, sha256: f.sha256, bones: f.bones, clips: f.clips, channels: f.channels, joints: f.joints, index: f.index}])),
  parts};
writeFileSync(OUT + 'kit.json', JSON.stringify(kit, null, 1) + '\n');
const total = Object.values(parts).flatMap(p => Object.values(p)).flatMap(p => Object.values(p.files)).reduce((a, f) => a + f.bytes, 0);
console.log('rigs', Object.entries(frames).map(([k, f]) => `${k} ${f.bytes} B (${f.clips} clips, ${f.channels} channels)`).join('; '));
console.log('parts', Object.entries(parts).map(([s, p]) => `${s}: ${Object.entries(p).map(([id, e]) => `${id} ${e.tris} tris ${e.files.masc.bytes}/${e.files.fem.bytes} B`).join(', ')}`).join('\n      '));
console.log('part bytes total', total);
if (skipped.length) console.log('skipped characters:\n  ' + skipped.join('\n  '));
// The def's part enums follow the kit (core/humanoid@2 in packages/world-compiler/src/core-kit.ts; hair adds 'bald').
{
  const defFile = ROOT + 'packages/world-compiler/src/core-kit.ts'; let src = readFileSync(defFile, 'utf8'); const before = src;
  const at = src.indexOf("name: 'core-humanoid', version: 2"), end = src.indexOf('} },', at);
  let block = src.slice(at, end);
  for (const slot of ['face', 'hair', 'top', 'bottom', 'shoes']) {
    const values = [...Object.keys(parts[slot] ?? {}), ...(slot === 'hair' ? ['bald'] : [])];
    block = block.replace(new RegExp(`(\\b${slot}: \\{ type: 'enum', values: )\\[[^\\]]*\\]`), `$1[${values.map(v => `'${v}'`).join(', ')}]`);
  }
  src = src.slice(0, at) + block + src.slice(end);
  if (src !== before) { writeFileSync(defFile, src); console.log('core/humanoid@2 part enums updated in', defFile); }
}
