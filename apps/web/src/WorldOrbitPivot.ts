import * as THREE from 'three';
/** Orbit-mode click-to-centre. A click on scenery picks a point; a line is
 * drawn from the current orbit centre to it, then the centre glides there and
 * the camera follows with the same offset (same distance and angle). Pure
 * presentation: no actor, selection, simulation or scene mutation. */
export class WorldOrbitPivot {
  readonly group=new THREE.Group();
  private from=new THREE.Vector3();
  private to=new THREE.Vector3();
  private offset=new THREE.Vector3();
  private elapsed=0;
  private active=false;
  private markerAge=Infinity;
  private ray=new THREE.Raycaster();
  private line:THREE.Line;
  private ring:THREE.Mesh;
  private lineMaterial=new THREE.LineBasicMaterial({color:'#ffe08a',transparent:true,depthTest:false});
  private ringMaterial=new THREE.MeshBasicMaterial({color:'#ffe08a',transparent:true,depthTest:false,side:THREE.DoubleSide});
  static readonly GLIDE_SECONDS=.7;
  static readonly MARKER_SECONDS=1.6;
  constructor(){
    this.group.name='orbit-pivot-marker';this.group.renderOrder=999;this.group.visible=false;
    const lineGeometry=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]);
    this.line=new THREE.Line(lineGeometry,this.lineMaterial);this.line.frustumCulled=false;
    this.ring=new THREE.Mesh(new THREE.RingGeometry(.35,.5,32).rotateX(-Math.PI/2),this.ringMaterial);
    this.group.add(this.line,this.ring);
  }
  /** First visible rendered surface under the pointer, else the Y0 ground plane. */
  pick(ndc:THREE.Vector2,camera:THREE.Camera,roots:readonly THREE.Object3D[]):THREE.Vector3|null{
    this.ray.setFromCamera(ndc,camera);
    const shown=(o:THREE.Object3D)=>{for(let p:THREE.Object3D|null=o;p;p=p.parent)if(!p.visible)return false;return true;};
    for(const hit of this.ray.intersectObjects(roots as THREE.Object3D[],true))if((hit.object as THREE.Mesh).isMesh&&shown(hit.object)&&hit.distance>.5)return hit.point.clone();
    const ground=this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),0),new THREE.Vector3());
    return ground&&this.ray.ray.origin.distanceTo(ground)<600?ground:null;
  }
  start(camera:THREE.Camera,target:THREE.Vector3,point:THREE.Vector3){
    this.from.copy(target);this.to.copy(point);this.offset.copy(camera.position).sub(target);this.elapsed=0;this.active=true;this.markerAge=0;
    const positions=this.line.geometry.attributes.position as THREE.BufferAttribute;positions.setXYZ(0,target.x,target.y,target.z);positions.setXYZ(1,point.x,point.y,point.z);positions.needsUpdate=true;this.line.geometry.computeBoundingSphere();
    this.ring.position.copy(point).add(new THREE.Vector3(0,.03,0));this.group.visible=true;
  }
  cancel(){this.active=false;}
  get gliding(){return this.active;}
  /** Advance the glide; returns true while it moves the camera this frame. */
  update(seconds:number,camera:THREE.Camera,target:THREE.Vector3):boolean{
    const dt=Number.isFinite(seconds)?Math.max(0,Math.min(.1,seconds)):0;
    this.markerAge+=dt;const fade=Math.max(0,1-this.markerAge/WorldOrbitPivot.MARKER_SECONDS);
    this.lineMaterial.opacity=.9*fade;this.ringMaterial.opacity=.9*fade;this.group.visible=fade>0;
    if(!this.active)return false;
    this.elapsed+=dt;const t=Math.min(1,this.elapsed/WorldOrbitPivot.GLIDE_SECONDS),k=t*t*(3-2*t);
    target.copy(this.from).lerp(this.to,k);camera.position.copy(target).add(this.offset);
    if(t>=1)this.active=false;
    return true;
  }
  dispose(){this.group.removeFromParent();this.line.geometry.dispose();this.ring.geometry.dispose();this.lineMaterial.dispose();this.ringMaterial.dispose();}
}
