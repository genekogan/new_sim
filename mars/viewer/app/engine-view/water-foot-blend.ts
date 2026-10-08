import * as THREE from 'three';
const first=new THREE.Quaternion(),second=new THREE.Quaternion(),target=new THREE.Quaternion();
/** A reference-guided spherical curve avoids changing to the opposite arc when
 * animated dry and pointed swimming feet pass 180 degrees apart. Reference is
 * the authored rest foot turned halfway toward the surface-swimming target.
 * Endpoints remain exact; no previous frame or wall-clock state is required. */
export function blendWaterFoot(out:THREE.Quaternion,origin:THREE.Quaternion,reference:THREE.Quaternion,weight:number){
 if(weight<=0)return out.copy(origin);
 if(weight>=1)return out;
 target.copy(out);
 first.copy(origin).slerp(reference,weight);
 second.copy(reference).slerp(target,weight);
 return out.slerpQuaternions(first,second,weight).normalize();
}
