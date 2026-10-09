import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {highestDrawnDecorationSoil} from './WorldDecorationGround.ts';
import {publishedGroundSampler} from './WorldPublishedGround.ts';
import {createWorldGroundDetails} from './WorldGroundDetails.ts';
import {WorldGeometry,type SceneInfo} from './WorldGeometry.ts';
import {createEdenExpansionLandscape} from '../../../mars/viewer/app/engine-view/content/environment/eden-expansion-landscape/landscape.mjs';
import {createEdenRegions} from '../../../mars/viewer/app/engine-view/content/assets/eden-regions/index.ts';
import {groundTriangleSampler} from '../../../mars/viewer/lib/ground-triangles.ts';
// Exact three normalized current public level-0 soil surfaces. The native shore
// is outside this camera fixture; no claim of a complete protocol publication.
const publication:Pick<SceneInfo,'scene'|'shore'>={scene:{bounds:[-62,-65,105,85],levels:[{id:0,y:0,label:'ground'}],obstacles:[],links:[],surfaces:[
 {id:'commons-ground',level:0,y:0,obb:{c:[0,0],half:[30,30],yaw:0}},
 {id:'eden-east-ground',level:0,y:0,obb:{c:[67.5,27.5],half:[37.5,57.5],yaw:0}},
 {id:'eden-north-ground',level:0,y:0,obb:{c:[5,-47.5],half:[25,17.5],yaw:0}}]}};
void test('actual forest meadow roots meet highest DRAWN soil; static/native/prisms unchanged',()=>{
 const before=JSON.stringify(publication),native=publishedGroundSampler(publication),landscape=createEdenExpansionLandscape(true)!;
 let regionalSoil=(_x:number,_z:number):number|null=>null;
 const structural=(x:number,z:number)=>native(x,z)??(x>=-30&&x<=30&&z>=-30&&z<=30?0:landscape.sampleVisualGround(x,z)??regionalSoil(x,z));
 const regions=createEdenRegions(structural)!;regionalSoil=(x,z)=>regions.sampleVisualGround(x,z);const prisms=JSON.stringify(regions.authoredBoundaries);
 const fixed=highestDrawnDecorationSoil(publication,(x,z)=>landscape.sampleVisualGround(x,z),(x,z)=>regions.sampleVisualGround(x,z));
 const details=createWorldGroundDetails(fixed),base=new WorldGeometry(publication.scene);
 const soil:ReturnType<typeof groundTriangleSampler>[]=[];
 for(const g of [base.group,landscape.group,regions.group])g.traverse(o=>{if((o as THREE.Mesh).isMesh&&((g===base.group&&(o as THREE.Mesh).geometry.type==='PlaneGeometry')||['outside-ground','NEW expansion cosmetic ground; original native rectangles omitted','Regions cosmetic ground terrain (scenery only; no native support)'].includes(o.name)||o.name==='commons-ground'))soil.push(groundTriangleSampler(o as THREE.Mesh));});
 try{
  const camera=new THREE.PerspectiveCamera();camera.position.set(7,1.7,-44);camera.updateMatrixWorld();details.meadow.follow(camera);
  const grass=details.meadow.tufts,m=new THREE.Matrix4(),p=new THREE.Vector3();let error=0;
  assert.equal(grass.count,7923);
  for(let i=0;i<grass.count;i++){grass.getMatrixAt(i,m);p.setFromMatrixPosition(m);const hits=soil.map(s=>s.heightAt(p.x,p.z)).filter((y):y is number=>y!==null);assert.ok(hits.length);error=Math.max(error,Math.abs(p.y-Math.max(...hits)));}
  assert.ok(error<2e-6,`root/drawn-soil max gap ${error}`);
  assert.equal(JSON.stringify(publication),before);assert.equal(JSON.stringify(regions.authoredBoundaries),prisms);
  assert.equal(structural(-19,-52),0);assert.ok(fixed(-19,-52)!>0); // body/structural sampler deliberately untouched.
 }finally{details.dispose();base.dispose();regions.dispose();landscape.dispose();}
});
void test('unsupported, nonfinite, upper floors excluded; wet mask still omits roots',()=>{
 assert.equal(highestDrawnDecorationSoil(undefined,()=>null)(0,0),null);assert.equal(highestDrawnDecorationSoil(publication,()=>NaN)(NaN,0),null);
 const raised=structuredClone(publication);raised.scene!.surfaces.push({id:'roof',level:1,y:10,obb:{c:[0,0],half:[2,2],yaw:0}});
 assert.equal(highestDrawnDecorationSoil(raised)(0,0),-.01);
 const d=createWorldGroundDetails(()=>0,()=>true);try{const camera=new THREE.PerspectiveCamera();d.meadow.follow(camera);assert.equal(d.meadow.tufts.count,0);assert.equal(d.meadow.blooms.count,0);}finally{d.dispose();}
});
