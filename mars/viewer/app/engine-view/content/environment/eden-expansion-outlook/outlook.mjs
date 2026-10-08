import * as THREE from 'three';
import {createAlpineGrove} from '../alpine-grove-proposal/alpine.mjs';
import {createRiverbankStones} from '../riverbank-stone-proposal/stones.mjs';
import {createEdenSkyAppearance,inspectEdenSkyAppearance} from '../cloud-family-proposal/clouds.mjs';

const GROVE={p:[5,0,-53],yaw:-Math.atan2(3,6)};
export function inspectEdenOutlookAppearance(input,enabled=false){
 if(enabled!==true||!input||Object.getPrototypeOf(input)!==Object.prototype)return null;
 const keys=Reflect.ownKeys(input);if(keys.length!==2||!['worldSeed','recordedSeconds'].every(k=>{const d=Object.getOwnPropertyDescriptor(input,k);return d&&Object.hasOwn(d,'value');}))return null;
 const {worldSeed,recordedSeconds}=input;if(!Number.isSafeInteger(worldSeed)||worldSeed<0||worldSeed>0xffffffff||recordedSeconds!==null&&(typeof recordedSeconds!=='number'||!Number.isFinite(recordedSeconds)||recordedSeconds<0||recordedSeconds>1e9))return null;
 const sky=inspectEdenSkyAppearance({worldSeed,recordedSeconds:recordedSeconds??0},true);if(!sky)return null;
 return{worldSeed,recordedSeconds,timeMode:recordedSeconds===null?'fixed seeded ornament':'caller displayed recorded time',grove:{p:[...GROVE.p],yaw:GROVE.yaw,scale:[1.15,1,1]},treeAccentReserve:[-.5,-57,11,-48],existingLookoutReserve:[-1,-62,8,-57],scope:'optional visual alpine woodland/ornamental sky; no native support/weather/clock changes',sky};
}
/** Adds one open-axis grove/outlook edge and existing optional sky owner; no original sky mutation. */
export function createEdenOutlookAtmosphere(input,enabled=false){
 const inspection=inspectEdenOutlookAppearance(input,enabled);if(!inspection)return null;
 const group=new THREE.Group(),owners=[];group.name='Eden alpine woodland outlook and restrained ornamental sky';
 const release=()=>{const errors=[];for(const action of[()=>group.removeFromParent(),...owners.map(o=>()=>o.dispose()),()=>group.clear()])try{action();}catch(e){errors.push(e);}return errors;};
 let skyOwner,closed=false,lastSeconds=inspection.recordedSeconds,currentInspection=inspection;
 try{
  const grove=createAlpineGrove('grove',{p:[...GROVE.p],yaw:GROVE.yaw});owners.push(grove);grove.group.scale.x=1.15;group.add(grove.group);
  for(const p of[[-3,0,-60],[11,0,-60]]){const stone=createRiverbankStones('long');owners.push(stone);stone.group.position.fromArray(p);group.add(stone.group);}
  skyOwner=createEdenSkyAppearance({worldSeed:inspection.worldSeed,recordedSeconds:inspection.recordedSeconds??0},true);if(!skyOwner)throw Error('Original ornamental sky refused qualified input');owners.push(skyOwner);group.add(skyOwner.group);
 }catch(cause){const errors=release();if(errors.length)throw new AggregateError([cause,...errors],'Outlook construction rollback failed',{cause});throw cause;}
 group.updateMatrixWorld(true);let calls=0,triangles=0,shadowCalls=0,shadowTriangles=0;group.traverse(m=>{if(!m.isMesh)return;const t=(m.geometry.index?.count??m.geometry.attributes.position.count)/3*(m.isInstancedMesh?m.count:1);calls++;triangles+=t;if(m.castShadow){shadowCalls++;shadowTriangles+=t;}});
 if(calls>20||triangles>20_000){const errors=release();throw new AggregateError(errors,'Outlook appearance exceeded low-cost budget');}
 return{group,get inspection(){return structuredClone(currentInspection);},costs:{calls,triangles,oneSunCalls:calls+shadowCalls,oneSunTriangles:triangles+shadowTriangles,textures:0},
  setViewTime(seconds){
   if(closed)return false;
   if(seconds===lastSeconds){skyOwner.group.visible=true;return true;}
   const next=inspectEdenOutlookAppearance({worldSeed:inspection.worldSeed,recordedSeconds:seconds},true);
   if(!next){skyOwner.group.visible=false;return false;}
   next.sky.clusters.forEach((c,i)=>{const root=skyOwner.group.children[i];root.position.fromArray(c.placement.p);root.rotation.y=-c.placement.yaw;root.updateMatrixWorld(true);});
   skyOwner.group.visible=true;lastSeconds=seconds;currentInspection=next;return true;
  },
  dispose(){if(closed)return;closed=true;const errors=release();if(errors.length)throw new AggregateError(errors,'Outlook disposal failed',{cause:errors[0]});}
 };
}
