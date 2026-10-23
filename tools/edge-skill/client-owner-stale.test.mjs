// 1.9.10 (ACCEPT2 brief 7, A27 c1 04:20:59): owner "stroll through the gardens"; the mind queued "take a walk through the
// park", an earlier owner request word for word, and the Soul walked to the park. Bar: a new owner request never executes
// a step from an earlier request.
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {guardStaleOwnerSteps,priorOwnerRequests} from './client-owner-stale.mjs';
const replies=[
 {id:'req-park',text:'take a walk through the park, then come back',queue:{id:'req-park',steps:[{act:'take a walk through the park',receipt:{capability:'stroll:land-park-specimens'}}]}},
 {id:'req-bow',text:'give a little bow',queue:{id:'wake-1',steps:[{act:'take a nap'}]}},
];
test('A27 replay: an earlier request\'s step is replaced by the new request\'s own words',()=>{
 const g=guardStaleOwnerSteps([{act:'take a walk through the park',params:{}}],'stroll through the gardens',priorOwnerRequests(replies,'req-gardens'));
 assert.deepEqual(g.replaced,['take a walk through the park']);assert.equal(g.steps[0].act,'stroll through the gardens');assert.match(g.line,/earlier request/);
});
test('an earlier request\'s world action id is caught too',()=>{
 const g=guardStaleOwnerSteps([{act:'stroll:land-park-specimens'}],'stroll through the gardens',priorOwnerRequests(replies,'req-gardens'));
 assert.equal(g.steps[0].act,'stroll through the gardens');
});
test('steps that match the new request, fresh steps, and a repeated request are left alone',()=>{
 const prior=priorOwnerRequests(replies,'req-new');
 for(const [step,text] of [['take a walk through the park','go for a walk in the park again'],['walk to the bandstand','stroll through the gardens'],['give a little bow','give a little bow']])
  assert.deepEqual(guardStaleOwnerSteps([{act:step}],text,prior).replaced,[],step);
 assert.deepEqual(guardStaleOwnerSteps([{say:'hello'},{act:'sit down'}],'stroll through the gardens',prior).replaced,[]);
});
test('a mind queue attached to an earlier request is not counted as that request\'s step',()=>{
 assert.deepEqual(priorOwnerRequests(replies,'x')[1].acts,[]);
});
test('the live owner wake applies the guard before dispatch',()=>{
 const src=readFileSync(new URL('./eden-agent.mjs',import.meta.url),'utf8');
 assert.match(src,/if\(own&&steps\.length\)\{const stale=guardStaleOwnerSteps\(steps,own\.text,priorOwnerRequests\(readJSONL\(LIVE\.replies\),own\.id\)\)/);
});

test('replacing a stale body step drops the old target duration guard protection and repair identity',()=>{
 const old={act:'take a walk through the park',params:{with:'s_old'},targetSoul:{id:'s_old'},for:'3m',until:{event:'old-event'},if:{place:'park'},protected:true,fixes:'old-step',identityBasis:'someone'};
 const g=guardStaleOwnerSteps([old],'stroll through the gardens',priorOwnerRequests(replies,'req-gardens'));
 assert.deepEqual(g.steps,[{act:'stroll through the gardens',params:{},staleReplaced:old.act}]);
 assert.deepEqual(old.targetSoul,{id:'s_old'},'the historical step itself stays unchanged');
});
