// Harvest fix "cliargs" (engine-backlog #8, #11, #15 + clone/furnish defects): regression tests. Only network: an
// ephemeral HTTP listener on 127.0.0.1 standing in for the world's god API (a wire fixture, no Sim service).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { COMMANDS, checkArgs, readArgs, helpFor } from './cli.mjs';
import { view, invalidate, resolveDef } from './lib/mirror.mjs';
import { normalizeArgv } from './lib/args.mjs';
import { save } from './lib/state.mjs';
import { furnishBatch, furnishStyles, loadRecipe } from './lib/furnish.mjs';
import { CORE_KIT, WorldModel, applyBatch } from '../../packages/world-compiler/src/index.ts';

const reads = (cmd, argv) => { const r = readArgs(cmd, argv); checkArgs(cmd, r.flags, r.rest); return r; };

// ---------------------------------------------------------------- #11 --side words
test('place --along … --side left|right|both|center is read; land --side stays a number', () => {
  for (const side of ['left', 'right', 'both', 'center', 'centre']) reads('place', ['lamp-post', '--along', 'road', '--row', '4', '--gap', '10', '--side', side]);
  assert.throws(() => reads('place', ['lamp-post', '--along', 'road', '--side', 'up']), /--side is left, right, both, center.*got "up"/);
  reads('land', ['cliff', '--path', '[[0,0],[9,0]]', '--height', '4', '--side', '-1']);
  assert.throws(() => reads('land', ['cliff', '--side', 'left']), /--side takes a number/);
});

test('place --side without --along says what --side is for, before contacting the world', async () => {
  await assert.rejects(COMMANDS.place(['bench'], { at: '0,0', side: 'left' }), /--side picks a side of a path: use it with --along/);
});

// ---------------------------------------------------------------- #15 shell shapes (observed argv from harvest cli-logs)
test('several options in ONE argument are read as separate words, and the repair is reported', () => {
  let r = reads('place', ['bird', '--on', 'palm/crown', '--param', 'behavior=perch', '--param feather=#f5c80f --param breast=#ffd91f --scale 1.6 --no-build']);
  assert.deepEqual(r.flags.param, ['behavior=perch', 'feather=#f5c80f', 'breast=#ffd91f']); assert.equal(r.flags.scale, '1.6'); assert.equal(r.flags['no-build'], true);
  assert.match(r.notes[0], /read "--param feather.*" as 7 words/);
  r = reads('place', ['bed', '--inside', 'tower/top', '--wall left', '--name', 'bunk']); assert.equal(r.flags.wall, 'left');
  r = reads('place', ['core/cup@1', '--on', 'commons/table', '--name', 'cup-1', '--scale 1.4']); assert.equal(r.flags.scale, '1.4');
  // JSON, quotes and free text are never split
  r = reads('place', ['sign', '--at', '1,2', '--param board=#f6c10e --param post=#8a6a3a', '--state', '{"text":"a b"}', '--name', 's']);
  assert.equal(r.flags.state, '{"text":"a b"}'); assert.deepEqual(r.flags.param, ['board=#f6c10e', 'post=#8a6a3a']);
  r = reads('build', ['start', 'x', '--title', 'A tall church', '--steps', 'shell,roof']); assert.equal(r.flags.title, 'A tall church'); assert.deepEqual(r.notes, []);
  assert.throws(() => reads('place', ['fence', '--path', '[[0,0],[1,1]]', '--param "label=a b" --name x']), /ONE argument/);
});

test('a row in one unsplit variable fills the empty options when the spare words fit them exactly, by type', () => {
  const cases = [
    [['core/lantern-post@1', '--at', '58.2,388.6 route-lantern-square', '--name'], { at: '58.2,388.6', name: 'route-lantern-square' }],
    [['stilt-bungalow@1', '--at', '--facing', 'w', '--name', 'bungalow-c 210,65'], { at: '210,65', facing: 'w', name: 'bungalow-c' }],
    [['azulejo-panel@1', '--at', '-69.9,-68.5 w azulejo-e2', '--facing', '--name'], { at: '-69.9,-68.5', facing: 'w', name: 'azulejo-e2' }],
    [['core/humanoid@2', '--at', '-5,51.5 s', '--facing', '--param', 'preset=casual', '--name', 'resident-5'], { at: '-5,51.5', facing: 's', name: 'resident-5' }],
    [['route-rest-shelter@1', '--along', 'upper-path 0.2', '--t', '--side', 'right', '--offset', '1', '--name', 'rest-3'], { along: 'upper-path', t: '0.2', side: 'right' }],
  ];
  for (const [argv, want] of cases) {
    const r = reads('place', argv);
    for (const [k, v] of Object.entries(want)) assert.equal(r.flags[k], v, `${argv.join(' ')} → --${k}`);
    assert.match(r.notes.at(-1), /a variable arrived unsplit; read as: place /);
  }
  // `place ${row}@1 --at $xz` with row = "kid-blue -24,0": the version stays with the def
  const r = reads('place', ['kid-blue -24,0@1', '--at', '--yaw', '1', '--name', 'kid-7']);
  assert.deepEqual(r.rest, ['kid-blue@1']); assert.equal(r.flags.at, '-24,0');
});

test('unsplit rows that do not fit exactly are still refused, with the shell explanation', () => {
  for (const argv of [
    ['birch', '--at', '19,27 0.95 6', '--scale', '--param', 'leaf=#9aab88', '--name', 'birch-'],          // 2 spare words, 1 empty option
    ['cedar@1', '--at', ',', '--facing', '--name', 'rest-bay-2 -98 335.5 w'],                               // 3 spare, 1 empty
    ['tram-stop', '--near', 'p 0.45 e c2', '--t', '--dir', '--dist', '1.5', '--facing', 'p 0.45 e c2', '--name'], // 6 spare, 3 empty
    ['bench', '--at', '1,2 3,4', '--facing'],                                                                // a point never faces
    ['tier1-shadowed-roots roots@1', '--at', '0,0', '--name'],                                               // name+def or def+name: a guess
  ]) {
    const r = readArgs('place', argv);
    assert.throws(() => checkArgs('place', r.flags, r.rest), /needs a value/);
    assert.match(r.hint, /did not split a variable \(zsh never splits unquoted \$vars\)/);
  }
  assert.equal(normalizeArgv('place', ['bench', '--at', '1,2', '--name', 'b']).hint, null);
});

test('<verb> --help prints the verb\'s help lines and options instead of a refusal', () => {
  assert.equal(readArgs('look', ['--help']).flags.help, true);
  assert.match(helpFor('set'), /set <ref> --param k=v/); assert.match(helpFor('set'), /set options: .*--param/);
  assert.match(helpFor('place'), /^build:\s+place <def>/m); assert.doesNotMatch(helpFor('set'), /the set "stall"/);
});

// ---------------------------------------------------------------- #8 def.unknown the library resolves
const lib = (refs) => view({ rows: [], snapshot: { defs: [], library: refs.map((ref, i) => ({ ref, hash: `h${i}` })), entities: [] } });
test('resolveDef reads unambiguous names: core/<local>, a name without @v, <core name>@v; never guesses', () => {
  const v = lib(['zz-crate@1', 'core-humanoid@1', 'core-humanoid@2', 't@1', 't@2', 'core-bench@1', 'twin@1', 'core-twin@1']);
  assert.equal(resolveDef(v, 'core/zz-crate@1'), 'zz-crate@1');
  assert.equal(resolveDef(v, 'zz-crate'), 'zz-crate@1');
  assert.equal(resolveDef(v, 'humanoid@2'), 'core/humanoid@2');
  assert.equal(resolveDef(v, 'bench'), null);          // already known (core/bench@1): nothing to resolve
  assert.equal(resolveDef(v, 't'), null);              // t@1 or t@2: ambiguous
  assert.equal(resolveDef(v, 'twin@1'), null);         // known as written
  assert.equal(resolveDef(v, 'zz-nothing'), null);
  assert.equal(resolveDef(v, 'zz-crate@3'), null);     // a version that does not exist is not swapped
});

// ---------------------------------------------------------------- world-API wire fixture
async function world(t, { entities = [], rows = [], library = [], bake = () => ({ form: 'point', layer: 'solid', box: [1, 1, 1] }) } = {}) {
  const cwd = process.cwd(), dir = mkdtempSync(join(tmpdir(), 'god-cliargs-')), calls = [];
  const snapshot = { worldId: 'stub', constants: { extent: 200, ground: 'flat' }, seq: 1, buildsRev: 1, state: {}, entities, library, defs: [], prayers: [], ground: { landforms: [], waters: [] }, builds: [] };
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const part of req) raw += part;
    const c = { method: req.method, path: req.url, body: raw ? JSON.parse(raw) : undefined }; calls.push(c);
    let reply;
    if (c.path === '/v1/god/snapshot') reply = snapshot;
    else if (c.path === '/v1/world/seq') reply = { seq: 1, builds: 1 };
    else if (c.path === '/v1/god/query') reply = c.body.bake ? { bake: bake(c.body.bake.def) } : c.body.layout ? { layout: { entities: rows } } : { layout: { entities: rows } };
    else reply = { accepted: true, seq: 2, ids: { e_9: 'e_9' } };
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(reply));
  });
  for (;;) { await new Promise((r, j) => { server.once('error', j); server.listen(0, '127.0.0.1', r); }); const p = server.address().port; if (p < 4930 || p > 4970) break; await new Promise((r) => server.close(r)); }
  process.chdir(dir); invalidate(); save({ world: `http://127.0.0.1:${server.address().port}`, token: 'fixture-only' });
  t.after(async () => { process.chdir(cwd); invalidate(); await new Promise((r) => { server.close(r); server.closeAllConnections(); }); rmSync(dir, { recursive: true, force: true }); });
  return calls;
}
const acts = (calls) => calls.filter((c) => c.path === '/v1/god/act' || c.path === '/v1/god/dryrun').map((c) => c.body);

test('place reads core/<local def> as the local def, says so, and commits the resolved ref', async (t) => {
  const calls = await world(t, { library: [{ ref: 'zz-crate@1', hash: 'k1' }], bake: (def) => (def === 'zz-crate@1' ? { form: 'point', layer: 'solid', box: [1, 1, 1] } : { error: `def.unknown ${def}` }) });
  const out = await COMMANDS.place(['core/zz-crate@1'], { at: '0,30' });
  assert.match(out, /note: read "core\/zz-crate@1" as zz-crate@1 \(the only def of that name\)/);
  const placed = acts(calls).flatMap((b) => b.ops ?? []).filter((o) => o.op === 'place');
  assert.ok(placed.length && placed.every((o) => o.def === 'zz-crate@1'), JSON.stringify(placed));
  await assert.rejects(COMMANDS.place(['zz-nothing'], { at: '0,0' }), /def\.unknown core\/zz-nothing@1/);
});

// ---------------------------------------------------------------- clone --count --step without --at
test('clone --count n --step dx,dz without --at starts one step from the original, not on it', async (t) => {
  const row = { id: 'e_1', path: 'cb', name: 'cb', parent: 'world', def: 'core-bench@1', form: 'point', pose: [20, 0, 40, 0, 1], box: [1.6, 0.9, 0.6] };
  const calls = await world(t, { entities: [{ id: 'e_1', def: 'core-bench@1', name: 'cb', in: { parent: 'world' }, p: [20, 40] }], rows: [row] });
  assert.match(await COMMANDS.clone(['cb'], { count: '3', step: '3,0' }), /cloned cb ×3, starting one step \(3,0\) from cb/);
  let op = acts(calls).at(-1).ops[0]; assert.deepEqual([op.p, op.step, op.count], [[23, 40], [3, 0], 3]);
  await COMMANDS.clone(['cb'], { count: '2' });                    // default step: 1.5 × width, at least 2 m
  op = acts(calls).at(-1).ops[0]; assert.deepEqual([op.p, op.step], [[22.4, 40], [2.4, 0]]);
  await COMMANDS.clone(['cb'], { at: '0,0', count: '2', step: '3,0' }); // --at: the first copy is at --at, as before
  op = acts(calls).at(-1).ops[0]; assert.deepEqual(op.p, [0, 0]);
  await COMMANDS.clone(['cb'], {});                                // a single clone without --step is unchanged
  op = acts(calls).at(-1).ops[0]; assert.equal(op.p, undefined);
});

// ---------------------------------------------------------------- furnish --style
test('furnish with an unknown --style refuses with the styles; a building\'s own unknown style says it used cottage', () => {
  const styles = furnishStyles(); assert.ok(styles.includes('cottage') && styles.includes('townhouse'));
  assert.throws(() => loadRecipe('castle', { strict: true }), new RegExp(`furnish has no style "castle"; styles: .*cottage`));
  assert.throws(() => loadRecipe('../cottage', { strict: true }), /no style/);
  assert.equal(loadRecipe('castle').style ?? 'cottage', loadRecipe('cottage').style ?? 'cottage');
  const w = new WorldModel({ constants: { ground: 'land' }, seed: 'cliargs' });
  for (const d of CORE_KIT) w.defineDef(d, 'core', 0);
  assert.equal(applyBatch(w, { ops: [{ op: 'place', def: 'core/cottage@1', name: 'ch' }] }, 'god', 1).result.accepted, true);
  const id = w.get('ch').id;
  for (const id2 of [...(w.children.get(id) ?? [])]) w.delete(id2);
  assert.throws(() => furnishBatch(w, id, 'castle'), /furnish has no style "castle"; styles: /);
  assert.ok(furnishBatch(w, id, 'cottage').ops.length > 0);
  assert.ok(furnishBatch(w, id, undefined).ops.length > 0);
});

// ---------------------------------------------------------------- --side geometry (unreachable before the --side fix)
test('--along --side measures from the road edge using its params.width, never its length (box[0])', async () => {
  const { solve } = await import('./lib/solver.mjs');
  const row = { id: 'r', path: 'road', name: 'road', parent: 'world', def: 'core-road@1', form: 'path', layer: 'surface', shape: { path: [[-40, 0], [40, 0]] }, pose: [0, 0, 0, 0, 1], box: [80, 0.2, 7.2] };
  const lamp = { def: 'core/lamp-post@1', form: 'point', layer: 'solid', box: [0.4, 4, 0.4], s: 1 };
  const at = (shape, params) => { const v = view({ rows: [{ ...row, shape }], snapshot: { entities: [{ id: 'r', def: 'core-road@1', params, shape }], defs: [], library: [] }, extent: 500 }); return solve(v, lamp, { along: 'road', side: 'left', t: 0.5 }); };
  let s = at(row.shape, { width: 6 }), c = s.items[0].candidates[0];
  assert.deepEqual(c.p, [0, -4.2]); assert.equal(c.constraints[0].offset, 4.2);   // server: (shape.width ?? 0)/2 + offset
  assert.match(s.notes[0], /80 m long, 6 m wide/);
  s = at({ ...row.shape, width: 6 }, {}); c = s.items[0].candidates[0];
  assert.deepEqual(c.p, [0, -4.2]); assert.equal(c.constraints[0].offset, 1.2);   // shape.width: 3 + 1.2
});
