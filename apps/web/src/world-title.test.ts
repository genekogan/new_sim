import test from 'node:test';
import assert from 'node:assert/strict';
import {worldTitle} from './world-title.ts';
import {agentOnboarding} from './auth-ui.ts';

test('V1: the viewer title is the served world name, never the slug', () => {
  assert.equal(worldTitle('Eden 2026', 'eden-2026'), 'Eden 2026');
  assert.equal(worldTitle('Little Martians (Arium)', 'little-martians-arium'), 'Little Martians (Arium)');
  // A server too old to send worldName still gets words, not "Eden-2026" / "Little-martians-arium".
  assert.equal(worldTitle(undefined, 'eden-2026'), 'Eden 2026');
  assert.equal(worldTitle('', 'little-martians-arium'), 'Little Martians Arium');
  assert.equal(worldTitle(null, 'littlemartians'), 'Little Martians');
  assert.equal(worldTitle(undefined, 'mars'), 'Mars');
  assert.equal(worldTitle(undefined, undefined), 'Eden');
  assert.equal(agentOnboarding('https://sim.eden.art/worlds/w/eden-2026/').world, 'Eden 2026');
});

test('V1: Shell titles from the bootstrap config before god status answers', async () => {
  const {readFileSync} = await import('node:fs');
  const src = readFileSync(new URL('./Shell.tsx', import.meta.url), 'utf8');
  assert.match(src, /const worldName=newWorldName\?\?worldTitle\(cfg\.worldName,worldKey\)/);
  assert.doesNotMatch(src, /worldKey\[0\]\.toUpperCase\(\)\+worldKey\.slice\(1\)/, 'no slug-derived title left in the shell');
});
