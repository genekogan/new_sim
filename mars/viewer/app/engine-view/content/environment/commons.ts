// Original renderer-only commons composition. No collision, routes or scene admission.
import * as THREE from 'three';
import { VegetationViews, type VegetationPlacement, type VegetationKind } from '../../vegetation.ts';
import { ThreeResources } from '../../../../lib/three-resources.ts';
import {createPlanterBlossoms,type PlanterBlossom} from './planter-blossoms.ts';
export type ContentView = { readonly group: THREE.Group; dispose(): void };
export type GroundSample = (x: number, z: number) => number | null;
export type PrefabKind = 'pavilion' | 'bench' | 'table' | 'presentation-platform';
export type PrefabPlacement = { id: string; kind: PrefabKind; p: [number,number,number]; yaw: number };
const slots: readonly [string, PrefabKind, number, number, number, number][] = [
  ['commons-pavilion','pavilion',9,-5,6,4], ['commons-platform','presentation-platform',9,-1.8,3,2],
  ['commons-bench-west','bench',6,3,2,.65], ['commons-bench-east','bench',12,3,2,.65],
  ['commons-table','table',12,-5,1.4,.8],
];
const corridor = [[14,4],[9,5],[4,5]] as const;
function ground(sample: GroundSample, x: number, z: number) {
  const y = sample(x,z);
  if (typeof y !== 'number' || !Number.isFinite(y) || Math.abs(y)>10000) throw Error(`Missing or invalid commons ground at ${x},${z}`);
  return y;
}
/** Cosmetic clearance only. Full plant horizontal bounds are excluded; canopies
 * overhang their own understory but do not cover the reserved commons slots. */
export function commonsPlantFits(x:number,z:number,radius:number): boolean {
  if (![x,z,radius].every(Number.isFinite) || radius<0 || Math.abs(x)+radius>16 || Math.abs(z)+radius>12) return false;
  if (Math.hypot(x-9,z-5)<3+radius) return false;
  for (const [, ,sx,sz,w,d] of slots) if (Math.abs(x-sx)<w/2+.5+radius && Math.abs(z-sz)<d/2+.5+radius) return false;
  for (let i=1;i<corridor.length;i++) {
    const [ax,az]=corridor[i-1], [bx,bz]=corridor[i], dx=bx-ax,dz=bz-az;
    const t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz)));
    if(Math.hypot(x-ax-t*dx,z-az-t*dz)<.7+radius) return false;
  }
  return true;
}
export function commonsPrefabPlacements(sample: GroundSample): readonly PrefabPlacement[] {
  return slots.map(([id,kind,x,z])=>({id,kind,p:[x,ground(sample,x,z),z],yaw:kind==='bench'?Math.PI:0}));
}
const trees: readonly [number,number,number,number][] = [
  [-13.1,-8.4,4.1,6.8],[-9.5,-9.2,3.6,5.7],[-5.9,-9.1,4.2,6.4],[-1.7,-9.3,3.7,6.9],
  [2.4,-9.2,3.6,5.8],[6.0,-9.6,3.3,5.3],[10.4,-9.4,3.3,6.0],[13.3,-9.1,3.5,5.6],
  [-13.5,-3.8,3.5,5.9],[-10.7,-2.8,3.9,6.5],[-13.2,1.5,4.0,7.1],[-8.8,1.5,3.5,5.3],
  [-4.9,.6,3.9,6.3],[-.6,-2.0,3.9,6.5],[2.7,-4.3,3.4,5.5],[-12.6,6.3,4.5,7.4],
  [-8.1,7.5,3.9,6.5],[-3.7,8.5,4.1,7.0],[.7,9,3.6,6.2],[4.3,9.3,3.6,5.5],
  [13.6,9.2,3.4,5.8],[-7.0,-4.1,2.6,4.2],
];
const gardens: readonly [number,number,number,number][] = [[-6.9,-6.7,2.1,1.1],[-2.6,-6.4,1.8,1.0],[-10.6,-6.8,1.15,.8]];
type Dressing = {soil:number[];edge:number[]};
/** Returned explicit roots/seeds are fresh values; there is no wall-clock scatter. */
export function commonsVegetationPlacements(sample: GroundSample): readonly VegetationPlacement[] {
  const plants:VegetationPlacement[]=[];
  const add=(kind:VegetationKind,x:number,z:number,w:number,h:number,d:number,seed:number)=>{
    // Rotation-invariant full horizontal visual envelope; conservative for low forms.
    const radius=Math.hypot(w,d)*.5;
    if(!commonsPlantFits(x,z,radius)) return;
    plants.push({id:'commons-'+kind+'-'+plants.length,kind,p:[x,ground(sample,x,z),z],size:[w,h,d],yaw:(seed*.618)% (Math.PI*2),seed});
  };
  trees.forEach(([x,z,w,h],i)=>add(i===1||i===7||i===16?'conifer':'canopy-tree',x,z,w,h,w*.86,100+i));
  // Irregular pockets around grove edges, never rows. Each has a low outer skirt.
  const pockets=[[-12,-9.8],[-7.7,-10.1],[-3.6,-10.2],[.3,-10.3],[4.4,-10.4],[12.6,-10.3],[-14.3,-.5],[-11.2,3.7],[-7.0,3.6],[-3.8,3.0],[1.2,1.3],[-14,8.3],[-10.1,9.4],[-6.1,9.8],[-1.7,10.4],[3.0,10.6],[14.2,6.8]];
  pockets.forEach(([x,z],i)=>{
    add('shrub',x,z,1.15+i%3*.18,.62+i%4*.09,1.1,300+i);
    for(let j=0;j<4;j++){const a=j*2.399+i*.71;add('grass',x+Math.cos(a)*1.15,z+Math.sin(a)*.9,.72,.27+j*.04,.64,500+i*7+j);}
  });
  gardens.forEach(([x,z,rx,rz],i)=>{for(let j=0;j<14;j++){const a=j*2.399,r=.25+.58*Math.sqrt(j/13);add(j%5===0?'shrub':'grass',x+Math.cos(a)*rx*r,z+Math.sin(a)*rz*r,.48,j%5===0?.48:.33,.42,900+i*20+j);}});
  return plants;
}
/** Ornamental pockets inside existing soil, all sampled before construction. */
export function commonsFlowerPlacements(sample:GroundSample):readonly PlanterBlossom[]{
  const pockets:readonly [number,number][]=[[-.72,-.23],[-.54,-.38],[-.42,-.05],[-.60,.14],[-.62,.34],[-.38,.53],[-.24,.31],[-.08,.52],[.17,.49],[.34,.32],[.53,.22],[.68,.05],[.57,-.25],[.37,-.47],[.14,-.43],[-.09,-.26]];
  const flowers:PlanterBlossom[]=[];
  gardens.forEach(([cx,cz,rx,rz],bed)=>pockets.forEach(([u,v],i)=>{
    const angle=[0,.42,-.31][bed],nx=u*Math.cos(angle)-v*Math.sin(angle),nz=u*Math.sin(angle)+v*Math.cos(angle),x=cx+nx*rx,z=cz+nz*rz,width=[.31,.33,.35][i%3],radius=.42*width;
    if(Math.hypot(nx,nz)+radius/Math.min(rx,rz)>=1||!commonsPlantFits(x,z,radius))throw Error('Commons flower outside soil or reserved clearance');
    const y=ground(sample,x,z)+.02;if(Math.abs(y)>10000)throw Error('Invalid commons flower ground');
    flowers.push({id:'commons-garden-'+bed+'-flower-'+i,p:[x,y,z],width,height:[.33,.34,.35][i%3],yaw:bed*.67+i*2.399});
  }));return flowers;
}
function dressing(sample:GroundSample): Dressing {
  const soil:number[]=[],edge:number[]=[];
  const vertex=(x:number,z:number,lift:number)=>[x,ground(sample,x,z)+lift,z];
  for(const [x,z,rx,rz] of gardens){
    const centre=vertex(x,z,.014);
    for(let i=0;i<32;i++){
      const a=i*Math.PI/16,b=(i+1)*Math.PI/16;
      const innerA=vertex(x+Math.cos(a)*rx,z+Math.sin(a)*rz,.016),innerB=vertex(x+Math.cos(b)*rx,z+Math.sin(b)*rz,.016);
      soil.push(...centre,...innerB,...innerA);
      const outerA=vertex(x+Math.cos(a)*(rx+.12),z+Math.sin(a)*(rz+.12),.018),outerB=vertex(x+Math.cos(b)*(rx+.12),z+Math.sin(b)*(rz+.12),.018);
      edge.push(...innerA,...innerB,...outerB,...innerA,...outerB,...outerA);
    }
  }
  return {soil,edge};
}
export function createEdenCommonsEnvironment(sample: GroundSample): ContentView {
  // Sample ALL inputs before allocating geometry/materials, including reserved roots.
  commonsPrefabPlacements(sample);
  const plants=commonsVegetationPlacements(sample),beds=dressing(sample),flowers=commonsFlowerPlacements(sample);
  const group=new THREE.Group();group.name='Eden commons decorative environment';
  const vegetation=new VegetationViews(plants);group.add(vegetation.group);
  const resources=new ThreeResources();
  for(const [name,vertices,color] of [['garden-soil',beds.soil,'#70533b'],['garden-stone-edge',beds.edge,'#a79880']] as const){
    const geo=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geo.computeVertexNormals();
    const mesh=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color,roughness:1,side:THREE.DoubleSide}));mesh.name=name;mesh.receiveShadow=true;group.add(mesh);resources.object(mesh);
  }
  const blossoms=createPlanterBlossoms(flowers);group.add(blossoms.group);
  let closed=false;
  return {group,dispose(){if(closed)return;closed=true;const errors:unknown[]=[];
    for(const release of [()=>group.removeFromParent(),()=>vegetation.dispose(),()=>resources.dispose(),()=>blossoms.dispose()]){try{release();}catch(error){errors.push(error);}}
    for(const child of [...group.children]){try{group.remove(child);}catch(error){errors.push(error);}}
    if(errors.length)throw new AggregateError(errors,'Commons disposal failed',{cause:errors[0]});
  }};
}
