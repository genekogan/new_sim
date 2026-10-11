// humanoid@2 size params, real-input browser walk (system Chrome, real GPU, under the Chrome lease). Needs the lab:
//   node apps/web/node_modules/vite/bin/vite.js --config apps/web/src/humanoid/lab.vite.config.ts   (port 4985)
//   node apps/web/test/humanoid-sizes.browser.mjs [--out DIR]
// 1. mode=sizes: one preset at five heights, two builds, two head sizes (shot + measured crowns/shoulders).
// 2. mode=picker: drag each size slider with the real mouse (and nudge with real arrow keys), see the preview body
//    change (pixels and the look key), tick "walking" with a click and see the body stride at the chosen speed.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync, writeFileSync} from 'node:fs';
const ROOT = new URL('../../../', import.meta.url).pathname;
const base = process.env.HUMANOID_LAB ?? 'http://127.0.0.1:4985';
assert.ok([4985, 4988, 4989].includes(Number(new URL(base).port)), 'lane L10 ports only');
const outArg = process.argv.indexOf('--out'), out = outArg > 0 ? process.argv[outArg + 1] : '<team>/lanes/humanoid-shots';
mkdirSync(out, {recursive: true});
const {chromium} = createRequire(ROOT + 'mars/viewer/package.json')('@playwright/test');
const {chromeLease} = await import(ROOT + 'tools/god-skill/lib/chrome-lease.mjs');
const release = await chromeLease('L10-humanoid-sizes');
const browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist']});
const results = {}, ok = (name, v, detail) => { assert.ok(v, `${name}: ${JSON.stringify(detail)}`); results[name] = detail ?? true; console.log('ok', name, detail === undefined ? '' : JSON.stringify(detail)); };
const pixels = page => page.evaluate(() => { const c = document.querySelector('.look-picker canvas'); const g = document.createElement('canvas'); g.width = c.width; g.height = c.height; const x = g.getContext('2d'); x.drawImage(c, 0, 0); return Array.from(x.getImageData(0, 0, c.width, c.height).data); });
const diff = (a, b) => { let d = 0; for (let i = 0; i < a.length; i += 4) if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > 16) d++; return d / (a.length / 4); };
try {
  // 1. sizes row
  {
    const page = await browser.newPage({viewport: {width: 1700, height: 900}}), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${base}/src/humanoid/lab.html?mode=sizes&preset=casual&w=1700&h=760`);
    await page.waitForFunction(() => window.__lab?.ready || window.__lab?.error, null, {timeout: 600000});
    const lab = await page.evaluate(() => window.__lab); if (lab.error) throw Error(lab.error);
    await page.locator('canvas').first().screenshot({path: `${out}/sizes-row-casual.png`});
    const d = Object.fromEntries(lab.dims.map(x => [x.label, x]));
    ok('heights stand as set (shoulders = 1.34 × h / 1.75)', ['1.55 m', '1.65 m', 'today', '1.85 m', '1.95 m'].every((k, i) => Math.abs(d[k].shoulder - 1.34 * [1.55, 1.65, 1.75, 1.85, 1.95][i] / 1.75) < 0.01), lab.dims.map(x => [x.label, x.shoulder, x.crown]));
    ok('build and head size keep the height', ['build 0.85', 'build 1.2', 'head 0.85'].every(k => Math.abs(d[k].shoulder - d.today.shoulder) < 0.005), {today: d.today.shoulder});
    ok('no page errors', errors.length === 0, errors);
    writeFileSync(`${out}/sizes-row-casual.json`, JSON.stringify(lab.dims, null, 1));
    await page.close();
  }
  // 2. picker, real input
  {
    const page = await browser.newPage({viewport: {width: 900, height: 1300}}), errors = [];
    page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${base}/src/humanoid/lab.html?mode=picker&look=${encodeURIComponent(JSON.stringify({preset: 'casual'}))}`);
    await page.waitForFunction(() => window.__lab?.ready || window.__lab?.error, null, {timeout: 600000});
    const picker = page.locator('.look-picker');
    const state = () => page.evaluate(() => ({key: window.__lab.key, look: window.__lab.look, height: window.__lab.height, clipWalkSpeed: window.__lab.clipWalkSpeed}));
    const settle = async key => { await page.waitForFunction(k => window.__lab.key !== k, key, {timeout: 120000}); await page.waitForTimeout(300); };
    await picker.screenshot({path: `${out}/picker-0-casual.png`});
    let before = await state(), px = await pixels(page);
    // drag a slider with the real mouse from its thumb to a fraction of the track
    const drag = async (name, frac) => {
      const box = await page.locator(`input[name="${name}"]`).boundingBox(), s = before.look[name], f = page.locator(`input[name="${name}"]`);
      const min = Number(await f.getAttribute('min')), max = Number(await f.getAttribute('max')), y = box.y + box.height / 2, pad = 8;
      const x0 = box.x + pad + (box.width - 2 * pad) * (s - min) / (max - min), x1 = box.x + pad + (box.width - 2 * pad) * frac;
      await page.mouse.move(x0, y); await page.mouse.down(); await page.mouse.move((x0 + x1) / 2, y, {steps: 4}); await page.mouse.move(x1, y, {steps: 6}); await page.mouse.up();
    };
    for (const [name, frac, check] of [
      ['height', 1, l => l.height >= 1.9], ['build', 1, l => l.build >= 1.15], ['headSize', 1, l => l.headSize >= 1.15], ['walkSpeed', 0, l => l.walkSpeed <= 0.95],
    ]) {
      await drag(name, frac); await settle(before.key);
      const now = await state(), npx = await pixels(page), changed = diff(px, npx);
      await picker.screenshot({path: `${out}/picker-${name}.png`});
      ok(`dragging ${name} changes the look`, check(now.look) && now.key !== before.key, {[name]: now.look[name], preset: now.look.preset});
      if (name !== 'walkSpeed') ok(`the preview body changes with ${name}`, changed > 0.002, {pixelsChanged: +(100 * changed).toFixed(2) + ' %'});
      else ok('walking speed alone leaves the standing body as it was', changed < 0.002, {pixelsChanged: +(100 * changed).toFixed(3) + ' %'});
      before = now; px = npx;
    }
    ok('a classic preset keeps its look when only sizes change', before.look.preset === 'casual', before.look.preset);
    ok('the composed template is 1.95 m tall', Math.abs(before.height - 1.95) < 0.011, before.height);
    // real keys on the height slider: two steps down
    await page.locator('input[name="height"]').focus(); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); await settle(before.key);
    const keyed = await state(); ok('arrow keys step the height', Math.abs(keyed.look.height - (before.look.height - 0.02)) < 0.001, keyed.look.height); before = keyed;
    // walking preview at 0.9 m/s: the body strides (frames differ over time)
    await page.locator('label', {hasText: 'walking'}).locator('input[type=checkbox]').click();
    await page.waitForTimeout(400); const w1 = await pixels(page); await picker.screenshot({path: `${out}/picker-walking-a.png`});
    await page.waitForTimeout(450); const w2 = await pixels(page); await picker.screenshot({path: `${out}/picker-walking-b.png`});
    ok('the walking preview strides', diff(w1, w2) > 0.002, {pixelsChanged: +(100 * diff(w1, w2)).toFixed(2) + ' %', clipWalkSpeed: before.clipWalkSpeed});
    ok('no page errors', errors.length === 0, errors);
    results.finalLook = before.look;
    await page.close();
  }
} finally { await browser.close(); release(); writeFileSync(`${out}/sizes-browser-results.json`, JSON.stringify(results, null, 1)); }
