import * as THREE from 'three';
import {EDEN_VIEWER_PLACES,type ViewerPlace} from './WorldEdenPlaceData.ts';
/** Visible activity at scheduled places (world clock): lanterns and a warm ground
 * glow while a slot is on, with kind-specific extras — stove flames while cooking,
 * a roaring campfire with sparks for the evening fire, a stage light for the open
 * mic and the sunset show. Fades in/out over a few world minutes. Presentation only. */
export type ActiveSlot={place:ViewerPlace;slotId:string;label:string;strength:number};
const FADE_MIN=4;
const minutesOfDay=(iso:string)=>{const m=/T(\d\d):(\d\d)(?::(\d\d(?:\.\d+)?))?/.exec(iso);return m?Number(m[1])*60+Number(m[2])+(m[3]?Number(m[3])/60:0):null;};
/** Which daily `M H * * *` slots are on at this world time, with a 0..1 fade. */
export function activeSlots(iso:string|null,places:readonly ViewerPlace[]=EDEN_VIEWER_PLACES):ActiveSlot[]{
 const now=iso?minutesOfDay(iso):null;if(now===null)return [];const out:ActiveSlot[]=[];
 for(const place of places)for(const s of place.schedule??[]){const m=/^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(s.cron);if(!m)continue;
  const start=Number(m[2])*60+Number(m[1]),end=start+s.durationMinutes;let t=now;if(t<start-FADE_MIN)t+=1440;
  if(t<start-FADE_MIN||t>end+FADE_MIN)continue;const strength=Math.max(0,Math.min(1,(t-(start-FADE_MIN))/FADE_MIN,(end+FADE_MIN-t)/FADE_MIN));
  if(strength>0)out.push({place,slotId:s.id,label:s.label,strength});}
 return out;
}
const centroid=(p:ViewerPlace)=>{const n=p.polygon.length;return p.polygon.reduce(([x,z],[a,b])=>[x+a/n,z+b/n],[0,0]);};
const extent=(p:ViewerPlace)=>{const xs=p.polygon.map(v=>v[0]),zs=p.polygon.map(v=>v[1]);return Math.min(Math.max(...xs)-Math.min(...xs),Math.max(...zs)-Math.min(...zs));};
/** Kind of extra effect for a slot ('none': the night's sleep has no light show). */
export function effectOf(slotId:string):'stove'|'bonfire'|'stage'|'lanterns'|'none'{return /^sleep/.test(slotId)?'none':/^cook/.test(slotId)?'stove':/evening-fire/.test(slotId)?'bonfire':/open-mic|sunset-show|bandstand/.test(slotId)?'stage':'lanterns';}
type Rig={group:THREE.Group;lanterns:THREE.InstancedMesh;glow:THREE.Mesh;flames?:THREE.InstancedMesh;cone?:THREE.Mesh;sparks?:THREE.Points;count:number;centre:[number,number]};
export class WorldPlaceActivity{
 readonly group=new THREE.Group();
 private rigs=new Map<string,Rig>();
 private lanternGeometry=new THREE.SphereGeometry(.13,8,6);
 private lanternMaterial=new THREE.MeshStandardMaterial({color:'#fff3d6',emissive:'#ffc46b',emissiveIntensity:1.6,roughness:.4});
 /** Soft radial falloff (no DOM needed): bright centre fading smoothly to nothing at the rim. */
 private glowTexture=(()=>{const n=64,d=new Uint8Array(n*n*4);for(let j=0;j<n;j++)for(let i=0;i<n;i++){const x=(i+.5)/n*2-1,y=(j+.5)/n*2-1,r=Math.min(1,Math.hypot(x,y)),a=Math.pow(1-r,2.2);d.set([255,255,255,Math.round(255*a)],(j*n+i)*4);}const t=new THREE.DataTexture(d,n,n,THREE.RGBAFormat);t.magFilter=t.minFilter=THREE.LinearFilter;t.needsUpdate=true;return t;})();
 private glowMaterial=new THREE.MeshBasicMaterial({color:'#ffb85c',map:this.glowTexture,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending});
 private flameGeometry=new THREE.ConeGeometry(.16,.55,7);
 private flameMaterial=new THREE.MeshBasicMaterial({color:'#ffa03a',transparent:true,depthWrite:false,blending:THREE.AdditiveBlending});
 private coneMaterial=new THREE.MeshBasicMaterial({color:'#fff1c2',transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide});
 private sparkMaterial=new THREE.PointsMaterial({color:'#ffcf7a',size:.09,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending});
 private disposables:(THREE.BufferGeometry|THREE.Material|THREE.Texture)[]=[this.glowTexture,this.lanternGeometry,this.lanternMaterial,this.glowMaterial,this.flameGeometry,this.flameMaterial,this.coneMaterial,this.sparkMaterial];
 private m=new THREE.Matrix4();
 constructor(){this.group.name='place-activity';}
 private rig(slot:ActiveSlot):Rig{const key=slot.place.id+'|'+slot.slotId;let r=this.rigs.get(key);if(r)return r;
  const [cx,cz]=centroid(slot.place),radius=Math.max(1.6,Math.min(6,extent(slot.place)/2)),y0=slot.place.level*3,count=Math.max(6,Math.min(18,Math.round(radius*3)));
  const group=new THREE.Group();group.position.set(cx,y0,cz);group.name='activity:'+key;
  const lanterns=new THREE.InstancedMesh(this.lanternGeometry,this.lanternMaterial,count);lanterns.userData.cameraTransparent=true;
  for(let i=0;i<count;i++){const a=i/count*Math.PI*2;lanterns.setMatrixAt(i,this.m.makeTranslation(Math.cos(a)*radius,2.3+.18*Math.sin(a*3),Math.sin(a)*radius));}
  lanterns.instanceMatrix.needsUpdate=true;lanterns.computeBoundingSphere();group.add(lanterns);
  const glowGeometry=new THREE.PlaneGeometry(radius*2.8,radius*2.8).rotateX(-Math.PI/2);this.disposables.push(glowGeometry);
  const glow=new THREE.Mesh(glowGeometry,this.glowMaterial.clone());glow.position.y=.04;glow.renderOrder=2;this.disposables.push(glow.material as THREE.Material);group.add(glow);
  r={group,lanterns,glow,count,centre:[cx,cz]};const kind=effectOf(slot.slotId);
  if(kind==='stove'||kind==='bonfire'){const n=kind==='bonfire'?9:4,flames=new THREE.InstancedMesh(this.flameGeometry,this.flameMaterial,n);flames.userData.cameraTransparent=true;
   for(let i=0;i<n;i++){const a=i/n*Math.PI*2,rr=kind==='bonfire'?.35:3.2;flames.setMatrixAt(i,this.m.makeTranslation(Math.cos(a)*rr*(kind==='stove'?1:1),kind==='bonfire'?.4:.95,Math.sin(a)*rr*(kind==='stove'?.15:1)));}
   flames.instanceMatrix.needsUpdate=true;flames.computeBoundingSphere();group.add(flames);r.flames=flames;
   if(kind==='bonfire'){const pts=new Float32Array(60*3);for(let i=0;i<60;i++)pts.set([(Math.random()-.5)*.8,Math.random()*3,(Math.random()-.5)*.8],i*3);const g=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(pts,3));this.disposables.push(g);r.sparks=new THREE.Points(g,this.sparkMaterial);group.add(r.sparks);}}
  if(kind==='stage'){const g=new THREE.ConeGeometry(radius*.55,5,24,1,true).translate(0,2.5,0);this.disposables.push(g);const cone=new THREE.Mesh(g,this.coneMaterial.clone());this.disposables.push(cone.material as THREE.Material);cone.renderOrder=3;group.add(cone);r.cone=cone;}
  this.group.add(group);this.rigs.set(key,r);return r;}
 /** iso: shown world datetime; seconds: animation clock; night 0..1 (brighter after dark). */
 update(iso:string|null,seconds:number,night:number,enabled:boolean){
  const slots=enabled?activeSlots(iso):[],live=new Set<string>();
  for(const slot of slots){if(effectOf(slot.slotId)==='none')continue;const key=slot.place.id+'|'+slot.slotId;live.add(key);const r=this.rig(slot),s=slot.strength,bright=.45+.55*night;
   r.group.visible=true;r.lanterns.visible=true;r.lanterns.scale.setScalar(Math.max(.001,s));
   (r.glow.material as THREE.MeshBasicMaterial).opacity=.55*s*bright;
   if(r.flames){r.flames.visible=true;const f=1+.18*Math.sin(seconds*13)+.1*Math.sin(seconds*21.7);r.flames.scale.set(1,s*f,1);(r.flames.material as THREE.MeshBasicMaterial).opacity=.85*s;}
   if(r.sparks){r.sparks.visible=true;const pos=r.sparks.geometry.attributes.position as THREE.BufferAttribute;for(let i=0;i<pos.count;i++){let y=pos.getY(i)+.02+.01*((i*7)%3);if(y>3.2)y=0;pos.setY(i,y);}pos.needsUpdate=true;this.sparkMaterial.opacity=.9*s*bright;}
   if(r.cone)(r.cone.material as THREE.MeshBasicMaterial).opacity=.08*s*(.4+.6*night);}
  for(const [key,r] of this.rigs)if(!live.has(key))r.group.visible=false;
  this.lanternMaterial.emissiveIntensity=.8+1.2*night;
 }
 dispose(){this.group.removeFromParent();for(const r of this.rigs.values())r.group.clear();for(const d of this.disposables)d.dispose();this.group.clear();this.rigs.clear();}
}
