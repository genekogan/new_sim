// Lane B1 (2026-10-19): a body or body part whose request fails once is asked for again (2, 5, 10 s backoff) instead of
// leaving that Soul a stand-in figure for good. Seen live on 3.28: one kit part (top-casual-hoodie.fem.glb) failed with a
// network error and the Soul never got its body. Covered here: the kit's parts (core/humanoid@2 looks), the built-in
// characters (mesh + clips files, with their fallback to the old single-file GLB) and uploaded owner bodies; a 404 is not
// retried, and a permanent failure ends in the stand-in with one notice and no further requests.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {loadTemplates} from '../../../mars/viewer/app/engine-view/people.ts';
import {ThreeResources} from '../../../mars/viewer/lib/three-resources.ts';
import {RETRY_DELAYS_MS, transientLoadError, withRetry} from '../../../mars/viewer/lib/retry.ts';
import {HumanoidKit, humanoidKit} from '../src/humanoid/compose.ts';
import {lookKey, resolveLook} from '../src/humanoid/look.ts';
import {WorldBodyModels} from '../src/WorldBodyModels.ts';

const PUBLIC = new URL('../../../mars/viewer/public/', import.meta.url).pathname;
const ENV = PUBLIC + 'modular/environment/', KIT = PUBLIC + 'modular/humanoid/';
const buf = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const noWait = {wait: async () => {}};
const networkError = () => new TypeError('Failed to fetch');
const flush = async () => { for (let i = 0; i < 50; i++) await new Promise(r => setImmediate(r)); };

/** globalThis.fetch serving files from `dir`, with `fail(name, n)` deciding per request (n = 1 for the first ask of that name). */
function withFetch(dir: string, fail: (name: string, n: number) => 'network' | number | null) {
  const g = globalThis as unknown as {fetch: typeof fetch}, real = g.fetch, asked: string[] = [];
  g.fetch = (async (url: string) => {
    const name = String(url).split('?')[0].split('/').slice(-2).join('/').replace(/^(environment|humanoid)\//, '');
    asked.push(name); const how = fail(name, asked.filter(a => a === name).length);
    if (how === 'network') throw networkError();
    if (typeof how === 'number') return new Response('', {status: how});
    return new Response(buf(readFileSync(dir + name)));
  }) as typeof fetch;
  return {asked, restore: () => { g.fetch = real; }};
}

test('withRetry: retries only transient errors, 1 + 3 tries at 2/5/10 s, and stops on abort', async () => {
  assert.deepEqual(RETRY_DELAYS_MS, [2000, 5000, 10000]);
  assert.ok(transientLoadError(networkError()));
  assert.ok(transientLoadError({status: 503}) && transientLoadError({response: {status: 429}}));
  assert.ok(!transientLoadError({status: 404}) && !transientLoadError(Error('parse')) && !transientLoadError(new DOMException('x', 'AbortError')));
  const waits: number[] = [];
  let n = 0;
  await assert.rejects(withRetry(async () => { n++; throw networkError(); }, {wait: async ms => { waits.push(ms); }}));
  assert.equal(n, 4); assert.deepEqual(waits, [2000, 5000, 10000]);
  n = 0; await assert.rejects(withRetry(async () => { n++; throw Object.assign(Error('missing'), {status: 404}); }, noWait)); assert.equal(n, 1);
  n = 0; assert.equal(await withRetry(async () => { if (++n < 3) throw networkError(); return 'ok'; }, noWait), 'ok'); assert.equal(n, 3);
  const abort = new AbortController(); n = 0;
  await assert.rejects(withRetry(async () => { n++; throw networkError(); }, {signal: abort.signal, wait: async () => { abort.abort(); }}));
  assert.equal(n, 1, 'an abort during the wait ends the retries');
});

test('kit part fails once (network): the look still composes, the part is asked for twice', async () => {
  const reads: string[] = [];
  const kit = new HumanoidKit(new GLTFLoader(), '/modular/humanoid/', async url => {
    const name = url.replace('/modular/humanoid/', ''); reads.push(name);
    if (name.startsWith('parts/top-') && reads.filter(r => r === name).length === 1) throw networkError();
    return buf(readFileSync(KIT + name));
  });
  kit.retry = noWait;
  const t = await kit.template({preset: 'casual'});
  assert.ok(t.gltf.scene.userData.humanoid);
  const top = reads.find(r => r.startsWith('parts/top-'))!;
  assert.equal(reads.filter(r => r === top).length, 2);
});

test('kit part fails for good: the look rejects after 4 tries; a later ask fetches again (no cached failure)', async () => {
  const reads: string[] = [];
  const kit = new HumanoidKit(new GLTFLoader(), '/modular/humanoid/', async url => {
    const name = url.replace('/modular/humanoid/', ''); reads.push(name);
    if (name.startsWith('parts/top-')) throw networkError();
    return buf(readFileSync(KIT + name));
  });
  kit.retry = noWait;
  await assert.rejects(kit.template({preset: 'casual'}));
  const top = reads.find(r => r.startsWith('parts/top-'))!;
  assert.equal(reads.filter(r => r === top).length, 4);
  await assert.rejects(kit.template({preset: 'casual'}));
  assert.equal(reads.filter(r => r === top).length, 8);
  assert.equal(reads.filter(r => r === 'kit.json').length, 1, 'what loaded stays cached');
});

test('kit part 404: no retry', async () => {
  const reads: string[] = [];
  const kit = new HumanoidKit(new GLTFLoader(), '/modular/humanoid/', async url => {
    const name = url.replace('/modular/humanoid/', ''); reads.push(name);
    if (name.startsWith('parts/top-')) throw Object.assign(Error('HTTP 404'), {status: 404});
    return buf(readFileSync(KIT + name));
  });
  kit.retry = noWait;
  await assert.rejects(kit.template({preset: 'casual'}));
  assert.equal(reads.filter(r => r.startsWith('parts/top-')).length, 1);
});

test('character mesh fails once (network): retried, the template comes from the mesh + clips files, not the old GLB', async () => {
  const f = withFetch(ENV, (name, n) => name === 'animated-casual.mesh.glb' && n === 1 ? 'network' : null);
  try {
    const [t] = await loadTemplates(new AbortController().signal, new ThreeResources(), {names: ['casual'], retry: noWait});
    assert.equal(t.name, 'casual');
    assert.deepEqual(f.asked.sort(), ['animated-casual.mesh.glb', 'animated-casual.mesh.glb', 'clips-ual.glb']);
  } finally { f.restore(); }
});

test('character mesh 404 (a server without the wire files): the old single-file GLB at once, as before', async () => {
  const f = withFetch(ENV, name => name === 'animated-casual.mesh.glb' ? 404 : null);
  try {
    const [t] = await loadTemplates(new AbortController().signal, new ThreeResources(), {names: ['casual'], retry: noWait});
    assert.equal(t.name, 'casual');
    assert.deepEqual(f.asked.sort(), ['animated-casual.glb', 'animated-casual.mesh.glb', 'clips-ual.glb']);
  } finally { f.restore(); }
});

test('character files all fail for good: bounded tries (mesh, clips, then the old GLB), then it rejects', async () => {
  const f = withFetch(ENV, () => 'network');
  try {
    await assert.rejects(loadTemplates(new AbortController().signal, new ThreeResources(), {names: ['casual'], retry: noWait}));
    const count = (n: string) => f.asked.filter(a => a === n).length;
    assert.equal(count('animated-casual.mesh.glb'), 4); assert.equal(count('animated-casual.glb'), 4); assert.ok(count('clips-ual.glb') <= 4);
  } finally { f.restore(); }
});

// WorldBodyModels: a core/humanoid@2 look (the shared page kit) and an uploaded owner body
const look = resolveLook({preset: 'casual'}), model = lookKey(look);
const lookRecords = {s1: {kind: 'human', body: {family: 'humanoid', model, params: look}}};
const entities = {s1: {p: [0, 0, 0], state: {}}} as unknown as Parameters<WorldBodyModels['sync']>[1];

test('Soul look whose part fails for good: stand-in stays, one notice, no request loop', async () => {
  const f = withFetch(KIT, name => name.startsWith('parts/top-') ? 'network' : null);
  try {
    const loader = new GLTFLoader(); humanoidKit(loader).retry = noWait;
    const problems: string[] = [];
    const m = new WorldBodyModels(loader, p => problems.push(p));
    m.sync(lookRecords, entities); await flush(); await flush();
    const tops = () => f.asked.filter(a => a.startsWith('parts/top-')).length;
    assert.equal(tops(), 4); assert.equal(problems.length, 1); assert.ok(m.unresolved.has('s1'));
    for (let i = 0; i < 5; i++) { m.sync(lookRecords, entities); await flush(); }
    assert.equal(tops(), 4, 'no more requests'); assert.equal(problems.length, 1); assert.ok(m.unresolved.has('s1'), 'the stand-in stays');
  } finally { f.restore(); }
});

test('Soul look whose part fails once: the body arrives', async () => {
  const f = withFetch(KIT, (name, n) => name.startsWith('parts/top-') && n === 1 ? 'network' : null);
  try {
    const loader = new GLTFLoader(); humanoidKit(loader).retry = noWait;
    const problems: string[] = [];
    const m = new WorldBodyModels(loader, p => problems.push(p));
    m.sync(lookRecords, entities); await flush(); await flush();
    assert.ok(m.templates.has(model)); assert.deepEqual(problems, []);
    m.sync(lookRecords, entities); assert.ok(!m.unresolved.has('s1'));
  } finally { f.restore(); }
});

const url = '/v1/edge/body/assets/body_' + 'b'.repeat(64) + '.glb';
const ownerRecords = {s1: {kind: 'human', body: {family: 'humanoid', modelUrl: url}}};
const casual = (): Promise<GLTF> => new GLTFLoader().parseAsync(buf(readFileSync(ENV + 'animated-casual.glb')), '');

test('uploaded body fails once (network): retried, the body arrives', async () => {
  let n = 0; const problems: string[] = [];
  const loader = {loadAsync: async () => { if (++n === 1) throw networkError(); return casual(); }} as unknown as GLTFLoader;
  const m = new WorldBodyModels(loader, p => problems.push(p), noWait);
  m.sync(ownerRecords, entities); await flush(); await flush();
  assert.equal(n, 2); assert.equal(m.templates.size, 1); assert.deepEqual(problems, []);
});

test('uploaded body fails for good: 4 tries, one notice, no loop; a 404 is asked once', async () => {
  let n = 0; const problems: string[] = [];
  const loader = {loadAsync: async () => { n++; throw networkError(); }} as unknown as GLTFLoader;
  const m = new WorldBodyModels(loader, p => problems.push(p), noWait);
  m.sync(ownerRecords, entities); await flush();
  for (let i = 0; i < 5; i++) { m.sync(ownerRecords, entities); await flush(); }
  assert.equal(n, 4); assert.equal(problems.length, 1); assert.ok(m.unresolved.has('s1'));
  let k = 0;
  const missing = {loadAsync: async () => { k++; throw Object.assign(Error('fetch for "x" responded with 404'), {response: {status: 404}}); }} as unknown as GLTFLoader;
  const m2 = new WorldBodyModels(missing, () => {}, noWait);
  m2.sync(ownerRecords, entities); await flush(); assert.equal(k, 1);
});
