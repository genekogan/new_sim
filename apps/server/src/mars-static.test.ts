import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { MARS_STATIC_CACHE, mountMarsStatic } from './mars-static.ts';

// lane QA: sim.eden.art/l/mars (linked from the home page) was a 500 "res.body.getReader is not a function" because the
// legacy forks' mars-web has no lab index.html.
await test('lab pages: served from the root when its index.html exists, a plain 404 page when it does not', async () => {
  const withLab = mkdtempSync(join(tmpdir(), 'qa-lab-')), without = mkdtempSync(join(tmpdir(), 'qa-nolab-'));
  writeFileSync(join(withLab, 'index.html'), '<html>lab</html>');
  for (const [root, status] of [[withLab, 200], [without, 404]] as const) {
    const app = new Hono(); app.use('*', async (c, next) => { await next(); c.header('X-Robots-Tag', 'noindex'); });
    mountMarsStatic(app, root);
    for (const path of ['/l/mars', '/l/eden/', '/w/mars/2026']) {
      const r = await app.request(path);
      assert.equal(r.status, status, `${root} ${path}`);
      assert.match(await r.text(), status === 200 ? /lab/ : /not here any more/);
    }
    assert.equal((await app.request('/w/mars/1999')).status, 404);
  }
});

// lane CACHE: /mars-assets (Draco decoder) answered without Cache-Control, so Cloudflare served it DYNAMIC from the origin.
await test('/mars-assets files carry the published-file cache policy; a missing file stays uncached', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cache-ma-'));
  mkdirSync(join(root, 'draco'));
  writeFileSync(join(root, 'draco', 'draco_wasm_wrapper.js'), '// wrapper');
  const app = new Hono(); mountMarsStatic(app, root);
  const hit = await app.request('/mars-assets/draco/draco_wasm_wrapper.js');
  assert.equal(hit.status, 200);
  assert.equal(hit.headers.get('cache-control'), MARS_STATIC_CACHE);
  const miss = await app.request('/mars-assets/draco/nope.wasm');
  assert.equal(miss.status, 404);
  assert.notEqual(miss.headers.get('cache-control'), MARS_STATIC_CACHE);
});
