import * as THREE from 'three';
import {groundTriangleSampler} from '../../../../../lib/ground-triangles.ts';
import {Builder,type Materials} from './kit.ts';
/** Visual terrain OUTSIDE the current expansion rectangle [-100,105]x[-65,85].
 * Scenery only: no native support, collision or route. At the rectangle edge it
 * equals the supplied ground (Y0 nearly everywhere; the west lake bank dips) and
 * blends to the regional relief over ~12 m. */
export const INNER=[-100,-65,105,85] as const;
export type Pad={x0:number;z0:number;x1:number;z1:number;y:number;m:number};
export type Edge=(x:number,z:number)=>number;
const clamp=(v:number,a:number,b:number)=>v<a?a:v>b?b:v;
const sm=(e0:number,e1:number,v:number)=>{const t=clamp((v-e0)/(e1-e0),0,1);return t*t*(3-2*t);};
export function outside(x:number,z:number){const dx=Math.max(INNER[0]-x,0,x-INNER[2]),dz=Math.max(INNER[1]-z,0,z-INNER[3]);return Math.hypot(dx,dz);}
/** Cheap value noise. */
function hash(i:number,j:number){let h=Math.imul(i,374761393)+Math.imul(j,668265263);h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967296;}
export function noise(x:number,z:number){const i=Math.floor(x),j=Math.floor(z),fx=x-i,fz=z-j,u=fx*fx*(3-2*fx),v=fz*fz*(3-2*fz);
 const a=hash(i,j),b=hash(i+1,j),c=hash(i,j+1),d=hash(i+1,j+1);return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v;}
export const fbm=(x:number,z:number)=>noise(x,z)*.55+noise(x*2.1+7,z*2.1-3)*.3+noise(x*4.3-11,z*4.3+5)*.15;
const bump=(x:number,z:number,cx:number,cz:number,rx:number,rz:number)=>{const u=(x-cx)/rx,v=(z-cz)/rz;return Math.exp(-(u*u+v*v)*2);};
export const WATER={bay:-.55,canal:-.7,lake:-2};
/** Deep seabed colour: the terrain's sea floor fades to it with depth, and the open-sea bed beyond the terrain uses it. */
export const SEABED='#3d5f66';
/** Outer coast (Gene 2026-10-07: natural, Big Sur-like, still dramatic). Beyond the districts
 * (|x| > ~310 m, ramped in by `w`) the shoreline meanders: headlands jut out with cliffs and sea
 * stacks, coves hold beaches, a marine terrace or two step up before the mountains. Inside the
 * districts the original straight bay edge (and the harbour/resort pads) are unchanged. */
export function coastAt(x:number){
 const w=sm(300,390,Math.abs(x));
 const a=26*Math.sin(x/61+.7)+14*Math.sin(x/23.5+2.1)+18*(fbm(x/37,17.3)-.5);
 const zc=150+w*a,head=sm(-6,26,a);   // head: 0 deep cove .. 1 headland
 return {w,zc,head};
}
/** Height cap of the coastal slope at `u` metres inland of the shoreline (negative = sea). */
export function coastCap(u:number,head:number,x:number){
 if(u<=0)return Math.max(-7,-1.1+u*.09);                       // shelving sea floor
 const beach=3+15*(1-head),cliff=5+30*head+10*fbm(x/19,3.7),rise=2.5+9*(1-head);
 if(u<beach)return -1.1+2.6*sm(0,beach,u);                      // sand
 let h=1.5+(cliff-1.5)*sm(beach,beach+rise,u);                  // bluff (sheer on headlands)
 const t1=beach+rise,tw=22+28*fbm(x/53,9.1);h+=Math.max(0,u-t1)*.07;   // first marine terrace
 const t2=t1+tw;h+=sm(t2,t2+10+8*head,u)*(10+12*fbm(x/41,2.3));          // step to the second terrace
 h+=Math.max(0,u-t2-25)*(.42+.3*fbm(x/29,5.5));                  // then the range climbs
 return h;
}
/** Sea stacks off the headlands (a few rocky islets per km). */
function stacks(x:number,u:number,head:number){
 if(head<.45||u>-6||u<-70)return 0;let h=0;
 for(let k=Math.floor(x/47)-1;k<=Math.floor(x/47)+1;k++){const hx=hash(k,911),sx=k*47+hx*47,su=-10-hash(k,313)*42,r=4+hash(k,77)*6,dd=Math.hypot(x-sx,u-su);
  if(hash(k,5)<.6&&dd<r*1.6)h=Math.max(h,(6+hash(k,19)*16)*head*(1-sm(r*.5,r*1.6,dd)));}
 return h;
}
/** Regional relief before pads and edge blending. */
function relief(x:number,z:number){
 let h=0;
 // East hill: the hillside village and lookout temple.
 h+=22*bump(x,z,226,-22,68,62);
 // North: terraced orchard/vineyard slope rising away from the edge (x 20..110).
 if(z<-65){const t=sm(-70,-150,z)*sm(5,30,x)*sm(125,105,x);const raw=Math.min(-65-z,100)*.13;const step=Math.floor(raw/1.4)*1.4+sm(.75,1,(raw/1.4)%1)*1.4;h+=t*step;}
 // Far ring: mountains/hills beyond the districts, not toward the southern sea.
 // ring/undulate/coast are skipped where their weight is 0 (they would add ±0 to h >= +0: same heights, no noise calls).
 const d=outside(x,z),sr=sm(150,240,d),su=sm(60,140,d),ring=sr>0?sr*((d-150)*.32+fbm(x/45,z/45)*26):0,undulate=su>0?su*(fbm(x/28,z/28)-.45)*5:0;
 const c=sm(300,390,Math.abs(x))>0?coastAt(x):null;
 // Districts (w=0): the original straight bay edge. Outer coast (w=1): mountains meet a natural coast.
 let old=h+ring*(1-sm(118,146,z))+undulate;if(z>130){const s=sm(132,160,z);old=old*(1-s)-3.2*s;}
 if(c){const u=c.zc-z,cap=coastCap(u,c.head,x),land=h+ring+undulate;
  // smooth minimum (polynomial, dips at most k/4): the range never stands taller than the coastal slope allows
  const k=1+7*sm(4,40,u),q=Math.max(k-Math.abs(land-cap),0)/k,nat=u<=0?cap:Math.min(land,cap)-q*q*k/4;
  h=old*(1-c.w)+(nat+stacks(x,u,c.head))*c.w;}
 else h=old;
 // West lake: an ellipse basin joined to the existing lake through a channel at the edge.
 if(x<-100){const e=((x+148)/46)**2+((z-2)/44)**2;let lake=e<1?-4.6*sm(1,.55,e):0;
  if(x>-130&&z>-8&&z<12){const c=sm(-8,-3,z)*sm(12,8,z)*sm(-130,-120,x);lake=Math.min(lake,-3.6*c);}
  if(lake<0)h=Math.min(h*sm(-.2,0,lake),lake);}
 return h;
}
export class Terrain{
 private drawn:ReturnType<typeof groundTriangleSampler>|null=null;
 /** Actual Float32 triangle height after build, not the analytic relief sketch. */
 sampleRenderedGround(x:number,z:number){return this.drawn?.heightAt(x,z)??null;}
 pads:Pad[]=[];
 // Spatial index of pads (24 m cells) and polyline bounding boxes: built lazily, dropped when pads change.
 private grid:Map<number,number[]>|null=null;private gridN=0;private boxes=new WeakMap<object,number[]>();
 private padCell(x:number,z:number){if(!this.grid||this.gridN!==this.pads.length){const g=new Map<number,number[]>();this.pads.forEach((p,i)=>{for(let cx=Math.floor((p.x0-p.m)/24);cx<=Math.floor((p.x1+p.m)/24);cx++)for(let cz=Math.floor((p.z0-p.m)/24);cz<=Math.floor((p.z1+p.m)/24);cz++){const k=cx*4096+cz;let l=g.get(k);if(!l)g.set(k,l=[]);l.push(i);}});this.grid=g;this.gridN=this.pads.length;}
  return this.grid.get(Math.floor(x/24)*4096+Math.floor(z/24));}
 private bbox(o:{pts:[number,number][]}){let b=this.boxes.get(o);if(!b){b=[Infinity,Infinity,-Infinity,-Infinity];for(const [x,z] of o.pts){b[0]=Math.min(b[0],x);b[1]=Math.min(b[1],z);b[2]=Math.max(b[2],x);b[3]=Math.max(b[3],z);}this.boxes.set(o,b);}return b;}
 /** Basins cut after pads (ponds): each returns a depth <0 or 0. */
 cuts:((x:number,z:number)=>number)[]=[];
 /** Rivers: polyline + width; water level runs downhill (running minimum of the natural ground). */
 rivers:{pts:[number,number][];half:number;lev:number[];step:number[]}[]=[];
 river(pts:[number,number][],width:number){const lev:number[]=[],step:number[]=[];let run=Infinity,acc=0;
  for(let i=0;i<pts.length;i++){if(i)acc+=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);step.push(acc);run=Math.min(run,this.natural(pts[i][0],pts[i][1])-.5);lev.push(run);}
  this.rivers.push({pts,half:width/2,lev,step});}
 /** Nearest river sample: distance to centreline and the water level there (null if no river within r). */
 riverAt(x:number,z:number,r=0){for(const rv of this.rivers){const bb=this.bbox(rv);if(x<bb[0]-rv.half-r||x>bb[2]+rv.half+r||z<bb[1]-rv.half-r||z>bb[3]+rv.half+r)continue;let best=1e9,lv=0;const P=rv.pts;for(let i=1;i<P.length;i++){const [ax,az]=P[i-1],[cx,cz]=P[i],dx=cx-ax,dz=cz-az,L2=dx*dx+dz*dz,u=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/L2)),d=Math.hypot(x-ax-dx*u,z-az-dz*u);if(d<best){best=d;lv=rv.lev[i-1]+(rv.lev[i]-rv.lev[i-1])*u;}}
  if(best<rv.half+r)return {d:best,level:lv,half:rv.half};}return null;}
 /** Road corridors: terrain is levelled across the road to its centreline height. */
 roads:{pts:[number,number][];half:number;fall:number;padded:boolean}[]=[];
 /** padded: the road follows the padded ground (relief + level pads) instead of the bare relief. */
 road(pts:[number,number][],width:number,fall=3,padded=false){this.roads.push({pts,half:width/2+.4,fall,padded});}
 private paddedAt(x:number,z:number){let h=relief(x,z);for(const i of this.padCell(x,z)??[]){const P=this.pads[i];const dx=Math.max(P.x0-x,0,x-P.x1),dz=Math.max(P.z0-z,0,z-P.z1),w=1-sm(0,P.m,Math.hypot(dx,dz));if(w>0)h=h+(P.y-h)*w;}
  const d=outside(x,z),s=sm(0,12,d);if(s===1)return h;const ex=clamp(x,INNER[0],INNER[2]),ez=clamp(z,INNER[1],INNER[3]);return this.edge(ex,ez)*(1-s)+h*s;}
 readonly edge:Edge;
 constructor(edge:Edge){this.edge=edge;}
 /** Final visual height. */
 height(x:number,z:number){const d=outside(x,z);if(d<=0)return this.edge(x,z);
  let h=relief(x,z);const cell=this.padCell(x,z);if(cell)for(const i of cell){const p=this.pads[i];const dx=Math.max(p.x0-x,0,x-p.x1),dz=Math.max(p.z0-z,0,z-p.z1),w=1-sm(0,p.m,Math.hypot(dx,dz));if(w>0)h=h+(p.y-h)*w;}
  for(const rd of this.roads){const bb=this.bbox(rd);if(x<bb[0]-rd.half-rd.fall||x>bb[2]+rd.half+rd.fall||z<bb[1]-rd.half-rd.fall||z>bb[3]+rd.half+rd.fall)continue;let best=1e9,bx=0,bz=0;const P=rd.pts;for(let i=1;i<P.length;i++){const [ax,az]=P[i-1],[cx,cz]=P[i],dx=cx-ax,dz=cz-az,L2=dx*dx+dz*dz,u=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/L2)),qx=ax+dx*u,qz=az+dz*u,dd=Math.hypot(x-qx,z-qz);if(dd<best){best=dd;bx=qx;bz=qz;}}
   if(best<rd.half+rd.fall){const w=1-sm(rd.half,rd.half+rd.fall,best);h=h+((rd.padded?this.paddedAt(bx,bz):this.natural(bx,bz))-h)*w;}}
  for(const c of this.cuts){const d=c(x,z);if(d<0)h=Math.min(h,d);}
  if(this.rivers.length){const rv=this.riverAt(x,z,14);if(rv){const bed=rv.level-1.1*(1-sm(rv.half*.6,rv.half+.4,rv.d)),bank=rv.level+.25+Math.max(0,rv.d-rv.half)*.8;h=Math.min(h,rv.d<rv.half+.4?bed:Math.max(bed,bank));}}
  // Canal bed (east quarter): a crisp cut between quay walls, after the pads.
  if(x>132.5&&x<140.5&&z>-31&&z<51)h=Math.min(h,-1.9);
  const s=sm(0,12,d);if(s===1)return h;const ex=clamp(x,INNER[0],INNER[2]),ez=clamp(z,INNER[1],INNER[3]);return this.edge(ex,ez)*(1-s)+h*s;}
 /** Height of the un-padded relief (to choose pad levels). */
 natural(x:number,z:number){const d=outside(x,z),s=sm(0,12,d);if(s===1)return relief(x,z);const ex=clamp(x,INNER[0],INNER[2]),ez=clamp(z,INNER[1],INNER[3]);return this.edge(ex,ez)*(1-s)+relief(x,z)*s;}
 /** Flatten a level pad; returns its y. */
 pad(x0:number,z0:number,x1:number,z1:number,y?:number,m=3){const yy=y??Math.round(this.natural((x0+x1)/2,(z0+z1)/2)*2)/2;this.pads.push({x0,z0,x1,z1,y:yy,m});return yy;}
 build(group:THREE.Group,mats:Materials,geos:THREE.BufferGeometry[]){
  const axis=(segs:[number,number,number][])=>{const v:number[]=[];for(const [a,b,s] of segs){for(let x=a;x<b-1e-6;x+=s)v.push(x);}v.push(segs.at(-1)![1]);return [...new Set(v.map(x=>+x.toFixed(4)))].sort((a,b)=>a-b);};
  // Outer coast and far ring at ~12 m so headlands, coves and ridgelines resolve (WN4).
  const xs=axis([[-900,-280,12],[-280,-160,3],[-160,-100,4],[-100,105,5],[105,320,3],[320,900,12]]);
  const zs=axis([[-900,-400,60],[-400,-250,25],[-250,-160,4],[-160,-65,2.5],[-65,85,5],[85,215,4],[215,300,12],[300,430,40],[430,900,94]]);
  const nx=xs.length,nz=zs.length,H=new Float32Array(nx*nz),C=new Float32Array(nx*nz*3);
  const grass=new THREE.Color('#8a9b6e'),lush=new THREE.Color('#7d9a5a'),dry=new THREE.Color('#a39f74'),rock=new THREE.Color('#8b8371'),sand=new THREE.Color('#c2b48c'),far=new THREE.Color('#6f8858'),snow=new THREE.Color('#d9dcd6'),earth=new THREE.Color('#6f7448'),chap=new THREE.Color('#566f3d'),gold=new THREE.Color('#b9a46a'),cliffRock=new THREE.Color('#9a8a74'),seabed=new THREE.Color(SEABED),c=new THREE.Color();
  for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){const x=xs[i],z=zs[j],h=this.height(x,z);H[j*nx+i]=h;const d=outside(x,z),n=fbm(x/17,z/17),sl=d<=0?0:Math.hypot(this.height(x+1.5,z)-this.height(x-1.5,z),this.height(x,z+1.5)-this.height(x,z-1.5))/3;
   c.copy(lush).lerp(grass,n).lerp(earth,sm(.35,.9,sl)*.7).lerp(dry,sm(10,24,h)*.6).lerp(far,sm(120,220,d)*.6).lerp(rock,sm(30,55,h)).lerp(snow,sm(62,80,h)).lerp(sand,sm(-.25,-1.2,h)*(z>120||x<-100?1:.5));
   // Outer coast: pale sand in the coves, bare rock on bluffs and stacks, golden terraces, dark chaparral on the slopes.
   {const co=coastAt(x);if(co.w>0){const u=co.zc-z,cw=co.w*sm(260,120,u);if(cw>0){c.lerp(chap,cw*sm(.25,.7,sl)*sm(4,14,h)*.8).lerp(gold,cw*(1-sm(.15,.45,sl))*sm(3,6,h)*.7).lerp(cliffRock,cw*sm(1.1,2.1,sl)*.85).lerp(sand,cw*sm(2.4,1.2,h)*sm(-14,-2,u)*(1-sm(.5,1,sl)));}}}
   c.lerp(seabed,sm(-.9,-2.8,h)*(z>88?1:0));
   c.lerp(grass,1-sm(0,10,d));C.set([c.r,c.g,c.b],(j*nx+i)*3);}
  const pos:number[]=[],col:number[]=[],idx:number[]=[];const vid=new Int32Array(nx*nz).fill(-1);
  const v=(i:number,j:number)=>{const k=j*nx+i;if(vid[k]<0){vid[k]=pos.length/3;pos.push(xs[i],H[k],zs[j]);col.push(C[k*3],C[k*3+1],C[k*3+2]);}return vid[k];};
  for(let j=1;j<nz;j++)for(let i=1;i<nx;i++){const cx=(xs[i-1]+xs[i])/2,cz=(zs[j-1]+zs[j])/2;if(cx>INNER[0]&&cx<INNER[2]&&cz>INNER[1]&&cz<INNER[3])continue;
   const a=v(i-1,j-1),b=v(i,j-1),cc=v(i,j),dd=v(i-1,j);idx.push(a,cc,b,a,dd,cc);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));g.setIndex(idx);g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();geos.push(g);
  const m=mats.get('ground');const mesh=new THREE.Mesh(g,m);mesh.name='Regions cosmetic ground terrain (scenery only; no native support)';mesh.receiveShadow=true;mesh.matrixAutoUpdate=false;group.add(mesh);this.drawn=groundTriangleSampler(mesh);
  // The terrain never stands between a Broadcast camera and a subject (it has a hole over the inhabited
  // rectangle and stays flat near it), so it is kept out of camera rays. A one-triangle opaque anchor below
  // the promenade shares its material, so the realism pass still finishes the (shared) ground material.
  mesh.userData.cameraTransparent=true;
  {const ag=new THREE.BufferGeometry();ag.setAttribute('position',new THREE.Float32BufferAttribute([108,-.6,0,109,-.6,0,108.5,-.6,-1],3));ag.setAttribute('color',new THREE.Float32BufferAttribute([.5,.6,.4,.5,.6,.4,.5,.6,.4],3));ag.computeVertexNormals();ag.computeBoundingSphere();geos.push(ag);
   const anchor=new THREE.Mesh(ag,m);anchor.name='Regions cosmetic ground terrain realism anchor (hidden below ground)';anchor.matrixAutoUpdate=false;group.add(anchor);}
  return idx.length/3;}
 /** Ribbon path following this terrain. pts in xz; width w; lift above ground. */
 ribbon(b:Builder,pts:[number,number][],w:number,color:string,k:'path'|'stone'='path',lift=.04,step=1.5){
  const cc=new THREE.Color(color);
  for(let s=1;s<pts.length;s++){const [ax,az]=pts[s-1],[bx,bz]=pts[s],L=Math.hypot(bx-ax,bz-az),n=Math.max(1,Math.ceil(L/step)),ux=(bx-ax)/L,uz=(bz-az)/L,px=-uz*w/2,pz=ux*w/2;
   // E2 #9: quads along a straight run meet edge to edge (they overlapped by w/4 in the same plane with slightly different
   // shades, which flickered as stripes along every path); only the last quad before a bend reaches past the corner,
   // 3 mm lower so the next run's own surface stays on top.
   for(let i=0;i<n;i++){const bend=i+1===n&&s+1<pts.length,t0=i/n*L,t1=(i+1)/n*L;if(this.rivers.length&&this.riverAt(ax+ux*(t0+t1)/2,az+uz*(t0+t1)/2,1.5))continue;const P=(t:number,sd:number,dy=0)=>{const x=ax+ux*t+px*sd,z=az+uz*t+pz*sd;return [x,this.height(x,z)+lift+dy,z];};
    const shade=cc.clone().offsetHSL(0,0,(noise(ax+t0,az)-.5)*.04);b.quad(k,P(t0,-1),P(t0,1),P(t1,1),P(t1,-1),shade);
    if(bend)b.quad(k,P(t1,-1,-.003),P(t1,1,-.003),P(t1+w*.25,1,-.003),P(t1+w*.25,-1,-.003),shade);}}}
}
