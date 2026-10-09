import * as THREE from 'three';
import {FACADE_PLAN,type FacadeBuilding,type FacadeOpening,type FacadeSide} from './plan.ts';
import {houseWindowPlacements} from '../eden-expansion-assets/eden-house-windows.ts';
/** Facade kit for Eden's plain box buildings (houses 1–4, library, office, tower house): one procedural set of
 * details read from the built walls (plan.ts, generated): a stone plinth, a cornice at the wall top and a string
 * course between storeys, quoins or pilasters at the corners, lintels and sills at the windows, shutters, flower
 * boxes and awnings on some, a hood and step at each door, downpipes with hopper heads, a chimney with pots, and
 * ivy climbing one wall of the older houses. All of it is ONE vertex-coloured, flat-shaded mesh (one draw, one
 * material), seeded per building so no two houses are dressed alike. Scenery only (camera-transparent, no
 * collision). Chimneys publish smoke sources for the atmosphere. Also dresses the rural cottage, the verandah house
 * and the farmhouse (scenery dwellings without places). */
type V3=[number,number,number];
type Style=FacadeBuilding['style'];
const PALETTE:Record<Style,{trim:string;base:string;quoin:string;shutters:string[];hood:string}>={
 brick:{trim:'#ece4d2',base:'#a99d88',quoin:'#d9cdb4',shutters:['#4f6d5a','#2f4f6f','#7a2f2a'],hood:'#3f4a46'},
 plaster:{trim:'#f4eee2',base:'#a7a08f',quoin:'#e4d9c5',shutters:['#5b7f8c','#8a6a3a','#4f6d5a'],hood:'#7a2f2a'},
 timber:{trim:'#5e412b',base:'#8f877a',quoin:'#6e4c32',shutters:['#355e3b','#7a2f2a','#2f4f5f'],hood:'#4a3423'},
 stone:{trim:'#dad3c3',base:'#958d7c',quoin:'#cbc2af',shutters:['#2f4f5f','#4f6d5a','#6a4a6a'],hood:'#3a3f42'},
};
const FLOWERS=['#d9485f','#f1c84b','#e86aa8','#f4f1e8','#9b6fd1','#ff8a3d'];
const LEAVES=['#3f6e33','#4c7f3c','#355f2b','#5a8a3f','#2f5428'];
function rng(seed:number){let s=Math.floor(seed*2147483646)+1;return()=>(s=(s*16807)%2147483647)/2147483647;}
class Soup{
 p:number[]=[];n:number[]=[];c:number[]=[];private col=new THREE.Color();
 /** Axis-aligned box in a side frame: centre `at` (world), half sizes along the side's along/up/out axes. */
 box(at:V3,hx:number,hy:number,hz:number,ax:THREE.Vector3,out:THREE.Vector3,color:string,tilt=0){
  this.col.set(color);const up=new THREE.Vector3(0,1,0),o=out.clone(),u=up.clone();
  if(tilt){o.applyAxisAngle(ax,tilt);u.applyAxisAngle(ax,tilt);}
  const X=ax.clone().multiplyScalar(hx),Y=u.multiplyScalar(hy),Z=o.multiplyScalar(hz),c=new THREE.Vector3(...at);
  const corner=(sx:number,sy:number,sz:number)=>c.clone().addScaledVector(X,sx).addScaledVector(Y,sy).addScaledVector(Z,sz);
  const faces:[THREE.Vector3,number[][]][]=[[Z.clone().normalize(),[[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]]],[Z.clone().normalize().negate(),[[1,-1,-1],[-1,-1,-1],[-1,1,-1],[1,1,-1]]],
   [X.clone().normalize(),[[1,-1,1],[1,-1,-1],[1,1,-1],[1,1,1]]],[X.clone().normalize().negate(),[[-1,-1,-1],[-1,-1,1],[-1,1,1],[-1,1,-1]]],
   [Y.clone().normalize(),[[-1,1,1],[1,1,1],[1,1,-1],[-1,1,-1]]],[Y.clone().normalize().negate(),[[-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,1]]]];
  for(const [nrm,q] of faces){const v=q.map(([a,b,d])=>corner(a,b,d));
   // keep counter-clockwise winding seen from outside
   const e=new THREE.Vector3().subVectors(v[1],v[0]).cross(new THREE.Vector3().subVectors(v[2],v[0]));if(e.dot(nrm)<0)v.reverse();
   for(const i of [0,1,2,0,2,3]){this.p.push(v[i].x,v[i].y,v[i].z);this.n.push(nrm.x,nrm.y,nrm.z);this.c.push(this.col.r,this.col.g,this.col.b);}}
 }
}
type Frame={line:number;edge:FacadeSide['edge'];ax:THREE.Vector3;out:THREE.Vector3;lo:number;hi:number};
function frameOf(r:FacadeBuilding['rect'],edge:FacadeSide['edge']):Frame{
 const [x0,z0,x1,z1]=r;
 switch(edge){case 'n':return{line:z0,edge,ax:new THREE.Vector3(1,0,0),out:new THREE.Vector3(0,0,-1),lo:x0,hi:x1};
  case 's':return{line:z1,edge,ax:new THREE.Vector3(1,0,0),out:new THREE.Vector3(0,0,1),lo:x0,hi:x1};
  case 'w':return{line:x0,edge,ax:new THREE.Vector3(0,0,1),out:new THREE.Vector3(-1,0,0),lo:z0,hi:z1};
  default:return{line:x1,edge,ax:new THREE.Vector3(0,0,1),out:new THREE.Vector3(1,0,0),lo:z0,hi:z1};}
}
/** World point on a side: `a` along it, `y` up, `d` out from the wall face. */
const pt=(f:Frame,a:number,y:number,d:number):V3=>f.edge==='n'||f.edge==='s'?[a,y,f.line+f.out.z*d]:[f.line+f.out.x*d,y,a];
/** Windows the house kit adds on solid walls (houses 3/4) join the plan's openings. */
function extraWindows(b:FacadeBuilding,f:Frame):FacadeOpening[]{
 if(!b.id.startsWith('eden-house-'))return[];const out:FacadeOpening[]=[];
 for(const w of houseWindowPlacements()){if(w.kind!=='facade')continue;const [x,y,z]=w.at;
  const along=f.edge==='n'||f.edge==='s'?x:z,across=f.edge==='n'||f.edge==='s'?z:x;
  if(Math.abs(across-f.line)>.4||along<f.lo-.1||along>f.hi+.1)continue;
  if(x<b.rect[0]-.5||x>b.rect[2]+.5||z<b.rect[1]-.5||z>b.rect[3]+.5)continue;
  out.push({at:along,w:w.width,y0:y-w.height/2,y1:y+w.height/2});}
 return out;
}
export function buildFacades(plan:readonly FacadeBuilding[]=FACADE_PLAN){
 const s=new Soup(),smoke:[number,number,number,number][]=[];let buildings=0;
 for(const b of plan){const r=rng(b.seed),P=PALETTE[b.style];buildings++;
  const shutter=P.shutters[Math.floor(r()*P.shutters.length)],ivySide=b.style!=='plaster'&&r()<.75?Math.floor(r()*b.sides.length):-1;
  b.sides.forEach((side,si)=>{const f=frameOf(b.rect,side.edge),len=f.hi-f.lo,top=side.top;
   const windows=[...side.windows,...extraWindows(b,f).filter(w=>!side.windows.some(o=>Math.abs(o.at-w.at)<.3&&Math.abs(o.y0-w.y0)<.4))];
   const doors=side.doors;
   // plinth (stone band) except across doorways
   // Leave a 1 cm decorative reveal: band end faces must not coincide with doorway jambs/casing.
   const cuts=doors.map(d=>[d.at-d.w/2-.01,d.at+d.w/2+.01]).sort((a,c)=>a[0]-c[0]);let a0=f.lo-.07;
   for(const [c0,c1] of [...cuts,[f.hi+.07,f.hi+.07]]){if(c0-a0>.05)s.box(pt(f,(a0+c0)/2,.22,.035),(c0-a0)/2,.22,.05,f.ax,f.out,P.base);a0=c1;}
   // cornice at the wall top (projecting, wrapping the corners), and a string course between storeys
   s.box(pt(f,(f.lo+f.hi)/2,top-.11,.07),len/2+.16,.11,.1,f.ax,f.out,P.trim);
   s.box(pt(f,(f.lo+f.hi)/2,top-.27,.03),len/2+.06,.05,.06,f.ax,f.out,P.trim);
   if(top>4.6)for(let y=2.9;y<top-1.5;y+=2.9){if(!windows.some(w=>w.y0<y+.1&&w.y1>y-.1))s.box(pt(f,(f.lo+f.hi)/2,y,.03),len/2+.05,.06,.06,f.ax,f.out,P.trim);}
   // corners: quoins on brick/stone, pilasters on plaster/timber
   for(const end of [f.lo,f.hi]){const sign=end===f.lo?1:-1;
    if(b.style==='brick'||b.style==='stone'){for(let y=.45,k=0;y<top-.45;y+=.42,k++){const w=k%2?.32:.48;s.box(pt(f,end+sign*(w/2-.01),y+.19,.025),w/2,.18,.04,f.ax,f.out,P.quoin);}}
    else s.box(pt(f,end+sign*.12,(top-.3)/2+.2,.025),.12,(top-.5)/2,.04,f.ax,f.out,P.quoin);}
   // windows: lintel, sill, shutters, flower boxes / awnings
   for(const w of windows){const h=w.y1-w.y0,cx=w.at;
    s.box(pt(f,cx,w.y1+.08,.04),w.w/2+.12,.08,.06,f.ax,f.out,b.style==='timber'?P.trim:P.quoin);
    s.box(pt(f,cx,w.y0-.04,.08),w.w/2+.1,.04,.1,f.ax,f.out,P.quoin);
    if(w.w<=1.7&&h<=2&&b.style!=='stone'&&r()<.7){for(const sd of [-1,1]){const sw=Math.min(.55,w.w/2),c=cx+sd*(w.w/2+sw/2+.05);
      s.box(pt(f,c,(w.y0+w.y1)/2,.05),sw/2,h/2,.025,f.ax,f.out,shutter);
      for(let k=1;k<4;k++)s.box(pt(f,c,w.y0+h*k/4,.08),sw/2-.04,.02,.012,f.ax,f.out,'#2b2b2b');}}
    if(w.y0<2&&w.y0>.4&&!/house-|library/.test(b.id)&&r()<.6){s.box(pt(f,cx,w.y0-.16,.16),w.w/2+.04,.09,.11,f.ax,f.out,'#6e4a30');
     for(let k=0;k<6;k++){const fx=cx-w.w/2+.1+(w.w-.2)*(k+.5)/6;s.box(pt(f,fx,w.y0-.03+r()*.05,.16),.06,.06,.06,f.ax,f.out,k%2?LEAVES[k%LEAVES.length]:FLOWERS[Math.floor(r()*FLOWERS.length)]);}}
    if(b.id==='eden-office-1'&&side.edge==='s'&&w.y0<2){for(let k=0;k<5;k++)s.box(pt(f,cx-w.w/2-.08+(w.w+.16)*(k+.5)/5,w.y1+.3,.38),(w.w+.16)/10,.025,.36,f.ax,f.out,k%2?'#f4f1e8':'#3f8481',-.45);}
   }
   // doors: hood on brackets and a step
   for(const d of doors){s.box(pt(f,d.at,d.y1+.28,.38),d.w/2+.28,.045,.4,f.ax,f.out,P.hood,-.18);
    for(const sd of [-1,1])s.box(pt(f,d.at+sd*(d.w/2+.2),d.y1+.12,.16),.04,.14,.16,f.ax,f.out,P.trim);
    s.box(pt(f,d.at,d.y1+.06,.03),d.w/2+.1,.06,.05,f.ax,f.out,P.quoin);}
   // downpipes at both ends of the two longest sides, with a hopper head under the cornice
   // one downpipe per corner: each side takes the corner at its own clockwise end
   if(len>3.5)for(const end of [side.edge==='n'||side.edge==='e'?f.hi-.22:f.lo+.22]){s.box(pt(f,end,top/2-.1,.1),.045,top/2-.15,.045,f.ax,f.out,'#4a4f4d');s.box(pt(f,end,top-.4,.12),.09,.1,.07,f.ax,f.out,'#4a4f4d');}
   // ivy: a climbing patch on one wall, clear of the windows
   if(si===ivySide){const cx=f.lo+len*(.2+.6*r()),w0=Math.min(2.2,len*.4),hgt=Math.min(top-.3,2.2+r()*2.5);
    for(let k=0;k<160;k++){const t=Math.pow(r(),.6),y=.1+t*hgt,spread=w0*(1-t*.6)*(.5+.5*r()),a=cx+(r()-.5)*spread;
     if(windows.some(w=>Math.abs(a-w.at)<w.w/2+.08&&y>w.y0-.1&&y<w.y1+.15)||a<f.lo+.05||a>f.hi-.05)continue;
     s.box(pt(f,a,y,.035+r()*.03),.07+r()*.05,.06+r()*.04,.012,f.ax,f.out,LEAVES[Math.floor(r()*LEAVES.length)]);}}
  });
  // chimney on the houses' highest roof, near its back edge
  if(/house|cottage|farmhouse/.test(b.id)){const hi=b.sides.reduce((m,x)=>x.top>m.top?x:m,b.sides[0]),f=frameOf(b.rect,hi.edge),a=f.lo+(f.hi-f.lo)*(.25+.5*r());
   const base=pt(f,a,hi.top+.55,-.55),brick=b.style==='stone'?'#8f877a':'#8a4a36';
   s.box(base,.3,.6,.3,f.ax,f.out,brick);s.box([base[0],hi.top+1.18,base[2]],.37,.04,.37,f.ax,f.out,P.trim);
   for(const sd of [-1,1])s.box(pt(f,a+sd*.12,hi.top+1.36,-.55),.07,.15,.07,f.ax,f.out,'#a3442f');
   smoke.push([base[0],hi.top+1.55,base[2],.45]);}
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(s.p,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(s.n,3));g.setAttribute('color',new THREE.Float32BufferAttribute(s.c,3));
 g.computeBoundingSphere();g.computeBoundingBox();
 return {geometry:g,smoke,buildings,triangles:s.p.length/9};
}
export function createEdenFacades(ground:(x:number,z:number)=>number|null){
 if(typeof ground!=='function')return null;
 // Only on the flat native ground these buildings stand on.
 for(const b of FACADE_PLAN){const [x0,z0,x1,z1]=b.rect,y=ground((x0+x1)/2,(z0+z1)/2);if(y===null||!Number.isFinite(y)||Math.abs(y)>1e-3)return null;}
 const {geometry,smoke,triangles,buildings}=buildFacades();
 const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.86,metalness:0});material.name='Eden facade details';
 const mesh=new THREE.Mesh(geometry,material);mesh.name='Eden facade details (scenery only)';mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData.cameraTransparent=true;
 const group=new THREE.Group();group.name='Eden facades (scenery only)';group.add(mesh);group.userData.edenSmokeSources=smoke;
 let closed=false;
 return {group,stats:{draws:1,triangles,buildings},dispose(){if(closed)return;closed=true;group.removeFromParent();geometry.dispose();material.dispose();}};
}
