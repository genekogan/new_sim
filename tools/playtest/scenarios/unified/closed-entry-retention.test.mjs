import test from 'node:test';import assert from 'node:assert/strict';import{execFileSync}from'node:child_process';import{sha256}from'../../lib/hash.mjs';import{validateClosedEntryDiff,normalizedBindingProof,CLOSED_ENTRY_FROM}from'./closed-entry-retention.mjs';
test('closed-entry retention pins the exact null-interior patch and rejects unrelated runtime or oracle changes',()=>{
 const runtime='apps/server/src/god/nav.ts',to='37960dacd46258a2ff595607c637516a802137f0';
 const git=(...a)=>execFileSync('git',a,{encoding:'utf8'});const changed=git('diff','--name-only',CLOSED_ENTRY_FROM,to).trim().split('\n').sort(),diff=git('diff',CLOSED_ENTRY_FROM,to),runtimeDiff=git('diff',CLOSED_ENTRY_FROM,to,'--',runtime),proof={changedFiles:changed,fullDiffSha256:sha256(diff),runtimeDiffSha256:sha256(runtimeDiff)};
 assert.doesNotThrow(()=>validateClosedEntryDiff(proof,{changed,diff,runtimeDiff}));
 for(const path of ['tools/playtest/review/journey-oracles.mjs','tools/world-launcher/soul/eden.mjs','worlds/templates/mars-two.json','apps/server/src/god/ground-host.ts']){const bad=[...changed,path].sort();assert.throws(()=>validateClosedEntryDiff({...proof,changedFiles:bad},{changed:bad,diff,runtimeDiff}));}
 assert.throws(()=>validateClosedEntryDiff({...proof,fullDiffSha256:sha256(diff+'changed')},{changed,diff:diff+'changed',runtimeDiff:runtimeDiff+'changed'}));
});
test('native parity normalization permits only the fresh campfire actor, not routes or target identities',()=>{
 const a=[{to:[0,0],caps:[{id:'walk:hall'}],plans:{fire:{steps:[{verb:'mars:campfire_circle',params:{actors:['h_before'],fire:'actual-fire'}}]},walk:{steps:[{verb:'walk_to',params:{to:[1,2]}}]}}}];const b=structuredClone(a);b[0].plans.fire.steps[0].params.actors=['h_after'];assert.deepEqual(normalizedBindingProof(a),normalizedBindingProof(b));
 b[0].plans.walk.steps[0].params.to=[3,4];assert.notDeepEqual(normalizedBindingProof(a),normalizedBindingProof(b));b[0].plans.fire.steps[0].params.actors=['h_a','h_b'];assert.throws(()=>normalizedBindingProof(b));
});
