// Actual owned population under the new explicit engine rule. Conditional
// observation checks do not force the random-ID traffic to fail or to improve.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {generateCommonsCohort} from '../test/fixtures/commons-cohort/generate.ts';
import {INTENT_RETRY_COOLDOWN_TICKS} from './intent-retry.ts';
test('versioned native walk blockage preserves owned causal history and exact snapshot/genesis recovery in an actual populated commons',async t=>{
  const file=new URL('../../../.e2e/intent-history/cohort-walk-block-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json',import.meta.url);
  const trace=await generateCommonsCohort(7200,true,true,true);
  mkdirSync(new URL('../../../.e2e/intent-history/',import.meta.url),{recursive:true});writeFileSync(file,JSON.stringify(trace,null,2)+'\n',{flag:'wx'});
  assert.match(trace.rulesVersion,/\+walk-block\/1$/);assert.equal(trace.residents,24);assert.equal(trace.localHumanOwners,6);
  const events=trace.diagnostics!.programEvents;
  for(const r of trace.outcomes){
    for(const a of r.attempts!){
      if('activityId'in a&&a.phase==='blocked'&&a.evidence.kind==='controller'){
        const terminal=events.find(e=>e.id===a.activityId&&e.kind==='failed'&&e.tick===a.tick);assert.ok(terminal,'private block must correspond to a real native failure at the same tick');
      }
    }
    const attempts=[...r.attempts!].sort((a,b)=>a.seq-b.seq);
    for(let i=1;i<attempts.length;i++){
      const prior=attempts[i-1],next=attempts[i],admission=r.admissions!.find(a=>a.attemptId===next.attemptId);assert.ok(admission);
      assert.equal(prior.phase,'blocked');assert.ok(admission.evidence.tick>=prior.tick+INTENT_RETRY_COOLDOWN_TICKS);assert.deepEqual(prior.intent,next.intent);assert.notEqual(prior.attemptId,next.attemptId);
    }
    assert.equal(r.purposeStatus,'active');
  }
  assert.deepEqual(trace.nativeViolations,[]);assert.equal(trace.reconstruction,'exact');assert.equal(trace.genesisReconstruction,'exact');assert.ok(trace.readerPages.every(p=>p.complete));assert.equal(trace.paid,0);
  const counts=Object.fromEntries(['accepted','started','completed','blocked','interrupted','no-attempt'].map(phase=>[phase,trace.outcomes.filter(r=>(r.attempts?.at(-1)?.phase??'no-attempt')===phase).length]));
  const nativeTimeouts=events.filter(e=>e.kind==='failed'&&e.code==='route.blocked');
  t.diagnostic(`actual native timeout events=${nativeTimeouts.length}; requested phases=${JSON.stringify(counts)}; not a causal improvement/cohort/capacity proof; immutable trace=${file.pathname}`);
});
