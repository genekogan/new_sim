import * as THREE from 'three';
export type WallFrame={id:string;buildingId:string;p:readonly[number,number,number];yaw:number;width:number;height:number;media:{kind:'image'|'video';url:string}};
/** Stable authored placement/assignment, not an inventory, upload or owner-control API. */
export const WALL_FRAME_MANIFEST:readonly WallFrame[]=Object.freeze([
 {id:'eden-library-colour-study',buildingId:'eden-library-1',p:[78.775,1.6,-7],yaw:-Math.PI/2,width:1.1,height:1.4,media:{kind:'image',url:new URL('./media/gallery-study.svg',import.meta.url).href}},
 {id:'eden-library-colour-loop',buildingId:'eden-library-1',p:[77.6,1.6,-10.775],yaw:0,width:1.55,height:.97,media:{kind:'video',url:new URL('./media/gallery-loop.mp4',import.meta.url).href}},
]);
export function validWallFrames(rows:readonly WallFrame[]){
 const ids=new Set<string>();return rows.length<=16&&rows.every(f=>{if(ids.has(f.id))return false;ids.add(f.id);return /^[a-z0-9-]{1,80}$/.test(f.id)&&typeof f.buildingId==='string'&&f.p.length===3&&f.p.every(Number.isFinite)&&Number.isFinite(f.yaw)&&Number.isFinite(f.width)&&f.width>.1&&f.width<=4&&Number.isFinite(f.height)&&f.height>.1&&f.height<=4&&(f.media.kind==='image'||f.media.kind==='video')&&typeof f.media.url==='string'&&!/[\r\n]/.test(f.media.url)&&(/^(?:https?:\/\/|\/)/.test(f.media.url)||f.media.kind==='image'&&/^data:image\/(?:svg\+xml|png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(f.media.url)&&f.media.url.length<=512000||typeof document==='undefined'&&f.media.url.startsWith('file:'));});
}
export function createWorldWallFrames(rows:readonly WallFrame[]=WALL_FRAME_MANIFEST){
 if(!validWallFrames(rows))throw new TypeError('Invalid authored wall frame manifest');
 const group=new THREE.Group();group.name='Eden authored wall gallery';group.userData.skipBuildingIdentity=true;
 const geometries:THREE.BufferGeometry[]=[],materials:THREE.Material[]=[],textures:THREE.Texture[]=[],videos:{video:HTMLVideoElement;mesh:THREE.Mesh;requesting:boolean;retryAt:number}[]=[];let closed=false;
 const cube=new THREE.BoxGeometry(1,1,1);geometries.push(cube);const surround=new THREE.MeshStandardMaterial({color:'#4e4033',roughness:.75}),screen=new THREE.MeshBasicMaterial({color:'#e7dfca',toneMapped:false});materials.push(surround,screen);
 const add=(owner:THREE.Group,x:number,y:number,w:number,h:number)=>{const mesh=new THREE.Mesh(cube,surround);mesh.position.set(x,y,-.025);mesh.scale.set(w,h,.055);owner.add(mesh);};
 function visibility(){if(typeof document!=='undefined'&&document.visibilityState==='hidden')for(const entry of videos)entry.video.pause();}
 const dispose=()=>{if(closed)return;closed=true;group.removeFromParent();if(typeof document!=='undefined')document.removeEventListener('visibilitychange',visibility);for(const v of videos){v.video.pause();v.video.removeAttribute('src');v.video.load();v.video.remove();}for(const t of textures)t.dispose();for(const m of materials)m.dispose();for(const g of geometries)g.dispose();group.clear();};
 try{for(const row of rows){
  const owner=new THREE.Group();owner.name='wall-frame:'+row.id;owner.position.fromArray(row.p);owner.rotation.y=row.yaw;owner.userData.frame=structuredClone(row);group.add(owner);
  for(const x of[-1,1])add(owner,x*(row.width/2+.035),0,.07,row.height+.14);for(const y of[-1,1])add(owner,0,y*(row.height/2+.035),row.width,.07);
  const geometry=new THREE.PlaneGeometry(row.width,row.height);geometries.push(geometry);const material=screen.clone();materials.push(material);const mesh=new THREE.Mesh(geometry,material);mesh.name='assigned-media:'+row.id;owner.add(mesh);
  if(typeof document==='undefined')continue;
  if(row.media.kind==='image'){const texture=new THREE.TextureLoader().load(row.media.url,t=>{if(closed)return;t.colorSpace=THREE.SRGBColorSpace;material.map=t;material.needsUpdate=true;});textures.push(texture);}
  else{const video=document.createElement('video');video.crossOrigin='anonymous';video.src=row.media.url;video.muted=true;video.loop=true;video.playsInline=true;video.preload='metadata';const texture=new THREE.VideoTexture(video);texture.colorSpace=THREE.SRGBColorSpace;textures.push(texture);material.map=texture;material.needsUpdate=true;videos.push({video,mesh,requesting:false,retryAt:0});}
 }}catch(error){dispose();throw error;}
 const frustum=new THREE.Frustum(),projection=new THREE.Matrix4(),position=new THREE.Vector3(),screenPosition=new THREE.Vector3(),normal=new THREE.Vector3(),offset=new THREE.Vector3();let hidden=true;
 if(typeof document!=='undefined')document.addEventListener('visibilitychange',visibility);
 return{group,manifest:rows,update(camera:THREE.Camera,visible=true){if(closed)return;group.visible=visible;const page=typeof document==='undefined'||document.visibilityState!=='hidden';projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);frustum.setFromProjectionMatrix(projection);camera.getWorldPosition(position);hidden=!visible||!page;
  for(const entry of videos){entry.mesh.updateWorldMatrix(true,false);const active=!hidden&&position.distanceToSquared(screenPosition.setFromMatrixPosition(entry.mesh.matrixWorld))<80**2&&normal.set(0,0,1).transformDirection(entry.mesh.matrixWorld).dot(offset.copy(position).sub(screenPosition))>0&&frustum.intersectsObject(entry.mesh);
   if(!active){if(!entry.video.paused)entry.video.pause();continue;}if(entry.video.paused&&!entry.requesting&&performance.now()>=entry.retryAt){entry.requesting=true;void entry.video.play().catch(()=>{entry.retryAt=performance.now()+2000;}).finally(()=>{entry.requesting=false;});}}
 },inspection(){return videos.map(v=>({id:v.mesh.name.slice('assigned-media:'.length),playing:!v.video.paused,currentTime:v.video.currentTime,readyState:v.video.readyState}));},dispose};
}
