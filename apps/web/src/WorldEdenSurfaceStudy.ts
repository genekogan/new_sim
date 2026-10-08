import * as THREE from 'three';
import {hashOf} from '../../../mars/viewer/engine/core/hash.ts';
import {createNewLandscapeStudyFinish,type NewLandscapeStudyFinish,type NewLandscapeKind} from '../../../mars/viewer/app/engine-view/content/details/eden-factory-comparison/new-landscape-entry.mjs';
import source from './WorldEdenSurfaceSource.json' with {type:'json'};
const points=[{kind:'expansion-ground',name:'NEW expansion cosmetic ground; original native rectangles omitted',recipe:'neutral-grass'},{kind:'expansion-path',name:'Connected countryside and forest path appearance; no route grant'},{kind:'cultivated-soil',name:'Cultivated garden plot 37:44'}] as const;
const style=(m:THREE.MeshStandardMaterial)=>({color:'#'+m.color.getHexString(),roughness:m.roughness,metalness:m.metalness,side:m.side,vertexColors:m.vertexColors,flatShading:m.flatShading,transparent:m.transparent,opacity:m.opacity,depthTest:m.depthTest,depthWrite:m.depthWrite,materialPrototype:'MeshStandardMaterial/r185/native',maps:'none',hooks:'native'});
/** Reversible material presentation on the three ACTUAL NEW owned primitives.
 * Original geometry, actor/rigs, roots and original material/cache ownership stay
 * with their constructors; only these local mesh slots receive owned finishes. */
export function createWorldEdenSurfaceStudy(landscape:THREE.Group){
 let closed=false,quality:'Simple'|'Rich'='Simple';const token={},epoch=1;
 let lastRichCost:Record<string,number>|null=null;
 const rows=points.map(point=>{
  const mesh=landscape.getObjectByName(point.name);if(!(mesh instanceof THREE.Mesh)||mesh instanceof THREE.InstancedMesh||mesh instanceof THREE.SkinnedMesh||!(mesh.material instanceof THREE.MeshStandardMaterial))throw Error('Unknown new surface point');
  const original=mesh.material,geometry=mesh.geometry,parent=mesh.parent;
  if(Object.getPrototypeOf(original)!==THREE.MeshStandardMaterial.prototype||original.onBeforeCompile!==THREE.Material.prototype.onBeforeCompile||original.customProgramCacheKey!==THREE.Material.prototype.customProgramCacheKey||Object.values(original).some(v=>v instanceof THREE.Texture))throw Error('Mapped/custom surface is not a new simple construction point');
  const entries=Object.entries(geometry.attributes) as [string,THREE.BufferAttribute][];if(entries.some(([,a])=>!(a instanceof THREE.BufferAttribute)))throw Error('Unknown surface attribute storage');
  const attrs=entries.map(([key,a])=>({key,a,array:a.array,version:a.version})),index=geometry.index,root=mesh.matrix.toArray(),baseline=style(original);
  const geometrySignature=hashOf({type:geometry.type,attributes:attrs.map(a=>({key:a.key,itemSize:a.a.itemSize,data:Array.from(a.array)})),index:index?Array.from(index.array):null});
  const provenance={...source,ownerId:'World-new-Eden-expansion',slotId:point.kind,targetName:point.name,targetScope:'new-eden-expansion-owned',geometrySignature};
  let finish:NewLandscapeStudyFinish|null=null;
  const exact=()=>!closed&&mesh.parent===parent&&mesh.geometry===geometry&&mesh.material===(quality==='Rich'?finish?.material:original)&&geometry.index===index&&attrs.every(a=>geometry.attributes[a.key]===a.a&&a.a.array===a.array&&a.a.version===a.version)&&mesh.matrix.toArray().every((v,i)=>v===root[i])&&JSON.stringify(style(original))===JSON.stringify(baseline);
  const lease={exclusive:true,epoch,token,alive:()=>!closed,currentEpoch:()=>epoch,currentToken:()=>token,validateNewPoint:(kind:NewLandscapeKind,p:unknown,b:unknown)=>kind===point.kind&&p===provenance&&b===baseline&&exact()};
  return{point,mesh,original,baseline,provenance,lease,exact,release(){finish?.dispose();finish=null;},get finish(){return finish;},prepare(){if(finish)return finish;const candidate=createNewLandscapeStudyFinish({quality:'Rich',kind:point.kind,baseline,provenance,lease,...('recipe'in point?{surfaceRecipe:point.recipe}:{})});if(candidate.quality==='SimpleOriginal'||!candidate.validateBeforeAttach())throw Error('Actual new surface preparation refused');finish=candidate;return candidate;}};
 });
 let coldPreparationMs:number|null=null;
 const restore=()=>{for(const row of rows)row.mesh.material=row.original;quality='Simple';};
 return {setQuality(next:'Simple'|'Rich'){
  if(closed||!['Simple','Rich'].includes(next))return false;if(next===quality)return true;
  if(next==='Simple'){restore();for(const r of rows)r.release();return true;}
  const started=performance.now();try{if(!rows.every(r=>r.exact()))throw Error('New surface drift');const prepared=rows.map(r=>r.prepare());if(!prepared.every(f=>f.validateBeforeAttach()))throw Error('Late new surface drift');for(let i=0;i<rows.length;i++)rows[i].mesh.material=prepared[i].material;quality='Rich';lastRichCost={decodedTextureBytes:prepared.reduce((n,f)=>n+f.state().decodedBytes,0),estimatedMipBytes:prepared.reduce((n,f)=>n+f.state().estimatedMipBytes,0),textures:prepared.reduce((n,f)=>n+f.state().maps,0),materials:prepared.length};if(coldPreparationMs===null)coldPreparationMs=performance.now()-started;return true;}catch{restore();for(const r of rows)r.release();return false;}
 },inspection(){return{quality,coldPreparationMs,lastRichCost,points:rows.map(r=>({kind:r.point.kind,name:r.mesh.name,geometrySignature:r.provenance.geometrySignature,baseline:r.baseline})),decodedTextureBytes:rows.reduce((n,r)=>n+(r.finish?.state().decodedBytes??0),0),estimatedMipBytes:rows.reduce((n,r)=>n+(r.finish?.state().estimatedMipBytes??0),0),ownTextures:rows.reduce((n,r)=>n+(r.finish?.state().maps??0),0),ownMaterials:rows.filter(r=>r.finish).length,extraMeshes:0,extraGeometry:0,originalPointersRestored:rows.every(r=>r.mesh.material===r.original),HWFrameQualified:false};},
  dispose(){if(closed)return;restore();closed=true;for(const row of rows)row.release();}
 };
}
