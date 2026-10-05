// Bounded active population qualification, not a real cohort/capacity pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateCommonsCohort} from '../test/fixtures/commons-cohort/generate.ts';
import {writeFileSync,mkdirSync} from 'node:fs';
test('24 invited local Souls retain exact directed targets with fault-free native ticks and complete private pages; saved/genesis reconstruction agrees',async t=>{
  const f=await generateCommonsCohort();
  assert.equal(f.localHumanOwners,6);assert.equal(f.residents,24);assert.equal(f.compilerCalls,24);assert.equal(f.measuredTicks,3600);
  assert.deepEqual(f.nativeViolations,[]);assert.equal(f.paid,0);assert.equal(f.reconstruction,'exact');assert.equal(f.genesisReconstruction,'exact');
  assert.ok(f.samples.some(s=>s.moving>0),'real simultaneous native movement occurs');assert.equal(f.readerPages.length,24);assert.ok(f.readerPages.every(p=>p.complete));
  assert.ok(f.outcomes.every(r=>['commons-pavilion','commons-deck','commons'].includes(r.interpretedTarget!)),'no invented target silently becomes any');
  assert.ok(f.outcomes.every(r=>r.purposeStatus==='active'),'attempt terminal outcomes never fulfil a broader purpose');
  const completed=f.outcomes.filter(r=>r.phases.includes('completed')).length,blocked=f.outcomes.filter(r=>r.phases.includes('blocked')).length,started=f.outcomes.filter(r=>r.phases.includes('started')).length,noAttempt=f.outcomes.filter(r=>r.phases.length===0).length;
  // Durable causal trace: no golden poses, corrected population, hidden crowd
  // failures, timed agenda or reduced resident count to make the test pass.
  mkdirSync(new URL('../../../.e2e/intent-history/',import.meta.url),{recursive:true});
  writeFileSync(new URL('../../../.e2e/intent-history/cohort-canonical-targets.json',import.meta.url),JSON.stringify(f,null,2)+'\n');
  t.diagnostic(`24actual Souls/6localowners; requested completed=${completed},blocked=${blocked},started=${started},no-attempt=${noAttempt}; tick=${f.head.tick}; mean=${f.timing.meanMs.toFixed(3)}ms,p95=${f.timing.p95Ms.toFixed(3)}ms; snapshot+genesis exact; paid=$0; NOT all24-responsive/cohort/lifetime proof`);
});
