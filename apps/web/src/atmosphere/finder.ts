import * as THREE from 'three';
import {windModeOf} from './wind.ts';
/** One periodic (never per-frame) walk of the rendered scene that collects
 * decorative anchors for the atmosphere: flowers for butterflies, low plants
 * for fireflies, chimney tops for smoke, and the Daylight lights. */
/** Elevated covers (roofs, ceilings, upper floors) as flat xz boxes [x0,z0,x1,z1,bottomY]: a camera under one is indoors/under eaves. */
export type Found={covers:number[];lamps:THREE.Vector3[];flowers:THREE.Vector3[];meadow:THREE.Vector3[];roofs:THREE.Vector3[];water:THREE.Vector3[];harbour:THREE.Vector3|null;smoke:{p:THREE.Vector3;scale:number}[];hemi:THREE.HemisphereLight|null;sun:THREE.DirectionalLight|null;fill:THREE.DirectionalLight|null};
const FLOWER=/flower|bloom|petal/i,MEADOW=/grass|fern|reed|wetland|meadow|broadleaf/i,CHIMNEY=/chimney|stove-?pipe|flue|smoke-?stack/i;
const m4=new THREE.Matrix4(),v=new THREE.Vector3(),cb=new THREE.Box3();
/** Is a world point under any elevated cover? */
export function underCover(covers:readonly number[],p:THREE.Vector3){for(let i=0;i<covers.length;i+=5)if(p.x>covers[i]&&p.x<covers[i+2]&&p.z>covers[i+1]&&p.z<covers[i+3]&&p.y<covers[i+4])return true;return false;}
function sample(mesh:THREE.Mesh,out:THREE.Vector3[],max:number,yLift:number){
 const inst=mesh as THREE.InstancedMesh;
 if(inst.isInstancedMesh){const n=inst.count,step=Math.max(1,Math.floor(n/max));
  for(let i=0;i<n&&out.length<4000;i+=step){inst.getMatrixAt(i,m4);m4.premultiply(mesh.matrixWorld);out.push(new THREE.Vector3().setFromMatrixPosition(m4).add(v.set(0,yLift,0)));}}
 else{if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();const c=mesh.geometry.boundingBox!.getCenter(new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);c.y+=yLift;out.push(c);}
}
/** Points on a flat water surface (world), kept ~2.5 m away from its shore so paddling ducks stay afloat. */
let rs=1;const rnd=()=>{rs=(Math.imul(rs,1664525)+1013904223)>>>0;return rs/4294967296;};
const ta=new THREE.Vector3(),tb=new THREE.Vector3(),tc=new THREE.Vector3();
function sampleSurface(mesh:THREE.Mesh,out:THREE.Vector3[]){
 if((mesh as THREE.InstancedMesh).isInstancedMesh)return;const pos=mesh.geometry.getAttribute('position');if(!pos)return;const idx=mesh.geometry.index,n=(idx?idx.count:pos.count)/3;if(n<1||n>60000)return;
 const T:number[]=[],Y:number[]=[];
 for(let t=0;t<n;t++){const i0=idx?idx.getX(t*3):t*3,i1=idx?idx.getX(t*3+1):t*3+1,i2=idx?idx.getX(t*3+2):t*3+2;
  ta.fromBufferAttribute(pos,i0).applyMatrix4(mesh.matrixWorld);tb.fromBufferAttribute(pos,i1).applyMatrix4(mesh.matrixWorld);tc.fromBufferAttribute(pos,i2).applyMatrix4(mesh.matrixWorld);
  const nx=(tb.y-ta.y)*(tc.z-ta.z)-(tb.z-ta.z)*(tc.y-ta.y),ny=(tb.z-ta.z)*(tc.x-ta.x)-(tb.x-ta.x)*(tc.z-ta.z),nz=(tb.x-ta.x)*(tc.y-ta.y)-(tb.y-ta.y)*(tc.x-ta.x);
  if(Math.abs(ny)<.9*Math.hypot(nx,ny,nz))continue;T.push(ta.x,ta.z,tb.x,tb.z,tc.x,tc.z);Y.push((ta.y+tb.y+tc.y)/3);}
 const tris=Y.length;if(!tris)return;
 const inside=(x:number,z:number)=>{for(let k=0;k<tris;k++){const o=k*6,ax=T[o],az=T[o+1],bx=T[o+2],bz=T[o+3],cx=T[o+4],cz=T[o+5];
  const d1=(x-bx)*(az-bz)-(ax-bx)*(z-bz),d2=(x-cx)*(bz-cz)-(bx-cx)*(z-cz),d3=(x-ax)*(cz-az)-(cx-ax)*(z-az);if(!((d1<0||d2<0||d3<0)&&(d1>0||d2>0||d3>0)))return k;}return-1;};
 for(let tries=0;tries<120&&out.length<200;tries++){const k=Math.floor(rnd()*tris),o=k*6;let u=rnd(),w=rnd();if(u+w>1){u=1-u;w=1-w;}
  const x=T[o]+(T[o+2]-T[o])*u+(T[o+4]-T[o])*w,z=T[o+1]+(T[o+3]-T[o+1])*u+(T[o+5]-T[o+1])*w;
  if(inside(x+2.5,z)<0||inside(x-2.5,z)<0||inside(x,z+2.5)<0||inside(x,z-2.5)<0)continue;
  out.push(new THREE.Vector3(x,Y[k],z));}
}
export function findAnchors(scene:THREE.Scene,skip:(o:THREE.Object3D)=>boolean,wantWater=true):Found{
 rs=1;
 const found:Found={covers:[],lamps:[],flowers:[],meadow:[],roofs:[],water:[],harbour:null,smoke:[],hemi:null,sun:null,fill:null};
 for(const c of scene.children){
  if((c as THREE.HemisphereLight).isHemisphereLight&&!found.hemi)found.hemi=c as THREE.HemisphereLight;
  if((c as THREE.DirectionalLight).isDirectionalLight){const d=c as THREE.DirectionalLight;if(d.castShadow&&!found.sun)found.sun=d;else if(!d.castShadow&&!found.fill)found.fill=d;}
 }
 const visit=(o:THREE.Object3D)=>{
  if(skip(o)||!o.visible&&o.parent!==scene)return;
  const src=o.userData?.edenSmokeSources;
  if(Array.isArray(src))for(const s of src)if(Array.isArray(s)&&s.length>=3&&s.slice(0,3).every(Number.isFinite))found.smoke.push({p:new THREE.Vector3(s[0],s[1],s[2]).applyMatrix4(o.matrixWorld),scale:Number.isFinite(s[3])?s[3]:1});
  if(!found.harbour&&/harbour|harbor|beach|lighthouse|marina/i.test(o.name)&&!(o as THREE.Mesh).isMesh){const b=new THREE.Box3().setFromObject(o);if(!b.isEmpty())found.harbour=b.getCenter(new THREE.Vector3());}
  const mesh=o as THREE.Mesh;
  if(mesh.isMesh){
   const path=(o.parent?.name??'')+' > '+o.name;
   if(/water/i.test(path)&&!/fountain|bed\b|bank|tower|trough|can\b|bottle|static-decorative/i.test(path)&&wantWater&&found.water.length<200)sampleSurface(mesh,found.water);
   if(CHIMNEY.test(o.name)){if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();const b=mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld);
    found.smoke.push({p:new THREE.Vector3((b.min.x+b.max.x)/2,b.max.y+.1,(b.min.z+b.max.z)/2),scale:Math.min(1.2,Math.max(.4,(b.max.x-b.min.x)*1.6))});}
   if(/roof/i.test(o.name)&&!/garden|tile|light|lamp|window|solar/i.test(path)&&!(mesh as THREE.InstancedMesh).isInstancedMesh&&found.roofs.length<40){
    if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();const b=mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld),sx=b.max.x-b.min.x,sz=b.max.z-b.min.z;
    if(sx>2.5&&sz>2.5&&sx<22&&sz<22&&b.max.y>2.5&&b.max.y<14)found.roofs.push(new THREE.Vector3((b.min.x+b.max.x)/2,b.max.y+.02,(b.min.z+b.max.z)/2));}
   if(/lantern|lamp-?head|lamp head/i.test(o.name)&&found.lamps.length<120)sample(mesh,found.lamps,40,0);
   const mode=windModeOf(path);
   if(!mode&&!(mesh as THREE.InstancedMesh).isInstancedMesh&&!(o as THREE.SkinnedMesh).isSkinnedMesh&&!o.userData.cameraTransparent&&found.covers.length<4000){
    if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();cb.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld);const sx=cb.max.x-cb.min.x,sz=cb.max.z-cb.min.z;
    if(cb.min.y>1.7&&sx>1.2&&sz>1.2&&sx<30&&sz<30&&sx*sz>3)found.covers.push(cb.min.x,cb.min.z,cb.max.x,cb.max.z,cb.min.y);}
   if(mode==='grass'&&FLOWER.test(path))sample(mesh,found.flowers,30,.35);
   else if((mode==='grass'||mode==='crown')&&MEADOW.test(path))sample(mesh,found.meadow,40,0);
  }
  for(const c of o.children)visit(c);
 };
 scene.updateMatrixWorld();
 for(const c of scene.children)visit(c);
 return found;
}
