// RESOLVE (2026-10-21, naive Soul phrases from real Claude Code Souls on Eden 2026): "find a boat" had no "find" capability;
// "go to the bakery" went into its storeroom (the nearest match), not in at the shop front; "go to the pond" went to a tree
// whose label says it stands "by" the pond reeds; "go to the lighthuose" named nothing. A misspelt word is read as the
// closest word this world knows, but a word spelt right is never re-read ("go to the horse" in Mars is not the bunk house).
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveCapability, typoFix, type VocabContext, type VocabPlace} from './edge/ledger/vocabulary.ts';
import type {EdgeCapability} from './edge/contract.ts';

const places: VocabPlace[] = [
  {id: 'int-bakery', name: 'int-bakery', kind: 'building', center: [20, 0], walkable: true}, {id: 'int-bakery/storeroom', name: 'Storeroom', kind: 'room', parent: 'int-bakery', center: [16, 0], walkable: true},
  {id: 'shore-pond', name: 'shore-pond', kind: 'water', center: [40, 0], walkable: true}, {id: 'pond-reeds', name: 'pond-reeds', kind: 'outdoor', center: [15, 10], walkable: true},
  {id: 'lighthouse-breakwater', name: 'lighthouse-breakwater', kind: 'pier', center: [200, 0], walkable: true},
];
const at = new Map<string, [number, number]>([...places.map(p => [p.id, p.center] as [string, [number, number]]), ['tree-2', [8, 8]], ['int-bakery/storeroom-shelf-1', [12, 0]], ['bench-1', [5, 0]], ['bench-2', [30, 0]], ['rowing-boat', [90, 0]]]);
const P = (id: string, label: string): EdgeCapability => ({id: `walk:${id}`, verb: 'walk', label, available: true, target: {id, kind: 'place'}});
const O = (id: string, label: string): EdgeCapability => ({id: `walk:${id}`, verb: 'walk', label, available: true, target: {id, kind: 'object'}});
const caps: EdgeCapability[] = [
  P('int-bakery', 'Walk to int-bakery, a hall: in at its front door (1 rooms, each walk:int-bakery/<room>; 20 m)'), P('int-bakery/storeroom', 'Go into Storeroom of int-bakery (int-bakery/storeroom; 16 m)'),
  O('int-bakery/storeroom-shelf-1', 'Walk to int-bakery/storeroom-shelf-1, a shelf in int-bakery, by int-bakery/storeroom (12 m)'),
  P('shore-pond', 'Walk to the shore of shore-pond, a pond (40 m)'), P('pond-reeds', 'Walk to pond-reeds, a reedbed, by shore-pond (18 m)'),
  O('tree-2', 'Walk to tree-2, a tree, by pond-reeds and shore-pond (11 m)'), O('bench-1', 'Walk to bench-1, a bench (5 m)'), O('bench-2', 'Walk to bench-2, a bench (30 m)'),
  O('rowing-boat', 'Walk to rowing-boat, a rowing-boat, by shore-pond (90 m)'), P('lighthouse-breakwater', 'Walk to lighthouse-breakwater, a pier (200 m)'),
];
const ctx = (): VocabContext => ({caps, places, root: ['eden'], me: [0, 0], target: c => ({names: [], around: [], at: c.target ? at.get(c.target.id) ?? null : null})});
const to = (input: string) => {const r = resolveCapability(input, ctx()); return r.kind === 'unknown' ? {unknown: r.code ?? 'capability.unknown'} : r.cap.id;};

test('RESOLVE vocabulary: find / look for / search for X walks to the nearest X', () => {
  assert.equal(to('find a bench'), 'walk:bench-1');
  assert.equal(to('look for a bench'), 'walk:bench-1');
  assert.equal(to('search for a boat'), 'walk:rowing-boat');
  assert.equal(to('can you find me a boat?'), 'walk:rowing-boat');
  assert.deepEqual(to('find a dragon'), {unknown: 'capability.unknown'}, 'nothing so named: refused, nothing swapped in');
});

test('RESOLVE vocabulary: a building name goes in at its front door, not to the nearest room inside it', () => {
  assert.equal(to('go to the bakery'), 'walk:int-bakery', 'not its storeroom shelf, the nearest thing whose name holds "bakery"');
  assert.equal(to('go into the bakery'), 'walk:int-bakery');
  assert.equal(to('enter the bakery'), 'walk:int-bakery');
  assert.equal(to('go to the storeroom'), 'walk:int-bakery/storeroom', 'a room named for itself is still that room');
  assert.equal(to('go to the shelf'), 'walk:int-bakery/storeroom-shelf-1');
});

test('RESOLVE vocabulary: "by <neighbours>" in a walk label is not the thing\'s own name; what the words say comes first', () => {
  assert.equal(to('go to the pond'), 'walk:shore-pond', 'the pond, not the tree by the pond reeds (nearer) nor the reeds');
  assert.equal(to('go to the tree'), 'walk:tree-2');
  assert.equal(to('go to the reeds'), 'walk:pond-reeds');
});

test('RESOLVE typoFix: a misspelt word is read as the closest word this world knows; real words are never re-read', () => {
  const fix = (s: string, extra: string[] = []) => typoFix(s, ctx(), extra)?.text ?? null;
  assert.equal(fix('go to the lighthuose'), 'go to the lighthouse');
  assert.equal(fix('go to the bakrey'), 'go to the bakery');
  assert.deepEqual(to('go to the bakrey'), {unknown: 'capability.unknown'}, 'resolveCapability itself never guesses (the ledger reads the fix, once)');
  assert.equal(fix('go to the bnech'), 'go to the bench');
  assert.equal(fix('go to the pond'), null, 'nothing misspelt');
  assert.equal(fix('go to the dog'), null, 'three letters are never read as another word');
  // Mars-like: a bunk house and a fire circle, no horse
  const mars: VocabContext = {caps: [P('bunk-house', 'Bunk house'), P('fire-circle', 'Fire circle'), P('south-gate', 'South gate')], places: [], root: ['mars'], me: [0, 0], target: () => ({names: [], around: [], at: null})};
  const mfix = (s: string, extra: string[] = []) => typoFix(s, mars, extra)?.text ?? null;
  assert.equal(mfix('go to the horse'), null, 'a horse is not the bunk house');
  assert.equal(mfix('sit on the couch'), null, 'a couch is not the south gate');
  assert.equal(mfix('go to the hrose'), null, 'nearer to a real word (horse) than to any of this world\'s: no reading');
  assert.equal(mfix('go to the hrose', ['horse']), 'go to the horse', 'when this world has a horse, "hrose" is it');
  assert.equal(mfix('go to the fyre circle'), 'go to the fire circle');
  assert.deepEqual(typoFix('go to the fyre circle', mars)?.fixes, [['fyre', 'fire']]);
});
