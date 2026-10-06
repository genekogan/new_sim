import test from 'node:test';
import assert from 'node:assert/strict';
import {publicEvent,type LogEvent} from './index.ts';
import {intentSleepStopV1Schema} from './intent-sleep-stop-v1.ts';
const payload={contract:'private-intent-sleep-stop/1',worldId:'w',soulId:'s_A',entityId:'h_A',intent:{intentId:'PRIVATE_PURPOSE',version:1},programId:'p1'};
test('private native sleep stop validates bounded exact identity and public projection hides the owner purpose',()=>{
 assert.equal(intentSleepStopV1Schema.safeParse(payload).success,true);
 for(const p of [{...payload,words:'PRIVATE_WORDS'},{...payload,programId:''},{...payload,entityId:'x'.repeat(101)},{...payload,intent:{intentId:'p',version:0}}])assert.equal(intentSleepStopV1Schema.safeParse(p).success,false);
 const fact:LogEvent={seq:4,tick:12,kind:'intent-sleep-stop-v1',author:'world:human-sleep-stop',at:1,payload};assert.deepEqual(publicEvent(fact).payload,{worldId:'w',soulId:'s_A',privateUpdate:true});assert.ok(!JSON.stringify(publicEvent(fact)).includes('PRIVATE_PURPOSE'));assert.ok(!JSON.stringify(publicEvent(fact)).includes('h_A'));
});
