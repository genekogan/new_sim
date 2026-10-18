// Lane L3h: the entry prefetch (index.html's inline head script) sends exactly the GET WorldEntityLayer.start used to
// send, once, and start takes it instead of fetching again.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { registerHooks } from 'node:module';
import { entryPrefetchScript, OLD_WORLD_KEYS, PREFETCH_GLOBAL, takeSnapshotPrefetch, worldKeyFrom } from './snapshot-prefetch.ts';

// world-path.ts's key before this lane (inline in that file): the shared worldKeyFrom must give the same key
const keyBefore = (pathname: string, base: string) => (base && pathname.startsWith(base + '/') ? pathname.slice(base.length) : pathname).match(/^\/w\/([a-z][a-z0-9-]{0,31})(?:\/|$)/)?.[1] ?? 'toy';
const PATHS = ['/', '/w/eden-2026', '/w/eden-2026/', '/w/eden-2026/#god', '/w/mars-two/x', '/w/eden', '/w/mars/', '/w/littlemartians', '/w/toy',
  '/w/Eden-2026', '/w/2026', '/w/a', '/w/' + 'a'.repeat(32), '/w/' + 'a'.repeat(33), '/worlds/w/eden-2026', '/worlds/w/mars', '/worlds/', '/worldsx/w/x-1', '/w/x_y'];

/** Run the inline script as the browser would (classic script, global window), with a recording fetch. */
function runEntry(base: string, pathname: string) {
  const calls: unknown[][] = [];
  const ctx: Record<string, unknown> = { location: { pathname }, fetch: (...a: unknown[]) => { calls.push(a); return Promise.resolve(new Response('{}')); } };
  ctx.window = ctx;
  vm.runInNewContext(entryPrefetchScript(base), ctx);
  return { calls, left: ctx[PREFETCH_GLOBAL] as { url: string; response: Promise<Response> } | undefined };
}

test('entry script: one plain GET of this new world\'s snapshot URL (the layer\'s exact URL), none on old worlds', () => {
  for (const base of ['', '/worlds']) for (const pathname of PATHS) {
    const key = worldKeyFrom(pathname, base), apiUrl = `${base}/w/${key}/v1/world/snapshot`;  // = world-path apiPath('/v1/world/snapshot')
    assert.equal(key, keyBefore(pathname, base), `${base} ${pathname}: same world key as before`);
    const { calls, left } = runEntry(base, pathname);
    if (OLD_WORLD_KEYS.includes(key)) { assert.equal(calls.length, 0, `${base} ${pathname}: old world, no prefetch`); assert.equal(left, undefined); continue; }
    assert.deepEqual(calls, [[apiUrl]], `${base} ${pathname}: exactly one GET, no init (fetch defaults = the layer's request)`);
    assert.equal(left?.url, apiUrl);
  }
});

test('entry script: a failed prefetch leaves no unhandled rejection and still hands the failure to its taker', async () => {
  const ctx: Record<string, unknown> = { location: { pathname: '/w/eden-2026' }, fetch: () => Promise.reject(new TypeError('offline')) };
  ctx.window = ctx;
  let unhandled = 0; const on = () => { unhandled++; }; process.on('unhandledRejection', on);
  try {
    vm.runInNewContext(entryPrefetchScript(''), ctx);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(unhandled, 0);
    await assert.rejects((ctx[PREFETCH_GLOBAL] as { response: Promise<Response> }).response, /offline/);  // start's try/catch returns, as a failed fetch did
  } finally { process.off('unhandledRejection', on); }
});

test('takeSnapshotPrefetch: the matching URL once; a mismatch or a second take gets null', () => {
  const g = globalThis as Record<string, unknown>; const hadWindow = 'window' in g; g.window ??= g;
  try {
    const response = Promise.resolve(new Response('{}'));
    g[PREFETCH_GLOBAL] = { url: '/w/a/v1/world/snapshot', response };
    assert.equal(takeSnapshotPrefetch('/w/a/v1/world/snapshot'), response);
    assert.equal(takeSnapshotPrefetch('/w/a/v1/world/snapshot'), null);
    g[PREFETCH_GLOBAL] = { url: '/w/a/v1/world/snapshot', response };
    assert.equal(takeSnapshotPrefetch('/w/b/v1/world/snapshot'), null);
    assert.equal(g[PREFETCH_GLOBAL], undefined);
  } finally { delete g[PREFETCH_GLOBAL]; if (!hadWindow) delete g.window; }
});

test('WorldEntityLayer.start takes the entry response (no second request); a later start fetches afresh', async () => {
  const g = globalThis as Record<string, unknown>; const hadWindow = 'window' in g, realFetch = globalThis.fetch;
  (g as { location?: unknown }).location ??= new URL('http://offline.invalid/w/fixture');
  g.window ??= g;
  const index = new URL('./gen-mesh/index.ts', import.meta.url).href;
  const hooks = registerHooks({ load(url, context, next) { return url === index ? { format: 'module', shortCircuit: true, source: "export { meshFor } from './registry.ts';" } : next(url, context); } });
  const { WorldEntityLayer } = await import('./WorldEntityLayer.ts').finally(() => hooks.deregister());
  const fetched: string[] = [];
  globalThis.fetch = (async (u: string) => { fetched.push(String(u)); return Response.json({ contract: 'not-world' }); }) as typeof fetch;
  try {
    const layer = new WorldEntityLayer((p) => '/w/fixture' + p), entry = new Response(JSON.stringify({ contract: 'not-world' }));
    g[PREFETCH_GLOBAL] = { url: '/w/fixture/v1/world/snapshot', response: Promise.resolve(entry) };
    await layer.start(new AbortController().signal);
    assert.deepEqual(fetched, [], 'start sent no request of its own');
    assert.equal(entry.bodyUsed, true, 'start read the entry response');
    await layer.start(new AbortController().signal);
    assert.deepEqual(fetched, ['/w/fixture/v1/world/snapshot'], 'a re-mount (new epoch) takes a fresh snapshot, as before');
  } finally { globalThis.fetch = realFetch; delete g[PREFETCH_GLOBAL]; if (!hadWindow) delete g.window; }
});
