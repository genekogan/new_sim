import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
await mkdir('.cloudflare/audit2/unit', { recursive: true });
await build({
  stdin: {
    contents: `export * from './simulation/model';export * from './simulation/shared';export {definitions} from './simulation/commands';`,
    resolveDir: process.cwd(),
  },
  outfile: '.cloudflare/audit2/unit/control.mjs',
  bundle: true,
  format: 'esm',
  platform: 'node',
  external: ['three', 'zod'],
});
const {
  initialState,
  normalizeState,
  command,
  simTime,
  hourAt,
  cameraPose,
  riderPose,
  riderPath,
  riderDocks,
  definitions,
} = await import('../.cloudflare/audit2/unit/control.mjs');
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
test('new rooms hold at 4 PM until time passage is toggled on', () => {
  let state = initialState(1000);
  assert.deepEqual(state.environment, { hour: 16, cycle: false });
  near(hourAt(state, 601000), 16);
  state = command(state, 'set_environment', { cycle: true }, 601000);
  near(hourAt(state, 601000), 16);
  near(hourAt(state, 611000), 16.5);
  state = command(state, 'set_environment', { cycle: false }, 611000);
  near(hourAt(state, 1200000), 16.5);
});
test('speed, pause, resume, and clock migration preserve virtual time without discontinuities', () => {
  let s = initialState(1000);
  s = command(s, 'set_simulation_speed', { rate: 2 }, 2000);
  near(simTime(s, 2000), 2000);
  near(simTime(s, 3000), 4000);
  s = command(s, 'set_paused', { paused: true }, 3000);
  near(simTime(s, 9000), 4000);
  s = command(s, 'set_simulation_speed', { rate: 0.5 }, 9000);
  near(simTime(s, 9999), 4000);
  s = command(s, 'set_paused', { paused: false }, 10000);
  near(simTime(s, 12000), 5000);
  const legacy = initialState(0);
  delete legacy.clock;
  legacy.pausedAt = 3000;
  normalizeState(legacy, 9000);
  near(simTime(legacy, 10000), 3000);
});
test('day duration is independent from movement speed and rebases without jumping', () => {
  let s = initialState(0);
  s = command(
    s,
    'set_environment',
    { hour: 12, cycle: true, day_seconds: 240 },
    0,
  );
  near(hourAt(s, 10000), 13);
  s = command(s, 'set_environment', { day_seconds: 480 }, 10000);
  near(hourAt(s, 10000), 13);
  near(hourAt(s, 30000), 14);
});
test('looping spirals close their position and look direction; pause/stop retain the exact pose', () => {
  let s = command(
    initialState(0),
    'set_camera_trajectory',
    {
      radius: 30,
      end_radius: 12,
      height: 20,
      end_height: 5,
      duration: 120,
      loop: true,
    },
    0,
  );
  const a = cameraPose(s, 0),
    b = cameraPose(s, 120000);
  a.position.forEach((v, i) => near(v, b.position[i]));
  const mid = cameraPose(s, 60000);
  near(mid.position[1], 5);
  s = command(s, 'set_paused', { paused: true }, 43000);
  assert.deepEqual(cameraPose(s, 80000), cameraPose(s, 43000));
  const frozen = cameraPose(s, 80000);
  s = command(s, 'stop_camera', {}, 80000);
  assert.deepEqual(cameraPose(s, 90000).position, frozen.position);
  assert.equal(s.camera.route, undefined);
  assert.throws(
    () =>
      command(
        s,
        'set_camera_path',
        {
          points: [
            { position: [0, 1, 0], target: [1, 1, 0] },
            { position: [2, 1, 0], target: [1, 1, 0] },
          ],
          duration: 10,
        },
        90000,
      ),
    /crosses/,
  );
});
test('EUCs return from any perimeter quadrant, park, dismount, then remount without teleporting', () => {
  for (const now of [0, 100000, 200000, 300000]) {
    let s = initialState(0);
    const before = riderPose(s, now, riderPath, 0);
    s = command(
      s,
      'command_euc_riders',
      { riders: 'all', action: 'return' },
      now,
    );
    assert.deepEqual(riderPose(s, now, riderPath, 0).position, before.position);
    for (let i = 0; i < 3; i++) {
      const pose = riderPose(s, now + 1000000, riderPath, i);
      pose.position.forEach((v, k) => near(v, riderDocks[i][k]));
      assert.equal(pose.dismounted, true);
    }
    const parked = riderPose(s, now + 1000000, riderPath, 0);
    s = command(
      s,
      'command_euc_riders',
      { riders: ['euc-1'], action: 'circle' },
      now + 1000000,
    );
    assert.deepEqual(
      riderPose(s, now + 1000000, riderPath, 0).position,
      parked.position,
    );
    assert.equal(riderPose(s, now + 1000000, riderPath, 0).dismounted, false);
    const p = riderPose(s, now + 1001000, riderPath, 0);
    s = command(s, 'set_euc_riders', { speed: 6 }, now + 1001000);
    riderPose(s, now + 1001000, riderPath, 0).position.forEach((v, k) =>
      near(v, p.position[k]),
    );
  }
});
test('batch commands commit once, validate every child, and preserve caller on failure', () => {
  const base = initialState(0),
    saved = JSON.stringify(base);
  assert.throws(() =>
    command(
      base,
      'apply_scene',
      {
        commands: [
          { name: 'set_fire', args: { mode: 'on' } },
          { name: 'move_person', args: { person_id: 'missing', x: 0, z: 0 } },
        ],
      },
      100,
    ),
  );
  assert.equal(JSON.stringify(base), saved);
  const s = command(
    base,
    'apply_scene',
    {
      commands: [
        { name: 'set_weather', args: { preset: 'rainy' } },
        { name: 'set_screens', args: { enabled: true } },
        { name: 'set_camera_trajectory', args: { duration: 90 } },
      ],
    },
    100,
  );
  assert.equal(s.revision, 1);
  assert.equal(s.camera.revision, 1);
  assert.equal(s.weather.rain, 0.8);
  assert.equal(Object.values(s.screens).filter((x) => x.enabled).length, 7);
  assert.throws(() =>
    command(
      base,
      'apply_scene',
      { commands: [{ name: 'apply_scene', args: { commands: [] } }] },
      100,
    ),
  );
});
test('all controls reject invalid numeric ranges and duplicate entity IDs', () => {
  assert.equal(Object.keys(definitions).length, 18);
  const s = initialState(0);
  for (const [name, args] of [
    ['set_weather', { rain: 2 }],
    ['set_simulation_speed', { rate: 0 }],
    ['set_camera_path', { points: [], duration: 0 }],
    ['set_screens', { screens: ['invalid'] }],
    [
      'move_group',
      { people: ['context_person-001', 'context_person-001'], x: 0, z: 23 },
    ],
    ['command_euc_riders', { riders: ['euc-6'], action: 'return' }],
  ])
    assert.throws(() => command(s, name, args, 0));
});
test('each historical year has isolated state and its own navigation population', async () => {
 const {modelForYear} = await import('../.cloudflare/audit2/unit/control.mjs');
 const models=[2020,2021,2022,2023,2024,2025,2026].map(y=>modelForYear(y));
 assert.deepEqual(models.map(m=>m.entities.length),[7,12,16,22,22,22,18]);
 const states=models.map(m=>m.initialState(1000));
 models[0].command(states[0],'set_weather',{preset:'rainy'},2000);
 assert.equal(states[1].weather.rain,0);
 for(const [i,m] of models.entries()){
  assert.equal(states[i].environment.cycle,false);
  assert.equal(states[i].environment.hour,16);
  assert.ok(m.catalog.bounds.flat().every(Number.isFinite));
  for(const p of Object.values(states[i].people))assert.ok(p.path.flat().every(Number.isFinite));
 }
 assert.equal(states[0].euc.count,2);
 assert.throws(()=>modelForYear(2019));
});
