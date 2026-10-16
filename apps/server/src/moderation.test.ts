// G8 moderation: the upload gate, the classifier hook, the append-only log and the veto in a Godmode world.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync, gunzipSync } from 'node:zlib';
import { Hono, type Context } from 'hono';
import { Db } from './db.ts';
import { ApiError } from './souls.ts';
import { GodMode } from './god/god.ts';
import { mountGodRoutes } from './god/routes.ts';
import { imageSize, measureGlb } from './god/assets.ts';
import { admitBodyGLB } from './edge/body/admission.ts';
import { RIGID_MANIFEST, packGLB, rigidGLB } from './edge/body/testing.ts';
import { BODY_UPLOAD_POLICY, UploadRejected, assetPolicy, validateUpload } from './moderation/validate.ts';
import { classify, heuristicClassifier, noopClassifier, setUploadClassifier, skinRatio } from './moderation/classifier.ts';
import { ModerationStore, targetSha } from './moderation/store.ts';
import { mountModeration, withoutHidden } from './moderation/routes.ts';

const JPEG = readFileSync(new URL('../../../mars/viewer/public/history/2026/review-20260929/mimos-sign.jpg', import.meta.url));
const ASSETS = assetPolicy({ tris: 80_000, bytes: 3_000_000, texPx: 2048 });
const code = (f: () => unknown, c: string) => assert.throws(f, (e: unknown) => e instanceof UploadRejected && e.code === c, c);
const has = (b: Uint8Array, s: string) => Buffer.from(b).includes(Buffer.from(s, 'latin1'));

function chunk(type: string, data: Buffer) {
  const b = Buffer.alloc(data.length + 12); b.writeUInt32BE(data.length); b.write(type, 4, 'ascii'); data.copy(b, 8);
  let c = 0xffffffff; for (const x of b.subarray(4, -4)) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0); }
  b.writeUInt32BE((c ^ 0xffffffff) >>> 0, b.length - 4); return b;
}
/** An 8-bit RGB PNG of one colour, with optional extra chunks before IDAT. */
function png(w: number, h: number, rgb: [number, number, number] = [40, 80, 200], extra: Buffer[] = []) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.alloc(1 + w * 3); for (let x = 0; x < w; x++) row.set(rgb, 1 + x * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), ...extra, chunk('IDAT', deflateSync(Buffer.concat(Array(h).fill(row)))), chunk('IEND', Buffer.alloc(0))]);
}
/** The sample JPEG with EXIF (GPS), XMP and a comment segment added, plus bytes after its end marker. */
function jpegWithMetadata() {
  const seg = (marker: number, payload: string) => { const p = Buffer.from(payload, 'latin1'), b = Buffer.alloc(4 + p.length); b[0] = 0xff; b[1] = marker; b.writeUInt16BE(p.length + 2, 2); p.copy(b, 4); return b; };
  return Buffer.concat([JPEG.subarray(0, 2), seg(0xe1, 'Exif\0\0GPSLatitude 37.7749 secret-home'), seg(0xe1, 'http://ns.adobe.com/xap/1.0/\0<x:creator>Jane Doe</x:creator>'), JPEG.subarray(2, 20), seg(0xfe, 'shot by jane on her phone'), JPEG.subarray(20), Buffer.from('TRAILER-secret')]);
}
/** The rigid test GLB carrying one embedded image (and optional JSON edits). */
function texturedGlb(image: Buffer, mimeType: string, change?: (j: Record<string, any>) => void) {
  const base = rigidGLB(), n = base.readUInt32LE(12), j = JSON.parse(base.toString('utf8', 20, 20 + n)), bin0 = base.subarray(28 + n), pad = Buffer.alloc((4 - (image.length % 4)) % 4);
  const bin = Buffer.concat([bin0, image, pad]);
  j.buffers[0].byteLength = bin.length; j.bufferViews.push({ buffer: 0, byteOffset: bin0.length, byteLength: image.length });
  j.images = [{ bufferView: 1, mimeType }]; j.textures = [{ source: 0 }]; j.materials = [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }]; j.meshes[0].primitives[0].material = 0;
  change?.(j);
  return packGLB(j, bin);
}
const glbJson = (b: Uint8Array) => { const v = Buffer.from(b); return JSON.parse(v.toString('utf8', 20, 20 + v.readUInt32LE(12))); };

// ---------------------------------------------------------------- the gate

test('gate: a clean upload comes back byte-identical (its content address is stable)', () => {
  const glb = rigidGLB(), v = validateUpload(glb, BODY_UPLOAD_POLICY);
  assert.equal(v.format, 'glb'); assert.equal(v.bytes, glb); assert.equal(v.sha, v.inputSha); assert.equal(v.tris, 1);
  const dog = new Uint8Array(readFileSync(new URL('../../../worlds/core-assets/packs/dog-pack.glb', import.meta.url)));
  const d = validateUpload(dog, ASSETS); assert.equal(d.tris, measureGlb(dog).tris); assert.equal(d.sha, d.inputSha, 'a core pack model needs no stripping');
  const p = png(4, 4); assert.equal(validateUpload(p, ASSETS).bytes, p);
});

test('gate: metadata is stripped from GLB JSON, unknown chunks, embedded and standalone images', () => {
  // glTF extras anywhere, and a foreign chunk
  const g = rigidGLB((j) => { j.extras = { author: 'Jane Doe', path: '/Users/jane/secret' }; j.nodes[0].extras = { gps: [37.7, -122.4] }; });
  const foreign = Buffer.alloc(16); foreign.writeUInt32LE(8, 0); foreign.writeUInt32LE(0x5a5a5a5a, 4);
  const withChunk = Buffer.concat([g, foreign]); withChunk.writeUInt32LE(withChunk.length, 8);
  const v = validateUpload(withChunk, BODY_UPLOAD_POLICY);
  assert.ok(!has(v.bytes, 'Jane') && !has(v.bytes, 'secret') && !has(v.bytes, 'extras'));
  assert.equal(v.stripped.fields, 2); assert.equal(v.stripped.chunks, 1); assert.notEqual(v.sha, v.inputSha);
  assert.ok(v.text.join(' ').includes('Jane Doe'), 'the classifier still sees what was stripped');
  assert.equal(admitBodyGLB(Buffer.from(v.bytes), RIGID_MANIFEST).triangles, 1, 'the stripped GLB still passes BODY admission');
  // an embedded JPEG: EXIF/XMP/comment blanked in place, same length, still a valid body texture
  const jg = texturedGlb(jpegWithMetadata(), 'image/jpeg'), jv = validateUpload(jg, BODY_UPLOAD_POLICY);
  assert.equal(jv.bytes.length, jg.length, 'embedded images are blanked in place');
  for (const s of ['GPSLatitude', 'secret-home', 'Jane Doe', 'shot by jane', 'TRAILER']) assert.ok(!has(jv.bytes, s), s);
  assert.equal(admitBodyGLB(Buffer.from(jv.bytes), RIGID_MANIFEST).images, 1);
  // an embedded PNG: text chunks become an empty private chunk with a valid CRC
  const pg = texturedGlb(png(8, 8, [10, 20, 30], [chunk('tEXt', Buffer.from('Author\0Jane Doe')), chunk('tIME', Buffer.alloc(7))]), 'image/png'), pv = validateUpload(pg, BODY_UPLOAD_POLICY);
  assert.ok(!has(pv.bytes, 'Jane') && !has(pv.bytes, 'tEXt') && !has(pv.bytes, 'tIME') && has(pv.bytes, 'zeRo'));
  assert.equal(admitBodyGLB(Buffer.from(pv.bytes), RIGID_MANIFEST).images, 1);
  assert.equal(validateUpload(pv.bytes, BODY_UPLOAD_POLICY).stripped.segments, 2, 'the blanked chunks are themselves unknown ancillary chunks, blanked again harmlessly');
  // standalone images lose the segments entirely
  const sj = validateUpload(jpegWithMetadata(), ASSETS);
  assert.equal(sj.format, 'jpg'); assert.equal(sj.bytes.length, JPEG.length, 'exactly the original JPEG remains'); assert.deepEqual(Buffer.from(sj.bytes), JPEG);
  assert.deepEqual(imageSize(sj.bytes), imageSize(JPEG));
  const sp = validateUpload(png(4, 4, [1, 2, 3], [chunk('iTXt', Buffer.from('XML:com.adobe.xmp\0\0\0\0\0<creator>Jane</creator>')), chunk('eXIf', Buffer.from('MM\0*GPS'))]), ASSETS);
  assert.deepEqual(Buffer.from(sp.bytes), png(4, 4, [1, 2, 3]));
});

test('gate: malformed files and budgets are refused with a code the uploader can act on', () => {
  const g = rigidGLB();
  code(() => validateUpload(new Uint8Array(0), ASSETS), 'upload.empty');
  code(() => validateUpload(Buffer.from('hello world'), ASSETS), 'upload.format');
  code(() => validateUpload(png(2, 2), BODY_UPLOAD_POLICY), 'upload.format');
  code(() => validateUpload(Buffer.from('<svg onload="alert(1)"/>'), ASSETS), 'upload.format');
  code(() => validateUpload(g.subarray(0, -4), ASSETS), 'upload.invalid');
  const lie = Buffer.from(g); lie.writeUInt32LE(g.length + 4, 8); code(() => validateUpload(lie, ASSETS), 'upload.invalid');
  const notJson = Buffer.from(g); notJson.writeUInt32LE(0x004e4942, 16); code(() => validateUpload(notJson, ASSETS), 'upload.invalid');
  for (const uri of ['https://example.invalid/x.bin', 'data:application/octet-stream;base64,AAAA']) code(() => validateUpload(rigidGLB((j) => { j.buffers[0].uri = uri; }), ASSETS), 'upload.external-resource');
  code(() => validateUpload(rigidGLB((j) => { j.images = [{ uri: 'https://example.invalid/t.png' }]; }), ASSETS), 'upload.external-resource');
  code(() => validateUpload(rigidGLB((j) => { j.accessors[0].count = 300_000; }), ASSETS), 'upload.triangle-budget');
  code(() => validateUpload(rigidGLB((j) => { j.meshes[0].primitives[0].mode = 9; }), ASSETS), 'upload.invalid');
  code(() => validateUpload(rigidGLB((j) => { j.asset.version = '1.0'; }), ASSETS), 'upload.invalid');
  code(() => validateUpload(texturedGlb(png(4, 4), 'image/png', (j) => { j.images = Array(9).fill(j.images[0]); }), BODY_UPLOAD_POLICY), 'upload.texture-budget');
  code(() => validateUpload(texturedGlb(png(2049, 1), 'image/png'), BODY_UPLOAD_POLICY), 'upload.texture-budget');
  code(() => validateUpload(texturedGlb(png(4, 4), 'image/jpeg'), BODY_UPLOAD_POLICY), 'upload.image-format');
  code(() => validateUpload(texturedGlb(png(4, 4), 'image/png', (j) => { j.bufferViews[1].byteLength += 1000; }), BODY_UPLOAD_POLICY), 'upload.invalid');
  const crc = png(4, 4); crc[crc.length - 20] ^= 1; code(() => validateUpload(crc, ASSETS), 'upload.image-invalid');
  code(() => validateUpload(png(4, 4, [1, 1, 1], [chunk('XXXX', Buffer.alloc(4))]), ASSETS), 'upload.image-format');
  const bomb = png(4, 4); const ihdr = Buffer.from(bomb); ihdr.writeUInt32BE(2048, 16); code(() => validateUpload(ihdr, ASSETS), 'upload.image-invalid');
  code(() => validateUpload(JPEG.subarray(0, -2), ASSETS), 'upload.image-invalid');
  code(() => validateUpload(JPEG.subarray(0, 200), ASSETS), 'upload.image-invalid');
  code(() => validateUpload(png(4096, 1), ASSETS), 'upload.texture-budget');
  code(() => validateUpload(Buffer.concat([g, Buffer.alloc(3_000_000)]), ASSETS), 'upload.size');
  code(() => validateUpload(Buffer.from('{"schema":'), ASSETS), 'upload.invalid');
  assert.equal(validateUpload(Buffer.from('{"schema":"lm-building-footprint/1"}'), ASSETS).format, 'json');
});

// ---------------------------------------------------------------- classifier

test('classifier: no-op default, local heuristic stub, fail closed on error or timeout', async () => {
  const facts = (over: Partial<Parameters<typeof classify>[0]> = {}) => ({ surface: 'asset' as const, format: 'png' as const, sha: 'a'.repeat(64), bytes: 1, tris: 0, textures: 1, texPx: 1, text: [], images: [], ...over });
  assert.equal((await classify(facts({ text: ['nsfw'] }), noopClassifier)).action, 'allow');
  const k = await classify(facts({ text: ['statue', 'Explicit content'] }), heuristicClassifier);
  assert.equal(k.action, 'quarantine'); assert.deepEqual(k.labels, ['keyword:explicit']);
  assert.equal((await classify(facts({ text: ['Essex garden'] }), heuristicClassifier)).action, 'allow', 'whole words only');
  const skin = validateUpload(png(100, 100, [224, 172, 140]), ASSETS), blue = validateUpload(png(100, 100), ASSETS);
  assert.ok(skinRatio(skin.images[0])! > 0.99); assert.equal(skinRatio(blue.images[0]), 0);
  assert.equal((await classify(facts({ images: skin.images }), heuristicClassifier)).action, 'quarantine');
  assert.equal((await classify(facts({ images: blue.images }), heuristicClassifier)).action, 'allow');
  const broken = await classify(facts(), { name: 'broken', classify: () => { throw new Error('model missing'); } });
  assert.equal(broken.action, 'quarantine'); assert.deepEqual(broken.labels, ['classifier-error']);
  const slow = await classify(facts(), { name: 'slow', classify: () => new Promise(() => {}) }, 20);
  assert.equal(slow.action, 'quarantine'); assert.match(slow.reason!, /timeout/);
  assert.equal((await classify(facts(), { name: 'bogus', classify: () => ({ action: 'maybe' }) as never })).action, 'quarantine');
});

// ---------------------------------------------------------------- the log

test('log: append-only, folds creator veto, admin site veto across worlds, quarantine and release', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'moderation-log-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const site = join(dir, 'site.jsonl'), a = new Db(':memory:'), b = new Db(':memory:');
  const A = new ModerationStore(a.db, 'a-1', site), B = new ModerationStore(b.db, 'b-1', site), x = 'a'.repeat(64), y = 'b'.repeat(64);
  assert.equal(A.isHidden(x), false); const v0 = A.version();
  A.append({ sha: x, action: 'hide', actor: 'dev:owner', role: 'creator', reason: 'not for this world' });
  assert.ok(A.isHidden(x)); assert.equal(B.isHidden(x), false, 'a creator veto stays in its world'); assert.notEqual(A.version(), v0);
  assert.throws(() => a.db.exec("UPDATE moderation_log_v1 SET action='unhide'"), /append-only/);
  assert.throws(() => a.db.exec('DELETE FROM moderation_log_v1'), /append-only/);
  A.append({ sha: x, action: 'unhide', actor: 'dev:owner', role: 'creator', reason: 'undo' });
  assert.equal(A.isHidden(x), false); assert.deepEqual(A.log({ sha: x }).map((e) => e.action), ['unhide', 'hide']);
  // the admin's veto is site-wide, and a creator's unhide cannot lift it
  A.append({ sha: y, action: 'hide', actor: 'dev:admin', role: 'admin', reason: 'illegal', scope: 'site' });
  assert.ok(A.isHidden(y) && B.isHidden(y)); assert.deepEqual(B.hidden(), [y]);
  B.append({ sha: y, action: 'unhide', actor: 'dev:b-owner', role: 'creator' });
  assert.ok(B.isHidden(y) && B.state(y).adminVeto);
  assert.throws(() => B.append({ sha: y, action: 'hide', actor: 'dev:b-owner', role: 'creator', scope: 'site' }), /site admin/);
  B.append({ sha: y, action: 'unhide', actor: 'dev:admin', role: 'admin', scope: 'site' });
  assert.equal(A.isHidden(y), false); assert.equal(B.isHidden(y), false);
  assert.equal(readFileSync(site, 'utf8').trim().split('\n').length, 2, 'the site log only grows');
  // quarantine holds until released
  A.append({ sha: x, action: 'quarantine', actor: 'classifier:heuristic', role: 'classifier', reason: 'keyword:nsfw' });
  assert.ok(A.isHidden(x)); A.append({ sha: x, action: 'release', actor: 'dev:admin', role: 'admin' }); assert.equal(A.isHidden(x), false);
  assert.equal(targetSha(`/w/eden/v1/edge/body/assets/body_${x}.glb`), x); assert.equal(targetSha(`/assets/${y}.png`), y); assert.equal(targetSha(`body_${x}`), x); assert.equal(targetSha('nope'), null);
});

test('snapshot filter: an entity using a hidden file, defs built on it, and its children are left out', () => {
  const h = 'c'.repeat(64);
  const snap = {
    contract: 'world/1', assetBytes: { [h]: 10, ['d'.repeat(64)]: 5 },
    defs: [{ ref: 'statue@1', name: 'statue', version: 1, hash: '1'.repeat(16), make: { kind: 'mesh', asset: h } }, { ref: 'plinth-statue@1', name: 'plinth-statue', version: 1, hash: '2'.repeat(16), extends: 'statue@1' }, { ref: 'bench@1', name: 'bench', version: 1, hash: '3'.repeat(16), make: { kind: 'mesh', asset: 'd'.repeat(64) } }],
    entities: [{ id: 'e_aaaa', def: 'statue@1', in: { parent: 'world' } }, { id: 'e_bbbb', def: 'bench@1', in: { parent: 'e_aaaa' } }, { id: 'e_cccc', def: 'sha:' + '2'.repeat(16), in: { parent: 'world' } }, { id: 'e_dddd', def: 'bench@1', in: { parent: 'world' } }],
  };
  const out = withoutHidden(snap, new Set([h]));
  assert.deepEqual(out.entities.map((e) => e.id), ['e_dddd']); assert.deepEqual(out.defs.map((d) => d.ref), ['bench@1']); assert.deepEqual(Object.keys(out.assetBytes!), ['d'.repeat(64)]);
  assert.equal(withoutHidden(snap, new Set()).entities.length, 4);
});

// ---------------------------------------------------------------- a Godmode world, end to end

function godWorld(t: { after(f: () => void): void }) {
  const dir = mkdtempSync(join(tmpdir(), 'moderation-god-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const db = new Db(':memory:');
  const god = new GodMode(db, { worldId: 'mod-1', ownerId: 'dev:owner', tick: () => 1, emit: () => {}, assetDir: dir } as never);
  const app = new Hono();
  const users: Record<string, { id: string; role: 'user' | 'admin' }> = { 'dev:owner': { id: 'dev:owner', role: 'user' }, 'dev:admin': { id: 'dev:admin', role: 'admin' }, 'dev:visitor': { id: 'dev:visitor', role: 'user' } };
  const bearer = (c: Context) => c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  const requireUser = async (c: Context) => { const u = users[bearer(c) ?? '']; if (!u) throw new ApiError(401, 'unauthorized', 'sign in'); return { ...u, email: null, wallet: null, created_at: 0, last_seen: 0, invited_by: null }; };
  const store = mountModeration(app, { db: db.db, worldId: 'mod-1', bearer, requireUser, god, siteLog: join(dir, 'site.jsonl') });
  mountGodRoutes(app, { god, worldName: 'Mod', requireUser, soulFromBearer: () => null, baseOf: () => 'http://localhost:5990/w/mod', limitIp: () => {} });
  app.onError((err, c) => err instanceof ApiError ? c.json({ ok: false, code: err.code, message: err.message }, err.status as 400) : c.json({ ok: false, code: 'internal', message: String(err) }, 500));
  const token = god.mintFor({ id: 'dev:owner', role: 'user' } as never, 'test');
  const req = async (path: string, init: { method?: string; json?: unknown; body?: BodyInit; as?: string } = {}) => {
    const r = await app.request(path, { method: init.method ?? (init.json || init.body ? 'POST' : 'GET'), headers: { ...(init.as !== 'anon' ? { authorization: `Bearer ${init.as ?? token}` } : {}), ...(init.json ? { 'content-type': 'application/json' } : {}) }, body: init.json ? JSON.stringify(init.json) : init.body });
    const text = await r.text(); let data: any = null; try { data = JSON.parse(text); } catch { /* binary */ }
    return { status: r.status, data, headers: r.headers };
  };
  return { god, store, req, dir, app };
}
const uploadForm = (bytes: Uint8Array, name: string) => { const f = new FormData(); f.set('file', new Blob([new Uint8Array(bytes)], { type: 'model/gltf-binary' }), `${name}.glb`); f.set('name', name); f.set('height', '1'); f.set('define', '1'); return f; };

test('Godmode world: upload is gated and stripped, the creator hides it everywhere, undo restores it, the log keeps both', async (t) => {
  const w = godWorld(t);
  const glb = rigidGLB((j) => { j.extras = { author: 'Jane' }; j.accessors[0].min = [0, 0, 0]; j.accessors[0].max = [1, 1, 0]; });
  const up = await w.req('/v1/god/assets', { body: uploadForm(glb, 'statue') });
  assert.equal(up.status, 200, JSON.stringify(up.data));
  const sha = up.data.asset.sha;
  assert.equal(up.data.moderation.hidden, false); assert.equal(up.data.moderation.stripped.fields, 1);
  assert.notEqual(sha, validateUpload(glb, ASSETS).inputSha, 'the store keeps the stripped bytes');
  assert.equal(w.god.act({ ops: [{ op: 'place', def: 'statue@1', p: [3, 4], name: 'statue', tmp: '$s' }, { op: 'place', def: 'core/box@1', p: [9, 9], name: 'crate' }] }).accepted, true);
  const before = await w.req('/v1/world/snapshot', { as: 'anon' });
  assert.equal(before.data.entities.length, 2); const v0 = before.headers.get('x-moderation-version');
  assert.equal((await w.req(`/assets/${sha}.glb`, { as: 'anon' })).status, 200);
  // strangers cannot moderate; the junk-format and malformed refusals carry the gate's codes
  assert.equal((await w.req('/v1/moderation/hide', { json: { target: sha }, as: 'dev:visitor' })).status, 403);
  assert.equal((await w.req('/v1/moderation/hide', { json: { target: sha }, as: 'anon' })).status, 401);
  assert.equal((await w.req('/v1/god/assets', { body: uploadForm(glb.subarray(0, -4), 'broken') })).data.code, 'upload.invalid');
  // the creator (god token) hides it: gone from the snapshot, the file 404s, the seq heartbeat says so
  const hide = await w.req('/v1/moderation/hide', { json: { target: `/assets/${sha}.glb`, reason: 'not what I meant to place' } });
  assert.equal(hide.status, 200, JSON.stringify(hide.data)); assert.equal(hide.data.state.hidden, true); assert.equal(hide.data.entry.role, 'creator');
  const after = await w.req('/v1/world/snapshot', { as: 'anon' });
  assert.deepEqual(after.data.entities.map((e: { name: string }) => e.name), ['crate']); assert.notEqual(after.headers.get('x-moderation-version'), v0);
  assert.ok(!JSON.stringify(after.data).includes(sha), 'the hidden file is not even named to visitors');
  // browsers ask for gzip, which the catalog's compress() applies after the route: still filtered
  const gz = await w.app.request('/v1/world/snapshot', { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(gz.headers.get('content-encoding'), 'gzip');
  const unzipped = JSON.parse(gunzipSync(Buffer.from(await gz.arrayBuffer())).toString('utf8'));
  assert.deepEqual(unzipped.entities.map((e: { name: string }) => e.name), ['crate']);
  assert.equal((await w.req(`/assets/${sha}.glb`, { as: 'anon' })).status, 404);
  const seq = await w.req('/v1/world/seq', { as: 'anon' }); assert.deepEqual(seq.data.moderation.hidden, [sha]); assert.equal(typeof seq.data.seq, 'number');
  assert.deepEqual((await w.req('/v1/moderation', { as: 'anon' })).data.hidden, [sha]);
  // the world itself is unchanged: the god still sees the entity; the owner's uploads list shows the state
  assert.equal(w.god.model.entities.size, 2);
  const uploads = await w.req('/v1/moderation/uploads', { as: 'dev:owner' });
  assert.equal(uploads.data.uploads.find((u: { sha: string }) => u.sha === sha).hidden, true);
  // undo
  const undo = await w.req('/v1/moderation/unhide', { json: { target: sha, reason: 'my mistake' } });
  assert.equal(undo.data.state.hidden, false);
  assert.equal((await w.req('/v1/world/snapshot', { as: 'anon' })).data.entities.length, 2);
  assert.equal((await w.req(`/assets/${sha}.glb`, { as: 'anon' })).status, 200);
  const log = await w.req(`/v1/moderation/log?sha=${sha}`, { as: 'dev:owner' });
  assert.deepEqual(log.data.log.map((e: { action: string }) => e.action), ['unhide', 'hide']);
  // a repeat is a no-op, not a new row
  assert.equal((await w.req('/v1/moderation/unhide', { json: { target: sha } })).data.changed, false);
  // the site admin's veto: the creator cannot lift it; re-uploading the same file is refused
  assert.equal((await w.req('/v1/moderation/hide', { json: { target: sha, reason: 'illegal' }, as: 'dev:admin' })).data.entry.scope, 'site');
  await w.req('/v1/moderation/unhide', { json: { target: sha } });
  assert.equal((await w.req(`/assets/${sha}.glb`, { as: 'anon' })).status, 404);
  const again = await w.req('/v1/god/assets', { body: uploadForm(glb, 'statue-again') });
  assert.equal(again.status, 451); assert.equal(again.data.code, 'moderation.vetoed');
  assert.equal((await w.req('/v1/moderation/release', { json: { target: sha } })).status, 403, 'only the admin releases');
});

test('Godmode world: a classifier quarantine hides the upload until the site admin releases it; a reject stores nothing', async (t) => {
  const w = godWorld(t);
  t.after(() => setUploadClassifier(null));
  setUploadClassifier(heuristicClassifier);
  const glb = rigidGLB((j) => { j.accessors[0].min = [0, 0, 0]; j.accessors[0].max = [1, 1, 0]; });
  const up = await w.req('/v1/god/assets', { body: uploadForm(glb, 'nsfw-figure') });
  assert.equal(up.status, 200); assert.equal(up.data.moderation.quarantined, true); assert.deepEqual(up.data.moderation.labels, ['keyword:nsfw']);
  const sha = up.data.asset.sha;
  assert.equal((await w.req(`/assets/${sha}.glb`, { as: 'anon' })).status, 404);
  assert.equal((await w.req('/v1/moderation/release', { json: { target: sha } })).status, 403);
  assert.equal((await w.req('/v1/moderation/release', { json: { target: sha }, as: 'dev:admin' })).data.state.hidden, false);
  assert.equal((await w.req(`/assets/${sha}.glb`, { as: 'anon' })).status, 200);
  setUploadClassifier({ name: 'strict', classify: () => ({ action: 'reject', classifier: 'strict', labels: ['test'] }) });
  const other = rigidGLB((j) => { j.accessors[0].min = [0, 0, 0]; j.accessors[0].max = [2, 2, 0]; });
  const no = await w.req('/v1/god/assets', { body: uploadForm(other, 'thing') });
  assert.equal(no.status, 422); assert.equal(no.data.code, 'moderation.rejected');
  const rejected = w.store.log({ limit: 5 }).find((e) => e.action === 'reject');
  assert.ok(rejected); assert.equal((await w.req(`/assets/${rejected!.sha}.glb`, { as: 'anon' })).status, 404, 'nothing stored');
});

test('Soul bodies: a hidden body upload is served as a valid stand-in (never a 404), revalidated not immutable, and cannot be worn', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'moderation-body-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const db = new Db(':memory:'), app = new Hono();
  db.db.exec('CREATE TABLE edge_body_assets_v1(world_id TEXT NOT NULL,asset_id TEXT NOT NULL,descriptor TEXT NOT NULL,content BLOB NOT NULL,PRIMARY KEY(world_id,asset_id)) WITHOUT ROWID');
  const ceramic = 'e'.repeat(64), human = 'f'.repeat(64);
  for (const [sha, type] of [[ceramic, 'ceramic'], [human, 'humanoid']]) db.db.prepare('INSERT INTO edge_body_assets_v1 VALUES (?,?,?,?)').run('w-1', `body_${sha}`, JSON.stringify({ type }), rigidGLB());
  const store = mountModeration(app, { db: db.db, worldId: 'w-1', bearer: () => undefined, requireUser: async () => { throw new ApiError(401, 'unauthorized', 'x'); }, siteLog: join(dir, 'site.jsonl') });
  app.get('/v1/edge/body/assets/:file', (c) => c.body(new Uint8Array(rigidGLB()), 200, { 'Cache-Control': 'public, max-age=31536000, immutable' }));
  app.put('/v1/edge/body', (c) => c.json({ ok: true }));
  app.get('/v1/souls/:id/profile-photo/:hash', (c) => c.body(new Uint8Array(png(2, 2)), 200));
  const get = (sha: string, h: Record<string, string> = {}) => app.request(`/v1/edge/body/assets/body_${sha}.glb`, { headers: h });
  const open = await get(ceramic);
  assert.equal(open.status, 200); assert.equal(open.headers.get('cache-control'), 'public, no-cache'); assert.equal(open.headers.get('etag'), `"body_${ceramic}"`);
  assert.equal((await get(ceramic, { 'if-none-match': `"body_${ceramic}"` })).status, 304);
  for (const sha of [ceramic, human]) store.append({ sha, action: 'hide', actor: 'dev:owner', role: 'creator' });
  const c = await get(ceramic), h = await get(human);
  assert.equal(c.status, 200); assert.equal(c.headers.get('x-moderation'), 'hidden'); assert.equal(c.headers.get('cache-control'), 'no-store');
  assert.equal((await get(ceramic, { 'if-none-match': `"body_${ceramic}"` })).status, 200, 'a revalidating browser gets the stand-in, not its cached copy');
  assert.equal(admitBodyGLB(Buffer.from(await c.arrayBuffer()), RIGID_MANIFEST).triangles, 1, 'the rigid stand-in is a valid body');
  const humanoid = admitBodyGLB(Buffer.from(await h.arrayBuffer()), { type: 'humanoid', license: 'CC0', rightsConfirmed: true, rig: 'quaternius/1' });
  assert.equal(humanoid.rig, 'quaternius/1', 'the humanoid stand-in is the canonical rigged figure');
  const wear = await app.request('/v1/edge/body', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assetId: `body_${ceramic}` }) });
  assert.equal(wear.status, 409); assert.equal((await wear.json()).error.code, 'body.moderated');
  assert.equal((await app.request('/v1/edge/body', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ preset: 'humanoid' }) })).status, 200);
  // profile photos are addressed by their sha too
  const photo = '9'.repeat(64);
  assert.equal((await app.request(`/v1/souls/s_1/profile-photo/${photo}`)).status, 200);
  store.append({ sha: photo, action: 'hide', actor: 'dev:owner', role: 'creator' });
  assert.equal((await app.request(`/v1/souls/s_1/profile-photo/${photo}`)).status, 404);
});
