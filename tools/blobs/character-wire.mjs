#!/usr/bin/env node
// Lane W3 (2026-10-19): the character GLBs on the wire, shared instead of sent three times.
//   node tools/blobs/character-wire.mjs [--check]
// The three source GLBs (mars/viewer/public/modular/environment/animated-{casual,punk,woman}.glb) stay byte-identical:
// presets, the body-admission rig, golden tests and the studio read them. Beside them this writes what the viewer loads:
//   animated-<name>.mesh.glb  the source without its animations (the raw glTF JSON with `animations` removed and the
//                             unused accessors/bufferViews dropped: every node, mesh, primitive, material and skin index
//                             is unchanged, so the appearance presets' bindings hold)
//   clips-<rig>.glb           the 51 animations once per rig, with only the nodes they animate (and their ancestors):
//                             casual and punk share one rig and bit-identical clips (checked), woman has her own
//   character-wire.ts         (mars/viewer/app/engine-view/) the file names, sizes and sha256s; people.ts maps a mesh
//                             file's sha256 back to its source's for the presets' pin
// Deterministic: --check rebuilds in memory and fails if a committed file differs.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
export const DIR = join(ROOT, 'mars/viewer/public/modular/environment');
export const MODULE = join(ROOT, 'mars/viewer/app/engine-view/character-wire.ts');
export const RIGS = { casual: 'ual', punk: 'ual', woman: 'ual-woman' };

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
export function parseGLB(b) {
  if (b.readUInt32LE(0) !== 0x46546c67 || b.readUInt32LE(4) !== 2) throw Error('not a glTF 2 binary');
  const n = b.readUInt32LE(12); return { j: JSON.parse(b.toString('utf8', 20, 20 + n)), bin: b.subarray(28 + n, 28 + n + b.readUInt32LE(20 + n)) };
}
export function packGLB(j, bin) {
  const raw = Buffer.from(JSON.stringify(j)), json = Buffer.alloc(Math.ceil(raw.length / 4) * 4, 32); raw.copy(json);
  const binary = Buffer.alloc(Math.ceil(bin.length / 4) * 4); bin.copy(binary);
  const b = Buffer.alloc(28 + json.length + binary.length);
  b.writeUInt32LE(0x46546c67, 0); b.writeUInt32LE(2, 4); b.writeUInt32LE(b.length, 8);
  b.writeUInt32LE(json.length, 12); b.writeUInt32LE(0x4e4f534a, 16); json.copy(b, 20);
  b.writeUInt32LE(binary.length, 20 + json.length); b.writeUInt32LE(0x004e4942, 24 + json.length); binary.copy(b, 28 + json.length);
  return b;
}
/** Keep the accessors `keep` (old indices), renumbered in order by `remap`; repack only the bufferViews they use. */
function compact(j, bin, keep, remapAll) {
  const ai = [...keep].sort((a, b) => a - b), am = new Map(ai.map((i, n) => [i, n]));
  remapAll((i) => { const n = am.get(i); if (n === undefined) throw Error(`accessor ${i} not kept`); return n; });
  j.accessors = ai.map((i) => j.accessors[i]);
  const views = new Set(j.accessors.map((a) => a.bufferView).filter((v) => v !== undefined));
  for (const im of j.images ?? []) if (im.bufferView !== undefined) views.add(im.bufferView);
  const vi = [...views].sort((a, b) => a - b), vm = new Map(vi.map((i, n) => [i, n])); let off = 0; const chunks = [];
  j.bufferViews = vi.map((i) => {
    const v = j.bufferViews[i]; if (v.buffer !== 0) throw Error('one buffer expected');
    const s = v.byteOffset ?? 0, bytes = bin.subarray(s, s + v.byteLength);
    chunks.push(bytes, Buffer.alloc((4 - bytes.length % 4) % 4)); const out = { ...v, byteOffset: off }; off += Math.ceil(bytes.length / 4) * 4; return out;
  });
  for (const a of j.accessors) if (a.bufferView !== undefined) a.bufferView = vm.get(a.bufferView);
  for (const im of j.images ?? []) if (im.bufferView !== undefined) im.bufferView = vm.get(im.bufferView);
  j.buffers = [{ byteLength: off }];
  return packGLB(j, Buffer.concat(chunks));
}
/** The source without animations; node/mesh/primitive/material/skin indices unchanged. */
export function meshOf(source) {
  const { j, bin } = parseGLB(source); delete j.animations; const keep = new Set(), prims = j.meshes.flatMap((m) => m.primitives);
  for (const p of prims) { Object.values(p.attributes).forEach((i) => keep.add(i)); if (p.indices !== undefined) keep.add(p.indices); for (const t of p.targets ?? []) Object.values(t).forEach((i) => keep.add(i)); }
  for (const s of j.skins ?? []) if (s.inverseBindMatrices !== undefined) keep.add(s.inverseBindMatrices);
  return compact(j, bin, keep, (r) => {
    for (const p of prims) { for (const k in p.attributes) p.attributes[k] = r(p.attributes[k]); if (p.indices !== undefined) p.indices = r(p.indices); for (const t of p.targets ?? []) for (const k in t) t[k] = r(t[k]); }
    for (const s of j.skins ?? []) if (s.inverseBindMatrices !== undefined) s.inverseBindMatrices = r(s.inverseBindMatrices);
  });
}
/** The animations with only the nodes they target (and their ancestors), names and rest transforms kept. */
export function clipsOf(source) {
  const { j, bin } = parseGLB(source), parent = new Map();
  j.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parent.set(c, i)));
  const need = new Set(); for (const a of j.animations) for (const c of a.channels) for (let n = c.target.node; n !== undefined && !need.has(n); n = parent.get(n)) need.add(n);
  const order = [...need].sort((a, b) => a - b), nm = new Map(order.map((i, n) => [i, n]));
  const nodes = order.map((i) => { const { mesh: _m, skin: _s, children, ...rest } = j.nodes[i]; const kids = (children ?? []).filter((c) => need.has(c)).map((c) => nm.get(c)); return kids.length ? { ...rest, children: kids } : rest; });
  const roots = j.scenes[j.scene ?? 0].nodes.filter((n) => need.has(n)).map((n) => nm.get(n));
  const animations = j.animations.map((a) => ({ ...a, channels: a.channels.map((c) => ({ ...c, target: { ...c.target, node: nm.get(c.target.node) } })) }));
  const out = { asset: { version: '2.0', generator: 'sim tools/blobs/character-wire.mjs (clips of ' + j.asset.generator + ')' }, scene: 0, scenes: [{ nodes: roots }], nodes, animations, accessors: j.accessors, bufferViews: j.bufferViews, buffers: j.buffers };
  const keep = new Set(); for (const a of animations) for (const s of a.samplers) { keep.add(s.input); keep.add(s.output); }
  return compact(out, bin, keep, (r) => { for (const a of animations) for (const s of a.samplers) { s.input = r(s.input); s.output = r(s.output); } });
}

/** Every wire file (name -> bytes) and the module text, from the three sources. */
export function build(dir = DIR) {
  const files = new Map(), rows = {};
  for (const [name, rig] of Object.entries(RIGS)) {
    const source = readFileSync(join(dir, `animated-${name}.glb`)), mesh = meshOf(source), clips = clipsOf(source), clipsFile = `clips-${rig}.glb`;
    const prev = files.get(clipsFile); if (prev && !prev.equals(clips)) throw Error(`${name}: its clips differ from its rig's (${clipsFile})`);
    files.set(`animated-${name}.mesh.glb`, mesh); files.set(clipsFile, clips);
    rows[name] = { mesh: `animated-${name}.mesh.glb`, meshSHA256: sha256(mesh), meshBytes: mesh.length, clips: clipsFile, sourceSHA256: sha256(source), sourceBytes: source.length };
  }
  const clipRows = Object.fromEntries([...new Set(Object.values(RIGS))].map((rig) => { const b = files.get(`clips-${rig}.glb`); return [`clips-${rig}.glb`, { sha256: sha256(b), bytes: b.length }]; }));
  const text = `// Generated by tools/blobs/character-wire.mjs (lane W3) — do not edit; rerun the tool after changing a character GLB.\n`
    + `// What the viewer loads for each character: its mesh file (the source GLB without animations, same node/mesh/material\n`
    + `// indices) and its rig's shared clips file. sourceSHA256 is the source GLB the presets pin (human-presets/audit.json).\n`
    + `export const CHARACTER_WIRE = ${JSON.stringify(rows, null, 1)} as const;\n`
    + `export const CHARACTER_CLIPS = ${JSON.stringify(clipRows, null, 1)} as const;\n`;
  return { files, text };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { files, text } = build(), check = process.argv.includes('--check'); let bad = 0;
  for (const [name, bytes] of [...files, [MODULE, Buffer.from(text)]]) {
    const path = name.startsWith('/') ? name : join(DIR, name);
    if (check) { let cur = null; try { cur = readFileSync(path); } catch { /* missing */ } if (!cur?.equals(bytes)) { bad++; console.error('differs:', path); } }
    else { writeFileSync(path, bytes); console.log(path, bytes.length); }
  }
  if (bad) process.exit(1);
}
