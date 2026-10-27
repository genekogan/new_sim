import * as THREE from 'three';
import {WorldVisibilityInstances} from './WorldVisibilityInstances.ts';
/** Camera-only sightline protection. Requested orbit/zoom survives temporary
 * obstruction; the rendered camera may move nearer or around a blocking post. */
/** VF6: Follow zoom bounds (metres from the Soul) and how long after the last drag/zoom the viewer's view is kept as is. */
export const FOLLOW_MIN=2.4,FOLLOW_MAX=40;const USER_HOLD=.6;
/** Nearest the camera comes to the Soul when walls (a narrow room, a stair) leave no clear view farther out. */
export const FOLLOW_NEAR=1;
const NEAR=FOLLOW_NEAR;
export class WorldFollow {
  private requested:THREE.Vector3|null=null;
  private rendered:THREE.Vector3|null=null;
  private ray=new THREE.Raycaster();
  private instances=new WorldVisibilityInstances();
  private objects:THREE.Object3D[]=[];
  private hits:THREE.Intersection[]=[];
  reset(){this.opening=this.pulled=null;this.requested=this.rendered=this.chosen=this.previousTarget=null;this.userOrbited=false;this.lastSearch=-Infinity;this.chosenClear=false;this.velocity.set(0,0,0);this.userAt=-Infinity;this.instances.reset();}
  /** Same candidates as recursive intersectObjects, minus objects whose hits
   * opaque() always rejects: hidden ancestry or own cameraTransparent. */
  private collect(roots:readonly THREE.Object3D[]){
    this.objects.length=0;const seen=new Set<THREE.Object3D>();
    // Sprites (speech bubbles, labels) never block the camera, and Sprite.raycast needs raycaster.camera, which this ray lacks.
    const visit=(o:THREE.Object3D)=>{if(!o.visible||seen.has(o))return;seen.add(o);if(o.userData.cameraTransparent!==true&&!(o as THREE.Sprite).isSprite)this.objects.push(o);for(const c of o.children)visit(c);};
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
  /** How far out along `offset` the camera still sees the Soul (metres). Stops early once below `need` (a yes/no
   * question); `torso` casts the torso line alone (a cheap estimate for the wide search). */
  private limit(target:THREE.Vector3,offset:THREE.Vector3,roots:readonly THREE.Object3D[],need=-Infinity,torso=false){
    const distance=offset.length(),direction=offset.clone().normalize(),right=new THREE.Vector3(direction.z,0,-direction.x).normalize();let allowed=distance;
    const reverse=direction.clone().negate(),far=distance+.25;
    // Torso, head and both shoulder edges. Ignore the selected body's own
    // render roots by supplying only architecture, components and fixtures.
    for(const [height,side] of torso?[[0,0]]:[[0,0],[.6,0],[-.45,0],[0,.24],[0,-.24]]){
      const point=target.clone().add(new THREE.Vector3(0,height,0)).addScaledVector(right,side);
      this.ray.set(point,direction);this.ray.near=.05;this.ray.far=far;
      // Nearest opaque hit, as intersectObjects(...).sort().find(opaque) would give.
      this.hits.length=0;for(let o=0;o<this.objects.length;o++)this.instances.intersect(this.objects[o],this.ray,this.hits,o);
      let nearest=Infinity;for(const h of this.hits)if(h.distance<nearest&&this.opaque(h.object))nearest=h.distance;this.hits.length=0;
      // A ray from the body passes through the back of a one-sided wall (a hotel room wall, a tower) whose drawn
      // face looks out at the camera: what the camera sees. Cast torso and head back from the far end too; a drawn
      // face found there blocks every camera beyond it, however close to the body it is.
      if(side===0&&height>=0){
        this.ray.set(point.clone().addScaledVector(direction,far),reverse);this.ray.near=0;this.ray.far=far-.05;
        for(let o=0;o<this.objects.length;o++)this.instances.intersect(this.objects[o],this.ray,this.hits,o);
        for(const h of this.hits)if(far-h.distance<nearest&&this.opaque(h.object))nearest=far-h.distance;this.hits.length=0;
      }
      if(nearest<Infinity)allowed=Math.min(allowed,Math.max(0,nearest-.25));
      if(allowed<need)break;
    }
    return allowed;
  }
  /** QA2 F11: a camera that sees the Soul only through an opening (a doorway, a window) in a wall across the view
   * frames that wall, not the Soul. Two rays a frame-width apart (left and right of the sightline, at torso and head
   * height, cast both ways for one-sided walls) that both meet a face turned along the view mean the camera stands
   * beyond such a wall: the length along `offset` up to it (minus a margin, at least NEAR), else Infinity. Walls along the view (a
   * corridor, a house beside the Soul) do not count, nor a post on one side only, nor anything outdoors. */
  private throughOpening(target:THREE.Vector3,offset:THREE.Vector3):number{
    const length=offset.length(),dir=offset.clone().normalize(),right=new THREE.Vector3(dir.z,0,-dir.x);
    if(right.lengthSq()<1e-6||length<NEAR+.5)return Infinity;right.normalize();
    const normal=new THREE.Vector3(),instance=new THREE.Matrix4(),world=new THREE.Matrix4();
    const crossing=(h:THREE.Intersection)=>{if(!h.face||!this.opaque(h.object))return false;normal.copy(h.face.normal);
      const mesh=h.object as THREE.InstancedMesh;
      if(mesh.isInstancedMesh&&h.instanceId!==undefined){mesh.getMatrixAt(h.instanceId,instance);world.multiplyMatrices(mesh.matrixWorld,instance);}else world.copy(h.object.matrixWorld);
      return Math.abs(normal.transformDirection(world).dot(dir))>.7;};
    // Indoors only: something overhead (a ceiling, a roof; cast both ways for one-sided ones) within 8 m. Outdoors a
    // gap between two houses is left to the sightline search (it rises over them).
    const head=target.clone().add(new THREE.Vector3(0,.6,0)),up=new THREE.Vector3(0,1,0);let roofed=false;
    for(const [origin,direction] of [[head,up],[head.clone().addScaledVector(up,8),up.clone().negate()]] as const){
      this.ray.set(origin,direction);this.ray.near=0;this.ray.far=8;this.hits.length=0;
      for(let o=0;o<this.objects.length;o++)this.instances.intersect(this.objects[o],this.ray,this.hits,o);
      roofed||=this.hits.some(h=>this.opaque(h.object));this.hits.length=0;
    }
    if(!roofed)return Infinity;
    let nearest=Infinity;
    for(const side of [-1,1]){let sideHit=Infinity;
      for(const height of [0,.6]){
        const from=target.clone().add(new THREE.Vector3(0,height,0)),to=target.clone().addScaledVector(offset,1).addScaledVector(right,side*length*.45);
        const ray=to.clone().sub(from),far=ray.length();ray.normalize();
        for(const [origin,direction,flip] of [[from,ray,false],[to,ray.clone().negate(),true]] as const){
          this.ray.set(origin,direction);this.ray.near=0;this.ray.far=far;this.hits.length=0;
          for(let o=0;o<this.objects.length;o++)this.instances.intersect(this.objects[o],this.ray,this.hits,o);
          for(const h of this.hits)if(crossing(h)){const along=(flip?far-h.distance:h.distance)*ray.dot(dir);if(along>.3)sideHit=Math.min(sideHit,along);}
          this.hits.length=0;
        }
      }
      if(sideHit===Infinity)return Infinity;nearest=Math.min(nearest,sideHit);
    }
    // A Soul in the doorway itself (the wall nearer than NEAR) is left to the sightline search.
    return nearest-.25>=NEAR?nearest-.25:Infinity;
  }
  private opening:{at:number;cap:number}|null=null;
  private pulled:number|null=null;
  /** Length for an offset whose sight reaches only `reach`: in to the nearest wall (the camera never sits behind
   * one), not nearer than NEAR to the body; a Soul pressed into a solid keeps a readable FOLLOW_MIN instead. */
  private fit(length:number,reach:number){return reach>=NEAR?Math.min(length,reach):Math.min(length,FOLLOW_MIN);}
  /** Only actual control input changes the preferred view. Use the two offsets
   * around that input event, so ground fitting and collision correction are not
   * mistaken for a zoom, even when the viewer drags while near a wall. */
  userInput(before:THREE.Vector3,after:THREE.Vector3){
    if(![...before.toArray(),...after.toArray()].every(Number.isFinite)||before.length()<.01||after.length()<.01||before.distanceTo(after)<1e-5)return;
    this.requested??=before.clone();
    const length=Math.max(FOLLOW_MIN,Math.min(FOLLOW_MAX,this.requested.length()*after.length()/before.length()));
    // The gesture chooses the displayed direction, including when a previous
    // collision search had moved it away from the old preferred direction.
    this.requested.copy(after).setLength(length);
    this.rendered=after.clone().setLength(this.requested.length());
    this.chosen=null;this.userAt=this.clock;this.userOrbited=true;
  }
  resolve(target:THREE.Vector3,actualOffset:THREE.Vector3,roots:readonly THREE.Object3D[],seconds:number):THREE.Vector3 {
    if(!actualOffset.toArray().every(Number.isFinite)||actualOffset.length()<.01)return actualOffset.clone();
    if(!this.requested||!this.rendered)this.requested=actualOffset.clone();
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
  private chosenClear=false;
  private clock=0;
  private previousTarget:THREE.Vector3|null=null;
  private velocity=new THREE.Vector3();
  private userAt=-Infinity;
  private userOrbited=false;
  /** True while the viewer is dragging/zooming (and a moment after): their view is shown as is. */
  get userActive(){return this.clock-this.userAt<USER_HOLD;}
  private clear(target:THREE.Vector3,offset:THREE.Vector3,roots:readonly THREE.Object3D[]){const need=offset.length()-.01;return this.limit(target,offset,roots,need)>=need;}
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
    // Hysteresis: the previous viewpoint, while it stays clear, is kept unless a clear candidate is clearly better.
    let best:THREE.Vector3|null=null,bestCost=Infinity;
    if(this.chosen&&this.clear(target,this.chosen,roots)){best=this.chosen;bestCost=cost(this.chosen)-.25;}
    for(const c of this.candidates(wanted)){const k=cost(c);if(k>=bestCost)continue;if(this.clear(target,c,roots)){best=c;bestCost=k;}}
    if(best)return best;
    // Nothing near the asked-for view is clear (a narrow room, a stair well, a Soul against walls): look all round,
    // low to high, for the view that sees farthest (to 5 m), the asked-for side preferred, and come in to its nearest
    // wall (fit). Kept by the hysteresis above while it stays clear, so this wide look runs once per change.
    const s=new THREE.Spherical().setFromVector3(wanted);let open:THREE.Vector3=wanted,score=-Infinity;
    for(let i=0;i<12;i++)for(const phi of [s.phi,1.3,.85,.4]){
      const c=new THREE.Vector3().setFromSpherical(new THREE.Spherical(s.radius,Math.max(.15,Math.min(Math.PI*.48,phi)),s.theta+i*Math.PI/6));
      const v=Math.min(5,this.limit(target,c,roots,-Infinity,true))-.4*want.angleTo(c.clone().normalize());if(v>score){score=v;open=c;}}
    return open.clone().setLength(this.fit(open.length(),this.limit(target,open,roots)));
  }
  /** QA2 F11: come in through an opening (throughOpening), measured at the asked-for length every .2 s (so the
   * pulled-in camera does not stop seeing the wall and swing back out), gliding in quickly and holding there. */
  private inOpening(target:THREE.Vector3,dt:number):THREE.Vector3{
    const r=this.rendered!;
    if(!this.opening||this.clock-this.opening.at>=.2){
      const asked=r.clone().setLength(Math.max(r.length(),this.chosen?.length()??0,this.requested?.length()??0));
      this.opening={at:this.clock,cap:this.throughOpening(target,asked)};
    }
    const cap=this.opening.cap;
    if(cap===Infinity){this.pulled=null;return r;}
    // the glide outward (toward the asked-for length) keeps pushing; the pulled length moves only inward, to the cap
    const from=Math.min(r.length(),this.pulled??Infinity);
    this.pulled=from<=cap?from:dt>0?from-Math.min((from-cap)*-Math.expm1(-dt/.18),8*dt):cap;  // quick, never a jump (<= 8 m/s)
    r.setLength(Math.min(r.length(),Math.max(this.pulled,cap)));
    return r;
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
      this.rendered.setLength(this.fit(this.rendered.length(),reach));
      return this.inOpening(target,dt).clone();
    }
    // Search again every .2 s, or at once when a clear viewpoint is cut (one with no clear view waits for the next search).
    if(!this.chosen||this.clock-this.lastSearch>=.2||this.chosenClear&&!this.clear(target,this.chosen,roots)){
      this.chosen=this.choose(target,wanted,roots).clone();this.lastSearch=this.clock;this.chosenClear=this.clear(target,this.chosen,roots);}
    const goal=this.chosen;
    if(!this.rendered)this.rendered=goal.clone();
    else{
      // Glide on the sphere around the Soul (around obstacles, not through them); hurry, never jump, when blocked.
      const blocked=!this.clear(target,this.rendered,roots),k=(tau:number)=>-Math.expm1(-dt/tau);
      const a=new THREE.Spherical().setFromVector3(this.rendered),b=new THREE.Spherical().setFromVector3(goal);
      let dTheta=b.theta-a.theta;dTheta=Math.atan2(Math.sin(dTheta),Math.cos(dTheta));
      a.theta+=dTheta*k(blocked?.35:.9);a.phi+=(b.phi-a.phi)*k(blocked?.35:.9);a.radius+=(b.radius-a.radius)*k(blocked?.3:1.2);
      this.rendered.setFromSpherical(a);
      // A glide that would carry a clear camera out through a wall (growing the radius in a narrow room before it
      // turns) stops at the wall instead. Only a small correction: a house that suddenly cuts the sight is left to
      // the hurried glide above, never a jump.
      if(!blocked){const length=this.rendered.length(),fitted=this.fit(length,this.limit(target,this.rendered,roots));
        if(fitted<length&&length-fitted<=.2)this.rendered.setLength(fitted);}
    }
    return this.inOpening(target,dt).clone();
  }
}
