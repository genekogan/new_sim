import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const base = process.env.SIM_BASE || 'http://localhost:8797';
const hash = (s) => createHash('sha256').update(s).digest('hex'),
  key = randomBytes(32).toString('hex'),
  view = hash(key),
  room = hash(view),
  headers = { Authorization: `Bearer ${room}.${key}` };
const get = async (h = headers) =>
  fetch(`${base}/api/simulation/state`, { headers: h });
const post = (name, args, id = randomUUID(), h = headers) =>
  fetch(`${base}/api/simulation/command`, {
    method: 'POST',
    headers: { ...h, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, args, id }),
  });
assert.equal((await get({})).status, 401);
assert.equal(
  (await get({ Authorization: `Bearer ${room}.${'0'.repeat(64)}` })).status,
  403,
);
assert.equal(
  (await get({ Authorization: `Bearer ${room}.${view}` })).status,
  200,
);
assert.equal(
  (
    await post('set_fire', { mode: 'on' }, randomUUID(), {
      Authorization: `Bearer ${room}.${view}`,
    })
  ).status,
  403,
);
assert.equal(
  (await post('set_camera', { position: [0, -1, 0], target: [0, 0, 0] }))
    .status,
  400,
);
const id = randomUUID();
await post('set_fire', { mode: 'on' }, id);
const before = await (await get()).json();
assert.equal((await post('set_fire', { mode: 'on' }, id)).status, 200);
assert.equal((await post('set_fire', { mode: 'off' }, id)).status, 400);
const after = await (await get()).json();
assert.equal(after.state.revision, before.state.revision);
assert.equal(after.state.fire, 'on');
const client = new Client({ name: 'mars-verification', version: '1.0.0' });
await client.connect(
  new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers },
  }),
);
const list = await client.listTools();
assert.equal(list.tools.length, 20);
const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args });
  if (r.isError) throw Error(r.content[0].text);
  return JSON.parse(r.content[0].text);
};
let s = await call('get_state', {});
assert.equal(s.catalog.length, 18);
s = await call('set_environment', { hour: 18, cycle: false });
assert.equal(s.state.environment.hour, 18);
s = await call('set_euc_riders', { count: 2, speed: 2.5 });
assert.equal(s.state.euc.count, 2);
s = await call('set_person_activity', {
  person_id: 'context_person-009',
  activity: 'wave',
});
assert.equal(s.state.people['context_person-009'].activity, 'wave');
s = await call('move_person', { person_id: 'context_person-001', x: 1, z: 26 });
assert.ok(s.state.people['context_person-001'].path.length > 1);
s = await call('start_activity', {
  name: 'gathering',
  people: ['context_person-002', 'context_person-003'],
  x: 1,
  z: 26,
});
assert.equal(s.state.activity.people.length, 2);
s = await call('set_camera', { position: [8, 4, 31], target: [1, 1, 26] });
assert.ok(s.state.camera.revision > 0);
s = await call('set_paused', { paused: true });
assert.ok(s.state.pausedAt);
const poses = s.poses;
s = await call('get_state', {});
assert.deepEqual(s.poses, poses);
s = await call('set_paused', { paused: false });
assert.equal(s.state.pausedAt, null);
const otherKey = randomBytes(32).toString('hex'),
  otherRoom = hash(hash(otherKey));
const other = await (
  await get({ Authorization: `Bearer ${otherRoom}.${otherKey}` })
).json();
assert.equal(other.state.revision, 0);
// Failed batches cannot partially move a person. Speed changes cannot teleport riders.
const previous = await call('get_state', {});
const invalid = await client.callTool({
  name: 'start_activity',
  arguments: {
    name: 'talk',
    people: ['context_person-001', 'invalid'],
    x: 1,
    z: 26,
  },
});
assert.equal(invalid.isError, true);
const unchanged = await call('get_state', {});
assert.equal(previous.state.revision, unchanged.state.revision);
assert.deepEqual(previous.state.people, unchanged.state.people);
assert.equal(
  (
    await post('set_fire', { mode: 'off' }, randomUUID(), {
      ...headers,
      Origin: 'https://other.invalid',
    })
  ).status,
  403,
);
await call('set_paused', { paused: true });
const stopped = await call('get_state', {});
const faster = await call('set_euc_riders', { speed: 5 });
assert.deepEqual(
  stopped.eucRiders.map((r) => r.position),
  faster.eucRiders.map((r) => r.position),
);
await call('set_paused', { paused: false });
const caps = await call('get_capabilities', {});
assert.equal(caps.screens.length, 7);
assert.equal(Object.keys(caps.tools).length, 18);
s = await call('set_weather', { preset: 'rainy' });
assert.equal(s.state.weather.rain, 0.8);
s = await call('set_simulation_speed', { rate: 2 });
assert.equal(s.state.clock.rate, 2);
s = await call('set_camera_trajectory', {
  duration: 90,
  loop: true,
  end_height: 30,
});
assert.ok(s.state.camera.route);
s = await call('stop_camera', {});
assert.equal(s.state.camera.route, undefined);
s = await call('set_camera_path', {
  points: [
    { position: [0, 20, 40], target: [0, 2, 8] },
    { position: [30, 20, 40], target: [0, 2, 8] },
  ],
  duration: 20,
});
assert.equal(s.state.camera.route.points.length, 2);
s = await call('set_screens', {
  enabled: true,
  program: 'talk',
  title: 'Mars test',
});
assert.equal(s.state.screens['hall-projector'].title, 'Mars test');
s = await call('command_euc_riders', { action: 'return' });
assert.equal(s.state.riders['euc-1'].action, 'return');
s = await call('move_group', { people: ['context_person-001'], x: -15, z: 28 });
assert.equal(s.state.activity.name, 'gathering');
s = await call('apply_scene', {
  commands: [
    { name: 'set_fire', args: { mode: 'off' } },
    { name: 'set_weather', args: { preset: 'clear' } },
  ],
});
assert.equal(s.state.fire, 'off');
const heartbeat = await (
  await fetch(`${base}/api/simulation/state?revision=${s.state.revision}`, {
    headers,
  })
).json();
assert.equal(heartbeat.unchanged, true);
assert.equal(heartbeat.state, undefined);
s = await call('reset_simulation', {});
assert.equal(s.state.fire, 'auto');
assert.equal(s.state.euc.count, 3);
assert.equal(s.state.camera, null);
// Leave a reviewable daylight scene in this isolated verification room.
await call('set_environment', { hour: 16, cycle: false });
await call('set_fire', { mode: 'on' });
await call('start_activity', {
  name: 'campfire',
  people: ['context_person-001', 'context_person-002', 'context_person-003'],
  x: 0,
  z: 0,
});
await call('set_camera', { position: [11, 5, 33], target: [1, 1, 26] });
await writeFile(
  '.cloudflare/simulation-test-room.json',
  JSON.stringify({ room, key, view, base }),
  { mode: 0o600 },
);
await client.close();
console.log(
  'PASS: MCP handshake + 20 tools; room isolation, read-only access, invalid camera, idempotency, walking, activities, pause and persisted state.',
);

assert.equal(
  (
    await fetch(`${base}/api/simulation/command`, {
      method: 'POST',
      body: 'x'.repeat(40000),
    })
  ).status,
  401,
);
assert.equal(
  (await fetch(`${base}/api/simulation/state`, { method: 'POST', headers }))
    .status,
  405,
);
assert.equal((await post('__proto__', {})).status, 400);
assert.equal(
  (
    await fetch(`${base}/api/simulation/command`, {
      method: 'POST',
      headers,
      body: 'x'.repeat(40000),
    })
  ).status,
  413,
);
console.log(
  'PASS: authenticate before body parsing, method restrictions, prototype keys and body size limits.',
);
