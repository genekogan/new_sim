// Entry 33, retest on M04 (take 08): an idle gesture drawn at full weight never moves a hand faster than a hand reach may
// (0.15 m per 50 ms, ACCEPTANCE item 7). Idle_LookAround_Loop at the library's speed dropped a hand from the head to the
// hip at up to 0.19 m per 50 ms (1.85 m bodies); it now plays at 0.7 (humans.ts VARIANT_RATE). Real rigs (casual / punk /
// woman at 1.65 and 1.85 m, textures stripped as in body-identity.test.ts) through the replay path (HumanViews.setFrame).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {HumanViews} from '../../../mars/viewer/app/engine-view/humans.ts';
import {templateFromGltf} from '../../../mars/viewer/app/engine-view/people.ts';
import {hashId} from '../../../mars/viewer/app/engine-view/people-light.ts';

async function template(name:string,height:number){
 const source=readFileSync(new URL(`../../../mars/viewer/public/modular/environment/animated-${name}.glb`,import.meta.url));
 const jsonSize=source.readUInt32LE(12),json=JSON.parse(source.subarray(20,20+jsonSize).toString()),binHeader=20+jsonSize;
 json.materials=json.materials.map(()=>({pbrMetallicRoughness:{baseColorFactor:[.5,.5,.5,1],metallicFactor:0,roughnessFactor:.8}}));delete json.textures;delete json.images;delete json.samplers;
 let chunk=Buffer.from(JSON.stringify(json));chunk=Buffer.concat([chunk,Buffer.alloc((4-chunk.length%4)%4,32)]);const bin=source.subarray(binHeader);
 const header=Buffer.alloc(20);source.copy(header,0,0,12);header.writeUInt32LE(20+chunk.length+bin.length,8);header.writeUInt32LE(chunk.length,12);header.writeUInt32LE(0x4e4f534a,16);
 const bytes=Buffer.concat([header,chunk,bin]),gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 gltf.scene.userData.humanoid={look:{height}};return templateFromGltf(`${name}-${height}`,gltf);
}
/** A person id whose idle variant over [t0, t1] is `clip` at full weight, with Idle_Neutral off (humans.ts schedules). */
function idWith(clip:string,t0:number,t1:number){
 for(let i=0;i<50000;i++){const id='h_gesture'+i,h=hashId(id);let ok=true;
  for(let t=t0;t<=t1&&ok;t+=.25){const u=((t/25+(h%997)/997)%1)*25,cyc=t/37+((h>>>7)%991)/991,v=(cyc%1)*37;
   ok=u>=7&&v>=1.2&&v<9&&['Idle_LookAround_Loop','Idle_FoldArms_Loop'][(Math.floor(cyc)+h)%2]===clip;}
  if(ok)return id;}
 throw new Error('no id');
}
test('idle gestures at full weight move a hand no faster than 0.15 m per 50 ms (look around at 0.7 speed)',async()=>{
 const rows:string[]=[];
 for(const clip of ['Idle_LookAround_Loop','Idle_FoldArms_Loop']){
  const id=idWith(clip,100,107.5);
  for(const name of ['casual','punk','woman'])for(const height of [1.65,1.85]){
   const v=new HumanViews();v.setTemplates([await template(name,height)]);let prev:number[][]|null=null,max=0;
   for(let t=100;t<=107.5;t+=.05){const tt=+t.toFixed(3);v.setFrame([{id,p:[0,0,0],yaw:0,walk:0,walkDist:0,activity:'idle',restAge:60}],tt);v.render(1);
    const b=v.bones(id)[id];assert.ok(b.variety>.99,`${clip} plays at full weight`);const p=b.arms.map(a=>a.palm as number[]);
    if(prev)max=Math.max(max,...p.map((q,i)=>Math.hypot(q[0]-prev![i][0],q[1]-prev![i][1],q[2]-prev![i][2])));prev=p;}
   rows.push(`${clip} ${name} ${height} m: ${max.toFixed(3)}`);assert.ok(max<=.14,rows.at(-1));
  }
 }
 if(process.env.GESTURE_DEBUG)console.log(rows.join('\n'));
});
