// Soul Actions entry 31: doors opened as part of walking (packet 3), with contention, obstruction and refusal.
// Deterministic native run on the real server stack (ledger, god model, engine bridge); plain walk capabilities only.
import test from 'node:test';import assert from 'node:assert/strict';import {setImmediate} from 'node:timers/promises';import {mkdirSync,writeFileSync} from 'node:fs';import {Hono} from '../../apps/server/node_modules/hono/dist/index.js';
import {fixture,invite,accept,factory} from '../../apps/server/test/native-owner-fixture.ts';import {EdgeLedger} from '../../apps/server/src/edge/ledger/ledger.ts';import {mountEdgeRoutes} from '../../apps/server/src/edge/routes.ts';import {GodMode} from '../../apps/server/src/god/god.ts';import {installEngineBridge} from '../../apps/server/src/god/engine-bridge.ts';
import {handActuatorFrame,leafDistance,HAND_OPEN_ANGLE} from '../../mars/viewer/engine/social/hand-actuator.ts';
const out=process.env.SOUL_ACTIONS_OUT;
test('door passage: by hand on the way, close behind, contention, obstruction, refusal, bounded context',{timeout:240000},async t=>{
 const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();if(process.env.PASSAGE_DEBUG){const recover=f.host.recoverFault.bind(f.host);f.host.recoverFault=(e,...args)=>{console.log('NATIVE FAULT',String(e?.stack??e).slice(0,1500));return recover(e,...args)};}const edge=new EdgeLedger(f.host,f.db,undefined,{ambient:false}),app=new Hono();let soul;const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger:edge,soul:()=>soul});t.after(()=>{comms.close();f.host.stop();f.db.close();});
 const god=new GodMode(f.db,{worldId:f.host.worldId,ownerId:'dev:admin',tick:()=>f.host.engine.world.tick,emit(){}});installEngineBridge({host:f.host,god,edge,log(){},worldLore:false,worldClock:false});
 const host=f.host,tick=async(n=5)=>{for(let i=0;i<n;i++){f.host.tickOnce();await setImmediate();f.host.drainInputs();sample();}};const ok=r=>{assert.equal(r.accepted,true,JSON.stringify(r));return r;};
 const souls={};const make=async name=>{await invite(f,name);const row=await accept(f.host,f.souls.create('dev:'+name,{name:name[0].toUpperCase()+name.slice(1),description:'Door passage playtest'}));souls[name]={soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};await tick();return souls[name];};
 const here=async s=>{soul=s;return (await(await app.request('/v1/edge/here?include=doHere')).json()).here;};
 // samples: every body, every tick (positions, hand motions on the door)
 const samples=[];let sampling=false;function sample(){if(!sampling)return;const row={tick:W.tick,bodies:{}};for(const [n,s] of Object.entries(souls)){const e=W.entities[s.entityId];if(e)row.bodies[n]={p:[...e.pose.p],motion:e.human?.handActuator?{target:e.human.handActuator.target,actionId:e.human.actionId??e.human.handActuator.actionId,startTick:e.human.handActuator.startTick,opening:e.human.handActuator.opening,passage:e.human.handActuator.passage}:null};}row.open=god.model.get('door')?.state.open;samples.push(row);if(process.env.PASSAGE_DEBUG&&W.tick%20===0&&souls.bea)console.log('S',W.tick,Object.entries(row.bodies).map(([n,b])=>n+':'+b.p.map(v=>v.toFixed(2)).join(',')+':'+W.entities[souls[n].entityId].human.activity).join(' '),JSON.stringify(f.host.engine.doorPassersV1(doorId)),row.open);}
 await tick();const ana=await make('ana');
 // the live world (an engine fault recovery replaces the world object)
 const W=new Proxy({},{get:(_,k)=>host.engine.world[k]});
 const absent=await here(ana);
 const distant=Array.from({length:100},(_,i)=>({op:'place',def:'core/door@2',name:`distant-door-${i}`,p:[100+i%10*2,100+Math.floor(i/10)*2]}));ok(god.act({ops:distant}));await tick(45);const far=await here(ana);
 assert.ok(!JSON.stringify(far).includes('distant-door-'),'no distant door in here');
 // the walled yard: door at (0,3) facing south (yaw pi, as the Gene-approved door revision), bench inside, lamp outside
 const z=3,yard=(name,x,w=.6)=>({op:'place',def:'core/garden-wall@1',name,shape:{path:[[x-w,z],[x-4,z],[x-4,z+6],[x+4,z+6],[x+4,z],[x+w,z]]}});
 ok(god.act({ops:[yard('yard-walls',0),{op:'place',def:'core/door@2',name:'door',p:[0,z],r:Math.PI},{op:'place',def:'core/bench@1',name:'inside-bench',p:[1.5,z+4]},{op:'place',def:'core/bench@1',name:'inside-seat',p:[-2,z+4.5]},{op:'place',def:'core/floor-lamp@2',name:'outside-lamp',p:[2.5,z-4]},{op:'place',def:'core/floor-lamp@2',name:'outside-post',p:[-2.5,z-3.5]},
  yard('store-walls',12),{op:'place',def:'core/door@2',name:'store-door',p:[12,z],r:Math.PI,state:{locked:true}},{op:'place',def:'core/bench@1',name:'store-bench',p:[12,z+4]},
  yard('private-walls',-12),{op:'place',def:'core/door@2',name:'private-door',p:[-12,z],r:Math.PI,access:'private'},{op:'place',def:'core/bench@1',name:'private-bench',p:[-12,z+4]}]}));await tick(45);
 const door=god.model.get('door'),doorId=door.id;if(process.env.PASSAGE_DEBUG){const dp=edge.doorPassage;edge.doorPassage=(so,st,w)=>{const r=dp(so,st,w);console.log('DP',W.tick,so.name,w,JSON.stringify(f.host.engine.closedDoorsOnWalkV1(so.entityId,st)),r?('refuse' in r?r.reason:r.door):null);return r;};}
 const receipts={},act=async(s,cap)=>{const r=ok(await accept(f.host,edge.act(s,{capability:cap})));receipts[s.soulId+cap+W.tick]=r;return r;};
 const finish=async(list,limit=1600)=>{for(let n=0;n<limit;n++){const ph=list.map(([s,r])=>edge.receipt(s.soulId,r.receipt.id));if(ph.every(p=>['failed','completed','replaced'].includes(p?.phase)))return ph;await tick(1);}return list.map(([s,r])=>edge.receipt(s.soulId,r.receipt.id));};
 const side=s=>W.entities[s.entityId].pose.p[2]>z?'inside':'outside';
 const report={checks:[],contextBytes:{},passages:{}};
 // ---- 1. one Soul, outside -> inside, closed door: opened by hand on the way, closed behind
 console.log('ana before',W.entities[ana.entityId].pose.p);sampling=true;let s0=samples.length;
 const r1=await act(ana,'walk:inside-bench');assert.match(r1.receipt.reason??'',/Through door/);assert.equal(door.state.open,false,'admission does not open the door');
 console.log('r1',JSON.stringify(r1.receipt).slice(0,400),JSON.stringify(f.host.engine.programs?.get?.(r1.receipt.programId)?.steps??null).slice(0,1500));const nearby=await here(ana);
 const [e1]=await finish([[ana,r1]]);console.log('e1',JSON.stringify(e1).slice(0,600),W.tick);assert.equal(e1.phase,'completed',JSON.stringify(e1));assert.equal(side(ana),'inside');assert.equal(god.model.get('door').state.open,false,'closed behind');
 report.passages.in=passageChecks(samples.slice(s0),'ana',z);report.checks.push('outside->inside: opened by hand, walked through, closed behind');
 const after=await here(ana);assert.ok(!JSON.stringify(after).includes('distant-door-'));
 // ---- 2. inside -> outside (the push side)
 s0=samples.length;const r2=await act(ana,'walk:outside-lamp');const [e2]=await finish([[ana,r2]]);assert.equal(e2.phase,'completed',JSON.stringify(e2));assert.equal(side(ana),'outside');assert.equal(god.model.get('door').state.open,false);
 report.passages.out=passageChecks(samples.slice(s0),'ana',z);report.checks.push('inside->outside: pushed open, through, closed behind');
 // ---- 3. an open door is left open (it was open when the walk was planned): a plain walk, no hand
 ok(god.act({ops:[{op:'set',id:'door',state:{open:true}}]}));await tick(20);s0=samples.length;
 const r3=await act(ana,'walk:inside-bench');assert.doesNotMatch(r3.receipt.reason??'',/Through door/);await finish([[ana,r3]]);assert.equal(god.model.get('door').state.open,true,'found open, left open');
 assert.ok(samples.slice(s0).every(x=>!x.bodies.ana.motion),'no hand on an open door');report.checks.push('an open door is walked through and left open');
 // (closed again by hand from inside, not by a god edit, which would lift a Soul shut in out of the yard)
 const shut=await act(ana,'object:door:close');await finish([[ana,shut]]);assert.equal(god.model.get('door').state.open,false);assert.equal(side(ana),'inside');
 // ---- 4. following: Bea a few steps behind Ana, both inside -> out; Ana holds it open, Bea closes it
 const bea=await make('bea');const rb=await act(bea,'walk:inside-seat');const [eb]=await finish([[bea,rb]]);assert.equal(eb.phase,'completed',JSON.stringify(eb));assert.equal(side(bea),'inside');assert.equal(god.model.get('door').state.open,false);
 s0=samples.length;const rf1=await act(ana,'walk:outside-lamp');await tick(30);const rf2=await act(bea,'walk:outside-post');
 const fol=await finish([[ana,rf1],[bea,rf2]]);assert.deepEqual(fol.map(x=>x.phase),['completed','completed'],JSON.stringify(fol));assert.equal(side(ana),'outside');assert.equal(side(bea),'outside');assert.equal(god.model.get('door').state.open,false,'last one through closed it');
 const fs=samples.slice(s0);report.passages.follow={...pairChecks(fs,'ana','bea'),handOps:handOps(fs)};assert.equal(report.passages.follow.handOps.length,2,'one opening, one closing: '+JSON.stringify(report.passages.follow.handOps));report.checks.push('following: held open, the last one through closed it');
 // ---- 5. contention: Ana outside -> in and Bea... first put Bea inside again, then both start together from opposite sides
 const rb2=await act(bea,'walk:inside-seat');await finish([[bea,rb2]]);assert.equal(side(bea),'inside');assert.equal(god.model.get('door').state.open,false);
 s0=samples.length;const rc1=await act(ana,'walk:inside-bench'),rc2=await act(bea,'walk:outside-post');
 const con=await finish([[ana,rc1],[bea,rc2]]);assert.deepEqual(con.map(x=>x.phase),['completed','completed'],JSON.stringify(con));assert.equal(side(ana),'inside');assert.equal(side(bea),'outside');assert.equal(god.model.get('door').state.open,false,'door ends closed');
 const cs=samples.slice(s0);report.passages.contention={...pairChecks(cs,'ana','bea'),handOps:handOps(cs),seconds:(cs.at(-1).tick-cs[0].tick)/20};report.checks.push('contention from opposite sides: one hand at a time, no clipping, no deadlock, door closed');
 // ---- 6. obstruction: Cal idles in the swing on the outside (the pull side) as Ana, inside, pushes out
 const relocate=async(s,to)=>{await accept(f.host,f.host.enqueue('edge-relocate','edge:'+s.soulId,{soulId:s.soulId,entityId:s.entityId,to,why:'door passage fixture: a bystander in the swing'}));await tick(10);};
 const cal=await make('cal');if(side(ana)!=='inside'){const back=await act(ana,'walk:inside-bench');await finish([[ana,back]]);}assert.equal(side(ana),'inside');
 await relocate(cal,[.1,2.35]);const calAt=[...W.entities[cal.entityId].pose.p];s0=samples.length;const ro=await act(ana,'walk:outside-lamp');const [eo]=await finish([[ana,ro]]);
 const os=samples.slice(s0);report.passages.obstruction={calStart:calAt,calEnd:[...W.entities[cal.entityId].pose.p],anaPhase:eo.phase,code:eo.code,minLeafToCal:minLeafTo(os,'cal'),handOps:handOps(os),waitedSeconds:(os.find(x=>x.bodies.ana.motion)?.tick-os[0].tick)/20};
 assert.ok(report.passages.obstruction.minLeafToCal>=.30,'the leaf never swung through the bystander: '+report.passages.obstruction.minLeafToCal);
 assert.equal(eo.phase,'completed',JSON.stringify(eo));assert.ok(Math.hypot(calAt[0]-W.entities[cal.entityId].pose.p[0],calAt[2]-W.entities[cal.entityId].pose.p[2])>.5,'the bystander stepped aside');assert.equal(god.model.get('door').state.open,false);report.checks.push('idle bystander in the swing: asked to step aside, then passed; never swung through');
 // ---- 6b. a bystander who will not move (sitting on the ground in the swing): Ana waits, then stops with a reason
 await relocate(cal,process.env.BYSTANDER_AT?JSON.parse(process.env.BYSTANDER_AT):[.3,1.8]);// fixture: an edge-relocate leaves `speed: 0` on the body, which any pose then reports as motion.overspeed (pre-existing,
 // engine.ts relocate; recorded in run.md); a body put down by hand has no speed
 delete W.entities[cal.entityId].human.speed;const sat=ok(await accept(f.host,edge.act(cal,{capability:process.env.BYSTANDER??'sit-ground:here',params:{seconds:120}})));await tick(40);
 console.log('CAL6b',JSON.stringify(edge.receipt(cal.soulId,sat.receipt.id)).slice(0,300),W.entities[cal.entityId].pose.p,W.entities[cal.entityId].human.activity,W.entities[cal.entityId].human.baseActivity);s0=samples.length;const rs=await act(ana,'walk:inside-bench');const [es]=await finish([[ana,rs]]);const ss=samples.slice(s0);
 report.passages.seatedBystander={phase:es.phase,code:es.code,reason:es.reason,minLeafToCal:minLeafTo(ss,'cal'),handOps:handOps(ss),seconds:(ss.at(-1).tick-ss[0].tick)/20};
 assert.equal(es.phase,'failed',JSON.stringify(es));assert.equal(es.code,'contact.swing-blocked');assert.equal(god.model.get('door').state.open,false,'nothing was opened');assert.equal(handOps(ss).length,0,'the hand never went out');assert.equal(side(ana),'outside');
 report.checks.push('a bystander who cannot move: waited, then stopped with a readable reason; nothing opened');
 const up=await act(cal,'stand:here');await finish([[cal,up]],200);
 // ---- 7. locked and private doors on the only way: refused at once, naming the door; nothing moves
 const beforeStore=JSON.stringify(god.model.get('store-door').state),p0=[...W.entities[ana.entityId].pose.p];
 const locked=await accept(f.host,edge.act(ana,{capability:'walk:store-bench'}));assert.equal(locked.accepted,false,JSON.stringify(locked));assert.match(JSON.stringify(locked),/store-door.*locked|locked/i);
 const priv=await accept(f.host,edge.act(ana,{capability:'walk:private-bench'}));assert.equal(priv.accepted,false,JSON.stringify(priv));assert.match(JSON.stringify(priv),/private-door/);
 await tick(20);assert.deepEqual(W.entities[ana.entityId].pose.p,p0,'refusals do not move the body');assert.equal(JSON.stringify(god.model.get('store-door').state),beforeStore);
 report.refusals={locked:locked.error??locked.reason??locked,private:priv.error??priv.reason??priv};report.checks.push('locked and private doors refused with readable reasons, nothing moved');
 // 7b. from inside the courtyard (two doors on the way, the second locked): refused at once naming the locked one; no
 // closest approach and no nav-connect lift out of the courtyard
 const inAgain=await act(ana,'walk:inside-bench');await finish([[ana,inAgain]]);assert.equal(side(ana),'inside');const p1=[...W.entities[ana.entityId].pose.p];
 const locked2=await accept(f.host,edge.act(ana,{capability:'walk:store-bench'}));assert.equal(locked2.accepted,false,JSON.stringify(locked2));assert.match(JSON.stringify(locked2),/store-door/);
 await tick(20);assert.deepEqual(W.entities[ana.entityId].pose.p,p1,'refused from inside, not lifted out');report.refusals.lockedFromInside=locked2.error??locked2.reason??locked2;report.checks.push('from inside a closed yard, a locked door at the destination is refused by name; no closest approach');
 // a walk out of the yard to the open field (free-standing doors elsewhere separate nothing) still passes
 const outAgain=await act(ana,'walk:outside-lamp');const [eoa]=await finish([[ana,outAgain]]);assert.equal(eoa.phase,'completed',JSON.stringify(eoa));assert.equal(side(ana),'outside');
 // ---- 8 (entry 32's carried fix). Same side, the later one nearer (entry 31 take 4's geometry): Ana from the lamp, Bea
 // from the post 2.5 s later. The first passage gets the staging spot, the later one a queue spot about a metre behind;
 // they never meet at one waiting spot; Ana holds the door, Bea follows and closes it.
 const toPost=await act(bea,'walk:outside-post');await finish([[bea,toPost]]);assert.equal(side(bea),'outside');assert.equal(god.model.get('door').state.open,false);
 const toLamp=await act(ana,'walk:outside-lamp');await finish([[ana,toLamp]]);
 s0=samples.length;const rq1=await act(ana,'walk:inside-bench');await tick(50);const rq2=await act(bea,'walk:inside-seat');
 const qs=await finish([[ana,rq1],[bea,rq2]]);assert.deepEqual(qs.map(x=>x.phase),['completed','completed'],JSON.stringify(qs));assert.equal(side(ana),'inside');assert.equal(side(bea),'inside');assert.equal(god.model.get('door').state.open,false,'the last one through closed it');
 const qss=samples.slice(s0);report.passages.sameSideQueue={...pairChecks(qss,'ana','bea'),handOps:handOps(qss),beaWaitedAt:qss.find(x=>x.bodies.ana.motion&&!x.bodies.bea.motion)?.bodies.bea.p??null};
 assert.ok(report.passages.sameSideQueue.minBodyDistance>=.52,'never closer than 0.52 m: '+report.passages.sameSideQueue.minBodyDistance);report.checks.push('same side, later one nearer: queued a metre behind the staging spot, never closer than 0.52 m, last one through closed it');
 assert.deepEqual(f.host.engine.runtime.violations,[]);
 report.contextBytes={absent:JSON.stringify(absent).length,distant100:JSON.stringify(far).length,nearby:JSON.stringify(nearby).length,nearbyDoorFacts:nearby.objects?.find(o=>o.id===doorId)?.state??null,afterPassage:JSON.stringify(after).length};
 assert.equal(report.contextBytes.distant100,report.contextBytes.absent,'100 distant doors add +0 bytes');
 report.pass=true;if(out){mkdirSync(out,{recursive:true});writeFileSync(out+'/summary.json',JSON.stringify(report,null,2));}console.log(JSON.stringify(report,null,1));
});
// ---- checks over samples
function leafAngle(m,tick){if(!m?.opening)return null;return handActuatorFrame(m,(tick-m.startTick)/20).angle;}
/** The door's drawn leaf at a sample: from whoever's hand is on it, else shut/open by state. */
function leafAt(x,opening){for(const b of Object.values(x.bodies))if(b.motion?.opening)return {o:b.motion.opening,angle:leafAngle(b.motion,x.tick)};return opening?{o:opening,angle:x.open?HAND_OPEN_ANGLE:0}:null;}
function passageChecks(S,who,z){
 const opening=S.find(x=>x.bodies[who]?.motion?.opening)?.bodies[who].motion.opening;assert.ok(opening,'a hand operation ran '+S.length+' '+JSON.stringify(S.filter((x,i)=>i%40==0).map(x=>[x.tick,x.bodies[who]?.p.map(v=>+v.toFixed(2)),x.open])));
 const crossings=[];let minWalkLeaf=Infinity,maxStep=0,maxOpStep=0;
 for(let i=1;i<S.length;i++){const p=S[i-1].bodies[who].p,q=S[i].bodies[who].p,st=Math.hypot(q[0]-p[0],q[2]-p[2]);maxStep=Math.max(maxStep,st);if(S[i].bodies[who].motion&&S[i-1].bodies[who].motion)maxOpStep=Math.max(maxOpStep,st);
  if((p[2]-z)*(q[2]-z)<0){const u=(z-p[2])/(q[2]-p[2]);crossings.push({tick:S[i].tick,x:p[0]+(q[0]-p[0])*u});}
  const l=leafAt(S[i],opening);if(l&&Math.hypot(q[0],q[2]-z)<1.5&&!S[i].bodies[who].motion)minWalkLeaf=Math.min(minWalkLeaf,leafDistance(l.o,l.angle,q[0],q[2]));}
 assert.equal(crossings.length,1,'one crossing: '+JSON.stringify(crossings));assert.ok(Math.abs(crossings[0].x)<.21,'crossed within the doorway: '+crossings[0].x);
 assert.ok(minWalkLeaf>=.30,'walking clear of the leaf: '+minWalkLeaf);assert.ok(maxStep<=.12,'no pop (per 50 ms tick): '+maxStep);
 return {crossings,minWalkLeaf,maxStepPerTick:maxStep,maxOperationStepPerTick:maxOpStep,handOps:handOps(S)};
}
function handOps(S){const ops=new Map();for(const x of S)for(const [n,b] of Object.entries(x.bodies))if(b.motion?.passage){const k=n+b.motion.startTick+b.motion.passage.mode;const o=ops.get(b.motion.actionId+n)??{who:n,mode:b.motion.passage.mode,from:x.tick,to:x.tick};o.to=x.tick;ops.set(b.motion.actionId+n,o);}
 const list=[...ops.values()].sort((a,b)=>a.from-b.from);for(let i=1;i<list.length;i++)assert.ok(list[i].from>list[i-1].to,'never two hands on the door at once: '+JSON.stringify(list));return list;}
function pairChecks(S,a,b){let min=Infinity;for(const x of S){const p=x.bodies[a]?.p,q=x.bodies[b]?.p;if(p&&q)min=Math.min(min,Math.hypot(p[0]-q[0],p[2]-q[2]));}assert.ok(min>=.52,'bodies never clip: '+min);return {minBodyDistance:min};}
function minLeafTo(S,who){let min=Infinity;for(const x of S){const l=leafAt(x,null),q=x.bodies[who]?.p;if(l&&q)min=Math.min(min,leafDistance(l.o,l.angle,q[0],q[2]));}return min;}
