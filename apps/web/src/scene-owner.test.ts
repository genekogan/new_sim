import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sceneOwner, type SceneOwnerMemory } from './scene-owner.ts';

test('a new world page starts its scene before the welcome and keeps it through the first welcome of that world', () => {
  const m: SceneOwnerMemory = {};
  const boot = sceneOwner(null, 'w-1', m);
  assert.deepEqual(boot, { worldId: 'w-1', epoch: 'boot' });
  assert.deepEqual(sceneOwner(null, 'w-1', m), boot, 'idempotent (StrictMode renders twice)');
  assert.deepEqual(sceneOwner({ worldId: 'w-1', epoch: 'e1' }, 'w-1', m), boot, 'the first welcome is adopted: same key, no teardown');
  assert.deepEqual(sceneOwner({ worldId: 'w-1', epoch: 'e1' }, 'w-1', m), boot, 'a reconnect to the same server process keeps it');
  assert.deepEqual(sceneOwner({ worldId: 'w-1', epoch: 'e2' }, 'w-1', m), { worldId: 'w-1', epoch: 'e2' }, 'a restarted server rebuilds the scene');
  assert.deepEqual(sceneOwner(null, 'w-1', m), boot, 'a lost welcome never stops a booted scene');
});

test('old worlds (no boot world) still wait for the welcome; a welcome for another world rebuilds', () => {
  assert.equal(sceneOwner(null, undefined, {}), null);
  assert.deepEqual(sceneOwner({ worldId: 'old', epoch: 'e' }, undefined, {}), { worldId: 'old', epoch: 'e' });
  const m: SceneOwnerMemory = {}; sceneOwner(null, 'w-1', m);
  assert.deepEqual(sceneOwner({ worldId: 'w-2', epoch: 'e' }, 'w-1', m), { worldId: 'w-2', epoch: 'e' });
});

test('LiveWorld keys its scene on the owner, and Shell hands it the page world for new worlds only', () => {
  const live = readFileSync(new URL('./LiveWorld.tsx', import.meta.url), 'utf8'), shell = readFileSync(new URL('./Shell.tsx', import.meta.url), 'utf8');
  assert.match(live, /if \(!mount\.current \|\| !owner\) return;/);
  assert.match(live, /\}, \[owner\?\.worldId, owner\?\.epoch\]\);/);
  assert.match(shell, /bootWorldId=\{launcherWorld\?cfg\.worldId:undefined\}/);
});
