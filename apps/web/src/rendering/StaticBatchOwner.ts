import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

/** Derived draw geometry only. Callers provide explicitly static roots, never
 * the whole animated scene. Original objects remain the picking/export authority. */
export type StaticBatchLimits={cellSize:number;maxMeshes:number;maxNodes:number;maxMergedBytes:number;maxWorkingBytes:number;maxMeshesPerBatch:number};
export const STATIC_BATCH_LIMITS:StaticBatchLimits=Object.freeze({cellSize:24,maxMeshes:8192,maxNodes:65536,maxMergedBytes:32*1024*1024,maxWorkingBytes:64*1024*1024,maxMeshesPerBatch:64});
export type StaticBatchPreparation={generation:number;signal?:AbortSignal;budgetPolicy?:'partial-cells/1'};
type AttributeStamp={name:string;attribute:THREE.BufferAttribute;version:number};
type Source={mesh:THREE.Mesh;root:THREE.Object3D;geometry:THREE.BufferGeometry;material:THREE.Material;matrix:number[];attributes:AttributeStamp[];index:THREE.BufferAttribute|null;indexVersion:number;materialVersion:number;layers:number;cast:boolean;receive:boolean;order:number;frustum:boolean;bounds:readonly number[]};
type Batch={mesh:THREE.Mesh;sources:Source[];bytes:number};
const meshBefore=THREE.Object3D.prototype.onBeforeRender,meshAfter=THREE.Object3D.prototype.onAfterRender,shadowBefore=THREE.Object3D.prototype.onBeforeShadow,shadowAfter=THREE.Object3D.prototype.onAfterShadow,materialBefore=THREE.Material.prototype.onBeforeRender,compile=THREE.Material.prototype.onBeforeCompile;
const visible=(o:THREE.Object3D)=>{for(let p:THREE.Object3D|null=o;p;p=p.parent)if(!p.visible)return false;return true;};
const within=(o:THREE.Object3D,root:THREE.Object3D)=>{for(let p:THREE.Object3D|null=o;p;p=p.parent)if(p===root)return true;return false;};
type ValidationWindow={materials:Map<THREE.Material,boolean>;paths:Map<THREE.Object3D,boolean>;geometries:Map<THREE.BufferGeometry,boolean>};
function materialEligible(m:THREE.Material,cache?:Map<THREE.Material,boolean>){
 const known=cache?.get(m);if(known!==undefined)return known;
 const surface=m as THREE.MeshPhysicalMaterial;
 const result=!(m as THREE.ShaderMaterial).isShaderMaterial&&!(m as THREE.RawShaderMaterial).isRawShaderMaterial&&!(surface.transmission>0)&&!surface.displacementMap&&!(surface.normalMap&&surface.normalMapType===THREE.ObjectSpaceNormalMap)&&m.visible&&!m.transparent&&m.opacity===1&&m.depthWrite&&m.depthTest&&m.blending===THREE.NormalBlending&&m.onBeforeCompile===compile&&m.onBeforeRender===materialBefore&&!Object.values(m).some(v=>(v as {isVideoTexture?:boolean}|null)?.isVideoTexture);
 cache?.set(m,result);return result;
}
function eligible(mesh:THREE.Mesh,root:THREE.Object3D,materials?:Map<THREE.Material,boolean>,pathValidated=false,geometryValidated=false,matrixValidated=false){
 if(mesh.constructor!==THREE.Mesh||mesh.children.length||mesh.raycast!==THREE.Mesh.prototype.raycast||mesh.onBeforeRender!==meshBefore||mesh.onAfterRender!==meshAfter||mesh.onBeforeShadow!==shadowBefore||mesh.onAfterShadow!==shadowAfter||mesh.customDepthMaterial||mesh.customDistanceMaterial||Array.isArray(mesh.material))return false;
 if(!pathValidated)for(let p:THREE.Object3D|null=mesh;p;p=p.parent){if(p.animations.length||p.userData.dynamicScreen||p.userData.renderDynamic||p.userData.kind==='context_person')return false;if(p===root)break;}
 const m=mesh.material,g=mesh.geometry;
 if(!materialEligible(m,materials))return false;
 if(!geometryValidated&&!geometryEligible(g))return false;
 return matrixValidated||mesh.matrixWorld.elements.every(Number.isFinite)&&mesh.matrixWorld.determinant()>1e-12;
}
function geometryEligible(g:THREE.BufferGeometry){const pos=g.attributes.position;
 if(!pos||pos.itemSize!==3||!(pos.array instanceof Float32Array)||g.drawRange.start!==0||g.drawRange.count!==Infinity||Object.keys(g.morphAttributes).length)return false;
 for(const a of Object.values(g.attributes))if((a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute)return false;
 return !(g.attributes.normal&&!(g.attributes.normal.array instanceof Float32Array)||g.attributes.tangent&&!(g.attributes.tangent.array instanceof Float32Array));
}
// This cache lives for one synchronous window only. It never survives a change
// to visibility, hierarchy or material between frames. Static root membership is
// checked separately so reparenting within the scene cannot retain authority.
function pathCurrent(o:THREE.Object3D,cache:Map<THREE.Object3D,boolean>):boolean{
 const known=cache.get(o);if(known!==undefined)return known;
 const okay=o.visible&&!o.animations.length&&!o.userData.dynamicScreen&&!o.userData.renderDynamic&&o.userData.kind!=='context_person'&&(!o.parent||pathCurrent(o.parent,cache));cache.set(o,okay);return okay;
}
const geometryBytes=(g:THREE.BufferGeometry)=>Object.values(g.attributes).reduce((n,a)=>n+a.array.byteLength,0)+(g.index?.array.byteLength??0);
const estimatedBytes=(g:THREE.BufferGeometry)=>Object.values(g.attributes).reduce((n,a)=>n+a.array.byteLength,0)+(g.index?g.index.count*4:0);
const bounds=(g:THREE.BufferGeometry)=>[...(g.boundingBox?[g.boundingBox.min.x,g.boundingBox.min.y,g.boundingBox.min.z,g.boundingBox.max.x,g.boundingBox.max.y,g.boundingBox.max.z]:[]),...(g.boundingSphere?[g.boundingSphere.center.x,g.boundingSphere.center.y,g.boundingSphere.center.z,g.boundingSphere.radius]:[]),g.boundingBox?1:0,g.boundingSphere?1:0];
function boundsCurrent(g:THREE.BufferGeometry,b:readonly number[]){const box=g.boundingBox,sphere=g.boundingSphere;let i=0;if(!!box!==!!b[b.length-2]||!!sphere!==!!b[b.length-1])return false;if(box&&(box.min.x!==b[i++]||box.min.y!==b[i++]||box.min.z!==b[i++]||box.max.x!==b[i++]||box.max.y!==b[i++]||box.max.z!==b[i++]))return false;return !sphere||sphere.center.x===b[i++]&&sphere.center.y===b[i++]&&sphere.center.z===b[i++]&&sphere.radius===b[i++];}
function source(mesh:THREE.Mesh,root:THREE.Object3D):Source{return{mesh,root,geometry:mesh.geometry,material:mesh.material as THREE.Material,matrix:[...mesh.matrixWorld.elements],attributes:Object.entries(mesh.geometry.attributes).map(([name,a])=>({name,attribute:a as THREE.BufferAttribute,version:(a as THREE.BufferAttribute).version})),index:mesh.geometry.index,indexVersion:mesh.geometry.index?.version??0,materialVersion:(mesh.material as THREE.Material).version,layers:mesh.layers.mask,cast:mesh.castShadow,receive:mesh.receiveShadow,order:mesh.renderOrder,frustum:mesh.frustumCulled,bounds:bounds(mesh.geometry)};}
function unchanged(s:Source,scene:THREE.Scene,cache:ValidationWindow){const m=s.mesh,g=m.geometry;
 if(!within(s.root,scene)||!within(m,s.root)||!pathCurrent(m,cache.paths)||!eligible(m,s.root,cache.materials,true,true,true)||g!==s.geometry||m.material!==s.material||s.material.version!==s.materialVersion||m.layers.mask!==s.layers||m.castShadow!==s.cast||m.receiveShadow!==s.receive||m.renderOrder!==s.order||m.frustumCulled!==s.frustum||!m.matrixWorld.elements.every((n,i)=>n===s.matrix[i]))return false;
 let geometryCurrent=cache.geometries.get(g);if(geometryCurrent===undefined){geometryCurrent=geometryEligible(g)&&Object.keys(g.attributes).length===s.attributes.length&&s.attributes.every(a=>g.attributes[a.name]===a.attribute&&a.attribute.version===a.version)&&g.index===s.index&&(g.index?.version??0)===s.indexVersion&&boundsCurrent(g,s.bounds);cache.geometries.set(g,geometryCurrent);}return geometryCurrent;
}

export class StaticBatchOwner{
 readonly group=new THREE.Group();private scene:THREE.Scene;private limits:StaticBatchLimits;private batches:Batch[]=[];private roots:THREE.Object3D[]=[];private disposed=false;private rendering=false;private generation:number|null=null;private latestGeneration=-1;private fallback=0;private used=0;private validationCpuMs=0;private restoreCpuMs=0;private prepareCpuMs=0;private sourceNodes=0;private sourceMeshes=0;private preparationError:string|null=null;private budgetSkippedMeshes=0;private budgetSkippedBatches=0;private workingGeometryPeakBytes=0;private callsSaved=0;
 constructor(scene:THREE.Scene,limits:Partial<StaticBatchLimits>={}){this.scene=scene;this.limits={...STATIC_BATCH_LIMITS,...limits};if(Object.values(this.limits).some(n=>!Number.isFinite(n)||n<=0)||!Number.isInteger(this.limits.maxMeshes)||!Number.isInteger(this.limits.maxNodes)||!Number.isInteger(this.limits.maxMeshesPerBatch)||this.limits.maxWorkingBytes<this.limits.maxMergedBytes)throw Error('static-batches.invalid-limits');this.group.name='Derived static render batches';this.group.visible=false;scene.add(this.group);}
 private clear(){for(const batch of this.batches){batch.mesh.geometry.dispose();batch.mesh.removeFromParent();}this.batches=[];this.roots=[];this.generation=null;this.callsSaved=this.used=this.fallback=0;}
 reset(){if(this.rendering)throw Error('static-batches.reset-during-render');this.clear();}
 async prepare(roots:readonly THREE.Object3D[],{generation,signal,budgetPolicy}:StaticBatchPreparation){
  if(this.disposed||this.rendering)throw Error('static-batches.unavailable');if(budgetPolicy!==undefined&&budgetPolicy!=='partial-cells/1')throw Error('static-batches.invalid-budget-policy');if(!Number.isSafeInteger(generation)||generation<0)throw Error('static-batches.invalid-generation');if(generation<this.latestGeneration)throw Error('static-batches.obsolete-generation');if(signal?.aborted)throw new DOMException('Obsolete render preparation','AbortError');this.latestGeneration=generation;this.clear();this.budgetSkippedMeshes=this.budgetSkippedBatches=this.workingGeometryPeakBytes=0;
  const prepareStart=performance.now(),options=this.limits,buckets=new Map<string,Source[]>(),seen=new Set<THREE.Object3D>();let nodes=0,meshes=0,retained=0;this.preparationError=null;this.scene.updateMatrixWorld(true);
  try{
   for(const root of new Set(roots)){if(root===this.scene||!within(root,this.scene))throw Error('static-batches.unregistered-root');root.updateWorldMatrix(true,true);root.traverse(o=>{if(seen.has(o))return;seen.add(o);if(++nodes>options.maxNodes)throw Error('static-batches.node-budget');if(!(o as THREE.Mesh).isMesh||!visible(o)||!eligible(o as THREE.Mesh,root))return;if(++meshes>options.maxMeshes)throw Error('static-batches.mesh-budget');const m=o as THREE.Mesh,g=m.geometry,attributes=Object.entries(g.attributes).map(([name,a])=>`${name}:${a.itemSize}:${a.normalized}:${a.array.constructor.name}`).sort().join(','),p=new THREE.Vector3().setFromMatrixPosition(m.matrixWorld),key=[(m.material as THREE.Material).uuid,Math.floor(p.x/options.cellSize),Math.floor(p.z/options.cellSize),attributes,!!g.index,m.layers.mask,m.castShadow,m.receiveShadow,m.renderOrder,m.frustumCulled].join('|');const bucket=buckets.get(key)??[];bucket.push(source(m,root));buckets.set(key,bucket);});}
   const inverseScene=this.scene.matrixWorld.clone().invert(),candidates:{part:Source[];estimate:number;order:number}[]=[];
   // Bucket insertion follows source traversal, spatial cell, material and draw
   // state. Keep this stable order for equal benefit/byte ratios; UUIDs never
   // determine prioritization. Strict preparation retains its original order.
   for(const sources of buckets.values())for(let i=0;i<sources.length;i+=options.maxMeshesPerBatch){const part=sources.slice(i,i+options.maxMeshesPerBatch);if(part.length>=2)candidates.push({part,estimate:part.reduce((n,s)=>n+estimatedBytes(s.geometry),0),order:candidates.length});}
   if(budgetPolicy==='partial-cells/1')candidates.sort((a,b)=>(b.part.length-1)/Math.max(1,b.estimate)-(a.part.length-1)/Math.max(1,a.estimate)||a.order-b.order);
   for(const {part,estimate} of candidates){if(signal?.aborted)throw new DOMException('Obsolete render preparation','AbortError');if(retained+estimate>options.maxMergedBytes||retained+2*estimate>options.maxWorkingBytes){if(budgetPolicy==='partial-cells/1'){this.budgetSkippedMeshes+=part.length;this.budgetSkippedBatches++;continue;}throw Error('static-batches.geometry-budget');}this.workingGeometryPeakBytes=Math.max(this.workingGeometryPeakBytes,retained+2*estimate);const copies:THREE.BufferGeometry[]=[];let merged:THREE.BufferGeometry|null=null;
    try{for(const s of part){const copy=s.geometry.clone();copies.push(copy);copy.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverseScene,s.mesh.matrixWorld));}merged=mergeGeometries(copies,false);}finally{for(const g of copies)g.dispose();}
    if(!merged)continue;const bytes=geometryBytes(merged);if(retained+bytes>options.maxMergedBytes){merged.dispose();throw Error('static-batches.geometry-budget');}merged.computeBoundingBox();merged.computeBoundingSphere();const first=part[0],mesh=new THREE.Mesh(merged,first.material);mesh.name='Derived static cell';mesh.castShadow=first.cast;mesh.receiveShadow=first.receive;mesh.renderOrder=first.order;mesh.frustumCulled=first.frustum;mesh.layers.mask=first.layers;this.group.add(mesh);this.batches.push({mesh,sources:part,bytes});retained+=bytes;
   }
   this.roots=[...new Set(roots)];this.generation=generation;return{generation,status:'ready' as const};
  }catch(error){this.clear();this.preparationError=error instanceof Error?error.message:'static-batches.prepare-failed';throw error;}finally{this.prepareCpuMs=performance.now()-prepareStart;this.sourceNodes=nodes;this.sourceMeshes=meshes;}
 }
 /** Semantic originals stay unchanged outside this synchronous draw window.
  * Any changed/detached/dynamic/partly-hidden bucket uses original meshes. */
 withRender<T>(draw:()=>T):T{
  if(this.disposed||!this.batches.length)return draw();if(this.rendering)throw Error('static-batches.nested-render');this.rendering=true;const start=performance.now(),hidden:THREE.Mesh[]=[],cache:ValidationWindow={materials:new Map(),paths:new Map(),geometries:new Map()};this.used=this.fallback=this.callsSaved=0;
  try{for(const root of this.roots)root.updateWorldMatrix(true,true);for(const batch of this.batches){const okay=batch.sources.every(s=>unchanged(s,this.scene,cache));batch.mesh.visible=okay;if(!okay){this.fallback++;continue;}this.used++;this.callsSaved+=batch.sources.length-1;for(const s of batch.sources){s.mesh.visible=false;hidden.push(s.mesh);}}this.group.visible=this.used>0;this.validationCpuMs=performance.now()-start;return draw();}
  finally{const restoreStart=performance.now();for(const mesh of hidden)mesh.visible=true;this.group.visible=false;this.rendering=false;this.restoreCpuMs=performance.now()-restoreStart;}
 }
 inspection(){return{generation:this.generation,batches:this.batches.length,batchedMeshes:this.batches.reduce((n,b)=>n+b.sources.length,0),callsSavedLastRender:this.callsSaved,mergedBytes:this.batches.reduce((n,b)=>n+b.bytes,0),usedLastRender:this.used,fallbackLastRender:this.fallback,roots:this.roots.length,sourceNodes:this.sourceNodes,sourceMeshes:this.sourceMeshes,budgetSkippedMeshes:this.budgetSkippedMeshes,budgetSkippedBatches:this.budgetSkippedBatches,workingGeometryPeakBytes:this.workingGeometryPeakBytes,prepareCpuMs:this.prepareCpuMs,validationCpuMs:this.validationCpuMs,restoreCpuMs:this.restoreCpuMs,preparationError:this.preparationError};}
 dispose(){if(this.rendering)throw Error('static-batches.dispose-during-render');if(this.disposed)return;this.disposed=true;this.clear();this.group.removeFromParent();}
}
