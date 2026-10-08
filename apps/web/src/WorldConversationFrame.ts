import * as THREE from 'three';
import {WorldRenderedVisibility} from './WorldRenderedVisibility.ts';
export type ConversationSubject={id:string;p:readonly[number,number,number];yaw:number};
/** Frame the full group from twelve sides; known opaque scenery excludes embedded camera positions. */
export function conversationFrame(members:readonly ConversationSubject[],camera:THREE.PerspectiveCamera,roots:readonly THREE.Object3D[],heightAt:(x:number,z:number)=>number){
 if(!members.length)return null;const target=new THREE.Vector3();for(const m of members)target.add(new THREE.Vector3(m.p[0],m.p[1]+1,m.p[2]));target.multiplyScalar(1/members.length);
 const spread=Math.max(1,...members.map(m=>target.distanceTo(new THREE.Vector3(m.p[0],m.p[1]+1,m.p[2]))));
 const distance=Math.max(5,spread/(Math.tan(camera.fov*Math.PI/360)*Math.min(1,camera.aspect))*1.4);
 const faces=new THREE.Vector3();for(const m of members)faces.add(new THREE.Vector3(Math.cos(m.yaw),0,Math.sin(m.yaw)));if(faces.lengthSq()<.1)faces.copy(camera.position).sub(target);faces.y=0;if(faces.lengthSq()<.01)faces.set(0,0,1);faces.normalize();
 const visibility=new WorldRenderedVisibility();visibility.prepare(roots);
 const boxes:{object:THREE.Object3D;box:THREE.Box3}[]=[];for(const root of roots)root.traverse(o=>{const m=o as THREE.Mesh;if(!m.isMesh||m.geometry.type!=='BoxGeometry'||m.userData.cameraTransparent===true)return;for(let p:THREE.Object3D|null=m;p;p=p.parent)if(!p.visible)return;const materials=[m.material].flat();if(!materials.some(mat=>mat.visible&&(!mat.transparent||mat.opacity>=.5)))return;m.geometry.computeBoundingBox();if(m.geometry.boundingBox)boxes.push({object:m,box:m.geometry.boundingBox});});
 const outsideBoxes=(p:THREE.Vector3)=>boxes.every(({object,box})=>!box.containsPoint(object.worldToLocal(p.clone())));
const subjects=Object.fromEntries(members.map(m=>[m.id,{p:[...m.p] as [number,number,number],yaw:m.yaw,height:1.75}]));let best:THREE.Vector3|null=null,bestScore=-Infinity;
 for(let i=0;i<12;i++){const angle=Math.atan2(faces.z,faces.x)+(i%2?-1:1)*Math.ceil(i/2)*Math.PI/6;const eye=target.clone().add(new THREE.Vector3(Math.cos(angle)*distance,Math.max(1.5,distance*.24),Math.sin(angle)*distance));eye.y=Math.max(eye.y,heightAt(eye.x,eye.z)+1.5);
  const pose={position:eye.toArray() as [number,number,number],target:target.toArray() as [number,number,number],fov:camera.fov};if(!outsideBoxes(eye)||!visibility.clear(pose.position,.4))continue;const score=visibility.seen(pose,members.map(m=>m.id),subjects)-i*.002;if(score>bestScore){bestScore=score;best=eye;}}
 return best?{position:best,target,seen:Math.max(0,bestScore)}:null;
}
