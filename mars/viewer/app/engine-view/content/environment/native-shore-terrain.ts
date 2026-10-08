// Exact first native shoreline grid appearance; never canonical support/admission.
import * as THREE from 'three';
export type NativeShoreTerrainInput = {
  readonly id: string; readonly originXZ: readonly number[]; readonly spacingMetres: number;
  readonly columns: number; readonly rows: number; readonly diagonal: string;
  readonly heightMetres: readonly (readonly number[])[];
};
export type NativeShoreTerrainView = { readonly group: THREE.Group; readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>; dispose(): void };
// Publication9b's single row, repeated25 times. This is a refusal certificate,
// not a terrain generator: rendering below reads the copied published heights.
const PROFILE_ROW = [-1.5,-1.5,-1.5,-1.5,-1.5,-1.5,-1.5,-1.5,-1.5,-1.5,-1.5,-1.5,-1.2,-.9,-.6,-.3,0,.13,.26,.39,.52,.65,.78,.91,1.04,1.17,1.3,1.43,1.56,1.69,1.82,1.95,2] as const;
function data(v: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!v || typeof v !== 'object') throw Error('Unsupported native terrain data');
  const own=Reflect.ownKeys(v);
  if(own.length!==keys.length||own.some(k=>typeof k!=='string'||!keys.includes(k)))throw Error('Unsupported native terrain keys');
  const out:Record<string,unknown>={};
  for(const k of keys){const d=Object.getOwnPropertyDescriptor(v,k);if(!d||!Object.hasOwn(d,'value'))throw Error('Native terrain requires own data fields');out[k]=d.value;}
  return out;
}
function dense(v:unknown, count:number):unknown[]{
  if(!Array.isArray(v))throw Error('Native terrain requires dense arrays');
  const d=data(v,[...Array.from({length:count},(_,i)=>String(i)),'length']);
  if(d.length!==count)throw Error('Unsupported native terrain dimensions');
  return Array.from({length:count},(_,i)=>d[String(i)]);
}
function copyProfile(input:NativeShoreTerrainInput){
  const d=data(input,['id','originXZ','spacingMetres','columns','rows','diagonal','heightMetres']);
  if(Object.getPrototypeOf(input)!==Object.prototype&&Object.getPrototypeOf(input)!==null)throw Error('Unsupported native terrain object');
  if(d.id!=='eden-shore-terrain'||d.spacingMetres!==1||d.columns!==33||d.rows!==25||d.diagonal!=='min-min/max-max')throw Error('Unsupported native terrain profile');
  const origin=dense(d.originXZ,2);if(origin[0]!==-16||origin[1]!==-12)throw Error('Unsupported native terrain origin');
  const heightMetres=dense(d.heightMetres,25).map(row=>dense(row,33).map((h,x)=>{if(typeof h!=='number'||!Number.isFinite(h)||h!==PROFILE_ROW[x])throw Error('Unsupported native terrain heights');return h;}));
  return {id:d.id,originXZ:origin as [number,number],spacingMetres:1,columns:33,rows:25,heightMetres};
}
/** Copied exact-profile preflight for composed consumers; no THREE allocations. */
export function inspectNativeShoreTerrain(input:NativeShoreTerrainInput){return copyProfile(input);}
export function createNativeShoreTerrain(input:NativeShoreTerrainInput):NativeShoreTerrainView{
  const terrain=copyProfile(input); // Entire refusal/copy precedes THREE construction.
  const positions:number[]=[],indices:number[]=[],colours:number[]=[];
  for(let z=0;z<terrain.rows;z++)for(let x=0;x<terrain.columns;x++){
    const y=terrain.heightMetres[z][x];positions.push(terrain.originXZ[0]+x*terrain.spacingMetres,y,terrain.originXZ[1]+z*terrain.spacingMetres);
    const colour=new THREE.Color('#b4ae7f').lerp(new THREE.Color('#91ad70'),THREE.MathUtils.clamp(y/.8,0,1));colours.push(colour.r,colour.g,colour.b);
  }
  for(let z=0;z<terrain.rows-1;z++)for(let x=0;x<terrain.columns-1;x++){const a=z*terrain.columns+x,b=a+1,c=a+terrain.columns,d=c+1;indices.push(a,d,b,a,c,d);}
  const group=new THREE.Group(),geometry=new THREE.BufferGeometry();let material:THREE.MeshStandardMaterial|undefined;
  try{
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colours,3));geometry.setIndex(indices);geometry.computeVertexNormals();
    material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:1});
    const mesh=new THREE.Mesh(geometry,material);mesh.receiveShadow=true;mesh.name=terrain.id;group.name=terrain.id;group.add(mesh);let closed=false;
    return {group,mesh,dispose(){if(closed)return;closed=true;const errors:unknown[]=[];
      for(const release of [()=>group.removeFromParent(),()=>group.remove(mesh),()=>geometry.dispose(),()=>material!.dispose()]){try{release();}catch(e){errors.push(e);}}
      if(errors.length)throw new AggregateError(errors,'Native terrain disposal failed');
    }};
  }catch(error){geometry.dispose();material?.dispose();throw error;}
}
