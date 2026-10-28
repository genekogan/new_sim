import * as THREE from 'three';
import type {Rig,Template} from './people.ts';
import type {Leg} from './rig.ts';
import type {stairShoeRefs} from './stair-shoe-refs.ts';
export type StairRigContact={reach:number;length:number;width:number;normals:Map<number,THREE.Vector3>;shoePoints:Map<number,THREE.Vector3[]>};
const cache=new WeakMap<Template,{identity:string;contact:StairRigContact|null}>();
/** Conservative full-leg reach plus the actual ankle-to-shoe extent. This is a
 * kinematic bound, not a claim that animation key/mid samples bound a spline.
 * Called in the measured Idle0 pose; it never modifies the mixer or rig. */
export function measureStairRigContact(rig:Rig,legs:readonly Leg[],shoes:ReturnType<typeof stairShoeRefs>,legLen:number):StairRigContact|null{
 if(!shoes?.complete||!Number.isFinite(legLen)||legLen<=0)return null;
 const meshes=[...new Set([...shoes.refs.values()].flatMap(r=>r.map(r=>r.mesh)))];
 const identity=[legLen,...rig.holder.scale.toArray(),...rig.model.scale.toArray(),...meshes.map(m=>[m.geometry.uuid,...['position','skinIndex','skinWeight'].map(name=>{const a=m.geometry.getAttribute(name);return a&&('version' in a?a.version:a.data.version);}),m.geometry.index?.version].join(':'))].join('|');
 const before=cache.get(rig.template);if(before?.identity===identity)return before.contact;
 const normals=new Map<number,THREE.Vector3>(),shoePoints=new Map<number,THREE.Vector3[]>();let reach=0,length=0,width=0;
 for(const leg of legs){
  const ankle=leg.foot.getWorldPosition(new THREE.Vector3()),hip=leg.upper.getWorldPosition(new THREE.Vector3());
  const bounds=new THREE.Box3(),localPoints:THREE.Vector3[]=[],inverseRotation=leg.foot.getWorldQuaternion(new THREE.Quaternion()).invert();let radius=0,bestArea=0,bestNormal:THREE.Vector3|null=null;
  for(const ref of shoes.refs.get(leg.side)??[]){
   const ids=new Set(ref.idx),points=new Map<number,THREE.Vector3>();
   for(const id of ids){const p=ref.mesh.getVertexPosition(id,new THREE.Vector3()).applyMatrix4(ref.mesh.matrixWorld);if(!p.toArray().every(Number.isFinite)){cache.set(rig.template,{identity,contact:null});return null;}bounds.expandByPoint(p);radius=Math.max(radius,p.distanceTo(ankle));points.set(id,p);localPoints.push(p.clone().sub(ankle).applyQuaternion(inverseRotation));}
   const index=ref.mesh.geometry.index;if(!index)continue;
   for(let i=0;i+2<index.count;i+=3){const a=points.get(index.getX(i)),b=points.get(index.getX(i+1)),c=points.get(index.getX(i+2));if(!a||!b||!c)continue;
    const normal=new THREE.Vector3().crossVectors(b.clone().sub(a),c.clone().sub(a)),area=normal.length();if(area<=bestArea||area<1e-10)continue;
    normal.divideScalar(area);if(normal.y>-.9)continue;
    bestArea=area;bestNormal=normal;
   }
  }
  if(!bestNormal||bounds.isEmpty()){cache.set(rig.template,{identity,contact:null});return null;}
  // The largest actual downward outsole triangle defines its bearing normal.
  normals.set(leg.side,bestNormal.applyQuaternion(leg.foot.getWorldQuaternion(new THREE.Quaternion()).invert()));
  // All actual shoe vertices in the measured Idle0 pose, relative to the ankle.
  // Shin-weighted uppers deform during IK: these are planning data only. The
  // final actual skinned vertices still own the contact guard and proof.
  shoePoints.set(leg.side,localPoints);
  reach=Math.max(reach,Math.hypot(hip.x,hip.z)+legLen+radius);
  length=Math.max(length,bounds.max.x-bounds.min.x);width=Math.max(width,bounds.max.z-bounds.min.z);
 }
 const contact={reach,length,width,normals,shoePoints};cache.set(rig.template,{identity,contact});return contact;
}
/** The measured footprint's blend width follows the actual body heading. */
export function stairContactEnvelope(contact:Pick<StairRigContact,'reach'|'length'|'width'>,bodyYaw:number,dir:readonly number[]){
 const forward=Math.cos(bodyYaw)*dir[0]+Math.sin(bodyYaw)*dir[1],right=-Math.sin(bodyYaw)*dir[0]+Math.cos(bodyYaw)*dir[1];
 return {reach:contact.reach,blend:Math.abs(forward)*contact.length+Math.abs(right)*contact.width};
}
/** Align the actual outsole bearing face to the actual horizontal tread. The
 * same baseline applies during swing, so phase boundaries cannot switch pitch. */
export function stairBearingRotation(rest:THREE.Quaternion,localNormal:THREE.Vector3):THREE.Quaternion{
 const normal=localNormal.clone().applyQuaternion(rest).normalize();
 return new THREE.Quaternion().setFromUnitVectors(normal,new THREE.Vector3(0,-1,0)).multiply(rest);
}
