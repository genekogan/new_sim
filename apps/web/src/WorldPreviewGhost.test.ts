import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';

async function ghostModule() {
  const index = new URL('./gen-mesh/index.ts', import.meta.url).href;
  const hooks = registerHooks({ load(url, context, next) { return url === index ? { format: 'module', shortCircuit: true, source: "export { meshFor } from './registry.ts';" } : next(url, context); } });
  try { return await import('./WorldPreviewGhost.ts'); } finally { hooks.deregister(); }
}
const ghostClass = async () => (await ghostModule()).WorldPreviewGhost;

test('preview ghost sends a scoped view key or panel god token to the private preview GET', async t => {
  const Ghost = await ghostClass(), originalFetch = globalThis.fetch;
  const originalCancel = globalThis.cancelAnimationFrame;
  globalThis.cancelAnimationFrame = () => {};
  t.after(() => { globalThis.fetch = originalFetch; globalThis.cancelAnimationFrame = originalCancel; });
  const ghost = new Ghost(p => '/worlds/w/fixture' + p), calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => { calls.push({ url, init }); return Response.json({ failures: [{ code: 'test', detail: 'refused batch has no meshes' }] }); }) as typeof fetch;
  await ghost.show('pv_one', { viewKey: 'short-lived-view-key' });
  assert.equal(calls[0].url, '/worlds/w/fixture/v1/god/preview/pv_one'); assert.deepEqual(calls[0].init?.headers, { 'x-preview-key': 'short-lived-view-key' }); assert.equal(calls[0].init?.cache, 'no-store');
  await ghost.show('pv_two', { token: 'world-god-token' }); assert.deepEqual(calls[1].init?.headers, { authorization: 'Bearer world-god-token' });
  await ghost.show('pv_three'); assert.deepEqual(calls[2].init?.headers, {}, 'credentials never retained between previews');
  ghost.dispose();
});

test('a 401 tells the visitor how to see the preview instead of a bare status', async t => {
  const Ghost = await ghostClass(), originalFetch = globalThis.fetch, originalCancel = globalThis.cancelAnimationFrame;
  globalThis.cancelAnimationFrame = () => {};
  t.after(() => { globalThis.fetch = originalFetch; globalThis.cancelAnimationFrame = originalCancel; });
  globalThis.fetch = (async () => Response.json({ code: 'unauthorized' }, { status: 401 })) as typeof fetch;
  const ghost = new Ghost(p => p), shown = await ghost.show('pv_private');
  assert.equal(shown.ok, false); assert.match(shown.message ?? '', /full link your agent printed.*view key.*sign in as this world's god/);
  ghost.dispose();
});

test('the CLI link fragment yields the view key, and the panel captures it before Shell rewrites the hash', async () => {
  const { previewKeyFrom } = await ghostModule(), key = 'A'.repeat(42) + '_';
  assert.equal(previewKeyFrom(`#previewKey=${key}`), key);
  assert.equal(previewKeyFrom(`previewKey=${key}&other=1`), key);
  for (const hash of ['', '#watch', '#previewKey=', '#previewKey=short', `#previewKey=${'x'.repeat(129)}`, '#previewKey=has%20space-and-more-chars']) assert.equal(previewKeyFrom(hash), null, hash);
  const panel = readFileSync(new URL('./GodPanel.tsx', import.meta.url), 'utf8');
  const capture = panel.indexOf('const landingPreviewKey = '), component = panel.indexOf('export function GodPanel(');
  assert.ok(capture > 0 && capture < component, 'the key is read at module load, before any effect runs');
  assert.ok(panel.includes("query.get('preview') === id ? landingPreviewKey : null"), 'only the landing preview gets the landing key');
  const show = panel.slice(panel.indexOf('const showPreview = useCallback('), panel.indexOf('const hideGhost'));
  assert.ok(show.includes('G.storedToken()') && !show.includes('ensureToken'), 'opening a preview link never mints (minting claims an unowned world)');
});

test('taking the landing view key strips it from the URL with replaceState and keeps the rest', async () => {
  const { takePreviewKey } = await ghostModule(), key = 'k'.repeat(43);
  const port = (hash: string) => {
    const replaced: string[] = [];
    return { replaced, location: { pathname: '/w/eden', search: '?preview=pv_one', hash }, history: { replaceState: (_s: unknown, _t: string, url?: string | URL | null) => { replaced.push(String(url)); } } };
  };
  const only = port(`#previewKey=${key}`);
  assert.equal(takePreviewKey(only), key); assert.deepEqual(only.replaced, ['/w/eden?preview=pv_one#watch']);
  const mixed = port(`#other=1&previewKey=${key}&x`);
  assert.equal(takePreviewKey(mixed), key); assert.deepEqual(mixed.replaced, ['/w/eden?preview=pv_one#other=1&x']);
  const bad = port('#previewKey=short');
  assert.equal(takePreviewKey(bad), null); assert.deepEqual(bad.replaced, ['/w/eden?preview=pv_one#watch'], 'a malformed key is dropped too');
  for (const hash of ['', '#watch', '#soul/s_one']) { const p = port(hash); assert.equal(takePreviewKey(p), null); assert.deepEqual(p.replaced, [], hash); }
  const panel = readFileSync(new URL('./GodPanel.tsx', import.meta.url), 'utf8');
  assert.ok(panel.includes('const landingPreviewKey = typeof location === \'undefined\' ? null : takePreviewKey({ location, history });'), 'the panel strips the key as it captures it');
});
