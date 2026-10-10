import type * as THREE from 'three';
export type BackdropHide={kind?:string[];assembly?:string[];layer?:string[]};
export function parseBackdropHide(value:unknown):BackdropHide|undefined{
 if(!value||typeof value!=='object'||Array.isArray(value))return;
 const row=value as Record<string,unknown>,result:BackdropHide={};
 for(const field of ['kind','assembly','layer'] as const){const values=row[field];if(values===undefined)continue;if(!Array.isArray(values)||values.length>32||values.some(v=>typeof v!=='string'||!v||v.length>100))return;result[field]=[...values];}
 return result;
}
/** Existing captured backdrop exclusion metadata is render-only. It removes
 * archival context/reference figures, never native entities or their actions. */
export function applyBackdropVisibility(root:THREE.Object3D,hide?:BackdropHide){
 if(!hide)return 0;let count=0;
 root.traverse(object=>{const d=object.userData;if(hide.kind?.includes(d.kind)||hide.assembly?.includes(d.assembly_id)||hide.layer?.includes(d.layer)){object.visible=false;count++;}});
 return count;
}
