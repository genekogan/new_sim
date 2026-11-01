import {test} from 'node:test';
import assert from 'node:assert/strict';
import {commsFixture} from '../../apps/server/src/edge/comms/testing.ts';
import {createWorldClient} from './world-client.mjs';

test('managed joining and speaking remain distinct against native conversation storage and events',async t=>{
 const f=commsFixture(['Speaker','Guest']);t.after(()=>f.destroy());f.at('Speaker',0,0);f.at('Guest',2,0);
 const client=name=>createWorldClient({world:'http://127.0.0.1',token:f.id(name),fetchImpl:(url,opts)=>f.app.request(new URL(url).pathname+new URL(url).search,opts)});
 const speaker=client('Speaker'),guest=client('Guest');
 const start=await speaker.write('converse',{op:'start',with:[f.id('Guest')],text:'Welcome to the discussion'},'start');
 const id=start.conversation.id;
 const count=()=>f.db.db.prepare('SELECT count(*) AS n FROM edge_comms_turns WHERE conversation_id=?').get(id).n;
 await assert.rejects(guest.write('converse',{op:'accept',conversation:id,text:'What did you observe?'},'bad-question'),{code:'invalid'});
 assert.equal(count(),1,'refused mixed acceptance cannot publish a question');
 const joined=await guest.write('converse',{op:'accept',conversation:id},'join');assert.equal(joined.accepted,true);assert.equal(count(),1,'native membership acceptance is not a speech turn');
 const answer=await guest.write('converse',{op:'say',conversation:id,text:'What did you observe?'},'question');assert.equal(answer.accepted,true);assert.equal(answer.turn.seq,2);assert.equal(answer.heardBy,1);assert.equal(count(),2);
 const events=(await f.drain('Speaker')).events.filter(e=>e.kind==='conversation.turn');assert.equal(events.length,1);assert.equal(events[0].turn.text,'What did you observe?');assert.equal(events[0].turn.from.soulId,f.id('Guest'));
});
