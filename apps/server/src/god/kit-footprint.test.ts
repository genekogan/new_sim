// XP5 measure: one authored gazebo, no library shell; independent fake resident and verifier.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import { fixture, factory, invite, accept } from '../../test/native-owner-fixture.ts';
import { EdgeLedger } from '../edge/ledger/ledger.ts';
import { GodMode } from './god.ts';
import { installEngineBridge } from './engine-bridge.ts';
import { runQuery } from './query.ts';
import { VerifyUse } from './verify-use.ts';
import { isVerificationProbe } from '../verification-probe.ts';

function setup(t: TestContext, footprint: unknown = 'open') {
  const f = fixture(':memory:', factory, { durableClockV1: true }); f.brain.quiesce();
  const god = new GodMode(f.db, { worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit() {} });
  const edge = new EdgeLedger(f.host, f.db), bridge = installEngineBridge({ host: f.host, god, edge, log() {}, worldClock: false, worldLore: false });
  const verify = new VerifyUse(f.host, f.souls, god, edge);
  t.after(() => { f.brain.quiesce(); f.host.stop(); edge.comms?.close(); f.db.close(); });
  const settle = async (n = 4) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  const build = (defOverride?: Record<string, unknown>) => {
    const r = god.act({ ops: [
      { op: 'define', def: defOverride ?? { schema: 'def/1', name: 'one-kit-gazebo', tags: ['building', 'gazebo'], size: { box: [6, 3.2, 6] },
        make: { kind: 'gen', gen: 'kit/2', args: { footprint, shapes: [
          ...[-2.8, 2.8].flatMap(x => [-2.8, 2.8].map(z => ({ kind: 'box', at: [x, 1.5, z], size: [0.2, 3, 0.2] }))),
          { kind: 'box', at: [0, -0.05, 0], size: [6, 0.1, 6], collide: true },
          { kind: 'box', at: [0, 3.1, 0], size: [6, 0.2, 6], collide: true },
          { kind: 'box', at: [0, 0.25, 0], size: [1.5, 0.5, 0.6], collide: true },
        ] } }, components: { seat: { height: 0.5 } },
        slots: [{ id: 'bench', kind: 'seat', p: [0, 0.5, 0], yaw: 0, height: 0.5, accepts: { tags: ['body'] }, capacity: 1 }] } },
      { op: 'place', def: `${defOverride?.name ?? 'one-kit-gazebo'}@1`, name: 'gazebo', p: [10, 0], r: Math.PI / 6 },
    ] });
    assert.equal(r.accepted, true, JSON.stringify(r));
  };
  const engine = () => f.host.engine as typeof f.host.engine & {
    world: { entities: Record<string, { pose: { p: [number, number, number] }; human?: { activity: string } }> };
    runtime: { violations: unknown[] }; bodyUsesV1(id: string): { body: string } | undefined;
  };
  const drive = async <T>(work: Promise<T>) => {
    let done = false; void work.then(() => { done = true; }, () => { done = true; });
    const limit = performance.now() + 15000;
    while (!done && performance.now() < limit) { for (let i = 0; i < 4; i++) f.host.tickOnce(); await new Promise(r => setTimeout(r, 1)); }
    assert.ok(done, 'native probe completed within fixture bound'); return work;
  };
  return { ...f, god, edge, bridge, verify, settle, build, engine, drive };
}

test('XP5 B2: independent fake resident walks into the 95-shape gazebo kit and sits on the first request', { timeout: 30000 }, async t => {
  const w = setup(t); w.build(JSON.parse(readFileSync(new URL('./fixtures/b2-walkable-gazebo.json', import.meta.url), 'utf8'))); await w.settle();
  assert.equal(w.god.model.entities.size, 1, 'the whole gazebo is one kit, with no library shell');
  const description = runQuery(w.god.model, { describe: 'gazebo' }).describe as {
    rooms: { id: string }[]; walk: { state: string; rooms: { in: unknown; out: unknown }[] };
  };
  assert.deepEqual(description.rooms.map(r => r.id), ['ground']);
  assert.equal(description.walk.state, 'ok', JSON.stringify(description));
  assert.deepEqual(description.walk.rooms.map(r => [r.in, r.out]), [[true, true]]);
  await invite(w, 'gazebo-resident');
  const row = await accept(w.host, w.souls.create('dev:gazebo-resident', { name: 'Independent resident', description: 'tries the new gazebo' }));
  await w.settle();
  const soul = { soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner };
  assert.equal(isVerificationProbe(row.id), false);
  const cap = w.edge.capabilities(soul).find(c => c.id === 'walk:gazebo');
  assert.equal(cap?.available, true, JSON.stringify(cap));
  const walked = await accept(w.host, w.edge.act(soul, { capability: 'walk:gazebo' }));
  assert.equal(walked.accepted, true, JSON.stringify(walked));
  const room = () => {
    const p = w.engine().world.entities[row.entity_id].pose.p;
    return (runQuery(w.god.model, { where: [p[0], p[2]] }).where as { room?: { building: string; room: string } }).room;
  };
  for (let i = 0; i < 3000; i++) {
    w.host.tickOnce(); if (i % 20 === 0) { await setImmediate(); w.host.drainInputs(); }
    if (room()?.building === 'gazebo') break;
  }
  assert.equal(room()?.room, 'ground', 'resident crossed into the ground room physically');
  const gazebo = w.god.model.get('gazebo')!;
  const seated = await accept(w.host, w.edge.act(soul, { capability: `sit:${gazebo.id}`, params: { seconds: 60 } }));
  assert.equal(seated.accepted, true, JSON.stringify({ seated, seats: (w.host.engine as unknown as { freeSeatSlotsV1(id: string, except: string): unknown }).freeSeatSlotsV1(gazebo.id, row.entity_id), position: w.engine().world.entities[row.entity_id].pose.p }));
  for (let i = 0; i < 3000 && w.engine().world.entities[row.entity_id].human?.activity !== 'sit'; i++) {
    w.host.tickOnce(); if (i % 20 === 0) { await setImmediate(); w.host.drainInputs(); }
  }
  assert.equal(w.engine().world.entities[row.entity_id].human?.activity, 'sit');
  assert.equal(w.engine().bodyUsesV1(gazebo.id)?.body, row.entity_id);
  assert.equal(room()?.room, 'ground', 'the seated resident remains physically inside the gazebo');
  const occupied = (runQuery(w.god.model, { describe: 'gazebo' }).describe as { slots: { kind: string; p: number[]; occupants: string[] }[] }).slots.find(s => s.kind === 'seat' && s.occupants.includes(row.name));
  assert.ok(occupied, 'an authored integral bench is occupied');
  const p = w.engine().world.entities[row.entity_id].pose.p;
  assert.ok(Math.hypot(p[0] - occupied.p[0], p[2] - occupied.p[2]) <= 0.6);
  assert.deepEqual(w.engine().runtime.violations, []);
});

test('B2 verify-use proves entry and physical sitting in the same 95-shape kit', { timeout: 20000 }, async t => {
  const w = setup(t); w.build(JSON.parse(readFileSync(new URL('./fixtures/b2-walkable-gazebo.json', import.meta.url), 'utf8'))); await w.settle();
  const r = await w.drive(w.verify.run({ target: 'gazebo', timeoutMs: 10000 }));
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.uses[0].proof?.kind, 'room');
  assert.equal(r.uses[1].seat, 'gazebo'); assert.ok(r.uses[1].distanceToSlot! <= 0.6);
  assert.equal(r.probe.removed, true); assert.deepEqual(w.engine().runtime.violations, []);
});

for (const inline of [false, true]) test(`verify-use enters and sits in the ${inline ? 'inline-footprint' : 'open'} kit`, { timeout: 20000 }, async t => {
  const footprint = inline ? {
    schema: 'lm-building-footprint/1', levels: [{ id: 0, y: 0 }],
    rooms: [{ id: 'lounge', level: 0, y0: 0, y1: 3, polygon: [[-3, -3], [3, -3], [3, 3], [-3, 3]] }],
    portals: [{ id: 'front-door', kind: 'door', level: 0, center: [0, 1, -3], normal: [0, 0, -1], width: 2, y0: 0, y1: 2.8 }],
  } : 'open';
  const w = setup(t, footprint); w.build(); await w.settle();
  const before = structuredClone([...w.god.model.entities.values()]);
  const result = await w.drive(w.verify.run({ target: 'gazebo', timeoutMs: 10000 }));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.uses[0].proof?.kind, 'room'); assert.equal(result.uses[1].ok, true);
  assert.equal(result.uses[1].seat, 'gazebo'); assert.ok(result.uses[1].distanceToSlot! <= 0.6);
  assert.equal(result.probe.removed, true);
  assert.deepEqual([...w.god.model.entities.values()], before);
  assert.equal([...w.host.minds.keys()].some(isVerificationProbe), false);
  assert.deepEqual(w.engine().runtime.violations, []);
});
