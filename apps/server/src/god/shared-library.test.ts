// M4 shared library from inside a world (shared-library.ts): two real god worlds (alpha, beta) with their own asset
// stores share one library directory. Alpha publishes through its god routes; beta finds and places through its own;
// placements pin the version placed; restricted art is refused; every model passes the moderation seam.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono, type Context } from 'hono';
import { Db } from '../db.ts';
import { ApiError } from '../souls.ts';
import { GodMode } from './god.ts';
import { REPO_ROOT } from './assets.ts';
import { mountSharedLibraryRoutes } from './shared-library.ts';
import { validateUpload, type UploadGate } from '../../../../packages/library/src/index.ts';
import { totemGlb } from '../../../../tools/library/fixture-glb.mjs';

/* eslint-disable @typescript-eslint/no-explicit-any */
const corner = (extra: unknown[] = []) => ({ schema: 'def/1', name: 'reading-corner', version: 1, description: 'A reading corner: a bench under a lamp post, with a little table.', tags: ['reading', 'corner', 'seat'], form: 'point',
  make: { kind: 'parts', parts: [{ id: 'bench', def: 'core-bench@1', at: [0, 0, 0] }, { id: 'lamp', def: 'core-lamp-post@1', at: [1.8, 0, -0.6] }, { id: 'table', def: 'core-table@1', at: [-1.9, 0, 0.2] }, ...extra] },
  size: { box: [6, 3, 3] }, layer: 'solid', anchor: 'base' });

function world(slug: string, root: string, libDir: string | undefined, gate?: UploadGate) {
  let tick = 1;
  const god = new GodMode(new Db(':memory:'), { worldId: `${slug}-world`, ownerId: 'dev:admin', tick: () => tick++, emit: () => {}, assetDir: join(root, `assets-${slug}`) });
  const token = god.mintFor({ id: 'dev:admin', role: 'admin' } as never, 'test');
  const app = new Hono();
  mountSharedLibraryRoutes(app, { god, slug, dir: libDir, ...(gate ? { gate, gateName: 'test-gate' } : {}), requireGod: (c: Context) => { if (!god.godFromToken(c.req.header('authorization')?.replace(/^Bearer\s+/i, ''))) throw new ApiError(401, 'unauthorized', 'missing or invalid god token'); } });
  app.onError((err, c) => err instanceof ApiError ? c.json({ ok: false, code: err.code, message: err.message }, err.status as 400) : c.json({ ok: false, code: 'internal', message: String(err) }, 500));
  const req = async (path: string, body?: unknown, auth = true) => {
    const r = await app.request(path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json() as any };
  };
  const act = (ops: unknown[]) => { const r = god.act({ ops }, 'test'); assert.equal(r.accepted, true, JSON.stringify(r)); return r; };
  return { god, req, act };
}
const tmp = () => mkdtempSync(join(tmpdir(), 'shared-lib-'));

test('publish from alpha, find and place from beta: pinned versions, author and licence, defs reused', async (t) => {
  const root = tmp(); t.after(() => rmSync(root, { recursive: true, force: true }));
  const lib = join(root, 'lib'), alpha = world('alpha', root, lib), beta = world('beta', root, lib);
  alpha.act([{ op: 'define', def: corner() }, { op: 'place', def: 'reading-corner@1', name: 'corner', p: [0, 0, 0] }]);

  const v1 = await alpha.req('/v1/god/library/publish', { ref: 'reading-corner@1', title: 'Reading corner', authorName: 'Ana' });
  assert.equal(v1.status, 200, JSON.stringify(v1.data));
  assert.equal(v1.data.created, true); assert.equal(v1.data.item.id, 'alpha/reading-corner'); assert.equal(v1.data.item.version, 1);
  assert.deepEqual(v1.data.item.author, { world: 'alpha', by: 'god:alpha', name: 'Ana' }); assert.equal(v1.data.item.licence.spdx, 'CC0-1.0');
  assert.equal(v1.data.item.moderation.gate, 'library-gate/local');
  assert.equal((await alpha.req('/v1/god/library/publish', { ref: 'reading-corner@1' })).data.created, false, 'unchanged → the same version');
  alpha.act([{ op: 'define', def: corner([{ id: 'bench2', def: 'core-bench@1', at: [0, 0, 1.6], r: 180 }]) }]);
  assert.equal((await alpha.req('/v1/god/library/publish', { ref: 'reading-corner@1', title: 'Reading corner' })).data.item.version, 2);

  const found = await beta.req('/v1/god/library?q=reading%20corner');
  assert.equal(found.status, 200);
  assert.deepEqual(found.data.hits.map((h: any) => [h.id, h.version, h.versions, h.placedHere, h.mine]), [['alpha/reading-corner', 2, [1, 2], false, false]]);
  const item = await beta.req('/v1/god/library/item?id=alpha/reading-corner@1');
  assert.equal(item.data.item.version, 1); assert.equal(item.data.offered, true); assert.equal(item.data.versions.length, 2);

  const dry = await beta.req('/v1/god/library/place', { item: 'alpha/reading-corner@1', at: [-5, 0], name: 'corner-v1', dry: true });
  assert.equal(dry.status, 200, JSON.stringify(dry.data)); assert.equal(dry.data.dry, true);
  assert.equal(beta.god.model.def('lib-alpha-reading-corner@1'), undefined, 'a dry run changes nothing');
  const p1 = await beta.req('/v1/god/library/place', { item: 'alpha/reading-corner@1', at: [-5, 0], name: 'corner-v1' });
  assert.equal(p1.status, 200, JSON.stringify(p1.data)); assert.equal(p1.data.accepted, true); assert.equal(p1.data.defines, 1);
  const p2 = await beta.req('/v1/god/library/place', { item: 'alpha/reading-corner', at: [5, 0], name: 'corner-v2' });
  assert.equal(p2.data.item.version, 2);
  const again = await beta.req('/v1/god/library/place', { item: 'alpha/reading-corner@1', at: [-5, -8], name: 'corner-v1b' });
  assert.equal(again.data.defines, 0, 'an identical def already here is reused');

  const e1 = JSON.parse(readFileSync(join(lib, 'entries/alpha/reading-corner/1.json'), 'utf8')), e2 = JSON.parse(readFileSync(join(lib, 'entries/alpha/reading-corner/2.json'), 'utf8'));
  const placed = (name: string) => [...beta.god.model.entities.values()].find((e: any) => e.name === name) as any;
  const hashOf = (e: any) => beta.god.model.def(e.def)?.hash;
  assert.equal(hashOf(placed('corner-v1')), e1.hash); assert.equal(hashOf(placed('corner-v2')), e2.hash); assert.notEqual(e1.hash, e2.hash);
  assert.equal((await beta.req('/v1/god/library?q=reading')).data.hits[0].placedHere, true);
});

test('a self-made model travels through the moderation seam into the placing world\'s own asset store', async (t) => {
  const root = tmp(); t.after(() => rmSync(root, { recursive: true, force: true }));
  const lib = join(root, 'lib'), seen: string[] = [];
  const gate: UploadGate = (bytes, policy) => { const g = validateUpload(bytes, policy); seen.push(g.format); return g; };
  const alpha = world('alpha', root, lib, gate), beta = world('beta', root, lib, gate);
  const meta = alpha.god.assets.put(totemGlb(), { name: 'totem', license: 'CC0-1.0', source: 'made by Ana in alpha', by: 'god' });
  alpha.act([{ op: 'define', def: { schema: 'def/1', name: 'totem', version: 1, description: 'A painted three-block totem.', tags: ['totem'], form: 'point', make: { kind: 'mesh', asset: meta.sha }, size: { box: [1, 1, 1] }, layer: 'solid', anchor: 'base' } }]);
  const pub = await alpha.req('/v1/god/library/publish', { ref: 'totem@1' });
  assert.equal(pub.status, 200, JSON.stringify(pub.data)); assert.equal(pub.data.item.models.length, 1); assert.equal(pub.data.item.moderation.gate, 'test-gate');
  assert.ok(seen.includes('glb') && seen.includes('json'), 'publish gates the model and the def body');
  assert.equal(beta.god.assets.info(meta.sha), undefined);
  seen.length = 0;
  const placed = await beta.req('/v1/god/library/place', { item: 'alpha/totem', at: [0, -5], name: 'totem' });
  assert.equal(placed.status, 200, JSON.stringify(placed.data)); assert.deepEqual(placed.data.models, [{ sha: meta.sha, stored: true }]);
  assert.deepEqual(seen, ['glb'], 'placing gates the model again before the world stores it');
  assert.equal(beta.god.assets.info(meta.sha)?.license, 'CC0-1.0');
  assert.ok(beta.god.assets.file(meta.sha, 'glb'));
});

test('refusals: restricted art, a gate that refuses or changes bytes, yanked items, name clashes, no god, no library', async (t) => {
  const root = tmp(); t.after(() => rmSync(root, { recursive: true, force: true }));
  const lib = join(root, 'lib'), alpha = world('alpha', root, lib);
  // a Little Martians model may not leave its pack
  const lm = JSON.parse(readFileSync(join(REPO_ROOT, 'worlds/core-assets/littlemartians-two.index.json'), 'utf8')).assets;
  alpha.act([{ op: 'define', def: { schema: 'def/1', name: 'my-martian', version: 1, description: 'A martian I like.', form: 'point', make: { kind: 'mesh', asset: Object.keys(lm)[0] }, size: { box: [1, 1.5, 1] }, layer: 'solid', anchor: 'base' } }]);
  const lmPub = await alpha.req('/v1/god/library/publish', { ref: 'my-martian@1' });
  assert.equal(lmPub.status, 403); assert.equal(lmPub.data.code, 'library.restricted');
  assert.equal((await alpha.req('/v1/god/library/publish', { ref: 'core/bench@1' })).data.code, 'library.core');
  assert.equal((await alpha.req('/v1/god/library/publish', { ref: 'nothing@1' })).data.code, 'library.missing');
  assert.equal((await alpha.req('/v1/god/library/publish', { ref: 'my-martian@1', licence: 'MIT' })).status, 400);

  // a gate that refuses: nothing is stored
  const meta = alpha.god.assets.put(totemGlb(), { name: 'totem', license: 'CC0-1.0', by: 'god' });
  alpha.act([{ op: 'define', def: { schema: 'def/1', name: 'totem', version: 1, description: 'A totem.', form: 'point', make: { kind: 'mesh', asset: meta.sha }, size: { box: [1, 1, 1] }, layer: 'solid', anchor: 'base' } }]);
  const strict = world('strict', root, lib, (b, p) => { const g = validateUpload(b, p); if (g.format === 'glb') { const e = new Error('upload.flagged: looks unsafe') as Error & { code: string; status: number }; e.code = 'upload.flagged'; e.status = 422; throw e; } return g; });
  strict.god.assets.put(totemGlb(), { name: 'totem', license: 'CC0-1.0', by: 'god' });
  strict.act([{ op: 'define', def: { schema: 'def/1', name: 'totem', version: 1, description: 'A totem.', form: 'point', make: { kind: 'mesh', asset: meta.sha }, size: { box: [1, 1, 1] }, layer: 'solid', anchor: 'base' } }]);
  const flagged = await strict.req('/v1/god/library/publish', { ref: 'totem@1' });
  assert.equal(flagged.status, 422); assert.equal(flagged.data.code, 'upload.flagged');
  assert.equal((await strict.req('/v1/god/library?q=totem')).data.hits.length, 0);

  // published by alpha; a world whose gate changes the bytes refuses to place it under the pin
  assert.equal((await alpha.req('/v1/god/library/publish', { ref: 'totem@1' })).status, 200);
  const stripping = world('gamma', root, lib, (b, p) => { const g = validateUpload(b, p); if (g.format !== 'glb') return g; const bytes = new Uint8Array(b); bytes[bytes.length - 1] ^= 1; return { ...g, bytes, sha: 'f'.repeat(64) }; });
  const changed = await stripping.req('/v1/god/library/place', { item: 'alpha/totem', at: [0, 0] });
  assert.equal(changed.status, 422); assert.equal(changed.data.code, 'moderation.changed');
  assert.equal(stripping.god.assets.info(meta.sha), undefined);

  // a name clash with the world's own def is refused before anything moves
  const delta = world('delta', root, lib);
  delta.act([{ op: 'define', def: { ...corner(), name: 'lib-alpha-totem', description: 'Not the totem.' } }]);
  const clash = await delta.req('/v1/god/library/place', { item: 'alpha/totem', at: [0, 0] });
  assert.equal(clash.status, 409); assert.equal(clash.data.code, 'library.conflict');
  assert.equal(delta.god.assets.info(meta.sha), undefined);

  // yanked: gone from find and from new placement
  const { SharedLibrary } = await import('../../../../packages/library/src/index.ts');
  new SharedLibrary(lib).yank('alpha/totem@1', 'test', 'test');
  assert.equal((await delta.req('/v1/god/library?q=totem')).data.hits.length, 0);
  const gone = await delta.req('/v1/god/library/place', { item: 'alpha/totem@1', at: [0, 0] });
  assert.equal(gone.data.code, 'library.yanked');

  // only the god; and a site without a library says so
  assert.equal((await delta.req('/v1/god/library?q=x', undefined, false)).status, 401);
  assert.equal((await delta.req('/v1/god/library/place', { nope: 1 })).status, 400);
  const none = world('lonely', root, undefined);
  const r = await none.req('/v1/god/library?q=totem');
  assert.equal(r.status, 503); assert.equal(r.data.code, 'library.unavailable');
});
