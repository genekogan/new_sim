// Selected decoded capture depiction only; caller owns scene binding and native truth.
import * as THREE from 'three';
import {createNativeShoreTerrain,inspectNativeShoreTerrain,type NativeShoreTerrainInput} from './native-shore-terrain.ts';
import {createNativeShoreLandscape} from './native-shore-landscape.ts';
import {inspectCapturedBankDressing,createCapturedBankDressing} from './captured-bank-dressing.ts';
import {inspectShoreWater} from './shore-water.ts';
import {inspectCapturedWaterSurface,createCapturedWaterSurface} from './captured-water-surface.ts';
import type {ShoreDesign} from '../../shore-preview.ts';
export type CapturedShoreWaterInput={readonly id:string;readonly datumY:number;readonly wetBoundsXZ:readonly number[]};
export type CapturedShoreView={readonly group:THREE.Group;setViewTime(seconds:number):void;dispose():void};
function waterCopy(input:CapturedShoreWaterInput){
  if(!input||typeof input!=='object')throw Error('Unsupported captured water');
  const keys=Reflect.ownKeys(input);if(keys.length!==3||keys.some(k=>!['id','datumY','wetBoundsXZ'].includes(k as string)))throw Error('Unsupported captured water fields');
  const fields=Object.fromEntries(keys.map(k=>{const d=Object.getOwnPropertyDescriptor(input,k);if(!d||!Object.hasOwn(d,'value'))throw Error('Captured water requires own data fields');return[k,d.value];}));
  const bounds=fields.wetBoundsXZ;if(!Array.isArray(bounds)||bounds.length!==4||Reflect.ownKeys(bounds).length!==5)throw Error('Unsupported captured water bounds');
  const expected=[-16,-12,0,12];for(let i=0;i<4;i++){const d=Object.getOwnPropertyDescriptor(bounds,String(i));if(!d||!Object.hasOwn(d,'value')||d.value!==expected[i])throw Error('Unsupported captured water bounds');}
  if(fields.id!=='eden-shore-water'||fields.datumY!==0)throw Error('Unsupported captured water datum or id');
  return {id:fields.id as string,datumY:0,wetBoundsXZ:expected};
}
export function createCapturedShoreEnvironment(terrain:NativeShoreTerrainInput,water:CapturedShoreWaterInput,appearance?:ShoreDesign):CapturedShoreView{
  const ground=inspectNativeShoreTerrain(terrain),wet=waterCopy(water),proposal=appearance===undefined?undefined:structuredClone(appearance);
  if(proposal){
    const t=proposal.terrain;inspectNativeShoreTerrain({id:ground.id,originXZ:t.originXZ,spacingMetres:t.spacingMetres,columns:t.columns,rows:t.rows,heightMetres:t.heightMetres,diagonal:'min-min/max-max'});
    const a=inspectShoreWater(proposal);if(a.nativeDatumY!==wet.datumY)throw Error('Captured and appearance water disagree');
  }
  const bank=proposal===undefined?inspectCapturedBankDressing({...ground,diagonal:'min-min/max-max'}):undefined;
  if(!proposal)inspectCapturedWaterSurface({...ground,diagonal:'min-min/max-max'},wet);
  // Complete capture/design/dressing refusal before any renderer allocation. Existing green
  // owner contains its own single water surface, including cosmetic .003 lift.
  const group=new THREE.Group();group.name='Captured native shoreline environment';
  const owners:{dispose():void}[]=[];let green:ReturnType<typeof createNativeShoreLandscape>|undefined,calm:ReturnType<typeof createCapturedWaterSurface>|undefined,closed=false;
  const release=()=>{const errors:unknown[]=[];try{group.removeFromParent();}catch(e){errors.push(e);}for(const owner of owners){try{owner.dispose();}catch(e){errors.push(e);}}for(const child of group.children.slice()){try{group.remove(child);}catch(e){errors.push(e);}}return errors;};
  try{
    const copied={...ground,diagonal:'min-min/max-max'};
    if(proposal){green=createNativeShoreLandscape(copied,proposal);owners.push(green);group.add(green.group);}
    else{
      const view=createNativeShoreTerrain(copied);owners.push(view);group.add(view.group);
      const dressing=createCapturedBankDressing(bank!.terrain);owners.push(dressing);group.add(dressing.group);
      calm=createCapturedWaterSurface(copied,wet);owners.push(calm);group.add(calm.group);
    }
  }catch(error){closed=true;const errors=release();if(errors.length)throw new AggregateError([error,...errors],'Captured shoreline creation and rollback failed',{cause:error});throw error;}
  return {group,setViewTime(seconds:number){if(closed)throw Error('Captured shoreline disposed');if(!Number.isFinite(seconds)||seconds<0||seconds>86400)throw Error('View time must be finite seconds in [0,86400]');green?.setViewTime(seconds);calm?.setViewTime(seconds);},dispose(){if(closed)return;closed=true;const errors=release();if(errors.length)throw new AggregateError(errors,'Captured shoreline disposal failed',{cause:errors[0]});}};
}
