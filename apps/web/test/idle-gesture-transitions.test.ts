// Entry 39 (M04): an idle gesture playing when a hand reach or a walk starts fades out instead of being cut in one frame.
// Real canonical rig and clips (animated-casual.glb, textures stripped as in body-identity.test.ts), drawn through the
// replay path (HumanViews.setFrame), with the idle variety forced on: the person id and clock are chosen so that
// Idle_Neutral plays at full weight at the start (humans.ts neutralWeight). Entry 33's take 4 cut a hand-at-the-hair
// gesture in one frame at a switch reach: 0.747 m per 50 ms.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {HumanViews,type SampledHuman} from '../../../mars/viewer/app/engine-view/humans.ts';
import {templateFromGltf} from '../../../mars/viewer/app/engine-view/people.ts';
import {hashId} from '../../../mars/viewer/app/engine-view/people-light.ts';
import {gaitSegments,walkWeightAt} from '../../../mars/viewer/app/engine-view/walk-ease.ts';
import {HAND_REACH_SECONDS} from '../../../mars/viewer/engine/social/hand-actuator.ts';
import {POS_Q} from '../../../mars/viewer/engine/take/types.ts';

const DT=.05,ID='h_m04gesture';
async function views(){
 const source=readFileSync(new URL('../../../mars/viewer/public/modular/environment/animated-casual.glb',import.meta.url));
 const jsonSize=source.readUInt32LE(12),json=JSON.parse(source.subarray(20,20+jsonSize).toString()),binHeader=20+jsonSize;
 json.materials=json.materials.map(()=>({pbrMetallicRoughness:{baseColorFactor:[.5,.5,.5,1],metallicFactor:0,roughnessFactor:.8}}));delete json.textures;delete json.images;delete json.samplers;
 let chunk=Buffer.from(JSON.stringify(json));chunk=Buffer.concat([chunk,Buffer.alloc((4-chunk.length%4)%4,32)]);const bin=source.subarray(binHeader);
 const header=Buffer.alloc(20);source.copy(header,0,0,12);header.writeUInt32LE(20+chunk.length+bin.length,8);header.writeUInt32LE(chunk.length,12);header.writeUInt32LE(0x4e4f534a,16);
 const bytes=Buffer.concat([header,chunk,bin]);const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 const v=new HumanViews();v.setTemplates([templateFromGltf('m04-canonical',gltf)]);return v;
}
/** A clock (s, on the 0.05 s grid) at which ID's idle variant is Idle_FoldArms_Loop (arms crossed on the chest), at full
 *  weight for ~0.8 s with ~7 s left (humans.ts idleVariant). */
const gestureClock=()=>{const h=hashId(ID),ph=((h>>>7)%991)/991;let n=1;while((n+h)%2!==1)n++;return Math.round(37*(n+2/37-ph)/DT)*DT;};
const palms=(v:HumanViews)=>v.bones(ID)[ID].arms.map(a=>a.palm as number[]);
const step=(a:number[][],b:number[][],dx=0)=>Math.max(...a.map((p,i)=>Math.hypot(b[i][0]-dx-p[0],b[i][1]-p[1],b[i][2]-p[2])));

test('a hand reach out of an idle gesture fades the gesture out over the reach (no one-frame cut)',async()=>{
 const v=await views(),t0=gestureClock(),start=Math.round(t0/DT);
 const at:[number,number,number]=[.5,1.14,-.22];
 const frame=(t:number):SampledHuman=>t<t0?{id:ID,p:[0,0,0],yaw:0,walk:0,walkDist:0,activity:'idle',restAge:30+t-t0}
  :{id:ID,p:[0,0,0],yaw:0,walk:0,walkDist:0,activity:'operate',restAge:30+t-t0,hands:{right:at},handActuator:{target:'tap',at,startTick:start},handActuatorTime:t};
 const draw=(t:number)=>{v.setFrame([frame(t)],t);v.render(1);return {p:palms(v),variety:v.bones(ID)[ID].variety};};
 const rows:{t:number;p:number[][];variety:number}[]=[];
 for(let t=t0-1;t<=t0+1.6;t+=DT)rows.push({t,...draw(+t.toFixed(4))});
 const before=rows.filter(r=>r.t<t0-1e-6).at(-1)!,first=rows.find(r=>r.t>=t0-1e-6)!;
 assert.ok(before.variety>.95,'the idle gesture plays at full weight before the reach: '+before.variety);
 assert.ok(first.variety>.9,'and is still there on the first reach frame (not cut): '+first.variety);
 assert.ok(rows.find(r=>r.t>=t0+HAND_REACH_SECONDS-1e-6)!.variety<.6,'half gone by the end of the 0.65 s reach');
 assert.equal(rows.find(r=>r.t>=t0+1.4-1e-6)!.variety,0,'gone 1.4 s after the reach start');
 // how far the gesture holds the hands from the plain idle pose: the jump a cut would make
 const plain=await views();plain.setFrame([{...frame(t0-DT),restAge:0}],t0-DT);plain.render(1);
 const cut=step(before.p,palms(plain));
 // the reach itself (the release after it is the actuator's own 0.7 s withdraw, unchanged: ~0.08 with or without a gesture)
 let max=0;for(let i=1;i<rows.length&&rows[i].t<=t0+HAND_REACH_SECONDS+1e-6;i++)max=Math.max(max,step(rows[i-1].p,rows[i].p));
 if(process.env.M04_DEBUG)for(let i=1;i<rows.length;i++)console.log('R',(rows[i].t-t0).toFixed(2),rows[i].variety.toFixed(3),rows[i].p.map((p,j)=>Math.hypot(p[0]-rows[i-1].p[j][0],p[1]-rows[i-1].p[j][1],p[2]-rows[i-1].p[j][2]).toFixed(3)).join(' '));
 assert.ok(cut>.15,'the forced gesture moves a hand well away from the idle pose: '+cut.toFixed(3));
 assert.ok(max<=.08,`palm step per 50 ms from 1 s before to the end of the reach ${max.toFixed(3)} (a cut would be ~${cut.toFixed(3)})`);
});

test('a walk starting out of an idle gesture fades the gesture with the walk ease (no one-frame cut)',async()=>{
 const v=await views(),t0=gestureClock(),k0=Math.round(t0/DT),v0=1.2;
 // the replay's walk weight for a body that starts walking at 1.2 m/s at t0 (walk-ease.ts on the recorded track)
 const track=[[0,0,0,0,0],[k0,0,0,0,0],[k0+80,Math.round(80*DT*v0*POS_Q),0,0,0]],seg=gaitSegments([{track,offset:0}],DT);
 // as take-replay gives it: walking, seconds since the walk weight left 0 (and the rest clock then); the onset clock runs on
 const since=(t:number)=>{for(let k=Math.floor(t/DT+1e-6);k>=Math.floor(t/DT+1e-6)-24;k--)if(walkWeightAt(seg,k,DT)<=.02)return {walkAge:t-k*DT,restAgeAtWalk:30+k*DT-t0};return {};};
 const frame=(t:number):SampledHuman=>{const x=Math.max(0,t-t0)*v0;return {id:ID,p:[x,0,0],yaw:0,walk:walkWeightAt(seg,t/DT,DT),walkDist:x,activity:t<t0?'idle':'walk',restAge:30+t-t0,speed:t<t0?0:v0,...(walkWeightAt(seg,t/DT,DT)>.02?since(t):{})};};
 const rows:{t:number;x:number;p:number[][];variety:number;w:number}[]=[];
 for(let t=t0-1;t<=t0+1.6;t+=DT){const f=frame(+t.toFixed(4));v.setFrame([f],+t.toFixed(4));v.render(1);rows.push({t,x:f.p[0],p:palms(v),variety:v.bones(ID)[ID].variety,w:f.walk});}
 const last=rows.filter(r=>r.t<t0-1e-6).at(-1)!,first=rows.find(r=>r.t>=t0-1e-6)!;
 assert.ok(last.variety>.5&&first.variety>.25,`the gesture is still fading on the first walking frame: ${last.variety} → ${first.variety}`);
 // body frame (the body moves along +x): standing and blending pairs (walk weight < 0.9 at either end)
 let max=0;for(let i=1;i<rows.length;i++){if(rows[i-1].w>=.9&&rows[i].w>=.9)continue;max=Math.max(max,step(rows[i-1].p.map(p=>[p[0]-rows[i-1].x,p[1],p[2]]),rows[i].p.map(p=>[p[0]-rows[i].x,p[1],p[2]])));}
 if(process.env.M04_DEBUG)for(const r of rows)console.log(r.t.toFixed(2),r.w.toFixed(3),r.variety.toFixed(3),r.p.map(p=>[p[0]-r.x,p[1],p[2]].map(x=>x.toFixed(3)).join(',')).join(' | '));
 assert.ok(max<=.08,`palm step per 50 ms while the walk eases in ${max.toFixed(3)}`);
});
