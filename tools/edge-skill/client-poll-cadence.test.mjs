import test from 'node:test';
import assert from 'node:assert/strict';
import {queuePollDeadlineMs} from './client-poll-cadence.mjs';
test('stable protected work can long-poll events; pending/conditional/settling work keeps an eight-second reconciliation bound',()=>{
 for(const status of ['running','waiting'])assert.equal(queuePollDeadlineMs([{status,protected:true}]),20000);
 for(const status of ['pending','dispatching','stopping','waiting-condition'])assert.equal(queuePollDeadlineMs([{status}]),8000);
 assert.equal(queuePollDeadlineMs([{status:'running',until:{worldMinutes:300}}]),8000);assert.equal(queuePollDeadlineMs([{status:'completed'},{status:'pending'}]),8000);assert.equal(queuePollDeadlineMs([]),20000);
});
