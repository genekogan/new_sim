import {GRADE_A} from './atmosphere/grade.ts';
import * as THREE from 'three';
import type {WorldLocation} from './WorldLocations.ts';
import {worldPlaceView,type WorldPlaceId} from './WorldPlaces.ts';
const PREVIEW_OWNERS:Readonly<Record<string,string>>={gallery:'eden-library-1',library:'eden-library-1',libraryroom:'eden-library-1','int-library':'eden-library-1',roofseating:'eden-house-3','int-house-3-kitchen':'eden-house-3','int-house-3-living':'eden-house-3','int-house-2':'eden-house-2','int-office-studio':'eden-office-1','int-office-post-room':'eden-office-1',market:'eden-market-1','int-barn-workshop':'eden-barn-1'};
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
 private renderer:THREE.WebGLRenderer;private roots:()=>readonly THREE.Object3D[];
 constructor(renderer:THREE.WebGLRenderer,roots:()=>readonly THREE.Object3D[]){this.renderer=renderer;this.roots=roots;}
 capture(id:WorldPlaceId):Promise<string|null>{return this.request(id,()=>this.render(id));}
 captureLocation(location:WorldLocation,sceneKey:string):Promise<string|null>{return this.request(sceneKey+':'+location.id,()=>this.render(location.id,location));}
 invalidate(){this.revision++;this.images.clear();this.pending.clear();}
 private request(key:string,render:()=>string|null):Promise<string|null>{
  if(this.closed)return Promise.resolve(null);if(this.images.has(key))return Promise.resolve(this.images.get(key)!);const pending=this.pending.get(key);if(pending)return pending;const revision=this.revision;
  const job=this.tail.then(()=>new Promise<void>(resolve=>setTimeout(resolve,0))).then(()=>this.closed||revision!==this.revision?null:render()).catch(()=>null).then(image=>{if(this.closed||revision!==this.revision)return null;this.pending.delete(key);if(image)this.images.set(key,image);if(this.images.size>24)this.images.delete(this.images.keys().next().value!);return image;});this.pending.set(key,job);this.tail=job;return job;
 }
 private render(id:string,location?:WorldLocation):string|null{
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
   if(!scene.children.length)return null;
   scene.updateMatrixWorld(true);
   const box=new THREE.Box3().setFromObject(scene),direction=new THREE.Vector3().fromArray(view.p).sub(center);direction.y=Math.max(direction.length()*.45,Math.abs(direction.y));const camera=fitPlacePreviewCamera(box,direction);
   scene.add(new THREE.HemisphereLight(0xffffff,0x5a635b,2.5));const light=new THREE.DirectionalLight(0xffffff,2);light.position.copy(camera.position).add(new THREE.Vector3(0,5,0));scene.add(light);
   const renderer=this.renderer,previous=renderer.getRenderTarget(),viewport=renderer.getViewport(new THREE.Vector4()),scissor=renderer.getScissor(new THREE.Vector4()),scissorTest=renderer.getScissorTest(),clear=renderer.getClearColor(new THREE.Color()),alpha=renderer.getClearAlpha(),autoClear=renderer.autoClear,gradeStrength=GRADE_A.x;
   const pixels=new Uint8Array(160*112*4);
   try{GRADE_A.x=0;renderer.setRenderTarget(target);renderer.setScissorTest(false);renderer.setClearColor(0,0);renderer.autoClear=true;renderer.render(scene,camera);renderer.readRenderTargetPixels(target,0,0,160,112,pixels);}
   finally{renderer.setRenderTarget(previous);renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(scissorTest);renderer.setClearColor(clear,alpha);renderer.autoClear=autoClear;GRADE_A.x=gradeStrength;}
   const canvas=document.createElement('canvas');canvas.width=160;canvas.height=112;const ctx=canvas.getContext('2d');if(!ctx)return null;const image=ctx.createImageData(160,112);for(let y=0;y<112;y++)image.data.set(pixels.subarray((111-y)*160*4,(112-y)*160*4),y*160*4);ctx.putImageData(image,0,0);return canvas.toDataURL('image/png');
  }finally{target.dispose();for(const mesh of instances)mesh.dispose();for(const g of geometries)g.dispose();for(const m of materials.values())m.dispose();scene.clear();}
 }
 dispose(){this.closed=true;this.invalidate();}
}
