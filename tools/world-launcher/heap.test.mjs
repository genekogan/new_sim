// node --test tools/world-launcher/heap.test.mjs — lane L1 (server reliability): the heap cap is per world (LOAD-CONTRACT §4).
// Fake worlds on lane L1's ports only: proxy :5110, children 5101–5103.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLauncher } from './launcher.mjs';
import { worldHeapMb, DEFAULT_WORLD_HEAP_MB, BIG_WORLD_HEAP_MB } from './registry.mjs';

const fake = new URL('./fake-world.mjs', import.meta.url).pathname;
const command = (w, port) => ({ cmd: process.execPath, args: [fake], env: { ...process.env, WORLD_KEY: w.slug, PORT: String(port) } });

test('worldHeapMb: the registry entry wins, the launcher flag is a default, Eden-2026-class worlds get 2048', () => {
  assert.equal(DEFAULT_WORLD_HEAP_MB, 1536); assert.equal(BIG_WORLD_HEAP_MB, 2048);
  assert.equal(worldHeapMb({ slug: 'a' }), 1536);
  assert.equal(worldHeapMb({ slug: 'a' }, 1024), 1024);
  assert.equal(worldHeapMb({ slug: 'a', worldHeapMb: 3072 }, 1024), 3072);
  assert.equal(worldHeapMb({ slug: 'a', template: 'eden-2026' }), 2048);
  assert.equal(worldHeapMb({ slug: 'a', entities: 5030 }, 1024), 2048);
  assert.equal(worldHeapMb({ slug: 'a', entities: 5030 }, 2560), 2560);
  assert.equal(worldHeapMb({ slug: 'a', worldHeapMb: 12 }), 1536);   // nonsense is ignored
});

test('install.sh writes 1536 as the default and never the old 768 cap', () => {
  const sh = readFileSync(new URL('./deploy/install.sh', import.meta.url), 'utf8');
  assert.doesNotMatch(sh, /768/);
  assert.equal((sh.match(/--world-heap-mb 1536/g) ?? []).length, 2);
});

test('each world boots with its own heap flag; set-heap changes it from the next boot', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'l1-heap-'));
  const templatesDir = join(dir, 'templates'); mkdirSync(templatesDir);
  writeFileSync(join(templatesDir, 'eden-2026.json'), JSON.stringify({ schema: 'genesis/1', name: 'Eden 2026', batches: [] }));
  const webDir = join(dir, 'web'); mkdirSync(webDir); writeFileSync(join(webDir, 'index.html'), '<!doctype html>');
  const P = 5110, base = `http://127.0.0.1:${P}`;
  const L = await openLauncher({ port: P, range: [5101, 5103], dataDir: join(dir, 'data'), webDir, templatesDir, command, eager: 0, log: () => {}, prewarm: false });
  const make = (name, template) => fetch(`${base}/__sim/worlds`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, template }) }).then((r) => r.json());
  const argv = (slug) => fetch(`${base}/w/${slug}/argv`).then((r) => r.json());
  const op = (body) => fetch(`${base}/__sim/op/set-heap`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const plain = await make('Plain'), big = await make('Big', 'eden-2026');
    assert.deepEqual(await argv(plain.slug), { execArgv: ['--max-old-space-size=1536'], heapMb: '1536' });
    assert.deepEqual(await argv(big.slug), { execArgv: ['--max-old-space-size=2048'], heapMb: '2048' });
    assert.equal((await op({ slug: plain.slug, worldHeapMb: 99 })).status, 400);
    const r = await op({ slug: plain.slug, worldHeapMb: 2560 }); assert.equal(r.status, 200); assert.equal((await r.json()).heapMb, 2560);
    const kids = await fetch(`${base}/__sim/launcher`).then((x) => x.json());
    assert.equal(kids.children.find((c) => c.slug === plain.slug).heapMb, 2560);
    await L.pool.stop(plain.slug);
    assert.deepEqual(await argv(plain.slug), { execArgv: ['--max-old-space-size=2560'], heapMb: '2560' });
    assert.equal((await op({ slug: plain.slug, worldHeapMb: null })).status, 200);
    assert.equal(JSON.parse(readFileSync(join(dir, 'data', 'worlds.json'), 'utf8')).worlds.find((w) => w.slug === plain.slug).worldHeapMb, undefined);
  } finally { await L.close(); }
});
