import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { providerPolicy, requireProviders } from './provider-policy.mjs';
import { writeJson } from './jsonl.mjs';
import { copyRuns } from '../review/test/helpers.mjs';
import { reviewRun as modelReview } from '../review/reviewer.mjs';
import { developRun } from '../review/developer.mjs';
import { reviewRun } from '../playtest.mjs';
const strict = { providers: { allowed: ['codex'] }, seats: [{ id: 's', adapter: 'codex-headless' }], director: { mode: 'scripted' }, review: { mode: 'deterministic' } };
test('Codex-only fails closed for every implicit Claude role and never substitutes missing Codex', () => {
  const p = providerPolicy(strict);
  assert.deepEqual(p.required, ['codex']);
  assert.equal(p.claude, false);
  assert.throws(() => requireProviders(p, { claude: 'installed' }), /codex unavailable/);
  assert.doesNotThrow(() => requireProviders(p, { codex: 'installed' }));
  for (const change of [{ review: {} }, { director: { mode: 'persona' } }, { seats: [{ id: 's' }] }, { god: {} }]) assert.throws(() => providerPolicy({ ...strict, ...change }), /forbids/);
});
test('deterministic review writes actual oracles, metrics and report, with no reviewer/developer model calls', async () => {
  const { main } = copyRuns();
  const scenario = JSON.parse(readFileSync(join(main, 'scenario.json')));
  writeJson(join(main, 'scenario.json'), { ...scenario, ...strict });
  const forbidden = async () => { assert.fail('Claude/model invocation forbidden'); };
  const out = await modelReview({ runDir: main, call: forbidden, log: () => {} });
  assert.ok(out.reviews.length > 0);
  assert.ok(out.reviews.every(r => r.fidelity === 'unresolved'));
  assert.ok(readFileSync(join(main, 'oracles.jsonl'), 'utf8').includes('truthfulness-basic'));
  assert.equal((await developRun({ runDir: main, call: forbidden })).skipped, 'deterministic review: no model developer');
  const metrics = await import('../review/metrics.mjs');
  const report = await import('../review/report.mjs');
  const exit = await reviewRun(main, { reviewer: { reviewRun: opts => modelReview({ ...opts, call: forbidden, log: () => {} }) }, developer: { developRun: forbidden }, metrics, report });
  assert.equal(exit, 0);
  assert.match(readFileSync(join(main, 'REPORT.md'), 'utf8'), /Deterministic oracles/);
  assert.ok(JSON.parse(readFileSync(join(main, 'metrics.json'))).cost);
});

test('draft and incompletely frozen measurement fixtures fail before spending', async () => {
  const { assertMeasurementReady } = await import('./provider-policy.mjs');
  assert.throws(() => assertMeasurementReady({ freeze: { status: 'draft' } }), /draft/);
  assert.throws(() => assertMeasurementReady({ freeze: { status: 'ready' } }), /physicalSha256/);
  assert.throws(() => assertMeasurementReady({ freeze: { status: 'ready', physicalSha256: 'x', model: 'pinned' }, seats: [{ model: null }] }), /model differs/);
  assert.doesNotThrow(() => assertMeasurementReady({ freeze: { status: 'ready', physicalSha256: 'x', model: 'pinned' }, seats: [{ model: 'pinned' }], director: { script: [{ expect: { journey: { readiness: 'ready' } } }] } }));
});
