#!/usr/bin/env node
// Lane WALK (2026-10-21): walkability is a release-gate invariant. 3.59.1's pad re-cut added ~74 destinations no Soul
// could walk to and floated a building 6.6 m, and only a hand audit caught it. The gate step V3-walk
// (walk-gate.test.mjs) runs the candidate's own walk audit (apps/server/src/god/walk-audit.ts: lane NAV's connectivity,
// GodNav walk goals, root-thing heights) on fixed fixture copies of eden-2026, bench-eden and bench-hamlet
// (fixtures/, made by mkfixture.py: geometry kept, tokens / accounts / comms emptied) and on a fresh Eden 2026 genesis,
// and fails when any place got worse than the checked-in baseline/<world>.json. Lowering or raising the baseline
// is an explicit, reviewed change of those files:
//   node tools/test-harness/walk/walk.mjs                 audit this tree, print the comparison (about 1 min on the laptop)
//   node tools/test-harness/walk/walk.mjs --write         ... and write the results as the new baseline
//   node tools/test-harness/walk/walk.mjs --from <dir>    compare / --write from a gate's reports (out/suite/walk)
//   ... --world fuzz,bench-hamlet                         only these worlds
// "Worse" per place (the top segment of a thing's path, e.g. hillside-home-7): more bad destinations (not walkable both
// ways: nav.disconnected / nav.one-way / nav.no-standing-room), more one-ways, more goalless things (no walk goal at all),
// more floating root things, or a float that rose by more than FLOAT_RISE_M.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = fileURLToPath(new URL('.', import.meta.url));
export const ROOT = resolve(HERE, '../../..');
export const AUDIT = 'apps/server/src/god/walk-audit.ts';
export const FLOAT_RISE_M = 0.3;
export const METRICS = ['bad', 'oneWay', 'goalless', 'float', 'unusable'];
/** The worlds the gate walks: a fixture copy (fixtures/<name>.db.gz) or a genesis template, and its spatial shards. */
export const WORLDS = [
  { name: 'eden-2026', db: 'fixtures/eden-2026.db.gz', shards: 3 },
  { name: 'bench-eden', db: 'fixtures/bench-eden.db.gz', shards: 3 },
  { name: 'eden-2026-genesis', genesis: 'worlds/templates/eden-2026.json', shards: 3 },
  { name: 'bench-hamlet', db: 'fixtures/bench-hamlet.db.gz', shards: 1 },
  // lane BS3F: the generated BUILDSAFE world (fuzz-world.mjs), also scored for seats and beds a Soul cannot use
  { name: 'fuzz', fuzz: 'tools/test-harness/walk/fuzz-world.mjs', use: true, shards: 3 },
];
const SHARD_RSS_GB = 2.6;   // measured 2.1 GB peak for an eden-2026 shard

/** Merge one world's shard parts (walk-audit.ts WalkPart) into a report: totals, per-place counts, the failing items. */
export function merge(name, parts) {
  if (!parts.length) throw Error(`${name}: no audit parts`);
  const n = parts[0].shard[1], seen = new Set(parts.map(p => p.shard[0]));
  if (parts.some(p => p.shard[1] !== n || p.name !== name) || seen.size !== n || parts.length !== n) throw Error(`${name}: incomplete or mixed shard parts`);
  const bad = parts.flatMap(p => p.bad).sort(cmp), goalless = parts.flatMap(p => p.goalless).sort(cmp), floats = parts.flatMap(p => p.floats).sort(cmp);
  const unusable = parts.some(p => p.unusable) ? parts.flatMap(p => p.unusable ?? []).sort(cmp) : null;
  const places = {}, bump = (place, k) => { const o = (places[place] ??= {}); o[k] = (o[k] ?? 0) + 1; };
  for (const [code, , place] of bad) { bump(place, 'bad'); if (code === 'nav.one-way') bump(place, 'oneWay'); }
  for (const [, place] of goalless) bump(place, 'goalless');
  for (const [, , place] of floats) bump(place, 'float');
  for (const [, , place] of unusable ?? []) bump(place, 'unusable');
  const code = c => bad.filter(b => b[0] === c).length;
  return {
    schemaVersion: 1, name, worldId: parts[0].worldId, auditVersion: parts[0].version,
    totals: { dests: sum(parts, 'dests'), bad: bad.length, disconnected: code('nav.disconnected'), oneWay: code('nav.one-way'), noRoom: code('nav.no-standing-room'), goalless: goalless.length, roots: sum(parts, 'roots'), floats: floats.length, ...(unusable ? { unusable: unusable.length } : {}) },
    places: Object.fromEntries(Object.keys(places).sort().map(k => [k, places[k]])), bad, goalless, floats, ...(unusable ? { unusable } : {}),
  };
}
const sum = (a, k) => a.reduce((s, x) => s + x[k], 0);
const cmp = (a, b) => { const x = a.join('\t'), y = b.join('\t'); return x < y ? -1 : x > y ? 1 : 0; };

/** Compare a world's report with its baseline. Any place worse on any metric is a regression (with the new items). */
export function compare(base, cand) {
  const regressions = [], improved = [];
  const items = (r, metric, place) => metric === 'goalless' ? r.goalless.filter(g => g[1] === place).map(g => `goalless ${g[0]}`)
    : metric === 'float' ? r.floats.filter(f => f[2] === place).map(f => `float ${f[0]}`)
    : metric === 'unusable' ? (r.unusable ?? []).filter(u => u[2] === place).map(u => `${u[0]} ${u[1]}`)
    : r.bad.filter(b => b[2] === place && (metric === 'bad' || b[0] === 'nav.one-way')).map(b => `${b[0]} ${b[1]}`);
  for (const place of new Set([...Object.keys(base.places), ...Object.keys(cand.places)])) {
    for (const metric of METRICS) {
      const was = base.places[place]?.[metric] ?? 0, now = cand.places[place]?.[metric] ?? 0;
      if (now > was) { const old = new Set(items(base, metric, place)); regressions.push({ place, metric, was, now, added: items(cand, metric, place).filter(i => !old.has(i)) }); }
      else if (now < was) improved.push({ place, metric, was, now });
    }
  }
  const before = new Map(base.floats.map(f => [f[0], f[1]]));
  for (const [path, gap, place] of cand.floats) {
    const was = before.get(path);
    if (was !== undefined && gap > was + FLOAT_RISE_M) regressions.push({ place, metric: 'float-rise', was, now: gap, added: [`float ${path} +${was} -> +${gap} m`] });
  }
  regressions.sort((a, b) => (a.place < b.place ? -1 : a.place > b.place ? 1 : a.metric < b.metric ? -1 : 1));
  return { ok: regressions.length === 0, regressions, improved, totals: { was: base.totals, now: cand.totals } };
}

/** Plain lines for a failure message / log: the per-place diff. */
export function describe(name, c) {
  const t = c.totals, row = k => `${k} ${t.was[k]} -> ${t.now[k]}`;
  const lines = [`${name}: ${['bad', 'oneWay', 'goalless', 'floats', ...(t.now.unusable !== undefined ? ['unusable'] : []), 'dests'].map(row).join(', ')}`];
  for (const r of c.regressions) lines.push(`  WORSE ${r.place} ${r.metric} ${r.was} -> ${r.now}${r.added.length ? ': ' + r.added.slice(0, 12).join('; ') + (r.added.length > 12 ? `; ... +${r.added.length - 12} more` : '') : ''}`);
  if (c.improved.length) lines.push(`  better in ${c.improved.length} place/metric(s) (lower the baseline: walk.mjs --write): ${c.improved.slice(0, 8).map(i => `${i.place} ${i.metric} ${i.was}->${i.now}`).join(', ')}`);
  return lines.join('\n');
}

export function readBaseline(name) { return JSON.parse(readFileSync(join(HERE, 'baseline', `${name}.json`), 'utf8')); }
/** One item per line, so a baseline change reads as a per-destination diff in review. */
export function writeBaseline(report) {
  const { bad, goalless, floats, unusable, places, ...head } = report;
  const list = a => a.length ? '[\n' + a.map(x => '    ' + JSON.stringify(x)).join(',\n') + '\n  ]' : '[]';
  const text = '{\n' + Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n') + '\n'
    + `  "places": {\n${Object.entries(places).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n')}\n  },\n`
    + `  "bad": ${list(bad)},\n  "goalless": ${list(goalless)},\n  "floats": ${list(floats)}${unusable ? `,\n  "unusable": ${list(unusable)}` : ''}\n}\n`;
  mkdirSync(join(HERE, 'baseline'), { recursive: true });
  writeFileSync(join(HERE, 'baseline', `${report.name}.json`), text);
}

/** Run every world's shards as separate processes (bounded by cores and memory); parts land in outDir. */
export async function runAudits(outDir, { root = ROOT, worlds = WORLDS, log = () => {} } = {}) {
  mkdirSync(outDir, { recursive: true });
  if (!existsSync(join(root, AUDIT))) throw Error(`this tree has no ${AUDIT}`);
  const jobs = worlds.flatMap(w => Array.from({ length: w.shards }, (_, k) => ({ w, k })));
  const slots = Math.max(1, Math.min(cpus().length, Math.floor(totalmem() / 2 ** 30 / SHARD_RSS_GB), jobs.length));
  const errors = []; let next = 0;
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;   // the audits are plain processes, not node:test children
  const one = ({ w, k }) => new Promise(done => {
    const out = join(outDir, `${w.name}.${k}-${w.shards}.json`), t0 = Date.now();
    const src = [...(w.db ? ['--db', resolve(HERE, w.db)] : w.fuzz ? ['--fuzz', join(root, w.fuzz)] : ['--genesis', join(root, w.genesis)]), ...(w.use ? ['--use'] : [])];
    const child = spawn(process.execPath, ['--max-old-space-size=6000', join(root, AUDIT), ...src, '--name', w.name, '--shard', `${k}/${w.shards}`, '--out', out], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'], env });
    let err = ''; child.stderr.on('data', b => { err = (err + b).slice(-4000); });
    child.on('close', code => { log(`${w.name} ${k}/${w.shards} exit ${code} ${Math.round((Date.now() - t0) / 1000)} s ${err.trim().split('\n').at(-1) ?? ''}`); if (code !== 0) errors.push(`${w.name} ${k}/${w.shards} exit ${code}: ${err.slice(-1500)}`); done(); });
  });
  await Promise.all(Array.from({ length: slots }, async () => { while (next < jobs.length) await one(jobs[next++]); }));
  return { errors, slots };
}

export function readReports(dir, worlds = WORLDS) {
  const files = readdirSync(dir).filter(f => f.endsWith('.json'));
  return Object.fromEntries(worlds.map(w => [w.name, merge(w.name, files.filter(f => f.startsWith(`${w.name}.`) && /\.\d+-\d+\.json$/.test(f.slice(w.name.length))).map(f => JSON.parse(readFileSync(join(dir, f), 'utf8'))))]));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2), from = a.includes('--from') ? resolve(a[a.indexOf('--from') + 1]) : null;
  const dir = from ?? join(ROOT, '.lane/walk', new Date().toISOString().replace(/[:.]/g, '-'));
  const only = a.includes('--world') ? a[a.indexOf('--world') + 1].split(',') : null, worlds = only ? WORLDS.filter(w => only.includes(w.name)) : WORLDS;
  if (!from) { const r = await runAudits(dir, { worlds, log: m => console.log(m) }); if (r.errors.length) { console.error(r.errors.join('\n')); process.exit(1); } }
  const reports = readReports(dir, worlds);
  let worse = false;
  for (const [name, rep] of Object.entries(reports)) {
    if (a.includes('--write')) { writeBaseline(rep); console.log(`wrote baseline/${name}.json: ${JSON.stringify(rep.totals)}`); continue; }
    const c = compare(readBaseline(name), rep); worse ||= !c.ok; console.log(describe(name, c));
  }
  console.log(a.includes('--write') ? `baseline written from ${dir}` : worse ? 'WALK WORSE than the baseline' : 'walk: no place worse than the baseline');
  process.exit(worse ? 1 : 0);
}
