import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {generateOwnedHelm} from '../test/fixtures/owned-helm/generate.ts';
test('two invited human-owned Souls compile ordinary boat directions, acquire helm explicitly, share native travel, hand over control and replay the moving owned head',async t=>{
  const proof=await generateOwnedHelm();assert.equal(proof.ownedSouls,2);assert.equal(proof.compilerCalls,9);assert.equal(proof.terminals.length,9);assert.equal(proof.paidUsd,0);
  const dir=new URL('../../../.e2e/owned-helm/',import.meta.url);mkdirSync(dir,{recursive:true});
  const out=new URL('owned-'+new Date().toISOString().replaceAll(':','-')+'.json',dir);writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});t.diagnostic('Actual owned helm proof: '+out.pathname);
});
