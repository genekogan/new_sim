// Entry 33, retest on M04 (take 06): a standing reach to a switch or torch at 1.2–1.53 m, 0.55 m in front of the body,
// must not dip at the knees (ACCEPTANCE item 5: drop ≤ 0.03 m, no kneel). Take 06's body (the woman template) dropped
// 0.041 m at the neon switch (1.2 m): the posture solver's 'knees' style priced a knee dip far below a small lean.
// Real rigs (animated-casual / -punk / -woman, textures stripped as in body-identity.test.ts), drawn through the replay
// path (HumanViews.setFrame), the hand actuator's reach to its contact and back.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {HumanViews,type SampledHuman} from '../../../mars/viewer/app/engine-view/humans.ts';
import {templateFromGltf} from '../../../mars/viewer/app/engine-view/people.ts';
import {HAND_REACH_SECONDS} from '../../../mars/viewer/engine/social/hand-actuator.ts';

const DT=.05;
async function template(name:string,height?:number){
 const source=readFileSync(new URL(`../../../mars/viewer/public/modular/environment/animated-${name}.glb`,import.meta.url));
 const jsonSize=source.readUInt32LE(12),json=JSON.parse(source.subarray(20,20+jsonSize).toString()),binHeader=20+jsonSize;
 json.materials=json.materials.map(()=>({pbrMetallicRoughness:{baseColorFactor:[.5,.5,.5,1],metallicFactor:0,roughnessFactor:.8}}));delete json.textures;delete json.images;delete json.samplers;
 let chunk=Buffer.from(JSON.stringify(json));chunk=Buffer.concat([chunk,Buffer.alloc((4-chunk.length%4)%4,32)]);const bin=source.subarray(binHeader);
 const header=Buffer.alloc(20);source.copy(header,0,0,12);header.writeUInt32LE(20+chunk.length+bin.length,8);header.writeUInt32LE(chunk.length,12);header.writeUInt32LE(0x4e4f534a,16);
 const bytes=Buffer.concat([header,chunk,bin]);const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 // a composed core/humanoid@2 look scales the whole body by height / 1.75 (people.ts bodyScaleOf)
 if(height)gltf.scene.userData.humanoid={look:{height}};
 return templateFromGltf(`${name}-${height??1.75}`,gltf);
}
/** The drawn posture over a reach to `at` (body at the origin facing +x, idle variety off): the worst drop / kneel /
 *  rise, and the palm's distance to the point at the contact. */
function reach(v:HumanViews,id:string,at:[number,number,number]){
 const t0=100,start=Math.round(t0/DT);let drop=0,kneel=0,rise=0,bend=0,err=Infinity;
 for(let t=t0-.2;t<=t0+HAND_REACH_SECONDS+.8;t+=DT){const tt=+t.toFixed(4);
  const f:SampledHuman=tt<t0?{id,p:[0,0,0],yaw:0,walk:0,walkDist:0,activity:'idle',restAge:0}
   :{id,p:[0,0,0],yaw:0,walk:0,walkDist:0,activity:'operate',restAge:0,hands:{right:at},handActuator:{target:'switch',at,startTick:start},handActuatorTime:tt};
  v.setFrame([f],tt);v.render(1);const b=v.bones(id)[id];
  drop=Math.max(drop,b.pose.drop);kneel=Math.max(kneel,b.pose.kneel);rise=Math.max(rise,b.pose.rise);bend=Math.max(bend,b.pose.bend);
  if(Math.abs(tt-t0-HAND_REACH_SECONDS)<DT/2)err=Math.min(...b.arms.map(a=>Math.hypot(a.palm[0]-at[0],a.palm[1]-at[1],a.palm[2]-at[2])));}
 return {drop,kneel,rise,bend,err};
}

test('standing reaches to 1.2–1.53 m from 0.55 m: no knee dip on any body template or height (1.65–1.85 m), hand on the point',async()=>{
 const rows:string[]=[];
 for(const name of ['casual','punk','woman'])for(const height of [1.65,1.67,1.7,1.75,1.8,1.85]){
  const v=new HumanViews();v.setTemplates([await template(name,height)]);
  for(const [what,h] of [['neon switch',1.2],['standing torch',1.446],['wall torch',1.526]] as const){
   const id=`h_reach_${name}_${height}_${h}`,r=reach(v,id,[.55,h,0]);
   rows.push(`${name} ${height} m ${what} ${h}: drop ${r.drop.toFixed(3)} kneel ${r.kneel} rise ${r.rise.toFixed(3)} bend ${(r.bend*180/Math.PI).toFixed(1)}° palm ${r.err.toFixed(3)}`);
   assert.ok(r.drop<=.03&&r.kneel===0,`${rows.at(-1)}: a knee dip`);
   assert.ok(r.err<=.12,`${rows.at(-1)}: hand off the point`);
  }
 }
 if(process.env.REACH_DEBUG)console.log(rows.join('\n'));
});

test('a hand reach below the hips still goes down at the knees (a campfire kindling, a low valve: unchanged)',async()=>{
 const v=new HumanViews();v.setTemplates([await template('casual')]);
 for(const h of [.16,.5]){const r=reach(v,`h_low_${h}`,[.55,h,0]);assert.ok(r.drop>.1||r.kneel>0,`a ${h} m valve: drop ${r.drop.toFixed(3)} kneel ${r.kneel}`);}
});
