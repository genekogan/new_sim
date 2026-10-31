// Entry 38: putting up a poster (both hands, rolled sheet) and writing a note on the wanted/offered board, from the stand
// the boards' clearance allows (~0.5 m), must not lean, dip or kneel on any body template or height (ACCEPTANCE "no knee
// bend": drop / bend / kneel 0), and the palms stay on the engine's hand points. Real rigs (casual / punk / woman at
// 1.65–1.85 m, textures stripped as in standing-reach-posture.test.ts) through the replay path (HumanViews.setFrame).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {HumanViews,type SampledHuman} from '../../../mars/viewer/app/engine-view/humans.ts';
import {templateFromGltf} from '../../../mars/viewer/app/engine-view/people.ts';
import {HAND_REACH_SECONDS,strokeHands,strokePoint,type HandActuatorParams} from '../../../mars/viewer/engine/social/hand-actuator.ts';

const DT=.05;
async function template(name:string,height?:number){
 const source=readFileSync(new URL(`../../../mars/viewer/public/modular/environment/animated-${name}.glb`,import.meta.url));
 const jsonSize=source.readUInt32LE(12),json=JSON.parse(source.subarray(20,20+jsonSize).toString()),binHeader=20+jsonSize;
 json.materials=json.materials.map(()=>({pbrMetallicRoughness:{baseColorFactor:[.5,.5,.5,1],metallicFactor:0,roughnessFactor:.8}}));delete json.textures;delete json.images;delete json.samplers;
 let chunk=Buffer.from(JSON.stringify(json));chunk=Buffer.concat([chunk,Buffer.alloc((4-chunk.length%4)%4,32)]);const bin=source.subarray(binHeader);
 const header=Buffer.alloc(20);source.copy(header,0,0,12);header.writeUInt32LE(20+chunk.length+bin.length,8);header.writeUInt32LE(chunk.length,12);header.writeUInt32LE(0x4e4f534a,16);
 const bytes=Buffer.concat([header,chunk,bin]);const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 if(height)gltf.scene.userData.humanoid={look:{height}};
 return templateFromGltf(`${name}-${height??1.75}`,gltf);
}
type Stroke=NonNullable<HandActuatorParams['stroke']>;
/** The body at the origin facing +x, the board's face `stand` m ahead (its facing −x: yaw −π/2). The drawn posture over the
 *  whole stroke (reach, work, release) and the palms' distance to the engine points while working. */
function run(v:HumanViews,id:string,at:[number,number,number],s:Stroke){
 const t0=100,start=Math.round(t0/DT),two=s.kind==='poster'||s.kind==='unposter';let drop=0,kneel=0,bend=0,err=0;
 for(let t=t0-.2;t<=t0+HAND_REACH_SECONDS+s.seconds+.4;t+=DT){const tt=+t.toFixed(4),u=(tt-t0-HAND_REACH_SECONDS)/s.seconds;
  const hands=two?strokeHands(at,s,u):{right:strokePoint(at,s,u)};
  const f:SampledHuman=tt<t0?{id,p:[0,0,0],yaw:0,walk:0,walkDist:0,activity:'idle',restAge:0}
   :{id,p:[0,0,0],yaw:0,walk:0,walkDist:0,activity:'operate',restAge:0,hands,handActuator:{target:'board',at,stroke:s,startTick:start},handActuatorTime:tt};
  v.setFrame([f],tt);v.render(1);const b=v.bones(id)[id];
  if(tt>=t0){drop=Math.max(drop,b.pose.drop);kneel=Math.max(kneel,b.pose.kneel);bend=Math.max(bend,b.pose.bend);}
  if(u>0&&u<1)for(const a of b.arms){const q=(hands as Record<string,number[]|undefined>)[a.side];if(q)err=Math.max(err,Math.hypot(a.palm[0]-q[0],a.palm[1]-q[1],a.palm[2]-q[2]));}}
 return {drop,kneel,bend,err};
}
// the server's plans (contact-actuator.ts): poster wall face 0.4965 m out, slot centre 1.36 m; wanted board 0.468 m out, rows 1.47 / 1.23 m
const yaw=-Math.PI/2;
const poster:Stroke={kind:'poster',yaw,stand:.4965,width:.4,height:.52,lines:1,seconds:5.6,release:1.1,handoff:.1,lead:{y:1.2,out:.22}};
const unposter:Stroke={...poster,kind:'unposter',seconds:4.2};
const note=(seconds:number):Stroke=>({kind:'write',yaw,stand:.468,width:.22,height:.05,lines:1,seconds,release:1.1,handoff:.1,lead:{y:1.2,out:.24}});

test('a poster goes up and comes down, and a note is written top row and bottom row, upright on every body (1.65–1.85 m)',async()=>{
 const rows:string[]=[];
 for(const name of ['casual','punk','woman'])for(const height of [1.65,1.75,1.85]){
  const v=new HumanViews();v.setTemplates([await template(name,height)]);
  for(const [what,at,s] of [['poster up',[.4965-.004,1.36,0],poster],['poster down',[.4965-.004,1.36,0],unposter],['note top',[.468-.04,1.47,0],note(2.2)],['note bottom',[.468-.04,1.23,0],note(2.2)]] as const){
   const r=run(v,`h_${name}_${height}_${what}`,at as [number,number,number],s as Stroke);
   rows.push(`${name} ${height} m ${what}: drop ${r.drop.toFixed(3)} kneel ${r.kneel} bend ${(r.bend*180/Math.PI).toFixed(1)}° palm ${r.err.toFixed(3)}`);
  }
 }
 if(process.env.REACH_DEBUG)console.log(rows.join('\n'));
 for(const r of rows){const m=/drop ([\d.]+) kneel (\d) bend ([\d.]+)° palm ([\d.]+)/.exec(r)!;assert.ok(+m[1]<=.001&&m[2]==='0'&&+m[3]<=.05,`${r}: not upright`);assert.ok(+m[4]<=.04,`${r}: palm off the sheet`);}
});
