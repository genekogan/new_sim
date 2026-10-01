// Offline extractor: procedural historical scenes (app/history/scenes.ts, the same
// Kit code the browser runs) → compact, provenance-tagged engine scene data
// public/engine/campus-<year>.json for 2020–2025, same schema as campus-2026.json.
//   node deploy/history-scenes.mjs            # write all years
//   node deploy/history-scenes.mjs --check    # re-extract, compare contentHash, write nothing
//   node deploy/history-scenes.mjs 2021 2022  # only these years
// Scenes are built in Node with three.js, texture loads and canvases stubbed
// (as deploy/history-ids.test.mjs does); ids come from Kit.finalize().
import { readFile, writeFile, stat, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { build } from 'esbuild';
import * as T from 'three';
import { buildYearFile, historyConfidence } from '../engine/campus/history-extract.ts';
import { HISTORY_YEARS } from '../engine/campus/history.ts';
import { YEAR_NORTH_AZIMUTH_OFFSET } from '../engine/env/sun.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outOf = (year) => `public/engine/campus-${year}.json`;
const SKIP_ASSEMBLIES = new Set(['people']);

async function loadScenes() {
  const file = path.join(ROOT, `.history-scenes-${process.pid}.mjs`);
  await build({ entryPoints: [path.join(ROOT, 'app/history/scenes.ts')], bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: file, logLevel: 'error' });
  T.TextureLoader.prototype.load = function () { return new T.Texture(); };
  // oxlint-disable-next-line typescript/no-deprecated -- offline scene construction; no renderer
  globalThis.document = { createElement: () => ({ width: 1, height: 1, getContext: () => new Proxy({}, { get: (_t, key) => (key === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}) }) }) };
  try { return await import(file); } finally { await unlink(file); }
}

/** 2020 groups carry confidence high/medium/low; Kit pieces carry their assembly's `source` note. */
function confidenceNote(o) {
  for (let p = o; p; p = p.parent) if (p.userData?.confidence) return p.userData.confidence;
  return o.userData.source;
}

export function extractYear(scenes, year) {
  const root = scenes.createHistoricalScene(year);
  root.updateMatrixWorld(true);
  const manifest = scenes.sceneManifest(root, year);
  const asmConf = new Map();
  const parents = new Map();
  root.traverse(o=>{
    const id=o.userData.assembly_id;
    if(!id||o.userData.layer||o.userData.component_id)return;
    for(let p=o.parent;p;p=p.parent){
      const parent=p.userData.assembly_id;
      if(parent&&parent!==id&&!p.userData.layer&&!p.userData.component_id){parents.set(id,parent);break;}
    }
  });
  const tris = new Map(); // component id → { meta, arr }
  const v = new T.Vector3();
  root.traverse((o) => {
    // Preserve raw/source IDs in the manifest, but do not export quarantined
    // historical geometry as an engine-visible/collidable component.
    for (let ancestor = o; ancestor; ancestor = ancestor.parent) if (ancestor.visible === false) return;
    const u = o.userData;
    if (!o.isMesh || !u.component_id || SKIP_ASSEMBLIES.has(u.assembly_id) || u.kind === 'site_context') return;
    let c = tris.get(u.component_id);
    if (!c) {
      const confidence = historyConfidence(confidenceNote(o));
      if (!asmConf.has(u.assembly_id) || confidence === 'provisional') asmConf.set(u.assembly_id, confidence);
      tris.set(u.component_id, (c = { id: u.component_id, kind: String(u.kind), layer: String(u.layer), assembly: String(u.assembly_id), confidence, walkThrough: Boolean(u.walkNoCollision), arr: [] }));
    }
    const g = o.geometry, p = g.attributes.position, idx = g.index;
    const n = idx ? idx.count : p.count;
    for (let k = 0; k < n; k++) {
      v.fromBufferAttribute(p, idx ? idx.getX(k) : k).applyMatrix4(o.matrixWorld);
      c.arr.push(v.x, v.y, v.z);
    }
  });
  const components = [...tris.values()].map(({ arr, ...m }) => ({ ...m, tris: Float64Array.from(arr) }));
  const assemblies = manifest.assemblies
    .filter((a) => !SKIP_ASSEMBLIES.has(a.id) && asmConf.has(a.id))
    .map((a) => ({ id: a.id, name: a.name, confidence: asmConf.get(a.id), ...(parents.has(a.id)&&asmConf.has(parents.get(a.id))?{parent:parents.get(a.id)}:{}) }));
  return buildYearFile({
    year,
    generator: 'deploy/history-scenes.mjs',
    source: {
      scene: `app/history/scenes.ts createHistoricalScene(${year})`,
      kit: year === 2020 ? 'app/studio-2020/scene.ts' : 'app/history/kit.ts',
      ids: 'stable Kit component ids, docs/engineering/HISTORY_IDS.md',
      notes: scenes.historyNotes[year],
      limitations: manifest.limitations.filter((l) => !/illustrative/i.test(l) && l !== scenes.historyNotes[year]),
    },
    assemblies,
    components,
    northAzimuthOffset: YEAR_NORTH_AZIMUTH_OFFSET[year], // measured bearings only (W51); absent = the global
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const only = process.argv.slice(2).filter((a) => /^\d{4}$/.test(a)).map(Number);
  const years = only.length ? only : HISTORY_YEARS;
  const check = process.argv.includes('--check');
  const scenes = await loadScenes();
  let bad = 0;
  for (const year of years) {
    const t0 = performance.now();
    const file = extractYear(scenes, year);
    const ms = Math.round(performance.now() - t0);
    const out = path.join(ROOT, outOf(year));
    if (check) {
      const prev = JSON.parse(await readFile(out, 'utf8'));
      const same = prev.contentHash === file.contentHash;
      if (!same) bad++;
      console.log(year, same ? 'deterministic: contentHash matches' : `MISMATCH ${prev.contentHash} != ${file.contentHash}`, `${ms} ms`);
      continue;
    }
    const json = JSON.stringify(file);
    await writeFile(out, json);
    console.log(year, { bytes: (await stat(out)).size, gzip: gzipSync(json).length, obstacles: file.obstacles.length, regions: file.regions.length, stats: file.stats, bounds: file.bounds, ms, hash: file.contentHash.slice(0, 16) });
  }
  process.exit(bad ? 1 : 0);
}
