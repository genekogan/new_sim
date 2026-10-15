#!/usr/bin/env node
// Offline companion to the pixel gate, useful where the OS forbids launching Chrome.
// --before-source <saved kit.mesh.ts> compares current geometry/materials with the pre-change mesher.
// --snapshot <world.json> limits the corpus to that snapshot's kits (e.g. the M2 replay).
import { readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CORE_KIT, WorldModel } from '../../../packages/world-compiler/src/index.ts';
import { kitArgs, kitPhysics } from '../../../packages/generators/src/kit.ts';
import { buildKit } from '../../../apps/web/src/gen-mesh/kit.mesh.ts';
import { MaterialLib } from '../../../apps/web/src/gen-mesh/materials.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..'), argv = process.argv.slice(2);
const flag = k => { const i = argv.indexOf(`--${k}`); return i < 0 ? undefined : argv[i + 1]; };
const out = resolve(flag('out') ?? '.lane/gallery-geometry'); mkdirSync(out, { recursive: true });
let beforeBuild;
if (flag('before-source')) {
  const esbuild = await import(pathToFileURL(resolve(realpathSync(resolve(root, 'apps/web/node_modules/vite')), '../esbuild/lib/main.js')).href);
  const target = resolve(out, 'before-mesh.mjs');
  await esbuild.build({ stdin: { contents: readFileSync(flag('before-source'), 'utf8'), resolveDir: resolve(root, 'apps/web/src/gen-mesh'), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile: target, logLevel: 'error' });
  beforeBuild = (await import(pathToFileURL(target).href)).buildKit;
}
const snapshot = flag('snapshot') ? JSON.parse(readFileSync(flag('snapshot'), 'utf8')) : null;
const model = new WorldModel({ constants: { ground: 'land' }, seed: 'gallery-geometry' });
const defs = (flag('defs') ? JSON.parse(readFileSync(flag('defs'), 'utf8')) : snapshot?.defs ?? CORE_KIT).map(d => d.hash ? d : model.defineDef(d, 'core', 0)).filter(d => d.make.kind === 'gen' && d.make.gen === 'kit/2');

function capture(build, def, shapes) {
  const args = kitArgs.parse({ ...def.make.args, ...(shapes ? { shapes } : {}) }), lib = new MaterialLib();
  const obj = build(args, { materials: lib, params: Object.fromEntries(Object.entries(def.params ?? {}).map(([k, v]) => [k, v.default])), state: {}, tint: (key, fallback) => def.palette?.[key] ?? fallback });
  const hash = createHash('sha256'); let tris = 0, draws = 0;
  obj.updateMatrixWorld(true);
  obj.traverse(o => {
    hash.update(JSON.stringify({ name: o.name, matrix: o.matrixWorld.elements, gait: o.userData.gait }));
    if (!o.isMesh) return;
    draws++; tris += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
    for (const key of ['position', 'normal', 'color']) { const a = o.geometry.attributes[key].array; hash.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)); }
    const m = o.material;
    hash.update(JSON.stringify({ color: m.color.toArray(), glow: m.emissive.toArray(), intensity: m.emissiveIntensity, roughness: m.roughness, metalness: m.metalness, side: m.side, transparent: m.transparent, opacity: m.opacity, cast: o.castShadow, receive: o.receiveShadow }));
  });
  obj.traverse(o => o.geometry?.dispose()); lib.dispose();
  return { hash: hash.digest('hex'), tris, draws, shapes: args.shapes.length, estimatedTris: kitPhysics(args).tris };
}

const rows = defs.map(def => {
  const after = capture(buildKit, def), before = beforeBuild ? capture(beforeBuild, def) : undefined;
  return { name: def.name, after, ...(before ? { before, changed: before.hash !== after.hash, triangleDelta: after.tris - before.tris, drawDelta: after.draws - before.draws } : {}) };
});
const report = { schema: 'kit-geometry-diff/1', count: rows.length, changed: rows.filter(r => r.changed), defs: rows };
if (snapshot) {
  const west = defs.find(d => d.name === 'gothic-west-front');
  if (west) report.m2West = { full: capture(buildKit, west), rose: capture(buildKit, west, west.make.args.shapes.slice(21)) };
}
writeFileSync(resolve(out, 'geometry.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`${rows.length} kits; ${report.changed.length} geometry/material changes; ${rows.reduce((n, r) => n + r.after.tris, 0)} triangles; report ${resolve(out, 'geometry.json')}`);
if (report.m2West) console.log(`M2 west front: ${report.m2West.full.shapes} shapes / ${report.m2West.full.tris} triangles; rose subset: ${report.m2West.rose.shapes} shapes / ${report.m2West.rose.tris} triangles`);
if (flag('defs')) for (const row of rows) console.log(`${row.name}: ${row.after.shapes} shapes / ${row.after.tris} triangles / ${row.after.draws} draws (budget ${row.after.estimatedTris})`);
if (report.changed.length) process.exitCode = 1;
