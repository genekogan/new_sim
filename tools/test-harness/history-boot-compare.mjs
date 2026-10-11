// History boot comparison: do the old worlds' real histories boot identically on a candidate tree and on a baseline
// tree? This is the data-safety check for moving old-world backends to the merged codebase (docs/god/MERGE-GUIDE.md
// F4).
//
// For each world, the production SQLite is copied READ-ONLY (VACUUM INTO, tools/core/multiworld/copy-sqlite.mjs:
// readOnly connection, fresh destination) once per tree into --out. Each tree's own sanctioned check-only boot then
// runs on its copy, in a separate process under the port-remap preload: Mars/LM use openWorldServer({checkOnly}), Eden
// uses openEdgeServerV1({checkOnly}). Neither binds a port. The tick, head, state hash, rules and boot replay are
// compared. Production processes, data files and ports are never written to, signalled or bound.
//
//   node tools/test-harness/history-boot-compare.mjs --descriptors <dir with successor-<world>-descriptor.json>
//        --baseline <tree> --candidate <tree> --out <scratch dir> [--worlds mars,littlemartians,eden] [--data-root <dir>]
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };

if (args[0] === '--child') {
  // child: one tree, one world, check-only boot on an already-made copy
  const [, tree, key, descriptorPath, dataDir] = args;
  const d = JSON.parse(readFileSync(descriptorPath, 'utf8'));
  // The trees are git checkouts, not Codex's sealed release dirs: the descriptor's inputManifestSHA256 pins that release's
  // <input>/../CONTENT-MANIFEST.json, which a checkout doesn't have (V8 2026-10-11 looked for sim-wt/CONTENT-MANIFEST.json).
  // Drop the seal pin; the comparison itself (tick/head/stateHash/rules/boot on identical copies) is the check here.
  const { inputManifestSHA256: _seal, ...unsealed } = d;
  const common = { ...unsealed, input: tree, dataDir, checkOnly: true };
  let r;
  if (key === 'eden') {
    // Eden's check-only return carries only {boot}; capture the same facts world-server's check-only reports (tick, head,
    // state hash, rules) right after WorldHost.boot(). Same module URL as edge-server's own load(), so the same class.
    const { WorldHost } = await import(pathToFileURL(join(tree, 'apps/server/src/world.ts')).href);
    const boot0 = WorldHost.prototype.boot;
    let facts = null;
    WorldHost.prototype.boot = function (...a) { const b = boot0.apply(this, a); facts ??= { tick: this.engine.world.tick, head: this.seq, stateHash: this.engine.stateHash(), rulesVersion: this.engine.rulesVersion, eventCount: this.db.events(this.worldId).length }; return b; };
    const { openEdgeServerV1 } = await import(pathToFileURL(join(tree, 'tools/core/edge-server.mjs')));
    const f = d.flags ?? {};
    // same option mapping as the production runner (runtime-modern-context-prep-001/successor-world-run.mjs)
    r = { ...(await openEdgeServerV1({ ...common, accountAuth: true, seedObjects: d.objects, localBudget: 0, autonomous: false, quiesceThought: true, officeStairGuards: f.officeStairGuards ?? false, ambient: d.ambient !== false, humanRest: f.humanRest ?? true, provisions: f.provisions ?? true, sequences: f.sequences ?? true, floorGoals: f.floorGoals ?? true, kitchen: f.kitchen ?? true, shore: f.shore ?? true, foodDeliveryId: f.foodDeliveryId, quietLandingCourtesy: f.quietLandingCourtesy ?? true, social: f.social ?? true, approachRetention: f.approachRetention ?? true, closedGoals: f.closedGoals ?? true, activateExpansion: f.activateExpansion ?? true })), ...facts };
  } else {
    const { openWorldServer } = await import(pathToFileURL(join(tree, 'tools/core/multiworld/world-server.mjs')));
    r = await openWorldServer(common);
  }
  process.stdout.write('\nRESULT ' + JSON.stringify(r, (k, v) => (typeof v === 'bigint' ? String(v) : v)) + '\n');
  process.exit(0);
}

const descriptors = resolve(opt('descriptors')), baseline = resolve(opt('baseline')), candidate = resolve(opt('candidate')), out = resolve(opt('out'));
const worlds = opt('worlds', 'mars,littlemartians,eden').split(','), dataRoot = opt('data-root') && resolve(opt('data-root'));
mkdirSync(out, { recursive: true });
const { copySqliteReadOnly } = await import(pathToFileURL(join(candidate, 'tools/core/multiworld/copy-sqlite.mjs')));
const preload = `--import=${join(here, 'port-remap.mjs')}`;
const report = { at: new Date().toISOString(), baseline, candidate, worlds: {} };
for (const key of worlds) {
  const descriptorPath = join(descriptors, `successor-${key}-descriptor.json`);
  const d = JSON.parse(readFileSync(descriptorPath, 'utf8'));
  const runs = {};
  for (const [label, tree] of [['baseline', baseline], ['candidate', candidate]]) {
    const dataDir = join(out, key, label);
    if (existsSync(join(dataDir, 'sim.db'))) throw Error(`${dataDir} already has a copy: use a fresh --out`);
    // one read-only VACUUM copy of production; the second tree gets an APFS clone of that copy (cheap, same bytes)
    // --data-root <dir>: copy from <dir>/<world>/sim.db (an existing read-only backup) instead of the live writer's DB
    if (label === 'baseline') copySqliteReadOnly(join(dataRoot ? join(dataRoot, key) : d.dataDir, 'sim.db'), join(dataDir, 'sim.db'));
    else { mkdirSync(dataDir, { recursive: true }); execFileSync('/bin/cp', ['-c', join(out, key, 'baseline.pristine.db'), join(dataDir, 'sim.db')]); }
    if (label === 'baseline') execFileSync('/bin/cp', ['-c', join(dataDir, 'sim.db'), join(out, key, 'baseline.pristine.db')]);
    const t0 = Date.now();
    const p = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--child', tree, key, descriptorPath, dataDir], { encoding: 'utf8', timeout: 20 * 60_000, env: { ...process.env, NODE_OPTIONS: preload, PORT_REMAP_BASE: process.env.PORT_REMAP_BASE ?? '5400' } });
    const line = p.stdout.split('\n').find((l) => l.startsWith('RESULT '));
    runs[label] = { ms: Date.now() - t0, status: p.status, result: line ? JSON.parse(line.slice(7)) : null, stderr: line ? undefined : p.stderr.slice(-2000) };
  }
  const pick = (r) => r && { tick: r.tick ?? r.boot?.tick, head: r.head, stateHash: r.stateHash, rulesVersion: r.rulesVersion, boot: r.boot, eventCount: r.eventCount };
  const b = pick(runs.baseline.result), c = pick(runs.candidate.result);
  report.worlds[key] = { same: !!b && !!c && JSON.stringify(b) === JSON.stringify(c), baseline: b, candidate: c, runs };
  console.log(key, report.worlds[key].same ? 'SAME' : 'DIFF', JSON.stringify({ baseline: b, candidate: c, errors: [runs.baseline.stderr, runs.candidate.stderr].filter(Boolean).map((s) => s.slice(-400)) }));
}
writeFileSync(join(out, 'history-boot-compare.json'), JSON.stringify(report, null, 1));
