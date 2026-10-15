import './browser-url-fixture.ts';
import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';
import {DECORATIVE_MOTION,DecorativeMotion,decorationAt,nextFerrisAngle,FERRIS_HUB} from '../../../mars/viewer/app/engine-view/content/assets/decorative-motion.ts';
import {Builder,Materials} from '../../../mars/viewer/app/engine-view/content/assets/eden-regions/kit.ts';
import {DRIFTERS,landingDrifterAt,Balloons} from '../src/atmosphere/balloons.ts';
test('daytime-only Ferris rotates continuously; cabins remain upright; sea boats move gently and moorings do not drift',()=>{
 const angle=nextFerrisAngle(0,.1,true);assert.ok(angle>0);assert.equal(nextFerrisAngle(angle,1,false),angle);assert.equal(nextFerrisAngle(angle,1,true,true),angle);
 for(let t=0;t<240;t++){const a=t/240*Math.PI*2,p={kind:'gondola' as const,pivot:[197,16,124] as const},bottom=decorationAt([197,14.1,124],p,t,a),top=decorationAt([197,15.45,124],p,t,a);assert.ok(Math.abs(top[0]-bottom[0])<1e-9&&Math.abs(top[1]-bottom[1]-1.35)<1e-9,'upright cabin');assert.ok(Math.abs(Math.hypot(bottom[0]-FERRIS_HUB[0],bottom[1]+1.9-FERRIS_HUB[1])-13)<1e-9);
  const moored=decorationAt([150,0,140],{kind:'moored-boat',pivot:[150,0,140]},t,a);assert.equal(moored[0],150);assert.equal(moored[2],140);assert.ok(Math.abs(moored[1])<=.09);
  const sea=decorationAt([40,0,260],{kind:'boat',pivot:[40,0,260]},t,a);assert.ok(Math.abs(sea[0]-40)<=.75&&Math.abs(sea[1])<=.09&&Math.abs(sea[2]-260)<=.5);
 }
});
test('configured parts batch by material, preserve vertex count, own resources, and compile both normals and positions',()=>{
 const motion=new DecorativeMotion(),base=new Builder('legacy'),group=new THREE.Group(),mats=new Materials(),geos:THREE.BufferGeometry[]=[],owned:THREE.Material[]=[];
 for(let i=0;i<30;i++)motion.sink(base,{kind:'boat',pivot:[i*10,0,260],phase:i},b=>b.box('metal',i*10,0,260,2,1,4,'white'));
 const tris=motion.emit(group,mats,geos,owned);assert.equal(group.children.length,1);assert.equal(tris,30*10);const mesh=group.children[0] as THREE.Mesh,material=mesh.material as THREE.MeshStandardMaterial;
 assert.notEqual(material,mats.get('metal'));assert.equal(mesh.geometry.attributes.decorationPart.count,mesh.geometry.attributes.position.count);assert.equal(mesh.userData.nativeSupport,'none');
 const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};material.onBeforeCompile(shader as never,{} as never);assert.equal((shader.uniforms as Record<string,unknown>).uDecorationTime,DECORATIVE_MOTION);assert.match(shader.vertexShader,/objectNormal=decorationRotation/);assert.match(shader.vertexShader,/transformed\.y\+=/);
 for(const g of geos)g.dispose();for(const m of owned)m.dispose();mats.dispose();
});
test('landing balloon rests on supported basket bottom, ascends vertically then drifts, returns before descent, wraps without jumps',()=>{
 const d=DRIFTERS.find(d=>d.landing)!,ground:[number,number,number]=[295,2,62];
 for(let t=0;t<=d.period;t+=1){const [x,y,z]=landingDrifterAt(d,t,ground),bottom=y-d.s*1.28-1.7;assert.ok(bottom>=2+.0299);if(t<=d.period*.175||t>=d.period*.825){assert.ok(Math.abs(x-295)<1e-8&&Math.abs(z-62)<1e-8,'vertical takeoff and landing');}const q=landingDrifterAt(d,t+1,ground);assert.ok(Math.hypot(q[0]-x,q[1]-y,q[2]-z)<.8,'gentle continuous motion');}
 assert.deepEqual(landingDrifterAt(d,0,ground),landingDrifterAt(d,7200,ground));const landed=landingDrifterAt(d,30,ground),air=landingDrifterAt(d,400,ground);assert.ok(air[1]-landed[1]>45);assert.ok(Math.hypot(air[0]-landed[0],air[2]-landed[2])>20);
 const owner=new Balloons();owner.setLanding(ground);owner.update(30);owner.setLanding(null);owner.dispose();
});

test('mounted atmosphere freezes decorations for reduced motion/history and Ferris at night without altering native clocks',async()=>{
 const {createWorldAtmosphere}=await import('../src/WorldAtmosphere.ts');const scene=new THREE.Scene(),owner=createWorldAtmosphere(scene),camera=new THREE.PerspectiveCamera();
 const frame=(seconds:number,clock:string,eden=true,reducedMotion=false)=>owner.update({seconds,dt:.1,daylight:1,camera,eden,reducedMotion,clock});
 frame(0,'2026-10-07T13:00:00');const dayAngle=DECORATIVE_MOTION.value.y;assert.ok(dayAngle>0);frame(2,'2026-10-07T23:00:00');assert.equal(DECORATIVE_MOTION.value.y,dayAngle);assert.equal(DECORATIVE_MOTION.value.x,2);
 frame(4,'2026-10-07T13:00:00',true,true);assert.deepEqual(DECORATIVE_MOTION.value.toArray(),[2,dayAngle]);frame(10,'2026-10-07T13:00:00',false);assert.deepEqual(DECORATIVE_MOTION.value.toArray(),[2,dayAngle]);assert.equal(owner.inspect().active,false);
 frame(11,'2026-10-07T13:00:00');assert.ok(DECORATIVE_MOTION.value.y>dayAngle);owner.dispose();
});
