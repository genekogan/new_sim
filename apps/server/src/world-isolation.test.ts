import test from 'node:test';
import assert from 'node:assert/strict';
import { Db } from './db.ts';
import { WorldHost } from './world.ts';
import { toyFactory } from '@sim/engine-toy';
import { publicMarsAsset } from './mars-static.ts';

test('configured world identities keep their events and checkpoints separate; toy fixture stays toy-1', () => {
  const db = new Db(':memory:');
  const toy = new WorldHost(db, toyFactory, 'toy', 100), mars = new WorldHost(db, toyFactory, 'mars', 100, 'mars-1');
  toy.boot(); mars.boot(); toy.tickOnce(); mars.tickOnce();
  void mars.enqueue('admin', 'admin', { action: 'proof' }); mars.tickOnce();
  toy.saveSnapshot(); mars.saveSnapshot();
  assert.equal(toy.worldId, 'toy-1');
  assert.equal(db.events('toy-1').some(e => e.kind === 'admin'), false);
  assert.equal(db.events('mars-1').some(e => e.kind === 'admin'), true);
  assert.equal(db.latestSnapshot('toy-1')?.tick, 1);
  assert.equal(db.latestSnapshot('mars-1')?.tick, 2);
  db.close();
});
test('Mars asset proxy admits published derivatives and refuses source archives, APIs, traversal and encoded paths', () => {
  for (const path of ['/browser/campus.glb', '/modular/environment/animated-casual.glb', '/engine/campus-2026.json', '/data/manifest.json']) assert.equal(publicMarsAsset(path), true, path);
  for (const path of ['/browser/campus.blend', '/modular/../private.json', '/api/simulation/room', '/.cloudflare/simulation-test-room.json', '/modular/%2e%2e/private.json', '//evil.test/engine/a.json', '/research/photo.jpg']) assert.equal(publicMarsAsset(path), false, path);
});
