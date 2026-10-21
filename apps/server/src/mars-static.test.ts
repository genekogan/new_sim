import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { mountMarsStatic } from './mars-static.ts';

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
