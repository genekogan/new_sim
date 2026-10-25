// replay-set + SCORECARD (ROOT-CAUSES §E): frozen scenarios replay the exact original requests; measures, thresholds,
// baseline merge and the no-new-bugs verdict.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadRun } from '../run.mjs';
import { buildReplay } from '../report.mjs';
import { FROZEN, frozenScenario, runMeasures, noNewBugs, mergeBase, renderScorecard, thresholds } from '../scorecard.mjs';
import { FIX, MAIN } from './helpers.mjs';

function frozenCopy(name = MAIN, mutate = null) {
  const root = mkdtempSync(join(tmpdir(), 'pt-score-')); const d = join(root, name);
  cpSync(join(FIX, MAIN), d, { recursive: true });
  if (mutate) { const s = JSON.parse(readFileSync(join(d, 'scenario.json'), 'utf8')); mutate(s); writeFileSync(join(d, 'scenario.json'), JSON.stringify(s)); }
  writeFileSync(join(d, 'replay.json'), JSON.stringify(buildReplay(loadRun(d))));
  return { root, d };
}

test('frozen persona run → scripted replay with the exact original requests, channels and offsets; sequential; no Developer', () => {
  const { d } = frozenCopy();
  const s = frozenScenario(d, { currentScenario: { world: { natives: true } } });
  const orig = loadRun(d).evidence;
  assert.deepEqual(s.director.script.map((e) => [e.seat, e.channel, e.text]), orig.map((e) => [e.seat, e.channel, e.text]));
  assert.deepEqual(s.director.script.map((e) => e.atSec), [30, 90, 150], "offsets from play start, as sent");
  assert.equal(s.director.mode, 'scripted'); assert.equal(s.director.sequential, true); assert.equal(s.review.developer, false);
  assert.equal(s.world.natives, true, 'today\'s scenario default'); assert.equal(s.replayOf, MAIN);
  assert.equal(s.scenarioPath, undefined);
});

test('frozen scripted battery keeps its script verbatim (budgets included)', () => {
  const script = [{ seat: 'pip', atSec: 20, channel: 'chat', text: 'walk over to the pavilion on the commons', budgetSec: 120 }, { seat: 'pip', atSec: 155, channel: 'chat', text: 'sit down', budgetSec: 60 }];
  const { d } = frozenCopy(MAIN, (s) => { s.director = { mode: 'scripted', script }; });
  assert.deepEqual(frozenScenario(d).director.script, script);
});

test('measures, thresholds and the no-new-bugs verdict', () => {
  const m = runMeasures(join(FIX, MAIN));
  assert.equal(m.requests, 3); assert.deepEqual(m.cardResult, { pass: 2, n: 2 }); assert.equal(m.truth.n, 3);
  assert.deepEqual(m.sits, { pip: { requestId: 'r1', ok: true } });
  const worse = structuredClone(m); worse.fidelity.W += 1; worse.physical['no-progress'] += 1; worse.seatH = { pip: { H: 0, n: 3 } };
  const base = { ...structuredClone(m), seatH: { pip: { H: 1, n: 3 } } };
  const v = noNewBugs('basics-x', 'battery', base, [worse, worse]);
  assert.deepEqual(v.filter((c) => c.verdict === 'regression').map((c) => c.check).sort(), ['H pip', 'W', 'no-progress']);
  assert.equal(noNewBugs('x', 'battery', base, [worse, base]).find((c) => c.check === 'W').verdict, 'inconclusive');
  assert.ok(noNewBugs('x', 'persona', base, [base, base]).every((c) => c.verdict === 'ok'));
  const merged = mergeBase([base, worse]); assert.equal(merged.fidelity.W, worse.fidelity.W); assert.equal(merged.seatH.pip.H, 0);
  const t = thresholds([{ label: 'basics-x', kind: 'battery', m }]);
  assert.equal(t.find((x) => x.id === 'sit').ok, true); assert.equal(t.find((x) => x.id === 'card-result').ok, true);
  const md = renderScorecard({ entries: [{ label: 'basics-x', kind: 'battery', base, reps: [worse, worse] }], repeats: 2, baselineName: 'test' });
  assert.match(md, /Verdict: NEW BUGS/); assert.match(md, /\| basics-x \| r2 \|/); assert.match(md, /walk arrival of accepted walks/);
  assert.match(renderScorecard({ entries: [{ label: 'b', kind: 'battery', base, reps: [base, base] }], repeats: 2, baselineName: 't' }), /Verdict: no new bugs\*\*/);
});

test('playtest.mjs replay-set --dry-run prints the plan and runs nothing', () => {
  const { root } = frozenCopy(FROZEN[0].run);
  const cli = join(dirname(fileURLToPath(import.meta.url)), '../../playtest.mjs');
  const out = execFileSync('node', [cli, 'replay-set', '--dry-run', '--runs-root', root, '--only', FROZEN[0].label, '--out', join(root, 'set')], { encoding: 'utf8' });
  assert.match(out, /baseline: the original runs · repeats 2/);
  assert.match(out, /3 requests \(2 card, 1 chat\)/);
  assert.match(out, /chat budget .*"say hi to the duck"/);
  assert.match(out, /basics-1-r1, .*basics-1-r2/);
});
