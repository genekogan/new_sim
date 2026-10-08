/** Original procedural commons kit. Appearance only: no physical registration. */
import * as THREE from 'three';
import { ThreeResources } from '../../../../lib/three-resources.ts';
export type ContentView = { readonly group: THREE.Group; dispose(): void };
export type GroundSample = (x: number, z: number) => number | null;
export type PrefabKind = 'pavilion' | 'bench' | 'table' | 'presentation-platform';
export type PrefabPlacement = { id: string; kind: PrefabKind; p: [number,number,number]; yaw: number };
export const COMMONS_PALETTE = Object.freeze({ timber:'#a7784f', bark:'#70533b', plaster:'#d8cbb1', stone:'#a79880', mutedmetal:'#776f60' });
type Material = keyof typeof COMMONS_PALETTE;
type V3 = readonly [number, number, number];
export type PrefabPart = Readonly<{ name:string; material:Material; centre:V3; size:V3 }>;
export type PrefabInspection = Readonly<{
  kind:PrefabKind; origin:'local base centre'; units:'metres'; footprint:readonly [number,number];
  parts:readonly PrefabPart[]; bounds:Readonly<{ min:V3; max:V3 }>;
  clearances:readonly Readonly<{ name:string; min:V3; max:V3 }>[];
  proposedSurfaces:readonly Readonly<{ name:string; centre:V3; size:readonly [number,number]; normal:V3 }>[];
}>;
const KINDS: readonly PrefabKind[] = ['pavilion','bench','table','presentation-platform'];
/** Pure fresh inspection data; modifying it cannot affect existing or later views. */
export function inspectCommonsPrefab(kind:PrefabKind):PrefabInspection {
  if (!KINDS.includes(kind)) throw new Error('Unknown commons prefab kind');
  const parts:PrefabPart[]=[];
  const box=(name:string,material:Material,centre:V3,size:V3)=>parts.push({name,material,centre,size});
  const clearances:PrefabInspection['clearances'][number][]=[];
  const proposedSurfaces:PrefabInspection['proposedSurfaces'][number][]=[];
  let footprint:readonly [number,number];
  if(kind==='pavilion') {
    footprint=[6,4];
    for(const [i,x,z] of [[0,-2.75,-1.75],[1,2.75,-1.75],[2,-2.75,1.75],[3,2.75,1.75]]) {
      box('post-foot-'+i,'stone',[x,.08,z],[.38,.16,.38]);
      box('post-'+i,'timber',[x,1.3,z],[.18,2.6,.18]);
      box('post-collar-'+i,'mutedmetal',[x,.24,z],[.20,.06,.20]);
    }
    for(const z of [-1.75,1.75]) box('eave-beam-'+z,'bark',[0,2.57,z],[5.8,.22,.18]);
    for(const x of [-2.75,2.75]) box('cross-beam-'+x,'timber',[x,2.57,0],[.18,.22,3.7]);
    // A continuous shaded ceiling and staggered shallow roof bands, all inside 6x4.
    box('shaded-ceiling','plaster',[0,2.735,0],[6,.13,4]);
    for(let i=0;i<7;i++) box('roof-rib-'+i,'timber',[-2.7+i*.9,2.82,0],[.065,.04,4]);
    box('roof-cap','bark',[0,2.87,-.7],[6,.06,.28]);
    clearances.push({name:'central-open-aisle',min:[-1,0,-2],max:[1,2.46,2]});
    proposedSurfaces.push({name:'rigid-post-bases-not-terrain-fitted',centre:[0,0,0],size:[6,4],normal:[0,1,0]});
  } else if(kind==='bench') {
    footprint=[2,.65];
    for(const x of [-.72,.72]) {
      box('leg-frame-'+x,'bark',[x,.20,0],[.13,.4,.58]);
      box('back-upright-'+x,'timber',[x,.59,-.275],[.08,.62,.08]);
    }
    box('under-seat-stretcher','bark',[0,.23,0],[1.55,.10,.10]);
    for(let i=0;i<5;i++) box('seat-slat-'+i,'timber',[0,.42,-.22+i*.11],[2,.06,.10]);
    for(let i=0;i<3;i++) box('back-slat-'+i,'timber',[0,.61+i*.12,-.275],[2,.09,.10]);
    // Small end rails distinguish the back from the inviting front (+Z).
    for(const x of [-.95,.95]) box('seat-end-cap-'+x,'bark',[x,.41,.30],[.10,.08,.05]);
    clearances.push({name:'front-approach-proposal',min:[-1,0,.325],max:[1,1.75,1.125]});
    proposedSurfaces.push({name:'slatted-seat',centre:[0,.45,0],size:[2,.54],normal:[0,1,0]});
  } else if(kind==='table') {
    footprint=[1.4,.8];
    for(const x of [-.51,.51]) for(const z of [-.25,.25]) box('leg-'+x+'-'+z,'bark',[x,.34,z],[.09,.68,.09]);
    box('lower-stretcher','timber',[0,.22,0],[1.1,.08,.09]);
    for(const z of [-.25,.25]) box('apron-'+z,'bark',[0,.635,z],[1.18,.10,.06]);
    for(let i=0;i<4;i++) box('top-board-'+i,'timber',[0,.72,-.3+i*.2],[1.4,.06,.19]);
    box('top-end-inlay','mutedmetal',[.66,.7485,0],[.025,.003,.8]);
    proposedSurfaces.push({name:'tabletop',centre:[0,.75,0],size:[1.4,.8],normal:[0,1,0]});
    clearances.push({name:'under-table-knee-proposal',min:[-.46,.28,-.22],max:[.46,.58,.22]});
  } else {
    footprint=[3,2];
    box('low-stone-plinth','stone',[0,.085,0],[3,.17,2]);
    for(let i=0;i<10;i++) box('deck-board-'+i,'timber',[0,.205,-.9+i*.2],[3,.07,.19]);
    box('front-edge-band','bark',[0,.16,1-.025],[3,.06,.05]);
    proposedSurfaces.push({name:'presentation-deck',centre:[0,.24,0],size:[3,2],normal:[0,1,0]});
    clearances.push({name:'open-above-deck',min:[-1.5,.24,-1],max:[1.5,2.24,1]});
  }
  const min:[number,number,number]=[Infinity,Infinity,Infinity],max:[number,number,number]=[-Infinity,-Infinity,-Infinity];
  for(const p of parts) for(let a=0;a<3;a++) { min[a]=Math.min(min[a],p.centre[a]-p.size[a]/2); max[a]=Math.max(max[a],p.centre[a]+p.size[a]/2); }
  return {kind,origin:'local base centre',units:'metres',footprint,parts,bounds:{min,max},clearances,proposedSurfaces};
}
/** Original abstract ceramic leaves/ribbons, inset between existing roof ribs and cap. */
function ceramicRoofDetail():THREE.Mesh {
  const positions:number[]=[],colours:number[]=[],cream=new THREE.Color('#e2d4b3'),teal=new THREE.Color('#467c75'),ochre=new THREE.Color('#bb8644');
  const triangle=(a:readonly number[],b:readonly number[],c:readonly number[],colour:THREE.Color)=>{for(const p of [a,b,c]){positions.push(p[0],p[1],p[2]);colours.push(colour.r,colour.g,colour.b);}};
  const quad=(x0:number,z0:number,x1:number,z1:number,y:number,colour:THREE.Color)=>{triangle([x0,y,z0],[x0,y,z1],[x1,y,z1],colour);triangle([x0,y,z0],[x1,y,z1],[x1,y,z0],colour);};
  for(let bay=0;bay<6;bay++)for(const [row,z]of [-1.65,-1.10,-.15,.40,.95,1.50].entries()) {
    const x=-2.25+bay*.9;
    // Base tile sits 3mm above old continuous ceiling; motifs sit another 1mm above the tile.
    quad(x-.39,z-.24,x+.39,z+.24,2.803,cream);
    const y=2.804,flip=(bay+row)%2?1:-1,leaf=[[x-.25,y,z],[x,y,z+flip*.17],[x+.25,y,z],[x,y,z-flip*.07]];
    triangle(leaf[0],leaf[1],leaf[2],teal);triangle(leaf[0],leaf[2],leaf[3],teal);
    // Keep both leaf triangle normals upward when the alternating leaf points north.
    if(flip<0){const offset=positions.length-18;for(let i=offset;i<positions.length;i+=9){for(let a=0;a<3;a++){const t=positions[i+3+a];positions[i+3+a]=positions[i+6+a];positions[i+6+a]=t;}}}
    quad(x-.31,z-.205,x+.31,z-.18,y,ochre);
    const d=[[x+.28,y,z+.10],[x+.335,y,z+.155],[x+.28,y,z+.21],[x+.225,y,z+.155]];
    triangle(d[0],d[3],d[2],ochre);triangle(d[0],d[2],d[1],ochre);
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colours,3));geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
  const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.92}));mesh.name='pavilion:ceramic-roof-detail';mesh.receiveShadow=true;return mesh;
}
/** Caller supplies validated base position and rotation.y=-yaw. No ground inference. */
export function createCommonsPrefab(kind:PrefabKind):ContentView {
  const spec=inspectCommonsPrefab(kind); // refusal happens before resource allocation
  const group=new THREE.Group(); group.name='commons:'+kind;
  group.userData.inspection=spec;
  const resources=new ThreeResources(),geometry=new THREE.BoxGeometry(1,1,1),instances:THREE.InstancedMesh[]=[];
  const matrix=new THREE.Matrix4(),position=new THREE.Vector3(),scale=new THREE.Vector3(),rotation=new THREE.Quaternion();
  for(const material of Object.keys(COMMONS_PALETTE) as Material[]) {
    const parts=spec.parts.filter(p=>p.material===material);if(!parts.length)continue;
    const mat=new THREE.MeshStandardMaterial({color:COMMONS_PALETTE[material],roughness:material==='mutedmetal'?.72:1,metalness:material==='mutedmetal'?.25:0});
    if(kind==='table'&&material==='mutedmetal'){mat.polygonOffset=true;mat.polygonOffsetFactor=-1;mat.polygonOffsetUnits=-1;}
    const mesh=new THREE.InstancedMesh(geometry,mat,parts.length);mesh.name=kind+':'+material;
    parts.forEach((p,i)=>{position.fromArray(p.centre);scale.fromArray(p.size);matrix.compose(position,rotation,scale);mesh.setMatrixAt(i,matrix);});
    mesh.userData.partNames=parts.map(p=>p.name);mesh.instanceMatrix.needsUpdate=true;
    mesh.computeBoundingBox();mesh.computeBoundingSphere();mesh.castShadow=true;mesh.receiveShadow=true;
    group.add(mesh);instances.push(mesh);
  }
  if(kind==='pavilion')group.add(ceramicRoofDetail());
  resources.object(group);let disposed=false;
  return {group,dispose(){if(disposed)return;disposed=true;group.removeFromParent();instances.forEach(m=>m.dispose());resources.dispose();group.clear();}};
}
