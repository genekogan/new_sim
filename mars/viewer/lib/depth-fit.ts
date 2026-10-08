import * as THREE from 'three';
/** Depth-buffer precision for big views (a fix for surfaces that speckle or flicker at some angles: layered
 * panels, decals, roof layers z-fighting). A 24-bit depth buffer resolves about z²/(near·2²⁴) metres at distance
 * z, so the near plane, not the far plane, sets the precision. Keep near as large as the view allows: a camera
 * h metres above the ground cannot have anything closer than about h·0.035 in front of it without that thing
 * being right under it, so near = clamp(h·0.035, min, max) — 0.1 m at eye height and indoors, up to ~1.5 m for
 * high overview and drone shots (15× the precision there). With an orbit target the near plane also stays well
 * short of the subject. Only perspective cameras; the projection is updated only when near changes by > 2 %. */
let groundSample:((x:number,z:number)=>number|null)|null=null;
/** Visual ground under the camera (the Eden expansion sets it; otherwise y = 0 is the ground). */
export function setDepthFitGround(sample:((x:number,z:number)=>number|null)|null){groundSample=sample;}
const _p=new THREE.Vector3();
export function fitNearPlane(camera:THREE.Camera,opts:{min?:number;max?:number;k?:number;target?:THREE.Vector3|null}={}){
 const cam=camera as THREE.PerspectiveCamera;if(!cam.isPerspectiveCamera)return cam;
 const min=opts.min??.1,max=opts.max??1.5,k=opts.k??.035;cam.getWorldPosition(_p);
 const g=groundSample?.(_p.x,_p.z),ground=g!==null&&g!==undefined&&Number.isFinite(g)?g:0;
 let near=Math.min(max,Math.max(min,(_p.y-ground)*k));
 if(opts.target)near=Math.max(min,Math.min(near,_p.distanceTo(opts.target)*.2));
 if(Math.abs(near-cam.near)>cam.near*.02){cam.near=near;cam.updateProjectionMatrix();}
 return cam;
}
