// The fold: replaying the event log from genesis must reproduce the live world.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toyFactory } from '@sim/engine-toy';
import { Db } from './db.ts';
import { kernelHash } from '@sim/kernel';
import { initKernel, replayKernel } from './fold.ts';
import { optionsFor } from './deck.ts';
import { WORLD_ID, WorldHost, replayFromGenesis } from './world.ts';

function drive(host: WorldHost, ticks: number, pick: (i: number) => number) {
  for (let i = 0; i < ticks; i++) {
    // decide often, preempting whatever is running, so the log is dense and actions are cut mid-flight
    if (i % 170 === 7) for (const m of host.minds.values()) {
      const opts = optionsFor(host, m); if (!opts.length) continue; const o = opts[pick(i + m.name.length) % opts.length];
      void host.enqueue('decision', 'test', { soulId: m.soulId, entityId: m.entityId, option: o.id, label: o.label, steps: o.steps, reevalTicks: 600, fallback: false, trigger: 'test', card: o.card, target: o.cardTarget, manner: 'warmly', approachLen: o.approachLen });
    }
    host.tickOnce();
  }
}
const births = (host: WorldHost, names: string[]) => names.forEach((n) => void host.enqueue('birth', 'test', { soulId: `s_${n}`, entityId: `h_${n}`, name: n, description: 'test soul', owner: 'system' }));

test('replay from genesis reproduces the live state hash', () => {
  const db = new Db(join(mkdtempSync(join(tmpdir(), 'sim-')), 't.db'));
  const host = new WorldHost(db, toyFactory, 'replay-seed', 1e9); host.boot();
  births(host, ['a', 'b', 'c', 'd', 'e']);
  drive(host, 3000, (i) => i * 7);
  void host.enqueue('retire', 'test', { soulId: 's_c', entityId: 'h_c' });
  drive(host, 1500, (i) => i * 3);
  const replayed = replayFromGenesis(toyFactory, 'replay-seed', db.events(WORLD_ID), host.engine.world.tick);
  assert.equal(replayed.engine.stateHash(), host.engine.stateHash());
  // the kernel replays too, and it replays WITHOUT the engine: meaning needs no depiction
  host.kernel.tick = replayed.kernel.tick;
  assert.equal(kernelHash(replayed.kernel), kernelHash(host.kernel));
  const alone = replayKernel(initKernel(toyFactory.create(toyFactory.genesis('replay-seed'))), db.events(WORLD_ID)); alone.tick = host.kernel.tick;
  assert.equal(kernelHash(alone), kernelHash(host.kernel));
  assert.ok(db.events(WORLD_ID).some((e) => e.kind === 'play'), 'cards were played');
  assert.ok(db.countEvents(WORLD_ID) > 20);
  db.close();
});

test('restart: snapshot + fast-forward through later events equals the uninterrupted world', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sim-'));
  const db = new Db(join(dir, 't.db'));
  const host = new WorldHost(db, toyFactory, 'restart-seed', 1e9); host.boot();
  births(host, ['a', 'b', 'c']);
  drive(host, 1200, (i) => i);
  host.saveSnapshot();
  drive(host, 900, (i) => i * 5);         // events after the snapshot, then a "crash"
  const lastEventTick = db.tailEvents(WORLD_ID, 1)[0].tick;
  const reference = replayFromGenesis(toyFactory, 'restart-seed', db.events(WORLD_ID), lastEventTick);
  const host2 = new WorldHost(db, toyFactory, 'restart-seed', 1e9);
  const boot = host2.boot();
  assert.equal(boot.from, 'snapshot');
  assert.ok(boot.replayed > 0);
  // boot stops just after applying the last event (before stepping past its tick)
  assert.equal(host2.engine.world.tick, lastEventTick);
  assert.equal(host2.minds.size, 3);
  // stepping both to the same later tick gives the same world
  // live ticking logs new plays as programs reach their effects, so the reference is replayed afterwards from the full log
  for (let i = 0; i < 400; i++) host2.tickOnce();
  const ref2 = replayFromGenesis(toyFactory, 'restart-seed', db.events(WORLD_ID), lastEventTick + 400);
  assert.equal(host2.engine.stateHash(), ref2.engine.stateHash());
  host2.kernel.tick = ref2.kernel.tick; assert.equal(kernelHash(host2.kernel), kernelHash(ref2.kernel));
  void reference;
  db.close();
});
