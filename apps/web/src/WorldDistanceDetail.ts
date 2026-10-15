import * as THREE from 'three';
import type {DistanceDetailOptions} from './quality-tier.ts';
/** Lane phones (V4): lower detail at a distance, for the phone quality tier.
 *
 * A phone shows the same world in a 390-pixel-wide window. Much of what the desktop view draws is, on that screen,
 * smaller than a pixel or two: cups on far tables, distant plants, fence posts across the lake. Each still costs a draw
 * call (and another in the shadow pass) on a GPU and CPU several times slower than a laptop's. Two render-time rules:
 *  - a mesh whose bounding sphere projects to less than `minRadiusPx` CSS pixels of radius is not drawn this frame;
 *  - a small shadow caster beyond `shadowNear + shadowPerMetre·radius` metres does not cast (as WorldShadowDetail does
 *    for the Eden expansion on every tier).
 * Like WorldShadowDetail it is render-time only: `apply` runs just before renderer.render and `restore` right after,
 * so scene state, picking, tests and the static batches' change checks never see a hidden mesh. Skinned bodies, lines,
 * points, sprites and anything with frustum culling turned off (sky, horizon, overlays) are never touched; bodies far
 * away are WorldFarStandIns' job. The candidate list is rescanned every `rescanFrames` frames. */
type Candidate={mesh:THREE.Mesh;centre:THREE.Vector3;radius:number};
export class WorldDistanceDetail{
 private candidates:Candidate[]=[];private frame=0;private hidden:THREE.Mesh[]=[];private noShadow:THREE.Mesh[]=[];
 private world=new THREE.Vector3();private sphere=new THREE.Sphere();
 /** Last apply(): meshes not drawn, casters skipped, candidates considered, CPU ms. */
 readonly stats={culled:0,shadowSkipped:0,candidates:0,cpuMs:0};
 private o:DistanceDetailOptions;
 constructor(o:DistanceDetailOptions){this.o=o;}
 private scan(root:THREE.Object3D){
  this.candidates=[];
  root.traverse(obj=>{
   const m=obj as THREE.Mesh;
   if(!m.isMesh||(m as THREE.SkinnedMesh).isSkinnedMesh||!m.frustumCulled||m.userData.keepDetail)return;
   const im=m as THREE.InstancedMesh;
   if(im.isInstancedMesh){if(!im.boundingSphere)im.computeBoundingSphere();if(!im.boundingSphere)return;this.sphere.copy(im.boundingSphere);}
   else{const g=m.geometry;if(!g)return;if(!g.boundingSphere)g.computeBoundingSphere();if(!g.boundingSphere||!Number.isFinite(g.boundingSphere.radius))return;this.sphere.copy(g.boundingSphere);}
   this.candidates.push({mesh:m,centre:this.sphere.center.clone(),radius:this.sphere.radius});
  });
 }
 /** Call right before renderer.render. `viewHeight` is the canvas height in CSS pixels. */
 apply(root:THREE.Object3D,camera:THREE.PerspectiveCamera,viewHeight:number){
  const t0=performance.now();
  if(this.frame++%this.o.rescanFrames===0)this.scan(root);
  let culled=0,skipped=0;const cam=camera.position,pxPerUnit=viewHeight/(2*Math.tan(camera.fov*Math.PI/360))*(camera.zoom||1);
  for(const c of this.candidates){
   const m=c.mesh;if(!m.visible)continue;
   const e=m.matrixWorld.elements,scale=Math.sqrt(Math.max(e[0]*e[0]+e[1]*e[1]+e[2]*e[2],e[4]*e[4]+e[5]*e[5]+e[6]*e[6],e[8]*e[8]+e[9]*e[9]+e[10]*e[10]));
   const r=c.radius*scale,w=this.world.copy(c.centre).applyMatrix4(m.matrixWorld),d=w.distanceTo(cam)-r;
   if(d<=0)continue;
   if(r*pxPerUnit/d<this.o.minRadiusPx){m.visible=false;this.hidden.push(m);culled++;continue;}
   if(m.castShadow&&r<this.o.shadowMaxRadius&&d>this.o.shadowNear+this.o.shadowPerMetre*r){m.castShadow=false;this.noShadow.push(m);skipped++;}
  }
  this.stats.culled=culled;this.stats.shadowSkipped=skipped;this.stats.candidates=this.candidates.length;this.stats.cpuMs=performance.now()-t0;
 }
 /** Call right after renderer.render. */
 restore(){for(const m of this.hidden)m.visible=true;for(const m of this.noShadow)m.castShadow=true;this.hidden.length=0;this.noShadow.length=0;}
 dispose(){this.restore();this.candidates=[];}
}
