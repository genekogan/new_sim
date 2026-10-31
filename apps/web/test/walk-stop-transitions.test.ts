// Entry 39 (M04), takes 4+: a walk stop on the real rig, drawn through the replay path (HumanViews.setFrame) with the
// replay's own walk weight and idle-onset clock (walk-ease.ts), for stops landing at 16 phases of the stride.
// Take 3's tap stop: 0.094 m per 50 ms on the right hand while the weight eased out, because the folded arms came in at
// the ease's rate on top of the arm swing settling; then she reached for the tap with her feet sliding from the fold-arms
// stance back to Idle's (the gesture clips stand with the other foot forward).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {HumanViews,type SampledHuman} from '../../../mars/viewer/app/engine-view/humans.ts';
import {templateFromGltf,type Template} from '../../../mars/viewer/app/engine-view/people.ts';
import {hashId} from '../../../mars/viewer/app/engine-view/people-light.ts';
import {easedOut,gaitSegments,lastFullStride,walkWeightAt} from '../../../mars/viewer/app/engine-view/walk-ease.ts';
import {POS_Q,type PoseSample} from '../../../mars/viewer/engine/take/types.ts';

const DT=.05;
let tpl:Template|null=null;
async function views(){
 if(!tpl){
  const source=readFileSync(new URL('../../../mars/viewer/public/modular/environment/animated-casual.glb',import.meta.url));
  const jsonSize=source.readUInt32LE(12),json=JSON.parse(source.subarray(20,20+jsonSize).toString()),binHeader=20+jsonSize;
  json.materials=json.materials.map(()=>({pbrMetallicRoughness:{baseColorFactor:[.5,.5,.5,1],metallicFactor:0,roughnessFactor:.8}}));delete json.textures;delete json.images;delete json.samplers;
  let chunk=Buffer.from(JSON.stringify(json));chunk=Buffer.concat([chunk,Buffer.alloc((4-chunk.length%4)%4,32)]);const bin=source.subarray(binHeader);
  const header=Buffer.alloc(20);source.copy(header,0,0,12);header.writeUInt32LE(20+chunk.length+bin.length,8);header.writeUInt32LE(chunk.length,12);header.writeUInt32LE(0x4e4f534a,16);
  const bytes=Buffer.concat([header,chunk,bin]);tpl=templateFromGltf('m04-canonical',await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),''));
 }
 const v=new HumanViews();v.setTemplates([tpl]);return v;
}
/** A person id whose idle variety (humans.ts neutralWeight / idleVariant) is off over [t0, t1] s, or (fold) is
 *  Idle_FoldArms_Loop at full weight over that span with Idle_Neutral off. */
function idWith(fold:boolean,t0:number,t1:number){
 for(let i=0;i<20000;i++){const id='h_stop'+i,h=hashId(id);
  const n=(t:number)=>((t/25+(h%997)/997)%1)*25<7;
  const g=(t:number)=>{const cyc=t/37+((h>>>7)%991)/991,u=(cyc%1)*37;return u<10.2?{clip:['Idle_LookAround_Loop','Idle_FoldArms_Loop'][(Math.floor(cyc)+h)%2],full:u>=1.2&&u<9}:null;};
  let ok=true;for(let t=t0;t<=t1;t+=.25){const c=g(t);if(n(t)||(fold?!(c&&c.clip==='Idle_FoldArms_Loop'&&c.full):!!c)){ok=false;break;}}
  if(ok)return id;}
 throw new Error('no id');
}
/** The engine's arrival: 1.2 m/s along +x, slowing over the last 0.4 s to rest at `stopAt` metres (a keyframe per tick). */
function arrival(stopAt:number,t0:number){
 const v0=1.2,slow=8,decel=v0/(slow*DT),cruise=stopAt-v0*v0/(2*decel),k1=t0+Math.round(cruise/v0/DT);
 const track:PoseSample[]=[[0,0,0,0,0],[t0,0,0,0,0]];
 for(let k=t0+1;k<=k1;k++)track.push([k,Math.round((k-t0)*DT*v0*POS_Q),0,0,0]);
 const x1=(k1-t0)*DT*v0;for(let j=1;j<=slow;j++){const tt=j*DT;track.push([k1+j,Math.round((x1+v0*tt-decel*tt*tt/2)*POS_Q),0,0,0]);}
 const kr=k1+slow;track.push([kr+400,track.at(-1)![1],0,0,0]);
 return {track,kr};
}
/** Replay frames around the stop as take-replay gives them: walk weight, metres walked, the onset clock (restAge from the
 *  last full stride's eased-out tick), walking until the weight has left and idle after. `reach`: a hand actuator on the
 *  right hand from that many ticks after the rest. */
function frames(id:string,stopAt:number,to=40,reach?:number){
 const {track,kr}=arrival(stopAt,40),seg=gaitSegments([{track,offset:0}],DT);
 const xAt=(k:number)=>{const i=track.findIndex(s=>s[0]>k);if(i<0)return track.at(-1)![1]/POS_Q;const a=track[i-1],b=track[i];return (a[1]+(b[1]-a[1])*(k-a[0])/(b[0]-a[0]))/POS_Q;};
 const out:{k:number;f:SampledHuman}[]=[];
 for(let k=kr-30;k<=kr+to;k++){
  const x=xAt(k),w=walkWeightAt(seg,k,DT),full=lastFullStride(seg,0,k,DT),e=full===null?null:easedOut(seg,full,k,DT);
  const restAge=full===null?30+k*DT:Math.max(0,k-(e??k))*DT,at:[number,number,number]=[x+.5,1.14,.2];
  const r=reach!==undefined&&k>=kr+reach?{activity:'operate',hands:{right:at},handActuator:{target:'tap',at,startTick:kr+reach},handActuatorTime:k*DT}:{activity:w>.02&&k<kr?'walk':'idle'};
  out.push({k,f:{id,p:[x,0,0],yaw:0,walk:w,walkDist:x,restAge,speed:Math.abs(xAt(k+3)-xAt(k-3))/(6*DT),...r}});
 }
 return {out,kr};
}
async function measure(id:string,stopAt:number,to=40,reach?:number){
 const v=await views(),{out,kr}=frames(id,stopAt,to,reach);
 const rows=out.map(({k,f})=>{v.setFrame([f],k*DT);v.render(1);const b=v.bones(id)[id] as unknown as {arms:{palm:number[]}[];feet:number[][];variety:number};return {k,x:f.p[0],w:f.walk,variety:b.variety,palms:b.arms.map(a=>a.palm),feet:b.feet};});
 let palm=0,at=0,slide=0,standSlide=0;
 for(let i=1;i<rows.length;i++){const a=rows[i-1],b=rows[i];
  if(!(a.w>=.9&&b.w>=.9))for(let j=0;j<2;j++){const s=Math.hypot(b.palms[j][0]-b.x-(a.palms[j][0]-a.x),b.palms[j][1]-a.palms[j][1],b.palms[j][2]-a.palms[j][2]);if(s>palm){palm=s;at=b.k-kr;}}
  const lo=b.feet[0][1]<b.feet[1][1]?0:1,fs=Math.hypot(b.feet[lo][0]-a.feet[lo][0],b.feet[lo][2]-a.feet[lo][2]);
  if(.1<Math.max(a.w,b.w)&&Math.min(a.w,b.w)<.9)slide=Math.max(slide,fs);
  if(a.w===0&&b.w===0)for(let j=0;j<2;j++)standSlide=Math.max(standSlide,Math.hypot(b.feet[j][0]-a.feet[j][0],b.feet[j][2]-a.feet[j][2]));}
 return {palm,at,slide,standSlide,rows,kr};
}
const STRIDE=1.2064*1.3333;

test('a walk stop at 16 phases of the stride: the palms settle within 0.08 m per 50 ms, the leg phase stays with the metres walked',async()=>{
 const id=idWith(false,0,14);let worst=0,slide=0;
 for(let i=0;i<16;i++){const r=await measure(id,6+STRIDE*i/16);worst=Math.max(worst,r.palm);slide=Math.max(slide,r.slide);
  if(process.env.M04_DEBUG)console.log('stop',i,'palm',r.palm.toFixed(3),'@',r.at,'slide',r.slide.toFixed(3));}
 if(process.env.M04_DEBUG)console.log('worst',worst,'slide',slide);
 assert.ok(worst<=.08,`palm step at a stop ${worst.toFixed(3)} m per 50 ms`);
});

test('a stop inside a fold-arms window: the walk eases out first, then the arms fold over the onset (not stacked)',async()=>{
 const id=idWith(true,5.5,10);let worst=0;
 for(let i=0;i<8;i++){const r=await measure(id,6+STRIDE*i/8);worst=Math.max(worst,r.palm);
  const easing=r.rows.filter(x=>x.w>.02),last=r.rows.at(-1)!;
  assert.ok(easing.every(x=>x.variety<1e-3),'no gesture while the walk is still easing out: '+Math.max(...easing.map(x=>x.variety)));
  assert.ok(last.variety>.99,'the arms are folded 2 s after the stop: '+last.variety);
  assert.ok(r.standSlide<1e-3,`the feet stay put while the arms fold (standing slide ${r.standSlide.toFixed(4)} m per tick)`);
  if(process.env.M04_DEBUG)console.log('fold stop',i,'palm',r.palm.toFixed(3),'@',r.at,'stand slide',r.standSlide.toFixed(4));}
 assert.ok(worst<=.08,`palm step ${worst.toFixed(3)}`);
});

test('a reach out of folded arms right after a stop: the arms unfold over the reach, the feet stay in the Idle stance',async()=>{
 const id=idWith(true,5.5,12),{rows,palm,standSlide}=await measure(id,6,80,45);
 const feet=rows.at(-1)!.feet.map(f=>[f[0]-rows.at(-1)!.x,f[2]]);
 if(process.env.M04_DEBUG)console.log('reach palm',palm.toFixed(3),'stand slide',standSlide.toFixed(4),'feet',JSON.stringify(feet));
 assert.ok(rows.find(r=>r.k===rows[0].k+30+45)!.variety>.5,'folded arms are playing when the reach starts');
 assert.ok(standSlide<1e-3,`no foot moves while she stands, folds and reaches (${standSlide.toFixed(4)} m per tick)`);
 assert.ok(palm<=.08,`palm step ${palm.toFixed(3)} m per 50 ms from 1.5 s before the stop to 2 s after the reach`);
});
