// Entry 36: a singer takes the mic and lets it go without a pop, out of an idle gesture too. Real canonical rig and clips
// (as M04's idle-gesture-transitions.test.ts), drawn through the replay path (HumanViews.setFrame): the body stands idle
// in a fold-arms gesture, then sings (the sing pose's hand eases onto the mic grip, MIC_HAND, and the gesture fades out
// over GESTURE_FADE), then stops (the hand lets go over SING_LET_GO). Take 3 cut a gesture at the sing start: 0.175 m.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {HumanViews,type SampledHuman} from '../../../mars/viewer/app/engine-view/humans.ts';
import {templateFromGltf} from '../../../mars/viewer/app/engine-view/people.ts';
import {hashId} from '../../../mars/viewer/app/engine-view/people-light.ts';

const DT=.05,ID='h_m04gesture';
import {MIC_HAND,SING_LET_GO} from '../../../mars/viewer/app/engine-view/activity-poses.ts';
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

test('singing at the mic: the hand eases onto the grip out of an idle gesture, holds it, and lets go, with no pop',async()=>{
 const v=await views(),t0=gestureClock(),t1=t0+4;
 const frame=(t:number):SampledHuman=>t<t0?{id:ID,p:[0,0,0],yaw:0,walk:0,walkDist:0,activity:'idle',restAge:30+t-t0}
  :t<t1?{id:ID,p:[0,0,0],yaw:0,walk:0,walkDist:0,activity:'sing',baseActivity:'idle',activityAge:t-t0,prevActivity:'idle',restAge:0}
  :{id:ID,p:[0,0,0],yaw:0,walk:0,walkDist:0,activity:'idle',activityAge:t-t1,prevActivity:'sing',restAge:t-t1};
 const rows:{t:number;p:number[][];variety:number;right:number[]}[]=[];
 for(let t=t0-1;t<=t1+2;t+=DT){const tt=+t.toFixed(4);v.setFrame([frame(tt)],tt);v.render(1);const b=v.bones(ID)[ID];rows.push({t:tt,p:palms(v),variety:b.variety,right:b.arms.find(a=>a.side==='right')!.palm as number[]});}
 const before=rows.filter(r=>r.t<t0-1e-6).at(-1)!,first=rows.find(r=>r.t>=t0-1e-6)!;
 assert.ok(before.variety>.95,'a gesture at full weight before she sings: '+before.variety);
 assert.ok(first.variety>.9,'still there on the first singing frame (not cut): '+first.variety);
 let max=0,maxAt=0;for(let i=1;i<rows.length;i++){const s=step(rows[i-1].p,rows[i].p);if(s>max){max=s;maxAt=rows[i].t;}}
 if(process.env.SING_DEBUG)for(const r of rows)console.log((r.t-t0).toFixed(2),r.variety.toFixed(3),r.right.map(x=>x.toFixed(3)).join(','));
 assert.ok(max<=.08,`palm step per 50 ms through the reach, the hold and the let-go: ${max.toFixed(3)} at ${(maxAt-t0).toFixed(2)} s`);
 // holding: the right palm at the mic hand goal (body at the origin facing +x: forward = +x, outward = right = +z)
 const held=rows.find(r=>r.t>=t0+2-1e-6)!.right,err=Math.hypot(held[0]-MIC_HAND[0],held[1]-MIC_HAND[2],held[2]-MIC_HAND[1]);
 assert.ok(err<.03,`the palm on the grip goal: ${err.toFixed(3)} m (${held.map(x=>x.toFixed(3))})`);
 const after=rows.find(r=>r.t>=t1+SING_LET_GO+.2)!.right;assert.ok(after[1]<1.0,'the hand is back down after letting go: '+after[1].toFixed(3));
});
