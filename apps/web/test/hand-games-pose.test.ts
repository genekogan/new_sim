// Entry 35 (packet 44): holding hands and rock-paper-scissors drawn on the real rig through the replay path
// (HumanViews.setFrame → render), from the recorded body state alone: the joined palms meet between the two bodies
// (standing and walking), arms within reach and in the lane between the bodies; the RPS fists count in step and throw
// rock, paper and scissors on the finger bones; every frame-to-frame palm step stays within the entry's bounds.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {HumanViews,type SampledHuman} from '../../../mars/viewer/app/engine-view/humans.ts';
import {templateFromGltf,type Template} from '../../../mars/viewer/app/engine-view/people.ts';
import {HAND_GAP,JOIN_SECONDS,RELEASE_SECONDS,HAND_STATE_TAIL,type HandHoldState} from '../../../mars/viewer/engine/social/hand-hold.ts';
import {RPS,type RpsShape} from '../../../mars/viewer/engine/social/rps.ts';

const DT=.05;
const tpls:Record<string,Template>={};
async function views(name='casual'){
 if(!tpls[name]){
  const source=readFileSync(new URL(`../../../mars/viewer/public/modular/environment/animated-${name}.glb`,import.meta.url));
  const jsonSize=source.readUInt32LE(12),json=JSON.parse(source.subarray(20,20+jsonSize).toString()),binHeader=20+jsonSize;
  json.materials=json.materials.map(()=>({pbrMetallicRoughness:{baseColorFactor:[.5,.5,.5,1],metallicFactor:0,roughnessFactor:.8}}));delete json.textures;delete json.images;delete json.samplers;
  let chunk=Buffer.from(JSON.stringify(json));chunk=Buffer.concat([chunk,Buffer.alloc((4-chunk.length%4)%4,32)]);const bin=source.subarray(binHeader);
  const header=Buffer.alloc(20);source.copy(header,0,0,12);header.writeUInt32LE(20+chunk.length+bin.length,8);header.writeUInt32LE(chunk.length,12);header.writeUInt32LE(0x4e4f534a,16);
  const bytes=Buffer.concat([header,chunk,bin]);tpls[name]=templateFromGltf('hg-'+name,await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),''));
 }
 const v=new HumanViews();v.setTemplates([tpls[name]]);return v;
}
type Bones={arms:{side:string;palm:number[];shoulder:number[];len:number}[];hipY:number;handGame?:{kind:string;w:number;curl:number[];shape?:string}};
const draw=(v:HumanViews,fs:SampledHuman[],k:number)=>{v.setFrame(fs,k*DT);v.render(1);return v.bones() as unknown as Record<string,Bones>;};
const palmOf=(b:Bones,side:string)=>b.arms.find(a=>a.side===side)!.palm;
const d3=(a:number[],b:number[])=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
/** Body-frame palm step: palm minus root, rotated into the body's heading (walking the body does not count). */
const bodyStep=(a:number[],pa:number[],ya:number,b:number[],pb:number[],yb:number)=>{const l=(q:number[],p:number[],y:number)=>{const x=q[0]-p[0],z=q[2]-p[2];return [x*Math.cos(y)+z*Math.sin(y),q[1]-p[1],-x*Math.sin(y)+z*Math.cos(y)];};return d3(l(a,pa,ya),l(b,pb,yb));};

test('holding hands: palms meet palm to palm between the bodies, standing and walking; join and release are smooth',async()=>{
 const v=await views(),since=100,release=since+Math.round((JOIN_SECONDS+3)/DT)+60;
 const hold=(hand:'left'|'right',other:string,k:number):HandHoldState=>({with:other,hand,...(hand==='right'?{offered:since-30}:{}),...(k>=since?{since}:{}),...(k>=release?{release}:{})});
 // a stands still for the offer and the join, both walk along +x at 1 m/s for 3 s, stop, stand, let go
 const walkFrom=since+Math.round((JOIN_SECONDS+.5)/DT),walkTo=walkFrom+60;
 const x=(k:number)=>k<walkFrom?0:k<walkTo?(k-walkFrom)*DT*1.0:(walkTo-walkFrom)*DT*1.0;
 const wOf=(k:number)=>{const s=(u:number)=>u<=0?0:u>=1?1:u*u*(3-2*u);return Math.max(0,Math.min(s((k-walkFrom+5)/11),1-s((k-walkTo+5)/11)));};
 let worstFace=-1,worstGap=0,worstReach=0,minLane=Infinity,worstStep=0,worstWalkStep=0,prev:{a:number[][];pa:number[];b:number[][];pb:number[]}|null=null;const kinds=new Set<string>();
 for(let k=since-40;k<=release+Math.round((RELEASE_SECONDS+HAND_STATE_TAIL)/DT)+10;k++){
  const xa=x(k),pa:[number,number,number]=[xa,0,0],pb:[number,number,number]=[xa,0,HAND_GAP],w=wOf(k);
  const f=(id:string,p:[number,number,number],hand:'left'|'right',other:string):SampledHuman=>({id,p,yaw:0,walk:w,walkDist:xa,activity:w>.02?'walk':'idle',speed:w>.02?1:0,restAge:30,handHold:hold(hand,other,k),handGameTick:k,handGameDt:DT});
  const B=draw(v,[f('hg_a',pa,'right','hg_b'),f('hg_b',pb,'left','hg_a')],k),A=B.hg_a,Bb=B.hg_b;
  if(A.handGame)kinds.add(A.handGame.kind);
  const joined=k>=since+JOIN_SECONDS/DT&&k<release;
  if(joined){const L=palmOf(A,'right'),R=palmOf(Bb,'left');worstGap=Math.max(worstGap,d3(L,R));const na=(A.handGame as unknown as {normal:number[]}).normal,nb=(Bb.handGame as unknown as {normal:number[]}).normal;worstFace=Math.max(worstFace,na[0]*nb[0]+na[1]*nb[1]+na[2]*nb[2]);
   for(const [b,side,p] of [[A,'right',pa],[Bb,'left',pb]] as const){const arm=b.arms.find(a=>a.side===side)!;worstReach=Math.max(worstReach,d3(arm.palm,arm.shoulder)/arm.len);minLane=Math.min(minLane,Math.abs(arm.palm[2]-p[2]));}}
  const now={a:A.arms.map(a=>a.palm),pa,b:Bb.arms.map(a=>a.palm),pb};
  if(prev){for(const [q0,p0,q1,p1] of [[prev.a,prev.pa,now.a,now.pa],[prev.b,prev.pb,now.b,now.pb]] as const)for(let j=0;j<2;j++){const s=bodyStep(q0[j],p0,0,q1[j],p1,0);if(w>.02||wOf(k-1)>.02){if(s>worstWalkStep&&process.env.HG_DEBUG)console.log('walkstep',k,j,s.toFixed(3),w.toFixed(2));worstWalkStep=Math.max(worstWalkStep,s);}else{if(s>worstStep&&process.env.HG_DEBUG)console.log('step',k,j,s.toFixed(3));worstStep=Math.max(worstStep,s);}}}
  prev=now;
 }
 if(process.env.HG_DEBUG)console.log({worstFace,worstGap,worstReach,minLane,worstStep,worstWalkStep,kinds:[...kinds]});
 assert.deepEqual([...kinds].sort(),['hold','offer']);
 assert.ok(worstFace<=-.8,`the two joined palms face each other (normals' dot ${worstFace.toFixed(3)})`);
 assert.ok(worstGap<=.06,`joined palm centres ${worstGap.toFixed(3)} m apart (≤ 0.06: palm to palm)`);
 assert.ok(worstReach<=.9,`joined arm reach ${worstReach.toFixed(3)} arm lengths (no stretching)`);
 assert.ok(minLane>=.17,`joined palms ${minLane.toFixed(3)} m from a body axis (in the lane between them)`);
 assert.ok(worstStep<=.08,`standing palm step ${worstStep.toFixed(3)} m per 50 ms (offer, join, release)`);
 assert.ok(worstWalkStep<=.12,`walking palm step ${worstWalkStep.toFixed(3)} m per 50 ms`);
});

for(const shape of ['rock','paper','scissors'] as RpsShape[])test(`rock-paper-scissors (${shape}): three pumps in step, the throw on the fourth beat, ${shape} on the finger bones`,async()=>{
 const v=await views(),start=100,shoot=start+Math.round(RPS.SHOOT/DT);
 let worstBoundary=0,worstInterior=0,prev:{q:number[];r:number[]}|null=null;const lows:number[][]=[[],[]];let held:number[]|null=null,heldPrev=Infinity,facingAt:{normal:number[];curlSide:number}|null=null;
 const ys:number[][]=[[],[]];
 for(let k=start-10;k<=start+Math.round(RPS.SECONDS/DT)+5;k++){
  const rps=(s:RpsShape)=>({start,shoot,...(k>=shoot?{shape:s}:{})});
  const end=start+Math.round(RPS.SECONDS/DT),f=(id:string,p:[number,number,number],yaw:number,s:RpsShape):SampledHuman=>({id,p,yaw,walk:0,walkDist:0,activity:k>=start&&k<end?'rps':'idle',...(k<start?{restAge:30}:k>=end?{restAge:(k-end)*DT}:{}),...(k>=start&&k<start+RPS.SECONDS/DT?{rps:rps(s),handGameTick:k,handGameDt:DT}:{})});
  const B=draw(v,[f('rps_a',[0,0,0],0,shape),f('rps_b',[1,0,0],Math.PI,'rock')],k),A=B.rps_a;
  const q=palmOf(A,'right'),r=palmOf(B.rps_b,'right');ys[0].push(q[1]);ys[1].push(r[1]);
  if(prev){const s=Math.max(d3(prev.q,q),d3(prev.r,r)),t=(k-start)*DT,near=[0,RPS.RAISE,RPS.FIRST,RPS.FIRST+RPS.BEAT,RPS.FIRST+2*RPS.BEAT,RPS.SHOOT,RPS.HOLD_END,RPS.DOWN_END].some(b=>Math.abs(t-b)<=.5);
   if(t>RPS.FIRST-RPS.BEAT&&t<RPS.SHOOT+.3)worstInterior=Math.max(worstInterior,s);if(near){if(s>worstBoundary&&process.env.HG_DEBUG)console.log('bstep',t.toFixed(2),s.toFixed(3),d3(prev.q,q).toFixed(3),d3(prev.r,r).toFixed(3));worstBoundary=Math.max(worstBoundary,s);}}
  prev={q,r};
  if(k===shoot+20){held=A.handGame!.curl;facingAt=(A.handGame as unknown as {normal:number[];curlSide:number});}
  if(k===shoot-5)heldPrev=A.handGame!.curl[0];
 }
 // the low points of both fists fall on the same samples (one shared count)
 for(const y of ys){const idx:number[]=[];for(let i=1;i+1<y.length;i++)if(y[i]<y[i-1]&&y[i]<=y[i+1])idx.push(i);lows[ys.indexOf(y)]=idx;}
 if(process.env.HG_DEBUG)console.log(shape,{worstBoundary,worstInterior,held,facingAt});
 const want=[RPS.FIRST,RPS.FIRST+RPS.BEAT,RPS.FIRST+2*RPS.BEAT].map(t=>Math.round(t/DT)+10);
 for(const k of want)assert.ok(lows[0].some(i=>Math.abs(i-k)<=1)&&lows[1].some(i=>Math.abs(i-k)<=1),`both fists down on the beat at sample ${k}: ${lows[0]} / ${lows[1]}`);
 assert.ok(worstInterior<=.10,`count interior ${worstInterior.toFixed(3)} m per 50 ms`);
 assert.ok(worstBoundary<=.10,`near the boundaries ${worstBoundary.toFixed(3)}`);
 const [ix,mid,ring,pinky]=held!;
 assert.ok(heldPrev>=1.6,'a fist while counting');
 if(shape==='rock'){assert.ok([ix,mid,ring,pinky].every(c=>c>=1.6),'rock: all curled '+held);assert.ok(facingAt!.curlSide>.01,'the fingers curl to the palm side of the drawn palm frame');}
 if(shape==='paper')assert.ok(facingAt!.normal[1]<-.9,'paper: palm down '+facingAt!.normal);
 if(shape==='scissors')assert.ok(facingAt!.normal[2]<-.8,'scissors: palm in (the right hand, facing +x: in is −z) '+facingAt!.normal);
 if(shape==='paper')assert.ok([ix,mid,ring,pinky].every(c=>c<=.35),'paper: all straight '+held);
 if(shape==='scissors')assert.ok(ix<=.35&&mid<=.35&&ring>=1.6&&pinky>=1.6,'scissors: two out, two in '+held);
});
