import test from 'node:test';
import assert from 'node:assert/strict';
import {auditPublicEffects} from './effect-audit.mjs';
const effect=(id,type='speech',operationId='op')=>({id,type,operationId,actor:'a',evidence:['native/'+id]});
const audit=(effectIds=['s','member'])=>({coverageComplete:true,evidence:['scoped-native-export'],logicalWrites:[{id:'write',actor:'a',effectIds,expectedCardinality:{speech:1,membership:1},evidence:['requests/write'],cardinalityEvidence:['endpoint-contract']}],crossKeyReview:{status:'pass',evidence:['review/all-request-keys']}});
test('distinct legitimate effect kinds from one operation are not replay duplication',()=>{
 const effects=[effect('s'),effect('member','membership')];
 assert.equal(auditPublicEffects(effects,true,audit()).status,'pass');
 assert.equal(auditPublicEffects([...effects,effects[0]],true,audit()).status,'pass','same native effect observed twice counts once');
 assert.equal(auditPublicEffects(effects,true,undefined).status,'unknown','operation IDs alone cannot certify no duplicate intent');
});
test('same intended write under new keys can duplicate; repeated names/text alone cannot prove it',()=>{
 const effects=[effect('one','speech','key1'),effect('two','speech','key2')],a=audit(['one','two']);
 assert.equal(auditPublicEffects(effects,true,a).status,'fail');
 a.logicalWrites=[...a.logicalWrites,{...a.logicalWrites[0],id:'another-write',effectIds:['two']}];a.logicalWrites[0].effectIds=['one'];
 assert.equal(auditPublicEffects(effects,true,a).status,'pass','separately source-cited intended writes can each speak');
 a.crossKeyReview={status:'fail',evidence:['review/repeated-intent']};assert.equal(auditPublicEffects(effects,true,a).status,'fail');
});
test('missing native coverage, endpoint mapping or cross-key review never passes',()=>{
 const effects=[effect('s'),effect('member','membership')];
 assert.equal(auditPublicEffects(effects,false,audit()).status,'unknown');
 for(const change of [{coverageComplete:false},{evidence:[]},{crossKeyReview:{status:'pass',evidence:[]}}])assert.equal(auditPublicEffects(effects,true,{...audit(),...change}).status,'unknown');
 const a=audit();a.logicalWrites[0].cardinalityEvidence=[];assert.equal(auditPublicEffects(effects,true,a).status,'unknown');
 assert.equal(auditPublicEffects([...effects,effect('unmapped')],true,audit()).status,'unknown');
 assert.equal(auditPublicEffects(effects,true,audit(['s','missing'])).status,'unknown');
 const partial=audit();delete partial.logicalWrites[0].expectedCardinality.membership;assert.equal(auditPublicEffects(effects,true,partial).status,'unknown');
});
test('contradictory native authorship fails and missing evidence cannot hide a proven duplicate',()=>{
 const a=audit(['s']);
 assert.equal(auditPublicEffects([effect('s'),{...effect('s'),actor:'b'}],true,a).status,'fail');
 a.crossKeyReview={status:'fail',evidence:['review/proven-repetition']};
 assert.equal(auditPublicEffects([{id:'missing-data'}],false,a).status,'fail');
 const b=audit(['one','two']);b.logicalWrites.unshift({id:'incomplete'});
 assert.equal(auditPublicEffects([{id:'missing-data'},effect('one'),effect('two')],false,b).status,'fail');
});
