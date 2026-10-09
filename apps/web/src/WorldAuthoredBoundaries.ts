import {authoredBoundariesV1Schema} from '../../../packages/engine-contract/src/authored-boundaries-v1.ts';
import type * as THREE from 'three';
import {authoredBoundarySweepFraction,type AuthoredBoundaryBox} from '../../../mars/viewer/lib/authored-boundaries.ts';
export const AUTHORED_CAMERA_CONTACT_PRECISION=1e-6;
const object=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
/** Only an admitted fact from this displayed scene can constrain the camera. Current renderer registration is never a fallback. */
export class WorldAuthoredBoundaries{
 private publication:unknown;private acceptedAtTick=Infinity;private boxes:readonly AuthoredBoundaryBox[]=[];private bounds:{box:AuthoredBoundaryBox;x0:number;x1:number;y0:number;y1:number;z0:number;z1:number}[]=[];private candidates:AuthoredBoundaryBox[]=[];
 bind(publication:unknown){if(publication===this.publication)return;this.publication=publication;this.boxes=[];this.acceptedAtTick=Infinity;
  this.bounds=[];const fact=object(object(object(object(publication)?.body)?.scene)?.authoredBoundaries),parsed=authoredBoundariesV1Schema.safeParse(fact);if(!parsed.success)return;
  this.boxes=parsed.data.boxes.filter(b=>b.collision==='solid');this.acceptedAtTick=parsed.data.acceptedAtTick;
  this.bounds=this.boxes.map(box=>{const x=Math.abs(Math.cos(box.yaw))*box.half[0]+Math.abs(Math.sin(box.yaw))*box.half[2],z=Math.abs(Math.sin(box.yaw))*box.half[0]+Math.abs(Math.cos(box.yaw))*box.half[2];return{box,x0:box.c[0]-x,x1:box.c[0]+x,y0:box.c[1]-box.half[1],y1:box.c[1]+box.half[1],z0:box.c[2]-z,z1:box.c[2]+z};});
 }
 at(tick:number):readonly AuthoredBoundaryBox[]{return Number.isFinite(tick)&&tick>=this.acceptedAtTick?this.boxes:[];}
 constrain(camera:THREE.Camera,target:THREE.Vector3,from:THREE.Vector3,tick:number){
  if(!this.at(tick).length)return false;
  const p=camera.position,x0=Math.min(from.x,p.x)-.08,x1=Math.max(from.x,p.x)+.08,y0=Math.min(from.y,p.y)-1.65,y1=Math.max(from.y,p.y)+.1,z0=Math.min(from.z,p.z)-.08,z1=Math.max(from.z,p.z)+.08;
  this.candidates.length=0;for(const b of this.bounds)if(b.x1>=x0&&b.x0<=x1&&b.y1>=y0&&b.y0<=y1&&b.z1>=z0&&b.z0<=z1)this.candidates.push(b.box);
  const fraction=authoredBoundarySweepFraction(this.candidates,from.toArray(),p.toArray(),.08,1.65,.1,AUTHORED_CAMERA_CONTACT_PRECISION);if(fraction>=1)return false;
  const x=camera.position.x,y=camera.position.y,z=camera.position.z;camera.position.lerpVectors(from,camera.position,fraction);target.x+=camera.position.x-x;target.y+=camera.position.y-y;target.z+=camera.position.z-z;camera.lookAt(target);return true;
 }
}
