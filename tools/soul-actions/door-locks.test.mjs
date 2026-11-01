// Soul Actions entry 32: knock, owner locks and a safe way out (packet 4). Deterministic native run on the real server
// stack (ledger, god model, engine bridge, layers ownership); ordinary capabilities only.
import test from 'node:test';import assert from 'node:assert/strict';import {setImmediate} from 'node:timers/promises';import {mkdirSync,writeFileSync} from 'node:fs';import {Hono} from '../../apps/server/node_modules/hono/dist/index.js';
import {fixture,invite,accept,factory} from '../../apps/server/test/native-owner-fixture.ts';import {EdgeLedger} from '../../apps/server/src/edge/ledger/ledger.ts';import {mountEdgeRoutes} from '../../apps/server/src/edge/routes.ts';import {GodMode} from '../../apps/server/src/god/god.ts';import {installEngineBridge} from '../../apps/server/src/god/engine-bridge.ts';
import {handActuatorFrame,opPoint,leafDistance,knockContacts,HAND_OPEN_ANGLE} from '../../mars/viewer/engine/social/hand-actuator.ts';
const out=process.env.SOUL_ACTIONS_OUT;
test('door locks: owner-only lock by hand, knock heard only inside, a safe way out, two at one door, bounded context',{timeout:300000},async t=>{
 const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();const edge=new EdgeLedger(f.host,f.db,undefined,{ambient:false}),app=new Hono();let soul;const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger:edge,soul:()=>soul});t.after(()=>{comms.close();f.host.stop();f.db.close();});
 const god=new GodMode(f.db,{worldId:f.host.worldId,ownerId:'dev:admin',tick:()=>f.host.engine.world.tick,emit(){}});const bridge=installEngineBridge({host:f.host,god,edge,log(){},worldLore:false,worldClock:false});
 const host=f.host,W=new Proxy({},{get:(_,k)=>host.engine.world[k]});
 const samples=[];let sampling=false;const souls={};
 function sample(){if(!sampling)return;const row={tick:W.tick,bodies:{}};for(const [n,s] of Object.entries(souls)){const e=W.entities[s.entityId];if(e)row.bodies[n]={p:[...e.pose.p],yaw:e.pose.yaw,hands:e.human?.hands?structuredClone(e.human.hands):null,motion:e.human?.handActuator?structuredClone(e.human.handActuator):null};}const d=god.model.get('door');row.door=d?{open:d.state.open??false,locked:d.state.locked??false}:null;samples.push(row);}
 const tick=async(n=5)=>{for(let i=0;i<n;i++){f.host.tickOnce();await setImmediate();f.host.drainInputs();sample();}};const ok=r=>{assert.equal(r.accepted,true,JSON.stringify(r));return r;};
 const make=async name=>{await invite(f,name);const row=await accept(f.host,f.souls.create('dev:'+name,{name:name[0].toUpperCase()+name.slice(1),description:'Door locks playtest'}));souls[name]={soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};await tick();return souls[name];};
 const here=async s=>{soul=s;return (await(await app.request('/v1/edge/here?include=doHere')).json()).here;};
 const stream=async s=>{soul=s;return (await(await app.request('/v1/edge/events/digest?since=c_0')).json());};
 const act=async(s,cap)=>ok(await accept(f.host,edge.act(s,{capability:cap})));
 const tryAct=async(s,cap)=>accept(f.host,edge.act(s,{capability:cap}));
 const finish=async(list,limit=2000)=>{for(let n=0;n<limit;n++){const ph=list.map(([s,r])=>edge.receipt(s.soulId,r.receipt.id));if(ph.every(p=>['failed','completed','replaced'].includes(p?.phase)))return ph;await tick(1);}return list.map(([s,r])=>edge.receipt(s.soulId,r.receipt.id));};
 const relocate=async(s,to)=>{await accept(f.host,f.host.enqueue('edge-relocate','edge:'+s.soulId,{soulId:s.soulId,entityId:s.entityId,to,why:'door locks fixture'}));await tick(10);delete W.entities[s.entityId].human.speed;};
 await tick();const ana=await make('ana');
 const report={checks:[],contextBytes:{},ops:{},passages:{},knock:{},refusals:{}};
 const absent=await here(ana);
 // 100 distant locked doors, all Bea's (her own lock offers must not reach her either)
 ok(god.act({ops:Array.from({length:100},(_,i)=>({op:'place',def:'core/door@3',name:`distant-door-${i}`,p:[100+i%10*2,100+Math.floor(i/10)*2],owner:'soul:Bea',state:{locked:true}}))}));await tick(45);const far=await here(ana);
 assert.ok(!JSON.stringify(far).includes('distant-door-'),'no distant door in here');
 // the courtyard (Bea's lockable door at (0,3), front to the south = outside) and the store yard (also Bea's, locked)
 const z=3,yard=(name,x,w=.6)=>({op:'place',def:'core/garden-wall@1',name,shape:{path:[[x-w,z],[x-4,z],[x-4,z+6],[x+4,z+6],[x+4,z],[x+w,z]]}});
 ok(god.act({ops:[yard('yard-walls',0),{op:'place',def:'core/door@3',name:'door',p:[0,z],r:Math.PI,owner:'soul:Bea'},{op:'place',def:'core/bench@1',name:'inside-bench',p:[1.5,z+4]},{op:'place',def:'core/bench@1',name:'inside-seat',p:[-2,z+4.5]},{op:'place',def:'core/floor-lamp@2',name:'outside-lamp',p:[2.5,z-4]},{op:'place',def:'core/floor-lamp@2',name:'outside-post',p:[-2.5,z-3.5]},
  yard('store-walls',12.5),{op:'place',def:'core/door@3',name:'store-door',p:[12.5,z],r:Math.PI,owner:'soul:Bea',state:{locked:true}},{op:'place',def:'core/bench@1',name:'store-bench',p:[12.5,z+4]},{op:'place',def:'core/floor-lamp@2',name:'store-lamp',p:[14,z-5]}]}));await tick(45);
 const doorId=god.model.get('door').id,storeId=god.model.get('store-door').id,door=()=>god.model.get('door').state,store=()=>god.model.get('store-door').state;
 const bea=await make('bea'),cal=await make('cal'),dee=await make('dee');
 await relocate(cal,[30,-25]);await relocate(dee,[9.3,z+1.6]);
 const side=s=>W.entities[s.entityId].pose.p[2]>z?'inside':'outside';
 const caps=s=>edge.capabilities(s).filter(c=>c.target?.id===doorId&&c.available).map(c=>c.id.split(':').at(-1)).sort();
 // ---- 1. Bea, the owner, walks in through her (unlocked) door; locks it by hand from inside (thumb-turn)
 sampling=true;let s0=samples.length;
 const b1=await act(bea,'walk:inside-bench');const [e1]=await finish([[bea,b1]]);assert.equal(e1.phase,'completed',JSON.stringify(e1));assert.equal(side(bea),'inside');assert.equal(door().open??false,false);
 report.offers={beaInsideUnlocked:caps(bea)};assert.ok(report.offers.beaInsideUnlocked.includes('lock'),'the owner is offered lock');assert.ok(!report.offers.beaInsideUnlocked.includes('knock'),'no knock from inside');
 s0=samples.length;const lk=await act(bea,`object:${doorId}:lock`);const [elk]=await finish([[bea,lk]]);assert.equal(elk.phase,'completed',JSON.stringify(elk));assert.equal(door().locked,true,'locked by hand');
 report.ops.lockInside=opChecks(samples.slice(s0),'bea','lock');report.checks.push('the owner locks her door by hand from inside: thumb-turn at a natural height, bolt across');
 // ---- 2. Ana (not the owner) outside: no lock/unlock in her menu; asking is refused by name; a walk in is refused
 const a0=await act(ana,'walk:outside-lamp');await finish([[ana,a0]]);assert.equal(side(ana),'outside');
 report.offers.anaOutsideLocked=caps(ana);assert.deepEqual(report.offers.anaOutsideLocked.filter(x=>x==='lock'||x==='unlock'),[],'no lock/unlock offered to a non-owner');assert.ok(report.offers.anaOutsideLocked.includes('knock'),'knock is offered outside a closed door');
 const p0=[...W.entities[ana.entityId].pose.p];
 const ru=await tryAct(ana,`object:${doorId}:unlock`),rl=await tryAct(ana,`object:${doorId}:lock`),rw=await tryAct(ana,'walk:inside-seat');
 for(const r of [ru,rl,rw])assert.equal(r.accepted,false,JSON.stringify(r));
 assert.match(JSON.stringify(ru),/Only Bea can unlock door/);assert.match(JSON.stringify(rw),/door, which is locked \(Bea's\).*knock/);
 await tick(20);assert.deepEqual(W.entities[ana.entityId].pose.p,p0,'refusals do not move the body');assert.equal(door().locked,true);
 report.refusals={unlock:ru.reason??ru.error?.reason??ru,lock:rl.reason??rl.error?.reason??rl,walkIn:rw.reason??rw.error?.reason??rw};report.checks.push('a non-owner gets no lock/unlock offer, is refused by name, and cannot walk into the locked yard');
 // ---- 3. nearby context: Ana a step from the locked door (outside); Bea inside
 const toPost=await act(ana,'walk:outside-post');await finish([[ana,toPost]]);
 const anaNear=await here(ana),beaNear=await here(bea);
 // ---- 4. Ana knocks: Bea (shut in by this door) hears once; Cal (40 m) and Dee (inside the store yard, 9 m) do not
 const beaHere0=await here(bea),before={bea:JSON.stringify(beaHere0).length,cal:(await stream(cal)),dee:(await stream(dee)),beaStream:(await stream(bea))};
 s0=samples.length;const kn=await act(ana,`object:${doorId}:knock`);const [ekn]=await finish([[ana,kn]]);assert.equal(ekn.phase,'completed',JSON.stringify(ekn));
 const after={bea:await stream(bea),cal:await stream(cal),dee:await stream(dee)};
 const knocks=x=>JSON.stringify(x).match(/knocks at door/g)?.length??0;
 report.knock={heardBy:(bridge.lastKnock?.heard??[]).map(id=>Object.values(souls).find(s=>s.soulId===id)?.name),beaKnockEvents:knocks(after.bea)-knocks(before.beaStream),calKnockEvents:knocks(after.cal),deeKnockEvents:knocks(after.dee),hand:knockChecks(samples.slice(s0),'ana'),beaHereBytesBefore:before.bea,state:door()};
 // her `here` after the knock differs only where Ana now stands (she walked up to knock) and the tick: no knock state
 const beaHere1=await here(bea),changed=Object.keys({...beaHere0,...beaHere1}).filter(k=>JSON.stringify(beaHere0[k])!==JSON.stringify(beaHere1[k]));
 report.knock.beaHereBytesAfter=JSON.stringify(beaHere1).length;report.knock.beaHereChangedKeys=changed;
 assert.deepEqual(report.knock.heardBy,['Bea'],'only Bea heard it');assert.equal(report.knock.beaKnockEvents,1);assert.equal(report.knock.calKnockEvents,0);assert.equal(report.knock.deeKnockEvents,0);
 assert.ok(!/knock/i.test(JSON.stringify(beaHere1)),'nothing about the knock stays in here');assert.deepEqual(changed.filter(k=>!['tick','near','doHereCoverage','now','clock'].includes(k)),[],'only the tick and where Ana stands changed: '+changed);assert.equal(door().locked,true,'a knock changes nothing');
 report.checks.push('a knock (3 raps, knuckles on the leaf) is heard once by the owner inside, never by a distant Soul or one in another yard');
 // ---- 5. Bea answers: unlocks and opens from inside; Ana walks in (found open, left open); Bea closes and locks it
 for(const c of [`object:${doorId}:unlock`,`object:${doorId}:open`]){s0=samples.length;const r=await act(bea,c);const [e]=await finish([[bea,r]]);assert.equal(e.phase,'completed',c+' '+JSON.stringify(e));if(c.endsWith('unlock'))report.ops.unlockInside=opChecks(samples.slice(s0),'bea','unlock');}
 assert.equal(door().locked,false);assert.equal(door().open,true);
 const a5=await act(ana,'walk:inside-seat');const [e5]=await finish([[ana,a5]]);assert.equal(e5.phase,'completed',JSON.stringify(e5));assert.equal(side(ana),'inside');assert.equal(door().open,true,'found open, left open');
 for(const c of [`object:${doorId}:close`,`object:${doorId}:lock`]){const r=await act(bea,c);const [e]=await finish([[bea,r]]);assert.equal(e.phase,'completed',c+' '+JSON.stringify(e));}
 assert.deepEqual([door().open,door().locked],[false,true]);report.checks.push('the owner answers: unlocks and opens; the guest walks in; the owner closes and locks');
 // ---- 6. both inside the locked yard walk out, the guest first, the owner 2.5 s later from nearer: Ana turns the
 // thumb-turn (nobody is trapped), opens, holds it; Bea waits a metre behind, follows, shuts it; the latch locks it again
 const ap=await act(ana,'walk:inside-bench');await finish([[ana,ap]]);const bp=await act(bea,'walk:inside-seat');await finish([[bea,bp]]);
 const pa=[...W.entities[ana.entityId].pose.p],pb=[...W.entities[bea.entityId].pose.p];report.passages.followStart={ana:pa,bea:pb};
 s0=samples.length;const o1=await act(ana,'walk:outside-lamp');await tick(50);const o2=await act(bea,'walk:outside-post');
 assert.match(o1.receipt.reason??'',/thumb-turn/);const fo=await finish([[ana,o1],[bea,o2]]);assert.deepEqual(fo.map(x=>x.phase),['completed','completed'],JSON.stringify(fo));
 assert.equal(side(ana),'outside');assert.equal(side(bea),'outside');assert.deepEqual([door().open,door().locked],[false,true],'shut and locked again behind');
 const fs=samples.slice(s0);report.passages.escapeFollowing={...pairChecks(fs,'ana','bea'),handOps:handOps(fs),ana:passageChecks(fs,'ana',z,doorId),anaHandStepMax:handSteps(fs,'ana')};
 assert.ok(report.passages.escapeFollowing.anaHandStepMax<=.08,'the hand goes from the thumb-turn to the handle without a jump: '+report.passages.escapeFollowing.anaHandStepMax);
 assert.deepEqual(report.passages.escapeFollowing.handOps.map(o=>o.who+':'+o.mode),['ana:unlock','ana:open','bea:close'],JSON.stringify(report.passages.escapeFollowing.handOps));
 report.checks.push('escape with a follower: the guest unlocks from inside, the owner queued a metre behind follows and shuts it; it locks again');
 // ---- 7. the owner's key from outside: unlock, lock (explicit), then her walk in turns the key on the way and re-locks
 for(const c of [`object:${doorId}:unlock`,`object:${doorId}:lock`]){s0=samples.length;const r=await act(bea,c);const [e]=await finish([[bea,r]]);assert.equal(e.phase,'completed',c+' '+JSON.stringify(e));report.ops[c.endsWith('unlock')?'unlockOutsideKey':'lockOutsideKey']=opChecks(samples.slice(s0),'bea',c.split(':').at(-1));}
 s0=samples.length;const b7=await act(bea,'walk:inside-bench');assert.match(b7.receipt.reason??'',/your key/);const [e7]=await finish([[bea,b7]]);assert.equal(e7.phase,'completed',JSON.stringify(e7));assert.equal(side(bea),'inside');assert.deepEqual([door().open,door().locked],[false,true]);
 report.passages.ownerIn={handOps:handOps(samples.slice(s0)),bea:passageChecks(samples.slice(s0),'bea',z,doorId)};report.checks.push('the owner turns her key outside, and her walk in unlocks on the way and locks again behind');
 // ---- 8. Dee, a guest alone inside the locked store yard, walks out: thumb-turn, open, through, shut; it locks again
 assert.equal(store().locked,true);s0=samples.length;const d8=await act(dee,'walk:store-lamp');const [e8]=await finish([[dee,d8]]);assert.equal(e8.phase,'completed',JSON.stringify(e8));
 assert.ok(W.entities[dee.entityId].pose.p[2]<z,'Dee is out');assert.deepEqual([store().open??false,store().locked],[false,true],'the store door locked again behind her');
 report.passages.soloEscape={handOps:handOps(samples.slice(s0)).map(o=>o.who+':'+o.mode)};report.checks.push('a guest alone in a locked yard walks out (thumb-turn); nobody is trapped; it locks again');
 assert.deepEqual(f.host.engine.runtime.violations,[]);
 const doorObj=x=>x.objects?.find(o=>o.id===doorId);
 report.contextBytes={absent:JSON.stringify(absent).length,distant100:JSON.stringify(far).length,anaNearLocked:JSON.stringify(anaNear).length,anaNearDoor:doorObj(anaNear)??null,anaDoHereDoor:(anaNear.doHere??[]).filter(o=>o.id.includes(doorId)),beaInsideLocked:JSON.stringify(beaNear).length,beaDoHereDoor:(beaNear.doHere??[]).filter(o=>o.id.includes(doorId))};
 assert.equal(report.contextBytes.distant100,report.contextBytes.absent,'100 distant locked doors add +0 bytes');
 assert.deepEqual(report.contextBytes.anaNearDoor?.state,{open:false,locked:true},'nearby: the two existing words');
 report.pass=true;if(out){mkdirSync(out,{recursive:true});writeFileSync(out+'/summary.json',JSON.stringify(report,null,2));}console.log(JSON.stringify(report,null,1));
});
// ---- checks over samples
const dist2=(a,b)=>Math.hypot(a[0]-b[0],a[2]-b[2]);
/** A lock / unlock: the hand on the key or thumb-turn at a natural height, through the turn; root steady; torso to the door. */
function opChecks(S,who,op){
 const rows=S.filter(x=>x.bodies[who]?.motion?.op===op);assert.ok(rows.length,'a '+op+' hand operation ran');const m=rows[0].bodies[who].motion,o=m.opening,target=opPoint(o,op,0);
 let maxErr=0,minY=Infinity,maxY=-Infinity,maxStep=0,maxYaw=0;
 for(const [i,x] of rows.entries()){const t=(x.tick-m.startTick)/20,fr=handActuatorFrame(m,t),h=x.bodies[who].hands?.left??x.bodies[who].hands?.right;
  if(h&&fr.weight>.98){maxErr=Math.max(maxErr,Math.hypot(h[0]-target[0],h[1]-target[1],h[2]-target[2]));minY=Math.min(minY,h[1]);maxY=Math.max(maxY,h[1]);}
  if(i)maxStep=Math.max(maxStep,dist2(x.bodies[who].p,rows[i-1].bodies[who].p));
  if(fr.weight>.98){const n=[Math.sin(o.yaw)*o.side,Math.cos(o.yaw)*o.side],face=Math.atan2(-n[1],-n[0]),y=x.bodies[who].yaw,e=Math.abs(((y-face+Math.PI*3)%(Math.PI*2))-Math.PI);maxYaw=Math.max(maxYaw,e);}}
 assert.ok(maxErr<.04,op+' palm error '+maxErr);assert.ok(minY>=.85&&maxY<=1.1,op+' hand height '+minY+'..'+maxY);assert.ok(maxStep<=.08,op+' root step '+maxStep);
 return {side:o.side===1?'outside (key)':'inside (thumb-turn)',palmErrorMax:+maxErr.toFixed(4),handHeight:[+minY.toFixed(3),+maxY.toFixed(3)],rootStepMax:+maxStep.toFixed(4),yawErrorMax:+maxYaw.toFixed(3),samples:rows.length};
}
/** A knock: three raps, knuckles at the leaf (palm within 0.06 m of the face) and back 0.04-0.10 m between, 1.25-1.55 m high. */
function knockChecks(S,who){
 const rows=S.filter(x=>x.bodies[who]?.motion?.op==='knock');assert.ok(rows.length,'a knock ran');const m=rows[0].bodies[who].motion,o=m.opening;
 const face=(h)=>{const a=o.yaw,c=Math.cos(a),s=Math.sin(a);return Math.abs((h[0]-o.hinge[0])*s+(h[2]-o.hinge[2])*c)-.03;};
 const d=rows.map(x=>{const h=x.bodies[who].hands?.left??x.bodies[who].hands?.right;return h?{t:(x.tick-m.startTick)/20,gap:face(h),y:h[1]}:null;}).filter(Boolean);
 const contacts=knockContacts().map(tc=>{const near=d.filter(r=>Math.abs(r.t-tc)<=.06);return near.length?Math.min(...near.map(r=>r.gap)):null;});
 const lifts=knockContacts().slice(0,-1).map((tc,i)=>{const mid=d.filter(r=>r.t>tc+.05&&r.t<knockContacts()[i+1]-.05);return mid.length?Math.max(...mid.map(r=>r.gap)):null;});
 const ys=d.filter(r=>r.t>.65&&r.t<.65+1.2).map(r=>r.y);
 assert.equal(contacts.filter(g=>g!==null&&g<=.06).length,3,'three raps reach the leaf: '+JSON.stringify(contacts));assert.ok(lifts.every(g=>g!==null&&g-Math.min(...contacts)>=.04&&g<=.16),'lifted between raps: '+JSON.stringify(lifts));
 assert.ok(Math.min(...ys)>=1.25&&Math.max(...ys)<=1.55,'knock height '+Math.min(...ys)+'..'+Math.max(...ys));
 return {raps:3,contactGap:contacts.map(g=>+g.toFixed(3)),liftBetween:lifts.map(g=>+g.toFixed(3)),height:[+Math.min(...ys).toFixed(3),+Math.max(...ys).toFixed(3)],samples:rows.length};
}
function passageChecks(S,who,z){
 const crossings=[];let maxStep=0,minWalkLeaf=Infinity;
 for(let i=1;i<S.length;i++){const p=S[i-1].bodies[who].p,q=S[i].bodies[who].p,st=dist2(p,q);maxStep=Math.max(maxStep,st);
  if((p[2]-z)*(q[2]-z)<0){const u=(z-p[2])/(q[2]-p[2]);crossings.push({tick:S[i].tick,x:+(p[0]+(q[0]-p[0])*u).toFixed(3)});}
  for(const b of Object.values(S[i].bodies))if(b.motion?.opening&&!b.motion.op&&!S[i].bodies[who].motion&&Math.hypot(q[0],q[2]-z)<1.5)minWalkLeaf=Math.min(minWalkLeaf,leafDistance(b.motion.opening,handActuatorFrame(b.motion,(S[i].tick-b.motion.startTick)/20).angle,q[0],q[2]));}
 assert.equal(crossings.length,1,'one crossing: '+JSON.stringify(crossings));assert.ok(Math.abs(crossings[0].x)<.21,'crossed within the doorway: '+crossings[0].x);assert.ok(maxStep<=.12,'no pop: '+maxStep);
 return {crossings,maxStepPerTick:+maxStep.toFixed(4),minWalkLeaf:minWalkLeaf===Infinity?null:+minWalkLeaf.toFixed(3)};
}
function handOps(S){const ops=new Map();for(const x of S)for(const [n,b] of Object.entries(x.bodies))if(b.motion?.passage||b.motion?.op){const k=b.motion.actionId+n;const o=ops.get(k)??{who:n,mode:b.motion.passage?.mode??b.motion.op,from:x.tick,to:x.tick};o.to=x.tick;ops.set(k,o);}
 const list=[...ops.values()].sort((a,b)=>a.from-b.from);for(let i=1;i<list.length;i++)assert.ok(list[i].from>list[i-1].to,'never two hands on the door at once: '+JSON.stringify(list));return list;}
function pairChecks(S,a,b){let min=Infinity,at=null;for(const x of S){const p=x.bodies[a]?.p,q=x.bodies[b]?.p;if(p&&q){const d=dist2(p,q);if(d<min){min=d;at=x.tick;}}}assert.ok(min>=.52,'bodies never closer than 0.52 m: '+min);return {minBodyDistance:+min.toFixed(3),atTick:at};}
/** The largest step of the operating hand between consecutive samples where it is out (thumb-turn → handle handover). */
function handSteps(S,who){let max=0;for(let i=1;i<S.length;i++){const a=S[i-1].bodies[who]?.hands,b=S[i].bodies[who]?.hands;const p=a?.left??a?.right,q=b?.left??b?.right;if(p&&q)max=Math.max(max,Math.hypot(p[0]-q[0],p[1]-q[1],p[2]-q[2]));}return +max.toFixed(4);}
