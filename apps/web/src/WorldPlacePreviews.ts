import {cdnRoute} from './cdn-assets.ts';
import * as THREE from 'three';
import type {WorldLocation} from './WorldLocations.ts';
import {worldPlaceView,type WorldPlaceId} from './WorldPlaces.ts';
const PREVIEW_OWNERS:Readonly<Record<string,string>>={gallery:'eden-library-1',library:'eden-library-1',libraryroom:'eden-library-1','int-library':'eden-library-1',roofseating:'eden-house-3','int-house-3-kitchen':'eden-house-3','int-house-3-living':'eden-house-3','int-house-2':'eden-house-2','int-office-studio':'eden-office-1','int-office-upper-lounge':'eden-office-1','int-office-post-room':'eden-office-1',market:'eden-market-1','int-barn-workshop':'eden-barn-1'};
/** Fit the selected geometry in camera space, including its depth, rather than using a tour distance. */
export function fitPlacePreviewCamera(box:THREE.Box3,direction:THREE.Vector3,aspect=160/112){
 const aim=box.getCenter(new THREE.Vector3()),camera=new THREE.PerspectiveCamera(38,aspect,.01,10000),view=direction.clone().normalize();
 if(view.lengthSq()<.5)view.set(1,.6,1).normalize();
 camera.position.copy(aim).add(view);camera.lookAt(aim);const inverse=camera.quaternion.clone().invert(),vertical=Math.tan(camera.fov*Math.PI/360),horizontal=vertical*aspect;let distance=.1;
 for(const x of[box.min.x,box.max.x])for(const y of[box.min.y,box.max.y])for(const z of[box.min.z,box.max.z]){const p=new THREE.Vector3(x,y,z).sub(aim).applyQuaternion(inverse);distance=Math.max(distance,p.z+Math.abs(p.x)/(horizontal*.88),p.z+Math.abs(p.y)/(vertical*.88));}
 camera.position.copy(aim).addScaledVector(view,distance);camera.lookAt(aim);camera.updateMatrixWorld(true);return camera;
}
/** Transparent thumbnails of the actual authored mesh data, using the world's existing renderer.
 * Work runs only for visible Explore cards, caches at most24 images and never loads a second model. An empty capture
 * (the place not drawn yet, e.g. a god world still streaming its things in) is not cached: the next opening retries. */
export class WorldPlacePreviews{
 private images=new Map<string,string|null>();private pending=new Map<string,Promise<string|null>>();private closed=false;private revision=0;private tail:Promise<unknown>=Promise.resolve();
 private renderer:THREE.WebGLRenderer;private live:()=>THREE.Scene|null;private roots:()=>readonly THREE.Object3D[];
 constructor(renderer:THREE.WebGLRenderer,roots:()=>readonly THREE.Object3D[],live:()=>THREE.Scene|null=()=>null){this.renderer=renderer;this.roots=roots;this.live=live;}
 capture(id:WorldPlaceId):Promise<string|null>{return this.request(id,()=>this.render(id,id));}
 captureLocation(location:WorldLocation,sceneKey:string):Promise<string|null>{const key=sceneKey+':'+location.id;return this.request(key,()=>this.render(location.id,key,location));}
 invalidate(){this.revision++;this.images.clear();this.pending.clear();}
 private request(key:string,render:()=>Promise<string|null>):Promise<string|null>{
  if(this.closed)return Promise.resolve(null);if(this.images.has(key))return Promise.resolve(this.images.get(key)!);const pending=this.pending.get(key);if(pending)return pending;const revision=this.revision;
  const job=this.tail.then(()=>new Promise<void>(resolve=>setTimeout(resolve,0))).then(()=>this.closed||revision!==this.revision?null:render()).catch(()=>null).then(image=>{if(this.closed||revision!==this.revision)return null;this.pending.delete(key);if(image)this.images.set(key,image);if(this.images.size>24)this.images.delete(this.images.keys().next().value!);return image;});this.pending.set(key,job);this.tail=job;return job;
 }
 private async render(id:string,key:string,location?:WorldLocation):Promise<string|null>{
  const served=await cdnRoute(placeShotPath(key)).catch(()=>null);if(served)return served.url;  // published per build by the release (perf owns CDN): every visitor sees the same picture
  const kept=readKept(key);if(kept)return kept;
  const view=location??worldPlaceView(id as WorldPlaceId);if(this.closed||!view)return null;
  const center=new THREE.Vector3().fromArray(view.target),radius=location?Math.min(100,location.radius):Math.min(35,Math.max(8,new THREE.Vector3().fromArray(view.p).distanceTo(center)*.28));
  const scene=new THREE.Scene(),geometries:THREE.BufferGeometry[]=[],instances:THREE.InstancedMesh[]=[],materials=new Map<THREE.Material,THREE.Material>(),target=new THREE.WebGLRenderTarget(160,112,{depthBuffer:true});target.texture.colorSpace=THREE.SRGBColorSpace;
  const material=(original:THREE.Material)=>{let m=materials.get(original);if(!m){m=original.clone();materials.set(original,m);}return m;};
  const point=new THREE.Vector3(),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),matrix=new THREE.Matrix4();let triangles=0,visited=0;const worldBox=new THREE.Box3(),regionBox=new THREE.Box3(new THREE.Vector3(center.x-radius,-10000,center.z-radius),new THREE.Vector3(center.x+radius,10000,center.z+radius));
  try{
   const roots=this.roots(),owner=PREVIEW_OWNERS[id],selected=owner?roots.flatMap(root=>{const found=root.getObjectByName(owner);return found?[found]:[];}):roots;
   for(const root of selected){root.updateWorldMatrix(true,true);root.traverse(object=>{
    for(let parent:THREE.Object3D|null=object;parent&&parent!==root;parent=parent.parent)if(!parent.visible)return;
    if(!(object instanceof THREE.Mesh)||object instanceof THREE.SkinnedMesh||Array.isArray(object.material)||/terrain|ground|outside|sea|water|shore|rain|sky|cloud|marker|ring|label/i.test(object.name.startsWith('instances:')?'':object.name))return;  // a god thing's instanced parts are named by their def and palette ("water":…): always the thing itself
    const geometry=object.geometry,position=geometry.getAttribute('position');if(!position||triangles>24000||visited>=120000)return;
    if(!(object instanceof THREE.InstancedMesh)){if(!geometry.boundingBox)geometry.computeBoundingBox();if(geometry.boundingBox&&!worldBox.copy(geometry.boundingBox).applyMatrix4(object.matrixWorld).intersectsBox(regionBox))return;}
    if(object instanceof THREE.InstancedMesh){const selected:number[]=[];for(let i=0;i<object.count;i++){object.getMatrixAt(i,matrix);matrix.premultiply(object.matrixWorld);point.setFromMatrixPosition(matrix);if(Math.hypot(point.x-center.x,point.z-center.z)<=radius)selected.push(i);}if(!selected.length)return;const mesh=new THREE.InstancedMesh(geometry,material(object.material),selected.length),color=new THREE.Color();instances.push(mesh);selected.forEach((source,i)=>{object.getMatrixAt(source,matrix);matrix.premultiply(object.matrixWorld);mesh.setMatrixAt(i,matrix);if(object.instanceColor){object.getColorAt(source,color);mesh.setColorAt(i,color);}});mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;scene.add(mesh);return;}
    const indices=geometry.index,vertices:number[]=[],normals:number[]=[],colors:number[]=[],uvs:number[]=[],normal=geometry.getAttribute('normal'),color=geometry.getAttribute('color'),uv=geometry.getAttribute('uv'),count=indices?.count??position.count;
    for(let i=0;i<count&&visited<120000;i+=3){visited++;const ia=indices?indices.getX(i):i,ib=indices?indices.getX(i+1):i+1,ic=indices?indices.getX(i+2):i+2;
     a.fromBufferAttribute(position,ia).applyMatrix4(object.matrixWorld);b.fromBufferAttribute(position,ib).applyMatrix4(object.matrixWorld);c.fromBufferAttribute(position,ic).applyMatrix4(object.matrixWorld);
     if(Math.hypot(a.x-center.x,a.z-center.z)>radius||Math.hypot(b.x-center.x,b.z-center.z)>radius||Math.hypot(c.x-center.x,c.z-center.z)>radius)continue;
     for(const j of[ia,ib,ic]){vertices.push(position.getX(j),position.getY(j),position.getZ(j));if(normal)normals.push(normal.getX(j),normal.getY(j),normal.getZ(j));if(color)colors.push(color.getX(j),color.getY(j),color.getZ(j));if(uv)uvs.push(uv.getX(j),uv.getY(j));}triangles++;if(triangles>24000)break;
    }
    if(!vertices.length)return;const sliced=new THREE.BufferGeometry();geometries.push(sliced);sliced.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));if(normals.length)sliced.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));else sliced.computeVertexNormals();if(colors.length)sliced.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));if(uvs.length)sliced.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));const mesh=new THREE.Mesh(sliced,material(object.material));mesh.matrixAutoUpdate=false;mesh.matrix.copy(object.matrixWorld);mesh.matrixWorldNeedsUpdate=true;scene.add(mesh);
   });}
   const bare=!scene.children.length;if(bare&&!this.live())return null;  // nothing of the place drawn: with a live world it is still pictured (a lake that is only water), never kept
   scene.updateMatrixWorld(true);
   const shot=this.shoot(scene,center,radius,view.p,key);if(shot&&!bare)keep(key,shot);return shot;
  }finally{target.dispose();for(const mesh of instances)mesh.dispose();for(const g of geometries)g.dispose();for(const m of materials.values())m.dispose();scene.clear();}
 }
 /** Gene 2026-10-23 (#13): a full photogenic shot of the place in the real world (terrain, water, sky, neighbours), not a
  * cut-out of its assets. Rule: frame the place's geometry plus its region at a 35° elevated 3/4 view from its tour side;
  * occlusion check: draw the place alone (white), then the world in black with the place on top, and count how much of the
  * place stays visible; above 40 % hidden, turn 45° and retry, keeping the clearest of the 8 views. */
 private shoot(mask:THREE.Scene,center:THREE.Vector3,radius:number,from:readonly number[],key:string):string|null{
  const world=this.live(),live=world??mask;  // no live world (tests, a bare viewer): the place's own geometry
  const t0=performance.now(),bare=!mask.children.length,box=new THREE.Box3().setFromObject(mask),r=world?radius*.8:0,extent=r<=0?box.clone():box.clone().union(new THREE.Box3(new THREE.Vector3(center.x-r,center.y,center.z-r),new THREE.Vector3(center.x+r,center.y,center.z+r))),aim=extent.getCenter(new THREE.Vector3());
  const az0=Math.atan2(from[0]-aim.x,from[2]-aim.z),el=35*Math.PI/180,W=SHOT_W,H=SHOT_H,CW=80,CH=56;
  const renderer=this.renderer,previous=renderer.getRenderTarget(),viewport=renderer.getViewport(new THREE.Vector4()),scissor=renderer.getScissor(new THREE.Vector4()),scissorTest=renderer.getScissorTest(),clear=renderer.getClearColor(new THREE.Color()),alpha=renderer.getClearAlpha(),autoClear=renderer.autoClear;
  const white=new THREE.MeshBasicMaterial({color:0xffffff,fog:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-8}),black=new THREE.MeshBasicMaterial({color:0,fog:false});
  const check=new THREE.WebGLRenderTarget(CW,CH,{depthBuffer:true}),target=new THREE.WebGLRenderTarget(W,H,{depthBuffer:true});target.texture.colorSpace=THREE.SRGBColorSpace;
  const small=new Uint8Array(CW*CH*4),count=()=>{renderer.readRenderTargetPixels(check,0,0,CW,CH,small);let n=0;for(let i=0;i<small.length;i+=4)if(small[i]>127)n++;return n;};
  const hidden:THREE.Object3D[]=[],seeThrough:THREE.Object3D[]=[];live.traverse(o=>{if(!o.visible)return;if(/marker|label/i.test(o.name)){o.visible=false;hidden.push(o);}else if(/water|sea|sky|cloud|rain|fog/i.test(o.name))seeThrough.push(o);});
  const background=live.background,override=live.overrideMaterial;
  try{
   renderer.setScissorTest(false);mask.overrideMaterial=white;let best:THREE.PerspectiveCamera|null=null,bestHidden=2,turn=0;
   for(let k=0;k<8&&bestHidden>.4;k++){
    const az=az0+k*Math.PI/4,camera=fitPlacePreviewCamera(extent,new THREE.Vector3(Math.sin(az)*Math.cos(el),Math.sin(el),Math.cos(az)*Math.cos(el)),W/H);
    const d=camera.position.distanceTo(aim);camera.near=Math.max(.05,d/400);camera.far=Math.max(3000,d*20);camera.updateProjectionMatrix();
    renderer.setRenderTarget(check);renderer.setClearColor(0,1);renderer.autoClear=true;renderer.render(mask,camera);const all=count();if(!all){if(bare){best=camera;bestHidden=0;break;}continue;}if(!world){best=camera;bestHidden=0;break;}
    for(const o of seeThrough)o.visible=false;live.background=null;live.overrideMaterial=black;
    try{renderer.render(live,camera);renderer.autoClear=false;renderer.render(mask,camera);}finally{for(const o of seeThrough)o.visible=true;live.background=background;live.overrideMaterial=override;renderer.autoClear=true;}
    const blocked=1-Math.min(1,count()/all);if(blocked<bestHidden){bestHidden=blocked;best=camera;turn=k;}
   }
   if(!best)return null;
   STATS.set(key,{turn,hidden:Math.round(bestHidden*100)/100,ms:Math.round(performance.now()-t0),bare});
   const pixels=new Uint8Array(W*H*4);renderer.setRenderTarget(target);renderer.setClearColor(clear,alpha);renderer.render(live,best);renderer.readRenderTargetPixels(target,0,0,W,H,pixels);
   const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;const ctx=canvas.getContext('2d');if(!ctx)return null;const image=ctx.createImageData(W,H);for(let y=0;y<H;y++)image.data.set(pixels.subarray((H-1-y)*W*4,(H-y)*W*4),y*W*4);ctx.putImageData(image,0,0);
   const webp=canvas.toDataURL('image/webp',.82);return webp.startsWith('data:image/webp')?webp:canvas.toDataURL('image/jpeg',.85);
  }finally{for(const o of hidden)o.visible=true;mask.overrideMaterial=null;renderer.setRenderTarget(previous);renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(scissorTest);renderer.setClearColor(clear,alpha);renderer.autoClear=autoClear;check.dispose();target.dispose();white.dispose();black.dispose();}
 }
 dispose(){this.closed=true;this.invalidate();}
}
declare const __BUILD__:string;
const BUILD=typeof __BUILD__==='string'?__BUILD__:'dev',SHOT_W=320,SHOT_H=224,KEPT='sim.placeShot.';
/** The last framing per place (turns of 45° from the tour side, share of the place hidden): read by the shot export script. */
export const STATS=new Map<string,{turn:number;hidden:number;ms:number;bare:boolean}>();
/** Where a release publishes a place's shot (world-scoped in the CDN manifest; the query pins the build). */
export function placeShotPath(key:string){return '/place-shots/'+encodeURIComponent(key.replace(/[^\w.:-]+/g,'_'))+'.webp?b='+encodeURIComponent(BUILD);}
/** Shots are kept per build in this browser, so a visitor renders each place once per release. */
function readKept(key:string):string|null{try{return localStorage.getItem(KEPT+BUILD+'.'+key);}catch{return null;}}
function keep(key:string,shot:string){try{localStorage.setItem(KEPT+BUILD+'.'+key,shot);}catch{try{for(let i=localStorage.length-1;i>=0;i--){const k=localStorage.key(i);if(k?.startsWith(KEPT)&&!k.startsWith(KEPT+BUILD+'.'))localStorage.removeItem(k);}localStorage.setItem(KEPT+BUILD+'.'+key,shot);}catch{/* full: the in-memory cache still holds it */}}}
if(typeof window!=='undefined')(window as unknown as {__placeShotStats?:typeof STATS}).__placeShotStats=STATS;
