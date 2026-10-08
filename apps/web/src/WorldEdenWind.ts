import * as THREE from 'three';
import {VegetationViews,type VegetationPlacement} from '../../../mars/viewer/app/engine-view/vegetation.ts';
import {prepareExpansionCrownWind,type ExpansionWindOwner} from '../../../mars/viewer/app/engine-view/content/details/eden-expansion-wind/wind.mjs';
import sourcePins from './WorldEdenWindSource.json' with {type:'json'};
const crownNames=new Set(['vegetation:ball:leaf','vegetation:ball:light']);
const matrixKey=(a:ArrayLike<number>,offset:number)=>Array.from({length:16},(_,i)=>Math.fround(a[offset+i])).join(',');
/** Caller-owned NEW scenery only. Original per-plant constructors establish each
 * crown's actual Float32 index association before a presentation buffer is made. */
export function createWorldEdenWind(group:THREE.Group,plants:readonly VegetationPlacement[]){
 const batches=group.children.filter(o=>o.name==='decorative vegetation preview').slice(0,Math.ceil(plants.length/480));
 const token={},epoch=1,owners:{source:THREE.InstancedMesh;wind:ExpansionWindOwner;visible:boolean}[]=[];
 let closed=false,enabled=false;
 try{
  group.updateWorldMatrix(true,true);
  for(let chunk=0;chunk<batches.length;chunk++){
   const witnessByName=new Map<string,Map<string,{plantId:string;seed:number}>>();
   for(const plant of plants.slice(chunk*480,(chunk+1)*480)){
    if(plant.kind!=='canopy-tree')continue;
    const witness=new VegetationViews([plant]);
    try{for(const child of witness.group.children){if(!(child instanceof THREE.InstancedMesh)||!crownNames.has(child.name))continue;
     const rows=witnessByName.get(child.name)??new Map();
     for(let i=0;i<child.count;i++){const key=matrixKey(child.instanceMatrix.array,i*16);if(rows.has(key))throw Error('Ambiguous new crown association');rows.set(key,{plantId:plant.id,seed:plant.seed??1});}witnessByName.set(child.name,rows);
    }}finally{witness.dispose();}
   }
   for(const child of batches[chunk].children){
    if(!(child instanceof THREE.InstancedMesh)||!crownNames.has(child.name))continue;
    const proof=witnessByName.get(child.name);if(!proof?.size)continue;
    const selection:{index:number;plantId:string;seed:number}[]=[],used=new Set<string>();
    for(let index=0;index<child.count;index++){const key=matrixKey(child.instanceMatrix.array,index*16),row=proof.get(key);if(!row)continue;if(used.has(key))throw Error('Repeated new crown matrix');used.add(key);selection.push({index,...row});}
    if(used.size!==proof.size)throw Error('New canopy crown coverage is incomplete');
    const byIndex=new Map(selection.map(r=>[r.index,r])),creation=Object.freeze({id:'eden-expansion-canopy-batch:'+chunk+':'+child.name,family:'original-VegetationViews-canopy',prototypeRevision:'ball/185/1'});
    const lease={exclusive:true,epoch,token,alive:()=>!closed,currentEpoch:()=>epoch,currentToken:()=>token,
     validateActualCrownCoverage:(source:THREE.InstancedMesh,rows:typeof selection,c:typeof creation,pins:typeof sourcePins)=>!closed&&source===child&&child.parent===batches[chunk]&&c===creation&&pins===sourcePins&&rows.length===selection.length&&rows.every(r=>{const actual=byIndex.get(r.index);return actual?.plantId===r.plantId&&actual.seed===r.seed;})};
    const wind=prepareExpansionCrownWind({enabled:true,source:child,selection,creation,lease,sourcePins});
    if(wind.quality==='Simple')continue;
    // The new batch keeps every original index. Selection resolves to its same
    // original source/instance; these decorative plants have no native identity.
    wind.mesh.userData.edenWindOriginal=child;wind.mesh.userData.edenWindPlantIds=Object.fromEntries(selection.map(r=>[r.index,r.plantId]));
    child.parent!.add(wind.mesh);wind.mesh.visible=false;owners.push({source:child,wind,visible:child.visible});
   }
  }
 }catch(error){for(const o of owners){o.source.visible=o.visible;o.wind.dispose();}throw error;}
 return {setEnabled(value:boolean){if(closed)return;enabled=value;for(const o of owners){o.source.visible=value?false:o.visible;o.wind.mesh.visible=value;}},
  update(seconds:number,reducedMotion=false){if(closed||!enabled)return;for(const o of owners)if(!o.wind.update(seconds,reducedMotion)){o.source.visible=o.visible;o.wind.mesh.visible=false;}},
  inspection(){return{enabled,batches:owners.length,crowns:owners.reduce((n,o)=>n+o.wind.snapshot().selected,0),ownedBufferBytes:owners.reduce((n,o)=>n+o.wind.cost.instanceBytes+o.wind.cost.baselineCopyBytes,0),newTextures:0,extraDraws:0,scope:'Optional NEW decorative crowns; actual recorded time; no body/native contacts',GPUQualified:false};},
  dispose(){if(closed)return;closed=true;for(const o of owners){o.source.visible=o.visible;o.wind.dispose();}owners.length=0;}
 };
}
