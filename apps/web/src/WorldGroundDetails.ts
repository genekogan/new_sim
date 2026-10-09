import * as THREE from 'three';
import {edenExpansionLayout,inWater} from '../../../mars/viewer/app/engine-view/content/environment/eden-expansion-landscape/layout.mjs';
import {edenExpansionPlanting} from '../../../mars/viewer/app/engine-view/content/environment/eden-expansion-landscape/planting.mjs';
import {EDEN_VIEWER_PLACES} from './WorldEdenPlaceData.ts';
import {SPORTS_PLAN} from '../../../mars/viewer/app/engine-view/content/assets/eden-sports-kit/index.ts';
/** Ground details for inner Eden (presentation only, camera-transparent, no collision):
 *  - a near-field meadow: grass tufts and wildflowers scattered around whichever camera is drawing (within
 *    ~26 m, fading out with distance), re-dealt from a fixed per-cell hash only when the camera has moved a few
 *    metres, so the same tuft is always in the same place; two instanced draws, nothing when looking from high up;
 *  - worn path edges: bare, trodden soil along both sides of every path, with pebbles;
 *  - scattered field stones, and autumn leaves fallen under the trees.
 * Where grass may grow comes from one mask (0.5 m cells) painted once from the layout: paths, building and place
 * footprints, the commons' fixtures and the lake are kept clear. Tufts and blooms take the shared wind sway (the
 * atmosphere finds them by name). */
const B=[-100,-65,105,85] as const,CELL=.5,W=Math.round((B[2]-B[0])/CELL),H=Math.round((B[3]-B[1])/CELL);
/** 0 = no detail, 1 = grass, 2 = path edge (worn), 3 = path. */
export function groundMask(exclude:(x:number,z:number)=>boolean=()=>false){
 const m=new Uint8Array(W*H);const L=edenExpansionLayout();
 for(let j=0;j<H;j++)for(let i=0;i<W;i++){const x=B[0]+(i+.5)*CELL,z=B[1]+(j+.5)*CELL;m[j*W+i]=inWater(x,z)||exclude(x,z)?0:1;}
 const stampRect=(x0:number,z0:number,x1:number,z1:number,v:number)=>{for(let j=Math.max(0,Math.floor((z0-B[1])/CELL));j<=Math.min(H-1,Math.floor((z1-B[1])/CELL));j++)for(let i=Math.max(0,Math.floor((x0-B[0])/CELL));i<=Math.min(W-1,Math.floor((x1-B[0])/CELL));i++)m[j*W+i]=v;};
 const stampPath=(pts:readonly (readonly [number,number])[],width:number)=>{const half=width/2,edge=half+.75;
  for(let k=1;k<pts.length;k++){const [ax,az]=pts[k-1],[bx,bz]=pts[k],dx=bx-ax,dz=bz-az,l2=dx*dx+dz*dz||1;
   for(let j=Math.max(0,Math.floor((Math.min(az,bz)-edge-B[1])/CELL));j<=Math.min(H-1,Math.floor((Math.max(az,bz)+edge-B[1])/CELL));j++)
    for(let i=Math.max(0,Math.floor((Math.min(ax,bx)-edge-B[0])/CELL));i<=Math.min(W-1,Math.floor((Math.max(ax,bx)+edge-B[0])/CELL));i++){
     const x=B[0]+(i+.5)*CELL,z=B[1]+(j+.5)*CELL,u=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/l2)),d=Math.hypot(ax+u*dx-x,az+u*dz-z),k2=j*W+i;
     if(d<=half)m[k2]=3;else if(d<=edge&&m[k2]===1)m[k2]=2;}}};
 for(const p of L.paths)stampPath(p.points,p.width);
 // the commons' gravel ribbon and its gathering spots
 stampPath([[14,4],[9,5],[4,5]],1.4);
 for(const p of L.places)stampRect(p.bounds[0]-.3,p.bounds[1]-.3,p.bounds[2]+.3,p.bounds[3]+.3,0);
 for(const p of EDEN_VIEWER_PLACES){if(p.level!==0||p.id==='eden'||p.id==='field'||p.id==='eden-east'||p.id==='eden-gardens'||p.id==='eden-south-lawn'||p.id.startsWith('region-'))continue;
  if(!(p.enclosed||p.parent==='field'||/pavilion|stage|venue|building|shop|playground|water|plaza|court/.test(p.kind)))continue;
  const xs=p.polygon.map(q=>q[0]),zs=p.polygon.map(q=>q[1]);stampRect(Math.min(...xs)-.3,Math.min(...zs)-.3,Math.max(...xs)+.3,Math.max(...zs)+.3,0);}
 // courts and the gym mat (sand, gravel, rubber)
 for(const r of [SPORTS_PLAN.volleyball.court,SPORTS_PLAN.petanque.court,SPORTS_PLAN.gym.mat])stampRect(r[0]-.2,r[1]-.2,r[2]+.2,r[3]+.2,0);
 return m;
}
const maskAt=(m:Uint8Array,x:number,z:number)=>{const i=Math.floor((x-B[0])/CELL),j=Math.floor((z-B[1])/CELL);return i<0||j<0||i>=W||j>=H?0:m[j*W+i];};
const hash=(i:number,j:number,s:number)=>{let h=(Math.imul(i,374761393)+Math.imul(j,668265263)+Math.imul(s,1442695041))|0;h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967296;};
type Ground=(x:number,z:number)=>number|null;
function tuftGeometry(){
 // five blades, each one triangle, leaning out from the root; darker at the base
 const p:number[]=[],c:number[]=[],base=new THREE.Color('#5a8a3a'),tip=new THREE.Color('#a9c96b');
 for(let k=0;k<8;k++){const a=k*.785+.3*(k%3),lean=.05+.04*(k%3)/2,h=.15+.09*((k*7)%4)/3,w=.03;const ox=Math.cos(a)*.03,oz=Math.sin(a)*.03,tx=Math.cos(a)*lean,tz=Math.sin(a)*lean,px=-Math.sin(a)*w,pz=Math.cos(a)*w;
  p.push(ox-px,0,oz-pz,ox+px,0,oz+pz,ox+tx,h,oz+tz);c.push(base.r,base.g,base.b,base.r,base.g,base.b,tip.r,tip.g,tip.b);}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('color',new THREE.Float32BufferAttribute(c,3));g.computeVertexNormals();
 // grass normals point up so the tufts light like the lawn under them
 const n=g.attributes.normal;for(let i=0;i<n.count;i++)n.setXYZ(i,0,1,0);return g;
}
function bloomGeometry(){
 // a stem and a four-petal flower head (two crossed quads), petals white-tinted for instance colour
 const p:number[]=[],c:number[]=[],stem=new THREE.Color('#4f7d3a'),petal=new THREE.Color('#ffffff'),s=.07,h=.34;
 p.push(-.008,0,0,.008,0,0,0,h,0);c.push(stem.r,stem.g,stem.b,stem.r,stem.g,stem.b,stem.r,stem.g,stem.b);
 for(const [ax,az] of [[1,0],[0,1]])for(const [a,b] of [[[-s*ax,h,-s*az],[s*ax,h,s*az]]]){p.push(a[0],a[1]-.03,a[2],b[0],b[1]-.03,b[2],b[0],b[1]+.03,b[2],a[0],a[1]-.03,a[2],b[0],b[1]+.03,b[2],a[0],a[1]+.03,a[2]);for(let i=0;i<6;i++)c.push(petal.r,petal.g,petal.b);}
 p.push(-s,h+.005,0,0,h+.005,s,s,h+.005,0,-s,h+.005,0,s,h+.005,0,0,h+.005,-s);for(let i=0;i<6;i++)c.push(petal.r,petal.g,petal.b);
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('color',new THREE.Float32BufferAttribute(c,3));
 const n=new Float32Array(p.length);for(let i=1;i<n.length;i+=3)n[i]=1;g.setAttribute('normal',new THREE.BufferAttribute(n,3));return g;
}
const FLOWER=['#f4f1e8','#f1c84b','#d9485f','#9b6fd1','#e86aa8','#f4f1e8','#ffd166'];
/** Near-field meadow (tufts + blooms) re-dealt around the drawing camera. */
class Meadow{
 readonly tufts:THREE.InstancedMesh;readonly blooms:THREE.InstancedMesh;
 private cx=Infinity;private cz=Infinity;private readonly m=new THREE.Matrix4();private readonly q=new THREE.Quaternion();private readonly s=new THREE.Vector3();private readonly v=new THREE.Vector3();private readonly col=new THREE.Color();
 private readonly mask:Uint8Array;readonly radius:number;
 private readonly ground:Ground;
 constructor(mask:Uint8Array,ground:Ground,radius=26,maxTufts=12000,maxBlooms=700){
  this.mask=mask;this.radius=radius;this.ground=ground;
  const grass=new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,side:THREE.DoubleSide});grass.name='meadow grass tufts';
  const flower=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.9,side:THREE.DoubleSide});flower.name='meadow wildflower blooms';
  this.tufts=new THREE.InstancedMesh(tuftGeometry(),grass,maxTufts);this.tufts.name='meadow grass tufts (near camera)';
  this.blooms=new THREE.InstancedMesh(bloomGeometry(),flower,maxBlooms);this.blooms.name='meadow wildflower blooms (near camera)';
  for(const x of [this.tufts,this.blooms]){x.count=0;x.frustumCulled=false;x.userData.cameraTransparent=true;x.raycast=()=>{};x.receiveShadow=true;x.castShadow=false;}
  this.blooms.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(maxBlooms*3),3);
  const self=this;this.tufts.onBeforeRender=function(_r,_s,camera){self.follow(camera);};
 }
 follow(camera:THREE.Camera){
  if(!(camera as THREE.PerspectiveCamera).isPerspectiveCamera)return;
  camera.getWorldPosition(this.v);
  // From high up the tufts would be sub-pixel: skip them entirely.
  if(this.v.y>(this.ground(this.v.x,this.v.z)??0)+26){if(this.tufts.count){this.tufts.count=0;this.blooms.count=0;this.cx=Infinity;}return;}
  if(Math.hypot(this.v.x-this.cx,this.v.z-this.cz)<2.5)return;
  this.cx=this.v.x;this.cz=this.v.z;this.deal();
 }
 private deal(){
  const R=this.radius,C=.55,i0=Math.floor((this.cx-R)/C),i1=Math.floor((this.cx+R)/C),j0=Math.floor((this.cz-R)/C),j1=Math.floor((this.cz+R)/C);
  let n=0,b=0;const nt=this.tufts.instanceMatrix.count,nb=this.blooms.instanceMatrix.count,up=new THREE.Vector3(0,1,0);
  for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){
   const h1=hash(i,j,1),h2=hash(i,j,2),x=(i+h1)*C,z=(j+h2)*C,d=Math.hypot(x-this.cx,z-this.cz);if(d>R)continue;
   const k=maskAt(this.mask,x,z);if(k!==1&&!(k===2&&h1<.35))continue;
   const fade=1-THREE.MathUtils.smoothstep(d,R*.55,R);
   const count=d<12?(h2<.4?3:2):(h2<.35?2:1);
   for(let c=0;c<count&&n<nt;c++){const ox=c?(hash(i,j,3+c*7)-.5)*.45:0,oz=c?(hash(i,j,4+c*7)-.5)*.45:0,sc=(.75+.6*hash(i,j,5+c))*(.25+.75*fade)*(k===2?.7:1);
    const y=this.ground(x+ox,z+oz);if(y===null||!Number.isFinite(y)||maskAt(this.mask,x+ox,z+oz)===0)continue;
    this.q.setFromAxisAngle(up,hash(i,j,7+c)*6.283);this.m.compose(this.v.set(x+ox,y,z+oz),this.q,this.s.set(sc,sc*(.8+.5*hash(i,j,9)),sc));this.tufts.setMatrixAt(n++,this.m);}
   if(k===1&&hash(i,j,11)<.07&&b<nb){const y=this.ground(x+.25,z-.2);if(y===null||!Number.isFinite(y)||maskAt(this.mask,x+.25,z-.2)===0)continue;const sc=(.8+.5*hash(i,j,12))*(.3+.7*fade);this.q.setFromAxisAngle(up,hash(i,j,13)*6.283);
    this.m.compose(this.v.set(x+.25,y,z-.2),this.q,this.s.set(sc,sc,sc));this.blooms.setMatrixAt(b,this.m);
    this.col.set(FLOWER[Math.floor(hash(i,j,14)*FLOWER.length)]);this.blooms.setColorAt(b,this.col);b++;}}
  this.tufts.count=n;this.blooms.count=b;this.tufts.instanceMatrix.needsUpdate=true;this.blooms.instanceMatrix.needsUpdate=true;if(this.blooms.instanceColor)this.blooms.instanceColor.needsUpdate=true;
 }
 get counts(){return {tufts:this.tufts.count,blooms:this.blooms.count};}
 dispose(){for(const x of [this.tufts,this.blooms]){x.removeFromParent();x.geometry.dispose();(x.material as THREE.Material).dispose();x.dispose();}}
}
/** Static details: worn path edges, pebbles, field stones, fallen leaves (merged; vertex colours). */
function staticDetails(mask:Uint8Array,ground:Ground){
 const p:number[]=[],c:number[]=[],col=new THREE.Color();let rocks=0,leaves=0,worn=0;
 const flat=(x:number,z:number,r:number,sides:number,rot:number,color:string,y:number,stretch=1)=>{col.set(color);
  const base=ground(x,z);if(base===null)return;const lift=y-base;
  for(let k=0;k<sides;k++){const a0=rot+k/sides*6.283,a1=rot+(k+1)/sides*6.283,j0=.75+.25*Math.sin(a0*3+r*7),j1=.75+.25*Math.sin(a1*3+r*7);
   const ax=x+Math.cos(a1)*r*j1*stretch,az=z+Math.sin(a1)*r*j1,bx=x+Math.cos(a0)*r*j0*stretch,bz=z+Math.sin(a0)*r*j0,ay=ground(ax,az),by=ground(bx,bz);if(ay===null||by===null)continue;
   p.push(x,y,z,ax,ay+lift,az,bx,by+lift,bz);for(let i=0;i<3;i++)c.push(col.r,col.g,col.b);}};
 const rock=(x:number,z:number,r:number,seed:number)=>{const y=ground(x,z);if(y===null)return;const g=new THREE.IcosahedronGeometry(r,0),a=g.attributes.position;
  const tint=.55+.15*seed;col.setRGB(tint,tint*.97,tint*.9);
  for(let i=0;i<a.count;i++){const vx=a.getX(i)*(1+.3*Math.sin(seed*9)),vy=Math.max(a.getY(i)*.55,-.02),vz=a.getZ(i)*(1+.3*Math.cos(seed*7));p.push(x+vx,y+vy+r*.15,z+vz);
   const shade=a.getY(i)>0?1:.8;c.push(col.r*shade,col.g*shade,col.b*shade);}g.dispose();rocks++;};
 // worn edges: trodden soil patches and pebbles at the path borders
 for(let j=0;j<H;j++)for(let i=0;i<W;i++){if(mask[j*W+i]!==2)continue;const h=hash(i,j,21);if(h>.3)continue;
  const x=B[0]+(i+hash(i,j,22))*CELL,z=B[1]+(j+hash(i,j,23))*CELL,base=ground(x,z);if(base===null)continue;const y=base+.009;
  flat(x,z,.14+.16*hash(i,j,24),6,h*20,h<.12?'#a99d7c':'#93a065',y,1.3);worn++;
  if(hash(i,j,25)<.3){col.set('#b1a998');const r=.04+.04*hash(i,j,26);flat(x+.2,z-.1,r,5,h*9,'#a59d8e',y+.012);}}
 // field stones in the grass, sparse
 for(let j=0;j<H;j+=6)for(let i=0;i<W;i+=6){const h=hash(i,j,31);if(h>.09)continue;const x=B[0]+(i+6*hash(i,j,32))*CELL,z=B[1]+(j+6*hash(i,j,33))*CELL;if(maskAt(mask,x,z)!==1)continue;rock(x,z,.12+.3*hash(i,j,34)*hash(i,j,35),hash(i,j,36));
  if(hash(i,j,37)<.5)rock(x+.4,z+.2,.08+.08*hash(i,j,38),hash(i,j,39));}
 // fallen leaves under the trees (October)
 const LEAF=['#c98b3a','#b5652e','#d9b24a','#8a6a3a','#a8452c'];
 let t=0;for(const tree of edenExpansionPlanting().plants){if(!/tree|orchard|birch|flowering/.test(tree.kind))continue;const [tx,,tz]=tree.p;t++;
  for(let k=0;k<26;k++){const a=hash(t,k,41)*6.283,d=Math.sqrt(hash(t,k,42))*2.6,x=tx+Math.cos(a)*d,z=tz+Math.sin(a)*d;if(maskAt(mask,x,z)===3||maskAt(mask,x,z)===0&&x>B[0]&&x<B[2]&&z>B[1]&&z<B[3])continue;
   const y=ground(x,z);if(y===null)continue;flat(x,z,.06+.04*hash(t,k,43),4,hash(t,k,44)*6,LEAF[Math.floor(hash(t,k,45)*LEAF.length)],y+.012+.001*(k%4),1.6);leaves++;}}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('color',new THREE.Float32BufferAttribute(c,3));g.computeVertexNormals();
 // flat decals light like the ground (up normals); rocks keep their facets
 g.computeBoundingSphere();return {geometry:g,stats:{rocks,leaves,worn,triangles:p.length/9}};
}
export function createWorldGroundDetails(ground:Ground,exclude:(x:number,z:number)=>boolean=()=>false){
 const mask=groundMask(exclude),meadow=new Meadow(mask,ground),st=staticDetails(mask,ground);
 const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.95,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});material.name='trodden soil, pebbles, field stones and fallen leaves';
 const stat=new THREE.Mesh(st.geometry,material);stat.name='ground litter: worn path edges, stones, fallen leaves (static)';stat.receiveShadow=true;stat.userData.cameraTransparent=true;stat.raycast=()=>{};
 const group=new THREE.Group();group.name='Eden near-field meadow details (scenery only)';group.add(stat,meadow.tufts,meadow.blooms);
 let closed=false;
 return {group,meadow,stats:{...st.stats,draws:3},dispose(){if(closed)return;closed=true;group.removeFromParent();meadow.dispose();st.geometry.dispose();material.dispose();}};
}
