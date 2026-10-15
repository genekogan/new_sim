import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Hono } from 'hono';
import { Db } from '../db.ts';
import { ApiError } from '../souls.ts';
import { GodMode, type WorldDiffMessage, type WorldBuildMessage } from './god.ts';
import { mountGodRoutes } from './routes.ts';
import { type BuildBody, type BuildField } from './builds.ts';
import { godSchema } from './schema.ts';

// Decor keeps these tests about ownership rather than incidental support/collision rules.
const partDef = { schema: 'def/1', name: 'part', size: { box: [1, 1, 1] }, layer: 'decor', make: { kind: 'gen', gen: 'kit/2', args: { shapes: [{ kind: 'box', at: [0, 0, 0], size: [1, 1, 1] }] } } };
const place = (name: string, x = 0, z = 0, parent = 'world') => ({ op: 'place', def: 'part@1', name, p: [x, z], in: { parent } });
const code = (r: any) => r.failures?.[0]?.code;
const accepted = (r: any) => assert.equal(r.accepted, true, JSON.stringify(r));
function fixture() {
  const db = new Db(':memory:'), emitted: (WorldDiffMessage | WorldBuildMessage)[] = []; let now = 1000;
  const god = new GodMode(db, { worldId: 'claims', ownerId: 'owner', tick: () => 0, now: () => now, buildPauseMs: 50, assetDir: join(tmpdir(), 'c3-assets'), emit: (m: WorldDiffMessage | WorldBuildMessage) => emitted.push(m) });
  const tokens = ['lead', 'east', 'tower', 'third'].map(label => god.mintFor({ id: 'owner', role: 'user' }, label));
  const identities = tokens.map(token => god.godIdentity(token)!);
  accepted(god.act({ ops: [{ op: 'define', def: partDef }] }));
  const app = new Hono(); mountGodRoutes(app, { god, worldName: 'Claims', requireUser: async () => { throw new ApiError(401, 'unauthorized', 'owner only'); }, soulFromBearer: () => null, baseOf: () => 'http://127.0.0.1:5364', limitIp: () => {} });
  app.onError((e, c) => e instanceof ApiError ? c.json({ ok: false, code: e.code, ...e.extra }, e.status as 400) : c.json({ internal: String(e) }, 500));
  const req = async (path: string, data?: unknown, who = 0) => { const r = await app.request(path, { method: data === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${tokens[who]}`, 'content-type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) }); assert.equal(r.status, 200, await r.clone().text()); assert.equal(r.headers.get('cache-control'), 'no-store'); return await r.json() as any; };
  const started = god.builds.start({ id: 'church', title: 'Church', steps: ['shell', 'roof', 'detail'], site: { at: [0, 0], size: [200, 200] } }, identities[0]) as any; assert.equal(started.ok, true);
  const lead: BuildField = { id: 'church', lease: started.lease };
  accepted(god.act({ ops: [place('shell')], build: lead }));
  accepted(god.act({ ops: [place('east', 10, 0, 'shell'), place('west', -10, 0, 'shell'), place('outside', 40, 40)], build: lead }));
  const body = (): BuildBody => JSON.parse(god.store.build('church')!.body);
  const claim = (raw: unknown, who = 1) => req('/v1/god/builds/church/claims', raw, who);
  const field = (cid: string, extra = {}): BuildField => ({ id: 'church', claim: cid, ...extra });
  const act = (ops: unknown[], build?: BuildField, who = 0, extra = {}) => req('/v1/god/act', { ops, ...(build ? { build } : {}), ...extra }, who);
  return { db, god, req, body, claim, field, act, lead, emitted, identities, now: () => now, advance: (ms: number) => { now += ms; } };
}

test('§9.3.1 root scopes, mapped group, claim progress and receipt replay', async t => {
  const f = fixture(); t.after(() => f.db.close()); const c = await f.claim({ part: 'east-aisle', root: 'shell/east' }); assert.equal(c.ok, true); assert.match(c.claim.id, /^c_[0-9a-f]{8}$/);
  const leadStep = f.body().step;
  const input = { ops: [place('carving', 1, 0, 'shell/east')], build: f.field(c.claim.id, { step: 2, label: 'east roof' }), group: 'ignored', clientRef: 'east-one' };
  const r = await f.req('/v1/god/act', input, 1); accepted(r); assert.equal(r.build.group, 'church/east-aisle'); assert.equal(r.build.claim, c.claim.id); assert.deepEqual(r.build.step, { n: 2, label: 'east roof' }); assert.match(r.warnings.join(), /ignored/);
  assert.deepEqual(f.body().step, leadStep); assert.equal(f.body().steps.at(-1)!.claim, c.claim.id);
  const replay = await f.req('/v1/god/act', input, 1); assert.equal(replay.replayed, true); assert.deepEqual(replay.build, r.build); assert.equal(f.body().steps.at(-1)!.batches, 1);
  const no = await f.act([{ op: 'set', id: 'shell/west', name: 'stolen' }], f.field(c.claim.id), 1); assert.equal(code(no), 'build.claim'); assert.ok(no.failures[0].entity); assert.ok(no.failures[0].field); assert.ok(no.failures[0].fix);
});

test('§9.3.2 region owns committed new tops and descendants, caps made at 64', async t => {
  const f = fixture(); t.after(() => f.db.close()); const c = await f.claim({ part: 'tower', region: { at: [60, 0], size: [40, 40] } }, 2), b = f.field(c.claim.id);
  const r = await f.act([place('tower', 60)], b, 2); accepted(r); const id = f.god.model.get('tower')!.id; assert.deepEqual(f.body().claims[0].made, [id]);
  accepted(await f.act([{ op: 'set', id, name: 'tower-new' }, place('spire', 0, 0, id)], b, 2)); assert.equal(f.body().claims[0].made.length, 1);
  assert.equal(code(await f.act([place('too-far', 0)], b, 2)), 'build.claim');
  accepted(await f.act(Array.from({ length: 63 }, (_, i) => place(`p-${i}`, 50 + i % 8, -10 + Math.floor(i / 8))), b, 2)); assert.equal(f.body().claims[0].made.length, 64);
  const before = f.god.store.build('church'); assert.equal(code(await f.act([place('sixty-five', 60, 10)], b, 2)), 'build.limit'); assert.deepEqual(f.god.store.build('church'), before);
});

test('§9.3.3–5 and 12 lead/no-field protection, before/after reparenting and stale scopes', async t => {
  const f = fixture(); t.after(() => f.db.close()); const c = await f.claim({ part: 'east', root: 'shell/east' });
  accepted(await f.act([place('child', 0, 0, 'shell/east')], f.field(c.claim.id), 1));
  for (const build of [undefined, f.lead]) {
    assert.equal(code(await f.act([{ op: 'move', id: 'shell/east/child', in: { parent: 'shell/west' }, p: [0, 0] }], build)), 'build.claimed');
    assert.equal(code(await f.act([{ op: 'set', id: 'shell/east/child', name: 'intruder' }], build)), 'build.claimed');
  }
  assert.equal(code(await f.act([{ op: 'move', id: 'outside', in: { parent: 'shell/east' }, p: [0, 0] }], f.field(c.claim.id), 1)), 'build.claim');
  assert.equal(code(await f.act([{ op: 'move', id: 'shell/east/child', in: { parent: 'shell/west' }, p: [0, 0] }], f.field(c.claim.id), 1)), 'build.claim');
  await f.claim({ part: 'tower', region: { at: [60, 0], size: [30, 30] } }, 2);
  for (const build of [undefined, f.lead]) assert.equal(code(await f.act([place('squat', 60)], build)), 'build.claimed');
  f.advance(51);
  accepted(await f.act([{ op: 'set', id: 'shell/east/child', name: 'lead-now' }], f.lead));
  accepted(await f.act([place('quiet-region', 60)], f.lead));
});

test('§9.3.6 preview/dryrun/late SQL refusal preserve made, scope, counters and receipt', async t => {
  const f = fixture(); t.after(() => f.db.close()); const c = await f.claim({ part: 'tower', region: { at: [60, 0], size: [20, 20] } }, 2), build = f.field(c.claim.id);
  const before = f.god.store.build('church'), ops = [place('planned', 60)];
  const preview = await f.req('/v1/god/preview', { ops, build }, 2); accepted(preview);
  accepted(await f.req('/v1/god/dryrun', { ops, build }, 2)); assert.deepEqual(f.god.store.build('church'), before); assert.deepEqual(f.body().claims[0].made, []);
  assert.equal(code(await f.req('/v1/god/act', { preview: preview.id, build: { ...build, step: 9 } }, 2)), 'schema');
  f.db.db.exec('CREATE TRIGGER refuse_build BEFORE UPDATE ON god_builds_v1 BEGIN SELECT RAISE(IGNORE); END');
  assert.equal(code(await f.req('/v1/god/act', { preview: preview.id, clientRef: 'stale-plan' }, 2)), 'revision.stale');
  assert.deepEqual(f.god.store.build('church'), before); assert.equal(f.god.model.get('planned'), undefined); assert.equal(f.god.store.receipt('stale-plan'), null);
  assert.equal(code(await f.act([place('lead-squat', 60)], f.lead)), 'build.claimed');
  f.db.db.exec('DROP TRIGGER refuse_build');
  accepted(await f.req('/v1/god/act', { preview: preview.id, clientRef: 'retry-plan' }, 2)); assert.equal(f.body().claims[0].made.length, 1);
});

test('§9.3.7 world, terrain and expand edits are lead-only in act, preview and dryrun', async t => {
  const f = fixture(); t.after(() => f.db.close()); const c = await f.claim({ part: 'east', root: 'shell/east' });
  for (const ops of [[{ op: 'world', state: { constitution: 'Changed' } }], [{ op: 'place', def: 'core/brush@1', p: [200, 200], params: { op: 'raise', radius: 3, amount: 1 } }], [{ op: 'expand', extent: 1200 }]]) {
    for (const path of ['act', 'preview', 'dryrun']) assert.equal(code(await f.req(`/v1/god/${path}`, { ops, build: f.field(c.claim.id) }, 1)), 'build.claim', JSON.stringify(ops));
  }
});

test('§9.3.8 plain lead undo/redo cannot borrow target claim; own group undo checks every revert', async t => {
  const f = fixture(); t.after(() => f.db.close()); const c = await f.claim({ part: 'east-aisle', root: 'shell/east' }), build = f.field(c.claim.id);
  for (const name of ['a', 'b']) accepted(await f.act([place(name, 0, 0, 'shell/east')], build, 1));
  for (const context of [{}, { build: f.lead }]) assert.equal(code(await f.req('/v1/god/undo', context)), 'build.claimed');
  const before = f.body();
  const own = await f.req('/v1/god/undo?group=church/east-aisle', { build: { ...build, step: 9, done: true } }, 1); accepted(own); assert.equal(own.reverted.length, 2);
  assert.deepEqual(f.body().steps, before.steps); assert.deepEqual(f.body().claims[0].step, before.claims[0].step); assert.equal(f.body().claims[0].status, 'held');
  assert.equal(code(await f.req('/v1/god/redo', {})), 'build.claimed');
  accepted(await f.req('/v1/god/redo', { build }, 1));
  assert.equal(code(await f.req('/v1/god/undo?group=church/east-aisle', {})), 'build.claimed');
});

test('§9.3.9 done:true keeps lead edit, claim done releases only itself, force done closes', async t => {
  const f = fixture(); t.after(() => f.db.close()); const c = await f.claim({ part: 'east', root: 'shell/east' });
  const r = await f.act([place('final-lead', -50)], { ...f.lead, done: true }); accepted(r); assert.equal(r.build.status, 'active'); assert.match(r.warnings.join(), /1 live claims \(east\)/);
  for (const action of ['done', 'abandon']) assert.equal(code(await f.req(`/v1/god/builds/church/${action}`, {})), 'build.claims-open');
  const done = await f.act([place('final-east', 0, 0, 'shell/east')], f.field(c.claim.id, { done: true }), 1); accepted(done); assert.equal(done.build.status, 'active'); assert.equal(f.body().claims[0].status, 'done');
  await f.claim({ part: 'west', root: 'shell/west' }, 2);
  assert.equal((await f.req('/v1/god/builds/church/done', { force: true })).build.status, 'done'); assert.ok(f.body().claims.every(c => c.status !== 'held'));
});

test('force abandon releases claims before undo and retains failures as an open build', async t => {
  const f = fixture(); t.after(() => f.db.close()); const c = await f.claim({ part: 'east', root: 'shell/east' }); accepted(await f.act([place('child', 0, 0, 'shell/east')], f.field(c.claim.id), 1));
  let calls = 0; f.god.bodies = { uses: () => null, refuse: () => ++calls === 2 ? { op: -1, code: 'occupied.by-body', detail: 'busy' } : null };
  const r = await f.req('/v1/god/builds/church/abandon', { force: true, undo: true }); assert.equal(code(r), 'build.undo-incomplete'); assert.equal(r.reverted.length, 1); assert.equal(f.body().claims[0].status, 'released'); assert.equal(f.god.store.build('church')!.status, 'active');
  f.god.bodies = null;
  assert.equal((await f.req('/v1/god/builds/church/abandon', { force: true, undo: true })).build.status, 'abandoned'); assert.equal(f.god.model.entities.size, 0);
});

test('§9.3.10 root ancestor/descendant, region and root-region intersections refuse at claim time', async t => {
  const f = fixture(); t.after(() => f.db.close()); const c = await f.claim({ part: 'east', root: 'shell/east' });
  for (const input of [{ part: 'ancestor', root: 'shell' }, { part: 'same', root: 'shell/east' }, { part: 'area', region: { at: [10, 0], size: [10, 10] } }]) assert.equal(code(await f.claim(input, 2)), 'build.claimed');
  accepted(await f.act([place('child', 0, 0, 'shell/east')], f.field(c.claim.id), 1));
  assert.equal(code(await f.claim({ part: 'child', root: 'shell/east/child' }, 2)), 'build.claimed');
  await f.claim({ part: 'tower', region: { at: [60, 0], size: [20, 20], yaw: .3 } }, 2);
  assert.equal(code(await f.claim({ part: 'overlap', region: { at: [65, 0], size: [20, 20], yaw: -.3 } }, 3)), 'build.claimed');
  assert.equal(code(await f.claim({ part: 'missing', root: 'missing' }, 3)), 'entity.unknown');
  accepted(await f.act([place('out-of-site', 300)], f.lead));
  assert.equal(code(await f.claim({ part: 'outside', root: 'out-of-site' }, 3)), 'entity.unknown');
});

test('§9.3.11 idempotency per part/token, stale take preserves made, revokes old id and replays', async t => {
  const f = fixture(); t.after(() => f.db.close()); const input = { part: 'tower', region: { at: [60, 0], size: [20, 20] } }, c = await f.claim(input, 2);
  assert.equal((await f.claim(input, 2)).claim.id, c.claim.id); assert.equal((await f.claim(input, 2)).replayed, true);
  assert.equal(code(await f.claim(input, 1)), 'build.claimed'); assert.equal(code(await f.claim({ part: 'tower', take: c.claim.id }, 1)), 'build.claim-unknown');
  accepted(await f.act([place('tower-top', 60)], f.field(c.claim.id), 2)); const made = f.body().claims[0].made;
  f.advance(51); assert.equal((await f.req('/v1/world/builds')).builds[0].claims[0].status, 'stale');
  const taken = await f.claim({ part: 'tower', take: c.claim.id }, 1); assert.equal(taken.ok, true); assert.notEqual(taken.claim.id, c.claim.id); assert.deepEqual(taken.claim.made, made); assert.equal(f.body().claims[0].status, 'taken');
  assert.equal(code(await f.act([{ op: 'set', id: 'tower-top', name: 'late' }], f.field(c.claim.id), 2)), 'build.claim-unknown');
  const again = await f.claim({ part: 'tower', take: c.claim.id }, 1); assert.equal(again.replayed, true); assert.equal(again.claim.id, taken.claim.id);
  accepted(await f.act([{ op: 'set', id: 'tower-top', name: 'taken-top' }], f.field(taken.claim.id), 1));
  const path = `/v1/god/builds/church/claims/${taken.claim.id}/release`;
  assert.equal((await f.req(path, { done: true }, 1)).ok, true); assert.equal((await f.req(path, {}, 1)).replayed, true);
  assert.equal(code(await f.act([place('late', 60)], f.field(taken.claim.id), 1)), 'build.claim-unknown');
});

test('claim liveness requires its batch id; public views/deltas expose part and status only', async t => {
  const f = fixture(); t.after(() => f.db.close()); const c = await f.claim({ part: 'east', root: 'shell/east' });
  assert.equal(c.claim.user, undefined); assert.equal(JSON.stringify(c).includes('tokenHash'), false);
  accepted(await f.act([place('child', 0, 0, 'shell/east')], f.field(c.claim.id), 3));
  f.advance(14); await f.req('/v1/god/snapshot', undefined, 1); assert.equal(f.body().claims[0].lastAt, 1000);
  await f.req('/v1/god/snapshot', undefined, 3); assert.equal(f.body().claims[0].lastAt, 1000);
  const rev = f.god.store.buildsRev(); await f.req('/v1/god/snapshot', undefined, 3); assert.equal(f.god.store.buildsRev(), rev);
  accepted(await f.act([{ op: 'set', id: 'shell/east/child', name: 'working' }], f.field(c.claim.id), 3)); assert.equal(f.body().claims[0].lastAt, 1014);
  for (const path of ['/v1/world/builds', '/v1/world/snapshot']) assert.deepEqual((await f.req(path)).builds[0].claims, [{ part: 'east', status: 'held' }]);
  const claimed = f.emitted.find(m => m.kind === 'world-build' && m.event === 'claimed') as WorldBuildMessage; assert.deepEqual(claimed.delta!.claim, { part: 'east', status: 'held' });
  const snapshot = JSON.stringify(f.god.publicSnapshot()); for (const privateValue of [c.claim.id, 'tokenHash', 'holder', 'hash8', 'made']) assert.equal(snapshot.includes(privateValue), false, privateValue);
  const schema = godSchema() as any; assert.ok(schema.builds.actions.claim); assert.ok(schema.builds.actions.release); assert.ok(schema.endpoints.god.includes('POST /v1/god/builds/:id/claims'));
});

test('claims survive reload, held/retained bounds and exactly-one lease/claim are enforced', async t => {
  const f = fixture(); t.after(() => f.db.close());
  for (const build of [{ id: 'church' }, { ...f.lead, claim: 'c_00000000' }]) assert.equal(code(await f.req('/v1/god/act', { ops: [place('bad')], build })), 'schema');
  for (let i = 0; i < 8; i++) assert.equal((await f.claim({ part: `p${i}`, region: { at: [-90 + i * 20, -70], size: [10, 10] } })).ok, true);
  assert.equal(code(await f.claim({ part: 'ninth', region: { at: [90, -70], size: [10, 10] } })), 'build.limit');
  const god = new GodMode(f.db, { ...f.god.opts, emit: () => {} }); assert.equal(god.builds.status('church')!.build.claims.length, 8);
  assert.equal(code(god.act({ ops: [place('reload-squat', -90, -70)], build: f.lead })), 'build.claimed');
  for (const c of f.body().claims) assert.equal((await f.req(`/v1/god/builds/church/claims/${c.id}/release`, {}, 1)).ok, true);
  for (let i = 0; i < 35; i++) { const c = await f.claim({ part: `history-${i}`, root: 'shell/east' }); await f.req(`/v1/god/builds/church/claims/${c.claim.id}/release`, {}); }
  assert.equal(f.body().claims.length, 32); assert.equal(f.body().claims.at(-1)!.part, 'history-34');
});

test('rotated region uses full footprints for ownership and overlap for lead exclusion', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const c = await f.claim({ part: 'rotated', region: { at: [60, 0], size: [10, 4], yaw: Math.PI / 4 } }, 2), build = f.field(c.claim.id);
  const bench = (name: string, x: number, z: number) => ({ op: 'place', def: 'core/bench@1', name, p: [x, z], r: Math.PI / 4 });
  accepted(await f.act([bench('inside', 60, 0)], build, 2));
  assert.equal(code(await f.act([bench('edge', 60 + 4.8 / Math.sqrt(2), -4.8 / Math.sqrt(2))], build, 2)), 'build.claim');
  // Its centre is outside, but its footprint overlaps the region.
  assert.equal(code(await f.act([bench('squatter', 60 + 5.2 / Math.sqrt(2), -5.2 / Math.sqrt(2))], f.lead)), 'build.claimed');
});

test('indirect redefine upserts are checked, and taking a stale claim cannot widen its scope', async t => {
  const f = fixture(); t.after(() => f.db.close()); const c = await f.claim({ part: 'east', root: 'shell/east' });
  const def = { ...partDef, size: { box: [2, 1, 1] }, make: { kind: 'gen', gen: 'kit/2', args: { shapes: [{ kind: 'box', at: [0, 0, 0], size: [2, 1, 1] }] } } };
  for (const build of [f.lead, undefined]) assert.equal(code(await f.act([{ op: 'define', def }], build)), 'build.claimed');
  assert.equal(code(await f.act([{ op: 'define', def }], f.field(c.claim.id), 1)), 'build.claim');
  f.advance(51);
  const taken = await f.claim({ part: 'east', take: c.claim.id, root: 'shell/west', region: { at: [40, 40], size: [20, 20] } }, 2);
  assert.equal(taken.claim.root, f.god.model.get('shell/east')!.id); assert.equal(taken.claim.region, undefined);
  assert.equal(code(await f.act([place('widened', 40, 40)], f.field(taken.claim.id), 2)), 'build.claim');
});

test('C3b F5: stale group undo refuses revival before reverting any edit when a newer claim overlaps', async t => {
  const f = fixture(); t.after(() => f.db.close()); const a = await f.claim({ part: 'east', root: 'shell/east' });
  accepted(await f.act([place('older', 0, 0, 'shell/east')], f.field(a.claim.id), 1));
  accepted(await f.act([place('newer', 0, 0, 'shell/east')], f.field(a.claim.id), 1));
  f.advance(51);
  const b = await f.claim({ part: 'detail', root: 'shell/east/older' }, 2); assert.equal(b.ok, true);
  const r = await f.req('/v1/god/undo?group=church/east', { build: f.field(a.claim.id) }, 1);
  assert.equal(r.accepted, false); assert.equal(code(r), 'build.claimed'); assert.equal(r.reverted.length, 0); assert.equal(r.notReverted.length, 2);
  assert.ok(f.god.model.get('shell/east/older')); assert.ok(f.god.model.get('shell/east/newer'));
  accepted(await f.act([{ op: 'set', id: 'shell/east/older', name: 'still-working' }], f.field(b.claim.id), 2));
});

test('C3b F7/F12: region undo prunes made, redo restores it once, and previews/dryruns remain pure', async t => {
  const f = fixture(); t.after(() => f.db.close()); const c = await f.claim({ part: 'tower', region: { at: [60, 0], size: [20, 20] } }, 2), build = f.field(c.claim.id);
  accepted(await f.act([place('tower', 60)], build, 2)); const made = f.body().claims[0].made, steps = f.body().steps;
  accepted(await f.req('/v1/god/undo?group=church/tower', { build }, 2)); assert.deepEqual(f.body().claims[0].made, []);
  accepted(await f.req('/v1/god/redo', { build }, 2)); assert.deepEqual(f.body().claims[0].made, made); assert.deepEqual(f.body().steps, steps);
  const before = f.god.builds.status('church')!.build.claims;
  for (const path of ['preview', 'dryrun']) {
    assert.equal(code(await f.req(`/v1/god/${path}`, { ops: [place('own-outside', -60)], build }, 2)), 'build.claim');
    for (const lead of [undefined, f.lead]) assert.equal(code(await f.req(`/v1/god/${path}`, { ops: [place('squat', 65)], ...(lead ? { build: lead } : {}) })), 'build.claimed');
  }
  assert.deepEqual(f.god.builds.status('church')!.build.claims, before);
});

// C3b regressions adapted from review-c3-repro. These exercise the real admission/refuse/transaction paths.
test('C3b F1/F9: nested $tmp members are guarded against regions for lead and field-less batches', async t => {
  const f = fixture(); t.after(() => f.db.close()); assert.equal((await f.claim({ part: 'tower', region: { at: [60, 0], size: [20, 20] } }, 2)).ok, true);
  for (const build of [f.lead, undefined]) for (const endpoint of ['act', 'preview', 'dryrun']) {
    const before = f.god.model.editSeq, row = f.god.store.build('church');
    const ops = [{ ...place('hub', 100), tmp: '$hub' }, { ...place('middle', -20, 0, '$hub'), tmp: '$middle' }, place('leaf', -20, 0, '$middle')];
    const r = await f.req(`/v1/god/${endpoint}`, { ops, ...(build ? { build } : {}) });
    assert.equal(code(r), 'build.claimed', JSON.stringify(r)); assert.ok(r.failures[0].entity); assert.equal(f.god.model.editSeq, before); assert.deepEqual(f.god.store.build('church'), row);
  }
});

test('C3b F1: parts prefab and contents members use their own solid footprints', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const solid = { ...partDef, name: 'wallp', layer: 'solid', size: { box: [2, 2, 2] }, make: { kind: 'gen', gen: 'kit/2', args: { shapes: [{ kind: 'box', at: [0, 0, 0], size: [2, 2, 2] }] } } };
  const members = [0, 1, 2, 3, 4].map(i => ({ id: `w${i}`, def: 'wallp@1', p: [i * 8, 0] }));
  accepted(f.god.act({ ops: [{ op: 'define', def: solid }, { op: 'define', def: { ...partDef, name: 'row', make: { kind: 'parts', parts: members } } }, { op: 'define', def: { ...partDef, name: 'furnished', contents: members } }] }));
  assert.equal((await f.claim({ part: 'tower', region: { at: [60, 0], size: [20, 20] } }, 2)).ok, true);
  for (const def of ['row@1', 'furnished@1']) for (const build of [f.lead, undefined]) {
    const r = await f.act([{ op: 'place', def, name: 'colonnade', p: [45, 0] }], build);
    assert.equal(code(r), 'build.claimed', JSON.stringify(r)); assert.equal(f.god.model.get('colonnade'), undefined);
  }
});

test('C3b F1: clone with in guards the entire copied subtree, and ownership contains every new member', async t => {
  const f = fixture(); t.after(() => f.db.close());
  accepted(await f.act([{ ...place('source', -80), tmp: '$s' }, place('leaf', 15, 0, '$s'), place('destination', 45)], f.lead));
  const c = await f.claim({ part: 'tower', region: { at: [60, 0], size: [20, 20] } }, 2), build = f.field(c.claim.id); assert.equal(c.ok, true);
  assert.equal(code(await f.act([{ op: 'clone', id: 'source', p: [0, 0], in: { parent: 'destination' } }], f.lead)), 'build.claimed');
  // The clone's origin is inside, but its child at world x=75 lies outside the owner's region.
  assert.equal(code(await f.act([{ op: 'clone', id: 'source', p: [60, 0] }], build, 2)), 'build.claim');
  assert.equal(code(await f.act([{ ...place('own-hub', 60), tmp: '$h' }, place('escape', 40, 0, '$h')], build, 2)), 'build.claim');
  assert.deepEqual(f.body().claims[0].made, []);
  accepted(await f.act([{ ...place('own-hub', 60), tmp: '$h' }, place('inside', 4, 0, '$h')], build, 2));
  assert.equal(f.body().claims[0].made.length, 1);
});

test('C3b F1/F9: new non-solid subtree members are tested by world pose on every layer', async t => {
  const f = fixture(); t.after(() => f.db.close());
  for (const layer of ['decor', 'surface', 'volume']) accepted(f.god.act({ ops: [{ op: 'define', def: { ...partDef, name: `layer-${layer}`, layer } }] }));
  const c = await f.claim({ part: 'tower', region: { at: [60, 0], size: [20, 20] } }, 2), build = f.field(c.claim.id);
  for (const layer of ['decor', 'surface', 'volume']) {
    assert.equal(code(await f.act([{ ...place('hub', 100), tmp: '$h' }, { ...place('leaf', -40, 0, '$h'), def: `layer-${layer}@1` }], f.lead)), 'build.claimed');
    assert.equal(code(await f.act([{ ...place('hub', 60), tmp: '$h' }, { ...place('leaf', 40, 0, '$h'), def: `layer-${layer}@1` }], build, 2)), 'build.claim');
  }
});

test('C3b F1: ownership requires every prefab/contents footprint corner inside its rotated region', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const children = [{ id: 'edge', def: 'core/bench@1', p: [9.8, 0] }];
  accepted(f.god.act({ ops: [{ op: 'define', def: { ...partDef, name: 'edge-prefab', make: { kind: 'parts', parts: children } } }, { op: 'define', def: { ...partDef, name: 'edge-contents', contents: children } }] }));
  const c = await f.claim({ part: 'tower', region: { at: [60, 0], size: [20, 20], yaw: Math.PI / 4 } }, 2);
  for (const def of ['edge-prefab@1', 'edge-contents@1']) assert.equal(code(await f.act([{ op: 'place', def, name: 'edge', p: [60, 0], r: Math.PI / 4 }], f.field(c.claim.id), 2)), 'build.claim');
  assert.deepEqual(f.body().claims[0].made, []);
});

test('C3b F2: existing entities cannot move or reparent into a live region; leaving and pre-existing overlap are allowed', async t => {
  const f = fixture(); t.after(() => f.db.close());
  accepted(await f.act([place('kiosk', 45), place('destination', 60), place('already-inside', 60, 5)], f.lead));
  assert.equal((await f.claim({ part: 'tower', region: { at: [60, 0], size: [20, 20] } }, 2)).ok, true);
  for (const build of [f.lead, undefined]) for (const move of [{ op: 'move', id: 'kiosk', p: [60, 0] }, { op: 'move', id: 'kiosk', in: { parent: 'destination' }, p: [0, 0] }]) {
    assert.equal(code(await f.act([move], build)), 'build.claimed'); assert.equal(f.god.model.worldPose(f.god.model.get('kiosk')!).x, 45);
  }
  accepted(await f.act([{ op: 'move', id: 'already-inside', p: [61, 5] }], f.lead));
  accepted(await f.act([{ op: 'move', id: 'already-inside', p: [40, 5] }], f.lead));
});

test('C3b F2: moved/rotated/scaled ancestor descendants enter regions even without descendant upserts', async t => {
  const f = fixture(); t.after(() => f.db.close());
  accepted(f.god.act({ ops: [{ op: 'define', def: { ...partDef, name: 'stretch', size: { box: [1, 1, 1], scale: [1, 6] } } }] }));
  accepted(await f.act([place('solid-carrier'), { op: 'place', def: 'core/bench@1', name: 'edge', p: [10, 0], in: { parent: 'solid-carrier' } }, place('turn-carrier', 60, 30), place('tip', 30, 0, 'turn-carrier'), { ...place('scale-carrier'), def: 'stretch@1' }, place('tip', 10, 0, 'scale-carrier')], f.lead));
  assert.equal((await f.claim({ part: 'east-root', root: 'shell/east' }, 1)).ok, true);
  assert.equal((await f.claim({ part: 'tower', region: { at: [60, 0], size: [20, 20] } }, 2)).ok, true);
  const moves = [
    { op: 'move', id: 'shell', p: [49, 0] }, // shell/east enters, while shell itself stays outside.
    { op: 'move', id: 'solid-carrier', p: [49, 0] }, // carrier is outside; the bench's new footprint enters.
    { op: 'move', id: 'scale-carrier', s: 6 },
    { op: 'move', id: 'turn-carrier', r: Math.PI / 2 },
  ];
  for (const build of [f.lead, undefined]) for (const move of moves) {
    const seq = f.god.model.editSeq, r = await f.act([move], build); assert.equal(code(r), 'build.claimed', JSON.stringify({ move, r })); assert.equal(f.god.model.editSeq, seq);
  }
});

test('C3b F3/F8/F10: a region must fit all four world-space corners inside its own rotated build site', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const other = f.god.builds.start({ id: 'mill', title: 'Mill', steps: ['shell'], site: { at: [300, 300], size: [40, 40], yaw: Math.PI / 4 } }, f.identities[3]) as any; assert.equal(other.ok, true);
  const before = f.god.store.build('church');
  for (const region of [{ at: [300, 300], size: [40, 40] }, { at: [480, 480], size: [30, 30] }, { at: [95, 0], size: [20, 20] }, { at: [90, 0], size: [20, 20], yaw: Math.PI / 4 }]) assert.equal(code(await f.claim({ part: 'grab', region })), 'build.site');
  assert.deepEqual(f.god.store.build('church'), before);
  const rotatedClaim = (region: unknown) => f.req('/v1/god/builds/mill/claims', { part: 'corner', region }, 1);
  assert.equal(code(await rotatedClaim({ at: [312, 312], size: [10, 10] })), 'build.site');
  assert.equal((await rotatedClaim({ at: [300, 300], size: [40, 40], yaw: Math.PI / 4 })).ok, true, 'coincident rotated edges fit');
  accepted(await f.act([place('free-world', 480, 480)], undefined));
});

test('C3b F3: region adoption cannot acquire children under another build root moved into this site', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const s = f.god.builds.start({ id: 'market', title: 'Market', steps: ['stalls'], site: { at: [300, 0], size: [40, 40] } }, f.identities[3]) as any; assert.equal(s.ok, true);
  const market = { id: 'market', lease: s.lease };
  accepted(await f.act([place('stall', 300)], market, 3)); accepted(await f.act([{ op: 'move', id: 'stall', p: [60, 0] }], market, 3));
  const c = await f.claim({ part: 'tower', region: { at: [60, 0], size: [20, 20] } }, 2); assert.equal(c.ok, true);
  assert.equal(code(await f.act([place('graffiti', 0, 0, 'stall')], f.field(c.claim.id), 2)), 'build.claim'); assert.equal(f.god.model.get('stall/graffiti'), undefined);
});

test('C3b F11: claim admission compares full subtree geometry in both orders, including made subtrees', async t => {
  for (const rootFirst of [true, false]) {
    const f = fixture(); t.after(() => f.db.close()); accepted(await f.act([place('slab', 30, 0, 'shell/east')], f.lead));
    const root = { part: 'aisle', root: 'shell/east' }, region = { part: 'tower', region: { at: [40, 0], size: [12, 12] } };
    assert.equal((await f.claim(rootFirst ? root : region, 1)).ok, true);
    assert.equal(code(await f.claim(rootFirst ? region : root, 2)), 'build.claimed');
  }
  const f = fixture(); t.after(() => f.db.close());
  const a = await f.claim({ part: 'maker', region: { at: [60, 0], size: [20, 20] } }, 1);
  accepted(await f.act([{ ...place('made-root', 60), tmp: '$m' }, place('member', 5, 0, '$m')], f.field(a.claim.id), 1));
  // Owning a made top protects its descendants even when they later extend beyond the region.
  accepted(await f.act([{ op: 'move', id: 'made-root/member', p: [25, 0] }], f.field(a.claim.id), 1));
  assert.equal(code(await f.claim({ part: 'outside-maker', region: { at: [85, 0], size: [10, 10] } }, 2)), 'build.claimed');
});

test('C3b F4: shared-token reads keep stale claims stale so take, lead edits and done can proceed', async t => {
  const f = fixture(); t.after(() => f.db.close()); const c = await f.claim({ part: 'east', root: 'shell/east' }, 0); assert.equal(c.ok, true);
  f.advance(14); await f.req('/v1/god/snapshot', undefined, 0); assert.equal(f.body().claims[0].lastAt, 1000);
  f.advance(37); assert.equal((await f.req('/v1/god/builds', undefined, 0)).open[0].claims[0].status, 'stale');
  accepted(await f.act([{ op: 'set', id: 'shell/east', name: 'lead-edit' }], f.lead)); assert.equal(f.body().claims[0].lastAt, 1000);
  const taken = await f.claim({ part: 'east', take: c.claim.id }, 0); assert.equal(taken.ok, true); assert.notEqual(taken.claim.id, c.claim.id);
  f.advance(51); assert.equal((await f.req('/v1/god/builds/church/done', {}, 0)).ok, true);
});

test('C3b F5: reads never revive old claims, and stale batches/previews/dryruns/take recheck full scope overlap', async t => {
  const f = fixture(); t.after(() => f.db.close()); const a = await f.claim({ part: 'east', root: 'shell/east' }, 1); f.advance(51);
  const b = await f.claim({ part: 'repair', root: 'shell/east' }, 2); assert.equal(b.ok, true); accepted(await f.act([place('fix', 0, 0, 'shell/east')], f.field(b.claim.id), 2));
  await f.req('/v1/god/builds', undefined, 1); assert.equal(f.body().claims[0].lastAt, 1000);
  const before = f.god.store.build('church'), seq = f.god.model.editSeq;
  for (const endpoint of ['act', 'preview', 'dryrun']) assert.equal(code(await f.req(`/v1/god/${endpoint}`, { ops: [place('harmless-newer-sibling', 5, 0, 'shell/east')], build: f.field(a.claim.id) }, 1)), 'build.claimed');
  assert.equal(code(await f.claim({ part: 'east', take: a.claim.id }, 1)), 'build.claimed'); assert.deepEqual(f.god.store.build('church'), before); assert.equal(f.god.model.editSeq, seq);
  accepted(await f.act([{ op: 'set', id: 'shell/east/fix', name: 'fix-live' }], f.field(b.claim.id), 2));
  await f.req(`/v1/god/builds/church/claims/${b.claim.id}/release`, {}, 2);
  accepted(await f.act([place('resumed', 5, 0, 'shell/east')], f.field(a.claim.id), 1)); assert.equal(f.body().claims[0].lastAt, f.now());
});

test('C3b F5: a stale region cannot revive after a newer overlapping root or region claim', async t => {
  for (const overlap of [{ part: 'new-region', region: { at: [60, 0], size: [10, 10] } }, { part: 'new-root', root: 'standing' }]) {
    const f = fixture(); t.after(() => f.db.close()); accepted(await f.act([place('standing', 60)], f.lead));
    const a = await f.claim({ part: 'old-region', region: { at: [60, 0], size: [20, 20] } }, 1); f.advance(51);
    assert.equal((await f.claim(overlap, 2)).ok, true);
    // This edit is outside the newer claim; revival itself still overlaps and must be refused.
    assert.equal(code(await f.act([place('elsewhere-in-old-region', 53)], f.field(a.claim.id), 1)), 'build.claimed'); assert.equal(f.body().claims[0].lastAt, 1000);
  }
});

test('C3b F6: helper and shared lead reads preserve explicit pause; only carrying a claim/lease resumes it', async t => {
  for (const who of [0, 1]) {
    const f = fixture(); t.after(() => f.db.close()); const c = await f.claim({ part: 'east', root: 'shell/east' }, who);
    f.advance(14); assert.equal((await f.req('/v1/god/builds/church/pause', { note: 'handing over' })).ok, true); const before = f.god.store.build('church');
    f.advance(14); await f.req('/v1/god/builds', undefined, who); await f.req('/v1/god/snapshot', undefined, 0);
    assert.deepEqual(f.god.store.build('church'), before); assert.equal(f.body().paused!.explicit, true); assert.equal(f.body().claims[0].lastAt, 1000);
    accepted(await f.act([place('resume-by-claim', 0, 0, 'shell/east')], f.field(c.claim.id), who)); assert.equal(f.god.store.build('church')!.status, 'active'); assert.equal(f.body().paused, undefined);
    await f.req('/v1/god/builds/church/pause', { note: 'lease handoff' }); f.advance(14); await f.req('/v1/god/snapshot'); assert.equal(f.body().paused!.explicit, true);
    accepted(await f.act([place('resume-by-lease', -60)], f.lead)); assert.equal(f.body().paused, undefined);
    await f.req('/v1/god/builds/church/pause', { note: 'third agent may resume' }); f.advance(14); await f.req('/v1/god/builds', undefined, who);
    assert.equal((await f.req('/v1/god/builds/church/resume', {}, 3)).ok, true);
  }
});

test('C3b F7/F12: remove-and-replace counts standing made parts and commits pruning atomically', async t => {
  const f = fixture(); t.after(() => f.db.close()); const c = await f.claim({ part: 'tower', region: { at: [60, 0], size: [40, 40] } }, 2), build = f.field(c.claim.id);
  accepted(await f.act(Array.from({ length: 64 }, (_, i) => place(`p-${i}`, 50 + i % 8, -10 + Math.floor(i / 8))), build, 2)); assert.equal(f.body().claims[0].made.length, 64);
  const removed = f.god.model.get('p-0')!.id, ops = [{ op: 'remove', id: 'p-0' }, place('replacement', 60, 10)], before = f.god.store.build('church');
  for (const endpoint of ['preview', 'dryrun']) accepted(await f.req(`/v1/god/${endpoint}`, { ops, build }, 2)); assert.deepEqual(f.god.store.build('church'), before);
  f.db.db.exec('CREATE TRIGGER refuse_prune BEFORE UPDATE ON god_builds_v1 BEGIN SELECT RAISE(IGNORE); END');
  assert.equal(code(await f.act(ops, build, 2, { clientRef: 'prune-refused' })), 'revision.stale'); assert.deepEqual(f.god.store.build('church'), before); assert.ok(f.god.model.entities.has(removed)); assert.equal(f.god.store.receipt('prune-refused'), null);
  f.db.db.exec('DROP TRIGGER refuse_prune');
  accepted(await f.act(ops, build, 2)); assert.equal(f.body().claims[0].made.length, 64); assert.equal(f.body().claims[0].made.includes(removed), false);
  accepted(await f.act([...Array.from({ length: 63 }, (_, i) => ({ op: 'remove', id: `p-${i + 1}` })), { op: 'remove', id: 'replacement' }], build, 2)); assert.deepEqual(f.body().claims[0].made, []);
  accepted(await f.act([place('one-more', 60)], build, 2)); assert.equal(f.body().claims[0].made.length, 1);
});

test('C3b F7: engine and field-less removals prune made even below existing build roots; take copies standing ids', async t => {
  const f = fixture(); t.after(() => f.db.close());
  accepted(await f.act([place('unclaimed-parent', 60)], f.lead));
  const c = await f.claim({ part: 'tower', region: { at: [60, 0], size: [20, 20] } }, 2), build = f.field(c.claim.id);
  accepted(await f.act([place('engine-child', 0, 0, 'unclaimed-parent'), place('manual-child', 2, 0, 'unclaimed-parent'), place('remaining', 60)], build, 2)); assert.equal(f.body().claims[0].made.length, 3);
  accepted(f.god.engineAct([{ op: 'remove', id: 'unclaimed-parent/engine-child', cascade: false }], 'retired')); assert.equal(f.body().claims[0].made.length, 2);
  f.advance(51); accepted(await f.act([{ op: 'remove', id: 'unclaimed-parent/manual-child' }], undefined, 3)); assert.equal(f.body().claims[0].made.length, 1);
  const take = await f.claim({ part: 'tower', take: c.claim.id }, 1); assert.equal(take.ok, true); assert.deepEqual(take.claim.made, [f.god.model.get('remaining')!.id]);
});

test('C3b F12: undoing a full made list frees its cap, while redo re-adopts exactly the standing ids', async t => {
  const f = fixture(); t.after(() => f.db.close()); const c = await f.claim({ part: 'tower', region: { at: [60, 0], size: [40, 40] } }, 2), build = f.field(c.claim.id);
  accepted(await f.act(Array.from({ length: 64 }, (_, i) => place(`p-${i}`, 50 + i % 8, -10 + Math.floor(i / 8))), build, 2)); const made = f.body().claims[0].made;
  accepted(await f.req('/v1/god/undo?group=church/tower', { build }, 2)); assert.deepEqual(f.body().claims[0].made, []);
  accepted(await f.req('/v1/god/redo', { build }, 2)); assert.deepEqual(f.body().claims[0].made, made);
  accepted(await f.req('/v1/god/undo?group=church/tower', { build }, 2)); accepted(await f.act([place('again', 60)], build, 2)); assert.equal(f.body().claims[0].made.length, 1);
});

test('C3b F6: a field-less lead undo cannot clear an explicit handoff pause', async t => {
  const f = fixture(); t.after(() => f.db.close());
  accepted(await f.act([place('lead-work', -60)], f.lead));
  await f.req('/v1/god/builds/church/pause', { note: 'handing over' }); const paused = f.body().paused, lastAt = f.god.store.build('church')!.last_at;
  f.advance(14); accepted(await f.req('/v1/god/undo', {}));
  assert.equal(f.god.store.build('church')!.status, 'paused'); assert.equal(f.god.store.build('church')!.last_at, lastAt); assert.deepEqual(f.body().paused, paused);
});
