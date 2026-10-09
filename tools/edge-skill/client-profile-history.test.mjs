import test from 'node:test';
import assert from 'node:assert/strict';
import {Hono} from '../../apps/server/node_modules/hono/dist/index.js';
import {setImmediate} from 'node:timers/promises';
import {mkdtempSync,realpathSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {marsFactory,GREEN_FIELD_WORLD} from '../../packages/engine-mars/src/index.ts';
import {fixture,invite} from '../../apps/server/test/native-owner-fixture.ts';
import {EdgeLedger} from '../../apps/server/src/edge/ledger/ledger.ts';
import {registerEdgeComms} from '../../apps/server/src/edge/comms/index.ts';
import {openClientConversations} from './client-conversations.mjs';
import {openClientMemory} from './client-memory.mjs';
async function drain(host,p){let done=false;p.then(()=>done=true,()=>done=true);const end=performance.now()+4000;while(!done&&performance.now()<end){await setImmediate();host.drainInputs();}assert.ok(done,'actual queued owner request completed before bounded deadline');return p;}
test('actual owner rename and Core history refresh/reconnect never refold changing display names into immutable memory events',async t=>{
 const f=fixture(':memory:',await marsFactory({...GREEN_FIELD_WORLD,safeCrewRemoval:true}));f.brain.quiesce();const root=mkdtempSync(join(realpathSync(tmpdir()),'eden-profile-history-'));let comms;
 t.after(()=>{comms?.close();f.brain.quiesce();f.host.stop();f.db.close();rmSync(root,{recursive:true,force:true});});f.souls.enableLifecycle();
 const born=async(owner,name)=>{await invite(f,owner);const r=await drain(f.host,f.request('/v1/souls',{name},owner));assert.equal(r.status,200);return (await r.json()).soul.id;};
 const a=await born('alice','Alder History'),b=await born('bob','Briar Before');const actor=id=>{const m=f.host.minds.get(id);return {soulId:id,entityId:m.entityId,name:m.name,owner:m.owner};};
 const ledger=new EdgeLedger(f.host,f.db);comms=registerEdgeComms(new Hono(),{host:f.host,db:f.db,souls:f.souls,build:'history-test',soul:()=>{throw Error('no external route');},ledger},{fetch:null,sweepMs:0});
 const start=comms.conversations.handle(actor(a),{op:'start',with:[b],text:'An original reading discussion.'});assert.equal(start.accepted,true);const id=start.conversation.id;assert.equal(comms.conversations.handle(actor(b),{op:'accept',conversation:id}).accepted,true);
 const say=comms.conversations.handle(actor(b),{op:'say',conversation:id,text:'My original reading observation.'});assert.equal(say.accepted,true);
 // This single deleted NEW journal row makes an explicit legacy-before-name-journal
 // fixture. Durable original stream body remains untouched; no production history repair.
 f.db.db.prepare('DELETE FROM edge_comms_turn_names_v1 WHERE world_id=? AND conversation_id=? AND seq=?').run(f.host.worldId,id,say.turn.seq);
 const original=comms.streams.read(a,0).events.find(e=>e.kind==='conversation.turn'&&e.turn?.seq===say.turn.seq);assert.ok(original);let memory=openClientMemory(root,{scope:f.host.worldId+'|'+a,now:()=> '2026-10-09T20:00:00.000Z'});memory.catalogue({places:[{id:'field',name:'Commons',goodFor:[]}]});memory.here({tick:1,me:{place:'field'}});memory.speech(original);memory.remember({person:b,note:'Ask about the original reading observation.'});const knowledge=()=>readFileSync(join(root,'log','memory-events.jsonl'),'utf8');
 const helper=openClientConversations({scope:f.host.worldId+'|'+a,soulId:a,name:'Alder History'});helper.reconcile(comms.conversations.list(actor(a)));helper.event(original);const before=knowledge();
 const rename=await drain(f.host,f.request(`/v1/souls/${b}/profile`,{name:'Briar Current',expectedRevision:0},'bob','PATCH'));assert.equal(rename.status,200);const history=comms.conversations.turns(actor(a),id,0),legacy=history.turns.find(x=>x.seq===say.turn.seq);assert.equal(legacy.from.name,'Briar Current');assert.equal(legacy.from.nameSource,'current-projection');
 // Exactly the live refresh route: canonical roster/history goes to helper.turns,
 // never memory.speech. Identical stored stream replay alone is folded into memory.
 helper.turns(history);assert.equal(helper.context()[0].members.find(p=>p.soulId===b).name,'Briar Current');assert.equal(helper.context()[0].lastTurn.from.name,'Briar Before');const replay=comms.streams.read(a,0).events.find(e=>e.id===original.id);assert.deepEqual(replay,original);memory.speech(replay);assert.equal(knowledge(),before);
 const newSay=comms.conversations.handle(actor(b),{op:'say',conversation:id,text:'A new observation after the accepted rename.'});assert.equal(newSay.accepted,true);const newEvent=comms.streams.read(a,0).events.find(e=>e.kind==='conversation.turn'&&e.turn?.seq===newSay.turn.seq);memory.speech(newEvent);helper.event(newEvent);const newFacts=knowledge();const again=await drain(f.host,f.request(`/v1/souls/${b}/profile`,{name:'Briar Later',expectedRevision:1},'bob','PATCH'));assert.equal(again.status,200);const later=comms.conversations.turns(actor(a),id,0).turns.find(x=>x.seq===newSay.turn.seq);assert.equal(later.from.name,'Briar Current');assert.equal(later.from.currentName,'Briar Later');assert.equal(later.from.nameSource,'at-turn');
 memory=openClientMemory(root,{scope:f.host.worldId+'|'+a,now:()=> '2026-10-09T20:00:00.000Z'});const cold=openClientConversations({scope:f.host.worldId+'|'+a,soulId:a,initial:helper.snapshot()});cold.turns(comms.conversations.turns(actor(a),id,0));memory.speech(replay);memory.speech(newEvent);assert.equal(knowledge(),newFacts);assert.match(memory.retrieve({me:{place:'field'},near:[{id:b}]}),/Ask about the original reading observation/);assert.equal(cold.context()[0].lastTurn.from.soulId,b);assert.equal(cold.context()[0].lastTurn.from.name,'Briar Current');assert.equal(cold.context()[0].members.find(p=>p.soulId===b).name,'Briar Later');
});
