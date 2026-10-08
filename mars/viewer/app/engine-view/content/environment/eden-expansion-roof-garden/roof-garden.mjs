import * as THREE from 'three';
import {VegetationViews} from '../../../vegetation.ts';
import {createForestUnderstory} from '../forest-understory.ts';
const BEDS=[];
for(const [house,x]of[[3,34],[4,54]])for(const[name,dx,dz,y]of[['west-a',-4.5,2.8,3.445],['west-b',-3.1,2.8,3.445],['upper-a',-3,-3.5,6.245],['upper-b',1,-3.5,6.245]])BEDS.push({id:'eden-house-'+house+'-roof-bed-'+name,p:[x+dx,y,30+dz]});
for(const x of[88,92,96])for(const z of[12,18])BEDS.push({id:'eden-office-roof-bed-'+x+'-'+z,p:[x,9.545,z]});
const own=(o,k)=>{const d=o&&Object.getOwnPropertyDescriptor(o,k);return d&&Object.hasOwn(d,'value')?d.value:undefined;};
const dense=(a,n)=>Array.isArray(a)&&Reflect.ownKeys(a).length===n+1&&a.length===n&&Array.from({length:n},(_,i)=>Object.getOwnPropertyDescriptor(a,String(i))).every(d=>d&&Object.hasOwn(d,'value'));
const near=(a,b)=>typeof a==='number'&&Number.isFinite(a)&&Math.abs(a-b)<1e-9;
/** Exact 14 supplied Assets272f soil datums; no ground-height guessing. */
export function inspectEdenRoofGarden(plan,enabled=false){
 if(enabled!==true)return null;const beds=own(plan,'beds');if(!dense(beds,14))return null;
 const rows=[];
 for(const b of BEDS){const found=beds.filter(v=>own(v,'id')===b.id);if(found.length!==1)return null;const soil=own(found[0],'soil'),r=own(soil,'rectangleXZ'),y=own(soil,'topY'),expected=[b.p[0]-.545,b.p[2]-.345,b.p[0]+.545,b.p[2]+.345];if(!dense(r,4)||!r.every((v,i)=>near(v,expected[i]))||!near(y,b.p[1]))return null;rows.push({id:b.id,p:[b.p[0],y,b.p[2]],soilRectangle:[...r]});}
 return{beds:rows,scope:'optional decorative plants on exact new renderer-owned bed datums; no roof access/structural load/growth/food/native support'};
}
export function createEdenRoofGarden(plan,verifiedSelectedBed,enabled=false){
 const inspection=inspectEdenRoofGarden(plan,enabled);if(!inspection||typeof verifiedSelectedBed!=='function'||inspection.beds.some(b=>verifiedSelectedBed(b.id,[...b.p],[...b.soilRectangle])!==true))return null;
 const group=new THREE.Group(),owners=[],instances=[];group.name='Restrained Eden roof garden; exact14ownedbed datums';let closed=false;
 const release=()=>{const errors=[];for(const fn of[()=>group.removeFromParent(),...instances.map(m=>()=>m.dispose()),...owners.map(o=>()=>o.dispose()),()=>group.clear()])try{fn();}catch(e){errors.push(e);}return errors;};
 try{
  const grass=[];for(const b of inspection.beds)for(let i=0;i<4;i++)grass.push({id:b.id+'-grass-'+i,kind:'grass',p:[b.p[0]+(i%2?1:-1)*.28,b.p[1],b.p[2]+(i<2?-1:1)*.16],size:[.15,.22,.15],yaw:i*.9,seed:11100+grass.length});
  const g=new VegetationViews(grass);owners.push(g);if(g.rejected.length)throw Error('Original roof grass refused placements');group.add(g.group);
  const flowerBeds=inspection.beds.filter((_,i)=>i%2===0),flower=createForestUnderstory('flowering-shrub');owners.push(flower);for(const source of flower.group.children){const mesh=new THREE.InstancedMesh(source.geometry,source.material,flowerBeds.length);instances.push(mesh);mesh.name='roof small flowering herb / '+source.name;flowerBeds.forEach((b,i)=>mesh.setMatrixAt(i,new THREE.Matrix4().compose(new THREE.Vector3(...b.p),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),i*.31),new THREE.Vector3(.25,.25,.25))));mesh.computeBoundingBox();mesh.computeBoundingSphere();mesh.castShadow=source.castShadow;mesh.receiveShadow=true;group.add(mesh);}
 }catch(cause){const errors=release();if(errors.length)throw new AggregateError([cause,...errors],'Roof garden rollback failed',{cause});throw cause;}
 return{group,inspection,dispose(){if(closed)return;closed=true;const errors=release();if(errors.length)throw new AggregateError(errors,'Roof garden cleanup failed',{cause:errors[0]});}};
}
