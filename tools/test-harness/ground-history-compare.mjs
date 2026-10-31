#!/usr/bin/env node
// No ports, services, credentials, models or production data. Generates its own
// tiny histories, then boots independent copies under both explicit readers.
// node tools/test-harness/ground-history-compare.mjs --baseline /tree/main \
//   --candidate /tree/candidate --out .local/engine/history-<id>
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scratchDir } from '../lib/paths.mjs';

const self = fileURLToPath(import.meta.url);
const usage = 'Required: --baseline <absolute tree> --candidate <absolute tree> --out <fresh absolute scratch dir>';
const args = Object.create(null);
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1];
  assert.ok(['--baseline', '--candidate', '--out', '--worker', '--world', '--reader', '--mode'].includes(key) && value && !value.startsWith('--') && !args[key], usage);
  args[key] = value;
}
for (const key of ['--baseline', '--candidate', '--out']) assert.ok(args[key] && isAbsolute(args[key]), usage);
const baseline = realpathSync(args['--baseline']), candidate = realpathSync(args['--candidate']), out = resolve(args['--out']);
for (const tree of [baseline, candidate]) assert.ok(statSync(join(tree, 'packages/engine-mars/src/engine.ts')).isFile(), 'explicit source tree required');
const scratch = scratchDir('engine');
assert.ok(out.startsWith(scratch + sep), 'output must be a new directory inside the engine scratch dir (SIM_SCRATCH or .local)');
// Resolve the existing ancestor as well: a scratch symlink must not escape.
let ancestor = dirname(out);
while (!existsSync(ancestor)) ancestor = dirname(ancestor);
assert.ok(realpathSync(ancestor) === scratch || realpathSync(ancestor).startsWith(scratch + sep), 'scratch output must not traverse a symlink outside engine scratch');
const sha = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const load = (tree, path) => import(pathToFileURL(join(tree, path)).href);
const worldId = (world) => `engine-history-fixture-${world}`;
const seed = 'engine-ground-history-synthetic-v1';
const owner = 'synthetic:engine-history-owner', soul = 's_engine_history', entity = 'h_engine_history';
const worlds = ['eden', 'mars', 'littlemartians'];

async function modules(tree, world) {
  // Each reader's host/fold/DB/kernel and physical factory come from its selected
  // tree. A sparse baseline may symlink only modules known to be unchanged.
  const native = await load(tree, 'packages/engine-mars/src/engine.ts');
  const { MARS_2026_MAP } = await load(tree, 'packages/engine-mars/src/mars-2026-map.ts');
  const selected = world === 'eden' ? native.EDEN_COMMONS_WORLD : world === 'littlemartians' ? native.LITTLE_MARTIANS_WORLD : {
    scene: 'eden-camp', arrival: [-3, 18], arrivalPlace: 'arrival', reference: [-1, 17],
    grounds: { id: 'grounds', name: 'Mars camp' }, map: MARS_2026_MAP, disassemblyV1: true,
  }; // Exact Mars selection from tools/core/multiworld/world-server.mjs.
  const [{ Db }, { WorldHost }, { kernelHash }] = await Promise.all([
    load(tree, 'apps/server/src/db.ts'), load(tree, 'apps/server/src/world.ts'),
    load(tree, 'packages/kernel/src/index.ts'),
  ]);
  return { Db, WorldHost, kernelHash, selected, factory: await native.marsFactory(selected) };
}

function retained(db, id) {
  return {
    events: sha(db.events(id)),
    owners: sha(db.db.prepare('SELECT * FROM users ORDER BY id').all()),
    souls: sha(db.db.prepare('SELECT * FROM souls ORDER BY id').all()),
    paidRows: Number(db.db.prepare('SELECT COUNT(*) AS n FROM paid_costs').get().n),
  };
}
function checkpoint(db, host, kernelHash) {
  assert.equal(host.engine.world.groundV1, undefined, 'authored fixture must not opt into ground/1');
  assert.deepEqual(host.engine.runtime.violations, [], 'fixture must have no native invariant violations');
  assert.equal(db.paidCost(), 0, '$0 fixture');
  assert.equal(db.soul(soul)?.owner, owner, 'synthetic ownership retained');
  assert.equal(host.minds.get(soul)?.owner, owner, 'mind ownership retained');
  const saved = retained(db, host.worldId);
  assert.equal(saved.paidRows, 0, 'no paid model calls');
  return {
    stateHash: host.engine.stateHash(), kernelHash: kernelHash(host.kernel),
    tick: host.engine.world.tick, head: host.seq, rulesVersion: host.engine.rulesVersion,
    pose: structuredClone(host.engine.world.entities[entity].pose), retained: saved,
  };
}
async function generate(world) {
  const { Db, WorldHost, kernelHash, selected, factory } = await modules(baseline, world);
  const db = new Db(join(out, `${world}.fixture.db`));
  const host = new WorldHost(db, factory, seed, 1e9, worldId(world), { durableClockV1: true });
  try {
    assert.equal(host.boot().from, 'genesis'); host.drainInputs();
    db.upsertUser({ id: owner, email: null, wallet: null, role: 'user' });
    db.createSoul({ id: soul, entityId: entity, worldId: host.worldId, owner, name: 'Synthetic resident', description: 'Generated compatibility fixture; no user data', native: false });
    async function logged(kind, payload) { const p = host.enqueue(kind, 'synthetic:fixture', payload); host.drainInputs(); await p; }
    await logged('birth', { soulId: soul, entityId: entity, owner, name: 'Synthetic resident', description: 'Generated compatibility fixture' });
    await logged('edge-relocate', { entityId: entity, to: selected.reference });
    assert.ok(Math.hypot(host.engine.world.entities[entity].pose.p[0] - selected.reference[0], host.engine.world.entities[entity].pose.p[2] - selected.reference[1]) < 7, 'reference relocation must land nearby');
    for (let i = 0; i < 20; i++) host.tickOnce();
    host.saveSnapshot(true);
    const prefix = { tick: host.engine.world.tick, head: host.seq };
    for (let i = 0; i < 20; i++) host.tickOnce();
    await logged('edge-relocate', { entityId: entity, to: selected.arrival });
    for (let i = 0; i < 20; i++) host.tickOnce();
    host.saveSnapshot(true);
    const expected = checkpoint(db, host, kernelHash);
    assert.ok(expected.head > prefix.head && expected.tick > prefix.tick, 'fixture needs an actual recorded suffix');
    writeFileSync(join(out, `${world}.expected.json`), JSON.stringify({ selected, prefix, expected }, null, 2) + '\n', { flag: 'wx' });
    host.stop(); db.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally { host.stop(); db.close(); }
}
async function boot(world, reader, mode) {
  assert.ok(['baseline', 'candidate'].includes(reader) && ['latest', 'suffix', 'genesis'].includes(mode));
  const { Db, WorldHost, kernelHash, factory } = await modules(reader === 'baseline' ? baseline : candidate, world);
  const file = join(out, `${world}.${reader}.${mode}.db`);
  copyFileSync(join(out, `${world}.fixture.db`), file);
  const db = new Db(file);
  const { prefix, expected } = JSON.parse(readFileSync(join(out, `${world}.expected.json`), 'utf8'));
  let host;
  try {
    if (mode === 'genesis') db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(worldId(world));
    if (mode === 'suffix') db.db.prepare('DELETE FROM snapshots WHERE world_id=? AND tick>?').run(worldId(world), prefix.tick);
    const before = retained(db, worldId(world));
    host = new WorldHost(db, factory, seed, 1e9, worldId(world), { durableClockV1: true });
    const booted = host.boot();
    assert.equal(booted.from, mode === 'genesis' ? 'genesis' : 'snapshot');
    if (mode === 'suffix') assert.ok(booted.replayed > 0, 'mid-history snapshot must replay the recorded suffix');
    const actual = checkpoint(db, host, kernelHash);
    assert.deepEqual(actual.retained, before, 'boot must preserve accepted events, owner and Soul rows');
    assert.deepEqual(actual, expected, `${world} ${reader} ${mode}: exact baseline checkpoint`);
    writeFileSync(join(out, `${world}.${reader}.${mode}.json`), JSON.stringify({ world, reader, mode, boot: booted, ...actual, verdict: 'PASS' }, null, 2) + '\n', { flag: 'wx' });
  } finally { host?.stop(); db.close(); }
}
function identity(tree) {
  let commit = null;
  try {
    const gitOptions = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] };
    const top = execFileSync('git', ['-C', tree, 'rev-parse', '--show-toplevel'], gitOptions).trim();
    // Scratch archives can be nested in the strategy repo; its parent commit is
    // not the archive's source identity.
    if (realpathSync(top) === tree) commit = execFileSync('git', ['-C', tree, 'rev-parse', 'HEAD'], gitOptions).trim();
  } catch { /* an explicit archived source tree is also supported */ }
  const hashFile = (path) => createHash('sha256').update(readFileSync(join(tree, path))).digest('hex');
  return { tree, commit, engineSourceHash: hashFile('packages/engine-mars/src/engine.ts'), sourceHashes: Object.fromEntries(
    ['apps/server/src/world.ts', 'apps/server/src/fold.ts', 'apps/server/src/db.ts'].map(path => [path, hashFile(path)]),
  ) };
}

if (args['--worker']) {
  assert.ok(existsSync(join(out, 'RUN.json')) && worlds.includes(args['--world']), 'only a generated fixture run may invoke workers');
  if (args['--worker'] === 'generate') await generate(args['--world']);
  else { assert.equal(args['--worker'], 'boot'); await boot(args['--world'], args['--reader'], args['--mode']); }
} else {
  assert.ok(!existsSync(out), 'refusing to reuse an output directory');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'RUN.json'), JSON.stringify({ contract: 'ground-history-compare/1', startedAt: new Date().toISOString(), baseline: identity(baseline), candidate: identity(candidate), syntheticOnly: true, ports: [], modelSpend: 0 }, null, 2) + '\n', { flag: 'wx' });
  function worker(phase, world, reader, mode) {
    const childArgs = [...process.execArgv, self, '--baseline', baseline, '--candidate', candidate, '--out', out, '--worker', phase, '--world', world, ...(reader ? ['--reader', reader, '--mode', mode] : [])];
    const run = spawnSync(process.execPath, childArgs, { encoding: 'utf8', timeout: 300_000, maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, BRAIN_MODE: 'fake', THINKING_BUDGET_USD: '0', ENABLE_WORLD_ENGINE: '0', TAKES_PERSIST: '0', DATA_DIR: join(out, 'unused-config-data') } });
    const label = [world, phase, reader, mode].filter(Boolean).join('.');
    writeFileSync(join(out, `${label}.log`), `${run.stdout ?? ''}${run.stderr ?? ''}`, { flag: 'wx' });
    assert.equal(run.status, 0, `${label} failed; inspect ${join(out, `${label}.log`)} (${run.error?.message ?? 'nonzero exit'})`);
  }
  try {
    for (const world of worlds) {
      worker('generate', world);
      for (const reader of ['baseline', 'candidate']) for (const mode of ['latest', 'suffix', 'genesis']) worker('boot', world, reader, mode);
    }
    const rows = worlds.flatMap(world => ['baseline', 'candidate'].flatMap(reader => ['latest', 'suffix', 'genesis'].map(mode => JSON.parse(readFileSync(join(out, `${world}.${reader}.${mode}.json`), 'utf8')))));
    writeFileSync(join(out, 'SUMMARY.json'), JSON.stringify({ contract: 'ground-history-compare/1', verdict: 'PASS', worlds: worlds.length, comparisons: rows.length, modelSpend: 0, results: rows }, null, 2) + '\n', { flag: 'wx' });
    writeFileSync(join(out, 'SUMMARY.tsv'), 'world\treader\tmode\tverdict\ttick\thead\tstateHash\tkernelHash\n' + rows.map(r => [r.world, r.reader, r.mode, r.verdict, r.tick, r.head, r.stateHash, r.kernelHash].join('\t')).join('\n') + '\n', { flag: 'wx' });
    process.stdout.write(`PASS: ${rows.length} synthetic history comparisons; $0; ${join(out, 'SUMMARY.tsv')}\n`);
  } catch (error) {
    writeFileSync(join(out, 'FAILURE.json'), JSON.stringify({ verdict: 'FAIL', message: error.message, at: new Date().toISOString() }, null, 2) + '\n', { flag: 'wx' });
    throw error;
  }
}
