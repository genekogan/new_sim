// L1: world processes get the glibc malloc settings that keep their RSS near what they hold (production.mjs WORLD_MALLOC_ENV).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decorateCommand, WORLD_MALLOC_ENV } from './production.mjs';

test('every world child gets the malloc settings; an explicit value wins', () => {
  const s = { devAuth: false, publicOrigin: 'https://sim.eden.art', base: '/worlds', worldHeapMb: 0 };
  const c = decorateCommand({ cmd: 'node', args: ['apps/server/src/main.ts'], env: { WORLD_KEY: 'eden-2026' } }, s);
  for (const [k, v] of Object.entries(WORLD_MALLOC_ENV)) assert.equal(c.env[k], v, k);
  assert.equal(c.env.MALLOC_MMAP_THRESHOLD_, '262144');
  const own = decorateCommand({ cmd: 'node', args: [], env: { MALLOC_ARENA_MAX: '4' } }, s);
  assert.equal(own.env.MALLOC_ARENA_MAX, '4');
  assert.equal(own.env.MALLOC_TRIM_THRESHOLD_, '1048576');
});
