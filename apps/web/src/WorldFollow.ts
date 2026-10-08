import * as THREE from 'three';
import {WorldVisibilityInstances} from './WorldVisibilityInstances.ts';
/** Camera-only sightline protection. Requested orbit/zoom survives temporary
 * obstruction; the rendered camera may move nearer or around a blocking post. */
/** VF6: Follow zoom bounds (metres from the Soul) and how long after the last drag/zoom the viewer's view is kept as is. */
export const FOLLOW_MIN=2.4,FOLLOW_MAX=40;const USER_HOLD=.6;
export class WorldFollow {
  private requested:THREE.Vector3|null=null;
  private rendered:THREE.Vector3|null=null;
  private ray=new THREE.Raycaster();
  private instances=new WorldVisibilityInstances();
  private objects:THREE.Object3D[]=[];
  private hits:THREE.Intersection[]=[];
  private normal=new THREE.Vector3();
  reset(){this.requested=this.rendered=this.chosen=this.previousTarget=null;this.userOrbited=false;this.lastSearch=-Infinity;this.velocity.set(0,0,0);this.userAt=-Infinity;this.instances.reset();}
  /** Same candidates as recursive intersectObjects, minus objects whose hits
   * opaque() always rejects: hidden ancestry or own cameraTransparent. */
  private collect(roots:readonly THREE.Object3D[]){
    this.objects.length=0;const seen=new Set<THREE.Object3D>();
    const visit=(o:THREE.Object3D)=>{if(!o.visible||seen.has(o))return;seen.add(o);if(o.userData.cameraTransparent!==true)this.objects.push(o);for(const c of o.children)visit(c);};
    for(const root of roots){let shown=true;for(let p=root.parent;p;p=p.parent)if(!p.visible)shown=false;if(shown)visit(root);}
    this.instances.retain(this.objects);
  }
  /** Body tracking changes the relative camera frame; it is not an orbit/zoom
   * gesture. Shift both offsets before evaluating actual user input. */
  shiftFrame(delta:THREE.Vector3){
    if(!delta.toArray().every(Number.isFinite))return;
    this.requested?.add(delta);this.rendered?.add(delta);
  }
  private opaque(object:THREE.Object3D){
    if(object.userData.cameraTransparent===true)return false;
    for(let o:THREE.Object3D|null=object;o;o=o.parent)if(!o.visible)return false;
    const materials=(object as THREE.Mesh).material;
    return !materials||[materials].flat().some(m=>!m.transparent||m.opacity>=.5);
  }
  private limit(target:THREE.Vector3,offset:THREE.Vector3,roots:readonly THREE.Object3D[]){
    const distance=offset.length(),direction=offset.clone().normalize(),right=new THREE.Vector3(direction.z,0,-direction.x).normalize();let allowed=distance;
    // Torso, head and both shoulder edges. Ignore the selected body's own
    // render roots by supplying only architecture, components and fixtures.
    for(const [height,side] of [[0,0],[.6,0],[-.45,0],[0,.24],[0,-.24]]){
      const point=target.clone().add(new THREE.Vector3(0,height,0)).addScaledVector(right,side);
      this.ray.set(point,direction);this.ray.near=.05;this.ray.far=distance+.25;
      // Nearest opaque hit, as intersectObjects(...).sort().find(opaque) would give.
      this.hits.length=0;for(let o=0;o<this.objects.length;o++)this.instances.intersect(this.objects[o],this.ray,this.hits,o);
      let nearest=Infinity;for(const h of this.hits)if(h.distance<nearest&&this.opaque(h.object))nearest=h.distance;this.hits.length=0;
      if(nearest<Infinity)allowed=Math.min(allowed,Math.max(0,nearest-.25));
    }
    return allowed;
  }
  /** Distance from target to the drawn wall nearest it on the camera→target
   * segment (faces toward the camera only); Infinity when none. */
  private drawnShell(target:THREE.Vector3,offset:THREE.Vector3){
    const distance=offset.length();if(!(distance>.1))return Infinity;
    const eye=target.clone().add(offset);this.ray.set(eye,offset.clone().multiplyScalar(-1/distance));this.ray.near=0;this.ray.far=distance-.05;
    this.hits.length=0;for(let o=0;o<this.objects.length;o++)this.instances.intersect(this.objects[o],this.ray,this.hits,o);
    // Walls only (|normal.y| < .7): ground relief and floors under a Soul are
    // not enclosing shells and keep the original pull-in rule.
    let farthest=-Infinity;for(const h of this.hits)if(h.distance>farthest&&h.face&&Math.abs(this.normal.copy(h.face.normal).transformDirection(h.object.matrixWorld).y)<.7&&this.opaque(h.object))farthest=h.distance;this.hits.length=0;
    return farthest>-Infinity?distance-farthest:Infinity;
  }
  resolve(target:THREE.Vector3,actualOffset:THREE.Vector3,roots:readonly THREE.Object3D[],seconds:number):THREE.Vector3 {
    if(!actualOffset.toArray().every(Number.isFinite)||actualOffset.length()<.01)return actualOffset.clone();
    if(!this.requested||!this.rendered)this.requested=actualOffset.clone();
    else if(actualOffset.distanceTo(this.rendered)>1e-5){
      // OrbitControls changes the displayed offset. Apply its rotation and
      // zoom ratio to the requested offset rather than losing the hidden zoom.
      const rotation=new THREE.Quaternion().setFromUnitVectors(this.rendered.clone().normalize(),actualOffset.clone().normalize());
      this.requested.applyQuaternion(rotation).multiplyScalar(actualOffset.length()/this.rendered.length());
      const wantedLength=Math.max(FOLLOW_MIN,Math.min(FOLLOW_MAX,this.requested.length()));
      this.requested.copy(actualOffset).setLength(wantedLength);  // VF6: exactly the direction the viewer chose
      // VF6 (Gene: "use the mouse to adjust your viewpoint but always facing the subject"): the user's orbit/zoom
      // IS the view. Take it as drawn (no glide back to the old viewpoint) and make it the preferred offset the
      // occlusion search starts from; the gentle behind-the-walk drift stops for this follow.
      this.rendered=actualOffset.clone().setLength(this.requested.length());this.chosen=null;this.userAt=this.clock;this.userOrbited=true;
    }
    for(const root of roots)root.updateWorldMatrix(true,true);
    this.collect(roots);
    return this.instances.withQuery(this.objects,()=>this.resolveCollected(target,roots,seconds));
  }
  // VF4 (Gene: Follow "goes crazy" in dense streets). The camera never snaps: it picks a clear viewpoint near the
  // requested one (rise first, then orbit a little; scored for clear sight, closeness to where the camera is, the
  // requested angle and staying behind the walk) with hysteresis, and glides there in spherical coordinates so it
  // moves around obstacles, never through them. Only the first frame after a (re)start is placed directly.
  private chosen:THREE.Vector3|null=null;
  private lastSearch=-Infinity;
  private clock=0;
  private previousTarget:THREE.Vector3|null=null;
  private velocity=new THREE.Vector3();
  private userAt=-Infinity;
  private userOrbited=false;
  /** True while the viewer is dragging/zooming (and a moment after): their view is shown as is. */
  get userActive(){return this.clock-this.userAt<USER_HOLD;}
  private clear(target:THREE.Vector3,offset:THREE.Vector3,roots:readonly THREE.Object3D[]){return this.limit(target,offset,roots)>=offset.length()-.01;}
  private candidates(wanted:THREE.Vector3){
    const s=new THREE.Spherical().setFromVector3(wanted),out:THREE.Vector3[]=[wanted.clone()];
    const at=(dTheta:number,dPhi:number,scale=1)=>new THREE.Vector3().setFromSpherical(new THREE.Spherical(s.radius*scale,Math.max(.15,Math.min(Math.PI*.48,s.phi+dPhi)),s.theta+dTheta));
    for(const dPhi of [-.25,-.5,-.75,-1.05,-1.4])out.push(at(0,dPhi));  // rise first; high views fly over streets and fences
    for(const dTheta of [.35,-.35,.7,-.7,1.05,-1.05])for(const dPhi of [0,-.3,-.6])out.push(at(dTheta,dPhi));
    for(const dPhi of [0,-.4])out.push(at(0,dPhi,.75));
    return out;
  }
  private choose(target:THREE.Vector3,wanted:THREE.Vector3,roots:readonly THREE.Object3D[]){
    const from=(this.rendered??wanted).clone().normalize(),want=wanted.clone().normalize(),speed=Math.hypot(this.velocity.x,this.velocity.z);
    const behind=speed>.6?new THREE.Vector3(-this.velocity.x,0,-this.velocity.z).normalize():null;
    const cost=(c:THREE.Vector3)=>{const d=c.clone().normalize();let k=from.angleTo(d)+.6*want.angleTo(d)+.5*Math.abs(c.length()-wanted.length())/Math.max(1,wanted.length());
      if(behind){const flat=new THREE.Vector3(d.x,0,d.z);if(flat.lengthSq()>1e-6)k+=.3*(1-behind.dot(flat.normalize()));}return k;};
    let best:THREE.Vector3|null=null,bestCost=Infinity;
    for(const c of this.candidates(wanted)){const k=cost(c);if(k>=bestCost)continue;if(this.clear(target,c,roots)){best=c;bestCost=k;}}
    // Hysteresis: keep the previous viewpoint while it stays clear and is not clearly worse.
    if(this.chosen&&this.clear(target,this.chosen,roots)&&cost(this.chosen)<=bestCost+.25)return this.chosen;
    if(best)return best;
    // Nothing fully clear (a Soul pressed against walls): take the most open view, come in at most to a readable
    // 2.4 m (never into the body); the glide still eases there.
    let open:THREE.Vector3=wanted,openness=-1;
    for(const c of this.candidates(wanted)){const r=this.limit(target,c,roots)/c.length();if(r>openness+1e-3){open=c;openness=r;}}
    const reach=this.limit(target,open,roots);return open.clone().setLength(Math.max(Math.min(2.4,open.length()),Math.min(open.length(),reach)));
  }
  private resolveCollected(target:THREE.Vector3,roots:readonly THREE.Object3D[],seconds:number):THREE.Vector3 {
    const dt=Number.isFinite(seconds)?Math.max(0,Math.min(.1,seconds)):0;this.clock+=dt;
    if(this.previousTarget&&dt>0){const v=target.clone().sub(this.previousTarget).divideScalar(dt);if(v.length()<20)this.velocity.lerp(v,-Math.expm1(-dt/.6));}
    this.previousTarget=target.clone();
    // A gentle drift toward behind the walk, only while walking and the viewer has not orbited for a while.
    const speed=Math.hypot(this.velocity.x,this.velocity.z);
    if(speed>.6&&!this.userOrbited&&dt>0){
      const s=new THREE.Spherical().setFromVector3(this.requested!),behind=Math.atan2(-this.velocity.x,-this.velocity.z);
      let d=behind-s.theta;d=Math.atan2(Math.sin(d),Math.cos(d));s.theta+=Math.sign(d)*Math.min(Math.abs(d),.1*dt);this.requested!.setFromSpherical(s);
    }
    const wanted=this.requested!.clone();
    // While the viewer's hand is on the camera, show their view; only a wall between camera and Soul pulls it in
    // (a collision camera). Their requested distance survives, and the search resumes from their angle after.
    if(this.userActive&&this.rendered){
      const reach=this.limit(target,this.rendered,roots);
      this.rendered.setLength(Math.max(Math.min(FOLLOW_MIN,this.rendered.length()),Math.min(this.rendered.length(),reach)));
      return this.rendered.clone();
    }
    if(!this.chosen||this.clock-this.lastSearch>=.2||!this.clear(target,this.chosen,roots)){this.chosen=this.choose(target,wanted,roots).clone();this.lastSearch=this.clock;}
    const goal=this.chosen;
    if(!this.rendered)this.rendered=goal.clone();
    else{
      // Glide on the sphere around the Soul (around obstacles, not through them); hurry, never jump, when blocked.
      const blocked=!this.clear(target,this.rendered,roots),k=(tau:number)=>-Math.expm1(-dt/tau);
      const a=new THREE.Spherical().setFromVector3(this.rendered),b=new THREE.Spherical().setFromVector3(goal);
      let dTheta=b.theta-a.theta;dTheta=Math.atan2(Math.sin(dTheta),Math.cos(dTheta));
      a.theta+=dTheta*k(blocked?.35:.9);a.phi+=(b.phi-a.phi)*k(blocked?.35:.9);a.radius+=(b.radius-a.radius)*k(blocked?.3:1.2);
      this.rendered.setFromSpherical(a);
    }
    // limit() rays leave the body, so they pass through the back of a
    // single-sided shell (tower, drum) whose drawn outside faces the camera.
    // Cast once from the camera toward the torso; keep inside such a shell.
    // (Only when the body-side rays see nothing: a wall they do see is handled by the glide above, not a pull-in.)
    const shell=this.clear(target,this.rendered,roots)?this.drawnShell(target,this.rendered):Infinity;
    // Only an enclosing shell (room-sized, >= 1.5 m away) is cleared by pulling
    // in; a Soul in or against a solid (wall, canopy) cannot be.
    if(shell<this.rendered.length()&&shell>=1.5)this.rendered.setLength(shell-.25);
    return this.rendered.clone();
  }
}
