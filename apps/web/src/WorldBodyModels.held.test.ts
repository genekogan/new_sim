import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { WorldBodyModels } from './WorldBodyModels.ts';

// P1 phones: a held WorldBodyModels fetches nothing (a simple figure stands in: the body stays unresolved); once released,
// the next sync starts the load.
const url = '/v1/edge/body/assets/body_' + 'a'.repeat(64) + '.glb';
const records = { s1: { kind: 'human', body: { family: 'humanoid', modelUrl: url } } };
const entities = { s1: { p: [0, 0, 0], state: {} } } as unknown as Parameters<WorldBodyModels['sync']>[1];

test('held: unresolved, nothing fetched; released: the next sync fetches once', () => {
  const asked: string[] = [];
  const loader = { loadAsync: (u: string) => { asked.push(u); return new Promise(() => {}); } } as unknown as GLTFLoader;
  const m = new WorldBodyModels(loader, () => {});
  m.held = true;
  m.sync(records, entities); m.sync(records, entities);
  assert.deepEqual(asked, []); assert.ok(m.unresolved.has('s1'));
  m.held = false;
  m.sync(records, entities); m.sync(records, entities);
  assert.equal(asked.length, 1); assert.ok(asked[0].endsWith(url)); assert.ok(m.unresolved.has('s1'));
});

test('not held (desktop, old worlds): the first sync fetches', () => {
  const asked: string[] = [];
  const loader = { loadAsync: (u: string) => { asked.push(u); return new Promise(() => {}); } } as unknown as GLTFLoader;
  new WorldBodyModels(loader, () => {}).sync(records, entities);
  assert.equal(asked.length, 1);
});
