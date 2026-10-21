// Gate step V3-walk (lane WALK, 2026-10-21; see walk.mjs): one assertion per world, failing with the per-place diff
// when any place of that world is less walkable than baseline/<world>.json. The shard reports land in
// $SUITE_COVERAGE_DIR/walk (the gate returns them under out/suite/walk), so a reviewed baseline change is
//   node tools/test-harness/walk/walk.mjs --from <gate out>/candidate/out/suite/walk --write
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WORLDS, compare, describe, merge, readBaseline, runAudits } from './walk.mjs';

const out = process.env.SUITE_COVERAGE_DIR ? join(process.env.SUITE_COVERAGE_DIR, 'walk') : mkdtempSync(join(tmpdir(), 'walk-gate-'));
let run;
const audits = async () => (run ??= (async () => { const t0 = Date.now(); const r = await runAudits(out, { log: m => console.log(m) }); console.log(`walk audits: ${Math.round((Date.now() - t0) / 1000)} s, ${r.slots} at once, parts in ${out}`); return r; })());

for (const w of WORLDS) {
  test(`walk ${w.name}: no place less walkable than baseline/${w.name}.json`, { timeout: 840_000 }, async () => {
    const r = await audits();
    const mine = r.errors.filter(e => e.startsWith(`${w.name} `));
    assert.equal(mine.length, 0, `walk audit failed:\n${mine.join('\n')}`);
    const parts = readdirSync(out).filter(f => f.startsWith(`${w.name}.`) && /^\.\d+-\d+\.json$/.test(f.slice(w.name.length))).map(f => JSON.parse(readFileSync(join(out, f), 'utf8')));
    const c = compare(readBaseline(w.name), merge(w.name, parts));
    console.log(describe(w.name, c));
    assert.ok(c.ok, `less walkable than the baseline (a deliberate change updates tools/test-harness/walk/baseline, reviewed):\n${describe(w.name, c)}`);
  });
}
