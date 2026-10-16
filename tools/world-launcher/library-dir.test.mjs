// M4 shared library: every world a launcher starts shares <data>/library (Gene 2026-10-16 default).
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultCommand } from './children.mjs';

test('worlds get SIM_LIBRARY_DIR from the launcher pool, and none without it', () => {
  const world = { slug: 'lib-a', name: 'A', dataDir: '/tmp/x/worlds/lib-a' };
  assert.equal(defaultCommand(world, 6001, { publicOrigin: 'http://127.0.0.1:6000', libraryDir: '/tmp/x/library' }).env.SIM_LIBRARY_DIR, '/tmp/x/library');
  assert.equal(defaultCommand(world, 6001, { publicOrigin: 'http://127.0.0.1:6000' }).env.SIM_LIBRARY_DIR, undefined);
});
