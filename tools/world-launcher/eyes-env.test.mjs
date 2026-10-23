// Lane soul-eyes-on: Eyes settings reach each world only from the launcher's own environment (the child env is an allowlist).
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultCommand, EYES_ENV } from './children.mjs';
import { eyesAgent } from './launcher.mjs';
import { isEyesAgent } from '../../apps/server/src/edge/eyes/browser-config.mjs';

test('worlds get the EDGE_EYES* settings and the browser path from the launcher env, and none without them', () => {
  const world = { slug: 'eyes-a', name: 'A', dataDir: '/tmp/x/worlds/eyes-a' }, o = { publicOrigin: 'http://127.0.0.1:6000' };
  const saved = Object.fromEntries(EYES_ENV.map((k) => [k, process.env[k]]));
  try {
    for (const k of EYES_ENV) delete process.env[k];
    const off = defaultCommand(world, 6001, o).env;
    for (const k of EYES_ENV) assert.equal(off[k], undefined, k);
    Object.assign(process.env, { EDGE_EYES: 'world', EDGE_EYES_GPU: 'swiftshader', EDGE_EYES_NICE: '10', PLAYWRIGHT_BROWSERS_PATH: '/srv/sim-eyes/ms-playwright' });
    const on = defaultCommand(world, 6001, o).env;
    assert.equal(on.EDGE_EYES, 'world'); assert.equal(on.EDGE_EYES_GPU, 'swiftshader'); assert.equal(on.EDGE_EYES_NICE, '10');
    assert.equal(on.PLAYWRIGHT_BROWSERS_PATH, '/srv/sim-eyes/ms-playwright'); assert.equal(on.EDGE_EYES_SOUL_SECONDS, undefined);
  } finally { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

test('the launcher and the world agree on what the Eyes user agent is', () => {
  for (const ua of ['Mozilla/5.0 HeadlessChrome EdenEyes/1', 'Mozilla/5.0', '', undefined]) assert.equal(eyesAgent(ua), isEyesAgent(ua), String(ua));
});
