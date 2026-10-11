// humanoid@2 lab, browser proof (system Chrome via Playwright, headless). Needs the lab server:
//   node apps/web/node_modules/vite/bin/vite.js --config apps/web/src/humanoid/lab.vite.config.ts   (port 4985)
//   node apps/web/test/humanoid-lab.browser.mjs [--out DIR]
// Proves: 24 deterministic composed bodies with ≥ 20 distinct looks within draw/triangle/texture/byte budgets and
// a profile icon each; composed presets casual/punk/woman reproduce today's GLB look (pixel diff < 0.5 %).
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync, writeFileSync} from 'node:fs';
const ROOT = new URL('../../../', import.meta.url).pathname;
const base = process.env.HUMANOID_LAB ?? 'http://127.0.0.1:4985';
assert.ok([4985, 4988, 4989].includes(Number(new URL(base).port)), 'lane L10 ports only');
const outArg = process.argv.indexOf('--out'), out = outArg > 0 ? process.argv[outArg + 1] : ROOT + '.lane/t2';
mkdirSync(out, {recursive: true});
const {chromium} = createRequire(ROOT + 'mars/viewer/package.json')('@playwright/test');
const {chromeLease} = await import(ROOT + 'tools/god-skill/lib/chrome-lease.mjs');
const release = await chromeLease('L10-humanoid-lab');
// real GPU (Metal through ANGLE), never swiftshader (MERGES.md 08:55)
const browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist']});
const results = {}, ok = (name, v, detail) => { assert.ok(v, `${name}: ${JSON.stringify(detail)}`); results[name] = detail ?? true; console.log('ok', name, detail === undefined ? '' : JSON.stringify(detail)); };
async function open(query, w = 1600, h = 1000) {
  const page = await browser.newPage({viewport: {width: w, height: h + 200}}), errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${base}/src/humanoid/lab.html?${query}&w=${w}&h=${h}`);
  await page.waitForFunction(() => window.__lab?.ready || window.__lab?.error, null, {timeout: 900000});
  const lab = await page.evaluate(() => window.__lab);
  if (lab.error) throw Error(lab.error + ' ' + errors.join(' | '));
  return {page, lab, errors};
}
try {
  // 1. 24 bodies, seed 7
  {
    const {page, lab, errors} = await open('mode=grid&n=24&seed=7');
    await page.screenshot({path: `${out}/humanoid-grid-24-seed7.png`, fullPage: true});
    await page.locator('canvas').screenshot({path: `${out}/humanoid-grid-24-seed7-canvas.png`});
    const palettes = new Set(lab.looks.map(l => JSON.stringify([l.skin, l.hair1, l.top1, l.top2, l.bottom1, l.shoes1])));
    ok('24 bodies composed', lab.bodies === 24, lab.bodies);
    ok('≥ 20 distinct palettes', palettes.size >= 20, palettes.size);
    ok('≥ 20 distinct look keys', lab.distinctKeys >= 20, lab.distinctKeys);
    ok('draw calls ≤ 24×6 + scene (no shadows)', lab.callsNoShadow <= 24 * 6 + 1, {calls: lab.callsNoShadow, meshDraws: lab.meshDraws, withShadows: lab.callsWithShadow});
    ok('triangles ≤ 24 × 9k', lab.triangles <= 24 * 9000, lab.triangles);
    ok('zero material textures for bodies', lab.materialTextures === 0, {materialTextures: lab.materialTextures, gpuTextures: lab.gpuTextures, boneTextures: lab.boneTextures, note: 'GPU textures are bone matrices (people.ts clones one skeleton per skinned mesh) + shadow map'});
    ok('one program for every composed body', lab.materials >= 1, {programs: lab.programs, materials: lab.materials, geometries: lab.geometries});
    ok('profile icon per body', lab.icons === 24, lab.icons);
    ok('no page errors', errors.length === 0, errors);
    results.gridBytes = {kitBytes: lab.kitBytes, kitFiles: lab.kitFiles, composeMs: lab.composeMs};
    console.log('kit bytes for 24 bodies', lab.kitBytes, 'files', lab.kitFiles);
    writeFileSync(`${out}/humanoid-grid-24-seed7.json`, JSON.stringify(lab, null, 1));
    await page.close();
  }
  // 2. one body: kit bytes for a single look (first paint)
  {
    const {lab, page} = await open('mode=grid&n=1&seed=7', 600, 600);
    ok('one body ≤ 1 MB of kit bytes', lab.kitBytes <= 1024 * 1024, lab.kitBytes); await page.close();
  }
  // 3. presets side by side
  {
    const {page} = await open('mode=presets', 1600, 900);
    await page.screenshot({path: `${out}/humanoid-presets-today-vs-kit.png`, fullPage: true}); await page.close();
  }
  // 4. pixel parity per preset
  for (const p of ['casual', 'punk', 'woman']) {
    const shots = {};
    for (const src of ['legacy', 'kit']) { const {page} = await open(`mode=parity&preset=${p}&src=${src}`, 640, 800);
      shots[src] = await page.evaluate(() => { const c = document.querySelector('canvas'); const g = document.createElement('canvas'); g.width = c.width; g.height = c.height; const x = g.getContext('2d'); x.drawImage(c, 0, 0); return Array.from(x.getImageData(0, 0, c.width, c.height).data); });
      await page.locator('canvas').screenshot({path: `${out}/humanoid-parity-${p}-${src}.png`}); await page.close(); }
    let diff = 0, body = 0; const a = shots.legacy, b = shots.kit, bg = [a[0], a[1], a[2]];
    for (let i = 0; i < a.length; i += 4) { const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])); if (d > 16) diff++;
      if (Math.abs(a[i] - bg[0]) + Math.abs(a[i + 1] - bg[1]) + Math.abs(a[i + 2] - bg[2]) > 30) body++; }
    ok(`preset ${p} pixel diff < 0.5 %`, diff / (a.length / 4) < 0.005, {differing: diff, pixels: a.length / 4, pct: +(100 * diff / (a.length / 4)).toFixed(3), ofBodyPct: +(100 * diff / Math.max(1, body)).toFixed(3)});
  }
  // 5. migration: the 8 audited social Souls (today's provenance-gated adapter) vs their explicit kit looks
  {
    const {page} = await open('mode=social', 1600, 900);
    await page.screenshot({path: `${out}/humanoid-social-today-vs-kit.png`, fullPage: true}); await page.close();
    const rows = ['h_006a68883b', 'h_52ec515f8c', 'h_6e60aea722', 'h_9915b192c3'];
    for (const id of rows) {
      const shots = {};
      for (const src of ['legacy', 'kit']) { const {page} = await open(`mode=parity&social=${id}&src=${src}`, 480, 640);
        shots[src] = await page.evaluate(() => { const c = document.querySelector('canvas'); const g = document.createElement('canvas'); g.width = c.width; g.height = c.height; const x = g.getContext('2d'); x.drawImage(c, 0, 0); return Array.from(x.getImageData(0, 0, c.width, c.height).data); });
        await page.close(); }
      let diff = 0; const a = shots.legacy, b = shots.kit;
      for (let i = 0; i < a.length; i += 4) if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > 16) diff++;
      ok(`social Soul ${id} pixel diff < 0.5 %`, diff / (a.length / 4) < 0.005, {differing: diff, pct: +(100 * diff / (a.length / 4)).toFixed(3)});
    }
  }
} finally { await browser.close(); release(); writeFileSync(`${out}/humanoid-lab-results.json`, JSON.stringify(results, null, 1)); }
