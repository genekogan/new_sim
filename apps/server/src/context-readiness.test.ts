import { setImmediate } from 'node:timers/promises';
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { fixture } from '../test/native-owner-fixture.ts';
import { registerEdgeComms } from './edge/comms/index.ts';
import { GodMode } from './god/god.ts';
import { EdgeLedger } from './edge/ledger/ledger.ts';
import { installEngineBridge } from './god/engine-bridge.ts';

function setup(t: TestContext) {
    const f = fixture(':memory:'); f.brain.quiesce();
    const { db, host } = f;
    const god = new GodMode(db, { worldId: host.worldId, ownerId: 'dev:admin', tick: () => host.engine.world.tick, emit() {} });
    const edge = new EdgeLedger(host, db), bridge = installEngineBridge({ host, god, edge, log() {}, worldClock: false, worldLore: false });
    const comms = registerEdgeComms(new Hono(), { host, db, souls: f.souls, soul: () => { throw Error('unused'); }, ledger: edge }, { fetch: null, sweepMs: 0 });
    edge.attachComms(comms);
    t.after(() => { comms.close(); f.brain.quiesce(); host.stop(); db.close(); });
    return { f, db, host, god, edge, bridge };
}

test('context readiness follows completed projection and published boot/edit perception without driving ticks', async t => {
    const { host, god, bridge } = setup(t);
    const act = (ops: unknown[]) => assert.equal(god.act({ ops }).accepted, true);
    act([{ op: 'place', def: 'core/bench@1', name: 'bench', p: [20, 0], about: { title: 'Old name' } }]);
    const abort = new AbortController();
    const cancelled = assert.rejects(bridge.waitForContext({ signal: abort.signal }), /cancelled/);
    const tick = host.engine.world.tick;
    abort.abort(new Error('cancelled')); await cancelled;
    assert.equal(host.engine.world.tick, tick, 'wait/abort never synthesizes ticks');
    await assert.rejects(bridge.waitForContext({ timeoutMs: 1 }), /timeout/);
    assert.equal((bridge as unknown as { readinessChecks: Set<unknown> }).readinessChecks.size, 0, 'timeout removes its active check');
    assert.equal(bridge.contextReady(), false);
    for (let i = 0; i < 80 && !bridge.contextReady(); i++) { host.tickOnce(); await setImmediate(); }
    assert.equal(bridge.contextReady(), true, JSON.stringify({ projection: bridge.initialProjectionReady(), published: bridge.places.hasPublished(), state: Object.fromEntries(['perceiveRunning','layerPlacesPending'].map(key => [key, (bridge as any)[key]])), pending: (bridge as any).perceive.pending() }));
    await bridge.waitForContext();
    assert.equal(bridge.contextReady(), true);
    act([{ op: 'set', id: 'bench', about: { title: 'New name' } }]);
    assert.equal(bridge.contextReady(), false, 'a newer commit invalidates publication immediately');
    for (let i = 0; i < 80 && !bridge.contextReady(); i++) { host.tickOnce(); await setImmediate(); }
    assert.equal(bridge.contextReady(), true, JSON.stringify({ projection: bridge.initialProjectionReady(), published: bridge.places.hasPublished(), state: Object.fromEntries(['perceiveRunning','layerPlacesPending'].map(key => [key, (bridge as any)[key]])), pending: (bridge as any).perceive.pending() }));
    await bridge.waitForContext();
    assert.equal(bridge.contextReady(), true);
    assert.equal(bridge.places.hasPublished(), true);
    const checks = (bridge as unknown as { readinessChecks: Set<unknown> }).readinessChecks;
    assert.equal(checks.size, 0, 'resolved and aborted waits leave no active checks');
});


test('served context readiness observes real clock-sliced boot and authored publication', async t => {
    const { host, god, bridge, edge } = setup(t);
    assert.equal(god.act({ ops: [{ op: 'place', def: 'core/plaza@1', name: 'court', shape: { area: [[-8,-8],[8,-8],[8,8],[-8,8]] }, about: { title: 'Before edit' } }] }).accepted, true);
    const budgets: number[] = [], original = bridge.places.syncStep.bind(bridge.places);
    t.mock.method(bridge.places, 'syncStep', (budget: number) => { assert.equal(host.running, true); budgets.push(budget); return original(budget); });
    const perception = (bridge as unknown as { perceive: { step(budget: number): boolean; pendingSummary(): { running: boolean } } }).perceive;
    const originalStep = perception.step.bind(perception); let holdObjects = true;
    let objectRunStarted!: () => void;
    const objectRun = new Promise<void>(resolve => { objectRunStarted = resolve; });
    t.mock.method(perception, 'step', (budget: number) => {
        if (holdObjects && perception.pendingSummary().running) return false;
        const done = originalStep(holdObjects ? 0 : budget);
        if (perception.pendingSummary().running) objectRunStarted();
        return done;
    });
    host.start();
    await bridge.waitForContext();
    await Promise.race([objectRun, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('object run did not begin')), 3000); timer.unref(); })]);
    assert.equal(bridge.contextReady(), true, JSON.stringify(bridge.contextReadinessState()));
    assert.ok(budgets.length > 0 && budgets.every(Number.isFinite), 'served boot uses bounded maintenance slices');
    assert.equal(perception.pendingSummary().running, true, 'only the built-object registry is deliberately held');
    assert.equal(edge.places.byId.get('g-court')!.name, 'Before edit');
    assert.equal(god.act({ ops: [{ op: 'set', id: 'court', about: { title: 'After edit', what: 'A court for afternoon talks.' } }] }).accepted, true);
    assert.equal(bridge.contextReady(), false);
    holdObjects = false;
    await bridge.waitForContext();
    assert.equal(edge.places.byId.get('g-court')!.name, 'After edit');
    assert.match(edge.places.byId.get('g-court')!.description!, /afternoon talks/);
    const state = bridge.contextReadinessState();
    assert.equal(state.places.publishedRevision, state.authoredRevision);
});
