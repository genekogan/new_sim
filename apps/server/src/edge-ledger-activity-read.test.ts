import test from 'node:test';
import assert from 'node:assert/strict';
import type {Entity, WorldState} from '../../../mars/viewer/engine/world/types.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {activityCapabilities, loadSpots, type ActivityWorld} from './edge/ledger/activities.ts';

// Exercise the real private adapter without a clock, database or behavior runner. Its only consumer is the
// synchronous read-only activity listing; entity membership may change between listings, never inside one.
function fixture() {
  const human = (id: string, group?: string, x = 100): Entity => ({id, kind: 'human', pose: {p: [x, 0, 100], yaw: 0},
    human: {activity: 'idle', ...(group === undefined ? {} : {together: {group, phase: 'waiting', mobile: false}})}} as Entity);
  const entities: WorldState['entities'] = {me: human('me', 'self'), a: human('a', 'far'), b: human('b', 'far'), missing: human('missing')};
  entities.me.pose.p = [0, 0, 0];
  entities.prop = {...human('prop', 'far'), kind: 'fixture'};
  const world = {entities, regions: {}, tick: 0};
  const ledger = Object.assign(Object.create(EdgeLedger.prototype), {host: {engine: {world, clearanceAtV1: () => 2}, minds: new Map(), kernel: {things: {}}}, places: {byId: new Map()}}) as {
    activityWorld(soul: {entityId: string; soulId: string}, me: Entity, caps: never[], plans: Map<string, never>): ActivityWorld;
  };
  const read = () => ledger.activityWorld({entityId: 'me', soulId: 's-me'}, world.entities.me, [], new Map<string, never>());
  const legacy = (group: string) => Object.values(world.entities).filter(e => e.kind === 'human' && e.human?.together?.group === group).length;
  return {world, human, read, legacy};
}

test('activity read: exact group comparisons include self and live human state, with fresh membership each listing', () => {
  const f = fixture(), first = f.read();
  const check = (view: ActivityWorld) => {
    // Preserve strict equality even for malformed runtime callers; no truthiness or Map equality substitution.
    for (const group of ['self', 'far', 'other', '', '__proto__', undefined, null, NaN] as unknown as string[])
      assert.equal(view.groupSize(group), f.legacy(group), String(group));
  };
  check(first); assert.equal(first.groupSize('self'), 1); assert.equal(first.groupSize('far'), 2);
  f.world.entities.a.human!.together!.group = 'other'; check(first);
  delete f.world.entities.b.human!.together; check(first);
  f.world.entities.missing.human!.together = {group: '', phase: 'active', mobile: false}; check(first);
  delete f.world.entities.a.human; check(first);
  // Supported structural changes occur before the next synchronous listing, including a previously nonhuman row.
  f.world.entities.added = f.human('added', 'far');
  f.world.entities.prop.kind = 'human';
  delete f.world.entities.b;
  check(f.read()); assert.equal(f.read().groupSize('far'), 2);
  f.world.entities = {me: f.human('me', '__proto__'), replacement: f.human('replacement', 'far')};
  check(f.read()); assert.equal(f.read().groupSize('__proto__'), 1);
});

test('activity read: exact capabilities, labels, blocked states and plan order match the full-table oracle', () => {
  const f = fixture();
  const club = (id: string, x: number, group: string) => ({id, activity: 'book-club', base: 'sit', at: [x, 0], faceTo: [x, 1], seatHeight: 0.45,
    together: {group, need: 1, wait: 150, alone: 'fail'}});
  const loaded = loadSpots({contract: 'activity-spots/1', spots: [club('near', 2, 'near'), club('far', 40, 'far'),
    {id: 'court', activity: 'play-frisbee', base: 'idle', at: [10, 10], faceTo: [15, 10], place: 'park'}]});
  assert.deepEqual(loaded.refused, []);
  const data = {...loaded.data, nearest: 1};
  const compare = () => {
    const w = f.read(), before = structuredClone(f.world), actual = activityCapabilities(data, w);
    const expected = activityCapabilities(data, {...w, groupSize: f.legacy});
    assert.deepEqual(actual, expected); assert.deepEqual(f.world, before, 'listing leaves world state unchanged');
    return actual;
  };
  const initial = compare();
  assert.match(initial.caps.find(c => c.id === 'book-club:far')!.label, /2 waiting on the other end, join them/);
  f.world.entities.a.human!.together!.group = 'other'; delete f.world.entities.b;
  assert.equal(compare().caps.some(c => c.id === 'book-club:far'), false, 'no stale joinable group past nearest-N');
  f.world.entities.a.pose.p = [2, 0, 0];
  assert.equal(compare().caps.some(c => c.id === 'book-club:near'), false, 'fresh occupied-position view');
  const game = initial.plans.get('play-frisbee:court')!.steps.at(-1)!.params as {group: string};
  for (let i = 0; i < 6; i++) f.world.entities['player' + i] = f.human('player' + i, game.group, 200 + i);
  const full = compare().caps.filter(c => c.verb === 'play-frisbee');
  assert.ok(full.length > 0); assert.ok(full.every(c => !c.available && c.blocked?.code === 'game.full'));
});
