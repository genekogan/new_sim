// Narrow production conformance: only immutable office-desk revisions; no services or full suite.
import { createRequire } from 'node:module';
import { mkdtempSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { coreLibrary } from '../../packages/world-compiler/src/library.ts';
import { conformance } from '../../packages/conformance/src/conformance.ts';
const root = resolve(fileURLToPath(new URL('../..', import.meta.url))), temp = mkdtempSync(join(tmpdir(), 'reading-chair-conformance-'));
try {
  const mesh = join(root, 'apps/web/src/gen-mesh'), files = [];
  const walk = dir => { for (const name of readdirSync(dir).sort()) { const path = join(dir, name); if (statSync(path).isDirectory()) walk(path); else if (path.endsWith('.mesh.ts')) files.push(path); } }; walk(mesh);
  const source = files.map(path => `import ${JSON.stringify(path)};`).join('\n') + `\nexport { meshFor } from ${JSON.stringify(join(mesh, 'registry.ts'))};\nexport { MaterialLib } from ${JSON.stringify(join(mesh, 'materials.ts'))};`;
  const esbuild = createRequire(join(root, 'mars/viewer/package.json'))('esbuild'), output = join(temp, 'gallery.mjs');
  await esbuild.build({ stdin: { contents: source, resolveDir: root }, bundle: true, platform: 'node', format: 'esm', outfile: output, logLevel: 'error', define: { 'import.meta.env': '{}' } });
  globalThis.location = new URL('http://127.0.0.1:5366/'); globalThis.window = globalThis;
  const gallery = await import(pathToFileURL(output)), library = coreLibrary();
  const defs = library.all().filter(def => /^core-office-desk@[12]$/.test(def.ref));
  const report = await conformance({ library, defs, k: 2, seed: 'EF4', render(def, params, baked, model, scale) {
    const materials = new gallery.MaterialLib(), builder = gallery.meshFor(def); let object;
    try {
      object = builder.build({ def, params, baked, model, materials, entity: { id: 'sweep', def: def.ref, in: { parent: 'world' }, p: [0, 0], seed: 7, params }, args: def.make.args ?? {}, tint: (key, fallback) => params[key] ?? def.palette?.[key] ?? fallback });
      let tris = 0, draws = 0; const mats = new Set(); object.scale.multiplyScalar(scale); object.updateMatrixWorld(true);
      object.traverse(mesh => { if (mesh.isMesh) { tris += (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3; draws++; for (const material of [].concat(mesh.material)) mats.add(material); } const p = mesh.geometry?.attributes?.position; if (p) for (const value of p.array) if (!Number.isFinite(value)) throw Error('nonfinite gallery vertex'); });
      return { tris, draws, materials: mats.size };
    } finally { object?.traverse(mesh => mesh.geometry?.dispose()); materials.dispose(); }
  } });
  const out = process.argv[2]; if (out) writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report, findings: report.findings }));
} finally { rmSync(temp, { recursive: true, force: true }); }
