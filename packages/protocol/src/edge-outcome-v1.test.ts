import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EDGE_OUTCOME_CONTRACT,edgeOutcomeV1Schema} from './edge-outcome-v1.ts';
const outcome=()=>({contract:EDGE_OUTCOME_CONTRACT,kind:'read',summary:'Read an authored passage.',learned:[{fact:'A story describes a gardener.',about:'eden-gardens',source:'book:gardens-guide@1#p1',provenance:'authored-content',untrusted:false}],produced:[],changed:[],met:[],detail:{},untrusted:false});
void test('typed terminal outcome preserves attribution and refuses silently trusted Soul text',()=>{
 assert.equal(edgeOutcomeV1Schema.safeParse(outcome()).success,true);
 const user=outcome();user.learned[0].provenance='soul-text';assert.equal(edgeOutcomeV1Schema.safeParse(user).success,false);
 user.learned[0].untrusted=true;assert.equal(edgeOutcomeV1Schema.safeParse(user).success,false);user.untrusted=true;assert.equal(edgeOutcomeV1Schema.safeParse(user).success,true);
 assert.equal(edgeOutcomeV1Schema.safeParse({...outcome(),summary:'x'.repeat(161)}).success,false);assert.equal(edgeOutcomeV1Schema.safeParse({...outcome(),learned:Array(6).fill(outcome().learned[0])}).success,false);
});
