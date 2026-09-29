#!/usr/bin/env node
// Explicit serialized performance acceptance (LM-152). Run on an otherwise idle host before release.
// It keeps the former parallel-test thresholds unchanged; it is intentionally outside npm run gate.
//   node deploy/perf-stress-budget.mjs
import assert from 'node:assert/strict';
import { perfStress } from './perf-stress.mjs';
import { HISTORY_YEARS, loadCampusYear } from '../engine/campus/history.ts';
import { loadCampusFile } from '../engine/campus/history-node.ts';
import { buildGrids } from '../engine/spatial/grid.ts';

perfStress({ planner: 'corridor', profile: false }); // unchanged JIT warm-up
const exact = perfStress({ planner: 'exact', profile: false });
const corridor = perfStress({ planner: 'corridor', profile: false });
console.log(JSON.stringify({ exact, corridor }, null, 2));
assert.equal(exact.violations, 0);
assert.equal(corridor.violations, 0);
assert.equal(exact.stateHash, '5c3a3355257850f2316b92902451c144981486262211d86de4881047ca8a194e');
assert.ok(exact.maxMs <= 250, `exact max tick ${exact.maxMs.toFixed(1)} ms`);
assert.ok(corridor.maxMs <= 120, `corridor max tick ${corridor.maxMs.toFixed(1)} ms`);
assert.ok(exact.meanMs <= 3 && corridor.meanMs <= 3, `mean exact ${exact.meanMs} / corridor ${corridor.meanMs} ms`);
console.log('PASS: unchanged stress-30 performance budgets (250/120 ms peak, 3 ms mean), pinned state and zero violations');

// The former campus-history grid timing assertion, unchanged and warmed once per year.
for (const year of HISTORY_YEARS) {
  const { base } = loadCampusYear(year, loadCampusFile(year));
  buildGrids(base, 0.1);
  const started = performance.now();
  const grid = buildGrids(base, 0.1).levels.get(0);
  const ms = performance.now() - started;
  console.log(JSON.stringify({ year, gridMs: ms, cells: grid.nx * grid.nz }));
  assert.ok(ms < 1000, `${year} grid ${ms} ms`);
}
console.log('PASS: unchanged historical-year grid build budget (<1000 ms per year)');
