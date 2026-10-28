// Lane soul-eyes-on: Eyes settings reach each world only from the launcher's own environment (the child env is an allowlist).
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultCommand, forkCommand, EYES_ENV } from './children.mjs';
import { eyesAgent } from './launcher.mjs';
import { decorateCommand } from './production.mjs';
import { isEyesAgent } from '../../apps/server/src/edge/eyes/browser-config.mjs';

const world = (slug) => ({ slug, name: slug, dataDir: `/tmp/x/worlds/${slug}` });
const options = { publicOrigin: 'http://127.0.0.1:6000' };
function withEyesEnv(values, run) {
  const keys = [...EYES_ENV, 'EDGE_EYES_WORLDS'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    for (const k of keys) delete process.env[k];
    Object.assign(process.env, values);
    return run();
  } finally { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; }
}

test('worlds get the EDGE_EYES* settings and the browser path from the launcher env, and none without them', () => {
  withEyesEnv({}, () => {
    const off = defaultCommand(world('eyes-a'), 6001, options).env;
    for (const k of EYES_ENV) assert.equal(off[k], undefined, k);
    Object.assign(process.env, { EDGE_EYES: 'world', EDGE_EYES_GPU: 'swiftshader', EDGE_EYES_NICE: '10', PLAYWRIGHT_BROWSERS_PATH: '/srv/sim-eyes/ms-playwright', SIM_RENDER_LOCK_DIR: '/srv/sim-render-locks', GOD_LOOK_CHROME: '/srv/sim-eyes/chromium/chrome', EDEN_GOD_GL: 'swiftshader' });
    const on = defaultCommand(world('eyes-a'), 6001, options).env;
    assert.equal(on.EDGE_EYES, 'world'); assert.equal(on.EDGE_EYES_GPU, 'swiftshader'); assert.equal(on.EDGE_EYES_NICE, '10');
    assert.equal(on.SIM_RENDER_LOCK_DIR, '/srv/sim-render-locks'); assert.equal(on.GOD_LOOK_CHROME, '/srv/sim-eyes/chromium/chrome'); assert.equal(on.EDEN_GOD_GL, 'swiftshader');
    assert.equal(on.PLAYWRIGHT_BROWSERS_PATH, '/srv/sim-eyes/ms-playwright'); assert.equal(on.EDGE_EYES_SOUL_SECONDS, undefined);
  });
});

test('an unset world allowlist preserves every legacy Eyes env byte, including URL/world/off', () => {
  for (const setting of ['https://sim.eden.art/worlds/w/eden-2026/', 'world', 'off', '', '0']) {
    const values = Object.fromEntries(EYES_ENV.map((k) => [k, k === 'EDGE_EYES' ? setting : `fixture ${k} bytes `]));
    withEyesEnv(values, () => {
      const env = defaultCommand(world('scratch-a'), 6001, options).env;
      assert.deepEqual(Object.fromEntries(EYES_ENV.map((k) => [k, env[k]])), values);
      assert.equal(Object.hasOwn(env, 'EDGE_EYES_WORLDS'), false);
    });
  }
});

test('world allowlist trims and dedupes exact Eden and approved scratch slugs; near matches stay off', () => {
  withEyesEnv({ EDGE_EYES: 'world', EDGE_EYES_WORLDS: ' eden-2026, approved-scratch-a,eden-2026 ' }, () => {
    for (const slug of ['eden-2026', 'approved-scratch-a']) assert.equal(defaultCommand(world(slug), 6001, options).env.EDGE_EYES, 'world', slug);
    for (const slug of ['eden', 'eden-2026-2', 'my-eden-2026', 'approved-scratch', 'approved-scratch-ab', 'other']) {
      const env = defaultCommand(world(slug), 6001, options).env;
      assert.equal(env.EDGE_EYES, 'off', slug);
      assert.equal(Object.hasOwn(env, 'EDGE_EYES'), true, 'explicit off blocks auth env fallback');
      assert.equal(Object.hasOwn(env, 'EDGE_EYES_WORLDS'), false);
    }
  });
});

test('a present empty world list disables all worlds, including an inherited explicit URL', () => {
  for (const list of ['', '  \t ']) for (const setting of [undefined, 'world', 'off', 'https://sim.eden.art/worlds/w/eden-2026/']) {
    withEyesEnv({ EDGE_EYES_WORLDS: list, ...(setting === undefined ? {} : { EDGE_EYES: setting }) }, () => {
      assert.equal(defaultCommand(world('eden-2026'), 6001, options).env.EDGE_EYES, 'off');
    });
  }
});

test('a nonempty list cannot enable Eyes without explicit world opt-in, and explicit off dominates', () => {
  for (const setting of [undefined, '', 'off']) {
    withEyesEnv({ EDGE_EYES_WORLDS: 'eden-2026,scratch-a', ...(setting === undefined ? {} : { EDGE_EYES: setting }) }, () => {
      for (const slug of ['eden-2026', 'scratch-a', 'other']) assert.equal(defaultCommand(world(slug), 6001, options).env.EDGE_EYES, 'off');
    });
  }
});

test('world allowlist rejects malformed, glob, URL and empty comma tokens', () => {
  for (const list of ['*', 'eden-*', 'https://sim.eden.art/worlds/w/eden-2026/', '/w/eden-2026', 'Eden-2026', 'eden_2026', '1eden', 'a'.repeat(33), 'eden-2026,', ',eden-2026', 'eden-2026,,scratch-a', 'eden-2026,   ,scratch-a', 'eden-2026 scratch-a']) {
    for (const setting of ['world', 'off']) withEyesEnv({ EDGE_EYES: setting, EDGE_EYES_WORLDS: list }, () => {
      assert.throws(() => defaultCommand(world('eden-2026'), 6001, options), /EDGE_EYES_WORLDS must be comma-separated exact world slugs/, list);
    });
  }
});

test('a nonempty list with an explicit viewer URL or other setting is ambiguous for every child', () => {
  for (const setting of ['https://sim.eden.art/worlds/w/eden-2026/', 'http://127.0.0.1:6000/w/eden-2026/', '0', ' world ']) {
    withEyesEnv({ EDGE_EYES: setting, EDGE_EYES_WORLDS: 'eden-2026,scratch-a' }, () => {
      for (const slug of ['eden-2026', 'other']) assert.throws(() => defaultCommand(world(slug), 6001, options), /explicit viewer URLs are ambiguous/);
    });
  }
});

test('scoping preserves GPU, rate, nice and browser settings and production /worlds path decoration', () => {
  const values = { EDGE_EYES: 'world', EDGE_EYES_GPU: 'swiftshader', EDGE_EYES_SOUL_SECONDS: '45', EDGE_EYES_GLOBAL_PER_MINUTE: '4', EDGE_EYES_TIMEOUT_SECONDS: '60', EDGE_EYES_RELOAD_HOURS: '12', EDGE_EYES_NICE: '15', EDGE_EYES_CPUS: '0-1', EDGE_EYES_CHROME_ARGS: '--disable-dev-shm-usage', PLAYWRIGHT_BROWSERS_PATH: '/srv/eyes/browsers', SIM_RENDER_LOCK_DIR: '/srv/render-locks', GOD_LOOK_CHROME: '/srv/eyes/chrome', EDEN_GOD_GL: 'swiftshader' };
  withEyesEnv({ ...values, EDGE_EYES_WORLDS: 'eden-2026,scratch-a' }, () => {
    for (const slug of ['eden-2026', 'scratch-a', 'other']) {
      const command = defaultCommand(world(slug), 6001, { ...options, auth: { envFile: '/tmp/fake-auth.env', registryPath: '/tmp/accounts' } });
      const decorated = decorateCommand(command, { publicOrigin: 'https://sim.eden.art', base: '/worlds', devAuth: false });
      assert.equal(decorated.env.WORLD_PATH, `/worlds/w/${slug}`);
      assert.equal(decorated.env.PUBLIC_URL, 'https://sim.eden.art');
      assert.deepEqual(decorated.args, ['--env-file=/tmp/fake-auth.env', 'apps/server/src/main.ts']);
      assert.equal(decorated.env.EDGE_EYES, slug === 'other' ? 'off' : 'world');
      for (const k of EYES_ENV.filter((k) => k !== 'EDGE_EYES')) assert.equal(decorated.env[k], values[k], k);
      assert.equal(Object.hasOwn(decorated.env, 'EDGE_EYES_WORLDS'), false);
    }
  });
});

test('world records cannot set the launcher allowlist, and old-world fork commands remain unchanged', () => {
  const record = { ...world('eden-2026'), EDGE_EYES_WORLDS: 'eden-2026', fork: { descriptor: '/tmp/fork.json', accounts: '/tmp/fork-accounts' } };
  const auth = { ...options, auth: { envFile: '/tmp/fake-auth.env' } };
  const before = withEyesEnv({}, () => forkCommand(record, 6001, auth));
  withEyesEnv({ EDGE_EYES: 'world', EDGE_EYES_WORLDS: 'scratch-a' }, () => {
    assert.equal(defaultCommand(record, 6001, options).env.EDGE_EYES, 'off');
    assert.deepEqual(forkCommand(record, 6001, auth), before);
  });
});

test('the launcher and the world agree on what the Eyes user agent is', () => {
  for (const ua of ['Mozilla/5.0 HeadlessChrome EdenEyes/1', 'Mozilla/5.0', '', undefined]) assert.equal(eyesAgent(ua), isEyesAgent(ua), String(ua));
});
