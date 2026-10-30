import type * as THREE from 'three';
export type OpeningMotion={at:number;parts:{obj:THREE.Object3D;from:number;to:number}[]};
/** One bounded tween per changed opening; preserve the actual angle on reversal. */
export function beginOpeningMotion(next:THREE.Object3D,previous:THREE.Object3D,at:number):OpeningMotion|undefined {
 const old=new Map<string,THREE.Object3D>();previous.traverse(o=>{if(o.userData.role==='door')old.set(o.name,o);});
 const parts:OpeningMotion['parts']=[];next.traverse(obj=>{const before=old.get(obj.name);if(obj.userData.role!=='door'||!before||Math.abs(before.rotation.y-obj.rotation.y)<1e-6)return;parts.push({obj,from:before.rotation.y,to:obj.rotation.y});obj.rotation.y=before.rotation.y;});
 return parts.length?{at,parts}:undefined;
}
export function stepOpeningMotion(m:OpeningMotion,now:number):boolean {
 const t=Math.max(0,Math.min(1,(now-m.at)/450)),k=t*t*(3-2*t);
 for(const p of m.parts)p.obj.rotation.y=p.from+(p.to-p.from)*k;
 return t<1;
}
