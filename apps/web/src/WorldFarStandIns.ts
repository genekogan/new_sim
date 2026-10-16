import * as THREE from 'three';
/** Lane phones (V4): flat stand-ins for far objects, for the phone quality tier.
 *
 * Scattered things (desert scrub, tyres, rocks, bushes, lamps of an instanced village) are drawn as InstancedMeshes:
 * every bush costs its full 100–300 triangles, twice with its shadow, even when it is four pixels tall on a phone. Far
 * instances are drawn instead as one camera-facing card each (two triangles, no shadow), textured with a snapshot of
 * that mesh taken once (`snapshot`, from the side, albedo only, transparent background) and tinted with the
 * instance's own colour; near instances keep their mesh and shadow.
 *
 * Render-time only, like WorldDistanceDetail: `apply` (just before renderer.render) hides the original InstancedMesh and
 * shows two derived siblings, a mesh holding only the near instances and a card mesh holding the far ones; `restore`
 * right after puts the original back, so picking, raycasts and the systems that own the instances never see a change.
 * The near/far split is recomputed only when the camera has moved; card yaw is done in the vertex shader. A source is
 * dropped (and its siblings disposed) when it leaves the scene or its instance count changes shape. */
export type StandInOptions={cardRadiusPx:number;minInstances:number;minTriangles:number;maxRadius:number;rescanFrames:number;snapshotsPerFrame:number;moveEpsilon:number};
export const PHONE_STAND_INS:StandInOptions=Object.freeze({cardRadiusPx:7,minInstances:12,minTriangles:40,maxRadius:6,rescanFrames:120,snapshotsPerFrame:2,moveEpsilon:0.5});
/** Renders an albedo snapshot of one instance's geometry (side view, transparent background); null if impossible. */
export type Snapshotter=(geometry:THREE.BufferGeometry,material:THREE.Material)=>THREE.Texture|null;

type Source={mesh:THREE.InstancedMesh;near:THREE.InstancedMesh;cards:THREE.InstancedMesh;texture:THREE.Texture|null;
  centres:Float32Array;radii:Float32Array;cardMatrices:Float32Array;version:number;count:number;world:string;lastCam:THREE.Vector3|null;nearCount:number;farCount:number};

const tmpM=new THREE.Matrix4(),tmpW=new THREE.Matrix4(),tmpP=new THREE.Vector3(),tmpQ=new THREE.Quaternion(),tmpS=new THREE.Vector3(),one=new THREE.Quaternion();
/** A unit card: x in [-0.5, 0.5], y in [0, 1], normal straight up so it is lit like the ground cover around it. */
function cardGeometry(box:THREE.Box3){
  const g=new THREE.PlaneGeometry(1,1).translate(0,0.5,0);
  const size=box.getSize(new THREE.Vector3()),w=Math.max(size.x,size.z,1e-3),h=Math.max(size.y,1e-3);
  g.scale(w,h,1).translate(0,box.min.y,0);
  const n=g.attributes.normal as THREE.BufferAttribute;for(let i=0;i<n.count;i++)n.setXYZ(i,0,1,0);
  return g;
}
/** Cylindrical billboard: the card turns about its own vertical axis to face the camera (vertex shader). */
function cardMaterial(texture:THREE.Texture){
  const m=new THREE.MeshLambertMaterial({map:texture,alphaTest:0.5,side:THREE.DoubleSide});
  m.onBeforeCompile=(shader)=>{
    shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`
      vec4 cardBase = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      vec2 toCam = cameraPosition.xz - cardBase.xz; float len = length(toCam); vec2 f = len > 1e-4 ? toCam / len : vec2(0.0, 1.0);
      float sx = length(instanceMatrix[0].xyz), sy = length(instanceMatrix[1].xyz);
      vec4 cardWorld = vec4(cardBase.x + f.y * transformed.x * sx, cardBase.y + transformed.y * sy, cardBase.z - f.x * transformed.x * sx, 1.0);
      vec4 mvPosition = viewMatrix * cardWorld;
      gl_Position = projectionMatrix * mvPosition;`);
  };
  m.customProgramCacheKey=()=>'far-stand-in-card/1';
  return m;
}
const triangles=(g:THREE.BufferGeometry)=>(g.index?g.index.count:g.attributes.position?.count??0)/3;
const inScene=(o:THREE.Object3D,root:THREE.Object3D)=>{for(let p:THREE.Object3D|null=o;p;p=p.parent)if(p===root)return true;return false;};

export class WorldFarStandIns{
  readonly group=new THREE.Group();
  private sources=new Map<THREE.InstancedMesh,Source>();private frame=0;private active:Source[]=[];private o:StandInOptions;private snapshot:Snapshotter;
  /** Last apply(): sources, instances drawn as cards / as meshes, triangles saved per view pass, CPU ms. */
  readonly stats={sources:0,cards:0,near:0,trianglesSaved:0,cpuMs:0};
  constructor(o:StandInOptions,snapshot:Snapshotter){this.o=o;this.snapshot=snapshot;this.group.name='far-stand-ins';this.group.visible=false;}
  private eligible(m:THREE.InstancedMesh){
    const g=m.geometry,mat=m.material;
    return m.count>=this.o.minInstances&&!Array.isArray(mat)&&!!g?.attributes.position&&triangles(g)>=this.o.minTriangles&&!m.userData.keepDetail&&!Object.keys(g.morphAttributes).length&&m.parent!==null;
  }
  private scan(root:THREE.Object3D){
    const seen=new Set<THREE.InstancedMesh>();
    root.traverse(o=>{const m=o as THREE.InstancedMesh;if(!m.isInstancedMesh||o.parent===this.group||o.userData.farStandIn||!this.eligible(m))return;
      if(!m.geometry.boundingBox)m.geometry.computeBoundingBox();const box=m.geometry.boundingBox!;if(box.isEmpty())return;
      if(box.getSize(tmpP).length()/2>this.o.maxRadius)return;
      seen.add(m);if(!this.sources.has(m))this.add(m);});
    for(const s of [...this.sources.values()])if(!seen.has(s.mesh)||!inScene(s.mesh,root))this.drop(s);
  }
  private add(m:THREE.InstancedMesh){
    const cap=m.instanceMatrix.count,near=new THREE.InstancedMesh(m.geometry,m.material,cap);
    near.name=`${m.name} near`;near.userData.farStandIn=true;near.raycast=()=>{};near.visible=false;near.count=0;near.frustumCulled=false;
    if(m.instanceColor)near.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(cap*3),3);
    const cards=new THREE.InstancedMesh(cardGeometry(m.geometry.boundingBox!),new THREE.MeshBasicMaterial({visible:false}),cap);
    cards.name=`${m.name} far cards`;cards.userData.farStandIn=true;cards.raycast=()=>{};   // derived drawing only: picking and occlusion queries use the original
    cards.frustumCulled=false;cards.castShadow=false;cards.receiveShadow=false;cards.count=0;
    if(m.instanceColor)cards.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(cap*3),3);
    m.parent!.add(near);this.group.add(cards);
    this.sources.set(m,{mesh:m,near,cards,texture:null,centres:new Float32Array(cap*3),radii:new Float32Array(cap),cardMatrices:new Float32Array(cap*16),version:-1,count:-1,world:'',lastCam:null,nearCount:0,farCount:0});
  }
  private drop(s:Source){
    this.sources.delete(s.mesh);s.near.removeFromParent();s.near.dispose();s.cards.removeFromParent();s.cards.geometry.dispose();
    (s.cards.material as THREE.Material).dispose();s.cards.dispose();const t=s.texture;if(t)(typeof t.userData.dispose==='function'?t.userData.dispose:()=>t.dispose())();
  }
  /** Instance centres, radii and card matrices in world space; recomputed when the instances or the mesh move. */
  private refresh(s:Source){
    const m=s.mesh,world=m.matrixWorld.elements.join(',');
    if(s.version===m.instanceMatrix.version&&s.count===m.count&&s.world===world)return;
    const box=m.geometry.boundingBox!,c=box.getCenter(new THREE.Vector3()),r=box.getSize(new THREE.Vector3()).length()/2,base=new THREE.Vector3(c.x,0,c.z);
    for(let i=0;i<m.count;i++){
      m.getMatrixAt(i,tmpM);tmpW.multiplyMatrices(m.matrixWorld,tmpM);tmpW.decompose(tmpP,tmpQ,tmpS);
      const k=Math.max(tmpS.x,tmpS.y,tmpS.z);s.radii[i]=r*k;
      tmpP.copy(c).applyMatrix4(tmpW);s.centres.set([tmpP.x,tmpP.y,tmpP.z],i*3);
      tmpP.copy(base).applyMatrix4(tmpW);tmpM.compose(tmpP,one,tmpS.set(Math.max(tmpS.x,tmpS.z),tmpS.y,1));tmpM.toArray(s.cardMatrices,i*16);
    }
    s.version=m.instanceMatrix.version;s.count=m.count;s.world=world;s.lastCam=null;
  }
  /** Split near/far for the current camera (only when it moved). */
  private split(s:Source,cam:THREE.Vector3,pxPerUnit:number){
    if(s.lastCam&&s.lastCam.distanceToSquared(cam)<this.o.moveEpsilon*this.o.moveEpsilon)return;
    (s.lastCam??=new THREE.Vector3()).copy(cam);
    const m=s.mesh,nearM=s.near.instanceMatrix.array as Float32Array,cardM=s.cards.instanceMatrix.array as Float32Array,src=m.instanceMatrix.array as Float32Array;
    const srcC=m.instanceColor?.array as Float32Array|undefined,nearC=s.near.instanceColor?.array as Float32Array|undefined,cardC=s.cards.instanceColor?.array as Float32Array|undefined;
    let n=0,f=0;const limit=this.o.cardRadiusPx;
    for(let i=0;i<m.count;i++){
      const dx=s.centres[i*3]-cam.x,dy=s.centres[i*3+1]-cam.y,dz=s.centres[i*3+2]-cam.z,d=Math.sqrt(dx*dx+dy*dy+dz*dz)-s.radii[i];
      const far=s.texture!==null&&d>0&&s.radii[i]*pxPerUnit/d<limit;
      if(far){cardM.set(s.cardMatrices.subarray(i*16,i*16+16),f*16);if(srcC&&cardC)cardC.set(srcC.subarray(i*3,i*3+3),f*3);f++;}
      else{nearM.set(src.subarray(i*16,i*16+16),n*16);if(srcC&&nearC)nearC.set(srcC.subarray(i*3,i*3+3),n*3);n++;}
    }
    s.near.count=n;s.cards.count=f;s.nearCount=n;s.farCount=f;
    s.near.instanceMatrix.needsUpdate=true;s.cards.instanceMatrix.needsUpdate=true;
    if(s.near.instanceColor)s.near.instanceColor.needsUpdate=true;if(s.cards.instanceColor)s.cards.instanceColor.needsUpdate=true;
  }
  /** Call right before renderer.render. The group must be in the scene (LiveWorld adds it). */
  apply(root:THREE.Object3D,camera:THREE.PerspectiveCamera,viewHeight:number){
    const t0=performance.now();
    if(this.frame++%this.o.rescanFrames===0)this.scan(root);
    let snaps=0,cards=0,near=0,saved=0;const pxPerUnit=viewHeight/(2*Math.tan(camera.fov*Math.PI/360))*(camera.zoom||1);
    for(const s of this.sources.values()){
      const m=s.mesh;if(!m.visible||!m.parent)continue;
      if(!s.texture&&snaps<this.o.snapshotsPerFrame){snaps++;try{s.texture=this.snapshot(m.geometry,m.material as THREE.Material);}catch{s.texture=null;}
        if(s.texture){const old=s.cards.material as THREE.Material;s.cards.material=cardMaterial(s.texture);old.dispose();s.lastCam=null;}else{m.userData.keepDetail=true;continue;}}   // a mesh that cannot be photographed keeps its full detail
      if(!s.texture)continue;
      this.refresh(s);this.split(s,camera.position,pxPerUnit);
      if(!s.farCount)continue;   // nothing far: draw the original untouched
      s.near.position.copy(m.position);s.near.quaternion.copy(m.quaternion);s.near.scale.copy(m.scale);s.near.castShadow=m.castShadow;s.near.receiveShadow=m.receiveShadow;s.near.renderOrder=m.renderOrder;
      if(s.near.parent!==m.parent)m.parent.add(s.near);
      m.visible=false;s.near.visible=s.nearCount>0;s.cards.visible=true;this.active.push(s);
      cards+=s.farCount;near+=s.nearCount;saved+=s.farCount*(triangles(m.geometry)-2);
    }
    for(const s of this.sources.values())if(!this.active.includes(s))s.cards.visible=false;
    this.group.visible=this.active.length>0;
    Object.assign(this.stats,{sources:this.sources.size,cards,near,trianglesSaved:saved,cpuMs:performance.now()-t0});
  }
  /** Call right after renderer.render. */
  restore(){for(const s of this.active){s.mesh.visible=true;s.near.visible=false;s.cards.visible=false;}this.active.length=0;this.group.visible=false;}
  dispose(){this.restore();for(const s of [...this.sources.values()])this.drop(s);this.group.removeFromParent();}
}

/** Albedo snapshot of one instance from the side into a small transparent texture, with the world's renderer. */
export function rendererSnapshotter(renderer:THREE.WebGLRenderer,size=96):Snapshotter{
  const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1,1,1,-1,0.01,100);scene.add(new THREE.AmbientLight(0xffffff,Math.PI));   // physically based materials reflect ambient·albedo/π: π gives the albedo
  return (geometry,material)=>{
    if(!geometry.boundingBox)geometry.computeBoundingBox();const box=geometry.boundingBox!,size3=box.getSize(new THREE.Vector3()),c=box.getCenter(new THREE.Vector3());
    const w=Math.max(size3.x,size3.z,1e-3)/2,h=Math.max(size3.y,1e-3)/2;
    // the card spans the bounding box exactly: frame it edge to edge so texture and card line up
    Object.assign(camera,{left:-w,right:w,top:h,bottom:-h,near:0.01,far:Math.max(size3.x,size3.z)*2+10});camera.updateProjectionMatrix();
    camera.position.set(c.x,c.y,c.z+Math.max(size3.x,size3.z)+5);camera.lookAt(c);
    const target=new THREE.WebGLRenderTarget(size,Math.max(16,Math.round(size*Math.min(2,h/w))),{depthBuffer:true});target.texture.colorSpace=THREE.SRGBColorSpace;target.texture.generateMipmaps=true;target.texture.minFilter=THREE.LinearMipmapLinearFilter;
    const mesh=new THREE.Mesh(geometry,material);scene.add(mesh);
    const previous=renderer.getRenderTarget(),clear=renderer.getClearColor(new THREE.Color()),alpha=renderer.getClearAlpha(),viewport=renderer.getViewport(new THREE.Vector4()),scissor=renderer.getScissor(new THREE.Vector4()),scissorTest=renderer.getScissorTest(),autoClear=renderer.autoClear,shadows=renderer.shadowMap.enabled;
    try{renderer.setRenderTarget(target);renderer.setScissorTest(false);renderer.setClearColor(0x000000,0);renderer.autoClear=true;renderer.shadowMap.enabled=false;renderer.render(scene,camera);}
    finally{renderer.setRenderTarget(previous);renderer.setClearColor(clear,alpha);renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(scissorTest);renderer.autoClear=autoClear;renderer.shadowMap.enabled=shadows;mesh.removeFromParent();}
    target.texture.userData.dispose=()=>target.dispose();
    return target.texture;
  };
}
