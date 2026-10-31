// Entry 32: acceptance numbers from a real-client proof.json (day-32/ACCEPTANCE.md 0-5, 7-9). Re-runnable on any take.
import {readFileSync,writeFileSync} from 'node:fs';import {handActuatorFrame,handSwingSeconds,leafDistance,opPoint,knockContacts,HAND_REACH_SECONDS,LOCK_TURN_SECONDS} from '../../mars/viewer/engine/social/hand-actuator.ts';
const dir=process.argv[2],x=JSON.parse(readFileSync(dir+'/proof.json')),S=x.samples.filter(s=>s&&s.door),name=Object.fromEntries(Object.entries(x.ids).map(([k,v])=>[v,k]));
const DOOR=[-6,3],who=b=>name[b.id]??b.id,dt=S[0].dt;
const handArm=b=>b.arms?.find(a=>a.source==='hands');
// hand operations on the door, by action id
const ops=new Map();for(const s of S)for(const b of s.bodies){const m=b.motion;if(!m?.opening||m.target!==s.door.id)continue;const k=m.actionId+'|'+b.id;const o=ops.get(k)??{who:who(b),mode:m.op??m.passage?.mode??(m.opening.to===0?'close':'open'),passage:!!m.passage,relock:!!m.passage?.relock,from:s.tick,to:s.tick,m,samples:[]};o.to=s.tick;o.samples.push({s,b});ops.set(k,o);}
const list=[...ops.values()].sort((a,b)=>a.from-b.from);
// standing pelvis height per body (idle, not walking): the knee-bend reference
const hip={};for(const id of Object.values(x.ids)){const h=S.map(s=>s.bodies.find(b=>b.id===id)).filter(b=>b&&b.activity==='idle'&&!b.motion&&b.hipY).map(b=>b.hipY).sort((a,b)=>a-b);hip[id]=h.length?h[Math.floor(h.length/2)]:null;}
const yawErr=(o,y)=>{const e=Math.atan2(-Math.cos(o.yaw)*o.side,-Math.sin(o.yaw)*o.side);return Math.abs(Math.atan2(Math.sin(y-e),Math.cos(y-e)));};
const opChecks=list.map(o=>{const m=o.m,oo=m.opening,swing=handSwingSeconds(m);let maxTurn=0,maxPalm=0,minLeaf=Infinity,n=0,minY=Infinity,maxY=-Infinity,maxDrop=0,boltX=[],thumb=[],keySeen=0,stateAt=null;
 for(const {s,b} of o.samples){const t=(s.tick-m.startTick)*dt;const arm=handArm(b);
  if(m.op==='lock'||m.op==='unlock'){if(s.door.bolt)boltX.push(s.door.bolt.x);if(s.door.thumb)thumb.push(s.door.thumb.rz);if(s.door.key?.visible)keySeen++;}
  if(t<.7||t>HAND_REACH_SECONDS+swing)continue;n++;const f=handActuatorFrame(m,t);
  if(!m.op)minLeaf=Math.min(minLeaf,leafDistance(oo,f.angle,b.p[0],b.p[2]));maxTurn=Math.max(maxTurn,yawErr(oo,b.yaw));if(arm?.err!=null)maxPalm=Math.max(maxPalm,arm.err);
  if(arm){minY=Math.min(minY,arm.palm[1]);maxY=Math.max(maxY,arm.palm[1]);}if(hip[b.id]&&b.hipY)maxDrop=Math.max(maxDrop,hip[b.id]-b.hipY);}
 // the lock's state lands at the end of the turn, not before (first sample with the new state, seconds into the motion)
 if(m.op==='lock'||m.op==='unlock'){const want=m.op==='lock',flip=S.find(s=>s.tick>=m.startTick&&s.door.state.locked===want);stateAt=flip?+((flip.tick-m.startTick)*dt).toFixed(2):null;}
 const out={who:o.who,mode:o.mode,passage:o.passage,relock:o.relock,ticks:[o.from,o.to],side:oo.side,heldSamples:n,maxTurn:+maxTurn.toFixed(3),maxPalmError:+maxPalm.toFixed(4),pelvisDrop:+maxDrop.toFixed(3)};
 if(m.op==='lock'||m.op==='unlock'){Object.assign(out,{palmHeight:[+minY.toFixed(3),+maxY.toFixed(3)],boltTravel:boltX.length?+(Math.max(...boltX)-Math.min(...boltX)).toFixed(3):null,thumbTurn:thumb.length?+(Math.max(...thumb)-Math.min(...thumb)).toFixed(3):null,keyShownSamples:keySeen,stateLandsAt:stateAt,turnEndsAt:+(HAND_REACH_SECONDS+LOCK_TURN_SECONDS).toFixed(2)});
  out.pass=n>5&&maxTurn<Math.PI/6&&maxPalm<.04&&minY>=.85&&maxY<=1.1&&maxDrop<.05&&out.boltTravel>=.05&&Math.abs(out.thumbTurn-Math.PI/2)<.05&&stateAt!==null&&stateAt>=out.turnEndsAt-.1;}
 else if(m.op==='knock'){const face=p=>Math.abs((p[0]-oo.hinge[0])*Math.sin(oo.yaw)+(p[2]-oo.hinge[2])*Math.cos(oo.yaw))-.03;const rows=o.samples.map(({s,b})=>({t:(s.tick-m.startTick)*dt,arm:handArm(b)})).filter(r=>r.arm);
  const contacts=knockContacts().map(tc=>{const near=rows.filter(r=>Math.abs(r.t-tc)<=.08);return near.length?+Math.min(...near.map(r=>face(r.arm.palm))).toFixed(3):null;});
  const lifts=knockContacts().slice(0,-1).map((tc,i)=>{const mid=rows.filter(r=>r.t>tc+.05&&r.t<knockContacts()[i+1]-.05);return mid.length?+Math.max(...mid.map(r=>face(r.arm.palm))).toFixed(3):null;});
  Object.assign(out,{contactGap:contacts,liftBetween:lifts,palmHeight:[+minY.toFixed(3),+maxY.toFixed(3)]});
  out.pass=n>5&&maxTurn<Math.PI/6&&contacts.every(g=>g!==null&&g<=.06)&&lifts.every((g,i)=>g!==null&&g-Math.min(contacts[i],contacts[i+1])>=.04&&g-Math.min(contacts[i],contacts[i+1])<=.10)&&minY>=1.25&&maxY<=1.55&&maxDrop<.05;}
 else{out.minLeafClearance=+minLeaf.toFixed(3);out.pass=n>5&&maxTurn<Math.PI/6&&maxPalm<.04&&minLeaf>.355;}
 return out;});
const overlaps=list.filter((o,i)=>i&&o.from<=list[i-1].to).map(o=>[o.who,o.mode,o.ticks]);
// per body: crossings of the door line, walking clearance from the drawn leaf, root steps per depicted tick
const bodies={};for(const id of Object.values(x.ids)){const B=S.map(s=>({s,b:s.bodies.find(b=>b.id===id)})).filter(r=>r.b);const crossings=[];let minWalkLeaf=Infinity,maxStep=0,maxStepAt=null,maxOpStep=0;
 for(let i=1;i<B.length;i++){const p=B[i-1].b.p,q=B[i].b.p,d=B[i].s.tick-B[i-1].s.tick;if(d>=1){const st=Math.hypot(q[0]-p[0],q[2]-p[2])/d;if(st>maxStep){maxStep=st;maxStepAt=B[i].s.tick;}if(B[i].b.motion&&B[i-1].b.motion&&B[i].b.motion.actionId===B[i-1].b.motion.actionId)maxOpStep=Math.max(maxOpStep,st);}
  if((p[2]-DOOR[1])*(q[2]-DOOR[1])<0){const u=(DOOR[1]-p[2])/(q[2]-p[2]);crossings.push({tick:B[i].s.tick,offset:+(p[0]+(q[0]-p[0])*u-DOOR[0]).toFixed(3),to:q[2]>DOOR[1]?'inside':'outside'});}
  const leafOwner=B[i].s.bodies.find(o=>o.motion?.opening&&!o.motion.op);if(B[i].s.door.angle!=null&&Math.abs(B[i].s.door.angle)>.05&&!B[i].b.motion&&Math.hypot(q[0]-DOOR[0],q[2]-DOOR[1])<1.5){const o=(leafOwner?.motion??list.find(l=>!l.m.op)?.m)?.opening;if(o)minWalkLeaf=Math.min(minWalkLeaf,leafDistance(o,B[i].s.door.angle,q[0],q[2]));}}
 bodies[name[id]]={crossings,minWalkLeaf:minWalkLeaf===Infinity?null:+minWalkLeaf.toFixed(3),maxStepPerTick:+maxStep.toFixed(4),maxStepAt,maxOperationStepPerTick:+maxOpStep.toFixed(4),pass:crossings.every(c=>Math.abs(c.offset)<.21)&&(minWalkLeaf===Infinity||minWalkLeaf>=.30)&&maxStep<=.12&&maxOpStep<=.08};}
let minPair=Infinity,minPairAt=null;for(const s of S){const [a,b]=Object.values(x.ids).map(id=>s.bodies.find(q=>q.id===id));if(a&&b){const d=Math.hypot(a.p[0]-b.p[0],a.p[2]-b.p[2]);if(d<minPair){minPair=d;minPairAt=s.tick;}}}
const phases=x.commands.map(c=>({seat:c.seat,words:c.words,accepted:c.result?.accepted,phase:c.result?.receipt?.phase??null,code:c.result?.receipt?.code??c.result?.error?.code??c.result?.code??null,reason:c.result?.receipt?.reason??c.result?.error?.message??c.result?.reason??null,seconds:+((c.end-c.start)/1000).toFixed(1)}));
const refusals=phases.filter(p=>p.accepted===false),stateAt=label=>{const m=x.marks.find(k=>k.label===label);const s=m&&S.find(s=>s.tick>=m.tick);return s?{open:s.door.state.open??false,locked:s.door.state.locked??false}:null;};
let ev={};try{const e=JSON.parse(readFileSync(dir+'/events.json'));const n=v=>JSON.stringify(v).match(/knocks at courtyard-door/g)?.length??0;ev={beaKnockEvents:n(e.after.bea)-n(e.before.bea),adaKnockEvents:n(e.after.ada)-n(e.before.ada)};}catch{}
const sounds=(x.contacts??[]).reduce((a,c)=>(a[c.kind]=(a[c.kind]??0)+1,a),{});
const last=S.at(-1);
const out={samples:S.length,ticks:[S[0].tick,last.tick],handOps:opChecks,overlappingHandOps:overlaps,bodies,minBodyDistance:+minPair.toFixed(3),minBodyDistanceAt:minPairAt,commands:phases,refusals,knockEvents:ev,sounds,
 doorAt:{afterLock:stateAt('3-refused'),afterEscapeFollowing:stateAt('7-key'),end:{open:last.door.state.open??false,locked:last.door.state.locked??false}},errors:x.errors};
out.pass=opChecks.every(o=>o.pass)&&!overlaps.length&&Object.values(bodies).every(b=>b.pass)&&minPair>=.52&&refusals.length===2&&refusals.every(r=>/Bea/.test(r.reason??''))&&phases.filter(p=>p.accepted!==false).every(p=>p.phase==='completed')
 &&ev.beaKnockEvents===1&&ev.adaKnockEvents===0&&out.doorAt.afterLock?.locked===true&&out.doorAt.afterEscapeFollowing?.locked===true&&out.doorAt.end.locked===true&&out.doorAt.end.open===false&&!x.errors.length;
writeFileSync(dir+'/checks.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,1));
