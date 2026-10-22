// Gate step V3-bundle (lane BUDGET, 2026-10-22; rules in budget.mjs): measures apps/web/dist, which the gate's V2-build-root
// just built from the candidate, against the reviewed baseline.json. One assertion for the total, one for new chunks and
// one per baseline key, so receipt.json names the chunk that grew. The measurement lands in $SUITE_COVERAGE_DIR/bundle
// (returned as out/suite/bundle), so a reviewed baseline change can be written from a gate run:
//   node tools/test-harness/bundle-budget/budget.mjs --from <gate out>/candidate/out/suite/bundle/current.json --write
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIST, NEW_CHUNK_BYTES, SLACK_BYTES, THRESHOLD_PCT, compare, describe, measure, over, readBaseline } from './budget.mjs';

const baseline = readBaseline();
const current = measure(DIST);
const c = compare(baseline, current);
console.log(describe(c, current));
if (process.env.SUITE_COVERAGE_DIR) {
  const out = join(process.env.SUITE_COVERAGE_DIR, 'bundle');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'current.json'), JSON.stringify(current, null, 1) + '\n');
  writeFileSync(join(out, 'report.txt'), describe(c, current) + '\n');
}
const fix = 'a deliberate change updates tools/test-harness/bundle-budget/baseline.json as its own reviewed commit (budget.mjs --write)';

test(`bundle total within +${THRESHOLD_PCT}% of baseline`, () => {
  const bad = over(baseline.total, current.total, { slack: 0 });
  assert.equal(bad.length, 0, `total over budget; ${fix}:\n${describe(c, current)}`);
});
test(`bundle: no new chunk of ${NEW_CHUNK_BYTES / 1024} KB or more without a baseline entry`, () => {
  const fresh = c.offenders.filter(o => o.kind === 'new');
  assert.equal(fresh.length, 0, `new chunk(s) without a baseline entry; ${fix}:\n${describe({ ...c, offenders: fresh }, current)}`);
});
for (const [key, base] of Object.entries(baseline.chunks)) {
  test(`bundle chunk ${key} within +${THRESHOLD_PCT}% of baseline`, () => {
    const bad = over(base, current.chunks[key], { slack: SLACK_BYTES });
    assert.equal(bad.length, 0, `${key} over budget; ${fix}:\n${bad.map(o => `${o.metric} ${o.base} -> ${o.now} (+${o.pct.toFixed(1)}%)`).join('\n')}`);
  });
}
