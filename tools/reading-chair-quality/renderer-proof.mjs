// One root-granted renderer slot, explicit loopback fixture only. Owns and closes its browser/context.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const require = createRequire(new URL('../../mars/viewer/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const out = resolve(process.argv[2]), base = process.argv[3] ?? 'http://127.0.0.1:7846';
assert.equal(new URL(base).origin, 'http://127.0.0.1:7846', 'only owned isolated fixture port');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
try {
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 1 });
  try {
    const page = await context.newPage(), errors = [], report = { schema: 'reading-chair-renderer/1', cases: [], errors, limitation: 'Actual production renderer and assets, scripted frame geometry only. Independent native action/live acceptance required.' };
    page.on('pageerror', error => errors.push(String(error))); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    for (const [name, query] of [['reading-before', '?baseline&rig=woman'], ['reading-after', '?rig=woman'], ['ground-before', '?baseline&ground&rig=woman'], ['ground-after', '?ground&rig=woman'], ['computer-before', '?baseline&computer&rig=woman'], ['computer-after', '?computer&rig=woman']]) {
      await page.goto(base + '/tools/reading-chair-quality/renderer-fixture.html' + query, { waitUntil: 'networkidle', timeout: 20000 });
      await page.waitForFunction(() => window.readingChairFixture?.ready === true, null, { timeout: 20000 });
      const stats = await page.evaluate(() => {
        const f = window.readingChairFixture, holder = f.views.group.children[0], prop = holder.getObjectByName('activity prop: book');
        const meshes = []; f.scene.traverse(mesh => { if (mesh.isMesh) meshes.push({ name: mesh.name, triangles: (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3 }); });
        return { baseline: f.baseline, computer: f.computer, groundSeat: f.groundSeat, rig: f.rigName, bookVisible: prop?.visible ?? false, meshes: meshes.length, triangles: meshes.reduce((sum, mesh) => sum + mesh.triangles, 0), drawCalls: f.renderer.info.render.calls };
      });
      assert.equal(stats.rig, 'woman'); assert.equal(stats.bookVisible, !stats.computer);
      await page.screenshot({ path: resolve(out, name + '.png') });
      writeFileSync(resolve(out, name + '.yml'), await page.locator('body').ariaSnapshot());
      report.cases.push({ name, query, stats, screenshotSha256: createHash('sha256').update(readFileSync(resolve(out, name + '.png'))).digest('hex') });
      writeFileSync(resolve(out, 'summary.json'), JSON.stringify(report, null, 2));
    }
    assert.deepEqual(errors, [], 'browser console and page errors');
    console.log(JSON.stringify({ cases: report.cases.length, errors: errors.length, out }));
  } finally { await context.close(); }
} finally { await browser.close(); }
