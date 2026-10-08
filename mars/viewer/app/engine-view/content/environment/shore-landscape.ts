// Composition of accepted owned appearances, never native shoreline state/support.
import * as THREE from 'three';
import type { ShoreDesign } from '../../shore-preview.ts';
import type { ContentView } from './commons.ts';
import { createDryShoreGrove, dryShoreInspection } from './dry-shore.ts';
import { createShoreGardens, shoreGardenInspection } from './shore-gardens.ts';
import { createDryBankReeds, inspectDryBankReeds } from './dry-bank-reeds.ts';
import { createShoreWater, inspectShoreWater } from './shore-water.ts';
type WaterView=ContentView & {setViewTime(seconds:number):void};
export type ShoreLandscapeFactories={grove:(design:ShoreDesign)=>ContentView;gardens:(design:ShoreDesign)=>ContentView;reeds:(design:ShoreDesign)=>ContentView;water:(design:ShoreDesign)=>WaterView};
const ownedFactories:ShoreLandscapeFactories={grove:createDryShoreGrove,gardens:createShoreGardens,reeds:createDryBankReeds,water:createShoreWater};
/** Factories are an explicit assembly test seam; default uses only accepted own modules.
 * Terrain belongs to caller: dry-shore has no terrain/water, so each is drawn once. */
export function createShoreLandscape(design:ShoreDesign,factories:ShoreLandscapeFactories=ownedFactories):WaterView{
  const copied=structuredClone(design);dryShoreInspection(copied);shoreGardenInspection(copied);inspectDryBankReeds(copied);inspectShoreWater(copied);
  if(!factories||!['grove','gardens','reeds','water'].every(k=>typeof factories[k as keyof ShoreLandscapeFactories]==='function'))throw Error('Missing shore landscape factory');
  const group=new THREE.Group();group.name='Owned shore landscape appearance assembly';const views:ContentView[]=[];let closed=false,water:WaterView;
  const release=()=>{const errors:unknown[]=[];try{group.removeFromParent();}catch(e){errors.push(e);}for(const view of new Set(views)){try{view.dispose();}catch(e){errors.push(e);}}for(const child of [...group.children]){try{group.remove(child);}catch(e){errors.push(e);}}return errors;};
  try{for(const key of ['grove','gardens','reeds'] as const){const v=factories[key](copied);views.push(v);group.add(v.group);}water=factories.water(copied);views.push(water);group.add(water.group);}
  catch(error){closed=true;const errors=release();if(errors.length)throw new AggregateError([error,...errors],'Shore creation and rollback failed',{cause:error});throw error;}
  return{group,setViewTime(seconds:number){if(closed)throw Error('Shore landscape disposed');if(!Number.isFinite(seconds)||seconds<0||seconds>86400)throw Error('View time must be finite seconds in [0,86400]');water.setViewTime(seconds);},dispose(){if(closed)return;closed=true;const errors=release();if(errors.length)throw new AggregateError(errors,'Shore landscape disposal failed');}};
}
