import * as THREE from 'three';
import {STREET_PROP_PLACEMENTS} from './placements.ts';
/** Legible signage for the street props: wayfinding arrows that point at the
 * real destinations, street-name blades, house numbers and shop/board text.
 * All labels share ONE canvas atlas texture and ONE merged mesh (one draw,
 * no shadows, camera-transparent). Needs a DOM canvas; returns null without. */
export const DESTINATIONS:readonly [string,number,number][]=[
 ['Library',74,-7],['Market',70,29],['Homes',44,20],['Gardens',57,47.5],['Dome',99.2,36.5],['Barn',88,51],['Bandstand',38.5,-26],
 ['Classroom',42,-8],['Commons',9,5],['Woodland',15,-35],['Amphitheatre',76,82],['Observatory',36.5,82],['Artists',68,-20],['Office',92,15],['Kiosks',57.5,-26],
];
/** Street names (rendered on blades at the signposted junctions and on street-name signs). */
export const STREET_NAMES={lantern:'Lantern Lane',market:'Market Way',garden:'Garden Row',orchard:'Orchard Lane',farm:'Farm Track',woodland:'Woodland Walk'} as const;
const N=STREET_NAMES;
/** Blade names per streetSign placement: [blade along local x, blade along local z]. */
export const STREET_SIGN_NAMES:readonly (readonly [string,string?])[]=[[N.lantern,N.market],[N.garden,N.market],[N.garden,N.farm],[N.orchard,N.market],[N.orchard,N.farm],[N.woodland]];
type Label={text:string;fg:string;bg?:string;w:number;h:number;font?:string};
type Quad={label:Label;m:THREE.Matrix4};
const PLAQUES=['1 Lantern Lane','2 Lantern Lane','3 Orchard Lane','4 Orchard Lane','5 Market Way','Eden Office','Farmhouse','The Barn'];
const HANGING=['LIBRARY','MARKET'];
const CHALK=['FRESH BREAD|EGGS · HONEY','LEMONADE|ICE TEA','SOUP OF|THE DAY','TONIGHT|MUSIC 8PM','WORKSHOP|ALL WELCOME'];
/** Signpost board frames in prop-local space: [centre, local yaw of the face normal, local pointing direction]. */
const BOARDS:[[number,number,number],number,[number,number]][]=[[[.37,2.18,.06],0,[1,0]],[[.06,1.94,.36],Math.PI/2,[0,1]],[[-.37,1.7,-.06],0,[-1,0]]];
export function signQuads():Quad[]{
 const out:Quad[]=[],o=new THREE.Object3D(),f=new THREE.Object3D();o.add(f);
 const place=(x:number,y:number,z:number,ry:number)=>{o.position.set(x,y,z);o.rotation.set(0,ry,0);o.updateMatrixWorld(true);};
 const face=(label:Label,lx:number,ly:number,lz:number,yaw:number,pitch=0)=>{f.position.set(lx,ly,lz);f.rotation.set(pitch,yaw,0,'YXZ');f.updateMatrixWorld(true);out.push({label,m:f.matrixWorld.clone()});};
 // Wayfinding: each board names the destination best aligned with where it actually points.
 for(const [x,z,ry] of STREET_PROP_PLACEMENTS.signpost??[]){
  place(x,0,z,ry);const used=new Set<string>();
  for(const [c,yaw,[dx,dz]] of BOARDS){
   const wx=dx*Math.cos(ry)+dz*Math.sin(ry),wz=-dx*Math.sin(ry)+dz*Math.cos(ry);let best:[string,number]|null=null;
   for(const [name,px,pz] of DESTINATIONS){const vx=px-x,vz=pz-z,d=Math.hypot(vx,vz);if(d<6||used.has(name))continue;const cos=(vx*wx+vz*wz)/d;if(cos<.8)continue;const score=cos-d/400;if(!best||score>best[1])best=[name,score];}
   if(!best)continue;used.add(best[0]);
   const label={text:best[0],fg:'#2b2620',w:.56,h:.12};
   const n=yaw===0?[0,0,1]:[1,0,0];
   for(const s of [1,-1])face(label,c[0]+n[0]*s*.02,c[1],c[2]+n[2]*s*.02,yaw+(s<0?Math.PI:0));
  }
 }
 const plaques=STREET_PROP_PLACEMENTS.plaque??[];
 plaques.forEach(([x,z,ry,,dy],i)=>{if(!PLAQUES[i])return;place(x,dy??0,z,ry);face({text:PLAQUES[i],fg:'#2f3633',w:.29,h:.17},0,0,.019,0);});
 (STREET_PROP_PLACEMENTS.chalkboard??[]).forEach(([x,z,ry],i)=>{place(x,0,z,ry);const t=CHALK[i%CHALK.length];
  for(const s of [1,-1])face({text:t,fg:'#f1efe6',w:.48,h:.6},0,.47,s*.165,s<0?Math.PI:0,-.32);});
 (STREET_PROP_PLACEMENTS.hangingSign??[]).forEach(([x,z,ry,,dy],i)=>{const t=HANGING[i];if(!t)return;place(x,dy??0,z,ry);for(const s of [1,-1])face({text:t,fg:'#2b4a48',w:.38,h:.24},s*.026,-.31,.43,s*Math.PI/2);});
 for(const [x,z,ry] of STREET_PROP_PLACEMENTS.busStop??[]){place(x,0,z,ry);for(const s of [1,-1])face({text:'BUS|Eden Loop',fg:'#2f5d7c',w:.44,h:.4},1.75,2.75,.5+s*.025,s<0?Math.PI:0);}
 (STREET_PROP_PLACEMENTS.streetSign??[]).forEach(([x,z,ry],i)=>{const name=STREET_SIGN_NAMES[i];if(!name)return;place(x,0,z,ry);const [a,b]=name;
  for(const s of [1,-1]){face({text:a,fg:'#f4f1e8',w:.74,h:.15},.44,2.5,s*.022,s<0?Math.PI:0);if(b)face({text:b,fg:'#f4f1e8',w:.74,h:.15},s*.022,2.3,.44,s*Math.PI/2);}});
 return out;
}
const CW=256,CH=96,COLS=4;
export function createEdenStreetSigns():{mesh:THREE.Mesh;texture:THREE.Texture;dispose():void}|null{
 if(typeof document==='undefined'||typeof document.createElement!=='function')return null;
 const quads=signQuads();if(!quads.length)return null;
 const keys=[...new Set(quads.map(q=>q.label.text+'\u0000'+q.label.fg+'\u0000'+(q.label.w/q.label.h).toFixed(2)))];
 const rows=Math.ceil(keys.length/COLS),H=THREE.MathUtils.ceilPowerOfTwo(rows*CH),canvas=document.createElement('canvas');canvas.width=CW*COLS;canvas.height=H;
 const g=canvas.getContext('2d');if(!g)return null;
 const cell=new Map<string,[number,number,number,number]>();
 keys.forEach((k,i)=>{const [text,fg,a]=k.split('\u0000'),aspect=+a,cx=(i%COLS)*CW,cy=Math.floor(i/COLS)*CH;
  const w=Math.min(CW,CH*aspect),h=Math.min(CH,CW/aspect),x0=cx+(CW-w)/2,y0=cy+(CH-h)/2,lines=text.split('|');
  let size=Math.floor(h/lines.length*.78);g.font=`600 ${size}px sans-serif`;const widest=Math.max(...lines.map(l=>g.measureText(l).width));if(widest>w*.9){size=Math.floor(size*w*.9/widest);g.font=`600 ${size}px sans-serif`;}
  g.fillStyle=fg;g.textAlign='center';g.textBaseline='middle';lines.forEach((l,j)=>g.fillText(l,x0+w/2,y0+h*(j+.5)/lines.length));
  cell.set(k,[x0/canvas.width,1-(y0+h)/canvas.height,(x0+w)/canvas.width,1-y0/canvas.height]);});
 const pos:number[]=[],uv:number[]=[],nor:number[]=[],v=new THREE.Vector3(),n=new THREE.Vector3(),n3=new THREE.Matrix3();
 for(const q of quads){const k=q.label.text+'\u0000'+q.label.fg+'\u0000'+(q.label.w/q.label.h).toFixed(2),[u0,v0,u1,v1]=cell.get(k)!,hw=q.label.w/2,hh=q.label.h/2;
  n3.getNormalMatrix(q.m);n.set(0,0,1).applyMatrix3(n3).normalize();
  const corners:[number,number,number,number][]=[[-hw,-hh,u0,v0],[hw,-hh,u1,v0],[hw,hh,u1,v1],[-hw,-hh,u0,v0],[hw,hh,u1,v1],[-hw,hh,u0,v1]];
  for(const [x,y,u,w] of corners){v.set(x,y,0).applyMatrix4(q.m);pos.push(v.x,v.y,v.z);uv.push(u,w);nor.push(n.x,n.y,n.z);}}
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(nor,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.computeBoundingSphere();
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
 const material=new THREE.MeshStandardMaterial({name:'street-props sign lettering',map:texture,alphaTest:.5,roughness:.8,polygonOffset:true,polygonOffsetFactor:-2});
 const mesh=new THREE.Mesh(geometry,material);mesh.name='street-props:sign lettering';mesh.castShadow=false;mesh.receiveShadow=true;mesh.userData.cameraTransparent=true;
 return {mesh,texture,dispose(){geometry.dispose();material.dispose();texture.dispose();}};
}
