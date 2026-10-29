// Production kit mesh + glow animation fed by native Soul action snapshots, not fabricated states.
import * as THREE from '../../apps/web/node_modules/three/build/three.module.js';
import {WorldModel} from '../../packages/world-compiler/src/model.ts';
import {MaterialLib} from '../../apps/web/src/gen-mesh/materials.ts';
import {meshFor} from '../../apps/web/src/gen-mesh/registry.ts';
import {animate} from '../../apps/web/src/gen-mesh/motion.ts';
import '../../apps/web/src/gen-mesh/kit.mesh.ts';
const scene=new THREE.Scene();scene.background=new THREE.Color('#151c28');
scene.add(new THREE.HemisphereLight('#acbada','#434153',1));
const camera=new THREE.PerspectiveCamera(36,innerWidth/innerHeight,.01,100);const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;document.body.append(renderer.domElement);
const materials=new MaterialLib();let group=new THREE.Group();scene.add(group);
async function show(state:string){
 const snap=await (await fetch('/day1-proof/lights-'+state+'.json')).json();const model=WorldModel.fromSnapshot(snap);group.clear();
 const floor=snap.entities.find((e:any)=>e.name==='reading-light');const p=model.worldPose(floor);camera.position.set(p.x+2.8,2.1,p.z+4);camera.lookAt(p.x-.4,.8,p.z+.25);
 const ground=new THREE.Mesh(new THREE.PlaneGeometry(16,16),new THREE.MeshStandardMaterial({color:'#655e53'}));ground.rotation.x=-Math.PI/2;ground.position.set(p.x,-.02,p.z);group.add(ground);
 const stats=[];
 for(const entity of snap.entities.filter((e:any)=>['reading-light','small-lantern','bowl'].includes(e.name))){
  const def=model.resolvedDef(entity.def)!;const params=entity.params;const pose=model.worldPose(entity);
  const obj=meshFor(def)!.build({def,entity,params,baked:model.bake(def,params,entity.seed??7),model,materials,args:def.make.kind==='gen'?def.make.args??{}:{},tint:(key:string,fallback:string)=>params[key]??def.palette?.[key]??fallback})!;
  obj.position.set(pose.x,pose.y,pose.z);group.add(obj);animate(obj,entity,def,1e9,{y:pose.y,yaw:pose.yaw});
  const intensities:number[]=[];obj.traverse((m:any)=>{if(m.material?.emissive?.getHex())intensities.push(m.material.emissiveIntensity);});stats.push({name:entity.name,on:entity.state?.on,emissive:intensities});
 }
 renderer.render(scene,camera);document.getElementById('label')!.innerHTML=`Day 1 · ${state==='on'?'Lights on':'Soul switched both lights off'}<br><small>Floor lamp + carryable lantern · production meshes and glow animation<br>Saved states from ordinary Soul HTTP actions in an isolated native world<br>Renderer fixture; full live viewer and model behavior not claimed</small>`;
 Object.assign(window,{day1:{ready:true,show,stats,renderer}});
}
await show('on');
