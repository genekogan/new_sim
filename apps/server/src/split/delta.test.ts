// Lane B-delta: WorldDelta v1 / WorldInit v1 / Replica, over a small fake host (the live-copy oracle is split/delta-oracle.ts).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DeltaTap, installDeltaStream, type StreamMessage} from './delta.ts';
import {freshTables, worldInit} from './world-init.ts';
import {Replica, ReadModel, type WorldDelta} from './read-model.ts';
import type {EdgeReceipt} from '../edge/contract.ts';

type E = {id: string; kind: string; def: string; label?: string; pose: {p: number[]; yaw: number}; human?: Record<string, unknown>; carrier?: unknown};
function fakeWorld() {
  const entities: Record<string, E> = {
    h_a: {id: 'h_a', kind: 'human', def: 'human', label: 'A', pose: {p: [0, 0, 0], yaw: 0}, human: {activity: 'idle', level: 0, speed: 0}},
    h_b: {id: 'h_b', kind: 'human', def: 'human', label: 'B', pose: {p: [5, 0, 0], yaw: 0}, human: {activity: 'idle', level: 0}},
    bike: {id: 'bike', kind: 'thing', def: 'bicycle', pose: {p: [9, 0, 9], yaw: 0}, carrier: {phase: 'docked', rider: null}},
    bench: {id: 'bench', kind: 'thing', def: 'core/bench@1', pose: {p: [3, 0, 3], yaw: 0}},
  };
  const world = {tick: 100, entities, regions: {}, env: {datetime: 't0', weather: {rain: 0}}, navV1: {solids: []}};
  const programs = new Map<string, string>();
  const engine = {world, programOf: (a: string) => programs.get(a) ?? null, programAction: (p: string) => ({step: 0, action: {id: 'x' + p, verb: 'walk_to', status: 'executing'}}),
    nativeSeatHoldsV1: () => [], carriers: () => Object.values(entities).filter(e => e.carrier).map(e => ({id: e.id})), staticEpochV1: () => 1,
    rt: {services: {spatial: {epoch: 1}}}};
  const minds = new Map([['s_a', {soulId: 's_a', entityId: 'h_a', name: 'A', owner: 'u', native: false}], ['s_b', {soulId: 's_b', entityId: 'h_b', name: 'B', owner: 'u', native: false}]]);
  const records = new Map<string, unknown>(); let gen = 0;
  const deltas: {gen: number; id: string; record: unknown}[] = [];
  const table = {get generation() {return gen;}, changes: (since: number) => ({gen, deltas: deltas.filter(d => d.gen > since), settled: true}), snapshot: () => ({gen, records: [...records.values()]}),
    put(id: string, r: unknown) {gen++; if (r) records.set(id, r); else records.delete(id); deltas.push({gen, id, record: r});}};
  const receiptL: ((r: EdgeReceipt) => void)[] = []; const open = new Map<string, EdgeReceipt>();
  const host = {worldId: 'w', seq: 1, engine, minds, living: {origin: 0, dayTicks: 72000}, snapshotView: () => ({entities: structuredClone(entities)}), splitTap: undefined as unknown};
  const L = {onReceipt: (f: (r: EdgeReceipt) => void) => receiptL.push(f), faded: new Set<string>(), together: {version: 0, publicItems: () => []},
    places: {byId: new Map(), version: 0}, spots: {spots: []}, enclosurePlaces: () => [], staticVersion: () => 'sv', comms: {objects: {objectTable: () => table}},
    openReceipts: (soulId: string) => [...open.values()].filter(r => r.soulId === soulId), menuInputFns: [() => 'god:0|']};
  const receipt = (r: Partial<EdgeReceipt> & {id: string; soulId: string; phase: string}) => {const full = {capability: 'walk:x', acceptedTick: world.tick, startedTick: null, endedTick: null, code: null, reason: null, programId: null, ...r} as EdgeReceipt; if (r.phase === 'waiting' || r.phase === 'started') open.set(r.id, full); else open.delete(r.id); for (const f of receiptL) f(full);};
  return {world, entities, engine, host, L, table, programs, receipt};
}
const tick = (f: ReturnType<typeof fakeWorld>, tap: DeltaTap, changes: [number, string, string, unknown][] = [], programs: {actor: string}[] = []) => {f.world.tick++; tap.onTick(f.world.tick, {paths: [], changes, programs: programs as never});};
function same(R: Replica, f: ReturnType<typeof fakeWorld>, tap: DeltaTap) {
  const x = freshTables(f.host as never, f.L as never, tap, {cloneEntities: true});
  assert.deepEqual(Object.fromEntries(R.entities), x.entities);
  assert.deepEqual(R.env, x.env); assert.deepEqual([...R.minds.values()], x.minds);
  for (const m of x.minds) assert.deepEqual(R.openReceipts(m.soulId), x.receipts.filter(r => r.soulId === m.soulId));
  assert.deepEqual([...R.programs.values()], x.programs); assert.deepEqual([...R.objects.values()], x.objects.records); assert.equal(R.objectGen, x.objects.gen);
  assert.deepEqual(R.menuInputs, x.menuInputs);
}

test('a replica from init + deltas equals a fresh read after every write path', () => {
  const f = fakeWorld(), tap = new DeltaTap(f.host as never, f.L as never), R = new Replica(), got: StreamMessage[] = [];
  R.init(structuredClone(worldInit(f.host as never, f.L as never, tap)));
  tap.subscribe(m => {got.push(m); if (!('t' in m)) assert.equal(R.apply(structuredClone(m)), true);});
  // a walk: pose + speed only (no event), then a programme event and a receipt
  f.entities.h_a.pose = {p: [1, 0, 0.5], yaw: 0.3}; f.entities.h_a.human!.speed = 0.4; f.world.env.datetime = 't1'; tick(f, tap); same(R, f, tap);
  assert.deepEqual((got.at(-1) as WorldDelta).bodies, [['h_a', 1, 0, 0.5, 0.3, 0.4]]);
  f.programs.set('h_a', 'p1'); f.entities.h_a.human!.task = 'a1'; f.receipt({id: 'r1', soulId: 's_a', phase: 'waiting'}); f.receipt({id: 'r1', soulId: 's_a', phase: 'started', programId: 'p1'}); tick(f, tap, [], [{actor: 'h_a'}]); same(R, f, tap);
  f.programs.delete('h_a'); f.receipt({id: 'r1', soulId: 's_a', phase: 'completed'}); tick(f, tap, [], [{actor: 'h_a'}]); same(R, f, tap);
  // comms objects: save, advance, remove (L8 table deltas, never a scan)
  f.table.put('m1', {id: 'm1', kind: 'mark', name: 'n', description: '', placeId: 'p', version: 1, state: {at: [1, 1]}, createdAt: 0}); tick(f, tap); same(R, f, tap);
  f.table.put('m1', {id: 'm1', kind: 'mark', name: 'n', description: '', placeId: 'p', version: 2, state: {at: [1, 1], removed: true}, createdAt: 0}); f.table.put('m1', null); tick(f, tap); same(R, f, tap);
  // birth (a 'present' change), retire, god commit (menu input), carrier state change
  f.entities.h_c = {id: 'h_c', kind: 'human', def: 'human', pose: {p: [2, 0, 2], yaw: 0}, human: {activity: 'idle', level: 0}}; f.host.minds.set('s_c', {soulId: 's_c', entityId: 'h_c', name: 'C', owner: 'u', native: false});
  tick(f, tap, [[f.world.tick + 1, 'h_c', 'present', {}]]); same(R, f, tap);
  delete (f.entities as Record<string, E>).h_b; f.host.minds.delete('s_b'); tick(f, tap, [[f.world.tick + 1, 'h_b', 'present', null]]); same(R, f, tap);
  f.L.menuInputFns[0] = () => 'god:1|site-1'; tick(f, tap); same(R, f, tap);
  f.entities.bike.carrier = {phase: 'riding', rider: 'h_a'}; tick(f, tap, [[f.world.tick + 1, 'bike', 'on', 'x']]); same(R, f, tap);
  delete (f.entities as Record<string, E>).bench; tick(f, tap, [[f.world.tick + 1, 'bench', 'present', null]]); same(R, f, tap);
  assert.deepEqual(R.carrierRows().map(c => c.state), [{phase: 'riding', rider: 'h_a'}]);
});

test('ordered, resumable: out of order refused, since() from the ring, restart = new gen + resnapshot signal', () => {
  const f = fakeWorld(), tap = new DeltaTap(f.host as never, f.L as never), msgs: StreamMessage[] = [];
  tap.subscribe(m => msgs.push(m));
  const R = new Replica(); R.init(structuredClone(worldInit(f.host as never, f.L as never, tap)));
  for (let i = 0; i < 5; i++) {f.entities.h_a.pose = {p: [i, 0, 0], yaw: 0}; tick(f, tap);}
  const ds = msgs as WorldDelta[];
  assert.deepEqual(ds.map(d => d.seq), [1, 2, 3, 4, 5]);
  assert.equal(R.apply(structuredClone(ds[1])), false, 'seq 2 before seq 1 is refused');
  assert.deepEqual(tap.since(1, 2)!.map(d => d.seq), [3, 4, 5]);
  assert.equal(tap.since(2, 0), null, 'another gen');
  for (const d of tap.since(R.pos.gen, R.pos.seq)!) assert.equal(R.apply(structuredClone(d)), true);
  same(R, f, tap);
  // a WorldInit served between ticks after a write that the next delta also carries: applying it is still exact
  f.receipt({id: 'r2', soulId: 's_b', phase: 'waiting'});
  const late = new Replica(); late.init(structuredClone(worldInit(f.host as never, f.L as never, tap)));
  f.receipt({id: 'r2', soulId: 's_b', phase: 'replaced'}); tick(f, tap);
  assert.equal(late.apply(structuredClone(msgs.at(-1) as WorldDelta)), true); same(late, f, tap);
  tap.restart('test');
  assert.deepEqual(msgs.at(-1), {t: 'resnapshot', gen: 2, reason: 'test'});
  assert.equal(tap.since(1, 5), null);
  tick(f, tap); assert.equal(R.apply(structuredClone(msgs.at(-1) as WorldDelta)), false, 'a delta of the new gen needs a new init');
  const init = worldInit(f.host as never, f.L as never, tap); assert.equal(init, worldInit(f.host as never, f.L as never, tap), 'one WorldInit per stream state');
  assert.equal(init.gen, 2); assert.equal(init.seq, 1);
});

test('the read worker subset still answers over a replica; installDeltaStream is off by default', () => {
  const f = fakeWorld(), tap = new DeltaTap(f.host as never, f.L as never), M = new ReadModel();
  M.init(structuredClone(worldInit(f.host as never, f.L as never, tap)));
  assert.deepEqual(M.here('s_a').near, [{id: 's_b', dist: 5}]);
  assert.deepEqual(M.capabilities('s_a'), ['face:s_b', 'go-near:s_b', 'wave:s_b']);
  assert.equal(installDeltaStream(f.host as never, f.L as never, {}), null);
  assert.equal(f.host.splitTap, undefined);
  assert.ok(installDeltaStream(f.host as never, f.L as never, {SIM_READ_WORKER: '1'}));
  assert.equal(typeof f.host.splitTap, 'function');
});
