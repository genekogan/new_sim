// Opt in: GOD_SAFETY_BENCH=1 [GOD_SAFETY_BASELINE=1] node --test src/safety-perf.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

if (process.env.GOD_SAFETY_BASELINE) registerHooks({load(url, context, next) {
  const loaded = next(url, context);
  if (url.endsWith('/world-compiler/src/compile.ts')) {
    const source = String(loaded.source), baseline = source.replace(/worldBudgetFailure\(world, scratch, [^;]+?\?\? opts\.refuse\?\./, 'opts.refuse?.');
    assert.notEqual(baseline, source, 'baseline must bypass exactly the two S1 guards');
    return {...loaded, source: baseline};
  }
  return loaded;
}});

test('40 furnished library buildings + church replay: plan latency', {skip: !process.env.GOD_SAFETY_BENCH, timeout: 240_000}, async t => {
  const {WorldModel, applyBatch, plan, coreLibrary} = await import('./index.ts');
  const genesis = JSON.parse(readFileSync(new URL('../../../worlds/templates/eden-district.json', import.meta.url), 'utf8'));
  const replay = JSON.parse(readFileSync(process.env.GOD_SAFETY_REPLAY ?? '<team>/reviews/godmode-authoring-loop-20261015/replay/b1-church-steps.json', 'utf8'));
  const w = new WorldModel({constants: {...genesis.constants, extent: 2000}, seed: 'safety-perf'}); w.library = coreLibrary();
  const act = (ops: unknown[], trusted = false) => {const r = applyBatch(w, {ops}, 'bench', 0, {trusted}); assert.equal(r.result.accepted, true, JSON.stringify(r.result));};
  act([{op: 'world', state: genesis.state}], true);
  for (const batch of genesis.batches) act(batch.ops, true);
  for (let i = 0; i < 40; i++) act([{op: 'place', def: 'core/church@1', name: `furnished-${i}`, p: [-800 + (i % 8) * 60, 200 + Math.floor(i / 8) * 60]}]);
  assert.ok([...w.entities.values()].filter(e => e.name?.startsWith('furnished-')).length >= 40);
  const samples = Number(process.env.GOD_SAFETY_SAMPLES ?? 15), rows: unknown[] = [];
  for (const step of [...replay.steps, {label: 'far-away batch', ops: [{op: 'place', def: 'core/chair@1', p: [-900, -900]}]}]) {
    const ms: number[] = [];
    for (let i = 0; i < samples + 3; i++) {const at = performance.now(); const p = plan(w, {ops: step.ops}, 'bench', 0); const elapsed = performance.now() - at; assert.equal(p.ok, true, JSON.stringify(p)); if (i >= 3) ms.push(elapsed);}
    ms.sort((a,b) => a-b); rows.push({batch: step.label, p50: +ms[Math.floor(ms.length * .5)].toFixed(3), p95: +ms[Math.min(ms.length-1, Math.floor(ms.length * .95))].toFixed(3)});
    act(step.ops);
  }
  t.diagnostic(JSON.stringify({mode: process.env.GOD_SAFETY_BASELINE ? 'pre-S1-checks-disabled' : 'safety', furnishedBuildings: 40, entities: w.entities.size, samples, rows}));
});
