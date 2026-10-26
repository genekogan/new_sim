import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { kitFiles, planOverlay, scanEnvironment, buildOverlay, DEFAULT_ENVIRONMENT } from './assets-overlay.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const tmp = () => mkdtempSync(join(tmpdir(), 'pt-overlay-'));

test('kitFiles: every relative .glb the kit names, no absolute or parent paths', () => {
  const kit = { rig: { fem: 'rig-fem.glb' }, parts: [{ file: 'parts/a.fem.glb' }, { file: 'parts/a.fem.glb' }, { f: '../x.glb' }, { f: '/abs.glb' }, { f: 'notes.txt' }] };
  assert.deepEqual(kitFiles(kit), ['parts/a.fem.glb', 'rig-fem.glb']);
});

test('plan: manifests, Draco names and sha256 from static-manifest, campus sha, kit parts, environment scan', () => {
  const d = tmp();
  writeFileSync(join(d, 'static-manifest.json'), JSON.stringify({ files: [{ name: 'draco_decoder.wasm', sha256: 'abc' }, { name: '../evil' }] }));
  writeFileSync(join(d, 'campus-manifest.json'), JSON.stringify({ sha256: 'def' }));
  mkdirSync(join(d, 'modular/humanoid'), { recursive: true }); writeFileSync(join(d, 'modular/humanoid/kit.json'), JSON.stringify({ parts: ['parts/b.glb'] }));
  const root = tmp(); mkdirSync(join(root, 'apps/web/src'), { recursive: true });
  writeFileSync(join(root, 'apps/web/src/a.ts'), "const u = '/modular/environment/new-thing.glb';");
  writeFileSync(join(root, 'apps/web/src/a.test.ts'), "const u = '/modular/environment/x.glb';");
  assert.deepEqual(scanEnvironment(root), ['new-thing.glb']);
  const p = planOverlay(d, { origin: 'https://o.example/', serverRoot: root });
  const by = Object.fromEntries(p.map((x) => [x.rel, x]));
  assert.equal(by['static-manifest.json'].url, 'https://o.example/mars-assets/static-manifest.json');
  assert.deepEqual([by['draco/draco_decoder.wasm'].url, by['draco/draco_decoder.wasm'].sha256], ['https://o.example/mars-assets/draco/draco_decoder.wasm', 'abc']);
  assert.ok(!p.some((x) => x.rel.includes('evil')));
  assert.equal(by['browser/campus.glb'].sha256, 'def');
  assert.equal(by['modular/humanoid/parts/b.glb'].url, 'https://o.example/modular/humanoid/parts/b.glb');
  assert.equal(by['modular/environment/new-thing.glb'].required, false);
  for (const n of DEFAULT_ENVIRONMENT) assert.equal(by[`modular/environment/${n}`].required, true);
  assert.deepEqual(planOverlay(d, { only: ['manifests'] }).map((x) => x.rel), ['static-manifest.json', 'campus-manifest.json']);
});

test('build: fetch, resume, sha256 check, html fallback counts as missing, manifest written', async () => {
  const d = tmp();
  const body = { 'static-manifest.json': JSON.stringify({ files: [{ name: 'dec.wasm', sha256: sha('WASM') }] }), 'campus-manifest.json': JSON.stringify({ sha256: sha('CAMPUS') }), 'draco/dec.wasm': 'WASM', 'browser/campus.glb': 'CAMPUS' };
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1; const rel = url.replace(/^https:\/\/o\/(mars-assets\/)?/, '');
    if (rel === 'modular/humanoid/kit.json') return new Response('<!doctype html><p>app</p>', { headers: { 'content-type': 'text/html' } });
    if (body[rel] == null) return new Response('nope', { status: 404 });
    return new Response(body[rel], { headers: { 'content-type': 'application/octet-stream' } });
  };
  const r = await buildOverlay(d, { origin: 'https://o', only: ['manifests', 'draco', 'browser', 'kit'], fetchImpl });
  assert.equal(readFileSync(join(d, 'draco/dec.wasm'), 'utf8'), 'WASM');
  assert.equal(r.ok, false); assert.deepEqual(r.missing.map((m) => [m.rel, m.status]), [['modular/humanoid/kit.json', 'html fallback']]);
  const man = JSON.parse(readFileSync(join(d, 'overlay-manifest.json'), 'utf8'));
  assert.equal(man.files.find((f) => f.rel === 'browser/campus.glb').sha256, sha('CAMPUS'));
  const before = calls;
  const r2 = await buildOverlay(d, { origin: 'https://o', only: ['manifests', 'draco', 'browser'], fetchImpl });
  assert.equal(r2.ok, true); assert.equal(calls, before, 'resume fetches nothing already present');
  // a wrong published sha256 is refused and leaves no file
  body['draco/dec.wasm'] = 'TAMPERED'; writeFileSync(join(d, 'draco/dec.wasm'), 'TAMPERED');
  const r3 = await buildOverlay(d, { origin: 'https://o', only: ['draco'], fetchImpl });
  assert.equal(r3.ok, false); assert.ok(!existsSync(join(d, 'draco/dec.wasm'))); assert.match(r3.missing[0].status, /sha256/);
});
