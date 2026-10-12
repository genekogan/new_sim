#!/usr/bin/env node
// Sequential, fresh-world batches; no content edits or automatic baseline approval.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { coreLibrary } from '../../../packages/world-compiler/src/library.ts';
import { WorldModel } from '../../../packages/world-compiler/src/model.ts';
import { planBatches, coverageOf, toRef } from './plan.mjs';
import { gateExit } from './checks.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : null).filter(Boolean));
if (args.approve) throw new Error('Batch catchup never approves baselines. Review per-item evidence explicitly.');
const out = resolve(String(args.out ?? join(root, '.lane/g4/full')));
if (existsSync(join(out, 'report.json'))) throw new Error('G4 output already has evidence; choose a fresh --out directory');
mkdirSync(out, { recursive: true });
const lib = coreLibrary(), model = new WorldModel({ constants: { ground: 'land' }, seed: 'g4-plan' }); model.library = lib;
let defs = lib.all().map((d) => model.resolvedDef(d.ref));
if (args.items) { const refs = String(args.items).split(',').map(toRef); const byRef = new Map(defs.map((d) => [toRef(d.ref), d])); defs = refs.map((ref) => { if (!byRef.has(ref)) throw new Error(`missing ref ${ref}`); return byRef.get(ref); }); }
const plan = planBatches(defs, Number(args['batch-jobs'] ?? 72));
writeFileSync(join(out, 'plan.json'), JSON.stringify({ schema: 'g4-plan/1', library: `${lib.id}@${lib.version}`, ...plan }, null, 2));
console.log(`G4 full coverage: ${plan.requested.length} refs, ${plan.batches.length} batches, ${plan.gaps.length} explicit unqualified refs`);
if (args['plan-only']) process.exit(0);
const items = [...plan.gaps], batches = []; let infrastructure = false;
const save = () => writeFileSync(join(out, 'report.json'), JSON.stringify({ schema: 'g4-coverage/1', approval: 'none: machine catchup only', library: `${lib.id}@${lib.version}`, gpu: batches.map((b) => b.gpu).filter(Boolean).join('; '), coverage: coverageOf(plan.requested, items), batches, items }, null, 1));
save();
for (const [i, refs] of plan.batches.entries()) {
  const dir = join(out, `batch-${String(i + 1).padStart(3, '0')}`); mkdirSync(dir, { recursive: true });
  const argv = ['tools/catalog/g4/g4-render.mjs', '--port', String(args.port ?? 6102), '--out', dir, '--items', refs.join(',')];
  for (const key of ['chrome', 'angle', 'baseline']) if (args[key]) argv.push(`--${key}`, String(args[key]));
  if (args['no-lease']) argv.push('--no-lease');
  console.log(`G4 batch ${i + 1}/${plan.batches.length}: ${refs.length} refs`);
  const child = spawnSync(process.execPath, argv, { cwd: root, encoding: 'utf8', timeout: 240000, maxBuffer: 16 * 1024 * 1024 });
  writeFileSync(join(dir, 'render.log'), (child.stdout ?? '') + (child.stderr ?? '') + (child.error ? `\n${child.error}` : ''));
  const reportFile = join(dir, 'report.json');
  const report = existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, 'utf8')) : null;
  const code = report ? gateExit(report) : 3;
  if (![0, 2].includes(child.status) || code === 3) infrastructure = true;
  batches.push({ batch: i + 1, refs, exit: child.status, gateExit: code, gpu: report?.gpu ?? null, report: relative(out, reportFile) });
  if (report) items.push(...report.items.map((item) => ({ ...item, batch: i + 1, views: item.views.map((v) => ({ ...v, file: join(`batch-${String(i + 1).padStart(3, '0')}`, relative(dir, v.file)) })) })));
  else for (const id of refs) items.push({ id, ok: false, status: 'unqualified', errors: ['batch failed before report; see render.log'], views: [], variants: [], batch: i + 1 });
  // Persist after every batch, including failures. An interrupted run is visibly incomplete.
  save();
  // Continue item failures, stop infrastructure faults; remaining refs stay missing.
  if (infrastructure) break;
}
const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
writeFileSync(join(out, 'sheet.html'), `<!doctype html><meta charset="utf-8"><title>G4 full coverage</title><style>body{font:14px system-ui;background:#111;color:#ddd}img{width:128px;height:128px}.bad{color:#f99}</style><h1>G4 catalogue catchup · no baselines approved</h1><pre>${esc(JSON.stringify(report.coverage, null, 2))}</pre>${report.items.map((it) => `<h2 class="${it.ok ? '' : 'bad'}">${esc(it.id)} · ${it.ok ? 'machine checks passed; unreviewed' : esc(it.status ?? 'failed')}</h2><p>${esc((it.errors ?? []).join('; '))}</p>${it.views.map((v) => `<img loading="lazy" src="${esc(v.file)}" title="${esc(v.label + '/' + v.view)}">`).join('')}`).join('')}`);
const exit = infrastructure ? 3 : gateExit(report); writeFileSync(join(out, 'exit-code'), String(exit));
console.log(JSON.stringify({ ...report.coverage, exit, out })); process.exit(exit);
