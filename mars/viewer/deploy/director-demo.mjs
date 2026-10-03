// Director demo (spec §15/§16 north-star): an external agent directs the engine
// through the real MCP endpoint — discover, design-edit the world (spawn a 19 ft
// upright + crew), bind an impossible plan, read the diagnostic, revise, rehearse
// clean, execute, shoot a camera track, direct the camera in words (engine_direct_camera,
// self-corrected), fork an alternative future, hit plan
// staleness, read the ledger and clean up, then pause a run mid-action, fork the
// pause and resume both branches differently. Prints an annotated transcript
// with per-call and per-step timings. Reference write-up: docs/engineering/DIRECTOR_DEMO.md.
//
//   node deploy/director-demo.mjs                  # starts + stops its own `wrangler dev` on :8907
//   node deploy/director-demo.mjs --base http://127.0.0.1:8907   # use a server you already run
//
// Every expectation is asserted, so a behaviour change in the engine fails the demo loudly.
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { engineTools } from '../engine/api/index.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argBase = process.argv.indexOf('--base');
const base = argBase > 0 ? process.argv[argBase + 1] : 'http://127.0.0.1:8907';

// ---------- local server (only when --base is not given) ----------
let server = null, persist = null;
async function startServer() {
  persist = mkdtempSync(path.join(tmpdir(), 'mars-director-'));
  server = spawn('./node_modules/.bin/wrangler',
    ['dev', '--config', 'simulation/wrangler.jsonc', '--port', '8907', '--inspector-port', '9307', '--persist-to', persist],
    { cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_WRITE_LOGS: 'false' } });
  let log = '';
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  const t0 = performance.now();
  while (performance.now() - t0 < 90_000) {
    try {
      if ((await fetch(`${base}/api/simulation/state`)).status === 401) return performance.now() - t0;
    } catch {}
    if (server.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  stopServer();
  throw new Error(`wrangler dev did not come up on ${base}:\n${log.slice(-2000)}`);
}
function stopServer() {
  if (server && server.exitCode === null) {
    try { process.kill(-server.pid, 'SIGTERM'); } catch {}
  }
  if (persist) rmSync(persist, { recursive: true, force: true });
  server = persist = null;
}
process.on('SIGINT', () => { stopServer(); process.exit(130); });

// ---------- capability + MCP handshake (same scheme as deploy/simulation-integration.mjs) ----------
// A room is created client-side: control key K (random), view key = sha256(K), room id = sha256(view).
// The studio's "Create simulation room" does exactly this; the server derives and checks the chain.
const hash = (s) => createHash('sha256').update(s).digest('hex');
function newRoom() {
  const key = randomBytes(32).toString('hex'), view = hash(key), room = hash(view);
  return { room, key, view, headers: { Authorization: `Bearer ${room}.${key}` } };
}
async function connect(headers) {
  const client = new Client({ name: 'mars-director-demo', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers } }));
  return client;
}

// ---------- transcript + timings ----------
const timings = []; // { step, tool, wall, doMs }
let step = '';
const W = 110;
const clip = (s, n = W) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const say = (s = '') => console.log(s);
const note = (s) => say(`   # ${s}`);
const show = (label, v) => say(`   ← ${label}: ${clip(typeof v === 'string' ? v : JSON.stringify(v), W - 8 - label.length)}`);
function section(name) {
  step = name;
  say(`\n== ${name} ==`);
}
let client;
/** Call an engine tool; returns the parsed body (isError results are returned, not thrown). */
async function call(tool, args, { expectError = false } = {}) {
  say(`   → ${tool} ${clip(JSON.stringify(args), W - 8 - tool.length)}`);
  const t0 = performance.now();
  const r = await client.callTool({ name: tool, arguments: args });
  const wall = performance.now() - t0;
  const text = r.content[0].text;
  const body = JSON.parse(text); // every engine result — refusals and input-validation failures included — is JSON
  body._isError = !!r.isError;
  const doMs = body._meta?.elapsedMs;
  timings.push({ step, tool, wall, doMs });
  say(`     [${wall.toFixed(0)} ms wall${doMs !== undefined ? ` · ${doMs} ms in-DO` : ''}${body._isError ? ' · isError' : ''}]`);
  assert.equal(body._isError, expectError, `${tool}: ${clip(text, 600)}`);
  return body;
}

// ---------- the scene ----------
// carry-yard seed: yard A (x,z ∈ [0,8]) holds the 12 ft beam b1 and crew p1, p2. Its only exit is the
// 2.5 m corridor A (east along z≈4, north at x≈18 to a dead end at z=14). Yard B (x∈[0,8], z∈[18,26]) is a
// separate compound whose only exit is the 1.5 m corridor B into yard B2 (x∈[14,22], z∈[32,40]; campfire
// + benches). Regions: yard-a, yard-b, yard-b2.
const delivery = (to, id = 'beam-delivery') => ({
  schema: 'mars-sequence/1', id,
  params: { crew: { kind: 'actors' }, beam: { kind: 'entity' } },
  steps: [{ id: 'deliver', verb: 'carry', params: { crew: '$crew', item: '$beam', to } }],
});
const walk = (id, x, z) => ({
  schema: 'mars-sequence/1', id,
  params: { a: { kind: 'actor' } },
  steps: [{ id: 'go', verb: 'walk_to', params: { actor: '$a', x, z } }],
});
const pose = (e) => `(${e.pose.p[0].toFixed(2)}, ${e.pose.p[2].toFixed(2)}) yaw ${e.pose.yaw.toFixed(2)}`;
const entity = async (ws, id) => (await call('engine_query_world', { workspace: ws, ids: [id] })).entities[0];

const tAll = performance.now();
if (argBase < 0) {
  say(`starting wrangler dev --config simulation/wrangler.jsonc --port 8907 (fresh --persist-to)…`);
  say(`wrangler ready in ${(await startServer()).toFixed(0)} ms`);
}
try {
  // 1 ────────────────────────────────────────────────────────────────
  section('1. Create a room, list verbs, query the world');
  const cap = newRoom();
  note(`room ${cap.room.slice(0, 12)}… (control capability = Bearer ROOM.KEY; view key = sha256(KEY))`);
  const t0 = performance.now();
  client = await connect(cap.headers);
  timings.push({ step, tool: 'mcp connect', wall: performance.now() - t0 });
  const tools = (await client.listTools()).tools.map((t) => t.name).filter((n) => n.startsWith('engine_'));
  show('engine tools', tools.join(', '));
  assert.deepEqual([...tools].sort(), engineTools().map((t) => t.name).sort(), 'the MCP listing is the controller op registry');
  const verbs = await call('engine_list_verbs', {});
  show('rules', verbs.rulesVersion);
  show(`${verbs.verbs.length} verbs`, verbs.verbs.map((v) => v.verb).join(', '));
  show('carry params', Object.keys(verbs.verbs.find((v) => v.verb === 'carry').inputSchema.properties).join(', '));
  const spaces = await call('engine_query_world', {});
  for (const w of spaces.workspaces) show(`workspace ${w.id}`, `${w.protected ? 'protected' : 'editable'}, head ${w.head}`);
  const world = await call('engine_query_world', { workspace: 'carry-yard', include: ['regions', 'levels', 'links'] });
  for (const e of world.entities)
    show(`${e.kind} ${e.id}`, `${e.def} at ${pose(e)}${e.phase ? `, phase ${e.phase}` : e.human ? `, ${e.human.activity}` : ''}`);
  show('regions / levels / links', `${world.regions.map((r) => r.id).join(', ')} / ${world.levels.length} / ${world.links.length}`);
  note('one 12 ft beam in yard A; a campfire and two benches in yard B2 (targets for the social verbs)');
  const badFork = await call('engine_fork', { from: 'carry-yard', name: 'scene 1' }, { expectError: true });
  assert.equal(badFork.code, 'op.invalid-input');
  show('refused', `${badFork.code}: "${badFork.message}" details.issues ${JSON.stringify(badFork.details.issues)}`);
  note('input validation failures come back in the same JSON envelope as every other refusal');
  const scene = await call('engine_fork', { from: 'carry-yard', name: 'scene-1', label: 'beam delivery', inventory: 'unlimited' });
  show('fork', `${scene.workspace.id} ← ${scene.workspace.forkedFrom}, inventory ${scene.inventory}, head ${scene.workspace.head}`);
  note("inventory 'unlimited' lets engine_edit_world spawn from the catalog (it is itself a design-edit checkpoint)");

  // 2 ────────────────────────────────────────────────────────────────
  section('2. Design-edit, bind an impossible plan, read the diagnostic');
  note('ask: a crew of four carries a 19 ft upright from yard B into yard B2, through the 1.5 m corridor B');
  const upright = { op: 'spawn', id: 'u1', def: 'upright-19ft', lying: { x: 4, z: 22, yaw: 0 } };
  const crewSpots = [[1.5, 19.5], [6.5, 19.5], [1.5, 24.5], [6.5, 24.5]];
  const crew = crewSpots.map(([x, z], i) => ({ op: 'spawn', id: `q${i + 1}`, def: 'human', pose: { p: [x, 0, z], yaw: 0 } }));
  const wallEdit = await call('engine_edit_world', { workspace: 'scene-1', note: 'upright across yard B', edits: [{ ...upright, lying: { x: 4, z: 20, yaw: Math.PI / 2 } }] }, { expectError: true });
  assert.equal(wallEdit.code, 'edit.blocked');
  show('refused', `${wallEdit.code}: "${wallEdit.message}" subjects ${wallEdit.details.subjects.join(', ')}`);
  note('a 5.8 m upright laid north–south at z=20 would stick through the yard B south wall; nothing committed');
  const edit = await call('engine_edit_world', { workspace: 'scene-1', note: '19 ft upright + a crew of four in yard B (hypothetical)', edits: [upright, ...crew] });
  for (const a of edit.applied) show('applied', a);
  show('checkpoint', `${edit.checkpoint.id} (parent ${edit.parent}), cause ${JSON.stringify(edit.checkpoint.cause)}`);
  show('diff', edit.summary);
  assert.deepEqual(edit.diff.added, ['q1', 'q2', 'q3', 'q4', 'u1']);
  const baseline = edit.checkpoint.id;
  const bad = await call('engine_bind_plan', { template: delivery({ x: 18, z: 36, yaw: Math.PI / 2 }, 'upright-delivery'), bindings: { crew: ['q1', 'q2', 'q3', 'q4'], beam: 'u1' }, workspace: 'scene-1' });
  show('plan', `${bad.plan_id} bound to ${bad.baselineCheckpoint}`);
  note('binding only checks the template against the registry schemas; feasibility is the rehearsal\'s job');
  const r1 = await call('engine_rehearse', { plan_id: bad.plan_id }, { expectError: true });
  assert.equal(r1.code, 'rehearsal.failed');
  assert.equal(r1.report.steps[0].diagnostic.code, 'carry.clearance');
  show('status', `${r1.code} / report.status ${r1.report.status}, ticks ${r1.report.metrics.ticks}`);
  const d1 = r1.report.steps[0].diagnostic;
  show('step deliver', `${d1.code} — subjects ${d1.subjects.join(', ')}`);
  say(`     "${d1.message}"`);
  show('details', { stuck: d1.details.stuck, blocker: d1.details.blocker, part: d1.details.part });
  note('each of the four could walk to yard B2 alone; the 5.8 m load cannot make the turn out of yard B');

  note('revision 1 (other yard): set the 12 ft beam down across corridor A\'s dead end (yaw 0)');
  const bad2 = await call('engine_bind_plan', { template: delivery({ x: 18, z: 12.5, yaw: 0 }), bindings: { crew: ['p1', 'p2'], beam: 'b1' }, workspace: 'scene-1' });
  const r1b = await call('engine_rehearse', { plan_id: bad2.plan_id }, { expectError: true });
  const d1b = r1b.report.steps[0].diagnostic;
  assert.equal(d1b.code, 'carry.target-blocked');
  show('step deliver', `${d1b.code}: "${d1b.message}"`);
  note('a 3.7 m beam laid crosswise cannot fit a 2.5 m corridor: the diagnostic names the wall (ca-w)');

  // 3 ────────────────────────────────────────────────────────────────
  section('3. Revise: along the 2.5 m corridor A, rehearse clean');
  const good = await call('engine_bind_plan', { template: delivery({ x: 18, z: 11, yaw: Math.PI / 2 }), bindings: { crew: ['p1', 'p2'], beam: 'b1' }, workspace: 'scene-1' });
  show('plan', `${good.plan_id} (a revision is a new content-hashed plan)`);
  const r2 = await call('engine_rehearse', { plan_id: good.plan_id });
  assert.equal(r2.report.status, 'completed');
  assert.equal(r2.report.violations.count, 0);
  show('status', `${r2.report.status}, violations ${r2.report.violations.count}, diagnostics ${r2.report.diagnostics.length}`);
  show('metrics', r2.report.metrics);
  show('step outputs', (({ x, z, yaw, length, rotation, replans }) => ({ x, z, yaw, length: +length.toFixed(2), rotation: +rotation.toFixed(2), replans }))(r2.report.steps[0].outputs));
  show('take', `${r2.take.take_id} — ${r2.take.ticks} ticks, ${r2.take.bytes} B, kept ${r2.take.kept}`);
  const logBefore = await call('engine_log', { workspace: 'scene-1' });
  assert.equal(logBefore.head, baseline, 'rehearsal never moves a head');
  show('scene-1 head', `${logBefore.head} (unchanged by 3 rehearsals)`);

  // 4 ────────────────────────────────────────────────────────────────
  section('4. Execute from the workspace');
  const ex = await call('engine_execute', { plan_id: good.plan_id, workspace: 'scene-1' });
  assert.equal(ex.take_id, r2.take.take_id, 'rehearsal and execution produce the same take');
  assert.equal(ex.checkpoint.parent, baseline);
  show('checkpoint', `${ex.checkpoint.id} (parent ${ex.checkpoint.parent})`);
  show('cause', ex.checkpoint.cause);
  show('take', `${ex.take_id} — identical to the rehearsal take (deterministic)`);
  const beamAfter = await entity('scene-1', 'b1');
  show('b1 now', `${pose(beamAfter)}, phase ${beamAfter.phase}`);

  // 5 ────────────────────────────────────────────────────────────────
  section('5. Fetch a take slice, attach a camera track');
  const slice = await call('engine_get_take', { take_id: ex.take_id, from: 12, to: 14, entities: ['b1'] });
  const tr = slice.tracks.b1;
  show('slice', `range ${JSON.stringify(slice.range)}, b1 track ${tr.length} samples; events ${slice.events?.length ?? 0}, changes ${slice.changes?.length ?? 0}`);
  show('b1 samples [tick, x_mm, y_mm, z_mm, yaw_mrad…]', tr.slice(0, 3));
  const cam = await call('engine_attach_camera_track', { take_id: ex.take_id, track_id: 'crew-follow', shot: { kind: 'follow', subject: 'b1', offset: [-6, 4, -3] } });
  assert.equal(cam.takeHashUnchanged, true);
  const cr = cam.report;
  show('camera report', `${cr.samples} samples, ${cr.invalidSamples} invalid, ${cr.sweptCrossings} swept crossings, ${cr.cuts.length} cuts, ${cr.corrections.length} corrections, readable ${cr.readableFraction}`);
  if (cr.corrections[0]) show('first correction', `${cr.corrections[0].key} t ${cr.corrections[0].t0}–${cr.corrections[0].t1} s: ${cr.corrections[0].reason}`);
  const withCams = await call('engine_get_take', { take_id: ex.take_id, from: 0, to: 0.1, entities: ['b1'], include: ['cameras'] });
  show('cameras on take', withCams.cameras.map((c) => `${c.id} (${c.data.spec.kind} of ${c.data.spec.subject}, ${c.data.hz} Hz, ${c.data.duration} s)`).join(', '));
  assert.equal(withCams.id, slice.id);
  assert.equal(withCams.finalStateHash, slice.finalStateHash);
  const logCam = await call('engine_log', { workspace: 'scene-1' });
  assert.equal(logCam.head, ex.checkpoint.id, 'a camera track never moves a head');
  show('take unchanged', `takeHashUnchanged ${cam.takeHashUnchanged}; id ${withCams.id}, finalStateHash ${withCams.finalStateHash.slice(0, 16)}… before and after; scene-1 head still ${logCam.head}`);

  // 5b ───────────────────────────────────────────────────────────────
  section('5b. Direct the camera in words (engine_direct_camera)');
  const dirs = [
    { label: 'open on yard A', subject: { kind: 'region', ref: 'yard-a' }, motion: { verb: 'hold' }, duration: 3 },
    { label: 'crane up over the beam as the crew carries it out', subject: { kind: 'entity', ref: 'b1' }, motion: { verb: 'crane', direction: 'up', rise: 8 }, duration: 12, framing: { size: 'wide' } },
  ];
  const dc = await call('engine_direct_camera', { take_id: ex.take_id, directions: dirs });
  assert.equal(dc.ok, true);
  assert.equal(dc.take_id, ex.take_id);
  assert.equal(dc.takeHashUnchanged, true);
  assert.match(dc.track_id, /^dir-/);
  assert.equal(dc.report.shots.length, dirs.length);
  show('directed track', `${dc.track_id}: ${dc.track.samples} samples at ${dc.track.hz} Hz over ${dc.track.duration} s, ${dc.track.keyframes.length} keyframes (1 Hz)`);
  for (const [i, sh] of dc.report.shots.entries()) {
    assert.ok(Array.isArray(sh.corrections), `shot ${i} reports its corrections`);
    assert.ok(sh.simulation.valid, `shot ${i} simulates clean against the take`);
    show(`shot ${i} ${sh.subject.kind} ${sh.subject.id}`, `${sh.corrections.length ? sh.corrections.map((c) => `${c.failure} → ${c.strategy}`).join(', ') : 'no correction needed'}; readability min ${sh.planner?.minReadability}`);
  }
  assert.ok(dc.report.shots[0].corrections.length >= 1, 'the opening hold on yard A is self-corrected (a wall occludes the computed view)');
  const unknown = await call('engine_direct_camera', { take_id: ex.take_id, directions: [{ subject: { kind: 'entity', ref: 'the forklift' }, motion: { verb: 'hold' } }] }, { expectError: true });
  assert.equal(unknown.code, 'camera.direct.unknown');
  show('unknown subject', `${unknown.code}: ${unknown.message}`);
  const sentences = ['hold on yard A for 2 seconds'];
  const parsed = await call('engine_parse_camera', { take_id: ex.take_id, sentences });
  assert.equal(parsed.ok, true);
  const sentenceTrack = await call('engine_direct_camera', { take_id: ex.take_id, sentences });
  const typedTrack = await call('engine_direct_camera', { take_id: ex.take_id, directions: parsed.directions.map((d) => d.direction) });
  assert.equal(sentenceTrack.track_id, typedTrack.track_id, 'sentence and parsed directions compile identically');
  assert.equal(sentenceTrack.takeHashUnchanged, true);
  show('sentence', `${sentences[0]} → ${sentenceTrack.track_id}; take unchanged`);
  const logDir = await call('engine_log', { workspace: 'scene-1' });
  assert.equal(logDir.head, ex.checkpoint.id, 'a directed track never moves a head');

  // 6 ────────────────────────────────────────────────────────────────
  section('6. Fork the workspace, run a different plan there');
  const alt = await call('engine_fork', { from: 'scene-1', name: 'scene-1-alt', label: 'alternative: carry it back' });
  show('fork', `${alt.workspace.id} at ${alt.workspace.head}`);
  const back = await call('engine_bind_plan', { template: delivery({ x: 4, z: 4, yaw: 0 }, 'beam-return'), bindings: { crew: ['p1', 'p2'], beam: 'b1' }, workspace: 'scene-1-alt' });
  const exAlt = await call('engine_execute', { plan_id: back.plan_id, workspace: 'scene-1-alt' });
  show('alt execute', `checkpoint ${exAlt.checkpoint.id}, take ${exAlt.take_id}, ${exAlt.take.ticks} ticks`);
  const logs = {};
  for (const ws of ['scene-1', 'scene-1-alt']) {
    logs[ws] = await call('engine_log', { workspace: ws });
    for (const c of logs[ws].checkpoints)
      show(`${ws} ${c.id === logs[ws].head ? 'HEAD' : '    '}`, `${c.id} ${c.cause.kind}${c.cause.take ? ` take ${c.cause.take} plan ${c.cause.plan}` : ''}`);
  }
  assert.equal(logs['scene-1'].head, ex.checkpoint.id, 'scene-1 is untouched by the fork');
  const beamMain = await entity('scene-1', 'b1'), beamAlt = await entity('scene-1-alt', 'b1');
  show('b1 in scene-1', pose(beamMain));
  show('b1 in scene-1-alt', pose(beamAlt));
  assert.deepEqual(beamMain.pose, beamAfter.pose);

  // 7 ────────────────────────────────────────────────────────────────
  section('7. Plan staleness');
  const later = await call('engine_bind_plan', { template: walk('p1-inspect', 6, 6), bindings: { a: 'p1' }, workspace: 'scene-1-alt' });
  show('bound p1-inspect', `${later.plan_id} to ${later.baselineCheckpoint}`);
  const nudge = await call('engine_bind_plan', { template: walk('p1-step-aside', 2, 2), bindings: { a: 'p1' }, workspace: 'scene-1-alt' });
  const exNudge = await call('engine_execute', { plan_id: nudge.plan_id, workspace: 'scene-1-alt' });
  show('executed p1-step-aside', `checkpoint ${exNudge.checkpoint.id}`);
  const stale = await call('engine_execute', { plan_id: later.plan_id, workspace: 'scene-1-alt' }, { expectError: true });
  assert.equal(stale.code, 'plan.stale');
  show('execute p1-inspect', `${stale.code}`);
  say(`     "${stale.message}"`);
  show('diff.changed', stale.diff.changed);
  const reh = await call('engine_rehearse', { plan_id: later.plan_id }, { expectError: stale.code !== 'plan.stale' });
  show('rehearse (still allowed)', `status ${reh.report.status}, stale ${JSON.stringify(reh.stale)?.slice(0, 80)}`);
  note('fix: bind the same template again — it gets a new plan_id against the new head');
  const rebound = await call('engine_bind_plan', { template: walk('p1-inspect', 6, 6), bindings: { a: 'p1' }, workspace: 'scene-1-alt' });
  const exRe = await call('engine_execute', { plan_id: rebound.plan_id, workspace: 'scene-1-alt' });
  show('re-bound + executed', `${rebound.plan_id} → checkpoint ${exRe.checkpoint.id}`);

  // 8 ────────────────────────────────────────────────────────────────
  section('8. Read the ledger, clean up');
  const led = await call('engine_list', { take_id: ex.take_id });
  for (const p of led.plans) show(`plan ${p.order}`, `${p.plan_id} ${p.template} (${p.workspace ?? '-'}), ${p.bytes} B, referenced by ${p.referencedByCheckpoint.join(', ') || '—'}`);
  for (const t of led.takes) show(`take ${t.order}`, `${t.take_id} kept ${t.kept}, ${t.bytes} B, cameras ${t.cameras}, referenced by ${t.referencedByCheckpoint.join(', ') || '—'}`);
  show('cameras on the delivery take', led.cameras.map((c) => `${c.id} (${c.shot} of ${c.subject}, ${c.hz} Hz, ${c.duration} s)`).join(', '));
  for (const w of led.workspaces) show(`workspace ${w.id}`, `${w.protected ? 'protected' : 'editable'}, head ${w.head}${w.forks.length ? `, forks ${w.forks.join(', ')}` : ''}`);
  assert.ok(led.takes.find((t) => t.take_id === ex.take_id).referencedByCheckpoint.includes(ex.checkpoint.id));
  const delParent = await call('engine_delete_workspace', { workspace: 'scene-1' }, { expectError: true });
  assert.equal(delParent.code, 'workspace.has-forks');
  show('refused', `${delParent.code}: "${delParent.message}"`);
  const delAlt = await call('engine_delete_workspace', { workspace: 'scene-1-alt' });
  show('deleted', `${delAlt.deleted} (head ${delAlt.head}) — ${delAlt.note}`);
  const led2 = await call('engine_list', { include: ['takes'] });
  const freed = led2.takes.filter((t) => t.referencedByCheckpoint.length === 0).map((t) => t.take_id);
  show('now unreferenced (evictable)', freed.join(', '));
  assert.ok(freed.includes(exAlt.take_id));

  // 9 ────────────────────────────────────────────────────────────────
  section('9. Pause mid-action, fork the pause, resume both branches');
  note('a carry cannot be paused: its live state is not resumable (the refusal names it; nothing is committed)');
  const headNow = (await call('engine_log', { workspace: 'scene-1' })).head;
  const carryPause = await call('engine_execute', { plan_id: back.plan_id, workspace: 'scene-1', pauseAt: 8 }, { expectError: true });
  assert.equal(carryPause.code, 'snapshot.non-resumable');
  assert.deepEqual(carryPause.details.subjects, ['step:deliver']);
  show('refused', `${carryPause.code}: "${clip(carryPause.message, 150)}"`);
  assert.equal((await call('engine_log', { workspace: 'scene-1' })).head, headNow);
  const fire = {
    schema: 'mars-sequence/1', id: 'to-the-fire',
    params: { a: { kind: 'actor' }, b: { kind: 'actor' } },
    steps: [
      { id: 'lead', verb: 'walk_to', params: { actor: '$a', x: 18, z: 34 } },
      { id: 'follow', verb: 'walk_to', params: { actor: '$b', x: 20, z: 35 }, when: { event: 'started', step: 'lead' }, at: 2 },
    ],
  };
  const fp = await call('engine_bind_plan', { template: fire, bindings: { a: 'q1', b: 'q2' }, workspace: 'scene-1' });
  const ref = await call('engine_rehearse', { plan_id: fp.plan_id });
  show('rehearsal (unpaused reference)', `${ref.report.status}, ${ref.report.metrics.duration} s, finalStateHash ${ref.report.finalStateHash.slice(0, 16)}…`);
  note('q1 and q2 walk from yard B through the 1.5 m corridor B to the fire; pause 10 s in');
  const paused = await call('engine_execute', { plan_id: fp.plan_id, workspace: 'scene-1', pauseAt: 10 });
  assert.equal(paused.paused, true);
  assert.deepEqual(paused.live.map((a) => a.id), ['step:lead', 'step:follow']);
  show('pause checkpoint', `${paused.checkpoint.id} resumable ${paused.checkpoint.resumable}, cause ${JSON.stringify(paused.checkpoint.cause)}`);
  show('live', paused.live.map((a) => `${a.id} ${a.verb} ${a.status}/${a.phase}`).join(', '));
  show('sizes', `pause blob ${paused.snapshotBytes} B (snapshot + runner state, stored as state/resume.<hash>); take so far ${paused.take_id} ${paused.take.ticks} ticks ${paused.take.bytes} B`);
  const q1mid = await entity('scene-1', 'q1');
  show('q1 at the pause', `${pose(q1mid)}, ${q1mid.human.activity}, task ${q1mid.human.task}`);
  const badBind = await call('engine_bind_plan', { template: walk('q3-idle', 2, 21), bindings: { a: 'q3' }, workspace: 'scene-1' }, { expectError: true });
  assert.equal(badBind.code, 'workspace.paused');
  show('refused', `${badBind.code}: "${badBind.message}"`);
  const pf = await call('engine_fork', { from: 'scene-1', name: 'scene-1-b', label: 'same pause, more people' });
  assert.equal(pf.workspace.head, paused.checkpoint.id);
  show('fork at the pause', `${pf.workspace.id} head ${pf.workspace.head} (resumable: forks share the snapshot blob)`);
  const res = await call('engine_resume', { workspace: 'scene-1' });
  assert.equal(res.report.finalStateHash, ref.report.finalStateHash, 'resume without commands = the unpaused run');
  show('resume scene-1', `${res.report.status}, checkpoint ${res.checkpoint.id} (parent ${res.checkpoint.parent}), segment take ${res.take_id} ${res.take.ticks} ticks`);
  show('same final state as unpaused', `${res.report.finalStateHash.slice(0, 16)}… === rehearsal ${ref.report.finalStateHash.slice(0, 16)}…; run takes ${res.run.takes.join(' + ')}`);
  const resB = await call('engine_resume', { workspace: 'scene-1-b', commands: [{ id: 'join', verb: 'walk_to', params: { actor: 'q4', x: 16, z: 33 } }] });
  assert.notEqual(resB.report.finalStateHash, res.report.finalStateHash);
  show('resume scene-1-b + q4 joins', `${resB.report.status}, ${resB.report.metrics.duration} s, step join ${resB.report.steps.find((x) => x.id === 'join').status}, finalStateHash ${resB.report.finalStateHash.slice(0, 16)}… (a different future)`);
  const again = await call('engine_resume', { workspace: 'scene-1' }, { expectError: true });
  assert.equal(again.code, 'resume.not-resumable');
  show('refused', `${again.code}: "${again.message}"`);
  const plog = await call('engine_log', { workspace: 'scene-1-b', limit: 3 });
  for (const c of plog.checkpoints) show(`scene-1-b ${c.id === plog.head ? 'HEAD' : '    '}`, `${c.id} ${c.cause.kind}${c.resumable ? ' (resumable)' : ''}${c.cause.take ? ` take ${c.cause.take}` : ''}`);
  const delB = await call('engine_delete_workspace', { workspace: 'scene-1-b' });
  show('deleted', delB.deleted);
  await client.close();
} finally {
  stopServer();
}

// ---------- timings ----------
say('\n== Timings (ms) ==');
const steps = [...new Set(timings.map((t) => t.step))];
say(`${'step'.padEnd(70)} ${'calls'.padStart(5)} ${'wall'.padStart(7)} ${'in-DO'.padStart(7)}`);
for (const s of steps) {
  const ts = timings.filter((t) => t.step === s);
  const sum = (k) => ts.reduce((a, t) => a + (t[k] ?? 0), 0);
  say(`${s.padEnd(70)} ${String(ts.length).padStart(5)} ${sum('wall').toFixed(0).padStart(7)} ${sum('doMs').toFixed(0).padStart(7)}`);
}
const slow = [...timings].sort((a, b) => b.wall - a.wall).slice(0, 3);
say(`slowest calls: ${slow.map((t) => `${t.tool} ${t.wall.toFixed(0)} ms (${t.doMs ?? '-'} in-DO)`).join('; ')}`);
say(`total ${(performance.now() - tAll).toFixed(0)} ms (incl. server start when spawned)`);
