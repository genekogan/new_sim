import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Adapters collect public observations. Assertions do not enter client prompts.
// Missing evidence never becomes a pass, and estimates never become billing.
export const criteria = {
  S1: ['realTwoHourTour', 'noInventedIds', 'coverageTruth', 'tenFacts', 'terminalDelivery', 'noUnintendedIdle', 'leanWakes', 'noMalformedActs', 'coldMemory'],
  S2: ['realSocialDecision', 'socialLatency', 'peopleMemory'],
  S3: ['real24Hours', 'routineTiming', 'routineZeroModelCalls', 'commitmentKept', 'dailyReview', 'dailyBudget'],
  S4: ['injectedBrokenStream', 'fallbackLatency', 'noUnintendedIdle'],
  S5: ['fiveRestarts', 'noDuplicateActs', 'memoryPreserved', 'digestResume'],
};

function check(id, actual, predicate, evidence) {
  const counts = ['noInventedIds', 'coverageTruth', 'tenFacts', 'noMalformedActs', 'routineZeroModelCalls', 'fiveRestarts', 'noDuplicateActs'];
  const numeric = [...counts, 'realTwoHourTour', 'real24Hours', 'noUnintendedIdle', 'dailyBudget', 'fallbackLatency'];
  if (actual != null && numeric.includes(id) && typeof actual !== 'number') throw new Error(`Invalid numeric evidence: ${id}`);
  if (actual != null && counts.includes(id) && !Number.isInteger(actual)) throw new Error(`Invalid count: ${id}`);
  if (actual != null && ['leanWakes', 'socialLatency'].includes(id) && !Array.isArray(actual)) throw new Error(`Invalid samples: ${id}`);
  if (typeof actual === 'number' && (!Number.isFinite(actual) || (id !== 'coverageTruth' && actual < 0))) throw new Error(`Invalid numeric evidence: ${id}`);
  if (Array.isArray(actual) && actual.some(n => typeof n !== 'number' || !Number.isFinite(n) || n < 0)) throw new Error(`Invalid samples: ${id}`);
  if (id === 'terminalDelivery' && actual != null && (!Number.isInteger(actual.total) || !Number.isInteger(actual.within10Seconds) || actual.total < 0 || actual.within10Seconds < 0 || actual.within10Seconds > actual.total)) throw new Error('Invalid terminal delivery counts');
  return { id, actual: actual ?? null, status: actual == null ? 'unrun' : predicate(actual) ? 'pass' : 'fail', evidence };
}

export function score(run) {
  if (run.schema !== 'eden-client-evaluation/1') throw new Error('Unsupported evidence schema');
  if (!run.attemptId || !run.source || !['real-agent', 'scripted-protocol'].includes(run.cohort)) throw new Error('Attempt/source/cohort required');
  const e = run.observations ?? {};
  const real = run.cohort === 'real-agent';
  const assessments = {
    realTwoHourTour: check('realTwoHourTour', e.durationSeconds, n => real && n >= 7200, 'monotonic start/end; actual model decision log'),
    noInventedIds: check('noInventedIds', e.inventedIdRefusals, n => n === 0, 'all public action verdicts'),
    coverageTruth: check('coverageTruth', e.coverageError, n => Math.abs(n) <= 1, 'model coverage claim versus arrived place ids'),
    tenFacts: check('tenFacts', e.distinctAttributedFacts, n => n >= 10, 'knowledge.md plus unique outcome sources'),
    terminalDelivery: check('terminalDelivery', e.terminalDelivery, n => n.total > 0 && n.within10Seconds / n.total >= .95, 'native terminal timestamp versus client receive timestamp'),
    noUnintendedIdle: check('noUnintendedIdle', e.maxUnintendedIdleSeconds, n => n <= 120, 'idle intervals excluding intentional/protected waits'),
    leanWakes: check('leanWakes', e.wakeFetchBytes, n => n.length > 0 && n.reduce((a, b) => a + b, 0) / n.length < 3000, 'actual fetched response bytes; boot separately accounted'),
    noMalformedActs: check('noMalformedActs', e.malformedCapabilityRefusals, n => n === 0, 'all model commands and public verdicts'),
    coldMemory: check('coldMemory', e.coldMemoryReportAccurate, n => real && n === true, 'fresh model session answer corroborated from files and receipts'),
    realSocialDecision: check('realSocialDecision', e.independentSocialDecision, n => real && n === true, 'independent client decision, no observer corrective act'),
    socialLatency: check('socialLatency', e.socialWakeSeconds, n => n.length > 0 && n.every(x => x < 5), 'speech/invite receive to model wake'),
    peopleMemory: check('peopleMemory', e.peopleMemoryAccurate, n => n === true, 'people file versus actual public interaction'),
    real24Hours: check('real24Hours', e.durationSeconds, n => real && n >= 86400, 'real elapsed monotonic time, not accelerated world clock'),
    routineTiming: check('routineTiming', e.routinesOnTime, n => n === true, 'predeclared timing tolerance and world-clock trace'),
    routineZeroModelCalls: check('routineZeroModelCalls', e.routineModelCalls, n => n === 0, 'calls attributable to routine step execution'),
    commitmentKept: check('commitmentKept', e.conversationCommitmentKept, n => real && n === true, 'actual conversation commitment and corroborated arrival'),
    dailyReview: check('dailyReview', e.dailyReviewProgress, n => real && n === true, 'review decision and changed measurable goals'),
    dailyBudget: check('dailyBudget', e.actualDailyUSD, n => e.costBasis === 'verified-billing' && Number.isFinite(e.dailyBudgetUSD) && n <= e.dailyBudgetUSD, 'verified pricing/usage; list-price estimate alone insufficient'),
    injectedBrokenStream: check('injectedBrokenStream', e.brokenStreamInjected, n => n === true, 'fault proxy log'),
    fallbackLatency: check('fallbackLatency', e.fallbackSeconds, n => n <= 40, 'fault onset to first successful wait fallback'),
    fiveRestarts: check('fiveRestarts', e.restartCount, n => n >= 5, 'owned live process death and distinct restart identities'),
    noDuplicateActs: check('noDuplicateActs', e.duplicateAcceptedActs, n => n === 0, 'receipt/idempotency audit across uncertain delivery'),
    memoryPreserved: check('memoryPreserved', e.memoryPreserved, n => n === true, 'facts and queue before/after restart'),
    digestResume: check('digestResume', e.digestResumeAccurate, n => n === true, 'public resume digest against event log'),
  };
  const scenarios = Object.fromEntries((run.scenarios ?? []).map(id => {
    if (!criteria[id]) throw new Error(`Unknown scenario ${id}`);
    const assertions = criteria[id].map(c => assessments[c]);
    return [id, { status: assertions.some(a => a.status === 'fail') ? 'fail' : assertions.every(a => a.status === 'pass') ? 'pass' : 'partial', assertions }];
  }));
  return { schema: 'eden-client-score/1', attemptId: run.attemptId, retestOf: run.retestOf ?? null, source: run.source, cohort: run.cohort, scenarios, usage: run.usage ?? null, firstFailure: run.firstFailure ?? null };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: node score.mjs evidence.json new-score.json');
  writeFileSync(output, `${JSON.stringify(score(JSON.parse(readFileSync(input, 'utf8'))), null, 2)}\n`, { flag: 'wx' });
}
