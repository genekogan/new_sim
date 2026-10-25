import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { CORE_KIT, WorldModel, applyBatch, coreRef, type Entity } from '@sim/world-compiler';
import { Objects } from '../edge/comms/objects/framework.ts';
import { calendarKind } from '../edge/comms/objects/calendar.ts';
import { ensureCommsSchema } from '../edge/comms/store.ts';
import type { CommsCore } from '../edge/comms/core.ts';
import { PlaceIndex, type Place } from '../edge/ledger/places.ts';
import { EngineBridge } from './engine-bridge.ts';
import { GodLayers, type LayersHost } from './layers.ts';
import { GodPlaces } from './places.ts';
import type { GodNav, Thing } from './nav.ts';

type Lookup = (e: Entity) => { id: string; name: string } | null;
function fixture() {
  const model = new WorldModel({ constants: { extent: 400, ground: 'land' }, seed: 'calendar-places' });
  for (const d of CORE_KIT) model.defineDef(d, 'core', 0);
  const act = (ops: unknown[]) => { const r = applyBatch(model, { ops }, 'god', 1); assert.equal(r.result.accepted, true, JSON.stringify(r.result)); };
  act([
    { op: 'place', def: coreRef('plaza'), name: 'alpha', shape: { area: [[-20, -10], [-10, -10], [-10, 0], [-20, 0]] } },
    { op: 'place', def: coreRef('plaza'), name: 'beta', shape: { area: [[10, -10], [20, -10], [20, 0], [10, 0]] } },
    { op: 'place', def: coreRef('bench'), name: 'bench', p: [0, 20] },
  ]);
  const engine = { world: { tick: 0, entities: {} } }, clock = { origin: 0, dayTicks: 72000 };
  const root: Place = { id: 'world', name: 'World', kind: 'outdoor', parent: null, polygon: [[-200, -200], [200, -200], [200, 200], [-200, 200]], level: 0, enclosed: false, capacity: null, starting: true };
  const edge = { places: new PlaceIndex({ contract: 'place-data/1', world: 'test', places: [root] }) };
  let deferred = false, edits = 0;
  // The test isolates place/calendar derivation from navigation raster work; area things have the compiler's real paths.
  const nav = { things: (): Thing[] => [...model.entities.values()].filter(e => e.shape && 'area' in e.shape).map(e => ({
    id: e.id, ref: model.pathOf(e.id), name: e.name ?? e.id, kind: 'area', what: 'plaza', words: [], at: [0, 0], level: 0,
    area: (e.shape as { area: [number, number][] }).area,
  })) } as GodNav;
  const places = new GodPlaces({ model, nav, edge: edge as never, version: () => `${edits}:${Math.floor(engine.world.tick / 1200)}`, deferred: () => deferred, engineOwned: () => false, levelAt: () => 0, log: () => {} });
  // Exercise the production bridge lookup without booting an engine/world or registering listeners.
  const bridge = Object.assign(Object.create(EngineBridge.prototype), { god: { model }, places, edge, version: 0, levelAt: () => 0 }) as { version: number; calendarPlaces(sources: readonly Entity[]): Lookup; layerPlace: Lookup };
  return { model, act, engine, clock, edge, places, bridge, sources: () => [...model.entities.values()],
    edited() { edits++; bridge.version++; }, defer(on: boolean) { deferred = on; } };
}

test('calendar own-place identities survive minute changes; ordinary place reads still refresh', () => {
  const f = fixture(), sources = f.sources(), initial = f.places.calendarIdentities(sources, f.bridge.version);
  assert.deepEqual(initial.get(f.model.get('alpha')!.id), { id: 'g-alpha', name: 'alpha' });
  const derives = f.places.stats.derives;
  f.engine.world.tick = 2400;
  assert.strictEqual(f.places.calendarIdentities(sources, f.bridge.version), initial);
  assert.equal(f.places.stats.derives, derives);
  f.places.list();
  assert.equal(f.places.stats.derives, derives + 1, 'normal description freshness is unchanged');
  assert.notStrictEqual(f.places.calendarIdentities(sources, f.bridge.version), initial, 'a new installed index invalidates identities');
});

test('calendar identities invalidate for model edits, non-map bridge revisions and deferred installs', () => {
  const f = fixture(), alpha = f.model.get('alpha')!;
  let before = f.places.calendarIdentities(f.sources(), f.bridge.version);
  f.model.entities.set(alpha.id, { ...alpha, name: 'renamed' });
  assert.notStrictEqual(f.places.calendarIdentities(f.sources(), f.bridge.version), before, 'map mutations invalidate independently of bridge revision');
  f.edited();
  f.defer(true);
  const deferred = f.places.calendarIdentities(f.sources(), f.bridge.version);
  assert.notStrictEqual(deferred, before);
  assert.deepEqual(deferred.get(alpha.id), { id: 'g-alpha', name: 'alpha' }, 'existing deferred-read semantics remain');
  f.defer(false); f.places.sync(true);
  const installed = f.places.calendarIdentities(f.sources(), f.bridge.version);
  assert.deepEqual(installed.get(alpha.id), { id: 'g-renamed', name: 'renamed' }, 'the completed install replaces a deferred identity');
  before = installed;
  for (const edit of [() => { f.model.state = { ...f.model.state, constitution: 'updated' }; }, () => { const g = f.model.ground(); f.model.terrain.update({ ...g, extent: [-210, -200, 200, 200] }, []); }]) {
    const safetyKey = f.model.safetyCacheKey(); edit(); f.bridge.version++;
    assert.strictEqual(f.model.safetyCacheKey(), safetyKey, 'terrain/state are outside the map safety key');
    const after = f.places.calendarIdentities(f.sources(), f.bridge.version);
    assert.notStrictEqual(after, before, 'bridge revision invalidates even without a map change'); before = after;
  }
});

test('calendar misses use live native names, containment and moved source positions', () => {
  const f = fixture(), bench = f.model.get('bench')!, lookup = f.bridge.calendarPlaces(f.sources());
  assert.deepEqual(lookup(bench), { id: 'world', name: 'World' });
  const native: Place = { ...f.edge.places.byId.get('world')!, id: 'native', name: 'Native hall', parent: 'world', polygon: [[-2, 18], [2, 18], [2, 22], [-2, 22]] };
  f.edge.places.add(native);
  assert.deepEqual(lookup(bench), { id: 'native', name: 'Native hall' });
  f.edge.places.byId.set(native.id, { ...native, name: 'Renamed hall' });
  assert.deepEqual(lookup(bench), { id: 'native', name: 'Renamed hall' });
  f.act([{ op: 'move', id: 'bench', p: [30, 20] }]); f.edited();
  const moved = f.model.get('bench')!;
  assert.deepEqual(f.bridge.calendarPlaces(f.sources())(moved), { id: 'world', name: 'World' });
  f.edge.places.byId.delete(native.id);
  assert.deepEqual(lookup(bench), { id: 'world', name: 'World' });
});

test('new calendar sources entering the horizon reuse primed identities and match uncached records', () => {
  const f = fixture(), db = new DatabaseSync(':memory:'); ensureCommsSchema(db);
  try {
    const objects = new Objects({ db, worldId: 'calendar-places', now: () => 1000, tick: () => f.engine.world.tick, nameOf: (id: string) => id } as CommsCore);
    objects.register(calendarKind);
    let prepared = 0;
    const host: LayersHost = { model: f.model, engine: f.engine, living: () => f.clock, edge: { comms: { objects } } as never,
      engineAct: () => { throw new Error('no follow states'); }, log: message => { throw new Error(message); },
      placeOf: e => f.bridge.layerPlace(e), calendarPlaces: sources => { prepared++; return f.bridge.calendarPlaces(sources); } };
    const layers = new GodLayers(host), c = layers.clock()!;
    const weekdays = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    f.act([
      { op: 'set', id: 'alpha', schedule: { events: [{ name: 'today', at: '06:00', minutes: 60, days: [weekdays[c.weekday]] }] } },
      { op: 'set', id: 'beta', schedule: { events: [{ name: 'tomorrow', at: '06:30', minutes: 60, days: [weekdays[(c.weekday + 1) % 7]] }] } },
    ]); f.edited();
    assert.equal(layers.step().posted, 1); assert.equal(prepared, 1);
    const derives = f.places.stats.derives;
    assert.equal(layers.step().posted, 0); assert.equal(prepared, 1, 'no lookup preparation without a new occurrence');
    f.engine.world.tick = 1500; // 06:30; a new description bucket and tomorrow's event enters the horizon.
    assert.equal(layers.step().posted, 1); assert.equal(prepared, 2);
    assert.equal(f.places.stats.derives, derives, 'even the source first posted later was primed');
    const generated = objects.all().find(o => o.name === 'tomorrow')!;
    const params = objects.creationParams(generated.id)!;
    assert.equal(params.placeId, 'g-beta'); assert.equal(params.placeName, 'beta');
    assert.equal(params.startsAtTick, 73500); assert.equal(params.durationTicks, 3000);
    assert.deepEqual(params.godSchedule, { entity: f.model.get('beta')!.id, event: 'tomorrow', date: new Date(Date.parse(c.day) + 86400_000).toISOString().slice(0, 10) });
    objects.remove(generated.id);
    delete host.calendarPlaces;
    assert.equal(layers.step().posted, 1);
    assert.deepEqual(objects.creationParams(generated.id), params, 'uncached creation has identical identity, text, timing and provenance');
  } finally { db.close(); }
});
