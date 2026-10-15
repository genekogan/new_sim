import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {Hono} from 'hono';
import {coreRef} from '@sim/world-compiler';
import {fixture, factory} from '../../test/native-owner-fixture.ts';
import {EdgeLedger} from '../edge/ledger/ledger.ts';
import {ApiError} from '../souls.ts';
import {GodMode} from './god.ts';
import {installEngineBridge} from './engine-bridge.ts';
import {VerifyUse} from './verify-use.ts';
import {mountGodRoutes} from './routes.ts';
import {PROBE_OWNER, isVerificationProbe} from '../verification-probe.ts';
import {installBirthLooks} from './birth-look.ts';
import {seatProviders} from './query.ts';

function world(t: TestContext) {
  const w = fixture(':memory:', factory, {durableClockV1: true});
  w.brain.quiesce();
  const god = new GodMode(w.db, {worldId: w.host.worldId, ownerId: 'owner', tick: () => w.host.engine.world.tick, emit() {}});
  const edge = new EdgeLedger(w.host, w.db), bridge = installEngineBridge({host: w.host, god, edge, log() {}, worldClock: false, worldLore: false});
  const verify = new VerifyUse(w.host, w.souls, god, edge);
  const app = new Hono(), token = god.mintFor({id: 'owner', role: 'user'}, 'test');
  mountGodRoutes(app, {god, worldName: 'Probe fixture', requireUser: async () => {throw new ApiError(401, 'unauthorized', 'test');}, soulFromBearer: () => null, baseOf: () => 'http://127.0.0.1:5360', limitIp() {}, verifyUse: verify});
  app.onError((e, c) => c.json({code: (e as ApiError).code ?? 'internal', message: e.message}, ((e as ApiError).status ?? 500) as 400));
  t.after(() => {w.brain.quiesce(); w.host.stop(); edge.comms?.close(); w.db.close();});
  const settle = async (n = 3) => {for (let i = 0; i < n; i++) {w.host.tickOnce(); await setImmediate(); w.host.drainInputs();}};
  const build = async (seat = true, blocked = false) => {
    const r = god.act({ops: [
      {op: 'define', def: {schema: 'def/1', name: 'verify-house', version: 1, tags: ['building'], size: {box: [8, 3, 6]}, make: {kind: 'gen', gen: 'building/1', args: {style: 'shed'}}, params: {floors: {type: 'int', min: 1, max: 6, default: 1}}, components: {foundation: {kind: 'none'}}}},
      {op: 'place', tmp: '$h', def: 'verify-house@1', name: 'house', p: [10, 0]},
      ...(seat ? [{op: 'place', def: coreRef('chair'), name: 'chair', in: {parent: '$h', slot: 'ground'}, p: [-2, 0, -1]}] : []),
      ...(blocked ? [{op: 'place', def: coreRef('wall'), name: 'door-blocker', p: [10, 3.75], params: {w: 5, h: 3, d: 1}}] : []),
    ]});
    assert.equal(r.accepted, true, JSON.stringify(r)); await settle();
  };
  const drive = async <T>(work: Promise<T>): Promise<T> => {
    let done = false; void work.then(() => {done = true;}, () => {done = true;});
    const deadline = performance.now() + 15_000;
    while (!done && performance.now() < deadline) {for (let i = 0; i < 4; i++) w.host.tickOnce(); await new Promise(r => setTimeout(r, 1));}
    assert.ok(done, 'bounded native fixture drive'); return work;
  };
  const request = (body: unknown, auth = true) => app.request('/v1/god/verify-use', {method: 'POST', headers: {'content-type': 'application/json', ...(auth ? {authorization: `Bearer ${token}`} : {})}, body: JSON.stringify(body)});
  const removed = () => {
    assert.equal([...w.host.minds.keys()].some(isVerificationProbe), false);
    assert.equal(Object.keys(w.host.engine.world.entities).some(id => id.startsWith('h_verify_')), false);
    assert.equal([...god.model.entities.keys()].some(id => id.startsWith('h_verify_')), false);
    const rows = w.db.db.prepare('SELECT * FROM souls WHERE owner=?').all(PROBE_OWNER) as {retired_at: number | null; token_hash: string | null}[];
    for (const row of rows) {assert.notEqual(row.retired_at, null); assert.equal(row.token_hash, null);}
    return rows;
  };
  return {...w, god, edge, bridge, verify, settle, build, drive, request, app, removed};
}

test('real probe enters through a door, sits in a seat slot, retires; authored world stays unchanged', {timeout: 30_000}, async t => {
  const w = world(t); await w.build();
  const before = structuredClone([...w.god.model.entities.values()]);
  const response = await w.drive(Promise.resolve(w.request({target: 'house', timeoutMs: 12_000})));
  assert.equal(response.status, 200); const r = await response.json() as any;
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.probe.removed, true);
  const enter = r.uses.find((x: any) => x.use === 'enter'), sit = r.uses.find((x: any) => x.use === 'sit');
  assert.equal(enter.ok, true); assert.ok(enter.crossing); assert.match(enter.door, /door/); assert.ok(enter.crossing.distToDoor < 1);
  assert.equal(sit.ok, true); assert.equal(sit.seat, 'house/chair'); assert.match(sit.occupant, /^verifier probe /); assert.ok(sit.distanceToSlot <= 0.6);
  assert.equal(w.removed().length, 1); assert.deepEqual([...w.god.model.entities.values()], before);
  assert.deepEqual(w.host.engine.runtime.violations, []);
  assert.equal(w.god.store.prayers({unanswered: false}).length, 0);
  const log = w.db.events(w.host.worldId, 0, 1000), birth = log.find(e => e.kind === 'birth' && isVerificationProbe(e.payload.soulId));
  assert.ok(birth); assert.match(birth.author, /^verify-use:/);
  assert.ok(log.some(e => e.kind === 'retire' && e.payload.soulId === birth.payload.soulId));
  assert.equal(log.filter(e => /^brain:/.test(e.author)).length, 0);
});

test('solid thing across the only doorway cannot produce a successful entry', {timeout: 30_000}, async t => {
  const w = world(t); await w.build(true, true);
  const r = await w.drive(w.verify.run({target: 'house', uses: ['enter'], timeoutMs: 2000}));
  assert.equal(r.ok, false, JSON.stringify(r)); assert.equal(r.uses[0].ok, false); assert.ok(r.uses[0].reason); assert.equal(r.probe.removed, true); w.removed();
});

test('seatless target returns verify.no-seat', async t => {
  const w = world(t); await w.build(false);
  const r = await w.drive(w.verify.run({target: 'house', uses: ['sit'], timeoutMs: 1000}));
  assert.equal(r.uses[0].reason?.code, 'verify.no-seat'); assert.equal(r.probe.removed, true); w.removed();
});

test('explicit seat and coordinate start work; a foreign seat is refused', async t => {
  const w = world(t); await w.build();
  const r = await w.drive(w.verify.run({target: 'house', seat: 'house/chair', from: [10, 7], timeoutMs: 10_000}));
  assert.equal(r.ok, true, JSON.stringify(r)); w.removed();
  const other = w.god.act({ops: [{op: 'place', def: coreRef('chair'), name: 'foreign-chair', p: [20, 0]}]}); assert.equal(other.accepted, true); await w.settle();
  const refused = await w.drive(w.verify.run({target: 'house', uses: ['sit'], seat: 'foreign-chair'}));
  assert.equal(refused.uses[0].reason?.code, 'verify.no-seat'); assert.equal(refused.probe.removed, true); w.removed();
  const absent = await w.verify.run({target: 'house', from: 'unknown-start'}); assert.equal(absent.reason?.code, 'verify.no-target');
});

test('reserved probes never enter any model work even when Brain mode is live', async t => {
  const w = world(t), brain = w.brain as any;
  installBirthLooks(w.host, w.edge);
  brain.quiescing = false; brain.mode = 'live';
  let attempts = 0;
  for (const work of ['attuneWork', 'evaluateWork', 'reflectWork', 'compileWork', 'translateWork', 'shotForWork', 'speakWork']) t.mock.method(brain, work, async () => {attempts++; throw Error('probe must never call model work');});
  const created = w.souls.createVerificationProbe(); w.host.drainInputs(); await created.ready;
  const m = w.host.minds.get(created.soul.id)!;
  await brain.evaluate(m, 'birth'); await brain.attune(m); await brain.reflect(m, 1); await brain.compile(m, 'think'); await brain.translate(m, 'think'); await brain.shotFor(m); await brain.speak(m.soulId, m.soulId, 'chat');
  for (let i = 0; i < 80; i++) w.host.tickOnce();
  assert.equal(attempts, 0); assert.deepEqual(w.souls.ownedRows('owner'), []);
  assert.equal(brain.tickerCandidates.some((e: any) => e.text.includes('verifier probe')), false);
  assert.equal(brain.shotCandidates().some((c: any) => c.spec.subject === m.entityId), false);
  assert.equal(w.db.events(w.host.worldId, 0, 1000).some(e => e.kind === 'body-assignment-v1'), false);
  assert.throws(() => w.souls.pairCode(created.soul, 'http://127.0.0.1:5360'), /not currently admitted and ready/);
  const retired = w.souls.retire(created.soul); w.host.drainInputs(); await retired; await w.settle(); w.removed();
});

test('a roomless area uses its actual footprint and supports a reference start', async t => {
  const w = world(t);
  const r = w.god.act({ops: [
    {op: 'place', def: coreRef('plaza'), name: 'court', shape: {area: [[-16, -8], [-8, -8], [-8, 0], [-16, 0]]}},
    {op: 'place', def: coreRef('flag'), name: 'start', p: [-4, 4]},
  ]}); assert.equal(r.accepted, true, JSON.stringify(r)); await w.settle();
  const result = await w.drive(w.verify.run({target: 'court', from: 'start', uses: ['enter'], timeoutMs: 10_000}));
  assert.equal(result.ok, true, JSON.stringify(result)); assert.ok(result.uses[0].crossing); assert.equal(result.uses[0].door, undefined); assert.equal(result.probe.removed, true); w.removed();
  const fallback = await w.drive(w.verify.run({target: 'court', uses: ['enter'], timeoutMs: 10_000}));
  assert.equal(fallback.ok, true, JSON.stringify(fallback)); w.removed();
});

test('a changed target refuses a stale geometric receipt and still removes the probe', async t => {
  const w = world(t); await w.build(); let edited = false;
  w.host.listeners.push({afterTick: () => {
    if (edited || ![...w.host.minds.values()].some(m => isVerificationProbe(m.soulId) && (w.host.engine.world.entities[m.entityId] as any)?.human?.activity === 'walk')) return;
    edited = true; assert.equal(w.god.act({ops: [{op: 'set', id: 'house', name: 'house-renamed'}]}).accepted, true);
  }});
  const r = await w.drive(w.verify.run({target: 'house', uses: ['enter'], timeoutMs: 10_000}));
  assert.equal(edited, true); assert.equal(r.ok, false); assert.equal(r.uses[0].reason?.engineCode, 'revision.stale'); assert.equal(r.probe.removed, true); w.removed();
});

test('kit PNG route preserves binary bytes and returns 404 when absent', async t => {
  const w = world(t), realRead = fs.readFileSync;
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 128, 254]);
  let missing = false;
  const mock = t.mock.method(fs, 'readFileSync', ((file: any, ...args: any[]) => {
    if (String(file).endsWith('/reference/kit-primitives.png')) { if (missing) throw Error('ENOENT'); return bytes; }
    return (realRead as any)(file, ...args);
  }) as typeof fs.readFileSync);
  syncBuiltinESMExports(); t.after(() => {mock.mock.restore(); syncBuiltinESMExports();});
  const response = await w.app.request('/god/kit-primitives.png');
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/png'); assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  missing = true; assert.equal((await w.app.request('/god/kit-primitives.png')).status, 404);
});

test('paused clock times out, retires even a queued action, and releases busy lock', async t => {
  const w = world(t); await w.build();
  const first = w.verify.run({target: 'house', timeoutMs: 35});
  const busy = await new VerifyUse(w.host, w.souls, w.god, w.edge).run({target: 'house'});
  assert.equal(busy.reason?.code, 'verify.busy'); assert.equal(w.db.db.prepare('SELECT COUNT(*) AS n FROM souls WHERE owner=?').get(PROBE_OWNER)?.n, 1);
  const r = await first; assert.equal(r.ok, false); assert.equal(r.uses[0].reason?.code, 'verify.timeout'); assert.equal(r.probe.removed, true); w.removed();
  await w.settle(3); w.removed();
  const next = await w.verify.run({target: 'missing'}); assert.equal(next.reason?.code, 'verify.no-target');
});

test('a sit label without the probe occupant cannot pass; paused native cleanup stays busy until resumed', {timeout: 12_000}, async t => {
  const w = world(t); await w.build();
  const occupants = seatProviders.get(w.god.model)!;
  // Native engine still sits normally. Falsify only the public occupant read:
  // the receipt must refuse rather than accept the engine's sit label alone.
  seatProviders.set(w.god.model, id => occupants(id).map(o => ({...o, soul: 'another resident'})));
  const pending = w.verify.run({target: 'house', uses: ['sit'], timeoutMs: 1000});
  let seated = false;
  const deadline = performance.now() + 800;
  while (!seated && performance.now() < deadline) {
    await w.settle(4);
    seated = [...w.host.minds.values()].some(m => isVerificationProbe(m.soulId) && (w.host.engine.world.entities[m.entityId] as any)?.human?.activity === 'sit');
  }
  assert.equal(seated, true, 'the actual native body sat before the proof deadline');
  // Stop advancing the fixture clock while its normal sit-release is owed.
  const result = await pending;
  assert.equal(result.ok, false); assert.equal(result.uses[0].reason?.code, 'verify.timeout'); assert.equal(result.probe.removed, false);
  const busy = await w.verify.run({target: 'house'}); assert.equal(busy.reason?.code, 'verify.busy');
  seatProviders.set(w.god.model, occupants);
  await w.settle(80); w.removed();
  const next = await w.verify.run({target: 'missing'}); assert.equal(next.reason?.code, 'verify.no-target');
});

test('god auth, malformed input and schema are handled without internal errors', async t => {
  const w = world(t);
  assert.equal((await w.request({target: 'house'}, false)).status, 401);
  for (const input of [null, {}, {target: 'house', timeoutMs: 180001}, {target: 'house', uses: ['fly']}]) {
    const res = await w.request(input); assert.equal(res.status, 200); const r = await res.json() as any; assert.equal(r.reason.code, 'verify.refused');
  }
  const res = await w.app.request('/v1/god/schema'), schema = await res.json() as any;
  assert.ok(schema.endpoints.god.includes('POST /v1/god/verify-use')); assert.ok(schema.refusals.includes('verify.busy'));
  assert.equal(w.removed().length, 0);
});
