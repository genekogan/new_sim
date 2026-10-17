// GET /v1/world/visitors on every world (lane L2, 2026-10-17): a world without travel (no Godmode: the original worlds and
// their forks on the legacy stage) answers "travel not available, nobody visiting" instead of a 404 in each visitor's console.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from '../test/native-owner-fixture.ts';
import {buildApp} from './http.ts';
import {config} from './config.ts';
import {GodMode} from './god/god.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';

const cfg = (port: number) => ({...config, port, worldPath: '/w/eden', publicUrl: `http://127.0.0.1:${port}/w/eden`, accountAuthRequired: false, webDir: '/nonexistent-visitors-fixture', marsWebDir: '/nonexistent-visitors-fixture'});
const hub = {clients: new Map(), refreshMe() {}} as never;

test('a world without Godmode (an original world fork) answers the visitors read: not available, nobody visiting', async t => {
  const f = fixture(':memory:'); f.brain.quiesce(); t.after(() => { f.host.stop(); f.db.close(); });
  const app = buildApp({cfg: cfg(5962), db: f.db, host: f.host, auth: f.auth, brain: f.brain, souls: f.souls, edge: new EdgeLedger(f.host, f.db), hub});
  const r = await app.request('/v1/world/visitors');
  assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await r.json(), {contract: 'travel/1', world: config.worldKey, available: false, open: false, visitors: [], recent: []});
  assert.equal((await app.request('/v1/god/visitors', {method: 'POST', body: '{"open":true}'})).status, 404, 'no travel controls appear');
});

test('a Godmode world keeps its travel answer (open, its own visitors)', async t => {
  const f = fixture(':memory:'); f.brain.quiesce(); t.after(() => { f.host.stop(); f.db.close(); });
  const god = new GodMode(f.db, {worldId: f.host.worldId, ownerId: 'dev:alice', tick: () => f.host.engine.world.tick, emit() {}});
  const app = buildApp({cfg: cfg(5963), db: f.db, host: f.host, auth: f.auth, brain: f.brain, souls: f.souls, edge: new EdgeLedger(f.host, f.db), god, hub});
  const r = await app.request('/v1/world/visitors'), d = await r.json() as Record<string, unknown>;
  assert.equal(r.status, 200); assert.equal(d.contract, 'travel/1'); assert.equal(d.open, true); assert.deepEqual(d.visitors, []); assert.equal('available' in d, false);
});
