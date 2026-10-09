import type * as THREE from 'three';
type Controls={target:THREE.Vector3;update():unknown};
/** Explore selects a legal authored endpoint; manual movement still uses its normal wall sweeps. */
export class WorldPlaceCamera{
 framed=false;
 initial(overview:()=>void){if(this.framed)return;overview();this.framed=true;}
 place(camera:THREE.Camera,controls:()=>Controls,view:{p:readonly[number,number,number];target:readonly[number,number,number]},takeOver:()=>void,release:()=>void){
  takeOver();release();const orbit=controls();camera.position.fromArray(view.p);orbit.target.fromArray(view.target);camera.lookAt(orbit.target);orbit.update();this.framed=true;
 }
}
