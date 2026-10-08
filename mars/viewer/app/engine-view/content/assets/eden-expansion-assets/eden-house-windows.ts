import * as THREE from 'three';
import {neighborhoodPlan} from './neighborhood.ts';
import {EDEN_ROOM_GLSL} from '../eden-window-interiors.ts';
type Box={name:string;p:[number,number,number];size:[number,number,number]};
type Opening={name:string;min:[number,number,number];max:[number,number,number]};
export type WindowPlacement={house:string;at:[number,number,number];yaw:number;width:number;height:number;kind:'glazed-opening'|'facade'};
/** Windows for the neighborhood houses. Recorded window openings (houses 1-2)
 * get glass, frame, mullions and a sill; solid outer walls (houses 3-4) get
 * framed facade windows inside each solid wall section, so no window covers a
 * door gap. Visual scenery only: no collision, support or perception change. */
export function houseWindowPlacements():WindowPlacement[]{
 const plan=neighborhoodPlan({houseOne:'direct-courtyard',houseThree:'lower-roof-route'}) as {id:string;root:number[];sourceInspection:{parts?:Box[];openings?:Opening[];wholeEnvelopeXZ?:number[]}}[];
 const out:WindowPlacement[]=[];
 for(const b of plan){
  const [rx,,rz]=b.root,i=b.sourceInspection;
  for(const o of i.openings??[]){
   if(!/window/i.test(o.name))continue;
   const sx=o.max[0]-o.min[0],sz=o.max[2]-o.min[2],c=[(o.min[0]+o.max[0])/2,(o.min[1]+o.max[1])/2,(o.min[2]+o.max[2])/2];
   // Opening depth is the thin axis; face outward from the house centre.
   const alongX=sx>=sz,yaw=alongX?(c[2]>0?0:Math.PI):(c[0]>0?Math.PI/2:-Math.PI/2);
   out.push({house:b.id,at:[rx+c[0],c[1],rz+c[2]],yaw,width:alongX?sx:sz,height:o.max[1]-o.min[1],kind:'glazed-opening'});
  }
  if(i.openings?.length)continue;
  const env=i.wholeEnvelopeXZ??[-6,-5,6,5];
  for(const w of i.parts??[]){
   const [px,py,pz]=w.p,[ax,ay,az]=w.size,thinX=ax<=.25&&az>=2.4,thinZ=az<=.25&&ax>=2.4;
   if(!(thinX||thinZ)||ay<2.4||py-ay/2>.2)continue;
   const outer=/outer/.test(w.name)||(thinZ&&Math.abs(Math.abs(pz)-Math.max(Math.abs(env[1]),Math.abs(env[3])))<.3);
   if(!outer)continue;
   const length=thinX?az:ax,center=thinX?pz:px,yaw=thinX?(px>0?Math.PI/2:-Math.PI/2):(pz>0?0:Math.PI),face=(thinX?ax:az)/2+.03;
   const count=Math.max(0,Math.floor((length-1)/2.6));if(!count)continue;
   const rows=[1.5,...(py+ay/2>=5?[4.2]:[])];
   for(let k=0;k<count;k++){const t=center-length/2+(k+.5)*length/count;
    for(const y of rows){const local:[number,number,number]=thinX?[px+Math.sign(px||-1)*face,y,t]:[t,y,pz+Math.sign(pz||-1)*face];
     out.push({house:b.id,at:[rx+local[0],y,rz+local[2]],yaw,width:1.1,height:1.2,kind:'facade'});}}
  }
 }
 return out;
}
export function createEdenHouseWindows(){
 const placements=houseWindowPlacements();if(!placements.length)return null;
 const group=new THREE.Group();group.name='Eden house windows (scenery only)';
 const geos:THREE.BufferGeometry[]=[],mats:THREE.Material[]=[];
 const geo=<G extends THREE.BufferGeometry>(g:G)=>{geos.push(g);return g;},mat=<M extends THREE.Material>(m:M)=>{mats.push(m);return m;};
 const frame=mat(new THREE.MeshStandardMaterial({color:'#efe9dc',roughness:.7}));
 const sill=mat(new THREE.MeshStandardMaterial({color:'#b9ad97',roughness:.9}));
 // Facade glass is opaque, sky-reflecting and warmly lit from inside at night.
 const facadeGlass=mat(new THREE.MeshStandardMaterial({color:'#3d5566',roughness:.12,metalness:.35,emissive:'#ffcf8a',emissiveIntensity:0}));
 // With the viewer's night lighting: each facade window looks into its own lit (or dark) room with curtains.
 facadeGlass.onBeforeCompile=sh=>{if(!sh.uniforms.uEdenNight||!sh.uniforms.uEdenWindows)return;
  sh.vertexShader=sh.vertexShader.replace('void main() {','varying vec2 vEdenWinUv;varying vec4 vEdenWin;varying vec3 vEdenWinT;\nvoid main() {').replace('#include <begin_vertex>',
   '#include <begin_vertex>\nvEdenWinUv=position.xy+.5;\n#ifdef USE_INSTANCING\nvEdenWin=vec4(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),fract(sin(dot(instanceMatrix[3].xyz,vec3(12.9898,78.233,37.719)))*43758.5453),0.0);vEdenWinT=normalize((modelMatrix*vec4(instanceMatrix[0].xyz,0.0)).xyz);\n#else\nvEdenWin=vec4(1.0,1.0,.5,0.0);vEdenWinT=vec3(1.0,0.0,0.0);\n#endif');
  sh.fragmentShader=sh.fragmentShader.replace('void main() {','uniform vec4 uEdenWindows;varying vec2 vEdenWinUv;varying vec4 vEdenWin;varying vec3 vEdenWinT;\n'+EDEN_ROOM_GLSL+'\nvoid main() {').replace('#include <emissivemap_fragment>',
   '#include <emissivemap_fragment>\n{vec3 wp=vEdenNightWorld,vW=normalize(wp-cameraPosition),tW=normalize(vEdenWinT),nW=normalize(cross(tW,vec3(0.0,1.0,0.0)));if(dot(nW,vW)>0.0)nW=-nW;'+
   'vec3 R=vec3(3.0,2.8,3.2);vec3 o=vec3((R.x-vEdenWin.x)*.5+vEdenWinUv.x*vEdenWin.x,.9+vEdenWinUv.y*vEdenWin.y,0.0),d=vec3(dot(vW,tW),vW.y,dot(vW,-nW));'+
   'float seed=vEdenWin.z,on=step(seed,uEdenWindows.x);vec3 room=edenRoom(o,d,R,seed,uEdenWindows.y);float cover;room=edenCurtain(vEdenWinUv.x,vEdenWinUv.y,seed,room,cover);'+
   'totalEmissiveRadiance=mix(vec3(.01,.012,.018),room*1.25,on)*uEdenNight.x;}');};
 facadeGlass.customProgramCacheKey=()=>'eden-house-facade-rooms-v1';
 // Glass in real openings stays see-through so the furnished rooms read.
 const openGlass=mat(new THREE.MeshStandardMaterial({color:'#bfd8e0',roughness:.05,metalness:.1,transparent:true,opacity:.28,depthWrite:false,emissive:'#ffcf8a',emissiveIntensity:0}));
 const bar=geo(new THREE.BoxGeometry(1,1,1)),pane=geo(new THREE.PlaneGeometry(1,1));
 const bars:THREE.Matrix4[]=[],sills:THREE.Matrix4[]=[],facade:THREE.Matrix4[]=[],open:THREE.Matrix4[]=[];
 const q=new THREE.Quaternion(),s=new THREE.Vector3(),o=new THREE.Object3D();
 const at=(base:WindowPlacement,dx:number,dy:number,dz:number,sx:number,sy:number,sz:number)=>{o.position.set(...base.at);o.rotation.set(0,base.yaw,0);o.updateMatrix();const m=new THREE.Matrix4().makeTranslation(dx,dy,dz);const local=new THREE.Matrix4().compose(new THREE.Vector3(),q.identity(),s.set(sx,sy,sz));return o.matrix.clone().multiply(m).multiply(local);};
 for(const w of placements){
  const W=w.width,H=w.height,t=.07,z=w.kind==='facade'?.02:0;
  bars.push(at(w,0,H/2-t/2,z,W+t,t,.08),at(w,0,-H/2+t/2,z,W+t,t,.08),at(w,-W/2,0,z,t,H,.08),at(w,W/2,0,z,t,H,.08),at(w,0,0,z+.005,.045,H,.05),at(w,0,0,z+.005,W,.045,.05));
  sills.push(at(w,0,-H/2-.04,z+.06,W+.25,.07,.18));
  (w.kind==='facade'?facade:open).push(at(w,0,0,z-.005,W,H,1));
 }
 const inst=(g:THREE.BufferGeometry,m:THREE.Material,list:THREE.Matrix4[],name:string,shadow=true)=>{if(!list.length)return;const mesh=new THREE.InstancedMesh(g,m,list.length);list.forEach((x,i)=>mesh.setMatrixAt(i,x));mesh.name=name;mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();mesh.castShadow=shadow;mesh.receiveShadow=true;group.add(mesh);return mesh;};
 inst(bar,frame,bars,'window-frames');inst(bar,sill,sills,'window-sills');inst(pane,facadeGlass,facade,'window-glass-facade',false);
 const glass=inst(pane,openGlass,open,'window-glass-openings',false);if(glass)glass.userData.cameraTransparent=true;
 return {group,placements,glowMaterials:[facadeGlass,openGlass] as THREE.MeshStandardMaterial[],
  /** 0 by day .. 1 at night: interior light behind the glass. */
  setNight(strength:number){const k=Math.max(0,Math.min(1,strength));facadeGlass.emissiveIntensity=.9*k;openGlass.emissiveIntensity=.5*k;},
  dispose(){group.removeFromParent();for(const g of geos)g.dispose();for(const m of mats)m.dispose();group.clear();}};
}
