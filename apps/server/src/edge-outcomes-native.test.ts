import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Hono} from 'hono';
import {edenNavWorld,CN5_PLACES,CN5_SPOTS} from '../test/eden-nav-fixture.ts';
import {accept} from '../test/native-owner-fixture.ts';
import {mountEdgeRoutes} from './edge/routes.ts';
import {mountOutcomeRoutes} from './edge/outcomes/routes.ts';
import {EdgeError} from './edge/contract.ts';
import {readSSE} from './edge/events/testing.ts';
import {EDEN_LIBRARY_CATALOGUE} from './edge/content/eden-library-catalogue.ts';
import type {EdgeReceipt} from './edge/contract.ts';
import {WorldHost} from './world.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';

void test('native completed content acts persist identical HTTP/stream outcomes with private writing and entitled presentation material', {timeout:600000},async t=>{
 const w=await edenNavWorld(2,{cn5:true}),app=new Hono(),[reader,presenter]=w.souls,byId=new Map(w.souls.map(s=>[s.soulId,s]));
 const deps={host:w.f.host,db:w.f.db,souls:w.f.souls,ledger:w.ledger,soul:(c:import('hono').Context)=>{const s=byId.get(c.req.header('authorization')?.replace(/^Bearer /,'')??'');if(!s)throw new EdgeError(401,'unauthorized','owned fixture only');return s;}};
 const comms=mountEdgeRoutes(app,deps);mountOutcomeRoutes(app,deps);t.after(()=>{comms.close();w.f.host.stop();w.f.db.close();});
 const http=async(s:typeof reader,method:string,path:string,body?:unknown)=>{const response=await accept(w.f.host,Promise.resolve(app.request(path,{method,headers:{authorization:`Bearer ${s.soulId}`,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})})));return{status:response.status,body:await response.json() as Record<string,any>};};
 const body=()=>w.engine.world.entities[reader.entityId] as unknown as {human?:{activity?:string};pose:{p:number[]}};
 const act=async(capability:string,params:Record<string,unknown>={})=>{const r=await http(reader,'POST','/v1/edge/act',{capability,params});assert.equal(r.status,200);assert.equal(r.body.accepted,true,capability+' refused: '+JSON.stringify(r.body));return r.body.receipt as EdgeReceipt;};
 const done=async(r:EdgeReceipt,activity:string)=>{let observed=false;await w.run([{soulId:reader.soulId,id:r.id}],16000,()=>{if(body().human?.activity===activity&&w.engine.programOf(reader.entityId)===w.ledger.receipt(reader.soulId,r.id)?.programId)observed=true;});const final=w.ledger.receipt(reader.soulId,r.id)!;assert.equal(final.phase,'completed',JSON.stringify(final));assert.equal(observed,true,'actual native activity '+activity+' observed');assert.ok(final.outcome);return final;};
 const read=await done(await act('read:here',{seconds:2}),'read');assert.equal(read.outcome!.learned[0].source,'book:gardens-guide@1#p1');assert.deepEqual((await http(reader,'GET','/v1/edge/receipts/'+read.id)).body.receipt.outcome,read.outcome);
 const nearest=(verb:string)=>w.ledger.capabilities(reader).filter(c=>c.verb===verb&&c.available).sort((a,b)=>{const at=(id:string)=>w.ledger.spots.spots.find(s=>s.id===id)?.at??[0,0],pa=at(a.target?.id??''),pb=at(b.target?.id??'');return Math.hypot(pa[0]-body().pose.p[0],pa[1]-body().pose.p[2])-Math.hypot(pb[0]-body().pose.p[0],pb[1]-body().pose.p[2]);})[0];
 const stroll=await done(await act('stroll:field',{pause:0}),'walk');assert.ok(stroll.outcome!.learned.some(f=>f.source==='place-lore:field@1'),'first actual admitted commons observation delivers attributed lore');
 const computer=await done(await act(nearest('use-computer').id,{seconds:2,query:'who is in town'}),'use-computer');assert.equal(computer.outcome!.learned.length>0,true);assert.deepEqual(computer.outcome!.detail.sections,['directory']);
 const write=await done(await act(nearest('write').id,{seconds:2,title:'Owned private page',text:'This is a Soul-authored observation, not authoritative history.'}),'write');assert.equal(write.outcome!.untrusted,true);const record=write.outcome!.produced[0];assert.equal((await http(reader,'GET','/v1/edge/content/objects/'+record.id)).body.object.text,'This is a Soul-authored observation, not authoritative history.');assert.equal((await http(presenter,'GET','/v1/edge/content/objects/'+record.id)).status,404);
 const publicPage=await http(reader,'GET','/v1/edge/public/souls/'+reader.soulId);assert.ok(publicPage.body.receipts.every((r:Record<string,unknown>)=>!('outcome'in r)),'owner-private content never leaks via public receipt history');
 const cap=nearest('listen'),spot=w.ledger.spots.spots.find(s=>s.id===cap.target?.id)!;assert.ok(spot.place);const listening=await act(cap.id,{seconds:10});let seenListen=false;
 await w.run([{soulId:reader.soulId,id:listening.id}],16000,()=>{if(body().human?.activity==='listen')seenListen=true;});
 assert.equal(seenListen,true);const noMaterial=w.ledger.receipt(reader.soulId,listening.id)!;assert.equal(noMaterial.phase,'completed');assert.match(noMaterial.outcome!.learned[0].fact,/No presentation material/);
 // A new, actually scheduled presentation is seeded at the reached native place.
 // Existing object actions publish an original approved passage to the audience.
 const starts=w.f.host.engine.world.tick+10;comms.objects.create({id:'w2-observed-presentation',kind:'presentation',name:'An authored library excerpt',placeId:spot.place!,params:{title:'An authored library excerpt',presenter:presenter.soulId,capacity:2,startsAtTick:starts,doorsOpenTicks:20,durationTicks:1000}});
 const action=async(s:typeof reader,name:string,params:object={})=>{const out=await http(s,'POST','/v1/edge/act',{capability:`object:w2-observed-presentation:${name}`,params});assert.equal(out.body.accepted,true,JSON.stringify(out.body));};
 await action(reader,'reserve');await action(reader,'enter');const passage=EDEN_LIBRARY_CATALOGUE[0].passages[0];await action(presenter,'publish',{text:`Authored fiction (${passage.source}): ${passage.text}`});
 const other=comms.objects.get('w2-observed-presentation',presenter);assert.ok((other.object.state as {materials:string[]}).materials.length);const out=await done(await act(cap.id,{seconds:2}),'listen');assert.equal(out.outcome!.untrusted,true);assert.match(out.outcome!.learned[0].source,/^presentation:w2-observed-presentation:v\d+:material0$/);assert.match(out.outcome!.learned[0].fact,/Authored fiction/);assert.equal((comms.objects.get('w2-observed-presentation',reader).object.state as {phase:string}).phase,'running','presentation follows actual native ticks');
 const polled=(await http(reader,'GET','/v1/edge/receipts/'+out.id)).body.receipt;assert.deepEqual(polled.outcome,out.outcome);
 const raw=comms.streams.read(reader.soulId,0,10000).events.find(e=>e.kind==='receipt'&&(e as unknown as {receipt:EdgeReceipt}).receipt.id===out.id&&(e as unknown as {receipt:EdgeReceipt}).receipt.phase==='completed')!;
 assert.ok(raw);const envelope=comms.events.envelope(reader.soulId,raw);assert.deepEqual((envelope.data!.receipt as {outcome:unknown}).outcome,out.outcome);assert.equal(envelope.text,out.outcome!.summary);assert.equal(envelope.untrusted,true);
 const stream=await app.request('/v1/edge/events?cursor=c_0&minSalience=0&pad=0',{headers:{authorization:`Bearer ${reader.soulId}`}});assert.equal(stream.status,200);const frames=await readSSE(stream,msgs=>msgs.some(m=>m.data?.data?.receipt?.id===out.id&&m.data?.data?.receipt?.phase==='completed'));
 assert.deepEqual(frames.find(m=>m.data?.data?.receipt?.id===out.id&&m.data?.data?.receipt?.phase==='completed')?.data.data.receipt.outcome,out.outcome);
 const pending=await act('read:here',{seconds:2});const safe=pending.id.replaceAll("'","''");w.f.db.db.exec(`CREATE TEMP TRIGGER reject_one_terminal BEFORE INSERT ON edge_comms_stream WHEN NEW.kind='receipt' AND json_extract(NEW.body,'$.receipt.id')='${safe}' AND json_extract(NEW.body,'$.receipt.phase')='completed' BEGIN SELECT RAISE(ABORT,'owned test stream failure'); END;`);
 const saved=await done(pending,'read');assert.ok(saved.outcome!.learned.length);assert.equal(w.f.db.db.prepare('SELECT 1 FROM edge_comms_receipts_seen WHERE world_id=? AND receipt_id=? AND phase=?').get(w.f.host.worldId,pending.id,'completed'),undefined,'seen marker rolls back with failed stream insert');w.f.db.db.exec('DROP TRIGGER reject_one_terminal');
 const hash=w.engine.stateHash();w.ledger.attachComms(comms);assert.equal(w.engine.stateHash(),hash,'outcome delivery recovery never changes native state');const count=()=>w.f.db.db.prepare("SELECT COUNT(*) n FROM edge_comms_stream WHERE world_id=? AND soul_id=? AND kind='receipt' AND json_extract(body,'$.receipt.id')=? AND json_extract(body,'$.receipt.phase')='completed'").get(w.f.host.worldId,reader.soulId,pending.id) as {n:number};assert.equal(count().n,1);w.ledger.attachComms(comms);assert.equal(count().n,1,'repeat attachment never repeats terminal delivery');assert.deepEqual(w.ledger.receipt(reader.soulId,pending.id)!.outcome,saved.outcome,'recovery reuses the persisted snapshot without advancing reading');
 assert.equal(w.engine.runtime.violations.length,0);assert.equal(w.f.db.events(w.f.host.worldId).filter(e=>(e.payload as {recovery?:unknown})?.recovery).length,0,'no cleared native failures');assert.equal(w.f.db.paidCost(),0);
 // Actual host/ledger restart over its persisted native snapshot and semantic DB.
 comms.close();w.f.host.saveSnapshot(true);w.f.host.stop();const restored=new WorldHost(w.f.db,w.fac,w.f.host.seed,1e9,w.f.host.worldId,{durableClockV1:true});t.after(()=>restored.stop());assert.equal(restored.boot().from,'snapshot');const ledger=new EdgeLedger(restored,w.f.db,CN5_PLACES,{spots:CN5_SPOTS});
 const restarted=await accept(restored,ledger.act(reader,{capability:'read:here',params:{seconds:2}}));assert.equal(restarted.accepted,true);if(!restarted.accepted)throw Error('restart read refused');
 for(let i=0;i<10000&&['waiting','started'].includes(ledger.receipt(reader.soulId,restarted.receipt.id)!.phase);i++){restored.tickOnce();if(i%20===0){await new Promise<void>(r=>setImmediate(r));restored.drainInputs();}}
 const next=ledger.receipt(reader.soulId,restarted.receipt.id)!;assert.equal(next.phase,'completed');assert.equal(next.outcome!.learned[0].source,'book:gardens-guide@1#p3','host restart resumes the next unread passage without replaying an outcome');assert.equal(restored.engine.runtime.violations.length,0);
});
