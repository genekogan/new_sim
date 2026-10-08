import * as THREE from 'three';
/** Shadow-pass hygiene for the Eden expansion (perf, after the 2400 m far plane and WN4–WN8).
 *
 * The sun's shadow camera covers the whole inhabited rectangle (~310 m square, 2048² map = ~15 cm texels), so every
 * expansion shadow caster is drawn again in the shadow pass on every frame, wherever the camera looks: ~560 extra
 * draws and ~650k triangles. Two cases add cost without a visible shadow:
 *  - thin plant stems (fern, flower and herb "curved stems"): about 1 cm wide, far below one shadow texel; their
 *    leaf blades keep casting, so clumps still darken the ground. ~267k shadow triangles.
 *  - small casters far from the camera: a chair's shadow 60 m away is a few pixels. A caster of bounding radius r
 *    stops casting beyond `near + perMetre·r` metres (defaults: 40 m + 25 m per metre of radius, so a 0.5 m chair at
 *    52 m, a 2 m bench group at 90 m, a 5 m shed at 165 m); anything of radius ≥ maxRadius always casts.
 * Render-time only: castShadow is turned off just before renderer.render and restored right after, so scene state,
 * tests, raycasts and other systems never see the change. The caster list is rescanned every `rescanFrames` frames
 * (fixtures that appear later are picked up). */
export type ShadowDetailOptions={near:number;perMetre:number;maxRadius:number;rescanFrames:number};
export const SHADOW_DETAIL:ShadowDetailOptions=Object.freeze({near:40,perMetre:25,maxRadius:8,rescanFrames:120});
const SUB_TEXEL=/curved stems/;
type Caster={mesh:THREE.Mesh;centre:THREE.Vector3;radius:number;subTexel:boolean};
export class WorldShadowDetail{
 private casters:Caster[]=[];private frame=0;private off:THREE.Mesh[]=[];private tmp=new THREE.Vector3();private sphere=new THREE.Sphere();
 /** Last apply(): how many casters were skipped (tests, perf readouts). */
 skipped=0;
 private root:THREE.Object3D;private o:ShadowDetailOptions;
 constructor(root:THREE.Object3D,o:ShadowDetailOptions=SHADOW_DETAIL){this.root=root;this.o=o;}
 private scan(){
  this.casters=[];this.root.updateWorldMatrix(true,true);
  this.root.traverse(obj=>{const m=obj as THREE.Mesh;if(!m.isMesh||!m.castShadow)return;const g=m.geometry;if(!g.boundingSphere)g.computeBoundingSphere();if(!g.boundingSphere)return;
   const im=m as THREE.InstancedMesh;if(im.isInstancedMesh){im.computeBoundingSphere();this.sphere.copy(im.boundingSphere!);}else this.sphere.copy(g.boundingSphere);
   this.sphere.applyMatrix4(m.matrixWorld);
   this.casters.push({mesh:m,centre:this.sphere.center.clone(),radius:this.sphere.radius,subTexel:SUB_TEXEL.test(m.name)});});
 }
 /** Call right before renderer.render with the camera position. */
 apply(camera:THREE.Vector3){
  if(this.frame++%this.o.rescanFrames===0)this.scan();
  this.skipped=0;
  for(const c of this.casters){const m=c.mesh;if(!m.castShadow)continue;
   let skip=c.subTexel;
   if(!skip&&c.radius<this.o.maxRadius){const d=this.tmp.copy(c.centre).distanceTo(camera)-c.radius;skip=d>this.o.near+this.o.perMetre*c.radius;}
   if(skip){m.castShadow=false;this.off.push(m);this.skipped++;}}
 }
 /** Call right after renderer.render. */
 restore(){for(const m of this.off)m.castShadow=true;this.off.length=0;}
 dispose(){this.restore();this.casters=[];}
}
