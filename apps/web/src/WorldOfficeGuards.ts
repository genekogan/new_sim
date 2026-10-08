import * as THREE from 'three';
import {OFFICE_STAIR_GUARD_VERSION,officeStairGuardBoxes,officeGuardSweepFraction,type OfficeGuardBox} from '../../../mars/viewer/lib/office-stair-guards.ts';

const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
/** Only the scene publication bound to this moment supplies guards. Absent old captures are a no-op. */
export function officeGuardsFromPublication(value:unknown,tick?:number):OfficeGuardBox[]{
 if(!object(value)||!object(value.body)||!object(value.body.scene))return [];
 const fact=value.body.scene.officeStairGuards,expected=officeStairGuardBoxes();
 if(!object(fact)||fact.version!==OFFICE_STAIR_GUARD_VERSION||!Number.isSafeInteger(fact.acceptedAtTick)||Number(fact.acceptedAtTick)<0||!Array.isArray(fact.guards)||fact.guards.length!==expected.length)return [];
 if(tick!==undefined&&(!Number.isFinite(tick)||tick<Number(fact.acceptedAtTick)))return [];
 for(let i=0;i<expected.length;i++){
  const row=fact.guards[i],want=expected[i];
  if(!object(row)||row.id!==want.id||row.buildingId!==want.buildingId||row.floorY!==want.floorY||
   !Array.isArray(row.min)||row.min.length!==3||row.min.some((v,j)=>v!==want.min[j])||
   !Array.isArray(row.max)||row.max.length!==3||row.max.some((v,j)=>v!==want.max[j]))return [];
 }
 return expected;
}

/** Manual camera eye capsule: walking viewpoints cannot slide above a waist-high office guard.
 * Captured guard geometry is supplied by the caller; this never consults current-world history data. */
export function constrainOfficeGuardCamera(camera:THREE.Camera,target:THREE.Vector3,from:THREE.Vector3,guards:readonly OfficeGuardBox[]){
 if(!guards.length)return false;
 const fraction=officeGuardSweepFraction(guards,from.toArray(),camera.position.toArray(),.08,1.65,.1);
 if(fraction>=1)return false;
 const wanted=camera.position.clone();camera.position.copy(from).lerp(wanted,fraction);
 target.add(camera.position.clone().sub(wanted));camera.updateMatrixWorld();return true;
}
