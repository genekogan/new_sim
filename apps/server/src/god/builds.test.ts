import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Hono } from 'hono';
import { coreRef, hashOf } from '@sim/world-compiler';
import { Db } from '../db.ts';
import { ApiError } from '../souls.ts';
import { GodMode, type GodEvent, type WorldDiffMessage, type WorldBuildMessage, type GodOptions } from './god.ts';
import { mountGodRoutes } from './routes.ts';
import type { BuildBody, BuildField } from './builds.ts';
import { GOD_EDIT_OUTCOME_BYTES } from './store.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
function fixture(options: Partial<GodOptions> = {}, file = ':memory:') {
  const db = new Db(file), emitted: (WorldDiffMessage | WorldBuildMessage)[] = [], events: GodEvent[] = [];
  let now = 1_000_000;
  const god = new GodMode(db, { worldId: 'build-test', ownerId: 'owner', tick: () => 100, now: () => now, buildPauseMs: 50, buildClosureMs: 500, assetDir: join(tmpdir(), 'c1-build-assets'), ...options, emit: (m: WorldDiffMessage | WorldBuildMessage) => emitted.push(m) });
  const token = god.mintFor({ id: 'owner', role: 'user' }, 'lead'), other = god.mintFor({ id: 'owner', role: 'user' }, 'helper');
  god.subscribe(0, e => events.push(e));
  const app = new Hono();
  mountGodRoutes(app, { god, worldName: 'Build test', requireUser: async c => { if (c.req.header('authorization') !== 'Bearer owner') throw new ApiError(401, 'unauthorized', 'sign in'); return { id: 'owner', role: 'user', email: null, wallet: null, created_at: 0, last_seen: 0, invited_by: null }; }, soulFromBearer: () => null, baseOf: () => 'http://127.0.0.1:5364', limitIp: () => {} });
  app.onError((e, c) => e instanceof ApiError ? c.json({ ok: false, code: e.code, ...e.extra }, e.status as 400) : c.json({ ok: false, internal: String(e) }, 500));
  const req = async (path: string, data?: unknown, auth: string | null = token, method?: string) => { const response = await app.request(path, { method: method ?? (data === undefined ? 'GET' : 'POST'), headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) }); return { status: response.status, headers: response.headers, data: await response.json() as any }; };
  const start = async (extra = {}) => (await req('/v1/god/builds', { id: 'church', title: 'Stone church', steps: ['shell', 'roof', 'interior'], site: { at: [0, 0], size: [80, 80] }, massing: [{ name: 'nave', at: [0, 0], size: [20, 10], h: 8, roof: 'gable' }], brief: 'god-only brief', ...extra })).data;
  const field = (lease: string, extra = {}): BuildField => ({ id: 'church', lease, ...extra });
  const place = (name: string, x = 0, z = 0) => ({ op: 'place', def: coreRef('bench'), name, p: [x, z] });
  return { db, god, app, token, other, emitted, events, req, start, field, place, setNow: (n: number) => { now = n; }, advance: (n: number) => { now += n; }, now: () => now };
}
const body = (f: ReturnType<typeof fixture>, id = 'church'): BuildBody => JSON.parse(f.god.store.build(id)!.body);
const code = (r: any) => r.failures?.[0]?.code;
const assertAccepted = (r: any) => assert.equal(r.accepted, true, JSON.stringify(r));

test('start/get/snapshot/status are bounded public projections and never leak identity or brief', async t => {
  const f = fixture(); t.after(() => f.db.close());
  assert.equal((await f.req('/v1/god/builds', undefined, null)).status, 401);
  const s = await f.start(); assert.equal(s.ok, true); assert.match(s.lease, /^l_[a-f0-9]{8}$/);
  assert.equal(s.build.plan.brief, 'god-only brief'); assert.equal(s.build.lead.lease, undefined); assert.equal(s.build.lead.tokenHash, undefined);
  const get = await f.req('/v1/god/builds/church'); assert.equal(get.data.build.id, 'church'); assert.deepEqual(get.data.journal, []);
  for (const path of ['/v1/world/builds', '/v1/world/snapshot']) {
    const r = await f.req(path, undefined, null); assert.equal(r.headers.get('cache-control'), 'no-store'); assert.equal(r.data.builds.length, 1);
    const p = r.data.builds[0]; for (const key of ['plan', 'brief', 'lead', 'agents', 'lease', 'startHash']) assert.equal(key in p, false, key);
    assert.equal(JSON.stringify(p).includes(s.lease), false); assert.equal(JSON.stringify(p).includes('god-only'), false);
  }
  assert.equal((await f.req('/v1/world/snapshot', undefined, null)).data.buildsRev, s.build.rev);
  assert.equal((await f.req('/v1/world/seq', undefined, null)).data.builds, s.build.rev);
  assert.equal((await f.req('/v1/god/status', undefined, 'owner')).data.builds[0].id, 'church');
  assert.equal((await f.req('/v1/god/status', undefined, null)).data.builds, undefined);
  assert.equal((await f.req('/v1/god/builds/missing')).status, 404);
  assert.equal((await f.start()).replayed, true);
  assert.equal(code((await f.req('/v1/god/builds', { id: 'church', title: 'Stone church', steps: ['shell', 'roof', 'interior'], site: { at: [0, 0], size: [80, 80] }, massing: [{ name: 'nave', at: [0, 0], size: [20, 10], h: 8, roof: 'gable' }], brief: 'god-only brief' }, f.other)).data), 'build.exists');
});

test('batch echo, rev and receipt share one commit; retry does not count again; delta and SSE stay small', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start();
  const request = { ops: Array.from({ length: 5 }, (_, i) => f.place(`bench-${i}`, i * 4)), build: f.field(s.lease, { step: 2, label: 'roof details' }), clientRef: 'five' };
  const r = (await f.req('/v1/god/act', request)).data; assertAccepted(r);
  const stored = f.god.store.build('church')!; assert.equal(r.build.rev, stored.rev); assert.equal(r.build.group, 'church'); assert.equal(f.god.store.edits()[0].grp, 'church');
  assert.equal(body(f).steps[0].batches, 1); assert.equal(body(f).step.n, 2);
  const replay = (await f.req('/v1/god/act', request)).data; assert.equal(replay.replayed, true); assert.deepEqual(replay.build, r.build); assert.equal(body(f).steps[0].batches, 1);
  assert.deepEqual(f.god.store.receipt('five')!.result, r);
  const diff = f.emitted.at(-1) as WorldDiffMessage; assert.equal(diff.kind, 'world-diff'); assert.equal(diff.builds![0].rev, stored.rev); assert.equal(diff.builds![0].rootsAdded!.length, 5); assert.ok(Buffer.byteLength(JSON.stringify(diff.builds)) <= 400);
  const event = f.events.at(-1)!.data as any; assert.equal(event.kind, 'step'); assert.equal(event.view, undefined);
  if (process.env.BUILD_EXPORT_FIXTURES === '1') { const dir = new URL('./fixtures/', import.meta.url); mkdirSync(dir, { recursive: true }); const started = f.emitted.find(m => m.kind === 'world-build')!; writeFileSync(new URL('build-messages.json', dir), JSON.stringify({ started, diff, revGap: [started, { ...diff, builds: diff.builds!.map(d => ({ ...d, rev: d.rev + 1 })) }] }, null, 2) + '\n'); }
});

test('preview seals build/group, checks lease and claim in preview and dryrun, and never mutates progress', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start(), build = f.field(s.lease), before = f.god.store.build('church');
  const p = (await f.req('/v1/god/preview', { ops: [f.place('pew')], build, group: 'interior' })).data; assert.equal(p.accepted, true);
  assert.equal((await f.req('/v1/god/dryrun', { ops: [f.place('dry')], build })).data.accepted, true);
  assert.deepEqual(f.god.store.build('church'), before);
  const bad = (await f.req('/v1/god/act', { preview: p.id, build: { ...build, step: 9 } })).data; assert.equal(code(bad), 'schema');
  const committed = (await f.req('/v1/god/act', { preview: p.id, clientRef: 'sealed' })).data; assertAccepted(committed); assert.equal(committed.build.group, 'church/interior');
  for (const path of ['preview', 'dryrun', 'act']) {
    assert.equal(code((await f.req(`/v1/god/${path}`, { ops: [f.place(`bad-${path}`, 10)], build: { id: 'church', lease: 'l_00000000' } })).data), 'build.lease');
    assert.equal(code((await f.req(`/v1/god/${path}`, { ops: [f.place(`claim-${path}`, 10)], build: { id: 'church', claim: 'c_00000000' } })).data), 'build.claim-unknown');
  }
});

test('group mapping, no-field reservation, unknown and closed refusals do not change world', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start();
  const r = (await f.req('/v1/god/act', { ops: [f.place('one')], group: 'interior', build: f.field(s.lease) })).data;
  assertAccepted(r); assert.equal(r.build.group, 'church/interior'); assert.match(r.warnings.join(), /mapped/);
  const r2 = (await f.req('/v1/god/act', { ops: [f.place('two', 4)], group: 'church/detail', build: f.field(s.lease) })).data; assertAccepted(r2); assert.equal(r2.build.group, 'church/detail');
  const seq = f.god.model.editSeq;
  assert.equal(code((await f.req('/v1/god/act', { ops: [f.place('illegal', 8)], group: 'church' })).data), 'build.group');
  assert.equal(code((await f.req('/v1/god/act', { ops: [f.place('unknown', 8)], build: { id: 'missing', lease: s.lease } })).data), 'build.unknown');
  await f.req('/v1/god/builds/church/done', {});
  assert.equal(code((await f.req('/v1/god/act', { ops: [f.place('closed', 8)], build: f.field(s.lease) })).data), 'build.closed'); assert.equal(f.god.model.editSeq, seq);
});

test('lazy pause emits once and current-lease batch resumes atomically', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start(); f.advance(51);
  const r = await f.req('/v1/world/builds', undefined, null); assert.equal(r.data.builds[0].status, 'paused');
  const n = f.emitted.length; await f.req('/v1/world/builds', undefined, null); assert.equal(f.emitted.length, n);
  // Direct method isolates the T2 resume from the HTTP lead touch (which also legitimately resumes).
  const r2 = f.god.act({ ops: [f.place('resumed')], build: f.field(s.lease) }); assertAccepted(r2);
  assert.equal(f.god.store.build('church')!.status, 'active'); assert.equal(body(f).pauses, 1);
  assert.equal((f.events.at(-1)!.data as any).kind, 'resumed'); assert.equal((f.emitted.at(-1) as WorldDiffMessage).builds![0].status, 'active');
});

test('any lead request touches at most four times per pause window, including reads and dryruns', async t => {
  const f = fixture(); t.after(() => f.db.close()); await f.start();
  for (let i = 1; i <= 10; i++) { f.advance(5); await f.req(i % 2 ? '/v1/god/snapshot' : '/v1/god/dryrun', i % 2 ? undefined : { ops: [f.place('dry')] }); }
  const alive = f.emitted.filter(m => m.kind === 'world-build' && m.event === 'alive'); assert.ok(alive.length <= 4 && alive.length > 0); assert.equal(f.god.store.build('church')!.status, 'active');
  f.advance(51); await f.req('/v1/god/snapshot'); assert.equal(f.god.store.build('church')!.status, 'active'); assert.equal(body(f).pauses, 1);
});

test('lease takeover and idempotent resume preserve current in-progress step and notes', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start();
  for (let i = 0; i < 2; i++) assertAccepted((await f.req('/v1/god/act', { ops: [f.place(`pew-${i}`, i * 4)], note: `roof ${i}`, build: f.field(s.lease, { step: 2 }) })).data);
  const leased = (await f.req('/v1/god/builds/church/resume', {}, f.other)).data; assert.equal(code(leased), 'build.leased'); assert.equal(leased.failures[0].measured.label, 'lead');
  const resumed = (await f.req('/v1/god/builds/church/resume', { take: true }, f.other)).data; assert.equal(resumed.ok, true); assert.notEqual(resumed.lease, s.lease); assert.equal(resumed.current.n, 2); assert.equal(resumed.current.batches, 2); assert.equal(resumed.current.recent.length, 2); assert.equal(resumed.next.n, 3);
  assert.equal(code((await f.req('/v1/god/act', { ops: [f.place('stale', 12)], build: f.field(s.lease) })).data), 'build.lease');
  const replay = (await f.req('/v1/god/builds/church/resume', {}, f.other)).data; assert.equal(replay.lease, resumed.lease); assert.equal(replay.replayed, true);
  const field = { id: 'church', lease: resumed.lease, step: 1, label: 'old label' };
  const r = (await f.req('/v1/god/act', { ops: [f.place('third', 12)], build: field }, f.other)).data; assertAccepted(r); assert.equal(r.build.step.n, 2); assert.equal(body(f).steps[0].batches, 3);
});

test('explicit pause permits a handoff; restart recovers leases and lazily persists pause', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'c1-restart-')), file = join(dir, 'sim.db'); const f = fixture({}, file); t.after(() => { f.db.close(); rmSync(dir, { recursive: true, force: true }); }); const s = await f.start();
  const p = (await f.req('/v1/god/builds/church/pause', { note: 'handoff' })).data; assert.equal(p.build.status, 'paused');
  assert.equal((await f.req('/v1/god/builds/church/pause', {})).data.replayed, true);
  const taken = (await f.req('/v1/god/builds/church/resume', {}, f.other)).data; assert.equal(taken.ok, true); assert.notEqual(taken.lease, s.lease);
  f.advance(51); const again = new GodMode(f.db, { worldId: 'build-test', ownerId: null, tick: () => 100, now: f.now, buildPauseMs: 50, emit: () => {} });
  const status = again.builds.status('church')!; assert.equal(status.build.status, 'paused');
  assertAccepted(again.act({ ops: [f.place('after-restart')], build: f.field(taken.lease) }));
});

test('done and final-batch done are idempotent, close atomically and reopen roots', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start();
  const r = (await f.req('/v1/god/act', { ops: [f.place('last')], build: f.field(s.lease, { done: true }), clientRef: 'finish' })).data; assertAccepted(r); assert.equal(r.build.status, 'done'); assert.equal(f.god.store.build('church')!.status, 'done'); assert.equal(f.god.builds.hasClosure(), false); assert.equal(f.god.builds.rootIndex.size, 0);
  assert.equal((await f.req('/v1/god/builds/church/done', {})).data.replayed, true);
  const r2 = await f.start({ id: 'other' }); assert.equal(r2.ok, true); assert.equal((await f.req('/v1/god/builds/other/done', { summary: 'complete' })).data.build.status, 'done');
});

test('abandon undo covers subgroups, stops on conflict, keeps site open and can retry', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start();
  for (let i = 0; i < 3; i++) assertAccepted((await f.req('/v1/god/act', { ops: [f.place(`bench-${i}`, i * 4)], build: f.field(s.lease), group: `part-${i}` })).data);
  let calls = 0; f.god.bodies = { uses: () => null, refuse: () => ++calls === 2 ? { op: -1, code: 'occupied.by-body', detail: 'seated' } : null };
  const partial = (await f.req('/v1/god/builds/church/abandon', { undo: true })).data; assert.equal(code(partial), 'build.undo-incomplete'); assert.equal(partial.reverted.length, 1); assert.equal(partial.notReverted.length, 2); assert.equal(f.god.store.build('church')!.status, 'active');
  f.god.bodies = null;
  const closed = (await f.req('/v1/god/builds/church/abandon', { undo: true })).data; assert.equal(closed.ok, true); assert.equal(closed.build.status, 'abandoned'); assert.equal(f.god.model.entities.size, 0);
  assert.equal((await f.req('/v1/god/builds/church/abandon', {})).data.replayed, true);
});

test('bounds, schema, massing containment and body SQL CHECK hold', async t => {
  const f = fixture(); t.after(() => f.db.close());
  assert.equal(code(await f.start({ id: 'Bad_ID' })), 'schema');
  assert.equal(code(await f.start({ steps: Array(25).fill('step') })), 'schema');
  assert.equal(code(await f.start({ massing: [{ at: [40, 0], size: [20, 20], h: 2 }] })), 'build.site');
  assert.equal(code(await f.start({ site: { at: [1001, 0], size: [10, 10] } })), 'build.site');
  const s = await f.start(); assert.equal(s.ok, true);
  assert.equal(code(f.god.builds.start({ id: 'overlap', title: 'Other', steps: ['a'], site: { at: [10, 10], size: [10, 10], yaw: .7 } }, f.god.godIdentity(f.token)!)), 'build.site');
  for (let i = 1; i < 8; i++) assert.equal(f.god.builds.start({ id: `b-${i}`, title: 'Other', steps: ['a'], site: { at: [i * 50 - 200, 100], size: [10, 10] } }, f.god.godIdentity(f.token)!).ok, true);
  assert.equal(code(f.god.builds.start({ id: 'ninth', title: 'Other', steps: ['a'], site: { at: [0, 200], size: [10, 10] } }, f.god.godIdentity(f.token)!)), 'build.limit');
  assert.throws(() => f.db.db.prepare('UPDATE god_builds_v1 SET body=? WHERE id=?').run(JSON.stringify({ text: 'x'.repeat(65536) }), 'church'), /CHECK/);
  const schema = (await f.req('/v1/god/schema')).data; assert.ok(schema.refusals.includes('build.lease')); assert.ok(schema.builds.field);
});

test('journal group collisions include subgroups and cannot be adopted by abandon', async t => {
  const f = fixture(); t.after(() => f.db.close());
  assertAccepted(f.god.act({ ops: [f.place('historic', -100)], group: 'church/old' }));
  assert.equal(code(await f.start()), 'build.exists');
  assert.equal((await f.start({ id: 'church-2' })).ok, true);
  await f.req('/v1/god/builds/church-2/abandon', { undo: true }); assert.ok(f.god.model.get('historic'));
});

test('roots from every diff: no-field additions, inverse symmetry, outside warnings and engine removals', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start();
  assertAccepted((await f.req('/v1/god/act', { ops: [f.place('x')], build: f.field(s.lease) })).data);
  const x = f.god.model.get('x')!.id;
  assertAccepted((await f.req('/v1/god/act', { ops: [{ op: 'remove', id: x }, f.place('y')], build: f.field(s.lease) })).data);
  const y = f.god.model.get('y')!.id; assert.deepEqual(body(f).roots, [y]);
  assertAccepted(f.god.undo()); assert.deepEqual(body(f).roots, [x]); assert.equal(f.god.builds.closing(x)?.id, 'church');
  assertAccepted(f.god.redo()); assert.deepEqual(body(f).roots, [y]);
  const noField = (await f.req('/v1/god/act', { ops: [f.place('raw', 8)] })).data; assertAccepted(noField); assert.ok(body(f).roots.includes(f.god.model.get('raw')!.id));
  assert.equal((f.emitted.at(-1) as WorldDiffMessage).builds!.length, 1);
  const outside = (await f.req('/v1/god/act', { ops: [f.place('outside', 100)], build: f.field(s.lease) })).data; assertAccepted(outside); assert.match(outside.warnings.join(), /outside site/); assert.ok(!body(f).roots.includes(f.god.model.get('outside')!.id));
  const touched = f.god.act({ ops: [{ op: 'move', id: y, p: [110, 0] }] }); assertAccepted(touched); if (touched.accepted) assert.match(touched.warnings.join(), /progress not recorded/); assert.ok(body(f).roots.includes(y));
  assertAccepted(f.god.engineAct([{ op: 'remove', id: y, cascade: false }], 'retire')); assert.ok(!body(f).roots.includes(y));
});

test('nested new subtree tops bind existing containers; bodies never become roots; root cap warns', async t => {
  const f = fixture(); t.after(() => f.db.close());
  assertAccepted(f.god.act({ ops: [{ op: 'define', def: { schema: 'def/1', name: 'district', size: { box: [1, 1, 1] }, layer: 'decor', make: { kind: 'gen', gen: 'kit/2', args: { shapes: [{ kind: 'box', at: [0, 0, 0], size: [1, 1, 1] }] } } } }, { op: 'place', def: 'district@1', name: 'district', p: [0, 0] }] }));
  const s = await f.start();
  assertAccepted(f.god.act({ ops: [{ ...f.place('nested'), in: { parent: 'district' } }], build: f.field(s.lease) })); assert.ok(body(f).roots.includes(f.god.model.get('district/nested')!.id));
  const b = body(f); b.roots = Array.from({ length: 256 }, (_, i) => `existing-${i}`); f.db.db.prepare('UPDATE god_builds_v1 SET body=? WHERE id=?').run(JSON.stringify(b), 'church');
  const again = new GodMode(f.db, { worldId: 'build-test', ownerId: 'owner', tick: () => 100, now: f.now, buildPauseMs: 50, emit: () => {} });
  const cap = again.act({ ops: [f.place('over-cap', 10)], build: f.field(s.lease) }); assertAccepted(cap); if (cap.accepted) assert.match(cap.warnings.join(), /one container/); assert.equal(JSON.parse(again.store.build('church')!.body).roots.length, 256);
});

test('rev increases beyond a closed highest row; stale build conflict is atomic; planning and refusals are pure', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start();
  const second = await f.start({ id: 'second', site: { at: [100, 0], size: [20, 20] }, massing: [] }); assert.equal(second.ok, true);
  const closed = (await f.req('/v1/god/builds/second/done', {})).data.build.rev;
  const r = (await f.req('/v1/god/act', { ops: [f.place('next')], build: f.field(s.lease) })).data; assertAccepted(r); assert.ok(r.build.rev > closed);
  const before = body(f), world = hashOf(f.god.model.snapshot()), original = f.god.store.commit.bind(f.god.store);
  f.god.store.commit = (...args) => { f.db.db.prepare('UPDATE god_builds_v1 SET rev=rev+1 WHERE id=?').run('church'); return original(...args); };
  const refused = (await f.req('/v1/god/act', { ops: [f.place('not-written', 12)], build: f.field(s.lease) })).data; assert.equal(code(refused), 'revision.stale'); assert.equal(refused.failures[0].field, 'build'); assert.equal(hashOf(f.god.model.snapshot()), world); assert.deepEqual(body(f), before); assert.equal(f.god.model.get('not-written'), undefined);
  assert.equal((await f.req('/v1/world/seq', undefined, null)).data.builds, f.god.store.buildsRev());
});

test('start limiter returns 429 retryAfterMs, no auth and bad JSON keep their HTTP errors', async t => {
  const f = fixture(); t.after(() => f.db.close());
  for (let i = 0; i < 6; i++) assert.equal((await f.start()).ok, true);
  const limited = await f.req('/v1/god/builds', {}); assert.equal(limited.status, 429); assert.ok(limited.data.retryAfterMs > 0);
  const unauthorized = await f.req('/v1/god/builds', {}, null); assert.equal(unauthorized.status, 401); assert.equal(unauthorized.headers.get('cache-control'), 'no-store');
  const bad = await f.req('/v1/god/builds/church/resume', {}, f.other); assert.equal(bad.status, 200);
});

test('compatible plain edit has no build echo or delta outside all sites', t => {
  const f = fixture(); t.after(() => f.db.close()); const r = f.god.act({ ops: [f.place('plain')] }) as any; assertAccepted(r); assert.equal(r.build, undefined); assert.equal((f.emitted.at(-1) as WorldDiffMessage).builds, undefined);
});

test('deferred claims seam: live held claims gate group, done and abandon; final edits are retained', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start(), b = body(f);
  b.claims.push({ id: 'c_00000001', part: 'tower', made: [], step: { n: 1, label: 'tower' }, status: 'held', lastAt: f.now(), holder: { label: 'private-holder', hash8: '12345678' }, user: { hash8: '12345678', tokenHash: 'private-token-hash' } });
  f.db.db.prepare('UPDATE god_builds_v1 SET body=? WHERE id=?').run(JSON.stringify(b), 'church');
  const god = new GodMode(f.db, { worldId: 'build-test', ownerId: 'owner', tick: () => 100, now: f.now, buildPauseMs: 50, emit: () => {} });
  assert.equal(code(god.act({ ops: [f.place('bad')], group: 'tower', build: f.field(s.lease) })), 'build.group');
  const r = god.act({ ops: [f.place('last')], build: f.field(s.lease, { done: true }) }) as any; assertAccepted(r); assert.equal(r.build.status, 'active'); assert.match(r.warnings.join(), /1 live claims \(tower\)/);
  const caller = god.godIdentity(f.token)!;
  assert.equal(code(god.builds.done('church', {}, caller)), 'build.claims-open');
  assert.equal(code(god.builds.abandon('church', {}, () => { throw Error('must not undo'); })), 'build.claims-open');
  const pub = JSON.stringify(god.publicSnapshot()); assert.ok(!pub.includes('private-holder')); assert.ok(!pub.includes('private-token-hash'));
  assert.equal(JSON.stringify(god.builds.status('church')).includes('private-token-hash'), false);
  assert.equal(god.builds.done('church', { force: true }, caller).ok, true);
});

test('SQL update sentinel rolls back entities, journal, receipt and cached build together', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start(), before = f.god.store.build('church'), seq = f.god.model.editSeq;
  f.db.db.exec("CREATE TRIGGER refuse_build_write BEFORE UPDATE ON god_builds_v1 BEGIN SELECT RAISE(IGNORE); END");
  const r = (await f.req('/v1/god/act', { ops: [f.place('rollback')], build: f.field(s.lease), clientRef: 'rollback' })).data;
  assert.equal(code(r), 'revision.stale'); assert.equal(f.god.model.editSeq, seq); assert.equal(f.god.model.entities.size, 0); assert.equal(f.god.store.load()!.model.entities.size, 0); assert.equal(f.god.store.receipt('rollback'), null); assert.deepEqual(f.god.store.build('church'), before);
});

test('late receipt refusal leaves progress, roots and world unchanged; current labels and unknown roots are validated', async t => {
  const f = fixture(); t.after(() => f.db.close());
  assert.equal(code(await f.start({ root: 'missing' })), 'entity.unknown');
  const s = await f.start(), original = f.god.finalizeAct, before = f.god.store.build('church');
  f.god.finalizeAct = result => { if (result.accepted) result.warnings.push('x'.repeat(GOD_EDIT_OUTCOME_BYTES)); return result; };
  const no = (await f.req('/v1/god/act', { ops: [f.place('not-committed')], build: f.field(s.lease), clientRef: 'too-large' })).data;
  assert.equal(code(no), 'request.budget'); assert.deepEqual(f.god.store.build('church'), before); assert.equal(f.god.model.entities.size, 0); assert.equal(f.god.store.receipt('too-large'), null);
  f.god.finalizeAct = original;
  const yes = (await f.req('/v1/god/act', { ops: [f.place('custom')], build: f.field(s.lease, { label: 'south wall' }) })).data;
  assertAccepted(yes); assert.equal(yes.build.step.label, 'south wall'); assert.equal(body(f).steps[0].label, 'south wall');
  const bad = await f.app.request('/v1/god/builds/church/pause', { method: 'POST', headers: { authorization: `Bearer ${f.token}`, 'content-type': 'application/json' }, body: '{' }); assert.equal(bad.status, 400);
});

test('one diff can update two sites with consecutive SQL revs and a receipt echo for its own build', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start();
  await f.start({ id: 'second', site: { at: [100, 0], size: [20, 20] }, massing: [] });
  const r = (await f.req('/v1/god/act', { ops: [f.place('own'), f.place('other', 100)], build: f.field(s.lease), clientRef: 'two-sites' })).data; assertAccepted(r);
  const m = f.emitted.at(-1) as WorldDiffMessage; assert.equal(m.builds!.length, 2); assert.equal(m.builds![1].rev, m.builds![0].rev + 1); assert.equal(r.build.rev, m.builds![0].rev);
  assert.equal(body(f).roots.length, 1); assert.equal(body(f, 'second').roots.length, 1); assert.equal(f.god.builds.rootIndex.size, 2);
  assert.deepEqual((f.god.store.receipt('two-sites')!.result as any).build, r.build);
});

test('closed retention prunes by rev and never loses the world revision high-water mark', t => {
  const f = fixture(); t.after(() => f.db.close()); const caller = f.god.godIdentity(f.token)!;
  for (let i = 0; i < 202; i++) { const id = `site-${i}`; const started = f.god.builds.start({ id, title: 'Retention', steps: ['a'], site: { at: [0, 0], size: [10, 10] } }, caller); assert.equal(started.ok, true); assert.equal(f.god.builds.done(id, {}, caller).ok, true); }
  assert.equal(f.god.store.builds().length, 200); assert.equal(f.god.store.build('site-0'), null); assert.equal(f.god.store.buildsRev(), 404);
  const next = f.god.builds.start({ id: 'next', title: 'Next', steps: ['a'], site: { at: [0, 0], size: [10, 10] } }, caller) as any; assert.equal(next.build.rev, 405);
});

test('bench: commitBatch 300 five-place batches with/without build plus 300 undos', { skip: process.env.BUILD_BENCH !== '1' }, t => {
  const summary: any = {};
  for (const withBuild of [false, true]) {
    const f = fixture({ buildPauseMs: 600_000 }); t.after(() => f.db.close());
    const started = withBuild ? f.god.builds.start({ id: 'church', title: 'Bench', steps: ['shell'], site: { at: [0, 0], size: [200, 200] } }, f.god.godIdentity(f.token)!) as any : null;
    const times: number[] = [], undo: number[] = [], receipt: number[] = [], deltas: number[] = [], sse: number[] = [], touch: number[] = [];
    for (let batch = 0; batch < (withBuild ? 500 : 300); batch++) {
      const ops = Array.from({ length: 5 }, (_, j) => { const i = batch * 5 + j; return f.place(`b-${i}`, -96 + i % 49 * 4, -96 + Math.floor(i / 49) * 4); });
      const begin = performance.now(), result = f.god.act({ ops, clientRef: `bench-${batch}`, ...(started ? { build: f.field(started.lease) } : {}) }); const elapsed = performance.now() - begin; assertAccepted(result);
      if (batch < 300) { times.push(elapsed); receipt.push(Buffer.byteLength(JSON.stringify(result))); const m = f.emitted.at(-1) as WorldDiffMessage; deltas.push(Buffer.byteLength(JSON.stringify(m.builds ?? []))); sse.push(Buffer.byteLength(JSON.stringify(f.events.at(-1)))); }
    }
    const ring500Bytes = withBuild ? Buffer.byteLength(JSON.stringify(f.events.slice(-500))) : undefined;
    const tokenHash = f.god.godIdentity(f.token)!.hash;
    if (withBuild) for (let i = 0; i < 10000; i++) { const begin = performance.now(); f.god.builds.touch(tokenHash); touch.push(performance.now() - begin); }
    if (withBuild) for (let i = 0; i < 300; i++) { const begin = performance.now(); assertAccepted(f.god.undo()); undo.push(performance.now() - begin); }
    const stats = (xs: number[]) => { const sorted = [...xs].sort((a, b) => a - b); return { p50: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.floor(sorted.length * .95)] }; };
    summary[withBuild ? 'build' : 'plain'] = { ms: stats(times), receiptBytes: stats(receipt), deltaBytes: stats(deltas), sseBytes: stats(sse), ...(undo.length ? { undoMs: stats(undo), ring500Bytes, touchMs: stats(touch) } : {}) };
  }
  console.log('BUILD_BENCH ' + JSON.stringify(summary));
});

// C1b adversarial-review regressions. Numbers match evidence/review-c1.json confirmed[].
test('C1b #1: undo/redo validate the lease but never advance steps, batches or done', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start();
  const build = f.field(s.lease, { step: 1 });
  assertAccepted(f.god.act({ ops: [f.place('one')], build }));
  const progress = body(f);
  for (const action of ['undo', 'redo', 'undo'] as const) {
    const result = (await f.req(`/v1/god/${action}`, { build: { ...build, step: 3, label: 'not built', done: true } })).data;
    assertAccepted(result); assert.equal(result.build.group, f.god.store.edits()[0].grp);
    const b = body(f); assert.deepEqual(b.step, progress.step); assert.deepEqual(b.steps, progress.steps);
    assert.equal(b.lastEditAt, progress.lastEditAt); assert.equal(b.done, undefined); assert.equal(f.god.store.build('church')!.status, 'active');
  }
  assert.equal(code((await f.req('/v1/god/redo', { build: { ...build, lease: 'l_00000000' } })).data), 'build.lease');
  assert.equal(code((await f.req('/v1/god/redo', { build: { id: 'church', claim: 'c_00000000' } })).data), 'build.claim-unknown');
});

test('C1b #2: receipt admission reserves the real SQL revision width and stays atomic', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start(), build = f.field(s.lease);
  for (let i = 0; i < 12; i++) assertAccepted(f.god.act({ ops: [f.place(`p${i}`, i * 4 - 30)], build }));
  let spare = 0;
  f.god.finalizeAct = r => {
    if (!r.accepted) return r;
    const echo = { id: 'church', status: 'active', rev: 0, group: 'church', step: { n: 1, label: 'shell' } };
    const base = Buffer.byteLength(JSON.stringify({ ...r, warnings: [...r.warnings, ''], build: echo }));
    r.warnings.push('x'.repeat(GOD_EDIT_OUTCOME_BYTES - base - spare)); return r;
  };
  const before = f.god.store.build('church'), seq = f.god.model.editSeq;
  const refused = f.god.act({ ops: [f.place('edge', 25)], build, clientRef: 'edge' }); assert.equal(code(refused), 'request.budget');
  assert.deepEqual(f.god.store.build('church'), before); assert.equal(f.god.model.editSeq, seq); assert.equal(f.god.store.receipt('edge'), null); assert.equal(f.god.model.get('edge'), undefined);
  spare = 15;
  const accepted: any = f.god.act({ ops: [f.place('safe', 25)], build, clientRef: 'safe' }); assertAccepted(accepted);
  assert.ok(accepted.build.rev >= 10); assert.ok(Buffer.byteLength(JSON.stringify(f.god.store.receipt('safe')!.result)) <= GOD_EDIT_OUTCOME_BYTES);
});

test('C1b #3: a lead group-only revert clears pause markers and emits the next closure lift', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start();
  assertAccepted(f.god.act({ ops: [f.place('one')], build: f.field(s.lease) }));
  f.advance(501); f.god.builds.sweep(); assert.ok(body(f).closureLiftedAt); assert.equal(f.god.builds.hasClosure(), false);
  const caller = f.god.godIdentity(f.token)!;
  assertAccepted(f.god.as({ identity: caller }, () => f.god.undo()));
  assert.equal(f.god.store.build('church')!.status, 'active'); assert.equal(body(f).paused, undefined); assert.equal(body(f).closureLiftedAt, undefined);
  assert.equal(f.god.builds.hasClosure(), true); f.advance(501); f.god.builds.sweep();
  const lifts = f.emitted.filter((m): m is WorldBuildMessage => m.kind === 'world-build' && m.event === 'closure-lifted'); assert.equal(lifts.length, 2);
  assert.ok(lifts[1].rev > lifts[0].rev); assert.equal(f.god.builds.publicList().builds[0].closed, false);
});

test('C1b #4: superseded leads cannot pause a live lease or enable an unrequested takeover', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start();
  const next = (await f.req('/v1/god/builds/church/resume', { take: true }, f.other)).data;
  const third = f.god.mintFor({ id: 'owner', role: 'user' }, 'third');
  for (const auth of [f.token, third]) {
    const result = (await f.req('/v1/god/builds/church/pause', { lease: s.lease, note: 'stale stop' }, auth)).data;
    assert.equal(code(result), 'build.lease'); assert.equal(f.god.store.build('church')!.status, 'active');
  }
  assert.equal(code((await f.req('/v1/god/builds/church/resume', {}, third)).data), 'build.leased');
  assertAccepted((await f.req('/v1/god/act', { ops: [f.place('still-lead')], build: f.field(next.lease) }, f.other)).data);
  assert.equal((await f.req('/v1/god/builds/church/pause', { lease: next.lease }, third)).data.ok, true, 'current lease authorizes a deliberate handoff');
  assert.equal((await f.req('/v1/god/builds/church/resume', {}, third)).data.ok, true);
});

test('C1b #5: non-lead field-less reverts and abandon undo never revive a quiet lead', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start();
  for (let i = 0; i < 2; i++) assertAccepted(f.god.act({ ops: [f.place(`part-${i}`, i * 4)], build: f.field(s.lease) }));
  f.advance(501); f.god.builds.sweep(); const before = f.god.store.build('church')!, lifted = body(f).closureLiftedAt;
  for (const action of ['undo', 'redo'] as const) {
    assertAccepted((await f.req(`/v1/god/${action}`, {}, f.other)).data);
    assert.equal(f.god.store.build('church')!.last_at, before.last_at); assert.equal(body(f).closureLiftedAt, lifted);
    assert.equal(f.god.builds.publicList().builds[0].closed, false);
  }
  let calls = 0; f.god.bodies = { uses: () => null, refuse: () => ++calls === 2 ? { op: -1, code: 'occupied.by-body', detail: 'busy' } : null };
  assert.equal(code((await f.req('/v1/god/builds/church/abandon', { undo: true }, f.other)).data), 'build.undo-incomplete');
  assert.equal(f.god.store.build('church')!.last_at, before.last_at); assert.equal(f.god.builds.hasClosure(), false);
  assert.equal((await f.req('/v1/god/builds/church/resume', {}, f.other)).data.ok, true);
});

test('C1b #6: HTTP resume emits once for a transition and replays only refresh alive', async t => {
  const f = fixture(); t.after(() => f.db.close()); await f.start(); f.advance(51);
  const resumed = () => f.emitted.filter(m => m.kind === 'world-build' && m.event === 'resumed').length;
  const first = (await f.req('/v1/god/builds/church/resume', {})).data; assert.equal(first.ok, true); assert.equal(resumed(), 1); assert.equal(body(f).pauses, 1);
  const rev = f.god.store.build('church')!.rev;
  assert.equal((await f.req('/v1/god/builds/church/resume', {})).data.replayed, true); assert.equal(resumed(), 1); assert.equal(f.god.store.build('church')!.rev, rev);
  f.advance(1); assert.equal((await f.req('/v1/god/builds/church/resume', {})).data.ok, true); assert.equal(resumed(), 1); assert.equal(body(f).pauses, 1);
  assert.equal((f.emitted.at(-1) as WorldBuildMessage).event, 'alive');
});

test('C1b #7: reverts of unrelated, ungrouped and grouped edits report the actual journal group', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start(), build = f.field(s.lease, { step: 9, done: true });
  assertAccepted(f.god.act({ ops: [f.place('tracked')], build: f.field(s.lease) })); const before = body(f);
  for (const group of ['misc', undefined]) {
    assertAccepted(f.god.act({ ops: [f.place(group ?? 'ungrouped', group ? 100 : 110)], ...(group ? { group } : {}) }));
    for (const action of ['undo', 'redo'] as const) {
      const result = (await f.req(`/v1/god/${action}`, { build })).data; assertAccepted(result);
      assert.equal(result.build.group, group); assert.equal(f.god.store.edits()[0].grp, group ?? null); assert.ok(!result.warnings.some((w: string) => /mapped/.test(w)));
      assert.deepEqual(body(f).steps, before.steps); assert.deepEqual(body(f).step, before.step); assert.equal(body(f).done, undefined);
    }
  }
  const undone = f.god.as({ identity: f.god.godIdentity(f.token)!, build }, () => f.god.undoGroup('church')); assert.equal(undone.accepted, true);
  assert.deepEqual(body(f).steps, before.steps); assert.equal(f.god.store.build('church')!.status, 'active');
});

test('C1b #8: identical start replay refuses both done and abandoned records', async t => {
  for (const close of ['done', 'abandon']) {
    const f = fixture(); t.after(() => f.db.close()); await f.start(); await f.req(`/v1/god/builds/church/${close}`, {});
    const replay = await f.start(); assert.equal(replay.ok, false); assert.equal(code(replay), 'build.closed'); assert.equal(replay.lease, undefined);
  }
});

test('C1b #13: every build body write is bounded, leaves transition space and cannot wedge public sweeps', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const hugeStart = f.god.builds.start({ id: 'huge', title: 'Huge', steps: ['a'], site: { at: [100, 0], size: [10, 10] } }, { hash: 'a'.repeat(64), label: 'x'.repeat(65_536) });
  assert.equal(code(hugeStart), 'build.limit'); assert.equal(f.god.store.build('huge'), null);
  const s = await f.start(), row = f.god.store.build('church')!;
  const seed = (bytes: number) => {
    const b = body(f); b.plan.brief = ''; b.plan.brief = 'x'.repeat(bytes - Buffer.byteLength(JSON.stringify(b)));
    const encoded = JSON.stringify(b); assert.equal(Buffer.byteLength(encoded), bytes);
    f.db.db.prepare('UPDATE god_builds_v1 SET body=? WHERE world_id=? AND id=?').run(encoded, f.god.store.worldId, 'church');
    (f.god.builds as any).rows.get('church').body = b;
  };
  seed(65_250);
  for (const [action, data] of [['pause', { note: 'x'.repeat(1000) }], ['done', { summary: 'x'.repeat(1000) }]] as const) {
    const out = await f.req(`/v1/god/builds/church/${action}`, data); assert.equal(out.status, 200); assert.equal(code(out.data), 'build.limit');
    assert.equal(out.data.failures[0].field, 'build'); assert.ok(out.data.failures[0].measured > out.data.failures[0].limit);
  }
  const before = f.god.store.build('church');
  const act = (await f.req('/v1/god/act', { ops: [f.place('overflow')], build: f.field(s.lease, { step: 2, label: '\u0001'.repeat(60) }), clientRef: 'overflow' })).data;
  assert.equal(code(act), 'build.limit'); assert.deepEqual(f.god.store.build('church'), before); assert.equal(f.god.model.get('overflow'), undefined); assert.equal(f.god.store.receipt('overflow'), null);
  // Store-level defenses cover direct saves and a caller bypassing the planner's size guard.
  const write = { id: 'church', expectRev: row.rev, status: row.status, lastAt: row.last_at, body: JSON.stringify({ padding: 'x'.repeat(65_536) }) };
  assert.equal(code(f.god.store.saveBuild(write)), 'build.limit');
  assert.equal(code(f.god.store.saveBuild({ ...write, body: '{' })), 'build.limit', 'SQLite CHECK fallback is a refusal');
  assert.equal(code(f.god.store.insertBuild('invalid', f.now(), '{')), 'build.limit');
  seed(60_000); const writes = f.god.builds.writes.bind(f.god.builds);
  for (const encoded of [write.body, '{']) {
    f.god.builds.writes = (...args) => { const planned = writes(...args); for (const w of planned.writes) w.body = encoded; return planned; };
    assert.equal(code(f.god.act({ ops: [f.place('store-overflow')], build: f.field(s.lease) })), 'build.limit');
    assert.equal(f.god.model.get('store-overflow'), undefined);
  }
  f.god.builds.writes = writes;
  // Simulate a pre-fix durable row without reserved space. It cannot prevent other rows transitioning.
  seed(65_530); const other = await f.start({ id: 'other', site: { at: [100, 0], size: [10, 10] }, massing: [] }); assert.equal(other.ok, true);
  f.advance(501);
  for (const path of ['/v1/world/snapshot', '/v1/world/builds', '/v1/world/seq']) { const out = await f.req(path, undefined, null); assert.equal(out.status, 200, path); }
  assert.ok(JSON.parse(f.god.store.build('other')!.body).closureLiftedAt);
  assert.ok(f.god.store.build('church')!.body.length <= 65_536);
  // A healthy row near the admission bound has enough room for both persisted lazy markers.
  seed(65_260); f.god.builds.sweep(); assert.equal(f.god.store.build('church')!.status, 'paused'); assert.ok(body(f).closureLiftedAt);
});

function journalReads(f: ReturnType<typeof fixture>, work: () => void) {
  const db = f.db.db as any, prepare = db.prepare.bind(db), reads: { sql: string; args: any[] }[] = [];
  db.prepare = (sql: string) => new Proxy(prepare(sql), { get(target, key) {
    const value = Reflect.get(target, key); if (typeof value !== 'function') return value;
    return (...args: any[]) => { if ((key === 'all' || key === 'get') && /^SELECT/.test(sql) && sql.includes('world_edits_v1')) reads.push({ sql, args }); return value.apply(target, args); };
  } });
  try { work(); } finally { db.prepare = prepare; }
  return reads;
}
function indexedReads(f: ReturnType<typeof fixture>, reads: ReturnType<typeof journalReads>, index: string) {
  assert.ok(reads.length > 0);
  for (const q of reads) {
    const plan = f.db.db.prepare('EXPLAIN QUERY PLAN ' + q.sql).all(...q.args) as { detail: string }[];
    assert.ok(plan.some(p => p.detail.includes(index)), JSON.stringify(plan));
    assert.ok(!plan.some(p => /SCAN world_edits_v1/.test(p.detail)), JSON.stringify(plan));
  }
}

test('C1b #14: group views use index seeks and small projections; status reads its journal once', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start();
  assertAccepted(f.god.act({ ops: [f.place('one')], build: f.field(s.lease), note: 'first' }));
  const insert = f.db.db.prepare("INSERT INTO world_edits_v1(world_id,seq,by,at,note,grp,ops,inverse,kind) VALUES(?,?,'god',0,?,?,?,?,'engine')");
  f.db.db.exec('BEGIN'); for (let i = 2; i <= 1000; i++) insert.run(f.god.store.worldId, i, 'noise', i < 250 ? 'church/interior' : 'church-neighbour', '[]', 'not parsed'); f.db.db.exec('COMMIT');
  f.db.db.prepare("UPDATE world_edits_v1 SET inverse='not parsed' WHERE world_id=? AND seq=1").run(f.god.store.worldId);
  f.god.store.groupEditsUnder = () => { throw Error('views must not parse complete edit/inverse rows'); };
  let view: any;
  const list = journalReads(f, () => { view = f.god.builds.list().open[0]; }); indexedReads(f, list, 'world_edits_v1_grp_seq');
  assert.equal(view.current.recent[0].note, 'first'); assert.ok(list.every(q => !/\bops\b|\binverse\b/.test(q.sql)));
  let status: any;
  const reads = journalReads(f, () => { status = f.god.builds.status('church'); }); indexedReads(f, reads, 'world_edits_v1_grp_seq'); assert.equal(reads.length, 1);
  assert.equal(status.journal.length, 200); assert.ok(status.journal.every((e: any) => e.grp.startsWith('church/'))); assert.equal(status.build.current.recent[0].seq, 1, 'current notes survive >200 newer undo/engine rows');
  assert.ok(!/\binverse\b/.test(reads[0].sql)); assert.deepEqual(status.journal[0].ops, { count: 0, kinds: [] });
  const range = journalReads(f, () => { f.god.store.buildRecent('church', 1, 1000); f.god.store.hasGroupUnder('missing'); }); indexedReads(f, range, 'world_edits_v1_grp_seq');
});

test('C1b #15: touch and sweep skip unused views; route transitions share one view and massing one point pass', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const builds = f.god.builds as any, view = builds.view.bind(builds); let views = 0;
  builds.view = (...args: any[]) => { views++; return view(...args); };
  const s = await f.start({ massing: Array.from({ length: 8 }, (_, i) => ({ name: `m${i}`, at: [0, 0], size: [20, 20], h: 4 })) }); assert.equal(views, 1);
  assertAccepted(f.god.act({ ops: [f.place('one')], build: f.field(s.lease) })); views = 0;
  f.advance(14); f.god.builds.touch(f.god.godIdentity(f.token)!.hash); assert.equal(views, 0, 'alive write discards no view');
  f.advance(501); f.god.builds.sweep(); assert.equal(views, 0, 'pause and closure lift discard no view');
  const model = f.god.model, footprints = model.footprintsOf.bind(model); let points = 0;
  model.footprintsOf = (...args) => { points++; return footprints(...args); };
  const resumed = f.god.builds.resume('church', {}, f.god.godIdentity(f.token)!); assert.equal(resumed.ok, true); assert.equal(views, 1); assert.equal(points, 1);
  assert.ok(resumed.ok && resumed.build.massing.every(m => m.parts === 1));
});

test('C1b #16: untracked root warnings use the root index for changed ids and ancestors once per build', async t => {
  const f = fixture(); t.after(() => f.db.close()); const s = await f.start();
  assertAccepted(f.god.act({ ops: [f.place('root'), { ...f.place('child'), in: { parent: 'root' }, p: [0, 0] }], build: f.field(s.lease) }));
  const row = (f.god.builds as any).rows.get('church'); row.body.roots.includes = () => { throw Error('linear root lookup'); };
  const index = f.god.builds.rootIndex, get = index.get.bind(index); let lookups = 0;
  index.get = id => { lookups++; return get(id); };
  const result = f.god.act({ ops: [{ op: 'set', id: 'root/child', name: 'renamed' }] }); assertAccepted(result);
  assert.equal(result.accepted && result.warnings.filter(w => w.includes('progress not recorded')).length, 1);
  assert.ok(lookups <= 4, `bounded ancestor lookups: ${lookups}`);
});

test('C1b #17: empty and mixed undo stacks seek the partial index instead of scanning history', t => {
  const f = fixture(); t.after(() => f.db.close());
  const insert = f.db.db.prepare("INSERT INTO world_edits_v1(world_id,seq,by,at,grp,ops,inverse,undone,kind) VALUES(?,?,'god',0,'noise','[]','[]',?,?)");
  f.db.db.exec('BEGIN'); for (let i = 1; i <= 2000; i++) insert.run(f.god.store.worldId, i, 1, i % 3 ? 'edit' : 'undo'); insert.run(f.god.store.worldId, 2001, 0, 'engine'); f.db.db.exec('COMMIT');
  let reads = journalReads(f, () => { assert.equal(f.god.store.undoable(), null); assert.equal(f.god.store.redoable(), null); }); indexedReads(f, reads, 'world_edits_v1_stack');
  for (const [seq, kind] of [[2002, 'edit'], [2003, 'redo'], [2004, 'undo']] as const) insert.run(f.god.store.worldId, seq, 0, kind);
  assert.equal(f.god.store.undoable()!.seq, 2003); assert.equal(f.god.store.redoable()!.seq, 2004);
  const clear = "UPDATE world_edits_v1 INDEXED BY world_edits_v1_stack SET undone=1 WHERE world_id=? AND kind='undo' AND undone=0";
  const plan = f.db.db.prepare('EXPLAIN QUERY PLAN ' + clear).all(f.god.store.worldId) as { detail: string }[]; assert.ok(plan.some(p => p.detail.includes('world_edits_v1_stack')));
  f.db.db.prepare(clear).run(f.god.store.worldId); assert.equal(f.god.store.redoable(), null);
  f.db.db.prepare("UPDATE world_edits_v1 SET undone=1 WHERE world_id=? AND kind IN ('edit','redo')").run(f.god.store.worldId);
  reads = journalReads(f, () => { assert.equal(f.god.store.undoable(), null); }); indexedReads(f, reads, 'world_edits_v1_stack');
});

test('bench: 300 five-place build commits with two live claims versus none; 200-upsert check', { skip: process.env.CLAIM_BENCH !== '1' }, t => {
  const summary: any = {};
  const stats = (xs: number[]) => { const sorted = [...xs].sort((a, b) => a - b); return { p50: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.floor(sorted.length * .95)] }; };
  const fixtures = [false, true].map(withClaims => {
    const f = fixture({ buildPauseMs: 600_000 }); t.after(() => f.db.close());
    const started = f.god.builds.start({ id: 'church', title: 'Claims bench', steps: ['shell'], site: { at: [0, 0], size: [200, 200] } }, f.god.godIdentity(f.token)!) as any;
    const build = f.field(started.lease);
    assertAccepted(f.god.act({ ops: [f.place('east-anchor', -80, 90), f.place('tower-anchor', 80, 90)], build }));
    if (withClaims) for (const [part, root] of [['east-aisle', 'east-anchor'], ['tower', 'tower-anchor']]) assert.equal(f.god.builds.claim('church', { part, root }, f.god.godIdentity(f.other)!).ok, true);
    return { f, build, times: [] as number[], withClaims };
  });
  // Interleave the two worlds so warmup, thermal drift and scheduler noise affect both modes.
  for (let batch = 0; batch < 300; batch++) for (const { f, build, times } of batch % 2 ? [...fixtures].reverse() : fixtures) {
    const ops = Array.from({ length: 5 }, (_, j) => { const i = batch * 5 + j; return f.place(`c-${i}`, -96 + i % 49 * 4, -96 + Math.floor(i / 49) * 4); });
    const begin = performance.now(), r = f.god.act({ ops, build, clientRef: `claims-bench-${batch}` }); times.push(performance.now() - begin); assertAccepted(r);
  }
  for (const { f, build, times, withClaims } of fixtures) {
    const before = f.god.model, after = before.fork();
    const upserts = Array.from(before.entities.values()).slice(2, 202).map(e => ({ ...e, v: e.v + 1 }));
    for (const e of upserts) { after.delete(e.id); after.insert(e); }
    const diff = { upserts, removes: [], defs: [], tiles: [], answers: [] }, admission = f.god.builds.admit(build, {}, f.god.godIdentity(f.token)!);
    const checks: number[] = [];
    for (let i = 0; i < 1000; i++) { const begin = performance.now(), r = f.god.builds.check(admission, before, after, diff, []); checks.push(performance.now() - begin); assert.ok('made' in r); }
    summary[withClaims ? 'twoLiveClaims' : 'none'] = { commitMs: stats(times), check200Ms: stats(checks), diff: upserts.length };
  }
  summary.overheadMs = { p50: summary.twoLiveClaims.commitMs.p50 - summary.none.commitMs.p50, p95: summary.twoLiveClaims.commitMs.p95 - summary.none.commitMs.p95 };
  console.log('CLAIM_BENCH ' + JSON.stringify(summary));
  assert.ok(summary.overheadMs.p95 <= 1, `claims p95 overhead ${summary.overheadMs.p95}ms exceeds 1ms`);
  assert.ok(summary.twoLiveClaims.check200Ms.p95 - summary.none.check200Ms.p95 <= 1);
});
