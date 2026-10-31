import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const base = process.env.SITE_BASE || 'http://127.0.0.1:8799';
const observations = [];
for (const path of [
  '/',
  '/?year=2020',
  '/photo',
  '/photo/',
  '/studio',
  '/studio/',
  '/studio/2020',
  '/studio/2020/',
  ...[2021,2022,2023,2024,2025,2026].flatMap(y => [`/studio/${y}`, `/studio/${y}/`]),
  '/simulation-guide',
  '/simulation-guide/',
]) {
  const r = await fetch(base + path, { redirect: 'manual' }),
    html = await r.text();
  assert.equal(r.status, 200, path);
  assert.match(html, /<div id="root"><\/div>/);
  assert.equal(r.headers.get('cache-control'), 'no-cache');
  observations.push({ path, status: r.status });
  for (const match of html.matchAll(/(?:src|href)="(\/assets\/[^" ]+)"/g)) {
    const a = await fetch(base + match[1], { method: 'HEAD' });
    assert.equal(a.status, 200, match[1]);
  }
}
assert.equal((await fetch(base + '/not-a-campus-route')).status, 404);
assert.equal((await fetch(base + '/api/simulation/state')).status, 401);
assert.equal((await fetch(base + '/studio', { method: 'POST' })).status, 405);
const release = JSON.parse(await readFile('.cloudflare/release.json', 'utf8'));
const assets =
  process.env.ALL_ASSETS === '1'
    ? release
    : release.filter((a) => a.path === '/modular/campus-components.glb');
for (let i = 0; i < assets.length; i += 8)
  await Promise.all(
    assets.slice(i, i + 8).map(async (a) => {
      const r = await fetch(base + a.path, { method: 'HEAD' });
      assert.equal(r.status, 200, a.path);
      const length = r.headers.get('content-length');
      if (
        !r.headers.get('content-encoding') &&
        (a.storage === 'r2' || length !== null)
      )
        assert.equal(Number(length), a.bytes, a.path);
    }),
  );
const path = '/modular/campus-components.glb',
  r = await fetch(base + path, { headers: { Range: 'bytes=0-11' } });
assert.equal(r.status, 206);
const header = new DataView(await r.arrayBuffer());
assert.equal(header.getUint32(0, true), 0x46546c67);
assert.equal(header.getUint32(4, true), 2);
const result = {
  base,
  checkedAt: new Date().toISOString(),
  routes: observations,
  assetsChecked: assets.length,
  range: 'GLB header verified',
  auth: 'anonymous state denied',
};
await writeFile(
  '.cloudflare/audit/http-smoke.json',
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result));
