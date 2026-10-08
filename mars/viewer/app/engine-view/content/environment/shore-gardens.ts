// Original raised-planter appearance only; no native soil, resources or supports.
import * as THREE from 'three';
import { designHeightAt, type ShoreDesign } from '../../shore-preview.ts';
import { VegetationViews, type VegetationPlacement } from '../../vegetation.ts';
import { ThreeResources } from '../../../../lib/three-resources.ts';
import { commonsPlantFits, type ContentView } from './commons.ts';
import { dryShoreInspection } from './dry-shore.ts';
import { createPlanterBlossoms, type PlanterBlossom } from './planter-blossoms.ts';
const sites:readonly [string,number,number,number,number][]=[['shore-bed-west',4.6,-3.2,1.3,.9],['shore-bed-middle',6.15,.6,1.2,.8],['shore-bed-east',12.1,-.6,1.5,1]];
export type ShoreGardenBed={id:string;centreXZ:[number,number];sizeXZ:[number,number];footprintXZ:[number,number][];bottomSamples:[number,number,number][];minGroundY:number;maxGroundY:number;rimY:number;soilY:number;radius:number};
type Inspection={beds:readonly ShoreGardenBed[];plants:readonly VegetationPlacement[];blossoms:readonly PlanterBlossom[];skipped:readonly {id:string;reason:string}[]};
function sample(design:ShoreDesign,x:number,z:number){const y=designHeightAt(design.terrain,x,z);if(y===null||!Number.isFinite(y))throw Error('Missing shore garden sample');return y;}
export function shoreGardenInspection(design:ShoreDesign):Inspection{
  // Existing immutable dry preflight validates the entire grid and known water domain.
  const existing=dryShoreInspection(design).plants,beds:ShoreGardenBed[]=[],plants:VegetationPlacement[]=[],blossoms:PlanterBlossom[]=[],skipped:{id:string;reason:string}[]=[];
  for(const [id,x,z,w,d]of sites){const radius=Math.hypot(w,d)/2;
    if(!commonsPlantFits(x,z,radius)||x-radius<=0){skipped.push({id,reason:'dry/domain/commons clearance'});continue;}
    if(existing.some(p=>Math.hypot(x-p.p[0],z-p.p[2])<=radius+Math.hypot(p.size[0],p.size[2])/2)){skipped.push({id,reason:'accepted grove envelope'});continue;}
    if(beds.some(b=>Math.hypot(x-b.centreXZ[0],z-b.centreXZ[1])<=radius+b.radius)){skipped.push({id,reason:'another garden envelope'});continue;}
    const bottomSamples:[number,number,number][]=[];
    for(let j=0;j<=4;j++)for(let i=0;i<=6;i++){const sx=x-w/2+w*i/6,sz=z-d/2+d*j/4;bottomSamples.push([sx,sample(design,sx,sz),sz]);}
    const ys=bottomSamples.map(p=>p[1]),minGroundY=Math.min(...ys),maxGroundY=Math.max(...ys);
    if(minGroundY<=design.water.datumY+.05){skipped.push({id,reason:'sampled footprint not dry'});continue;}
    const rimY=maxGroundY+.43,soilY=rimY-.055;
    beds.push({id,centreXZ:[x,z],sizeXZ:[w,d],radius,footprintXZ:[[x-w/2,z-d/2],[x+w/2,z-d/2],[x+w/2,z+d/2],[x-w/2,z+d/2]],bottomSamples,minGroundY,maxGroundY,rimY,soilY});
    // Irregular authored interior layout replaces the previous centre cluster.
    // Each conservative full circle clears the inner rim rectangle.
    const layout=[[-.9,-.85],[-.32,-.9],[.3,-.82],[.88,-.86],[-.9,-.05],[-.3,.02],[.35,-.03],[.88,.06],[-.85,.88],[-.3,.83],[.33,.89],[.9,.82]];
    const hx=w/2-.055-.18,hz=d/2-.055-.18;
    layout.forEach(([u,v],i)=>plants.push({id:id+'-herb-'+i,kind:i%3===1?'grass':'shrub',p:[x+u*hx,soilY,z+v*hz],size:[.26,.24+(i%3)*.035,.23],yaw:i*.7,seed:2500+beds.length*20+i}));
    [[-.62,-.48],[.6,-.47],[-.63,.47],[.58,.5]].forEach(([u,v],i)=>blossoms.push({id:id+'-blossom-'+i,p:[x+u*hx,soilY,z+v*hz],width:.22,height:.24+i*.025,yaw:i*.91+beds.length*.4}));
  }
  return {beds,plants,blossoms,skipped};
}
function addTriangle(out:number[],a:number[],b:number[],c:number[]){out.push(...a,...b,...c);}
function quad(out:number[],a:number[],b:number[],c:number[],d:number[]){addTriangle(out,a,b,c);addTriangle(out,a,c,d);}
export function createShoreGardens(design:ShoreDesign):ContentView{
  const inspection=shoreGardenInspection(design),soil:number[]=[],timber:number[]=[];
  // Complete all required terrain samples before allocation. A visible level rim
  // caps varying wall heights; no ground flattening or concealed support claim.
  for(const b of inspection.beds){const [x,z]=b.centreXZ,[w,d]=b.sizeXZ;
    for(let j=0;j<4;j++)for(let i=0;i<6;i++){const a=b.bottomSamples[j*7+i],bb=b.bottomSamples[j*7+i+1],c=b.bottomSamples[(j+1)*7+i],dd=b.bottomSamples[(j+1)*7+i+1];quad(soil,a,bb,dd,c);}
    const inner=b.footprintXZ.map(([sx,sz])=>[sx+(sx<x?.055:-.055),b.soilY,sz+(sz<z?.055:-.055)]);quad(soil,inner[0],inner[3],inner[2],inner[1]);
    for(let edge=0;edge<4;edge++){const a=b.footprintXZ[edge],bb=b.footprintXZ[(edge+1)%4];
      const innerA=[a[0]+(a[0]<x?.055:-.055),b.rimY,a[1]+(a[1]<z?.055:-.055)],innerB=[bb[0]+(bb[0]<x?.055:-.055),b.rimY,bb[1]+(bb[1]<z?.055:-.055)];
      quad(timber,[a[0],b.rimY,a[1]],[bb[0],b.rimY,bb[1]],innerB,innerA);
      for(let i=0;i<6;i++){const t=i/6,u=(i+1)/6,ax=a[0]+(bb[0]-a[0])*t,az=a[1]+(bb[1]-a[1])*t,bx=a[0]+(bb[0]-a[0])*u,bz=a[1]+(bb[1]-a[1])*u;
        quad(timber,[ax,sample(design,ax,az),az],[bx,sample(design,bx,bz),bz],[bx,b.rimY,bz],[ax,b.rimY,az]);
      }
    }
  }
  const group=new THREE.Group();group.name='Decorative terrain-fitted raised shore gardens';const resources=new ThreeResources();
  for(const [name,positions,color]of [['sampled-soil-bottom-and-level-top',soil,'#70533b'],['sampled-timber-walls-and-level-rim',timber,'#a7784f']] as const){if(!positions.length)continue;const geo=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.computeVertexNormals();const mesh=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color,roughness:1,side:THREE.DoubleSide}));mesh.name=name;mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);resources.object(mesh);}
  const vegetation=new VegetationViews(inspection.plants);group.add(vegetation.group);const blossoms=createPlanterBlossoms(inspection.blossoms);group.add(blossoms.group);let closed=false;
  return {group,dispose(){if(closed)return;closed=true;group.removeFromParent();vegetation.dispose();blossoms.dispose();resources.dispose();group.clear();}};
}
