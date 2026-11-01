// Focused in-memory compiler→bridge→native-engine proof. No listener, provider,
// browser or live-world mutation. Run only outside an active playtest window.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fixture, factory} from '../../../apps/server/test/native-owner-fixture.ts';
import {GodMode} from '../../../apps/server/src/god/god.ts';
import {GroundHost} from '../../../apps/server/src/god/ground-host.ts';
import {EdgeLedger} from '../../../apps/server/src/edge/ledger/ledger.ts';
import {installEngineBridge} from '../../../apps/server/src/god/engine-bridge.ts';
import {layout, makePatch, changedSeats} from './patch.mjs';
import {geometryReport, assertGeometry} from './geometry.mjs';

function permutations(xs) {
  return xs.length ? xs.flatMap((x, i) => permutations(xs.filter((_, k) => k !== i)).map(rest => [x, ...rest])) : [[]];
}

test('exact shipped Chiba: source failure, guarded reversible repair, five native use-checks and occupied central access', {timeout: 180_000}, async t => {
  const start = performance.now();
  const template = JSON.parse(readFileSync(new URL('../../templates/mars-two.json', import.meta.url), 'utf8'));
  template.batches = template.batches.filter(b => b.group !== layout.id);
  const w = fixture(':memory:', factory, {durableClockV1: true}); w.brain.quiesce();
  const god = new GodMode(w.db, {genesis: template, worldId: w.host.worldId, ownerId: 'owner', tick: () => w.host.engine.world.tick, emit() {}});
  new GroundHost(w.db, w.host, god);
  const edge = new EdgeLedger(w.host, w.db);
  installEngineBridge({host: w.host, god, edge, log() {}, worldClock: false, worldLore: false});
  t.after(() => {w.brain.quiesce(); w.host.stop(); edge.comms?.close(); w.db.close();});
  const settle = async () => {for (let i = 0; i < 4; i++) {w.host.tickOnce(); await setImmediate(); w.host.drainInputs();}};
  await settle();
  const E = w.host.engine, ids = Object.fromEntries(['chiba', ...layout.seats.map(s => s.name)].map(n => [n, god.model.get(n).id]));
  const original = E.useCheckV1({of: layout.seats.map(s => ids[s.name])});
  assert.equal(original.find(x => x.of === ids['tier-2']).code, 'use.transition-blocked', 'retain the original intrinsic failure');
  const vacant = Object.fromEntries(changedSeats.map(s => [s.name, E.bodyUsesV1(ids[s.name]) === null]));
  const patch = makePatch(god.publicSnapshot(), {vacant});
  const definitions = JSON.stringify(god.model.snapshot().defs);
  const applied = god.act(patch.batch);
  assert.equal(applied.accepted, true, JSON.stringify(applied));
  await settle();
  assert.equal(JSON.stringify(god.model.snapshot().defs), definitions, 'no definition revisions or bytes changed');
  for (const s of layout.seats) assert.deepEqual(god.model.get(s.name).p, s.after, `${s.name} mesh and slot moved together`);
  const geometry = geometryReport(E, ids, original); assertGeometry(geometry);
  const staticWorld = structuredClone(E.world);
  const orders = process.env.CHIBA_ALL_ORDERS === '1' ? permutations(['tier', 'tier-2', 'tier-3', 'tier-4']) : [['tier', 'tier-2', 'tier-3', 'tier-4']];
  const access = [];
  for (const order of orders) {
    const engine = factory.create(structuredClone(staticWorld)), actors = [];
    engine.configureRuntimePolicy({sleepBlockTicks: 1200, occupiedLinkRoutingV1: true});
    const run = (actor, steps, done) => {
      const admitted = engine.perform({actor, label: 'Chiba seating physical regression', steps});
      assert.equal(admitted.ok, true, JSON.stringify(admitted));
      for (let ticks = 0; ticks < 900; ticks++) {
        const result = engine.step();
        const failed = result.programs.find(p => p.id === admitted.id && p.kind === 'failed');
        assert(!failed, JSON.stringify(failed));
        if (done(engine.world.entities[actor], result, admitted.id)) return ticks + 1;
      }
      assert.fail(`45 simulated seconds exceeded: ${order.join(',')} ${actor} ${JSON.stringify(engine.world.entities[actor].pose)}`);
    };
    const arrivals = [];
    for (const [i, name] of order.entries()) {
      const actor = `h_chiba000${i}`; actors.push({actor, name});
      engine.spawnHuman({id: actor, soul: `s_chiba000${i}`, label: `Chiba probe ${i}`, near: {first: true, at: [-13, -17]}});
      arrivals.push({name, ticks: run(actor, [{verb: 'mars:sit', params: {slot: `${ids[name]}#seat`}}, {verb: 'rest', params: {seconds: 600}}], body => body.human.activity === 'sit' && engine.bodyUsesV1(ids[name])?.body === actor)});
      for (const other of actors) assert.equal(engine.bodyUsesV1(ids[other.name])?.body, other.actor, 'earlier neighbors remain physically seated');
    }
    const exits = [];
    for (const {actor, name} of [...actors].reverse()) {
      exits.push({name, ticks: run(actor, [{verb: 'stand', params: {}}, {verb: 'mars:walk_to', params: {x: -13, z: -17, level: 0}}], (body, result, program) => result.programs.some(p => p.id === program && p.kind === 'completed') && body.human.level === 0 && !engine.nativeSeatHoldsV1(actor).length)});
      assert.equal(engine.bodyUsesV1(ids[name]), null, 'native claim released');
      // A completed probe leaves the doorway before the next exit; this setup
      // occurs outside Chiba and never bypasses an occupied stair or seat.
      assert.equal(engine.relocateHumanV1(actor, [-4 + exits.length, -15]), true);
    }
    assert.deepEqual(engine.runtime.violations, []);
    access.push({order, arrivals, exits});
  }
  const rolled = god.act(patch.rollback);
  assert.equal(rolled.accepted, true, JSON.stringify(rolled)); await settle();
  for (const s of layout.seats) assert.deepEqual(god.model.get(s.name).p, s.before, `${s.name} original pose restored`);
  assert.equal(JSON.stringify(god.model.snapshot().defs), definitions);
  const sources = ['mars/viewer/engine/locomotion/walk.ts', 'packages/engine-mars/src/engine.ts', 'packages/engine-contract/src/engine.ts',
    'worlds/templates/mars-two.json', ...['layout.json', 'patch.mjs', 'geometry.mjs', 'native.test.mjs'].map(n => `worlds/patches/mars-chiba-seating-20261029/${n}`)];
  const sourceHashes = Object.fromEntries(sources.map(path => [path, createHash('sha256').update(readFileSync(new URL(`../../../${path}`, import.meta.url))).digest('hex')]));
  const proof = {schema: 'mars-chiba-seating-proof/1', policy: 'occupied-link-routing/1', sourceHashes, geometry, access, elapsedMs: Math.round(performance.now() - start),
    pending: ['root-owned isolated-world semantic receipt confirmation', 'visual support and aisle review', 'release-owner live patch']};
  if (process.env.CHIBA_PROOF_OUT) writeFileSync(process.env.CHIBA_PROOF_OUT, JSON.stringify(proof, null, 2) + '\n');
  t.diagnostic(JSON.stringify({policy: proof.policy, slots: geometry.seats.length, orders: access.length,
    arrivals: access.reduce((n, a) => n + a.arrivals.length, 0), exits: access.reduce((n, a) => n + a.exits.length, 0),
    maxArrivalTicks: Math.max(...access.flatMap(a => a.arrivals.map(x => x.ticks))), maxExitTicks: Math.max(...access.flatMap(a => a.exits.map(x => x.ticks))),
    elapsedMs: proof.elapsedMs, pending: proof.pending}));
});
