import type * as THREE from 'three';
type Key='ry'|'sx'|'sy';
export type OpeningMotion={at:number;parts:{obj:THREE.Object3D;key:Key;from:number;to:number;ms:number}[]};
// A hinged leaf swings in 450 ms; curtains slide along their rod and a roller blind rolls in 1.1 s (Soul Actions entry 23).
const ROLES:Record<string,[Key,number]>={door:['ry',450],'curtain-l':['sx',1100],'curtain-r':['sx',1100],blind:['sy',1100]};
const get=(o:THREE.Object3D,k:Key)=>k==='ry'?o.rotation.y:k==='sx'?o.scale.x:o.scale.y;
const put=(o:THREE.Object3D,k:Key,v:number)=>{if(k==='ry')o.rotation.y=v;else if(k==='sx')o.scale.x=v;else o.scale.y=v;};
/** One bounded tween per changed opening; preserve the actual angle (or draw) on reversal. */
export function beginOpeningMotion(next:THREE.Object3D,previous:THREE.Object3D,at:number):OpeningMotion|undefined {
 const old=new Map<string,THREE.Object3D>();previous.traverse(o=>{if(ROLES[o.userData.role])old.set(o.name,o);});
 const parts:OpeningMotion['parts']=[];next.traverse(obj=>{const r=ROLES[obj.userData.role],before=old.get(obj.name);if(!r||!before)return;const [key,ms]=r,from=get(before,key),to=get(obj,key);if(Math.abs(from-to)<1e-6)return;parts.push({obj,key,from,to,ms});put(obj,key,from);});
 return parts.length?{at,parts}:undefined;
}
export function stepOpeningMotion(m:OpeningMotion,now:number):boolean {
 let running=false;
 for(const p of m.parts){const t=Math.max(0,Math.min(1,(now-m.at)/p.ms)),k=t*t*(3-2*t);put(p.obj,p.key,p.from+(p.to-p.from)*k);if(t<1)running=true;}
 return running;
}
