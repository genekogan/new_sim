// Exact own-body projection over the native fixture; no model, network or world service.
import test from 'node:test';
import assert from 'node:assert/strict';
import {coreAWorld} from '../test/core-a-fixture.ts';
import {hereFrame,hereBodyFrame} from './edge/perception/here.ts';

test('explicit body view equals rich native me across intent, pose, seat, fade and absent-body states',async t=>{
 const w=await coreAWorld(2);t.after(()=>w.close());
 const [s,other]=w.souls,L=w.ledger,engine=w.f.host.engine,b=w.body(s),originalOpen=L.openReceipts,originalSeats=engine.nativeSeatHoldsV1;
 const compare=()=>{const rich=hereFrame(L,s,{doHere:true}),physical=hereBodyFrame(L,s);assert.equal(JSON.stringify(physical.me),JSON.stringify(rich.me));assert.deepEqual(Object.keys(physical),['tick','view','me']);assert.equal(physical.view,'body');assert.equal(physical.tick,rich.tick);assert.ok('objects' in rich&&'exits' in rich&&'near' in rich&&'doHere' in rich);return physical.me;};
 const idle=compare();assert.equal(idle.soulId,s.soulId);assert.equal(idle.name,s.name);assert.deepEqual(idle.actualActivity,{kind:b.human.activity});
 // Receipt intent is deliberately unlike the actual engine pose. Projection
 // must preserve both fields, without crediting the planned reading yet.
 L.openReceipts=()=>[{capability:'read:here'}] as any;
 b.human.activity='walk';assert.equal(compare().activity.kind,'read');assert.deepEqual(compare().actualActivity,{kind:'walk'});
 b.human.activity='read';b.human.baseActivity='sit';
 engine.nativeSeatHoldsV1=()=>[{slot:'native-bench#seat-2'}] as any;
 const reading=compare();assert.equal(reading.posture,'seated');assert.equal(reading.seat,'native-bench#seat-2');assert.deepEqual(reading.actualActivity,{kind:'read'});
 b.human.activity='play-music';b.human.instrument='violin';assert.deepEqual(compare().actualActivity,{kind:'play-music',instrument:'violin'});
 L.openReceipts=()=>[{capability:'read:here',awaitingAnswer:{what:'read together',waitingFor:[{name:other.name}],expiresInSeconds:30}}] as any;
 assert.equal(compare().activity.kind,'inviting');assert.deepEqual(compare().actualActivity,{kind:'play-music',instrument:'violin'});
 L.faded.add(s.soulId);assert.equal(compare().posture,'faded');L.faded.delete(s.soulId);
 delete b.human.activity;assert.equal(compare().actualActivity,null,'unknown native activity never becomes idle');
 L.openReceipts=originalOpen;engine.nativeSeatHoldsV1=originalSeats;
 delete engine.world.entities[s.entityId];assert.equal(compare().actualActivity,null);engine.world.entities[s.entityId]=b;
});

test('body view keeps authenticated ownership and rate bucket, and skips rich planning paths',async t=>{
 const w=await coreAWorld(2);t.after(()=>w.close());const [s,other]=w.souls,L=w.ledger;
 for(const [object,key] of [[L,'capabilities'],[L,'routeProblem'],[L,'perceivedBodies'],[L.coreA,'binds'],[L.coreA,'conversations'],[L.knowledge,'scales']] as const){(object as any)[key]=()=>{throw Error('rich path '+key);};}
 const before=JSON.stringify(w.body(s).pose),calls:string[]=[];const allow=w.f.souls.limits.allow;
 w.f.souls.limits.allow=(key,...args)=>{calls.push(key);return allow.call(w.f.souls.limits,key,...args);};
 const body=await w.http(s,'GET','/v1/edge/here?view=body');assert.equal(body.status,200);assert.equal(body.body.here.me.soulId,s.soulId);assert.equal(body.body.here.view,'body');assert.equal(body.body.here.objects,undefined);assert.equal(JSON.stringify(w.body(s).pose),before);
 assert.ok(calls.includes('edge-here:'+s.soulId));
 for(const path of ['/v1/edge/here?view=unknown','/v1/edge/here?view=body&include=doHere'])assert.equal((await w.http(s,'GET',path)).status,400);
 const denied=await w.app.request('/v1/edge/here?view=body');assert.equal(denied.status,401);
 const own=await w.http(other,'GET','/v1/edge/here?view=body&soulId='+s.soulId);assert.equal(own.body.here.me.soulId,other.soulId,'query cannot select another body');
 w.f.souls.limits.allow=()=>({ok:false} as any);assert.equal((await w.http(s,'GET','/v1/edge/here?view=body')).status,429);
});
