import * as THREE from 'three';
/** God-built rainbow things (Gene 2026-10-24: "rainbows must be temporary after rainstorms"). A thing whose def is named
 *  or tagged `rainbow` (eden-2026's e_a9151176, 222 m of kit tori, used to stand all day and all night) is built hidden
 *  by the entity layer and shown only at the sky bow's post-rain strength (WorldAtmosphere), fading with it.
 *  Matches `rainbow`, `double-rainbow`, `sky-rainbows` or the tag; not `rainbow-trout`. */
export const isRainbowDef=(def:{name:string;tags:readonly string[]})=>def.tags.includes('rainbow')||/(^|-)rainbows?$/i.test(def.name);
/** Entity layer: mark a freshly built rainbow thing and keep it hidden until the atmosphere shows it. */
export function holdRainbow(o:THREE.Object3D){o.userData.edenRainbow=true;o.traverse(c=>{if((c as THREE.Mesh).isMesh)c.visible=false;});}
type Part={mesh:THREE.Mesh;mats:THREE.Material[];base:number[]};
export class RainbowThings{
 private parts:Part[]=[];private shown=-1;
 count=0;strength=0;
 /** Periodic scan: the rainbow things now in the scene (own material copies, so the fade touches no shared kit material). */
 scan(scene:THREE.Object3D){
  const parts:Part[]=[];let n=0;
  scene.traverse(o=>{if(!o.userData?.edenRainbow)return;n++;o.traverse(c=>{const mesh=c as THREE.Mesh;if(!mesh.isMesh)return;
   let part=c.userData.edenRainbowPart as Part|undefined;
   if(!part){const mats=([] as THREE.Material[]).concat(mesh.material).map(m=>m.clone());for(const m of mats){m.transparent=true;m.depthWrite=false;}
    part={mesh,mats,base:mats.map(m=>m.opacity)};mesh.material=Array.isArray(mesh.material)?mats:mats[0];mesh.castShadow=false;c.userData.edenRainbowPart=part;}
   parts.push(part);});});
  this.parts=parts;this.count=n;this.shown=-1;this.apply(this.strength);
 }
 /** Each frame, 0..1 (0 hides them). */
 apply(k:number){
  this.strength=k;if(this.shown>=0&&Math.abs(k-this.shown)<.002&&(k>0)===(this.shown>0))return;this.shown=k;
  for(const p of this.parts){p.mesh.visible=k>0;p.mats.forEach((m,i)=>{m.opacity=p.base[i]*k;});}
 }
}
