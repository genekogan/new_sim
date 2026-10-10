// Ground host (lane L8): terrain commits become groundV1 facts the engine folds; a restart (snapshot + log)
// and a replay from genesis stand the Soul on the same ground; authored worlds never see the fact.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { marsFactory, GREEN_FIELD_WORLD } from '@sim/engine-mars';
import { coreRef } from '@sim/world-compiler';
import { Db } from '../db.ts';
import { WorldHost, replayFromGenesis } from '../world.ts';
import { GodMode } from './god.ts';
import { GroundHost, loadGroundRecipes } from './ground-host.ts';

const factory = await marsFactory(GREEN_FIELD_WORLD);
const worldId = 'ground-host-1', seed = 'ground-host';
async function settle(host: WorldHost, n = 4) { for (let i = 0; i < n; i++) { await setImmediate(); host.drainInputs(); host.tickOnce(); } }
type Eng = { world: { groundV1?: { recipeHash: string; editSeq: number }; entities: Record<string, { pose: { p: number[] } }> }; spawnHuman(a: { id: string; label: string; soul: string }): string; stateHash(): string };

test('a terrain commit logs groundV1; the engine stands bodies on it; restart and genesis replay agree', { timeout: 300_000 }, async (t) => {
  const db = new Db(':memory:'); t.after(() => db.close());
  loadGroundRecipes(db, worldId);
  const host = new WorldHost(db, factory, seed, 1e9, worldId); host.boot(); host.drainInputs();
  const god = new GodMode(db, { worldId, ownerId: null, tick: () => host.engine.world.tick, emit: () => {} });
  const gh = new GroundHost(db, host, god);
  await settle(host);
  const eng = () => host.engine as unknown as Eng;
  const flat = eng().world.groundV1?.recipeHash;
  assert.ok(flat, 'a fresh entity world stands on its (flat) ground from the start');
  const born = host.enqueue('birth', 'test', { soulId: 's_ada', entityId: 'h_ada', name: 'Ada', owner: 'dev:ada', description: 'x' });
  await settle(host); await born;
  assert.ok(eng().world.entities.h_ada, 'born through the log');
  // the god raises a knoll under the Soul
  const r = god.act({ ops: [{ op: 'place', def: coreRef('knoll'), name: 'knoll', p: [0, 0], params: { height: 5, radius: 20 } }] });
  assert.equal(r.accepted, true);
  await settle(host);
  const g1 = eng().world.groundV1!;
  assert.notEqual(g1.recipeHash, flat);
  assert.equal(g1.editSeq, 1);
  const y = eng().world.entities.h_ada.pose.p[1];
  assert.ok(Math.abs(y - 5) < 0.05, `lifted onto the knoll: ${y}`);
  assert.equal(gh.heightAt(0, 0)! > 4.9, true);
  assert.equal((db.db.prepare('SELECT count(*) n FROM world_ground_recipes_v1 WHERE world_id=?').get(worldId) as { n: number }).n, 2);
  // an edit that does not touch the ground logs nothing new
  const before = (db.db.prepare("SELECT count(*) n FROM events WHERE kind='rules' AND json_type(payload,'$.groundV1')='object'").get() as { n: number }).n;
  god.act({ ops: [{ op: 'place', def: coreRef('bench'), name: 'bench', p: [10, 10] }] });
  await settle(host);
  assert.equal((db.db.prepare("SELECT count(*) n FROM events WHERE kind='rules' AND json_type(payload,'$.groundV1')='object'").get() as { n: number }).n, before);
  for (let i = 0; i < 40; i++) host.tickOnce();
  const hash = eng().stateHash();
  // restart: snapshot + log replay on a new host
  host.saveSnapshot(true);
  const again = new WorldHost(db, factory, seed, 1e9, worldId); again.boot(); t.after(() => again.stop());
  assert.equal((again.engine as unknown as Eng).world.groundV1?.recipeHash, g1.recipeHash);
  assert.equal((again.engine as unknown as Eng).stateHash(), hash);
  // genesis replay of the whole log
  const events = db.events(worldId, 0) as never;
  const rep = replayFromGenesis(factory, seed, events, host.engine.world.tick);
  assert.equal((rep.engine as unknown as Eng).world.groundV1?.recipeHash, g1.recipeHash);
  assert.ok(Math.abs((rep.engine as unknown as Eng).world.entities.h_ada.pose.p[1] - y) < 1e-9);
});
