import { test } from 'node:test';
import assert from 'node:assert/strict';
import { goallessEntryAlias, walkAudit } from './walk-audit.ts';
import type { Thing } from './nav.ts';

const root: Thing = { id: 'building-id', ref: 'pavilion', kind: 'building', name: 'Pavilion', what: 'a pavilion', words: [], at: [0, 0], level: 0, rooms: ['pavilion/hall'] };
const room: Thing = { ...root, ref: 'pavilion/hall', kind: 'room', room: 'hall', rooms: undefined, at: [65, 0] };
const alias = (a: Thing, b: Thing = room, goals: string[] = []) => goallessEntryAlias(a, new Map([[b.ref, b]]), t => goals.includes(t.ref));

test('blocked root entry and its sole room retain one canonical interior failure', () => {
  assert.equal(alias(root), room.ref);
  assert.equal(alias(room), undefined);
  assert.equal(alias(root, room, [root.ref]), undefined, 'a valid exterior approach is not a blocked alias');
  assert.equal(alias(root, room, [room.ref]), undefined, 'a newly failed root cannot hide behind a reachable room');
});

test('distinct approach, room and entity failures never collapse', () => {
  for (const a of [
    { ...root, doorOpen: true }, { ...root, kind: 'thing' as const },
    { ...root, rooms: [room.ref, 'pavilion/second'] }, { ...root, rooms: [] },
    { ...root, rooms: ['other/hall'] }, { ...root, semanticPart: { owner: 'x', part: 'y' } },
  ]) assert.equal(alias(a), undefined);
  for (const b of [
    { ...room, id: 'other-entity' }, { ...room, kind: 'thing' as const },
    { ...room, room: 'wrong' }, { ...room, room: undefined },
    { ...room, semanticPart: { owner: 'x', part: 'y' } },
  ]) assert.equal(alias(root, b), undefined);
});

function world(things: Thing[], reachable: string[] = []) {
  return { name: 'aliases', worldId: 'aliases', refused: [], god: { model: { entities: new Map(), pathOf: (id: string) => id } },
    bridge: { nav: { things: () => things, goal: (t: Thing) => reachable.includes(t.ref) ? { p: t.at, level: 0 } : null } },
    engine: { connectivityV1() {}, navTargetsV1: () => [], navCheckV1: () => [] } } as any;
}

test('audit shards preserve canonical debt and explicit root alias evidence', async () => {
  const w = world([root, room]);
  const parts = await Promise.all([walkAudit(w, [0, 2]), walkAudit(w, [1, 2])]);
  assert.deepEqual(parts.flatMap(p => p.goalless), [[room.ref, 'pavilion']]);
  assert.deepEqual(parts.flatMap(p => p.goallessAliases ?? []), [[root.ref, room.ref, 'pavilion']]);
  const old = await walkAudit(world([root, room], [root.ref]));
  assert.deepEqual(old.goalless, [[room.ref, 'pavilion']], 'previous exterior goal never made the room walkable');
  const newlyBlocked = await walkAudit(world([root, room]));
  const formerlyOpen = await walkAudit(world([root, room], [root.ref, room.ref]));
  assert.equal(newlyBlocked.goalless.length - formerlyOpen.goalless.length, 1, 'a new interior failure still increases debt');
  const distinct = await walkAudit(world([{ ...root, doorOpen: true }, room]));
  assert.equal(distinct.goalless.length, 2);
  const multiroom = await walkAudit(world([{ ...root, rooms: [room.ref, 'pavilion/second'] }, room, { ...room, ref: 'pavilion/second', room: 'second' }]));
  assert.equal(multiroom.goalless.length, 3);
});
