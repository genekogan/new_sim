import * as THREE from 'three';
import {VegetationViews} from '../../../vegetation.ts';
import {createForestUnderstory} from '../forest-understory.ts';
import {createBirchFamily} from '../birch-family-proposal/birch.mjs';
import {createTropicalTree} from '../tropical-tree-proposal/tropical.mjs';
import {createHedgeFamily} from '../hedge-family-proposal/hedge.mjs';
import {createClimbingVine} from '../climbing-vine-proposal/vines.mjs';
import {createRiverbankStones} from '../riverbank-stone-proposal/stones.mjs';
import {createMeadowFamily} from '../meadow-family-proposal/meadow.mjs';
import {createWaterLandscape} from '../water-landscape-proposal/water.mjs';
import {createOrchardProposal} from '../orchard-proposal/orchard.mjs';
import {createAridLandmark} from '../arid-landmark-proposal/landmarks.mjs';
import {createVolcanicLandscapeKit} from '../volcanic-landscape-kit.ts';
import {createMountainRidge} from '../mountain-ridge-proposal/ridge.mjs';
import {edenExpansionLayout,expansionHeight,inNative,inside,waterBedReserved,reserved} from './layout.mjs';
import {createExpansionBankEnrichment} from './bank-enrichment.mjs';
import {joinExpansionWater} from './water-join.mjs';
import {createWetlandPlant} from '../wetland-plant-family/wetland.mjs';
import {edenExpansionPlanting} from './planting.mjs';

export function createEdenExpansionLandscape(enabled=false){
 if(enabled!==true)return null;
 const layout=edenExpansionLayout(),planting=edenExpansionPlanting(),group=new THREE.Group(),owners=[],resources=[],instances=[],waterOwners=[];
 group.name='Connected Eden: woodland, neighborhood gardens, country and lake';
 group.userData.environmentScope=layout.scope;
 const own=o=>{owners.push(o);return o;};
 const release=()=>{const errors=[];for(const fn of[()=>group.removeFromParent(),...instances.map(i=>()=>i.dispose()),...owners.map(o=>()=>o.dispose()),...resources.map(r=>()=>r.dispose()),()=>group.clear()])try{fn();}catch(e){errors.push(e);}return errors;};
 function mesh(name,positions,colors,indices,material){
  const g=new THREE.BufferGeometry();resources.push(g);g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));if(colors)g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));if(indices)g.setIndex(indices);g.computeVertexNormals();const m=new THREE.Mesh(g,material);m.name=name;m.receiveShadow=true;group.add(m);return m;
 }
 function simpleMaterial(options){const m=new THREE.MeshStandardMaterial(options);resources.push(m);return m;}
 // Fixed original prototype geometry/material references; own instance buffers only.
 function batched(name,factory,placements){
  if(!placements.length)return;const prototype=own(factory()),matrix=new THREE.Matrix4();
  for(const source of prototype.group.children){if(!source.isMesh||source.isInstancedMesh)throw Error('Unsupported original expansion prototype');const m=new THREE.InstancedMesh(source.geometry,source.material,placements.length);instances.push(m);m.name=name+' / '+source.name;m.castShadow=source.castShadow;m.receiveShadow=source.receiveShadow;
   placements.forEach((p,i)=>{matrix.compose(new THREE.Vector3(...p.p),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),-p.yaw),new THREE.Vector3(...p.size));m.setMatrixAt(i,matrix);});m.instanceMatrix.needsUpdate=true;m.computeBoundingBox();m.computeBoundingSphere();group.add(m);
  }
 }
 try{
  // Exact native rectangles are holes in the NEW cosmetic terrain. Axis breaks preserve edges.
  const axis=(min,max,extras)=>[...new Set([min,max,...Array.from({length:Math.ceil((max-min)/4)},(_,i)=>min+i*4),...extras])].filter(v=>v>=min&&v<=max).sort((a,b)=>a-b);
  const xs=axis(-100,105,[-62,-30,-28,30,...layout.water.flatMap(w=>[w.outerBounds[0],w.outerBounds[2]])]),zs=axis(-65,85,[-30,-12,12,30,...layout.water.flatMap(w=>[w.outerBounds[1],w.outerBounds[3]])]),pos=[],col=[],idx=[];
  for(let j=1;j<zs.length;j++)for(let i=1;i<xs.length;i++){const x0=xs[i-1],x1=xs[i],z0=zs[j-1],z1=zs[j],x=(x0+x1)/2,z=(z0+z1)/2;if(inNative(x,z))continue;const first=pos.length/3;
   for(const [a,b] of [[x0,z0],[x1,z0],[x1,z1],[x0,z1]]){const y=expansionHeight(a,b)??expansionHeight(x,z)??0;pos.push(a,y,b);const c=new THREE.Color('#8a9b6e').lerp(new THREE.Color('#b6ae89'),Math.min(1,Math.max(0,-y/2)));col.push(c.r,c.g,c.b);}idx.push(first,first+2,first+1,first,first+3,first+2);
  }
  const ground=mesh('NEW expansion cosmetic ground; original native rectangles omitted',pos,col,idx,simpleMaterial({vertexColors:true,roughness:1}));
  function sampleVisualGround(x,z){
   if(!Number.isFinite(x)||!Number.isFinite(z)||inNative(x,z))return null;
   const a=ground.geometry.attributes.position.array;
   for(let i=0;i<a.length;i+=12){const x0=a[i],x1=a[i+3],z0=a[i+2],z1=a[i+8];if(x<x0||x>x1||z<z0||z>z1)continue;const u=(x-x0)/(x1-x0),v=(z-z0)/(z1-z0),A=a[i+1],B=a[i+4],C=a[i+7],D=a[i+10];return v<=u?A+(B-A)*u+(C-B)*v:A+(C-D)*u+(D-A)*v;}return null;
  }
  // Fit new authored roots to the ACTUAL Float32 ground triangles, not the analytic sketch.
  for(const p of [...planting.plants,...Object.values(planting.special).flat()]){const y=sampleVisualGround(p.p[0],p.p[2]);if(y===null)throw Error('New expansion plant lacks supplied cosmetic triangle');p.p[1]=y;}
  // Connected walking appearance. Reserved native areas/water/bridge gaps are not paved over.
  const pp=[],pc=[],pi=[],pathColor=new THREE.Color('#b6b09b');
  for(const path of layout.paths.filter(p=>!p.dryBankAppearance))for(let k=1;k<path.points.length;k++){const a=path.points[k-1],b=path.points[k],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz),steps=Math.ceil(len/.6);for(let i=0;i<steps;i++){const c=(i+.5)/steps,x=a[0]+dx*c,z=a[1]+dz*c;if(inNative(x,z,path.width/2+.05)||waterBedReserved(x,z,path.width/2+.1))continue;const start=pp.length/3;for(const [u,side]of[[i/steps,-1],[(i+1)/steps,-1],[(i+1)/steps,1],[i/steps,1]]){const x=a[0]+dx*u-dz/len*path.width/2*side,z=a[1]+dz*u+dx/len*path.width/2*side;pp.push(x,(sampleVisualGround(x,z)??0)+.018,z);pc.push(pathColor.r,pathColor.g,pathColor.b);}pi.push(start,start+2,start+1,start,start+3,start+2);}}
  // Five stopping clearings join the same trail network, not display-pad islands.
  for(const stop of layout.stops){const center=pp.length/3;pp.push(stop.p[0],(sampleVisualGround(...stop.p)??0)+.018,stop.p[1]);pc.push(pathColor.r,pathColor.g,pathColor.b);for(let i=0;i<32;i++){const a=i*Math.PI/16,x=stop.p[0]+Math.cos(a)*stop.radius,z=stop.p[1]+Math.sin(a)*stop.radius;pp.push(x,(sampleVisualGround(x,z)??0)+.018,z);pc.push(pathColor.r,pathColor.g,pathColor.b);}for(let i=0;i<32;i++)pi.push(center,center+1+(i+1)%32,center+1+i);}
  mesh('Connected countryside and forest path appearance; no route grant',pp,pc,pi,simpleMaterial({vertexColors:true,roughness:1}));
  for(let i=0;i<planting.plants.length;i+=480){const o=own(new VegetationViews(planting.plants.slice(i,i+480)));if(o.rejected.length)throw Error('Original vegetation refused expansion');group.add(o.group);}
  batched('Birch woodland and orchard',()=>createBirchFamily('spreading'),planting.special.birch);
  batched('Forest and path fern edge',()=>createForestUnderstory('fern'),planting.special.fern);
  batched('Perennial flower garden transition',()=>createForestUnderstory('flowering-shrub'),planting.special.flowering);
  batched('Tropical lake-side palms',()=>createTropicalTree('palm'),planting.special.palm);
  batched('Bamboo secluded grove',()=>createTropicalTree('bamboo'),planting.special.bamboo);
  batched('Garden clipped hedges',()=>createHedgeFamily('strip'),planting.special.hedge);
  batched('Flowering garden trellis edges',()=>createClimbingVine('lattice',true),planting.special.vine);
  batched('Country and river bank stone clusters',()=>createRiverbankStones('long'),planting.special.stones);
  for(const p of planting.special.meadow){const o=own(createMeadowFamily('square'));o.group.position.fromArray(p.p);o.group.rotation.y=-p.yaw;group.add(o.group);}
  for(const w of layout.water){if(w.kind==='connection'){const m=mesh('Proposed lake to original-shore water connection',[-65,-2,0,-68,-2,-2,-62,-2,-2,-62,-2,2,-68,-2,2],null,[0,2,1,0,3,2,0,4,3,0,1,4],simpleMaterial({color:'#286a8d',roughness:.32,transparent:true,opacity:.88,depthWrite:false}));m.userData.cameraTransparent=true;group.remove(m);const connection=new THREE.Group();connection.add(m);group.add(connection);waterOwners.push({owner:{group:connection},w});continue;}const o=own(createWaterLandscape(w.kind));o.group.position.fromArray(w.p);o.group.rotation.y=-w.yaw;for(const m of o.group.children)if(m.userData.cameraTransparent){m.material.color.set('#286a8d');m.material.opacity=.68;}group.add(o.group);waterOwners.push({owner:o,w});}
  const waterJoin=joinExpansionWater(waterOwners,group,g=>resources.push(g),m=>resources.push(m));
  function sampleVisibleBank(x,z){
   if(inNative(x,z)||!Number.isFinite(x)||!Number.isFinite(z))return null;
   let y=sampleVisualGround(x,z);
   for(const bed of group.children.filter(m=>m.name?.endsWith(' bed'))){const p=bed.geometry.attributes.position.array;
    for(let i=0;i<p.length;i+=9){const dx=p[i+3]-p[i],dz=p[i+5]-p[i+2],ex=p[i+6]-p[i],ez=p[i+8]-p[i+2],det=dx*ez-dz*ex;if(Math.abs(det)<1e-12)continue;const u=((x-p[i])*ez-(z-p[i+2])*ex)/det,v=(dx*(z-p[i+2])-dz*(x-p[i]))/det;if(u>=-1e-7&&v>=-1e-7&&u+v<=1+1e-7){const top=p[i+1]+u*(p[i+4]-p[i+1])+v*(p[i+7]-p[i+1]);y=y===null?top:Math.max(y,top);}}}
   return y;
  }
  const dockPath=layout.paths.find(p=>p.dryBankAppearance),dp=[],di=[];
  for(let k=1;k<dockPath.points.length;k++){const a=dockPath.points[k-1],b=dockPath.points[k],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz),steps=Math.ceil(len/.4);
   for(let j=0;j<steps;j++){const start=dp.length/3;for(const [u,side]of[[j/steps,-1],[(j+1)/steps,-1],[(j+1)/steps,1],[j/steps,1]]){const x=a[0]+dx*u-dz/len*side,z=a[1]+dz*u+dx/len*side,y=sampleVisibleBank(x,z);if(y===null)throw Error('Dock appearance approach lacks actual visual bank');dp.push(x,y+.018,z);}di.push(start,start+2,start+1,start,start+3,start+2);}}
  mesh('West lake dock dry-bank appearance approach',dp,null,di,simpleMaterial({color:'#b6b09b',roughness:1}));

  // Cultivated soil plots and low crop silhouettes are ornamental, no stock/food refill.
  const soil=simpleMaterial({color:'#6c5b40',roughness:1}),soilGeometry=new THREE.BoxGeometry(6,.12,2.6);resources.push(soilGeometry);
  for(let z=44;z<=50;z+=4)for(const x of[37,45,64,72]){const bed=new THREE.Mesh(soilGeometry,soil);bed.name='Cultivated garden plot '+x+':'+z;bed.position.set(x,.06,z);bed.receiveShadow=true;group.add(bed);}
  const wetland=[],reeds=[];
  for(let i=0;i<9;i++){const a=(.55+i*.115)*Math.PI,x=-81+14*1.2*Math.cos(a),z=1+10*1.2*Math.sin(a),p=[x,-1.795,z];if(reserved(x,z,.65))continue;wetland.push({id:'expansion-wetland-'+i,p,yaw:i*.6,size:[.8,.8,.8]});reeds.push({id:'expansion-reeds-'+i,kind:'reeds',p:[x+.3,-1.795,z],size:[.5,1.1,.5],seed:10300+i,yaw:i*.6});}
  batched('Lake broadleaf fringe',()=>createWetlandPlant('broadleaf'),wetland);
  const reedOwner=own(new VegetationViews(reeds));group.add(reedOwner.group);
  const bankEnrichment=own(createExpansionBankEnrichment(sampleVisibleBank,[...reeds,...wetland].map(p=>p.p),group.children.filter(m=>m.name?.endsWith(' bed'))));if(bankEnrichment)group.add(bankEnrichment.group);
  const crops=[];for(let z=44;z<=48;z+=4)for(const x of[37,45,64,72])for(let i=0;i<12;i++)crops.push({id:'cultivated-green-'+x+':'+z+':'+i,kind:'shrub',p:[x-2.4+(i%6)*.95,.12,z-.6+Math.floor(i/6)*1.2],size:[.28,.42,.28],seed:9500+crops.length,yaw:i*.7});
  const cropOwner=own(new VegetationViews(crops));group.add(cropOwner.group);
  const orchard=own(createOrchardProposal('six-tree'));orchard.group.position.set(40,0,59);orchard.group.name='Southern ornamental orchard with central aisle';group.add(orchard.group);
  const arch=own(createAridLandmark('arch',{p:[100,0,68],yaw:0}));group.add(arch.group);
  const basalt=own(createVolcanicLandscapeKit('basalt-ridge'));basalt.group.position.set(95,0,79);basalt.group.scale.set(.2,.2,.2);group.add(basalt.group);
  const ridge=own(createMountainRidge('lowhill',{p:[-28,0,-51],yaw:0}));ridge.group.scale.set(.4,.4,.75);group.add(ridge.group);
  group.updateMatrixWorld(true);let calls=0,triangles=0,shadowCalls=0,shadowTriangles=0;group.traverse(m=>{if(!m.isMesh)return;const t=(m.geometry.index?.count??m.geometry.attributes.position.count)/3*(m.isInstancedMesh?m.count:1);calls++;triangles+=t;if(m.castShadow){shadowCalls++;shadowTriangles+=t;}});
  if(calls>300||triangles>1_200_000)throw Error('Expansion geometry exceeds declared broad-world budget');
  let closed=false;return{group,layout,planting,waterJoin,bankEnrichment:bankEnrichment?.inspection,waterFringe:{reedClumps:reeds.length,broadleafClumps:wetland.length},sampleVisibleBank(x,z){return closed?null:sampleVisibleBank(x,z);},sampleVisualGround(x,z){return closed?null:sampleVisualGround(x,z);},costs:{calls,triangles,oneSunCalls:calls+shadowCalls,oneSunTriangles:triangles+shadowTriangles,textures:0},dispose(){if(closed)return;closed=true;const errors=release();if(errors.length)throw new AggregateError(errors,'Expansion disposal failed',{cause:errors[0]});}};
 }catch(cause){const errors=release();if(errors.length)throw new AggregateError([cause,...errors],'Expansion construction rollback failed',{cause});throw cause;}
}
