import { traceClientTools } from './tool-trace.mjs';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { engineTools } from '../engine/api/index.ts';
import { yearBuildSetup } from '../engine/scenarios/year-build.ts';
import { loadCampusFile } from '../engine/campus/history-node.ts';
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
traceClientTools(client, 'room-2026', { enabled: process.env.SIM_TRACE_TOOLS === '1' });
await client.connect(
  new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers },
  }),
);
const list = await client.listTools();
const legacy = list.tools.filter((t) => !t.name.startsWith('engine_'));
assert.equal(legacy.length, 20);
const engineToolNames = list.tools.filter((t) => t.name.startsWith('engine_')).map((t) => t.name).sort();
// the MCP listing is the controller's op registry, read from it (not a literal list); every one is called below
const ENGINE_TOOLS = engineTools().map((t) => t.name).sort();
assert.deepEqual(engineToolNames, ENGINE_TOOLS);
const calledEngineTools = new Set();
const calledLegacyTools = new Set();
const call = async (name, args) => {
  calledLegacyTools.add(name);
  const r = await client.callTool({ name, arguments: args });
  if (r.isError) throw Error(r.content[0].text);
  return JSON.parse(r.content[0].text);
};
const legacyBad = await client.callTool({ name: 'move_person', arguments: { person_id: 'missing-person', x: 0, z: 0 } });
assert.equal(legacyBad.isError, true);
assert.equal(JSON.parse(legacyBad.content[0].text).code, 'legacy.command-failed');
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
  calledEngineTools.add(name);
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
{
  // input validation failures use the same JSON refusal envelope as every other engine failure
  const env = JSON.parse(badInput.content[0].text);
  assert.equal(env.ok, false);
  assert.equal(env.code, 'op.invalid-input');
  assert.match(env.message, /^bind_plan: input: /);
  assert.ok(env.details.issues.some((i) => i.path === '(root)' && /extra/.test(i.message)), JSON.stringify(env));
}
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
assert.deepEqual(slice.range, { from: 10, to: 20, fromTick: 200, toTick: 400 });
assert.ok(slice.tracks.n1.length > 1);
assert.equal(slice.cameras.length, 1);
assert.equal((await fetch(`${base}/api/simulation/engine/take?id=nope`, { headers })).status, 404);
assert.equal((await fetch(`${base}/api/simulation/engine/take?id=x`, { method: 'POST', headers })).status, 405);
// engine state persisted in the DO: a fresh MCP session sees the executed checkpoint
const log = await ecall('engine_log', { workspace: 'itest' });
assert.equal(log.body.head, ex.body.checkpoint.id);
const ms = (r) => `${Math.round(r.body._wallMs)} ms wall / ${r.body._meta.elapsedMs} ms in-DO`;
console.log(`ENGINE: rehearse 60 s plan ${ms(reh)}; execute ${ms(ex)}; camera ${ms(cam)}; take ${ex.body.take.bytes} B; stored ${JSON.stringify(ex.body._meta.stored)}; totals ${JSON.stringify(ex.body._meta.storage)}; slice ${JSON.stringify(slice).length} B`);
// ---- spec §28 isolation through the real control plane (MCP + REST → Durable Object room) ----
// Mirrors the node:sqlite EngineRoom tests "replay/fork isolation (room)", "plan invalidation (room)".
const viewH = { Authorization: `Bearer ${room}.${view}` };
const T = [];
const ok = (label, r) => {
  assert.equal(r.isError, false, `${label}: ${JSON.stringify(r.body).slice(0, 800)}`);
  T.push(`${label} ${Math.round(r.body._wallMs)}/${r.body._meta?.elapsedMs ?? '-'}`);
  return r.body;
};
const refused = (label, r, code) => {
  assert.equal(r.isError, true, `${label} must be refused`);
  assert.equal(r.body.code, code, `${label}: ${JSON.stringify(r.body).slice(0, 400)}`);
  T.push(`${label} ${Math.round(r.body._wallMs)}/${r.body._meta?.elapsedMs ?? '-'}`);
  return r.body;
};
const walkPlan = (id, x, z) => ({ schema: 'mars-sequence/1', id, params: { a: { kind: 'actor' } }, steps: [{ id: 's', verb: 'walk_to', params: { actor: '$a', x, z } }] });
// The reconstructed campus is protected; fork edits do not mutate it (LM-006).
const campus2026 = ok('2026 canonical regions', await ecall('engine_query_world', { workspace: 'mars-2026', include: ['regions'] }));
assert.ok(campus2026.regions.some((r) => r.id === 'chiba'));
refused('2026 canonical edit', await ecall('engine_edit_world', { workspace: 'mars-2026', note: 'protected', edits: [{ op: 'region', id: 'test-region', kind: 'place', label: 'test', polygon: [[0, 0], [1, 0], [1, 1]] }] }), 'workspace.protected');
// ---- engine_direct_camera (LM-011): a real direction on the room's executed take. p1's 90° orbit passes behind
// stairs A, so the DO's self-correction must act and report it per shot; the take stays bit-identical.
{
  const dirs = [{ subject: { kind: 'entity', ref: 'p1' }, motion: { verb: 'orbit', degrees: 90 }, duration: 12 }];
  const dc = ok('direct camera', await ecall('engine_direct_camera', { take_id: ex.body.take_id, directions: dirs }));
  assert.match(dc.track_id, /^dir-/);
  assert.equal(dc.take_id, ex.body.take_id);
  assert.equal(dc.takeHashUnchanged, true);
  assert.ok(dc.track.samples > 1 && dc.track.keyframes.length >= 1, JSON.stringify(dc.track).slice(0, 300));
  assert.equal(dc.report.shots.length, 1);
  const [shot] = dc.report.shots;
  assert.equal(shot.subject.id, 'p1');
  assert.ok(shot.simulation.valid, 'the corrected shot simulates clean');
  assert.ok(shot.corrections.length >= 1, `p1 behind stairs A is self-corrected: ${JSON.stringify(shot).slice(0, 400)}`);
  for (const c of shot.corrections) assert.ok(c.failure && c.strategy && c.reason && Array.isArray(c.tried), JSON.stringify(c).slice(0, 400));
  const again = ok('direct camera again', await ecall('engine_direct_camera', { take_id: ex.body.take_id, directions: dirs }));
  assert.equal(again.track_id, dc.track_id, 'same directions, same track');
  const stored = ok('take cameras', await ecall('engine_get_take', { take_id: ex.body.take_id, from: 0, to: 1, include: ['cameras'] })).cameras;
  assert.ok(stored.some((t) => t.id === dc.track_id && t.kind === 'directed'), JSON.stringify(stored.map((t) => [t.id, t.kind])));
  refused('direct camera: unknown subject', await ecall('engine_direct_camera', { take_id: ex.body.take_id, directions: [{ subject: { kind: 'entity', ref: 'nobody-here' }, motion: { verb: 'hold' } }] }), 'camera.direct.unknown');
  // W58 ops: a directed track stored beside the take under a new id (LM-013), and the sentence parser as its own op (LM-007).
  const srcTrack = stored.find((t) => t.id === dc.track_id);
  const st1 = ok('store camera track', await ecall('engine_store_camera_track', { take_id: ex.body.take_id, track: { ...srcTrack, id: 'dir-integration-1', kind: 'directed' } }));
  assert.equal(st1.stored, true); assert.equal(st1.takeHashUnchanged, true);
  const st2 = ok('store the identical track again (idempotent)', await ecall('engine_store_camera_track', { take_id: ex.body.take_id, track: { ...srcTrack, id: 'dir-integration-1', kind: 'directed' } }));
  assert.equal(st2.stored, false, 'an identical track is not stored twice');
  refused('store a track of another take', await ecall('engine_store_camera_track', { take_id: ex.body.take_id, track: { ...srcTrack, id: 'dir-integration-2', kind: 'directed', takeId: 'not-this-take' } }), 'camera.track-take-mismatch');
  // parse_camera refuses the whole call when any sentence has no referent (nothing is compiled) — a structured refusal
  // with the parser's question; the compile path for good sentences is the direct_camera call above.
  const pc = refused('parse camera: deictic sentence', await ecall('engine_parse_camera', { take_id: ex.body.take_id, sentences: ['look at this crowd of people having this activity'] }), 'camera.parse.deictic');
  assert.match(pc.message, /refused/);
  const sentences = ['hold on the fire for 2 seconds'];
  const parsed = ok('parse camera sentence', await ecall('engine_parse_camera', { take_id: ex.body.take_id, sentences }));
  const typed = ok('direct parsed sentence', await ecall('engine_direct_camera', { take_id: ex.body.take_id, directions: parsed.directions.map((d) => d.direction) }));
  const sentenceTrack = ok('direct camera sentence', await ecall('engine_direct_camera', { take_id: ex.body.take_id, sentences }));
  assert.equal(sentenceTrack.track_id, typed.track_id);
  assert.equal(sentenceTrack.takeHashUnchanged, true);
  const c0 = shot.corrections[0];
  console.log(`ENGINE DIRECT CAMERA: track ${dc.track_id} ${dc.track.samples} samples; p1 orbit corrected: ${c0.failure} → ${c0.strategy} (${c0.reason.slice(0, 100)}…)`);
}
/** Every workspace head, log length and entity pose in the room (through the tools). */
async function snapshot(c = ecall) {
  const ws = (await c('engine_query_world', {})).body.workspaces;
  const out = { heads: {}, logs: {}, poses: {} };
  for (const w of ws) {
    out.heads[w.id] = w.head;
    out.logs[w.id] = (await c('engine_log', { workspace: w.id })).body.checkpoints.length;
    out.poses[w.id] = (await c('engine_query_world', { workspace: w.id })).body.entities.map((e) => [e.id, e.pose, e.human?.activity ?? e.phase ?? null]);
  }
  return out;
}
const vtake = async (qs, h = viewH, method = 'GET') => {
  const t0 = performance.now();
  const r = await fetch(`${base}/api/simulation/engine/take?${qs}`, { method, headers: h });
  return { status: r.status, body: r.status === 200 || r.status === 404 ? await r.json() : null, wall: performance.now() - t0 };
};
// 1. Replay isolation
ok('fork', await ecall('engine_fork', { from: 'proving-ground', name: 'replay' }));
// a renamed template is a distinct plan (and take): not the itest take, which already has a camera track
const rb = ok('bind', await ecall('engine_bind_plan', { template: { ...minute, id: 'replay-walk' }, bindings: { a: 'n1', b: 's1', c: 'p1' }, workspace: 'replay' }));
assert.notEqual(rb.plan_id, planId);
ok('rehearse(keep)', await ecall('engine_rehearse', { plan_id: rb.plan_id, keep: true }));
const rex = ok('execute', await ecall('engine_execute', { plan_id: rb.plan_id, workspace: 'replay' }));
const snap = await snapshot();
assert.equal(snap.heads.replay, rex.checkpoint.id);
assert.notEqual(rex.take_id, ex.body.take_id);
assert.equal((await vtake(`id=${rex.take_id}&include=cameras`)).body.cameras.length, 0);
const storage0 = (await ecall('engine_log', { workspace: 'replay' })).body._meta.storage;
const fetchMs = [];
for (const [from, to] of [[0, 1], [5, 5.05], [12.34, 20], [30, 31], [55, undefined], [0, undefined]]) {
  const r = await vtake(`id=${rex.take_id}&from=${from}${to === undefined ? '' : `&to=${to}`}&include=final,cameras,events,changes`);
  assert.equal(r.status, 200);
  assert.equal(r.body.finalStateHash, rex.take.finalStateHash);
  assert.deepEqual(r.body._meta.stored, {}, 'a view take fetch stores nothing');
  fetchMs.push(`${Math.round(r.wall)}/${r.body._meta.elapsedMs}`);
}
T.push(`view take fetch ×6 ${fetchMs.join(',')}`);
assert.deepEqual((await ecall('engine_log', { workspace: 'replay' })).body._meta.storage, storage0, 'stored bytes unchanged by viewing');
assert.deepEqual(await snapshot(), snap, 'heads, log lengths and every pose unchanged after view fetches');
// view capability: no MCP (so no execute/fork/attach), no commands, no POST on the take endpoint
const rpc = (method, params) => fetch(`${base}/mcp`, { method: 'POST', headers: { ...viewH, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
assert.equal((await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'view', version: '1' } })).status, 403);
for (const [name, args] of [['engine_execute', { plan_id: rb.plan_id, workspace: 'replay' }], ['engine_fork', { from: 'replay', name: 'v' }], ['engine_attach_camera_track', { take_id: rex.take_id, shot: { kind: 'fixed', position: [0, 10, 30], target: [0, 0, 0] } }]]) {
  const r = await rpc('tools/call', { name, arguments: args });
  assert.equal(r.status, 403);
  assert.match((await r.json()).error, /control capability/);
  assert.equal((await post(name, args, randomUUID(), viewH)).status, 403);
}
await assert.rejects(new Client({ name: 'view', version: '1' }).connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: viewH } })));
assert.equal((await vtake(`id=${rex.take_id}`, viewH, 'POST')).status, 405);
assert.deepEqual(await snapshot(), snap, 'refused view calls changed nothing');
// the control-side camera track is stored beside the take: heads, logs, poses unchanged
const rcam = ok('attach camera', await ecall('engine_attach_camera_track', { take_id: rex.take_id, shot: { kind: 'frameGroup', subjects: ['n1', 's1', 'p1'], azimuth: 3.14, elevation: 0.4 } }));
assert.equal(rcam.takeHashUnchanged, true);
assert.deepEqual(Object.keys(rcam._meta.stored), [`y2026/cams/${rex.take_id}`]);
assert.deepEqual(await snapshot(), snap, 'unchanged after attaching a camera track');
assert.equal((await vtake(`id=${rex.take_id}&from=3&to=4&include=cameras`)).body.cameras.length, 1);
// two independent rooms (different capabilities) never see each other's plans or takes
const key2 = randomBytes(32).toString('hex'), view2 = hash(key2), room2 = hash(view2);
const client2 = new Client({ name: 'mars-verification-2', version: '1.0.0' });
traceClientTools(client2, 'independent-room-2026', { enabled: process.env.SIM_TRACE_TOOLS === '1' });
await client2.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${room2}.${key2}` } } }));
const ecall2 = async (name, args) => {
  calledEngineTools.add(name);
  const t0 = performance.now();
  const r = await client2.callTool({ name, arguments: args });
  const body = JSON.parse(r.content[0].text);
  body._wallMs = performance.now() - t0;
  return { isError: !!r.isError, body };
};
assert.deepEqual(ok('room2 query', await ecall2('engine_query_world', {})).workspaces.map((w) => w.id).sort(), ['carry-yard', 'mars-2026', 'proving-ground']);
refused('room2 get R take', await ecall2('engine_get_take', { take_id: rex.take_id }), 'take.unknown');
refused('room2 rehearse R plan', await ecall2('engine_rehearse', { plan_id: rb.plan_id }), 'plan.unknown');
refused('room2 execute R plan', await ecall2('engine_execute', { plan_id: rb.plan_id, workspace: 'replay' }), 'plan.unknown');
assert.equal((await vtake(`id=${rex.take_id}`, { Authorization: `Bearer ${room2}.${view2}` })).status, 404);
assert.equal((await vtake(`id=${rex.take_id}`, { Authorization: `Bearer ${room}.${view2}` })).status, 403, 'a capability for another room is invalid here');
ok('room2 fork', await ecall2('engine_fork', { from: 'proving-ground', name: 'other' }));
const b2 = ok('room2 bind', await ecall2('engine_bind_plan', { template: walkPlan('other-walk', -8, -22), bindings: { a: 'n1' }, workspace: 'other' }));
const ex2 = ok('room2 execute', await ecall2('engine_execute', { plan_id: b2.plan_id, workspace: 'other' }));
assert.equal((await vtake(`id=${ex2.take_id}`)).status, 404, "room 2's take is invisible to room 1's view capability");
refused('R get room2 take', await ecall('engine_get_take', { take_id: ex2.take_id }), 'take.unknown');
refused('R rehearse room2 plan', await ecall('engine_rehearse', { plan_id: b2.plan_id }), 'plan.unknown');
assert.deepEqual(await snapshot(), snap, "room 1 untouched by room 2's work");
await client2.close();
// 2. Fork isolation
const canon0 = await snapshot();
ok('fork w1', await ecall('engine_fork', { from: 'proving-ground', name: 'iso-w1' }));
const fb = ok('bind w1', await ecall('engine_bind_plan', { template: walkPlan('p1-walk', -5, 5), bindings: { a: 'p1' }, workspace: 'iso-w1' }));
assert.match(refused('execute canonical', await ecall('engine_execute', { plan_id: fb.plan_id, workspace: 'proving-ground' }), 'workspace.protected').message, /fork/);
const fex = ok('execute w1', await ecall('engine_execute', { plan_id: fb.plan_id, workspace: 'iso-w1' }));
ok('fork w2', await ecall('engine_fork', { from: 'proving-ground', name: 'iso-w2' }));
const fs = await snapshot();
assert.equal(fs.heads['proving-ground'], canon0.heads['proving-ground'], 'canonical head unchanged');
assert.equal(fs.logs['proving-ground'], canon0.logs['proving-ground']);
assert.deepEqual(fs.poses['proving-ground'], canon0.poses['proving-ground']);
assert.equal(fs.heads['iso-w2'], canon0.heads['proving-ground'], 'w2 forks the canonical head');
assert.deepEqual(fs.poses['iso-w2'], canon0.poses['proving-ground'], "w2's world lacks w1's walk");
const p1At = (ws) => fs.poses[ws].find((e) => e[0] === 'p1')[1].p;
assert.notDeepEqual(p1At('iso-w1'), p1At('iso-w2'));
for (const ws of ['replay', 'itest']) assert.equal(fs.heads[ws], canon0.heads[ws], `sibling ${ws} untouched`);
const flog = ok('log w1', await ecall('engine_log', { workspace: 'iso-w1' }));
assert.deepEqual(flog.checkpoints[0].cause, { kind: 'simulation-run', take: fex.take_id, plan: fb.plan_id });
// 3. Plan invalidation after a second executed plan moves an actor into the route
const pc = ok('bind cam-plan', await ecall('engine_bind_plan', { template: walkPlan('p1-back', 0, -5), bindings: { a: 'p1' }, workspace: 'iso-w1' }));
const prc = ok('rehearse cam-plan', await ecall('engine_rehearse', { plan_id: pc.plan_id }));
for (const shot of [{ kind: 'follow', subject: 'p1', offset: [-6, 2.5, 0], frame: 'world' }, { kind: 'fixed', position: [0, 10, 30], target: [0, 0, 0] }])
  ok('attach camera (rehearsal take)', await ecall('engine_attach_camera_track', { take_id: prc.take.take_id, shot }));
assert.equal(ok('rehearse after cameras', await ecall('engine_rehearse', { plan_id: pc.plan_id })).stale, undefined, 'camera tracks never stale a plan');
assert.equal(ok('execute cam-plan', await ecall('engine_execute', { plan_id: pc.plan_id, workspace: 'iso-w1' })).take_id, prc.take.take_id);
const pa = ok('bind A', await ecall('engine_bind_plan', { template: walkPlan('n1-north', 15, -12), bindings: { a: 'n1' }, workspace: 'iso-w1' }));
ok('rehearse A', await ecall('engine_rehearse', { plan_id: pa.plan_id }));
const pbb = ok('bind B', await ecall('engine_bind_plan', { template: walkPlan('s1-into-passage', 15, -15), bindings: { a: 's1' }, workspace: 'iso-w1' }));
ok('execute B', await ecall('engine_execute', { plan_id: pbb.plan_id, workspace: 'iso-w1' }));
const headB = (await ecall('engine_log', { workspace: 'iso-w1' })).body.head;
const st = refused('execute A (stale)', await ecall('engine_execute', { plan_id: pa.plan_id, workspace: 'iso-w1' }), 'plan.stale');
assert.deepEqual(st.diff.changed, [{ id: 's1', fields: ['pose'] }]);
assert.match(st.message, /s1 changed \(pose\)/);
assert.equal((await ecall('engine_log', { workspace: 'iso-w1' })).body.head, headB, 'a stale plan never commits');
// ---- design edits, ledger, workspace deletion (engine_edit_world / engine_list / engine_delete_workspace) ----
{
  refused('edit canonical', await ecall('engine_edit_world', { workspace: 'carry-yard', note: 'x', edits: [{ op: 'remove', id: 'b1' }] }), 'workspace.protected');
  ok('fork finite', await ecall('engine_fork', { from: 'carry-yard', name: 'ed-fin' }));
  refused('spawn (finite inventory)', await ecall('engine_edit_world', { workspace: 'ed-fin', note: 'x', edits: [{ op: 'spawn', id: 'u1', def: 'upright-19ft', lying: { x: 4, z: 22, yaw: 0 } }] }), 'edit.inventory-finite');
  const fk = ok('fork unlimited', await ecall('engine_fork', { from: 'carry-yard', name: 'ed', inventory: 'unlimited' }));
  assert.equal(fk.inventory, 'unlimited');
  const head0 = (await ecall('engine_log', { workspace: 'ed' })).body.head;
  const early = ok('bind before edit', await ecall('engine_bind_plan', { template: walkPlan('ed-walk', 3, 3), bindings: { a: 'p1' }, workspace: 'ed' }));
  const wall = refused('spawn into a wall', await ecall('engine_edit_world', { workspace: 'ed', note: 'x', edits: [{ op: 'spawn', id: 'u1', def: 'upright-19ft', lying: { x: 4, z: 20, yaw: Math.PI / 2 } }] }), 'edit.blocked');
  assert.match(wall.message, /yard B south wall/);
  refused('spawn onto a person (atomic)', await ecall('engine_edit_world', { workspace: 'ed', note: 'x', edits: [{ op: 'spawn', id: 'q1', def: 'human', pose: { p: [1.5, 0, 19.5], yaw: 0 } }, { op: 'spawn', id: 'q2', def: 'human', pose: { p: [1.6, 0, 19.5], yaw: 0 } }] }), 'edit.blocked');
  refused('remove a scene person', await ecall('engine_edit_world', { workspace: 'ed', note: 'x', edits: [{ op: 'remove', id: 'p1' }] }), 'edit.immovable');
  const bad = await ecall('engine_edit_world', { workspace: 'ed', note: 'x', edits: [{ op: 'teleport', id: 'p1' }] });
  refused('malformed edit (zod)', bad, 'op.invalid-input');
  assert.ok(bad.body.details.issues.length > 0);
  assert.equal((await ecall('engine_log', { workspace: 'ed' })).body.head, head0, 'refused edits commit nothing');
  const crew = [[1.5, 19.5], [6.5, 19.5], [1.5, 24.5], [6.5, 24.5]];
  const ed = ok('edit: 19 ft upright + crew of 4 in yard B', await ecall('engine_edit_world', {
    workspace: 'ed', note: '19 ft upright in yard B with a crew of four',
    edits: [{ op: 'spawn', id: 'u1', def: 'upright-19ft', lying: { x: 4, z: 22, yaw: 0 } }, ...crew.map(([x, z], i) => ({ op: 'spawn', id: `q${i + 1}`, def: 'human', pose: { p: [x, 0, z], yaw: 0 } })), { op: 'region', id: 'yb-staging', kind: 'staging', polygon: [[0, 18], [8, 18], [8, 26], [0, 26]] }],
  }));
  assert.deepEqual(ed.checkpoint.cause, { kind: 'design-edit', note: '19 ft upright in yard B with a crew of four' });
  assert.deepEqual(ed.diff.added, ['q1', 'q2', 'q3', 'q4', 'u1']);
  assert.deepEqual(ed.diff.regions, ['yb-staging']);
  const u1 = (await ecall('engine_query_world', { workspace: 'ed', ids: ['u1'] })).body.entities[0];
  assert.equal(u1.provenance.origin, 'design-edit');
  // Staleness is region-scoped (W58, LM-003/004): the yard-B edit is outside the early walk's envelope, so that plan stays valid
  // (the near-edit / stale case is covered by engine/test/api.test.ts "staleness (LM-004)").
  const still = await ecall('engine_rehearse', { plan_id: early.plan_id, workspace: 'ed' });
  assert.notEqual(still.body?.code, 'plan.stale', 'a far edit must not stale the early walk (region-scoped staleness)');
  ok('rehearse plan bound before a far edit (region-scoped staleness)', still);
  const up = ok('bind upright carry', await ecall('engine_bind_plan', { template: { schema: 'mars-sequence/1', id: 'upright-delivery', params: { crew: { kind: 'actors' }, item: { kind: 'entity' } }, steps: [{ id: 'deliver', verb: 'carry', params: { crew: '$crew', item: '$item', to: { x: 18, z: 36, yaw: Math.PI / 2 } } }] }, bindings: { crew: ['q1', 'q2', 'q3', 'q4'], item: 'u1' }, workspace: 'ed' }));
  const cl = refused('rehearse 19 ft upright through the 1.5 m corridor', await ecall('engine_rehearse', { plan_id: up.plan_id }), 'rehearsal.failed');
  assert.equal(cl.report.steps[0].diagnostic.code, 'carry.clearance');
  assert.match(cl.message, /carry\.clearance/);
  const mv = ok('edit: move + remove', await ecall('engine_edit_world', { workspace: 'ed', note: 'tidy', edits: [{ op: 'move', id: 'b1', lying: { x: 4, z: 5, yaw: 0 } }, { op: 'remove', id: 'q4' }] }));
  assert.deepEqual([mv.diff.changed.map((c) => c.id), mv.diff.removed], [['b1'], ['q4']]);
  // ledger
  const led = ok('list', await ecall('engine_list', {}));
  assert.ok(led.plans.some((p) => p.plan_id === up.plan_id && p.template === 'upright-delivery' && p.referencedByCheckpoint.length === 0));
  const executed = led.takes.find((t) => t.take_id === ex.body.take_id);
  assert.ok(executed && executed.kept && executed.bytes > 1000 && executed.cameras && executed.referencedByCheckpoint.length === 1, JSON.stringify(executed));
  assert.deepEqual(led.takes.map((t) => t.order), led.takes.map((_, i) => i));
  assert.deepEqual(led.workspaces.find((w) => w.id === 'carry-yard').forks.sort(), ['ed', 'ed-fin']);
  const lc = ok('list cameras', await ecall('engine_list', { include: ['takes'], take_id: ex.body.take_id }));
  assert.equal(lc.cameras.length, 4, 'the attached frameGroup track + orbit + stored copy + sentence track');
  refused('list unknown take', await ecall('engine_list', { take_id: 'nope' }), 'take.unknown');
  // deletion
  refused('delete canonical', await ecall('engine_delete_workspace', { workspace: 'carry-yard' }), 'workspace.protected');
  ok('fork child', await ecall('engine_fork', { from: 'ed', name: 'ed-child' }));
  const hf = refused('delete fork parent', await ecall('engine_delete_workspace', { workspace: 'ed' }), 'workspace.has-forks');
  assert.deepEqual(hf.details.forks, ['ed-child']);
  for (const w of ['ed-child', 'ed', 'ed-fin']) ok(`delete ${w}`, await ecall('engine_delete_workspace', { workspace: w }));
  refused('delete twice', await ecall('engine_delete_workspace', { workspace: 'ed' }), 'unknown-workspace');
  assert.ok(!(await ecall('engine_query_world', {})).body.workspaces.some((w) => w.id.startsWith('ed')));
  // get_take: seconds in, seconds out
  const gt = ok('get_take seconds', await ecall('engine_get_take', { take_id: ex.body.take_id, from: 10, to: 20, entities: ['n1'] }));
  assert.deepEqual(gt.range, { from: 10, to: 20, fromTick: 200, toTick: 400 });
}
// ---- mid-action pause / resume (engine_execute pauseAt, engine_resume, engine_fork at a pause) ----
// Mirrors the node:sqlite EngineRoom tests "pause/resume (room)" in engine/test/api.test.ts.
{
  const P = [];
  const pt = (label, body) => (P.push(`${label} ${Math.round(body._wallMs)}/${body._meta?.elapsedMs ?? '-'}`), body);
  const cross = {
    schema: 'mars-sequence/1', id: 'cross-and-climb', params: { crew: { kind: 'actors' }, deck: { kind: 'point' } },
    steps: [
      { id: 'north', verb: 'walk_to', params: { actor: '$crew[0]', x: 15, z: -10.5 } },
      { id: 'south', verb: 'walk_to', params: { actor: '$crew[1]', x: 15, z: -19.5 } },
      { id: 'climb', verb: 'walk_to', params: { actor: '$crew[2]', x: '$deck[0]', z: '$deck[1]', level: 1 }, after: ['north', 'south'] },
    ],
  };
  for (const w of ['pz-full', 'pz']) ok(`fork ${w}`, await ecall('engine_fork', { from: 'proving-ground', name: w }));
  const pb = ok('bind cross', await ecall('engine_bind_plan', { template: cross, bindings: { crew: ['n1', 's1', 'p1'], deck: [10, 10] }, workspace: 'pz-full' }));
  const full = pt('execute unpaused', ok('execute unpaused', await ecall('engine_execute', { plan_id: pb.plan_id, workspace: 'pz-full' })));
  const pp = pt('execute pauseAt 5 s', ok('execute pauseAt', await ecall('engine_execute', { plan_id: pb.plan_id, workspace: 'pz', pauseAt: 5 })));
  assert.equal(pp.paused, true);
  assert.equal(pp.checkpoint.resumable, true);
  assert.deepEqual(pp.live.map((a) => a.id), ['step:north', 'step:south']);
  const blobKey = Object.keys(pp._meta.stored).find((k) => k.includes('/state/resume.'));
  assert.ok(blobKey, `pause snapshot stored as a state blob: ${JSON.stringify(pp._meta.stored)}`);
  refused('edit a paused workspace', await ecall('engine_edit_world', { workspace: 'pz', note: 'x', edits: [{ op: 'move', id: 'panel', lying: { x: 0, z: 0, yaw: 0 } }] }), 'workspace.paused');
  const pr = pt('resume', ok('resume', await ecall('engine_resume', { workspace: 'pz' })));
  assert.equal(pr.report.finalStateHash, full.report.finalStateHash, 'resume without commands = unpaused final state');
  assert.equal(pr.checkpoint.stateHash, full.checkpoint.stateHash);
  refused('resume a resting head', await ecall('engine_resume', { workspace: 'pz' }), 'resume.not-resumable');
  // fork at a pause; resume both branches with different commands
  ok('fork pf', await ecall('engine_fork', { from: 'proving-ground', name: 'pf' }));
  const fb = ok('bind n1-far', await ecall('engine_bind_plan', { template: walkPlan('n1-far', -8, -22), bindings: { a: 'n1' }, workspace: 'pf' }));
  const fp = ok('pause n1-far at 3 s', await ecall('engine_execute', { plan_id: fb.plan_id, workspace: 'pf', pauseAt: 3 }));
  assert.equal(pt('fork at pause', ok('fork at pause', await ecall('engine_fork', { from: 'pf', name: 'pf-alt' }))).workspace.head, fp.checkpoint.id);
  const ra = pt('resume + command', ok('resume pf', await ecall('engine_resume', { workspace: 'pf', commands: [{ verb: 'walk_to', params: { actor: 's1', x: -5, z: 5 } }] })));
  const rb = ok('resume pf-alt', await ecall('engine_resume', { workspace: 'pf-alt', commands: [{ verb: 'walk_to', params: { actor: 's1', x: 0, z: -5 } }] }));
  assert.notEqual(ra.report.finalStateHash, rb.report.finalStateHash, 'different commands → different futures');
  // a carry is not resumable: the refusal names it, nothing is committed
  ok('fork pz-cy', await ecall('engine_fork', { from: 'carry-yard', name: 'pz-cy' }));
  const cb = ok('bind delivery', await ecall('engine_bind_plan', { template: { schema: 'mars-sequence/1', id: 'beam-delivery', params: { crew: { kind: 'actors' }, beam: { kind: 'entity' } }, steps: [{ id: 'deliver', verb: 'carry', params: { crew: '$crew', item: '$beam', to: { x: 18, z: 11, yaw: Math.PI / 2 } } }] }, bindings: { crew: ['p1', 'p2'], beam: 'b1' }, workspace: 'pz-cy' }));
  const cyHead = (await ecall('engine_log', { workspace: 'pz-cy' })).body.head;
  const cr = refused('pause mid-carry', await ecall('engine_execute', { plan_id: cb.plan_id, workspace: 'pz-cy', pauseAt: 5 }), 'snapshot.non-resumable');
  assert.match(cr.message, /action step:deliver \(carry\) is not resumable/);
  assert.equal((await ecall('engine_log', { workspace: 'pz-cy' })).body.head, cyHead);
  console.log(`ENGINE PAUSE/RESUME (wall ms / in-DO ms): ${P.join('; ')}; pause blob ${pp.snapshotBytes} B (${blobKey.split('/').pop().slice(0, 19)}…), take so far ${pp.take.bytes} B, state storage ${JSON.stringify(pp._meta.storage.state)}`);
}
// ---- historical year room (2022): canonical mars-2022 seeded from public/engine/campus-2022.json ----
{
  const c22 = new Client({ name: 'mars-verification-2022', version: '1.0.0' });
traceClientTools(c22, 'room-2022', { enabled: process.env.SIM_TRACE_TOOLS === '1' });
  await c22.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp?year=2022`), { requestInit: { headers } }));
  const y = async (name, args) => {
    calledEngineTools.add(name);
    const t0 = performance.now();
    const r = await c22.callTool({ name, arguments: args });
    const body = JSON.parse(r.content[0].text);
    body._wallMs = performance.now() - t0;
    return { isError: !!r.isError, body };
  };
  const spaces = ok('2022 workspaces', await y('engine_query_world', {})).workspaces;
  assert.deepEqual(spaces.map((w) => w.id).sort(), ['carry-yard', 'mars-2022', 'proving-ground']);
  assert.ok(spaces.find((w) => w.id === 'mars-2022').protected);
  const q22 = ok('2022 regions', await y('engine_query_world', { workspace: 'mars-2022', include: ['regions'] }));
  for (const r of ['chiba', 'kitchen']) assert.ok(q22.regions.some((g) => g.id === r), `2022 region ${r}`);
  const bb = (id) => {
    const pts = q22.regions.find((g) => g.id === id).polygon;
    return { x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])), z0: Math.min(...pts.map((p) => p[1])), z1: Math.max(...pts.map((p) => p[1])) };
  };
  const n = bb('chiba'), k = bb('kitchen');
  const a = [(n.x0 + n.x1) / 2, n.z0 - 3], b = [(k.x0 + k.x1) / 2, k.z1 + 3];
  ok('2022 fork', await y('engine_fork', { from: 'mars-2022', name: 'court', inventory: 'unlimited' }));
  ok('2022 spawn walker', await y('engine_edit_world', { workspace: 'court', note: 'a walker north of chiba', edits: [{ op: 'spawn', id: 'w1', def: 'human', pose: { p: [a[0], 0, a[1]], yaw: 0 } }] }));
  const cp = ok('2022 bind', await y('engine_bind_plan', { template: walkPlan('court-walk', b[0], b[1]), bindings: { a: 'w1' }, workspace: 'court' }));
  const cr = ok('2022 rehearse courtyard walk', await y('engine_rehearse', { plan_id: cp.plan_id }));
  assert.ok(cr.report.metrics.pathLength > Math.hypot(b[0] - a[0], b[1] - a[1]) + 0.5, 'the walk detours around the courtyard buildings');
  refused('2022 execute canonical', await y('engine_execute', { plan_id: cp.plan_id, workspace: 'mars-2022' }), 'workspace.protected');
  const chapter = yearBuildSetup(2022, 'east-house', loadCampusFile(2022), { bays: 1 });
  const chapterHead = ok('chapter head before refusal', await y('engine_log', { workspace: 'court' })).head;
  const oversized = await fetch(`${base}/mcp?year=2022`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'engine_bind_plan', arguments: { workspace: 'court', template: chapter.build.template, bindings: chapter.build.bindings } } }) });
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).code, 'room.request-too-large');
  assert.equal(ok('chapter head after refusal', await y('engine_log', { workspace: 'court' })).head, chapterHead);
  console.log(`ENGINE WORKLOAD: real 2022 east-house chapter (${chapter.plan.steps.length} steps) refused by the request byte cap before binding or simulation`);
  await c22.close();
}
// Static geometry edits use the same persisted controller path (LM-002).
{
  ok('fork static edits', await ecall('engine_fork', { from: 'proving-ground', name: 'static-edits' }));
  const bound = ok('bind before static edit', await ecall('engine_bind_plan', { workspace: 'static-edits', template: walkPlan('wall-edit', 15, -12), bindings: { a: 'n1' } }));
  const before = ok('route before static edit', await ecall('engine_query_world', { workspace: 'static-edits', route: { actor: 'n1', x: 15, z: -12 } }));
  assert.equal(before.route.ok, true);
  const patch = { op: 'static_add', id: 'gate-wall', obb: { c: [15, -15], half: [0.45, 0.1], yaw: 0 }, y0: 0, y1: 2.4, kind: 'wall' };
  ok('close passage', await ecall('engine_edit_world', { workspace: 'static-edits', note: 'integration passage closure', edits: [patch] }));
  refused('static edit invalidates plan', await ecall('engine_execute', { workspace: 'static-edits', plan_id: bound.plan_id }), 'plan.stale');
  const detour = ok('route around closed passage', await ecall('engine_query_world', { workspace: 'static-edits', route: { actor: 'n1', x: 15, z: -12 } }));
  assert.ok(detour.route.length > before.route.length + 5);
  ok('reopen passage', await ecall('engine_edit_world', { workspace: 'static-edits', note: 'integration reopen', edits: [{ op: 'static_remove', id: 'gate-wall' }] }));
  const run = ok('rebind and execute static edit', await ecall('engine_execute', { workspace: 'static-edits', plan_id: bound.plan_id, rebind: 'auto' }));
  assert.ok(run.rebound);
  const canonical = ok('canonical obstacles untouched', await ecall('engine_query_world', { workspace: 'proving-ground', include: ['obstacles'] }));
  assert.ok(!canonical.obstacles.some((o) => o.id === 'gate-wall'));
  ok('delete static edit workspace', await ecall('engine_delete_workspace', { workspace: 'static-edits' }));
}
console.log(`ENGINE ISOLATION (wall ms / in-DO ms): ${T.join('; ')}`);
console.log('PASS: §28 replay isolation (view fetches + camera track leave heads/logs/poses/bytes unchanged; view capability refused MCP/commands; rooms isolated), fork isolation, plan invalidation (stale diff names s1; camera tracks do not stale) through the DO room.');
assert.deepEqual(ENGINE_TOOLS.filter((n) => !calledEngineTools.has(n)), [], 'every registered engine tool is called through MCP');
assert.deepEqual(legacy.map((t) => t.name).filter((n) => !calledLegacyTools.has(n)), [], 'every legacy tool is called through MCP');
await writeFile(
  '.cloudflare/simulation-test-room.json',
  JSON.stringify({ room, key, view, base }),
  { mode: 0o600 },
);
await client.close();
console.log(
  `PASS: MCP handshake + 20 legacy tools + ${ENGINE_TOOLS.length} engine tools, each called (bind/rehearse/execute/pause/resume/take/camera/direct_camera with self-correction/edit/list/delete, one refusal envelope); room isolation, read-only access, invalid camera, idempotency, walking, activities, pause and persisted state; 2022 year room.`,
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
