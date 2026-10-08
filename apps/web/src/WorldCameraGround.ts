import * as THREE from 'three';

/** Gene: "prevent the camera from going underground, thats confusing." Presentation only: after every camera
 * mode has placed the camera (Broadcast, Follow, Look around, Free, zoom/orbit), keep it a margin above the
 * terrain or water surface under it and under a point a little along its view. The ground is what is drawn:
 * a downward ray against the large terrain/water surfaces (wide, flat-ish, non-instanced meshes, never the
 * atmosphere), so houses,
 * roofs and trees never count and interior views keep working. Heights are cached per 2 m cell for a few
 * seconds, so a moving camera costs at most a ray or two per frame. */
export const CAMERA_GROUND_MARGIN=1.2;
const CELL=2,CACHE_MS=4_000,MESH_REFRESH_MS=3_000,MIN_SPAN=40,TOP=400,MAX_GROUND_Y=150;

type Cell={y:number|null;at:number};
export class CameraGroundClamp{
 private ray=new THREE.Raycaster(new THREE.Vector3(),new THREE.Vector3(0,-1,0),0,TOP+200);
 private cells=new Map<string,Cell>();
 private meshes:THREE.Object3D[]=[];
 private meshesAt=-Infinity;
 private box=new THREE.Box3();
 private ahead=new THREE.Vector3();
 /** Last result, for diagnostics/proofs: ground height under the camera, whether it was lifted this frame. */
 last:{ground:number|null;lifted:number;surfaces:number}={ground:null,lifted:0,surfaces:0};

 /** Wide, mostly flat drawn surfaces: terrain, ground planes, water. Not the sky or weather. */
 private groundMeshes(scene:THREE.Object3D,now:number){
  if(now-this.meshesAt<MESH_REFRESH_MS)return this.meshes;
  this.meshesAt=now;const out:THREE.Object3D[]=[];
  scene.traverseVisible(o=>{
   const m=o as THREE.Mesh;if(!m.isMesh||(m as unknown as THREE.InstancedMesh).isInstancedMesh||(m as unknown as THREE.SkinnedMesh).isSkinnedMesh||!m.geometry)return;
   // Water draws without depth writes, so it counts; the atmosphere (sky, rain, balloons, birds) never does.
   if(m.userData.cameraTransparent||m.name.startsWith('atmosphere'))return;
   const mats=Array.isArray(m.material)?m.material:[m.material];if(mats.every(x=>!x||x.visible===false))return;
   if(!m.geometry.boundingBox)m.geometry.computeBoundingBox();
   this.box.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld);
   const sx=this.box.max.x-this.box.min.x,sz=this.box.max.z-this.box.min.z,sy=this.box.max.y-this.box.min.y,span=Math.max(sx,sz);
   if(span>=MIN_SPAN&&sy<=span*.6&&this.box.min.y<MAX_GROUND_Y)out.push(m);
  });
  if(out.length!==this.meshes.length||out.some((m,i)=>m!==this.meshes[i]))this.cells.clear();
  this.meshes=out;return out;
 }

 /** Highest drawn ground/water surface at (x, z), or null where there is none. */
 heightAt(scene:THREE.Object3D,x:number,z:number,now=performance.now()):number|null{
  if(!Number.isFinite(x)||!Number.isFinite(z))return null;
  const meshes=this.groundMeshes(scene,now),key=`${Math.round(x/CELL)},${Math.round(z/CELL)}`,hit=this.cells.get(key);
  if(hit&&now-hit.at<CACHE_MS)return hit.y;
  let y:number|null=null;
  if(meshes.length){
   this.ray.ray.origin.set(Math.round(x/CELL)*CELL,TOP,Math.round(z/CELL)*CELL);
   for(const h of this.ray.intersectObjects(meshes,false))if(h.point.y<MAX_GROUND_Y&&(y===null||h.point.y>y))y=h.point.y;
  }
  this.cells.set(key,{y,at:now});
  if(this.cells.size>3000)for(const [k,v] of this.cells)if(now-v.at>CACHE_MS)this.cells.delete(k);
  return y;
 }

 /** Lift the camera above the ground under it (and just ahead of it). Never moves it down or sideways. */
 apply(camera:THREE.Camera,scene:THREE.Object3D,now=performance.now()){
  const p=camera.position;
  camera.getWorldDirection(this.ahead);this.ahead.y=0;
  const g0=this.heightAt(scene,p.x,p.z,now);
  const g1=this.ahead.lengthSq()>1e-6?(this.ahead.normalize(),this.heightAt(scene,p.x+this.ahead.x*1.5,p.z+this.ahead.z*1.5,now)):null;
  const ground=g0===null?g1:g1===null?g0:Math.max(g0,g1);
  const floor=ground===null?null:ground+CAMERA_GROUND_MARGIN;
  const lifted=floor!==null&&p.y<floor?floor-p.y:0;
  if(lifted>0){p.y=floor!;camera.updateMatrixWorld();}
  this.last={ground,lifted,surfaces:this.meshes.length};(globalThis as {__simCameraGround?:unknown}).__simCameraGround=this.last;
  return lifted;
 }
}

/** The live view's clamp (one viewer per page). */
export const cameraGround=new CameraGroundClamp();
