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
const legacy = list.tools.filter((t) => !t.name.startsWith('engine_'));
assert.equal(legacy.length, 20);
const engineToolNames = list.tools.filter((t) => t.name.startsWith('engine_')).map((t) => t.name).sort();
assert.deepEqual(engineToolNames, [
  'engine_attach_camera_track', 'engine_bind_plan', 'engine_execute', 'engine_fork', 'engine_get_take',
  'engine_list_verbs', 'engine_log', 'engine_query_world', 'engine_rehearse',
]);
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
// ---- engine tools (preview): same controller ops as in-process, via real MCP ----
const ecall = async (name, args) => {
  const t0 = performance.now();
  const r = await client.callTool({ name, arguments: args });
  const body = JSON.parse(r.content[0].text);
  body._wallMs = performance.now() - t0;
  return { isError: !!r.isError, body };
};
const verbs = await ecall('engine_list_verbs', {});
assert.equal(verbs.isError, false);
assert.ok(verbs.body.verbs.some((v) => v.verb === 'walk_to' && v.inputSchema.type === 'object'));
assert.ok(verbs.body.verbs.some((v) => v.verb === 'carry'));
let e = await ecall('engine_query_world', {});
assert.ok(e.body.workspaces.some((w) => w.id === 'proving-ground' && w.protected));
e = await ecall('engine_fork', { from: 'proving-ground', name: 'itest' });
assert.equal(e.isError, false, JSON.stringify(e.body));
const minute = {
  schema: 'mars-sequence/1', id: 'minute-walk',
  params: { a: { kind: 'actor' }, b: { kind: 'actor' }, c: { kind: 'actor' } },
  steps: [
    { id: 'a1', verb: 'walk_to', params: { actor: '$a', x: -10, z: -22 } },
    { id: 'a2', verb: 'walk_to', params: { actor: '$a', x: -20, z: -15 }, after: ['a1'] },
    { id: 'a3', verb: 'walk_to', params: { actor: '$a', x: -15, z: 10 }, after: ['a2'] },
    { id: 'b1', verb: 'walk_to', params: { actor: '$b', x: 25, z: 0 } },
    { id: 'b2', verb: 'walk_to', params: { actor: '$b', x: 15, z: -20 }, after: ['b1'] },
    { id: 'b3', verb: 'walk_to', params: { actor: '$b', x: 0, z: -25 }, after: ['b2'] },
    { id: 'b4', verb: 'walk_to', params: { actor: '$b', x: 5, z: -5 }, after: ['b3'] },
    { id: 'c1', verb: 'walk_to', params: { actor: '$c', x: 10, z: 10, level: 1 } },
    { id: 'c2', verb: 'walk_to', params: { actor: '$c', x: 7, z: 12, level: 1 }, after: ['c1'] },
    { id: 'c3', verb: 'walk_to', params: { actor: '$c', x: -5, z: 5, level: 0 }, after: ['c2'] },
    { id: 'c4', verb: 'walk_to', params: { actor: '$c', x: -15, z: 11 }, after: ['c3'] },
  ],
};
const bound = await ecall('engine_bind_plan', { template: minute, bindings: { a: 'n1', b: 's1', c: 'p1' }, workspace: 'itest' });
assert.equal(bound.isError, false, JSON.stringify(bound.body));
const planId = bound.body.plan_id;
const badInput = await client.callTool({ name: 'engine_bind_plan', arguments: { template: minute, bindings: {}, workspace: 'itest', extra: 1 } });
assert.equal(badInput.isError, true, 'MCP validates input with the same zod schema');
const reh = await ecall('engine_rehearse', { plan_id: planId });
assert.equal(reh.isError, false, JSON.stringify(reh.body.report?.diagnostics));
assert.ok(reh.body.report.metrics.duration > 50);
const headBefore = (await ecall('engine_log', { workspace: 'itest' })).body.head;
const prot = await ecall('engine_execute', { plan_id: planId, workspace: 'proving-ground' });
assert.equal(prot.isError, true);
assert.equal(prot.body.code, 'workspace.protected');
const ex = await ecall('engine_execute', { plan_id: planId, workspace: 'itest' });
assert.equal(ex.isError, false, JSON.stringify(ex.body));
assert.equal(ex.body.take_id, reh.body.take.take_id, 'rehearsal and execution produce the same take');
assert.equal(ex.body.checkpoint.parent, headBefore);
const stale = await ecall('engine_execute', { plan_id: planId, workspace: 'itest' });
assert.equal(stale.body.code, 'plan.stale');
const cam = await ecall('engine_attach_camera_track', { take_id: ex.body.take_id, shot: { kind: 'frameGroup', subjects: ['n1', 's1', 'p1'], azimuth: 3.14, elevation: 0.4 } });
assert.equal(cam.body.takeHashUnchanged, true);
// viewer-facing compact take endpoint; read-only (view) capability suffices
const takeRes = await fetch(`${base}/api/simulation/engine/take?id=${ex.body.take_id}&from=10&to=20`, { headers: { Authorization: `Bearer ${room}.${view}` } });
assert.equal(takeRes.status, 200);
const slice = await takeRes.json();
assert.deepEqual(slice.range, { from: 200, to: 400 });
assert.ok(slice.tracks.n1.length > 1);
assert.equal(slice.cameras.length, 1);
assert.equal((await fetch(`${base}/api/simulation/engine/take?id=nope`, { headers })).status, 404);
assert.equal((await fetch(`${base}/api/simulation/engine/take?id=x`, { method: 'POST', headers })).status, 405);
// engine state persisted in the DO: a fresh MCP session sees the executed checkpoint
const log = await ecall('engine_log', { workspace: 'itest' });
assert.equal(log.body.head, ex.body.checkpoint.id);
const ms = (r) => `${Math.round(r.body._wallMs)} ms wall / ${r.body._meta.elapsedMs} ms in-DO`;
console.log(`ENGINE: rehearse 60 s plan ${ms(reh)}; execute ${ms(ex)}; camera ${ms(cam)}; take ${ex.body.take.bytes} B; stored ${JSON.stringify(ex.body._meta.stored)}; totals ${JSON.stringify(ex.body._meta.storage)}; slice ${JSON.stringify(slice).length} B`);
await writeFile(
  '.cloudflare/simulation-test-room.json',
  JSON.stringify({ room, key, view, base }),
  { mode: 0o600 },
);
await client.close();
console.log(
  'PASS: MCP handshake + 20 legacy tools + 9 engine tools (bind/rehearse/execute/take/camera); room isolation, read-only access, invalid camera, idempotency, walking, activities, pause and persisted state.',
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
