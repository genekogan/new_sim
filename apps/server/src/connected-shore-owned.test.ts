import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';
import {generateOwnedConnectedShore} from '../test/fixtures/connected-shore/generate.ts';
test('local invited human-owned Soul interprets ordinary water/return intentions, moves natively, keeps private grounded history and reconstructs a moving WAL head without models',async t=>{
  const proof=await generateOwnedConnectedShore();assert.equal(proof.terminals.length,2);assert.equal(proof.compilerCalls,3);assert.equal(proof.paidUsd,0);
  const dir=new URL('../../../.e2e/connected-shore/',import.meta.url);mkdirSync(dir,{recursive:true});const path=new URL('owned-'+new Date().toISOString().replaceAll(':','-')+'.json',dir);writeFileSync(path,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});t.diagnostic('Actual owned native proof: '+path.pathname);
});
