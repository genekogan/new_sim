import type * as THREE from 'three';
export type OpeningMotion={at:number;parts:{obj:THREE.Object3D;from:number;to:number;axis?:'px'|'rz';ms?:number}[]};
/** Entry 37: a radio's needle slides and its tuning knob turns over this long (the tuning hand holds the knob ~0.9 s). */
export const NEEDLE_SWEEP_MS=800;
/** One bounded tween per changed opening; preserve the actual angle on reversal. */
export function beginOpeningMotion(next:THREE.Object3D,previous:THREE.Object3D,at:number):OpeningMotion|undefined {
 const old=new Map<string,THREE.Object3D>();previous.traverse(o=>{if(o.userData.role==='door'||o.userData.role==='needle'||o.userData.role==='knob')old.set(o.name+'|'+o.userData.role,o);});
 const parts:OpeningMotion['parts']=[];next.traverse(obj=>{const role=obj.userData.role,before=old.get(obj.name+'|'+role);if(!before)return;
  if(role==='door'){if(Math.abs(before.rotation.y-obj.rotation.y)<1e-6)return;parts.push({obj,from:before.rotation.y,to:obj.rotation.y});obj.rotation.y=before.rotation.y;}
  else if(role==='needle'){if(Math.abs(before.position.x-obj.position.x)<1e-6)return;parts.push({obj,from:before.position.x,to:obj.position.x,axis:'px',ms:NEEDLE_SWEEP_MS});obj.position.x=before.position.x;}
  else if(role==='knob'){if(Math.abs(before.rotation.z-obj.rotation.z)<1e-6)return;parts.push({obj,from:before.rotation.z,to:obj.rotation.z,axis:'rz',ms:NEEDLE_SWEEP_MS});obj.rotation.z=before.rotation.z;}});
 return parts.length?{at,parts}:undefined;
}
export function stepOpeningMotion(m:OpeningMotion,now:number):boolean {
 let running=false;
 for(const p of m.parts){const t=Math.max(0,Math.min(1,(now-m.at)/(p.ms??450))),k=t*t*(3-2*t),v=p.from+(p.to-p.from)*k;running||=t<1;
  if(p.axis==='px')p.obj.position.x=v;else if(p.axis==='rz')p.obj.rotation.z=v;else p.obj.rotation.y=v;}
 return running;
}
