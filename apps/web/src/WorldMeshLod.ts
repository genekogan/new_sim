import * as THREE from 'three';
/** Lane phones (V4): lower geometric detail at a distance, for the phone quality tier.
 *
 * The heavy triangles in a world are a few large static meshes: terrain sectors (32k triangles each, 25 of them on a
 * 1.2 km Mars), merged camps and buildings (60–80k each). At 300 m a phone shows a terrain sector in a few dozen pixels,
 * yet draws every triangle twice (view and shadow). For each large indexed mesh this builds coarser index buffers with
 * meshoptimizer's simplifier (vertices and every attribute are shared, only a new, shorter index is added; borders are
 * locked so neighbouring terrain sectors never crack), records each level's geometric error in metres, and just before
 * renderer.render swaps in the coarsest level whose error projects below `maxErrorPx` CSS pixels at that mesh's nearest
 * distance from the camera. `restore` puts the original geometry back right after rendering, so picking, raycasts,
 * static batching checks and tests never see a level. Levels are built lazily, one mesh per frame within a small time
 * budget, after the simplifier has loaded; until then, and for anything unsuitable, the original is drawn. */
export type MeshLodOptions={minTriangles:number;maxErrorPx:number;ratios:readonly number[];rescanFrames:number;budgetMs:number;
  /** Hard cap on any level's deviation in metres: decals (tyre tracks, paths, shadows painted on the ground) sit ~2.5 cm
   * above the terrain and must stay above a simplified surface. */
  maxWorldError:number};
export const PHONE_MESH_LOD:MeshLodOptions=Object.freeze({minTriangles:6000,maxErrorPx:1,ratios:[0.3,0.1,0.03],rescanFrames:120,budgetMs:6,maxWorldError:0.015});
export type Simplifier={simplify(indices:Uint32Array,positions:Float32Array,stride:number,targetIndexCount:number,targetError:number,flags?:string[]):[Uint32Array,number];
  simplifyWithAttributes?(indices:Uint32Array,positions:Float32Array,stride:number,attributes:Float32Array,attributeStride:number,weights:number[],lock:Uint8Array|null,targetIndexCount:number,targetError:number,flags?:string[]):[Uint32Array,number]};
/** Vertex colours carry painted ground (tyre tracks, paths, soil patches): a colour step of ~0.03 counts like a 1.5 cm
 * displacement, so painted detail survives simplification. Normals keep the shading of folds. */
const COLOUR_WEIGHT=0.5,NORMAL_WEIGHT=0.05;
type Level={geometry:THREE.BufferGeometry;error:number;triangles:number};
type Entry={mesh:THREE.Mesh;base:THREE.BufferGeometry;centre:THREE.Vector3;radius:number;levels:Level[]|null};

/** Coarser index levels for one geometry: [{index, error (model units), triangles}], coarsest last. Pure (tests). */
export function buildLevels(s:Simplifier,geometry:THREE.BufferGeometry,ratios:readonly number[],maxError=Number.MAX_VALUE):{index:Uint32Array;error:number;triangles:number}[]{
  const pos=geometry.attributes.position as THREE.BufferAttribute,src=geometry.index!.array;
  const positions=pos.array instanceof Float32Array&&pos.itemSize===3?pos.array:Float32Array.from({length:pos.count*3},(_,i)=>pos.getComponent(Math.floor(i/3),i%3));
  const indices=src instanceof Uint32Array?src:Uint32Array.from(src as ArrayLike<number>);
  const out:{index:Uint32Array;error:number;triangles:number}[]=[];let last=indices.length;
  const colour=geometry.attributes.color as THREE.BufferAttribute|undefined,normal=geometry.attributes.normal as THREE.BufferAttribute|undefined;
  const parts=[...(colour?[{a:colour,n:3,w:COLOUR_WEIGHT}]:[]),...(normal?[{a:normal,n:3,w:NORMAL_WEIGHT}]:[])];
  const stride=parts.reduce((k,p)=>k+p.n,0),attributes=stride&&s.simplifyWithAttributes?new Float32Array(pos.count*stride):null;
  if(attributes)for(let v=0;v<pos.count;v++){let o=v*stride;for(const p of parts)for(let c=0;c<p.n;c++)attributes[o++]=p.a.getComponent(v,c);}
  const weights=parts.flatMap(p=>Array(p.n).fill(p.w));
  for(const r of ratios){
    const target=Math.max(3,Math.floor(indices.length*r/3)*3);
    const [index,error]=attributes?s.simplifyWithAttributes!(indices,positions,3,attributes,stride,weights,null,target,maxError,['LockBorder','ErrorAbsolute']):s.simplify(indices,positions,3,target,maxError,['LockBorder','ErrorAbsolute']);
    if(!(index.length>0)||index.length>=last*0.8||!Number.isFinite(error))continue;   // not meaningfully coarser than the previous level
    out.push({index,error,triangles:index.length/3});last=index.length;
  }
  return out;
}
const suitable=(m:THREE.Mesh,min:number)=>{
  const mat=m.material as THREE.Material;if(Array.isArray(mat)||mat.polygonOffset||mat.transparent)return false;   // decals and see-through layers draped on other surfaces keep their exact shape
  const g=m.geometry;if(!m.isMesh||(m as THREE.SkinnedMesh).isSkinnedMesh||(m as THREE.InstancedMesh).isInstancedMesh||!m.frustumCulled||m.userData.keepDetail||!g||!g.index)return false;
  const pos=g.attributes.position as THREE.BufferAttribute|undefined;
  return !!pos&&!(pos as unknown as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute&&pos.itemSize===3&&g.index.count/3>=min&&g.groups.length<=1&&g.drawRange.start===0&&g.drawRange.count===Infinity&&!Object.keys(g.morphAttributes).length;
};
export class WorldMeshLod{
  private entries=new Map<THREE.Mesh,Entry>();private frame=0;private swapped:Entry[]=[];private world=new THREE.Vector3();
  private o:MeshLodOptions;private simplifier:Simplifier|null=null;
  /** Last apply(): meshes with levels, meshes drawn coarser, triangles drawn vs. the originals', CPU ms (incl. building). */
  readonly stats={meshes:0,ready:0,coarser:0,triangles:0,fullTriangles:0,cpuMs:0,buildMs:0};
  constructor(o:MeshLodOptions,load:()=>Promise<Simplifier|null>){this.o=o;void load().then(s=>{this.simplifier=s;},()=>{this.simplifier=null;});}
  private scan(root:THREE.Object3D){
    const seen=new Set<THREE.Mesh>();
    root.traverse(o=>{const m=o as THREE.Mesh;if(!m.isMesh||!suitable(m,this.o.minTriangles))return;seen.add(m);
      const e=this.entries.get(m);if(e&&e.base===m.geometry)return;if(e)this.drop(e);
      const g=m.geometry;if(!g.boundingSphere)g.computeBoundingSphere();if(!g.boundingSphere||!Number.isFinite(g.boundingSphere.radius))return;
      this.entries.set(m,{mesh:m,base:g,centre:g.boundingSphere.center.clone(),radius:g.boundingSphere.radius,levels:null});});
    for(const e of [...this.entries.values()])if(!seen.has(e.mesh))this.drop(e);
  }
  // A dropped entry's base is no longer drawn by its mesh: free the level index buffers (three also forgets the shared attributes' buffers; a still-used base simply uploads them again)
  private drop(e:Entry){this.entries.delete(e.mesh);for(const l of e.levels??[])l.geometry.dispose();e.levels=null;}
  private build(e:Entry){
    const el=e.mesh.matrixWorld.elements,scale=Math.sqrt(Math.max(el[0]*el[0]+el[1]*el[1]+el[2]*el[2],el[4]*el[4]+el[5]*el[5]+el[6]*el[6],el[8]*el[8]+el[9]*el[9]+el[10]*el[10]))||1;
    const levels=buildLevels(this.simplifier!,e.base,this.o.ratios,this.o.maxWorldError/scale);
    e.levels=levels.map(({index,error,triangles})=>{
      const g=new THREE.BufferGeometry();for(const [k,a] of Object.entries(e.base.attributes))g.setAttribute(k,a);
      g.setIndex(new THREE.BufferAttribute(index,1));g.boundingSphere=e.base.boundingSphere;g.boundingBox=e.base.boundingBox;g.name=`${e.base.name||'mesh'} lod ${triangles}`;
      return {geometry:g,error,triangles};});
  }
  /** Call right before renderer.render. */
  apply(root:THREE.Object3D,camera:THREE.PerspectiveCamera,viewHeight:number){
    const t0=performance.now();
    if(this.frame++%this.o.rescanFrames===0)this.scan(root);
    if(this.simplifier){const b0=performance.now();for(const e of this.entries.values()){if(e.levels)continue;if(performance.now()-b0>this.o.budgetMs)break;try{this.build(e);}catch{e.levels=[];}}this.stats.buildMs+=performance.now()-b0;}
    const cam=camera.position,pxPerUnit=viewHeight/(2*Math.tan(camera.fov*Math.PI/360))*(camera.zoom||1);let coarser=0,tris=0,full=0,ready=0;
    for(const e of this.entries.values()){
      const m=e.mesh,n=e.base.index!.count/3;full+=n;
      if(!e.levels?.length||m.geometry!==e.base){tris+=n;continue;}ready++;
      const el=m.matrixWorld.elements,scale=Math.sqrt(Math.max(el[0]*el[0]+el[1]*el[1]+el[2]*el[2],el[4]*el[4]+el[5]*el[5]+el[6]*el[6],el[8]*el[8]+el[9]*el[9]+el[10]*el[10]));
      const d=this.world.copy(e.centre).applyMatrix4(m.matrixWorld).distanceTo(cam)-e.radius*scale;
      if(d<=0){tris+=n;continue;}
      const allowed=this.o.maxErrorPx*d/pxPerUnit;let pick:Level|null=null;
      for(const l of e.levels)if(l.error*scale<=allowed)pick=l;else break;
      if(pick){m.geometry=pick.geometry;this.swapped.push(e);coarser++;tris+=pick.triangles;}else tris+=n;
    }
    Object.assign(this.stats,{meshes:this.entries.size,ready,coarser,triangles:tris,fullTriangles:full,cpuMs:performance.now()-t0});
  }
  /** Call right after renderer.render. */
  restore(){for(const e of this.swapped)e.mesh.geometry=e.base;this.swapped.length=0;}
  dispose(){this.restore();for(const e of [...this.entries.values()])this.drop(e);}
}
