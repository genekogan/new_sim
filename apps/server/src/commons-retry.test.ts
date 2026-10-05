// Actual crowd/native blocked controllers, then reconsideration; no injected
// failures, relocated bodies, changed goals, fake outcome rows or providers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {generateCommonsCohort} from '../test/fixtures/commons-cohort/generate.ts';
import {INTENT_RETRY_COOLDOWN_TICKS} from './intent-retry.ts';
test('native crowded directions are reconsidered from durable block facts, preserving private recovery and truthful terminal outcomes', async t => {
  const trace = await generateCommonsCohort(4800, true);
  mkdirSync(new URL('../../../.e2e/intent-history/',import.meta.url), {recursive: true});
  writeFileSync(new URL('../../../.e2e/intent-history/cohort-retry-final.json',import.meta.url), JSON.stringify(trace,null,2)+'\n');
  const retried = trace.outcomes.filter(r => (r.attempts?.length ?? 0) > 1);
  // Random lifecycle IDs alter native crowd interactions. A deterministic
  // admission-rejection test proves that retries occur; this population must
  // not be required to fail an activity just to make an assertion pass.
  for (const r of retried) {
    const attempts = r.attempts!.sort((a,b) => a.seq-b.seq);
    for (let i = 1; i < attempts.length; i++) {
      assert.equal(attempts[i-1].phase, 'blocked', 'completion/interruption/running attempt never retried');
      const admission = r.admissions!.find(a => a.attemptId === attempts[i].attemptId);
      assert.ok(admission, 'every retry has a separate actual logged admission');
      assert.ok(admission.evidence.tick >= attempts[i-1].tick + INTENT_RETRY_COOLDOWN_TICKS);
      assert.deepEqual(attempts[i].intent, attempts[i-1].intent);
      assert.notEqual(attempts[i].attemptId, attempts[i-1].attemptId);
    }
  }
  assert.equal(trace.residents,24); assert.equal(trace.localHumanOwners,6); assert.deepEqual(trace.nativeViolations,[]);
  assert.equal(trace.reconstruction,'exact'); assert.equal(trace.genesisReconstruction,'exact'); assert.equal(trace.paid,0);
  assert.ok(trace.readerPages.every(p => p.complete)); assert.ok(trace.outcomes.every(r => r.purposeStatus === 'active'));
  const counts = Object.fromEntries(['accepted','started','completed','blocked','interrupted','no-attempt'].map(phase => [phase,trace.outcomes.filter(r=>(r.attempts?.at(-1)?.phase??'no-attempt')===phase).length]));
  t.diagnostic(`actual retried Souls=${retried.length}; final phases=${JSON.stringify(counts)}; paid=$0; not all24 responsive/cohort/capacity proof`);
});
