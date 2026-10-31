// Entry 31: acceptance numbers from a real-client proof.json (day-31/ACCEPTANCE.md 1-6, 8). Re-runnable on any take.
import {readFileSync,writeFileSync} from 'node:fs';import {handActuatorFrame,handSwingSeconds,leafDistance,HAND_REACH_SECONDS} from '../../mars/viewer/engine/social/hand-actuator.ts';
const dir=process.argv[2],x=JSON.parse(readFileSync(dir+'/proof.json')),S=x.samples.filter(s=>s&&s.door),name=Object.fromEntries(Object.entries(x.ids).map(([k,v])=>[v,k]));
const DOOR=[-6,3],who=b=>name[b.id]??b.id;
// hand operations on the door, by action id
const ops=new Map();for(const s of S)for(const b of s.bodies){const m=b.motion;if(!m?.opening||m.target!==s.door.id)continue;const k=m.actionId+'|'+b.id;const o=ops.get(k)??{who:who(b),mode:m.passage?.mode??(m.opening.to===0?'close':'open'),passage:!!m.passage,from:s.tick,to:s.tick,opening:m.opening,samples:[]};o.to=s.tick;o.samples.push({s,b});ops.set(k,o);}
const list=[...ops.values()].sort((a,b)=>a.from-b.from),opening=list[0]?.opening;
const opChecks=list.map(o=>{let maxTurn=0,maxPalm=0,minLeaf=Infinity,n=0;const o2=o.opening,expected=Math.atan2(-Math.cos(o2.yaw)*o2.side,-Math.sin(o2.yaw)*o2.side);
 for(const {s,b} of o.samples){const m=b.motion,t=(s.tick-m.startTick)*s.dt;if(t<.7||t>HAND_REACH_SECONDS+handSwingSeconds(m))continue;n++;const f=handActuatorFrame(m,t);
  minLeaf=Math.min(minLeaf,leafDistance(o2,f.angle,b.p[0],b.p[2]));maxTurn=Math.max(maxTurn,Math.abs(Math.atan2(Math.sin(b.yaw-expected),Math.cos(b.yaw-expected))));const arm=b.arms?.find(a=>a.source==='hands');if(arm?.err!=null)maxPalm=Math.max(maxPalm,arm.err);}
 return {who:o.who,mode:o.mode,passage:o.passage,ticks:[o.from,o.to],side:o2.side,heldSamples:n,maxTurn:+maxTurn.toFixed(3),maxPalmError:+maxPalm.toFixed(4),minLeafClearance:+minLeaf.toFixed(3),pass:n>5&&maxTurn<Math.PI/6&&maxPalm<.04&&minLeaf>.355};});
const overlaps=list.filter((o,i)=>i&&o.from<=list[i-1].to).map(o=>o.ticks);
// per body: crossings of the door line, walking clearance from the drawn leaf, root steps per depicted tick
const bodies={};for(const id of Object.values(x.ids)){const B=S.map(s=>({s,b:s.bodies.find(b=>b.id===id)})).filter(r=>r.b);const crossings=[];let minWalkLeaf=Infinity,maxStep=0,maxStepAt=null;
 for(let i=1;i<B.length;i++){const p=B[i-1].b.p,q=B[i].b.p,dt=B[i].s.tick-B[i-1].s.tick;if(dt>=1){const st=Math.hypot(q[0]-p[0],q[2]-p[2])/dt;if(st>maxStep){maxStep=st;maxStepAt=B[i].s.tick;}}
  if((p[2]-DOOR[1])*(q[2]-DOOR[1])<0){const u=(DOOR[1]-p[2])/(q[2]-p[2]);crossings.push({tick:B[i].s.tick,offset:+(p[0]+(q[0]-p[0])*u-DOOR[0]).toFixed(3),to:q[2]>DOOR[1]?'inside':'outside'});}
  if(opening&&B[i].s.door.angle!=null&&!B[i].b.motion&&Math.hypot(q[0]-DOOR[0],q[2]-DOOR[1])<1.5)minWalkLeaf=Math.min(minWalkLeaf,leafDistance(opening,B[i].s.door.angle,q[0],q[2]));}
 bodies[name[id]]={crossings,minWalkLeaf:+minWalkLeaf.toFixed(3),maxStepPerTick:+maxStep.toFixed(4),maxStepAt,pass:crossings.every(c=>Math.abs(c.offset)<.21)&&minWalkLeaf>=.30&&maxStep<=.12};}
let minPair=Infinity,minPairAt=null;for(const s of S){const [a,b]=Object.values(x.ids).map(id=>s.bodies.find(q=>q.id===id));if(a&&b){const d=Math.hypot(a.p[0]-b.p[0],a.p[2]-b.p[2]);if(d<minPair){minPair=d;minPairAt=s.tick;}}}
const phases=x.commands.map(c=>({seat:c.seat,words:c.words,accepted:c.result?.accepted,phase:c.result?.receipt?.phase??null,code:c.result?.receipt?.code??c.result?.error?.code??c.result?.code??null,reason:c.result?.receipt?.reason??c.result?.error?.message??c.result?.reason??null,seconds:+((c.end-c.start)/1000).toFixed(1)}));
const last=S.at(-1),storeMoved=S.some(s=>s.store?.angle&&Math.abs(s.store.angle)>.01);
const out={samples:S.length,ticks:[S[0].tick,last.tick],handOps:opChecks,overlappingHandOps:overlaps,bodies,minBodyDistance:+minPair.toFixed(3),minBodyDistanceAt:minPairAt,commands:phases,doorEndsClosed:last.door.state.open===false,storeDoorNeverMoved:!storeMoved,storeLocked:last.store?.state?.locked===true,errors:x.errors};
out.pass=opChecks.every(o=>o.pass)&&!overlaps.length&&Object.values(bodies).every(b=>b.pass)&&minPair>=.52&&out.doorEndsClosed&&out.storeDoorNeverMoved&&phases.every((p,i)=>i===phases.length-1?p.accepted===false:p.phase==='completed')&&!x.errors.length;
writeFileSync(dir+'/checks.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,1));
