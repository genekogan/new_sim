import test from 'node:test';import assert from 'node:assert/strict';
import {approvalFromHash} from './approval-link.ts';
test('approval fragments are exact',()=>{const id='ap_'+'a'.repeat(32);
 assert.equal(approvalFromHash('#approve/'+id),id);assert.equal(approvalFromHash('#approve/'+id+'/extra'),null);assert.equal(approvalFromHash('#pair/'+id),null);assert.equal(approvalFromHash('#approve/ap_short'),null);});
