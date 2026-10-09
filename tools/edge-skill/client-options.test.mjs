import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {liveOptions} from './eden-agent.mjs';
test('ordinary subscribed live requires no cohort flag; optional 24h/week durations parse without launching inference',t=>{
 const folder=mkdtempSync(join(realpathSync(tmpdir()),'eden-options-'));const before=process.env.PATH;writeFileSync(join(folder,'claude'),'synthetic existence only');process.env.PATH=folder;t.after(()=>{process.env.PATH=before;rmSync(folder,{recursive:true,force:true});});
 assert.equal(liveOptions([]).runSeconds,0);assert.equal(liveOptions(['--run-seconds','86400']).runSeconds,86400);assert.equal(liveOptions(['--run-seconds','604800']).runSeconds,604800);assert.throws(()=>liveOptions(['--run-seconds','-1']),/duration/);assert.equal(liveOptions(['--run-seconds','6','--unknown-billing-cohort','true']).unknownBillingCohort,true);
});
