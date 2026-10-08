import * as THREE from 'three';
import {VegetationViews} from '../../../vegetation.ts';
import {createForestUnderstory} from '../forest-understory.ts';
import {createRiverbankStones} from '../riverbank-stone-proposal/stones.mjs';
import {createWetlandPlant} from '../wetland-plant-family/wetland.mjs';
import {reserved,inWater,inNative} from './layout.mjs';

/** Enrich NEW visible bank triangles only; no native domain, scatter/time or body/root override. */
export function createExpansionBankEnrichment(sampleBank,occupiedFringe,actualBedMeshes=[]){
 if(typeof sampleBank!=='function'||!Array.isArray(occupiedFringe))return null;
 const plan=[],omitted=[],candidate=[];
 for(let i=0;i<40;i++){const a=i*Math.PI/20,r=1.13+(i%3)*.025;candidate.push({id:'expansion-lake-bank-'+i,x:-81+14*r*Math.cos(a),z:1+10*r*Math.sin(a),type:['grass','fern','grass','stone','grass','wetland'][i%6],yaw:a+.4});}
 for(const side of[-1,1])for(let i=0;i<13;i++)candidate.push({id:'expansion-river-bank-'+side+':'+i,x:-74+side*3.5,z:-31+i*2,type:i%4===0?'stone':i%3===0?'fern':'grass',yaw:i*.47});
 // Interior points of actual Float32 bank faces avoid arbitrary future slopes.
 for(const mesh of actualBedMeshes){const a=mesh.geometry.attributes.position.array;for(let j=0;j<a.length;j+=9){if([a[j+1],a[j+4],a[j+7]].some(y=>y<-2-1e-6))continue;
  const x=(a[j]+a[j+3]+a[j+6])/3,z=(a[j+2]+a[j+5]+a[j+8])/3,spacing=candidate.some(p=>Math.hypot(p.x-x,p.z-z)<.9);if(spacing)continue;
  candidate.push({id:'expansion-bank-face:'+mesh.name+':'+j,x,z,type:['stone','fern','wetland','grass'][Math.floor(j/9)%4],yaw:(j*.013)%6.28});}}
 for(const p of candidate){const r=p.type==='grass'?.16:p.type==='stone'?.28:.24,y=sampleBank(p.x,p.z),h=.015,x0=sampleBank(p.x-h,p.z),x1=sampleBank(p.x+h,p.z),z0=sampleBank(p.x,p.z-h),z1=sampleBank(p.x,p.z+h);
  if([y,x0,x1,z0,z1].some(v=>typeof v!=='number'||!Number.isFinite(v))||reserved(p.x,p.z,r)||inWater(p.x,p.z)||occupiedFringe.some(q=>Math.hypot(q[0]-p.x,q[2]-p.z)<.9)){omitted.push(p.id);continue;}
  const dx=(x1-x0)/(2*h),dz=(z1-z0)/(2*h);let planar=true;for(const [a,b]of[[-r,-r],[r,-r],[-r,r],[r,r],[r,0],[-r,0],[0,r],[0,-r]]){const actual=sampleBank(p.x+a,p.z+b);if(actual===null||Math.abs(actual-(y+dx*a+dz*b))>.0006||inWater(p.x+a,p.z+b)||reserved(p.x+a,p.z+b,0))planar=false;}
  if(!planar){omitted.push(p.id);continue;}plan.push({...p,p:[p.x,y,p.z],normal:[-dx,1,-dz],size:p.type==='grass'?[.2,.3,.2]:p.type==='stone'?[.4,.4,.4]:[.4,.4,.4]});
 }
 const group=new THREE.Group(),owners=[],instances=[];group.name='Continuous NEW lake and river stone/grass/fern/wetland edge';const prototype=new Map(),kept=[],failures=[];let closed=false,minBase=Infinity,maxBase=-Infinity;
 const release=()=>{const errors=[];for(const a of[()=>group.removeFromParent(),...instances.map(m=>()=>m.dispose()),...owners.map(o=>()=>o.dispose()),()=>group.clear()])try{a();}catch(e){errors.push(e);}return errors;};
 try{
  for(const type of new Set(plan.map(p=>p.type))){const owner=type==='grass'?new VegetationViews([{id:'bank-original-grass-prototype',kind:'grass',p:[0,0,0],size:[1,1,1],yaw:0,seed:42420}]):type==='fern'?createForestUnderstory('fern'):type==='stone'?createRiverbankStones('small'):createWetlandPlant('rosette');owners.push(owner);prototype.set(type,owner);}
  const matrix=new THREE.Matrix4(),v=new THREE.Vector3(),piece=new THREE.Matrix4(),Y=new THREE.Vector3(0,1,0);
  for(const p of plan){const normal=new THREE.Vector3(...p.normal).normalize(),q=new THREE.Quaternion().setFromUnitVectors(Y,normal).multiply(new THREE.Quaternion().setFromAxisAngle(Y,-p.yaw)),root=new THREE.Matrix4().compose(new THREE.Vector3(...p.p),q,new THREE.Vector3(...p.size)),parts=[];let valid=true,lo=Infinity,hi=-Infinity;
   for(const source of prototype.get(p.type).group.children){const transforms=[];for(let i=0;i<(source.isInstancedMesh?source.count:1);i++){if(source.isInstancedMesh)source.getMatrixAt(i,piece);else piece.identity();matrix.multiplyMatrices(root,piece);const pos=source.geometry.attributes.position,minY=Math.min(...Array.from({length:pos.count},(_,j)=>pos.getY(j)));
     for(let j=0;j<pos.count;j++){v.fromBufferAttribute(pos,j).applyMatrix4(matrix);if(inNative(v.x,v.z)||inWater(v.x,v.z)||reserved(v.x,v.z,0))valid=false;
      if(Math.abs(pos.getY(j)-minY)<1e-7&&source.name!=='two-sided leaf blades'&&!source.name.includes('leaves')){const y=sampleBank(v.x,v.z);if(y===null)valid=false;else{lo=Math.min(lo,v.y-y);hi=Math.max(hi,v.y-y);if(Math.abs(v.y-y)>.001)valid=false;}}}
     transforms.push(matrix.clone());}parts.push({source,transforms});}
   if(!valid){failures.push(p.id);continue;}kept.push(p);minBase=Math.min(minBase,lo);maxBase=Math.max(maxBase,hi);p.parts=parts;
  }
  for(const [type,owner]of prototype){const roots=kept.filter(p=>p.type===type);if(!roots.length)continue;
   owner.group.children.forEach((source,k)=>{const mats=roots.flatMap(p=>p.parts[k].transforms),m=new THREE.InstancedMesh(source.geometry,source.material,mats.length);instances.push(m);mats.forEach((mat,i)=>m.setMatrixAt(i,mat));m.instanceMatrix.needsUpdate=true;m.computeBoundingBox();m.computeBoundingSphere();m.name='NEW fitted bank '+type+' / '+source.name;m.castShadow=source.castShadow;m.receiveShadow=source.receiveShadow;group.add(m);});
  }
  let calls=0,triangles=0;for(const m of instances){calls++;triangles+=(m.geometry.index?.count??m.geometry.attributes.position.count)/3*m.count;}if(calls>10||triangles>100_000)throw Error('Bank enrichment exceeds scoped budget');
  return{group,inspection:{candidateCount:candidate.length,preflightAccepted:plan.length,kept:kept.map(({parts,...p})=>p),omitted,fullGeometryRefused:failures,minBaseRelativeY:Number.isFinite(minBase)?minBase:null,maxBaseRelativeY:Number.isFinite(maxBase)?maxBase:null,calls,triangles,textures:0,scope:'NEW actual visible bank triangles/planar bases only; no native ecology/watering/support/food'},dispose(){if(closed)return;closed=true;const errors=release();if(errors.length)throw new AggregateError(errors,'Bank enrichment cleanup',{cause:errors[0]});}};
 }catch(cause){const errors=release();if(errors.length)throw new AggregateError([cause,...errors],'Bank enrichment rollback',{cause});throw cause;}
}
