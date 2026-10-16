// todo lane (R4): fishing from a pond bank, feeding the koi, tending the garden beds. Ordinary resident commands, honest
// verdicts (no ducks here: refused, never swapped), visible pose state (activity + prop), exact replay.
import test from 'node:test';
import assert from 'node:assert/strict';
import {kernelHash} from '@sim/kernel';
import {edenNavWorld, factory, WORLD_SPOTS} from '../test/eden-nav-fixture.ts';
import {WorldHost} from './world.ts';
import {loadSpots} from './edge/ledger/activities.ts';

async function world(n: number) {
  const w = await edenNavWorld(n, {cn5: true, spots: WORLD_SPOTS});
  const body = (s: {entityId: string}) => (w.engine.world.entities as any)[s.entityId];
  const act = async (s: typeof w.souls[number], capability: string, params?: object) => (await w.act(s, capability, params)) as any;
  const done = async (s: typeof w.souls[number], out: any, limit = 20 * 60 * 5, each?: () => void) => {await w.run([{soulId: s.soulId, id: out.receipt.id}], limit, each); return w.ledger.receipt(s.soulId, out.receipt.id)!;};
  const seen = (s: typeof w.souls[number], out: any, activity: string, limit?: number) => {let got: any = null; return done(s, out, limit, () => {const h = body(s).human; if (h.activity === activity) got ??= {base: h.baseActivity, prop: h.prop, at: [body(s).pose.p[0], body(s).pose.p[2]]};}).then(r => ({r, got}));};
  const replayExact = async () => {
    w.f.host.drainInputs(); w.f.host.saveSnapshot(true); const head = {engine: w.f.host.engine.stateHash(), kernel: kernelHash(w.f.host.kernel)};
    w.f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(w.f.host.worldId);
    const h = new WorldHost(w.f.db, await factory(), w.f.host.seed, 1e9, w.f.host.worldId, {durableClockV1: true}); assert.equal(h.boot().from, 'genesis');
    assert.deepEqual({engine: h.engine.stateHash(), kernel: kernelHash(h.kernel)}, head, 'replay exact'); h.stop();
  };
  return {...w, body, act, done, seen, replayExact};
}

test('leisure spots: World file loads with every fishing, feeding and garden spot accepted', () => {
  const out = loadSpots(WORLD_SPOTS); assert.deepEqual(out.refused, []);
  for (const id of ['fish-shore-1', 'feed-park-1', 'garden-bed-1']) assert.ok(out.data.spots.some(s => s.id === id), id);
});

test('leisure: go fishing, feed the koi, tend the beds; ducks are refused, not swapped', {timeout: 1800000}, async t => {
  const w = await world(3); t.after(() => {w.f.host.stop(); w.f.db.close();});
  const [a, b, c] = w.souls;
  // fishing from the shore-pond bank
  const fish = await w.act(a, 'go fishing', {seconds: 6}); assert.equal(fish.accepted, true, JSON.stringify(fish)); assert.match(fish.resolved?.to, /^fish:fish-/);
  const f1 = await w.seen(a, fish, 'fish'); assert.equal(f1.r.phase, 'completed'); assert.equal(f1.got?.prop, 'rod');
  // ducks are not here: honest refusal naming the koi
  const duck = await w.act(b, 'feed the ducks'); assert.equal(duck.accepted, false); assert.match(duck.reason ?? duck.refusal?.reason ?? JSON.stringify(duck), /no ducks/i);
  // koi: fed at a marked bank, with bread in hand
  const koi = await w.act(b, 'feed the koi', {seconds: 6}); assert.equal(koi.accepted, true, JSON.stringify(koi)); assert.match(koi.resolved?.to, /^feed:feed-/);
  const f2 = await w.seen(b, koi, 'feed'); assert.equal(f2.r.phase, 'completed'); assert.equal(f2.got?.prop, 'bread');
  // garden beds in the gardens
  const garden = await w.act(c, 'do some gardening', {seconds: 6}); assert.equal(garden.accepted, true, JSON.stringify(garden)); assert.match(garden.resolved?.to, /^garden:garden-bed-/);
  const f3 = await w.seen(c, garden, 'garden'); assert.equal(f3.r.phase, 'completed'); assert.equal(f3.got?.prop, 'tool');
  assert.deepEqual(w.f.host.engine.runtime.violations, []);
  await w.replayExact();
});
