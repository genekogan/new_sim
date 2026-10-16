import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Hono} from 'hono';
import {Auth} from './auth.ts';
import {config} from './config.ts';
import {Db} from './db.ts';
import {ensureCommsSchema} from './edge/comms/store.ts';
import {EventStreams} from './edge/comms/stream.ts';
import {ensureWorldSchema} from './god/store.ts';
import type {GodMode} from './god/god.ts';
import {ApiError, type Souls} from './souls.ts';
import {FeedbackLog, WelcomeService, mountWelcomeRoutes, feedbackIp, AWAY_SCAN} from './welcome.ts';
import type {WorldHost} from './world.ts';

function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'welcome-server-')), path = join(dir, 'test.db');
  const db = new Db(path), cfg = {...config, dataDir: dir, worldId: 'welcome-a', ownerId: 'dev:alice', build: 'fixture-build', accountAuthRequired: false};
  db.createWorld({id: cfg.worldId, schema: 'test', rules_version: 'test', dt: .1, seed: 'test'});
  db.createWorld({id: 'welcome-b', schema: 'test', rules_version: 'test', dt: .1, seed: 'test'});
  for (const id of ['dev:alice', 'dev:bob']) db.upsertUser({id, role: 'user', email: null, wallet: null});
  const host = {worldId: cfg.worldId, engine: {world: {tick: 42}}} as WorldHost;
  const souls = {ownedRows: (id: string) => db.liveSouls(cfg.worldId).filter(s => s.owner === id)} as Souls;
  const auth = new Auth(cfg, db); auth.devAuth = true;
  const god = {owner: 'dev:alice'} as GodMode, d = {cfg, db, host, souls, auth, god};
  const app = new Hono();
  app.onError((error, c) => error instanceof ApiError ? c.json({code: error.code, message: error.message}, error.status as 400) : c.json({message: String(error)}, 500));
  const service = mountWelcomeRoutes(app, d);
  t.after(() => {try {db.close();} catch {} rmSync(dir, {recursive: true, force: true});});
  const request = (url: string, data?: unknown, token?: string, ip = '198.51.100.1') => app.request(url, {method: data === undefined ? 'GET' : 'POST', headers: {'x-forwarded-for': ip, ...(token ? {authorization: 'Bearer ' + token} : {}), ...(data === undefined ? {} : {'content-type': 'application/json'})}, ...(data === undefined ? {} : {body: JSON.stringify(data)})});
  return {dir, path, db, d, app, service, request, alice: db.user('dev:alice')!, bob: db.user('dev:bob')!};
}
function birth(db: Db, worldId: string, seq: number, id: string, owner: string, name: string) {
  db.createSoul({id, worldId, owner, entityId: 'h_' + id, name, description: 'fixture', native: false});
  db.appendEvent(worldId, {seq, at: 1000, tick: 40, kind: 'birth', author: owner, payload: {soulId: id, entityId: 'h_' + id, name, owner}});
}

test('public contextual feedback gives a durable receipt; exact owner reads, other account and anonymous cannot', async t => {
  const f = fixture(t), body = {text: 'The selected bench is hard to reach.', residentId: 's_resident', placeId: 'harbour', tick: 42, eventId: 'c_9', clientTime: '2026-10-15T12:00:00.000Z', camera: {position: [1, 2, 3], target: [4, 5, 6], fov: 50}};
  const response = await f.request('/v1/feedback', body);
  assert.equal(response.status, 201); assert.equal(response.headers.get('cache-control'), 'no-store');
  const receipt = await response.json() as {id: string; message: string};
  assert.match(receipt.id, /^fb_[a-f0-9]{32}$/); assert.equal(receipt.message, 'We got it.');
  const stored = JSON.parse(readFileSync(f.service.feedback.file, 'utf8'));
  assert.deepEqual(stored.camera, body.camera); assert.equal(stored.worldId, 'welcome-a'); assert.equal(stored.build, 'fixture-build'); assert.equal(stored.accountId, null); assert.equal(stored.serverTick, 42);
  assert.equal((await f.request('/v1/feedback')).status, 401);
  assert.equal((await f.request('/v1/feedback', undefined, 'dev:bob')).status, 403);
  const reader = await f.request('/v1/feedback?limit=-9', undefined, 'dev:alice'); assert.equal(reader.status, 200);
  const result = await reader.json() as {entries: {id: string}[]}; assert.equal(result.entries[0]!.id, receipt.id);
  assert.equal((await f.request('/v1/feedback', {...body, worldId: 'spoofed'})).status, 400);
  assert.equal((await f.request('/v1/feedback', {...body, text: ' '.repeat(5)})).status, 400);
  assert.equal((await f.request('/v1/feedback', {...body, text: 'x'.repeat(4001)})).status, 400);
  assert.equal((await f.request('/v1/feedback', {...body, camera: {position: [null, 0, 0]}})).status, 400);
  assert.equal((await f.request('/v1/feedback', {text: 'No selection yet', residentId: null, placeId: null, tick: null, camera: null})).status, 201);
});

test('feedback uses the direct network peer or the nearest forwarded proxy hop', async () => {
  const app = new Hono(); app.get('/', c => c.text(feedbackIp(c)));
  const request = (remote: string, chain: string) => app.request('/', {headers: {'x-forwarded-for': chain}}, {incoming: {socket: {remoteAddress: remote}}});
  assert.equal(await (await request('198.51.100.8', 'fake-one')).text(), '198.51.100.8');
  assert.equal(await (await request('127.0.0.1', 'fake-one, 198.51.100.8')).text(), '198.51.100.8');
  assert.equal(await (await request('127.0.0.1', 'fake-two, 198.51.100.8')).text(), '198.51.100.8');
});

test('feedback rate limits independently bind IP and account and survive service recreation', t => {
  const f = fixture(t), now = 120000;
  for (let n = 0; n < 5; n++) f.service.submit({text: 'anonymous ' + n}, null, 'same-ip', now);
  assert.throws(() => f.service.submit({text: 'overflow'}, f.alice, 'same-ip', now), error => error instanceof ApiError && error.status === 429);
  for (let n = 0; n < 5; n++) f.service.submit({text: 'account ' + n}, f.alice, 'changing-ip-' + n, now);
  const recreated = new WelcomeService(f.d);
  assert.throws(() => recreated.submit({text: 'account overflow'}, f.alice, 'new-ip', now), error => error instanceof ApiError && error.status === 429);
  recreated.submit({text: 'new window'}, f.alice, 'same-ip', now + 60000);
  assert.equal(readFileSync(recreated.feedback.file, 'utf8').includes('changing-ip'), false, 'raw IPs never enter feedback files');
});

test('feedback cap retains complete newest JSONL entries and survives reopening', t => {
  const f = fixture(t), log = new FeedbackLog(join(f.dir, 'small-log'), 'welcome-a', 1100);
  for (let i = 0; i < 12; i++) log.append({id: 'fb_' + i, text: 'message ' + i + ' ' + 'x'.repeat(100), worldId: 'welcome-a', build: 'test', receivedAt: i, serverTick: i, accountId: null});
  assert.ok(statSync(log.file).size <= 1100); const read = new FeedbackLog(join(f.dir, 'small-log'), 'welcome-a', 1100).read(100);
  assert.equal(read[0]!.id, 'fb_11'); assert.ok(read.length < 12); assert.ok(read.every(row => row.worldId === 'welcome-a'));
});

test('away cutoff is durable, source-sequenced, scoped to owned residents and selected owned world', async t => {
  const f = fixture(t), world = f.d.host.worldId;
  birth(f.db, world, 1, 's_alice', f.alice.id, 'Aster'); birth(f.db, world, 2, 's_bob', f.bob.id, 'Birch');
  birth(f.db, 'welcome-b', 1, 's_foreign', f.alice.id, 'FOREIGN_WORLD_SECRET');
  ensureCommsSchema(f.db.db); ensureWorldSchema(f.db);
  const streams = new EventStreams(f.db.db, world, {retainEvents: 1000, retainMs: 1e9, now: () => 1000});
  streams.deliver('s_alice', 'conversation.turn', 41, {conversation: 'old', turn: {text: 'BEFORE_VISIT'}});
  const first = f.service.away(f.alice, 1000); assert.equal(first.firstVisit, true); assert.deepEqual(first.residents[0]!.events, []);
  f.service.visit(f.alice, {through: first.through}, 1000);
  // Same wall timestamp after the cutoff still appears: source sequence wins.
  streams.deliver('s_alice', 'arrive', 42, {placePath: ['Harbour'], where: {place: 'Harbour'}});
  streams.deliver('s_alice', 'conversation.turn', 42, {conversation: 'cv_new', turn: {from: {soulId: 's_bob', name: 'Birch'}, text: 'Shall we visit the harbour?'}});
  streams.deliver('s_alice', 'receipt', 43, {receipt: {capability: 'walk', phase: 'completed'}, private_token: 'NEVER_RAW'});
  streams.deliver('s_bob', 'conversation.turn', 43, {conversation: 'private-bob', turn: {text: 'BOB_PRIVATE_SECRET'}});
  birth(f.db, world, 3, 's_new', 'someone', 'Cedar');
  f.db.db.prepare('INSERT INTO world_edits_v1(world_id,seq,by,at,ops,inverse,kind) VALUES(?,?,?,?,?,?,?)').run(world, 1, 'god', 1000, JSON.stringify([{op: 'place', name: 'Garden bench'}, {op: 'world', state: {weather: {kind: 'rain'}}}]), '[]', 'edit');
  f.db.db.prepare('INSERT INTO world_edits_v1(world_id,seq,by,at,ops,inverse,kind) VALUES(?,?,?,?,?,?,?)').run('welcome-b', 1, 'god', 1000, JSON.stringify([{op: 'place', name: 'FOREIGN_BUILD_SECRET'}]), '[]', 'edit');
  const returned = new WelcomeService(f.d).away(f.alice, 2000), text = JSON.stringify(returned);
  assert.equal(returned.since, 1000); assert.equal(returned.firstVisit, false); assert.equal(returned.residents.length, 1); assert.equal(returned.residents[0]!.conversations, 1); assert.deepEqual(returned.residents[0]!.places, ['Harbour']);
  assert.ok(text.includes('Shall we visit')); assert.ok(text.includes('walk completed')); assert.ok(text.includes('Garden bench')); assert.ok(text.includes('Weather changed to rain')); assert.ok(text.includes('Cedar arrived'));
  for (const marker of ['BEFORE_VISIT', 'BOB_PRIVATE_SECRET', 'FOREIGN_WORLD_SECRET', 'FOREIGN_BUILD_SECRET', 'NEVER_RAW']) assert.equal(text.includes(marker), false, marker);
  const bob = f.service.away(f.bob, 2000); assert.equal(bob.world.owned, false); assert.deepEqual(bob.world.changes, []); assert.equal(bob.residents[0]!.id, 's_bob');
  assert.equal((await f.request('/v1/me/away')).status, 401); assert.equal((await f.request('/v1/me/visit', {})).status, 401);
  assert.throws(() => f.service.visit(f.alice, {through: 900000}, 2000), error => error instanceof ApiError && error.status === 409);
  f.service.visit(f.alice, {through: returned.through}, 2000);
  assert.deepEqual(f.service.away(f.alice, 3000).residents[0]!.events, []);
  f.service.visit(f.alice, {}, 4000); assert.equal(f.service.away(f.alice, 5000).since, 4000);
});

test('new owned edge resident is reported from canonical birth even without a stream', t => {
  const f = fixture(t), world = f.d.host.worldId;
  ensureCommsSchema(f.db.db); f.service.visit(f.alice, {}, 1000);
  birth(f.db, world, 1, 's_new_owned', f.alice.id, 'Dahlia');
  const returned = f.service.away(f.alice, 2000);
  assert.equal(returned.residents[0]!.events[0]!.text, 'Dahlia arrived.');
  assert.equal(returned.residents[0]!.events[0]!.id, 'event_1');
});

test('away honestly marks pruned and capped history; heartbeat only advances its owner cutoff', t => {
  const f = fixture(t), world = f.d.host.worldId; birth(f.db, world, 1, 's_alice', f.alice.id, 'Aster');
  ensureCommsSchema(f.db.db); const streams = new EventStreams(f.db.db, world, {retainEvents: 1000, retainMs: 1e9, now: () => 1000});
  f.service.visit(f.alice, {}, 1000);
  for (let i = 0; i < AWAY_SCAN + 3; i++) streams.deliver('s_alice', 'arrive', i, {placePath: ['Place ' + i]});
  const report = f.service.away(f.alice, 2000); assert.equal(report.incomplete, true); assert.equal(report.residents[0]!.events.length, 5); assert.equal(report.residents[0]!.places.length, 4);
  f.db.db.prepare('UPDATE edge_comms_heads SET floor=20 WHERE world_id=? AND soul_id=?').run(world, 's_alice');
  assert.equal(f.service.away(f.alice, 2001).residents[0]!.incomplete, true);
  f.service.visit(f.bob, {}, 3000); assert.equal(f.service.away(f.alice, 4000).since, 1000);
  const latest = f.service.away(f.alice, 5000); f.service.visit(f.alice, {}, 6000);
  assert.equal(f.service.visit(f.alice, {through: latest.through}, 6001).visitedAt, 6000, 'stale tab cannot move the cutoff backwards');
});
