import * as THREE from 'three';
/** Phones on an old world: does any person stand where the arrival camera looks? A person counts when a 1.2 m sphere
 * around their middle (0.9 m above their feet) meets the camera's frustum within `reach` metres. When none does, the
 * card need not wait for character models nobody will see; they stream in after the arrival. */
const frustum=new THREE.Frustum(),matrix=new THREE.Matrix4(),sphere=new THREE.Sphere();
export function anyPersonInView(camera:THREE.Camera,feet:Iterable<readonly number[]>,reach=150):boolean{
 camera.updateMatrixWorld();frustum.setFromProjectionMatrix(matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
 const eye=new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
 for(const p of feet){if(!(p.length>=3&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&Number.isFinite(p[2])))return true;  // unknown place: assume seen
  sphere.center.set(p[0],p[1]+.9,p[2]);sphere.radius=1.2;if(sphere.center.distanceTo(eye)<=reach+sphere.radius&&frustum.intersectsSphere(sphere))return true;}
 return false;}
