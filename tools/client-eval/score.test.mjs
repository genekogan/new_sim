import test from 'node:test';
import assert from 'node:assert/strict';
import { score } from './score.mjs';
const base = { schema: 'eden-client-evaluation/1', attemptId: 'first', source: 'fixture', cohort: 'real-agent' };
test('missing observations cannot certify a scenario', () => {
  const s = score({ ...base, scenarios: ['S1', 'S3'] });
  assert.equal(s.scenarios.S1.status, 'partial');
  assert.equal(s.scenarios.S3.assertions.find(a => a.id === 'dailyBudget').status, 'unrun');
});
test('protocol timing checks do not certify actual agent behavior', () => {
  const s = score({ ...base, cohort: 'scripted-protocol', scenarios: ['S2'], observations: { independentSocialDecision: true, socialWakeSeconds: [1], peopleMemoryAccurate: true } });
  assert.equal(s.scenarios.S2.status, 'fail');
  assert.equal(s.scenarios.S2.assertions[1].status, 'pass');
});
test('first delivery failure remains a failure at the exact 95 percent gate', () => {
  const result = total => score({ ...base, scenarios: ['S1'], observations: { terminalDelivery: { total: 100, within10Seconds: total } }, firstFailure: 'immutable/first.json' });
  assert.equal(result(94).scenarios.S1.status, 'fail');
  assert.equal(result(95).scenarios.S1.status, 'partial');
  assert.equal(result(95).firstFailure, 'immutable/first.json');
});
test('restarts require identity and memory evidence, not merely a restart count', () => {
  assert.equal(score({ ...base, scenarios: ['S5'], observations: { restartCount: 5 } }).scenarios.S5.status, 'partial');
  assert.equal(score({ ...base, scenarios: ['S5'], observations: { restartCount: 5, duplicateAcceptedActs: 1, memoryPreserved: true, digestResumeAccurate: true } }).scenarios.S5.status, 'fail');
});
test('invalid counts and estimated pricing cannot qualify acceptance', () => {
  assert.throws(() => score({ ...base, scenarios: ['S1'], observations: { distinctAttributedFacts: '10' } }), /Invalid numeric/);
  assert.throws(() => score({ ...base, scenarios: ['S4'], observations: { fallbackSeconds: -1 } }), /Invalid numeric/);
  assert.throws(() => score({ ...base, scenarios: ['S1'], observations: { terminalDelivery: { total: 1, within10Seconds: 2 } } }), /Invalid terminal/);
  const s = score({ ...base, scenarios: ['S3'], observations: { actualDailyUSD: .1, dailyBudgetUSD: 3, costBasis: 'estimate' } });
  assert.equal(s.scenarios.S3.assertions.find(a => a.id === 'dailyBudget').status, 'fail');
});
