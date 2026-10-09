import * as THREE from 'three';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {disposeSkeletons} from '../../../../../lib/three-resources.ts';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {hash01,loadPack,decorationGround} from './assets.ts';
import {HERDS,FLOCKS,AVOID,type Herd,type Rect} from './animal-plan.ts';
/** Animals of Eden (scenery only, never engine actors): farm animals in the farm hamlet's pastures, dogs and cats about
 * town and the gardens, deer and foxes at the woodland edges, birds wheeling over the meadows. Each animal wanders a
 * fixed zone on a schedule that is a pure function of wall-clock time (UTC seconds) and its id, so every viewer sees
 * roughly the same animals in the same places: a walk to a seeded point, then a pause (idle / grazing), repeated.
 * Rendering: one skinned clone per animal (one draw each: colours baked into vertex colours), drawn within DRAW_M of the
 * camera, animated within ANIMATE_M (farther ones hold their pose), all updated from one per-frame hook. */
const DRAW_M=140,ANIMATE_M=70,ROAM_SEGMENTS=6;
type Agent={id:string;herd:Herd;root:THREE.Object3D;model:THREE.Object3D;mixer:THREE.AnimationMixer;acts:Record<string,THREE.AnimationAction|undefined>;cur:string;speed:number};
type Flyer={root:THREE.Object3D;model:THREE.Object3D;mixer:THREE.AnimationMixer;act?:THREE.AnimationAction;c:[number,number];r:number;h:number;w:number;ph:number;y?:number};
const inRect=(r:Rect,x:number,z:number)=>x>=r[0]&&x<=r[2]&&z>=r[1]&&z<=r[3];
const blocked=(x:number,z:number,zone:readonly Rect[])=>!zone.some(r=>inRect(r,x,z))||AVOID.some(r=>inRect(r,x,z));
/** A seeded point of the herd's zone (rejection sampled, also off the avoid rects), and whether the straight walk there is clear. */
function pick(h:Herd,seed:string,k:number,from:[number,number]|null):[number,number]{
 const zone=h.zone;
 // grazers roam a few metres around a home spot that moves on every ROAM_SEGMENTS walks (the whole herd shares it)
 const home=h.roam?pick({...h,roam:undefined},h.id+':home',Math.floor(k/ROAM_SEGMENTS),null):null;
 for(let i=0;i<24;i++){
  const r=zone[Math.floor(hash01(seed,k*101+i*13)*zone.length)];
  let x=r[0]+(r[2]-r[0])*hash01(seed,k*977+i*31+1),z=r[1]+(r[3]-r[1])*hash01(seed,k*613+i*17+2);
  if(home&&h.roam){const a=hash01(seed,k*331+i*7)*Math.PI*2,d=h.roam*Math.sqrt(hash01(seed,k*557+i*11));x=home[0]+Math.cos(a)*d;z=home[1]+Math.sin(a)*d;}
  if(blocked(x,z,zone))continue;
  if(from){let ok=true;for(let s=1;s<8&&ok;s++){const u=s/8;if(blocked(from[0]+(x-from[0])*u,from[1]+(z-from[1])*u,zone))ok=false;}if(!ok)continue;}
  return [x,z];
 }
 return from??[(zone[0][0]+zone[0][2])/2,(zone[0][1]+zone[0][3])/2];
}
/** Where an agent is at time t: [x, z, yaw (three.js rotation.y, model faces +z), moving]. */
export function agentAt(h:Herd,id:string,t:number):[number,number,number,boolean]{
 const D=h.period*(0.8+0.4*hash01(id,5)),off=hash01(id,6)*D,u=t+off,k=Math.floor(u/D),f=u-k*D;
 // the walk of segment k goes from the point of segment k−1 to the point of segment k (each point seeded by k alone)
 const at=(n:number)=>pick(h,id,n,null);
 const a=at(k-1),b0=at(k);
 let b=b0;{for(let s=1;s<24;s++){const v=s/24;if(blocked(a[0]+(b0[0]-a[0])*v,a[1]+(b0[1]-a[1])*v,h.zone)){b=a;break;}}}
 const dx=b[0]-a[0],dz=b[1]-a[1],dist=Math.hypot(dx,dz),walkT=Math.min(D*.7,dist/h.speed);
 const heading=dist>1e-3?Math.atan2(dx,dz):hash01(id,k)*Math.PI*2;
 if(f<walkT&&dist>1e-3){const v=f/walkT;return [a[0]+dx*v,a[1]+dz*v,heading,true];}
 return [b[0],b[1],heading+(f-walkT)*0.02*(hash01(id,k+3)-.5),false];
}
export function createEdenAnimals(ground:(x:number,z:number)=>number|null,assetsLoader:typeof loadPack=loadPack){
 const group=new THREE.Group();group.name='Eden animals (scenery only)';
 const agents:Agent[]=[],flyers:Flyer[]=[];let closed=false,ready=false;

 const cam=new THREE.Vector3();
 // per-frame hook: an empty, never-culled mesh (no triangles are drawn)
 const hookGeo=new THREE.BufferGeometry();hookGeo.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,0,0,0,0,0,0],3));hookGeo.setDrawRange(0,0);
 const hookMat=new THREE.MeshBasicMaterial({visible:true,colorWrite:false,depthWrite:false});
 const hook=new THREE.Mesh(hookGeo,hookMat);hook.frustumCulled=false;hook.name='animals: frame hook';group.add(hook);
 let last=0;
 hook.onBeforeRender=(_r,_s,camera)=>{if(!ready||closed)return;camera.getWorldPosition(cam);const t=Date.now()/1000;update(t,t-last>1?0:t-last);last=t;};
 function update(t:number,_dt:number){
  for(const a of agents){
   const [x,z,yaw,moving]=agentAt(a.herd,a.id,t),d=Math.hypot(x-cam.x,z-cam.z);
   const y=decorationGround(ground,x,z);a.root.visible=d<DRAW_M&&y!==null;if(!a.root.visible)continue;
   a.root.position.set(x,y!,z);a.root.rotation.y=yaw;
   if(d>ANIMATE_M&&a.cur)continue;
   // standing still without an idle clip: the walk clip held at its first frame
   let want=moving?'walk':(a.herd.clips.eat&&a.acts.eat&&hash01(a.id,Math.floor(t/23))<.55?'eat':'idle');const hold=want==='idle'&&!a.acts.idle;if(hold)want='walk';
   if(want!==a.cur){for(const [k,act] of Object.entries(a.acts))act?.setEffectiveWeight(k===want?1:0);a.cur=want;}
   for(const [k,act] of Object.entries(a.acts))if(act&&k===a.cur){const dur=act.getClip().duration;act.time=hold?0:((t*(k==='walk'?a.speed:1)+hash01(a.id,9)*dur)%dur+dur)%dur;}
   a.mixer.update(0);
  }
  for(const f of flyers){
   const ang=f.ph+t*f.w,x=f.c[0]+Math.cos(ang)*f.r,z=f.c[1]+Math.sin(ang)*f.r,d=Math.hypot(x-cam.x,z-cam.z);
   const y=f.y??decorationGround(ground,x,z);f.root.visible=d<(f.y!==undefined?60:DRAW_M)&&y!==null;if(!f.root.visible)continue;
   if(f.y!==undefined){f.root.position.set(x,f.y+Math.sin(t*.9+f.ph)*.04,z);f.root.rotation.y=-ang+(f.w>0?0:Math.PI);}
   else{f.root.position.set(x,y!+f.h+Math.sin(t*.7+f.ph)*1.2,z);f.root.rotation.y=-ang+(f.w>0?0:Math.PI);f.root.rotation.z=(f.w>0?-1:1)*.25;}
   if(f.act&&d<ANIMATE_M*1.5){const dur=f.act.getClip().duration;f.act.time=((t+f.ph)%dur+dur)%dur;f.mixer.update(0);}
  }
 }
 const prep=(src:THREE.Object3D)=>{const o=clone(src);o.position.set(0,0,0);o.traverse(m=>{const mesh=m as THREE.Mesh;if(mesh.isMesh){mesh.castShadow=true;mesh.receiveShadow=false;mesh.frustumCulled=true;
  const mat=mesh.material as THREE.MeshStandardMaterial;if(mat&&!mat.userData.edenImports){mat.vertexColors=true;mat.roughness=.85;mat.metalness=0;mat.userData.edenImports=true;mat.needsUpdate=true;}}});return o;};
 const clipOf=(gltf:GLTF,model:string,name:string|undefined)=>name?THREE.AnimationClip.findByName(gltf.animations,`${model}|${name}`):null;
 assetsLoader('eden-animals.glb').then(gltf=>{
  if(closed)return;
  for(const h of HERDS){
   const src=gltf.scene.getObjectByName(h.model);if(!src)continue;
   for(let i=0;i<h.count;i++){
    const id=`${h.id}-${i}`,model=prep(src),root=new THREE.Group();root.name='animal '+id;root.add(model);root.scale.multiplyScalar(h.scale??1);
    // Clips own only the model's local pose. The support/placement parent is
    // outside the mixer, so animated root tracks cannot reset terrain height.
    const mixer=new THREE.AnimationMixer(model),acts:Agent['acts']={};
    for(const k of ['idle','walk','eat'] as const){const c=clipOf(gltf,h.model,h.clips[k]);if(c){const a=mixer.clipAction(c);a.play();a.setEffectiveWeight(0);acts[k]=a;}}
    agents.push({id,herd:h,root,model,mixer,acts,cur:'',speed:h.clipRate??1});group.add(root);
   }
  }
  for(const fl of FLOCKS){
   const src=gltf.scene.getObjectByName(fl.model);if(!src)continue;
   for(let i=0;i<fl.count;i++){const model=prep(src),root=new THREE.Group();root.add(model);root.scale.multiplyScalar(fl.scale??1);const mixer=new THREE.AnimationMixer(model),c=clipOf(gltf,fl.model,fl.clip);const act=c?mixer.clipAction(c):undefined;act?.play();
    const ph=hash01(fl.id,i)*Math.PI*2;flyers.push({root,model,mixer,act,c:[fl.centre[0]+(hash01(fl.id,i+50)-.5)*6,fl.centre[1]+(hash01(fl.id,i+90)-.5)*6],r:fl.radius*(0.75+0.5*hash01(fl.id,i+7)),h:fl.height+hash01(fl.id,i+3)*4,w:(i%2?1:-1)*fl.speed/fl.radius,ph,...(fl.y!==undefined?{y:fl.y}:{})});group.add(root);}
  }
  ready=true;
 }).catch(e=>console.warn('Eden animals unavailable',e));
 return {group,
  stats:()=>({animals:agents.length,birds:flyers.length,visible:[...agents,...flyers].filter(a=>a.root.visible).length}),
  dispose(){if(closed)return;closed=true;group.removeFromParent();for(const a of agents){a.mixer.stopAllAction();a.mixer.uncacheRoot(a.model);disposeSkeletons(a.model);}for(const f of flyers){f.mixer.stopAllAction();f.mixer.uncacheRoot(f.model);disposeSkeletons(f.model);}hookGeo.dispose();hookMat.dispose();group.clear();}};
}
