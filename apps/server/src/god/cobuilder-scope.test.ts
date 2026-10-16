// Y4b: narrow co-builder god tokens (label `cobuilder:<account>:<agent>`, written by the launcher's worldops lane), in-process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Hono, type Context } from 'hono';
import { hashToken } from '../auth.ts';
import { Db } from '../db.ts';
import { ApiError } from '../souls.ts';
import { GodMode } from './god.ts';
import { mountGodRoutes } from './routes.ts';
import { mountEnvRoutes } from './world-env.ts';
import { cobuilderOf, cobuilderRoute } from './cobuilders.ts';
import type { BuildField } from './builds.ts';

const partDef = { schema: 'def/1', name: 'part', size: { box: [1, 1, 1] }, layer: 'decor', make: { kind: 'gen', gen: 'kit/2', args: { shapes: [{ kind: 'box', at: [0, 0, 0], size: [1, 1, 1] }] } } };
const place = (name: string, x = 0, z = 0, parent = 'world') => ({ op: 'place', def: 'part@1', name, p: [x, z], in: { parent } });
const code = (r: any) => r.failures?.[0]?.code;
const site = (x: number) => ({ at: [x, 0], size: [60, 60] });

function fixture(cobuilders = true) {
  const db = new Db(':memory:'); let now = 1_000_000;
  const god = new GodMode(db, { worldId: 'cobuild', ownerId: 'owner', tick: () => 0, now: () => now, buildPauseMs: 120_000, assetDir: join(tmpdir(), 'y4b-assets'), emit: () => {}, cobuilders });
  const owner = god.mintFor({ id: 'owner', role: 'user' }, 'owner-agent');
  // What the launcher's addGodToken writes for an accepted co-builder pairing.
  const cobuilder = (label: string) => { const token = `god_cobuild_${label.replace(/\W/g, '-')}`; god.store.addToken(hashToken(token), label); return token; };
  const alice = cobuilder('cobuilder:alice:claude'), alice2 = cobuilder('cobuilder:alice:codex'), bob = cobuilder('cobuilder:bob:cursor');
  const id = (token: string) => god.godIdentity(token)!;
  assert.equal(god.as({ identity: id(owner) }, () => god.act({ ops: [{ op: 'define', def: partDef }] })).accepted, true);
  const app = new Hono();
  mountGodRoutes(app, { god, worldName: 'Cobuild', requireUser: async () => { throw new ApiError(401, 'unauthorized', 'sign in'); }, soulFromBearer: () => null, baseOf: () => 'http://127.0.0.1:5398', limitIp: () => {} });
  const bearer = (c: Context) => c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  mountEnvRoutes(app, { god, host: { engine: { world: { tick: 0, env: { datetime: '2026-10-03T06:00:00.000Z' } } } } as never, requireGod: (c) => { const who = god.godIdentity(bearer(c)); if (!who) throw new ApiError(401, 'unauthorized', 'god token'); return who; } });
  app.onError((e, c) => e instanceof ApiError ? c.json({ ok: false, code: e.code, message: e.message, ...e.extra }, e.status as 400) : c.json({ internal: String(e) }, 500));
  const call = async (method: string, path: string, token: string, body?: unknown) => {
    const r = await app.request(path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await r.text(); return { status: r.status, text, data: JSON.parse(text) as any };
  };
  const post = async (path: string, token: string, body: unknown = {}) => { const r = await call('POST', path, token, body); assert.equal(r.status, 200, `${path}: ${r.text}`); return r.data; };
  const start = async (token: string, build: string, x: number) => { const r = await post('/v1/god/builds', token, { id: build, title: build, steps: ['shell', 'roof'], site: site(x) }); assert.equal(r.ok, true, JSON.stringify(r)); return { id: build, lease: r.lease as string } as BuildField; };
  return { db, god, owner, alice, alice2, bob, id, call, post, start, advance: (ms: number) => { now += ms; } };
}

test('Y4b identity: the launcher label makes a co-builder; owner tokens and agent-chosen names are unchanged', async t => {
  const f = fixture(); t.after(() => f.db.close());
  assert.equal(cobuilderOf('cobuilder:alice:claude'), 'alice'); assert.equal(cobuilderOf('cobuilder:alice:my:agent'), 'alice'); assert.equal(cobuilderOf('owner-agent'), null); assert.equal(cobuilderOf(null), null);
  assert.equal(f.id(f.alice).cobuilder, 'alice'); assert.equal(f.id(f.owner).cobuilder, undefined);
  const status = (await f.call('GET', '/v1/god/status', f.alice)).data; assert.equal(status.you, 'cobuilder'); assert.deepEqual(status.pending, []); assert.equal(status.agents, undefined);
  assert.equal((await f.call('GET', '/v1/god/status', f.owner)).data.you, 'god');
  // The world's own pairing never hands out a co-builder label: an agent cannot name itself into another account.
  const pairing = f.god.pairStart('cobuilder:alice:sneaky', 'http://127.0.0.1:5398');
  assert.equal(f.god.pairInfo(pairing.user_code).agent, 'agent-alice:sneaky');
  // Owner-only world calls need the owner's sign-in, never a god token (unchanged; co-builders included).
  for (const path of ['/v1/god/mint', '/v1/god/pair/approve', '/v1/god/claim']) assert.equal((await f.call('POST', path, f.alice, { code: 'ABCD-EFGH' })).status, 401, path);
  assert.equal(cobuilderRoute('POST', '/w/cobuild/v1/god/env'), cobuilderRoute('POST', '/v1/god/env')); assert.equal(cobuilderRoute('GET', '/v1/world/env'), null);
});

test('Y4b env: co-builders never change env, sky, time or weather, and never strike', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const state = JSON.stringify(f.god.model.state), seq = f.god.model.editSeq;
  for (const [path, body] of [['/v1/god/env', { weather: { kind: 'rain' } }], ['/v1/god/env', { hour: 18 }], ['/v1/god/strike', { at: [0, 0] }]] as const) {
    const r = await f.call('POST', path, f.alice, body); assert.equal(r.status, 403, `${path}: ${r.text}`); assert.equal(r.data.code, 'cobuilder.scope');
  }
  const preview = await f.post('/v1/god/preview', f.owner, { ops: [{ op: 'world', state: { sky: { palette: 'night' } } }] }); assert.equal(preview.accepted, true);
  const attempts: unknown[] = [
    { ops: [{ op: 'world', state: { weather: { kind: 'storm' } } }] }, { ops: [{ op: 'world', state: { sky: { palette: 'night' } } }] },
    { ops: [{ op: 'world', state: { time: { paused: true } } }] }, { ops: [{ op: 'world', state: { weather: { strike: { x: 0, z: 0, n: 1, tick: 0 } } } }] },
    { ops: [{ op: 'world', state: { constitution: 'co-builders rule' } }] }, { ops: [place('ok', 200, 200), { op: 'world', state: { ground: { palette: 'snow' } } }] },
  ];
  for (const body of attempts) for (const path of ['/v1/god/act', '/v1/god/dryrun', '/v1/god/preview']) {
    const r = await f.post(path, f.alice, body); assert.equal(r.accepted, false, `${path} ${JSON.stringify(body)}`); assert.equal(code(r), 'cobuilder.scope', JSON.stringify(r.failures));
  }
  const sealed = await f.post('/v1/god/act', f.alice, { preview: preview.id }); assert.equal(code(sealed), 'cobuilder.scope', 'not even through the owner\'s sealed preview');
  assert.equal(JSON.stringify(f.god.model.state), state); assert.equal(f.god.model.editSeq, seq);
  // Building is allowed, and the owner keeps every env right.
  assert.equal((await f.post('/v1/god/act', f.alice, { ops: [place('shed', 300, 300)] })).accepted, true);
  assert.equal((await f.post('/v1/god/env', f.owner, { weather: { kind: 'rain' } })).accepted, true);
  assert.equal((await f.post('/v1/god/strike', f.owner, { at: [5, 5] })).accepted, true);
});

test('Y4b builds: a co-builder leads its own builds and claims, and never starts, finishes or takes over another account\'s', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const church = await f.start(f.owner, 'church', 0), barn = await f.start(f.alice, 'barn', 200);
  assert.equal(f.god.as({ identity: f.id(f.owner) }, () => f.god.act({ ops: [place('nave'), place('aisle', 5, 0, 'nave')], build: church })).accepted, true);
  // Alice builds her own build with her lease, and claims a part of the owner's build.
  assert.equal((await f.post('/v1/god/act', f.alice, { ops: [place('loft', 200, 0)], build: barn })).accepted, true);
  const mine = await f.post('/v1/god/builds/church/claims', f.alice, { part: 'aisle', root: 'nave/aisle' }); assert.equal(mine.ok, true, JSON.stringify(mine));
  assert.equal((await f.post('/v1/god/act', f.alice, { ops: [place('pew', 1, 0, 'nave/aisle')], build: { id: 'church', claim: mine.claim.id } })).accepted, true);
  const ownerClaim = await f.post('/v1/god/builds/church/claims', f.owner, { part: 'tower', root: 'nave' });
  assert.equal(ownerClaim.ok, false, 'claims stay exclusive (overlap)');
  const porch = await f.post('/v1/god/builds/church/claims', f.owner, { part: 'porch', region: { at: [-20, -20], size: [10, 10], yaw: 0 } }); assert.equal(porch.ok, true, JSON.stringify(porch));
  // Every lifecycle action on the owner's build, and every use of the owner's lease or claim, is refused.
  const rev = f.god.store.build('church')!.rev;
  for (const [path, body] of [['done', { force: true }], ['abandon', { undo: true, force: true }], ['pause', {}], ['resume', { take: true }]] as const) {
    const r = await f.post(`/v1/god/builds/church/${path}`, f.alice, body); assert.equal(r.ok, false, path); assert.equal(code(r), 'cobuilder.scope', `${path}: ${JSON.stringify(r)}`);
  }
  assert.equal(code(await f.post(`/v1/god/builds/church/claims/${porch.claim.id}/release`, f.alice, { done: true })), 'cobuilder.scope');
  assert.equal(code(await f.post('/v1/god/builds/church/step', f.alice, { lease: church.lease, n: 2 })), 'cobuilder.scope');
  assert.equal(code(await f.post('/v1/god/builds/church/step', f.alice, { claim: porch.claim.id, n: 2 })), 'cobuilder.scope');
  assert.equal(code(f.god.as({ identity: f.id(f.alice) }, () => f.god.act({ ops: [place('x', 1, 1, 'nave')], build: church }))), 'cobuilder.scope', 'even with the owner\'s lease');
  assert.equal(code(await f.post('/v1/god/act', f.alice, { ops: [place('x', -15, -15)], build: { id: 'church', claim: porch.claim.id } })), 'cobuilder.scope');
  assert.equal(f.god.store.build('church')!.rev, rev, 'nothing on the owner\'s build changed');
  // A stale claim of another account is not the co-builder's to take; the owner's take rules are unchanged.
  f.advance(130_000);
  assert.equal(code(await f.post('/v1/god/builds/church/claims', f.alice, { part: 'porch', take: porch.claim.id, region: { at: [-20, -20], size: [10, 10], yaw: 0 } })), 'cobuilder.scope');
  // Bob (another co-builder) cannot finish Alice's build; Alice's second agent (same account) can lead it.
  assert.equal(code(await f.post('/v1/god/builds/barn/done', f.bob, { force: true })), 'cobuilder.scope');
  assert.equal(code(await f.post(`/v1/god/builds/church/claims/${mine.claim.id}/release`, f.bob)), 'cobuilder.scope');
  assert.equal((await f.post('/v1/god/builds/barn/resume', f.alice2, { take: true })).ok, true);
  assert.equal((await f.post(`/v1/god/builds/church/claims/${mine.claim.id}/release`, f.alice2, { done: true })).ok, true);
  assert.equal((await f.post('/v1/god/builds/barn/done', f.alice2, {})).ok, true);
  // A co-builder may not mint helper tokens; owner tokens are unchanged and may finish anyone's build.
  const chapel = await f.start(f.alice, 'chapel', 400);
  assert.equal((await f.post('/v1/god/act', f.alice, { ops: [place('apse', 400, 0)], build: chapel })).accepted, true);
  const helperClaim = await f.post('/v1/god/builds/chapel/claims', f.alice, { part: 'apse', root: 'apse' }); assert.equal(helperClaim.ok, true);
  const mint = await f.call('POST', `/v1/god/builds/chapel/claims/${helperClaim.claim.id}/helper`, f.alice, {}); assert.equal(mint.status, 403); assert.equal(mint.data.code, 'cobuilder.scope');
  assert.equal(code(f.god.mintHelper('chapel', helperClaim.claim.id, {}, f.id(f.alice))), 'cobuilder.scope');
  assert.equal((await f.post('/v1/god/builds/chapel/done', f.owner, { force: true })).ok, true);
  assert.equal((await f.post('/v1/god/builds/church/done', f.owner, { force: true })).ok, true);
});

test('Y4b undo: a co-builder undoes and redoes only its own account\'s edits', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const act = async (token: string, ops: unknown[], group: string) => { const r = await f.post('/v1/god/act', token, { ops, group }); assert.equal(r.accepted, true, JSON.stringify(r)); };
  await act(f.alice, [place('hut', 100, 100)], 'alice-huts'); await act(f.alice2, [place('hut2', 104, 100)], 'alice-huts');
  await act(f.owner, [place('well', 0, 0)], 'square'); await act(f.bob, [place('cart', 50, 50)], 'bob-carts');
  const seq = f.god.model.editSeq;
  // Plain undo reverts the newest edit, which is Bob's: refused for Alice (owner tokens are unchanged).
  const head = await f.post('/v1/god/undo', f.alice); assert.equal(code(head), 'cobuilder.scope'); assert.match(head.failures[0].detail, /co-builder bob's work/);
  for (const group of ['square', 'bob-carts']) { const r = await f.post(`/v1/god/undo?group=${group}`, f.alice); assert.equal(code(r), 'cobuilder.scope', group); assert.deepEqual(r.reverted, []); }
  assert.match((await f.post('/v1/god/undo?group=square', f.alice)).failures[0].detail, /the world owner's work/);
  assert.equal(f.god.model.editSeq, seq);
  // Alice's agents share her account: either undoes the group whole.
  const undone = await f.post('/v1/god/undo?group=alice-huts', f.alice2); assert.equal(undone.accepted, true, JSON.stringify(undone)); assert.equal(undone.reverted.length, 2);
  assert.equal(f.god.model.get('hut'), undefined);
  // A group mixing accounts is refused whole for the co-builder (nothing reverted), and stays the owner's to undo.
  await act(f.alice, [place('stall', 110, 110)], 'market'); await act(f.owner, [place('fountain', 10, 10)], 'market');
  const mixed = await f.post('/v1/god/undo?group=market', f.alice); assert.equal(code(mixed), 'cobuilder.scope'); assert.deepEqual(mixed.reverted, []); assert.ok(f.god.model.get('stall'));
  // Redo: the owner's undo is not the co-builder's to redo.
  assert.equal((await f.post('/v1/god/undo', f.owner)).accepted, true); assert.equal(f.god.model.get('fountain'), undefined);
  assert.equal(code(await f.post('/v1/god/redo', f.alice)), 'cobuilder.scope');
  assert.equal((await f.post('/v1/god/redo', f.owner)).accepted, true, 'owner tokens are unchanged');
  assert.equal((await f.post('/v1/god/undo?group=market', f.owner)).accepted, true);
  // abandon --undo of the co-builder's own build is refused whole when the owner worked in it.
  const shed = await f.start(f.alice, 'shed', 300);
  assert.equal((await f.post('/v1/god/act', f.alice, { ops: [place('walls', 300, 0)], build: shed })).accepted, true);
  const door = await f.post('/v1/god/builds/shed/claims', f.owner, { part: 'door', root: 'walls' }); assert.equal(door.ok, true, JSON.stringify(door));
  assert.equal((await f.post('/v1/god/act', f.owner, { ops: [place('door', 1, 0, 'walls')], build: { id: 'shed', claim: door.claim.id } })).accepted, true);
  assert.equal((await f.post(`/v1/god/builds/shed/claims/${door.claim.id}/release`, f.owner, { done: true })).ok, true);
  const abandoned = await f.post('/v1/god/builds/shed/abandon', f.alice, { undo: true }); assert.equal(code(abandoned), 'build.undo-incomplete'); assert.equal(abandoned.causes[0].code, 'cobuilder.scope');
  assert.ok(f.god.model.get('walls'));
});

test('Y4b attribution: co-builder rows carry hash8, label and account; owner rows are unchanged', async t => {
  const f = fixture(); t.after(() => f.db.close());
  await f.post('/v1/god/act', f.alice, { ops: [place('hut', 100, 100)] }); await f.post('/v1/god/act', f.owner, { ops: [place('well', 0, 0)] });
  await f.post('/v1/god/undo', f.owner);
  const rows = f.god.store.edits(20), aliceRow = rows.find(r => r.label === 'cobuilder:alice:claude')!, ownerRow = rows.find(r => r.label === 'owner-agent' && r.kind === 'edit' && r.ops[0].op === 'place')!;
  assert.deepEqual({ hash8: aliceRow.hash8, acct: aliceRow.acct }, { hash8: hashToken(f.alice).slice(0, 8), acct: 'cobuilder:alice' });
  assert.deepEqual({ hash8: ownerRow.hash8, acct: ownerRow.acct }, { hash8: hashToken(f.owner).slice(0, 8), acct: null });
  assert.ok(rows.every(r => r.label), 'every row is attributed');
});

test('Y4b doctor: a co-builder\'s fix breaks only its own account\'s stale locks', async t => {
  const f = fixture(); t.after(() => f.db.close());
  await f.start(f.owner, 'church', 0); await f.start(f.alice, 'barn', 200);
  const ownerClaim = await f.post('/v1/god/builds/church/claims', f.owner, { part: 'porch', region: { at: [-20, -20], size: [10, 10], yaw: 0 } });
  const aliceClaim = await f.post('/v1/god/builds/barn/claims', f.alice, { part: 'loft', region: { at: [190, -10], size: [10, 10], yaw: 0 } });
  f.advance(400_000);
  const fixed = await f.post('/v1/god/doctor', f.alice, { fix: true });
  const lock = (id: string) => fixed.locks.find((l: any) => l.id === id);
  assert.equal(lock('church').fixed, undefined); assert.equal(lock(`church/${ownerClaim.claim.id}`).fixed, undefined);
  assert.equal(lock(`barn/${aliceClaim.claim.id}`).fixed, true);
  assert.equal(f.god.builds.claimState('church', ownerClaim.claim.id), 'held'); assert.equal(f.god.builds.claimState('barn', aliceClaim.claim.id), 'released');
  assert.equal((await f.post('/v1/god/doctor', f.owner, { fix: true })).locks.find((l: any) => l.id === `church/${ownerClaim.claim.id}`).fixed, true, 'owner tokens are unchanged');
});

test('Y4b fuzz: whatever co-builders send, world state (env, sky, time, weather, strikes) never changes', async t => {
  const f = fixture(); t.after(() => f.db.close());
  let seed = 5; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
  const state = JSON.stringify(f.god.model.state), patches = [{ weather: { kind: 'storm' } }, { weather: { rain: 1 } }, { sky: { palette: 'night' } }, { time: { set: { hour: 3, n: 1 } } }, { time: { paused: true } }, { weather: { strike: { x: 1, z: 1, n: 9, tick: 0 } } }, { ground: { palette: 'snow' } }];
  let refused = 0;
  for (let i = 0; i < 150; i++) {
    const who = pick([f.alice, f.alice2, f.bob]), route = pick(['act', 'dryrun', 'preview', 'env', 'strike'] as const);
    const body = route === 'env' ? { weather: { kind: pick(['rain', 'clear', 'storm']) }, hour: Math.floor(rnd() * 24) } : route === 'strike' ? { at: [Math.round(rnd() * 40), Math.round(rnd() * 40)] } : { ops: [...(rnd() < 0.5 ? [place(`p${i}`, 500 + i, 500)] : []), { op: 'world', state: pick(patches) }] };
    const r = await f.call('POST', `/v1/god/${route}`, who, body);
    if (r.status === 403 || r.data.accepted === false) refused++; else assert.fail(`${route} accepted: ${r.text}`);
  }
  assert.equal(refused, 150); assert.equal(JSON.stringify(f.god.model.state), state);
});

test('Y4b × Y5: rewind is a build-wide undo; co-builders rewind only their own account\'s builds and edits, helpers never', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const church = await f.start(f.owner, 'church', 0);
  for (const [name, step] of [['nave', 1], ['roof', 2]] as const) assert.equal(f.god.as({ identity: f.id(f.owner) }, () => f.god.act({ ops: [place(name, step * 10)], build: { ...church, step } })).accepted, true);
  const seq = f.god.model.editSeq, rev = f.god.store.build('church')!.rev;
  assert.equal(code(await f.post('/v1/god/builds/church/rewind', f.alice, { to: 0 })), 'cobuilder.scope');
  assert.equal(code(await f.post('/v1/god/builds/church/rewind', f.alice, { to: 1, dry: true })), 'cobuilder.scope');
  assert.equal(code(await f.post('/v1/god/undo?group=church', f.alice)), 'cobuilder.scope', 'undo --group <open build> is a rewind to the start');
  assert.equal(f.god.model.editSeq, seq); assert.equal(f.god.store.build('church')!.rev, rev); assert.ok(f.god.model.get('roof'));
  // Her own build rewinds; once the owner has worked inside it (through a claim), the rewind is refused whole.
  const barn = await f.start(f.alice, 'barn', 200);
  for (const [name, step] of [['loft', 1], ['hayrack', 2]] as const) assert.equal((await f.post('/v1/god/act', f.alice, { ops: [place(name, 190 + step * 5, 0)], build: { ...barn, step } })).accepted, true);
  const own = await f.post('/v1/god/builds/barn/rewind', f.alice2, { to: 1 }); assert.equal(own.ok, true, JSON.stringify(own)); assert.equal(f.god.model.get('hayrack'), undefined);
  const door = await f.post('/v1/god/builds/barn/claims', f.owner, { part: 'door', root: 'loft' });
  assert.equal((await f.post('/v1/god/act', f.owner, { ops: [place('door', 1, 0, 'loft')], build: { id: 'barn', claim: door.claim.id, step: 2 } })).accepted, true);
  await f.post(`/v1/god/builds/barn/claims/${door.claim.id}/release`, f.owner, { done: true });
  const mixed = await f.post('/v1/god/builds/barn/rewind', f.alice, { to: 0 }); assert.equal(code(mixed), 'cobuilder.scope'); assert.ok(f.god.model.get('loft/door')); assert.ok(f.god.model.get('loft'));
  assert.equal((await f.post('/v1/god/builds/barn/rewind', f.owner, { to: 0 })).ok, true, 'owner tokens are unchanged');
  // Helpers (here the owner's) never rewind, by route or through undo --group.
  const claim = await f.post('/v1/god/builds/church/claims', f.owner, { part: 'nave', root: 'nave' });
  const helper = (await f.post(`/v1/god/builds/church/claims/${claim.claim.id}/helper`, f.owner, {})).token as string;
  const routed = await f.call('POST', '/v1/god/builds/church/rewind', helper, { to: 0 }); assert.equal(routed.status, 403); assert.equal(routed.data.code, 'helper.scope');
  assert.equal(code(await f.post('/v1/god/undo?group=church', helper)), 'helper.scope'); assert.ok(f.god.model.get('roof'));
});

test('Gene 2026-10-16, one god per world: co-builders are off by default; their tokens are refused with a reason, owner and helper rules hold', async t => {
  const f = fixture(false); t.after(() => f.db.close());
  assert.equal(f.god.godIdentity(f.alice), null, 'a co-builder token is no god token while co-builders are off');
  assert.equal(f.god.godFromToken(f.bob), false);
  for (const [method, path, body] of [['POST', '/v1/god/act', { ops: [place('nope', 50, 50)] }], ['POST', '/v1/god/builds', { id: 'shed', title: 'shed', steps: ['shell'], site: site(300) }], ['GET', '/v1/god/edits?limit=1', undefined]] as const) {
    const r = await f.call(method, path, f.alice, body); assert.equal(r.status, 403, `${path}: ${r.text}`); assert.equal(r.data.code, 'cobuilder.disabled');
    assert.match(r.data.message, /one god/);
  }
  assert.equal(f.god.model.get('nope'), undefined);
  assert.equal((await f.call('GET', '/v1/god/status', f.alice)).data.code, 'cobuilder.disabled', 'even status names the reason');
  assert.equal(f.god.cobuilderRefusal(f.owner), null); assert.equal(f.god.cobuilderRefusal('god_unknown'), null); assert.equal(f.god.cobuilderRefusal(undefined), null);
  // The owner works as before, and Y5 rewind still refuses helper tokens (by route and through undo --group).
  const church = await f.start(f.owner, 'church', 0);
  assert.equal(f.god.as({ identity: f.id(f.owner) }, () => f.god.act({ ops: [place('nave', 10)], build: { ...church, step: 1 } })).accepted, true);
  const claim = await f.post('/v1/god/builds/church/claims', f.owner, { part: 'nave', root: 'nave' });
  const helper = (await f.post(`/v1/god/builds/church/claims/${claim.claim.id}/helper`, f.owner, {})).token as string;
  assert.equal(f.god.cobuilderRefusal(helper), null, "an owner's helper is not a co-builder");
  const routed = await f.call('POST', '/v1/god/builds/church/rewind', helper, { to: 0 }); assert.equal(routed.status, 403); assert.equal(routed.data.code, 'helper.scope');
  assert.equal(code(await f.post('/v1/god/undo?group=church', helper)), 'helper.scope'); assert.ok(f.god.model.get('nave'));
  await f.post(`/v1/god/builds/church/claims/${claim.claim.id}/release`, f.owner, { done: true });
  const rewound = await f.post('/v1/god/builds/church/rewind', f.owner, { to: 0 }); assert.equal(rewound.ok, true, JSON.stringify(rewound)); assert.equal(f.god.model.get('nave'), undefined);
});
