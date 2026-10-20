// Runs in the gate (Z3): it counts the planner's work (./work-meter.ts) instead of timing it, so the budgets hold on any CPU.
// The replay is a copy of team/reviews/godmode-authoring-loop-20261015/replay/b1-church-steps.json (B1 church, 6 steps).
// Comparison mode, timing included: GOD_SAFETY_BASELINE=1 [GOD_SAFETY_SAMPLES=15] node --test src/safety-perf.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { meter } from './work-meter.ts';

if (process.env.GOD_SAFETY_BASELINE) registerHooks({load(url, context, next) {
  const loaded = next(url, context);
  if (url.endsWith('/world-compiler/src/compile.ts')) {
    const source = String(loaded.source), baseline = source.replace(/worldBudgetFailure\(world, scratch, [^;]+?\?\? opts\.refuse\?\./, 'opts.refuse?.');
    assert.notEqual(baseline, source, 'baseline must bypass exactly the two S1 guards');
    return {...loaded, source: baseline};
  }
  return loaded;
}});

// Measured 2026-10-20, identical on every run (see the diagnostic). Budgets are about 2x of each step's planning work.
const PLAN_WORK: Record<string, number> = {
  'blockout: nave and towers': 92_000, 'shell: church walls, roof and forecourt': 58_000, 'west front: towers, portal and gable': 243_000,
  'buttresses': 92_000, 'stained-glass windows': 74_000, 'roofline and interior': 68_000, 'far-away batch': 38_000, // measured 46,024 28,855 121,519 46,182 36,810 34,081 18,910
};
test('40 furnished library buildings + church replay: plan latency', {timeout: 240_000}, async t => {
  const {WorldModel, applyBatch, plan, coreLibrary} = await import('./index.ts');
  const genesis = JSON.parse(readFileSync(new URL('../../../worlds/templates/eden-district.json', import.meta.url), 'utf8'));
  const replay = JSON.parse(readFileSync(process.env.GOD_SAFETY_REPLAY ?? new URL('./fixtures/b1-church-steps.json', import.meta.url), 'utf8'));
  const w = new WorldModel({constants: {...genesis.constants, extent: 2000}, seed: 'safety-perf'}); w.library = coreLibrary();
  const act = (ops: unknown[], trusted = false) => {const r = applyBatch(w, {ops}, 'bench', 0, {trusted}); assert.equal(r.result.accepted, true, JSON.stringify(r.result));};
  act([{op: 'world', state: genesis.state}], true);
  for (const batch of genesis.batches) act(batch.ops, true);
  const far = {label: 'far-away batch', ops: [{op: 'place', def: 'core/chair@1', p: [-900, -900]}]}, farBefore = meter(() => plan(w, {ops: far.ops}, 'bench', 0)).work.total, entitiesBefore = w.entities.size;
  for (let i = 0; i < 40; i++) act([{op: 'place', def: 'core/church@1', name: `furnished-${i}`, p: [-800 + (i % 8) * 60, 200 + Math.floor(i / 8) * 60]}]);
  assert.ok([...w.entities.values()].filter(e => e.name?.startsWith('furnished-')).length >= 40);
  const samples = Number(process.env.GOD_SAFETY_SAMPLES ?? 0), rows: {batch: string; work: number}[] = [];
  for (const step of [...replay.steps, far]) {
    const {value: p, work} = meter(() => plan(w, {ops: step.ops}, 'bench', 0)); assert.equal(p.ok, true, JSON.stringify(p));
    const ms: number[] = [];
    for (let i = 0; i < samples + (samples ? 3 : 0); i++) {const at = performance.now(); assert.equal(plan(w, {ops: step.ops}, 'bench', 0).ok, true); const elapsed = performance.now() - at; if (i >= 3) ms.push(elapsed);}
    ms.sort((a,b) => a-b); rows.push({batch: step.label, work: work.total, ...(ms.length ? {p50: +ms[Math.floor(ms.length * .5)].toFixed(3), p95: +ms[Math.min(ms.length-1, Math.floor(ms.length * .95))].toFixed(3)} : {})});
    act(step.ops);
  }
  const farGrowth = rows.at(-1)!.work - farBefore;
  t.diagnostic(JSON.stringify({mode: process.env.GOD_SAFETY_BASELINE ? 'pre-S1-checks-disabled' : 'safety', furnishedBuildings: 40, entities: w.entities.size, samples, rows, far: {entitiesBefore, workBefore: farBefore, growth: farGrowth}}));
  if (process.env.GOD_SAFETY_BASELINE) return;
  assert.deepEqual(rows.map(r => r.batch), Object.keys(PLAN_WORK), 'a budget for every replay step');
  for (const r of rows) assert.ok(r.work <= PLAN_WORK[r.batch], `${r.batch}: planning work ${r.work} > ${PLAN_WORK[r.batch]}`);
});
