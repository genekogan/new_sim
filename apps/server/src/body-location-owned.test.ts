import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {generateOwnedHelm} from '../test/fixtures/owned-helm/generate.ts';
test('two owned Souls, paired agents and compiler observe the actual body/container/region through ordinary boating while the independent kernel place relation stays intact',async t=>{
  const p=await generateOwnedHelm({bodyLocationV1:true});assert.equal(p.contract,'core-owned-body-location-probe/1');assert.equal(p.groundedBodyCompilerCalls,9);assert.equal(p.unavailableCompilerCalls,1);assert.equal(p.compilerCalls,10);assert.equal(p.terminals.length,9);
  const samples=p.locationSamples as {owner:string;stage:string;location:any;where:string;semanticAt:string}[];assert.ok(samples.length>=12);
  for(const owner of ['alice','bob']){
    const aboard=samples.find(s=>s.owner===owner&&s.stage==='underway')!;assert.ok(aboard);assert.equal(aboard.location.region.id,'shore-water');assert.equal(aboard.location.occupancy.passenger.phase,'seated');assert.equal(aboard.location.shore,null);assert.match(aboard.where,/^aboard /);assert.equal(aboard.semanticAt,'commons');
    const back=samples.find(s=>s.owner===owner&&s.stage==='returned')!;assert.equal(back.location.occupancy,null);assert.equal(back.location.shore,null);assert.doesNotMatch(back.where,/aboard|water|boarding|leaving/);
  }
  const dir=new URL('../../../.e2e/body-location/',import.meta.url);mkdirSync(dir,{recursive:true});const out=new URL('owned-'+new Date().toISOString().replaceAll(':','-')+'.json',dir);writeFileSync(out,JSON.stringify(p,null,2)+'\n',{flag:'wx'});t.diagnostic('Actual owned body-location proof: '+out.pathname);
});
