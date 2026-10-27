import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { accept, fixture, invite } from '../test/native-owner-fixture.ts';
import { EdgeLedger } from './edge/ledger/ledger.ts';
import { mountEdgeRoutes } from './edge/routes.ts';
import { GodMode } from './god/god.ts';
import { installEngineBridge } from './god/engine-bridge.ts';
import { mountGodRoutes } from './god/routes.ts';
import { mountContextViews } from './god/context-views.ts';
import { encodeContextPng } from './god/context-sheet.ts';
import { ApiError } from './souls.ts';

// Correctness only: actual native bodies and HTTP query handlers, no socket,
// browser, model, performance threshold or synthetic occupancy/perception cache.
test('live seat, door and position queries stay current while architectural capture is pending', { timeout: 60000 }, async t => {
    const f = fixture(':memory:', undefined, { durableClockV1: true });
    f.brain.quiesce();
    const { host, db } = f;
    let release = () => {}, closeContext = async () => {}, closeComms = () => {};
    t.after(async () => { release(); await closeContext(); closeComms(); f.brain.quiesce(); host.stop(); db.close(); });
    const god = new GodMode(db, { worldId: host.worldId, ownerId: 'dev:admin', tick: () => host.engine.world.tick, emit() {} });
    const edge = new EdgeLedger(host, db);
    const bridge = installEngineBridge({ host, god, edge, log() {}, worldClock: false, worldLore: false });
    const app = new Hono();
    app.onError((error, c) => error instanceof ApiError ? c.json({ code: error.code }, error.status as 400) : c.json({ error: String(error) }, 500));
    const tick = async (n = 1) => {
        for (let i = 0; i < n; i++) { host.tickOnce(); await setImmediate(); host.drainInputs(); }
    };
    const settleProjection = async () => {
        for (let i = 0; i < 120 && !bridge.contextReady(); i++) await tick();
        assert.equal(bridge.contextReady(), true, 'normal ticks publish the committed native projection and perception');
    };
    const patch = JSON.parse(readFileSync(new URL('../../../worlds/patches/unified-affordances-20261027/hello-hamlet.json', import.meta.url), 'utf8'));
    const hallDef = patch.ops.find((op: any) => op.op === 'define');
    const edit = (ops: unknown[]) => {
        const result = god.act({ ops });
        assert.equal(result.accepted, true, JSON.stringify(result));
    };
    edit([
        hallDef,
        { op: 'place', def: 'lab-closeable-hall@1', name: 'hall', p: [18, 0], params: { w: 8, d: 8, floors: 1, floorHeight: 3 }, state: { doors: { 'front-door': 'closed' } }, about: { title: 'Test hall' } },
        { op: 'place', def: 'core/chair@1', name: 'chair', p: [4, 0], about: { title: 'Test chair' } },
        { op: 'place', def: 'core/chair@1', name: 'other-chair', p: [-4, 0] },
    ]);
    await invite(f, 'live-query');
    const row = await accept(host, f.souls.create('dev:live-query', { name: 'Query Walker', description: 'Local live-state probe' }));
    const soul = { soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner };
    const comms = mountEdgeRoutes(app, { host, db, souls: f.souls, ledger: edge, soul: () => soul });
    closeComms = () => comms.close();
    mountGodRoutes(app, { god, worldName: 'Local live-state probe', requireUser: async () => db.user('dev:admin')!, soulFromBearer: () => null, baseOf: () => 'http://127.0.0.1:5980', limitIp() {}, rateLimit: false });
    let started!: () => void;
    const held = new Promise<void>(resolve => release = resolve), began = new Promise<void>(resolve => started = resolve);
    let renders = 0, captureSnapshot: any;
    const context = mountContextViews(app, {
        god, edge, worldUrl: 'http://127.0.0.1:5980', soul: () => soul.soulId, limit() {},
        levelAt: (x, z, y) => bridge.levelAt(x, z, y),
        contextReady: () => bridge.contextReady(), waitForContext: signal => bridge.waitForContext({ signal }),
        renderer: async (input, signal) => {
            renders++; captureSnapshot = (input.payload as any).snapshot; started();
            await Promise.race([held, new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))]);
            return { png: encodeContextPng(1, 1, new Uint8Array([12, 34, 56, 255])) };
        },
    });
    closeContext = () => context.close();
    const http = async (path: string, data?: unknown) => {
        const response = await accept(host, Promise.resolve(app.request(path, data === undefined ? undefined : {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data),
        })));
        const body = await response.json();
        assert.equal(response.status, 200, JSON.stringify({ path, body }));
        return body as any;
    };
    const body = () => host.engine.world.entities[soul.entityId] as any;
    const chair = god.model.get('chair')!.id, hall = god.model.get('hall')!.id;
    const occupancy = () => (host.engine as unknown as { seatOccupantsV1(id: string): { slot: string; body: string }[] }).seatOccupantsV1(chair);
    const querySeat = async () => (await http('/v1/god/query', { entity: chair })).entity;
    const here = async () => {
        const result = await http('/v1/edge/here');
        assert.equal(result.tick, host.engine.world.tick);
        assert.deepEqual(result.here.me.pos, [body().pose.p[0], body().pose.p[2]].map(n => Math.round(n * 10) / 10));
        return result.here.me;
    };
    const pending = () => {
        assert.equal(context.cache.peek(chair)?.status, 'pending');
        assert.equal(renders, 1, 'native changes must not need another concurrent renderer');
    };
    const action = async (capability: string, params: object = {}) => {
        const result = await http('/v1/edge/act', { capability, params, for: 'none' });
        assert.equal(result.accepted, true, JSON.stringify(result));
        for (let i = 0; i < 1600 && ['waiting', 'started'].includes(edge.receipt(soul.soulId, result.receipt.id)!.phase); i++) await tick();
        assert.equal(edge.receipt(soul.soulId, result.receipt.id)!.phase, 'completed', JSON.stringify(edge.receipt(soul.soulId, result.receipt.id)));
        return result;
    };

    await settleProjection();
    await accept(host, host.enqueue('edge-relocate', 'test:context-live', { ...soul, to: [0, 0], why: 'deterministic fixture start' }));
    await tick(2);
    const initial = await here();
    assert.equal(initial.posture, 'standing');
    assert.deepEqual(occupancy(), []);
    assert.equal((await querySeat()).slots.filter((slot: any) => slot.kind === 'seat').reduce((n: number, slot: any) => n + slot.used, 0), 0);
    const requested = await http('/v1/world/context/views', { refs: [chair] });
    assert.equal(requested.views[0].status, 'pending');
    await began; pending();
    assert.equal(captureSnapshot.entities.some((entity: any) => entity.id === soul.entityId), false, 'architectural snapshot deliberately omits the live body');
    assert.deepEqual(captureSnapshot.entities.find((entity: any) => entity.id === hall).state.doors, {}, 'architectural snapshot uses canonical doors, not live door state');

    await action(`sit:${chair}`, { seconds: 1 });
    const atSeat = await here();
    assert.equal(atSeat.posture, 'seated');
    assert.ok(occupancy().some(entry => entry.body === soul.entityId));
    assert.equal(atSeat.seat, chair, 'direct fixture seating reports the actual native chair, not an arbitrary completed receipt');
    assert.equal((await querySeat()).slots.filter((slot: any) => slot.kind === 'seat').reduce((n: number, slot: any) => n + slot.used, 0), 1);
    const caps = (await http('/v1/edge/capabilities')).capabilities;
    assert.equal(caps.find((cap: any) => cap.id === `sit:${chair}`)?.blocked?.code, 'seat.yours');
    pending();

    // A real commit invalidates context publication while the capture is still held.
    // Door query reads the committed live model, never the canonical door snapshot.
    for (const state of ['open', 'closed']) {
        edit([{ op: 'set', id: hall, state: { doors: { 'front-door': state } } }]);
        assert.equal(bridge.contextReady(), false);
        assert.equal((await here()).seat, chair, 'live body query remains current before committed-edit publication catches up');
        assert.equal((await querySeat()).slots.filter((slot: any) => slot.kind === 'seat').reduce((n: number, slot: any) => n + slot.used, 0), occupancy().length);
        await settleProjection();
        const liveDoor = (await http('/v1/god/query', { describe: hall })).describe;
        assert.equal(liveDoor.state.doors['front-door'], state);
        assert.deepEqual(liveDoor.state.doors, god.model.entities.get(hall)!.state!.doors);
        // The public God query above is not the Soul discovery contract. Verify
        // the Soul's actual entry offer against this exact building as well.
        const entrance = (await http('/v1/edge/capabilities')).capabilities.find((cap: any) => cap.id === 'walk:hall');
        assert.deepEqual(entrance?.target, { id: 'g-hall', kind: 'place' });
        assert.equal(entrance.available, state === 'open', JSON.stringify(entrance));
        if (state === 'closed') assert.equal(entrance.blocked?.code, 'route.unreachable');
        assert.equal((await here()).seat, atSeat.seat, 'door maintenance must not erase current held-seat evidence');
        pending();
    }
    await action('stand:here');
    assert.equal((await here()).posture, 'standing');
    assert.deepEqual(occupancy(), []);
    assert.equal((await querySeat()).slots.filter((slot: any) => slot.kind === 'seat').reduce((n: number, slot: any) => n + slot.used, 0), 0);
    const walk = (await http('/v1/edge/capabilities')).capabilities.find((cap: any) => cap.id === 'walk:other-chair');
    assert.equal(walk?.available, true, 'use the actual offered native walk capability');
    await action(walk.id);
    const moved = await here();
    assert.ok(Math.hypot(moved.pos[0] - atSeat.pos[0], moved.pos[1] - atSeat.pos[1]) > 4, 'actual native walk changes the reported position');
    assert.equal(moved.seat, undefined);
    pending();

    release(); await context.cache.settled();
    const ready = (await http('/v1/world/context/views', { refs: [chair] })).views[0];
    assert.equal(ready.status, 'ready');
    assert.equal(ready.source, 'architectural-context');
    assert.equal((await here()).seat, undefined, 'cached architecture does not resurrect the earlier occupant');
    assert.deepEqual(host.engine.runtime.violations, []);
    t.diagnostic(JSON.stringify({ renders, start: initial.pos, seated: atSeat.pos, final: moved.pos, nativeTick: host.engine.world.tick, finalDoor: 'closed', finalOccupancy: occupancy().length }));
});
