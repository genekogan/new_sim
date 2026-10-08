// One exact native-grid terrain + accepted green appearance owner, never support.
import * as THREE from 'three';
import {createNativeShoreTerrain,inspectNativeShoreTerrain,type NativeShoreTerrainInput} from './native-shore-terrain.ts';
import {createShoreLandscape} from './shore-landscape.ts';
import {dryShoreInspection} from './dry-shore.ts';
import {shoreGardenInspection} from './shore-gardens.ts';
import {inspectDryBankReeds} from './dry-bank-reeds.ts';
import {inspectShoreWater} from './shore-water.ts';
import {designHeightAt,type ShoreDesign} from '../../shore-preview.ts';
import type {ContentView} from './commons.ts';
export function createNativeShoreLandscape(input:NativeShoreTerrainInput,design:ShoreDesign):ContentView & {setViewTime(seconds:number):void}{
  const terrain=inspectNativeShoreTerrain(input),proposal=structuredClone(design);
  const grove=dryShoreInspection(proposal),gardens=shoreGardenInspection(proposal),reeds=inspectDryBankReeds(proposal);inspectShoreWater(proposal);
  // Explicit first profile: equal entire grid guarantees equal sampled ground,
  // including roots and fitted planter walls; do not transplant or repair plants.
  const p=proposal.terrain;
  if(p.columns!==terrain.columns||p.rows!==terrain.rows||p.spacingMetres!==terrain.spacingMetres||p.originXZ.some((n,i)=>n!==terrain.originXZ[i])||p.heightMetres.some((row,z)=>Array.from(row).some((h,x)=>h!==terrain.heightMetres[z][x])))throw Error('Native and proposal terrain disagree');
  const anchors=[...grove.plants.map(v=>[v.p[0],v.p[2]]),...reeds.plants.map(v=>[v.p[0],v.p[2]]),...gardens.plants.map(v=>[v.p[0],v.p[2]]),...gardens.blossoms.map(v=>[v.p[0],v.p[2]]),...gardens.beds.flatMap(b=>b.bottomSamples.map(v=>[v[0],v[2]]))];
  for(const [x,z] of anchors){const a=designHeightAt(p,x,z),b=designHeightAt(terrain,x,z);if(a===null||b===null||!Number.isFinite(a)||a!==b)throw Error('Native and proposal ground samples disagree');}
  const group=new THREE.Group();group.name='Native green shoreline appearance';const views:ContentView[]=[];let landscape:ReturnType<typeof createShoreLandscape>,closed=false;
  const release=()=>{const errors:unknown[]=[];try{group.removeFromParent();}catch(e){errors.push(e);}for(const view of new Set(views)){try{view.dispose();}catch(e){errors.push(e);}}for(const child of [...group.children]){try{group.remove(child);}catch(e){errors.push(e);}}return errors;};
  try{const ground=createNativeShoreTerrain({...terrain,diagonal:'min-min/max-max'});views.push(ground);group.add(ground.group);landscape=createShoreLandscape(proposal);views.push(landscape);group.add(landscape.group);}
  catch(error){closed=true;const errors=release();if(errors.length)throw new AggregateError([error,...errors],'Native shoreline creation and rollback failed',{cause:error});throw error;}
  return {group,setViewTime(seconds:number){if(closed)throw Error('Native shoreline disposed');landscape.setViewTime(seconds);},dispose(){if(closed)return;closed=true;const errors=release();if(errors.length)throw new AggregateError(errors,'Native shoreline disposal failed');}};
}
