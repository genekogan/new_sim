import * as THREE from 'three';
import type {Ground} from '../eden-expansion-assets/venue.ts';
import {box,cone,cyl,mergeParts,type Part} from '../eden-street-props/kit.ts';
/** World wayfinding on the commons (WN2): finger posts that point at the places a Soul can walk to
 * today, and a "What's on today" board with the daily happenings at those places (mirrors the
 * schedules in worlds/eden/places.v1.json; a test keeps them in sync). Visual scenery only:
 * no collision, support or interaction. Two draws: one merged wood mesh, one lettering atlas
 * (browser only). Everything is camera-transparent and casts no shadow. */
export const WAYPOINTS:Readonly<Record<string,readonly [number,number]>>={
 'Fire circle':[24,-7],'Long table':[23,6],'Classroom':[42,2],'Pond':[-50,0],'Pond bank':[-37.5,0],
 'Commons':[9,4],'Stage':[9,-1.8],'Kitchen':[-13,4],'Sleeping mats':[-14,20],
 // WN16: places Core admitted for walking (east side and north woods)
 'Stone garden':[57,-10],'Bandstand':[38.5,-26],'Kiosks':[57.5,-26.5],'North woods':[5,-40],'Gardens':[53,50],
 'Market hall':[70,29],'Tea house':[92.5,4.5],'Dome':[99.2,36.5],'Amphitheatre':[76,81.4],
};
/** Finger posts: where they stand and which waypoints their fingers name (top to bottom). */
export const FINGERPOSTS:readonly {at:readonly [number,number];to:readonly string[]}[]=[
 {at:[16.2,.8],to:['Fire circle','Long table','Classroom','Pond']},
 {at:[-3.5,-1.2],to:['Pond','Fire circle','Kitchen','Sleeping mats']},
 {at:[-27.6,-3.5],to:['Pond','Commons','Fire circle']},
 {at:[31.5,1.5],to:['Classroom','Stone garden','Tea house','Long table']},
 {at:[31,-22.5],to:['Bandstand','Kiosks','North woods','Classroom']},
 {at:[62.5,18],to:['Market hall','Dome','Gardens','Amphitheatre']},
];
/** The daily happenings at walkable places, in the order of the day (world clock). */
export const WHATS_ON:readonly (readonly [string,string,string])[]=[
 ['06:00','Dawn tea','Fire circle'],['07:00','Morning swim','Pond'],['08:00','Shared breakfast','Long table'],['09:00','Morning circle','Dome'],
 ['09:30','Sketching by the water','Pond bank'],['10:30','Skill share','Classroom'],['12:45','Shared lunch','Long table'],
 ['13:30','Chess and slow talk','Fire circle'],['14:30','Quiet study hour','Classroom'],['15:00','Afternoon swim','Pond'],['15:30','Afternoon tea','Tea house'],
 ['16:00','Tea and cards','Long table'],['16:00','Walk in the woods','North woods'],['17:00','Open mic','Stage'],['17:30','Music','Bandstand'],['18:00','Sunset performance','Amphitheatre'],['18:15','Sunset watch','Pond bank'],
 ['19:15','Shared dinner','Long table'],['20:30','Evening fire, stories','Fire circle'],['22:30','Late embers','Fire circle'],
 ['23:30','Sleep (any free mat)','Sleeping mats'],['01:00','Stargazing','Pond bank'],
];
/** The board stands just east of the lawn and faces it. */
export const BOARD={at:[15.6,7.7] as const,face:[9,4.5] as const};
const FINGER_COLOURS=['#efe2c0','#d9e6d0','#efd9c9','#dfe3ee'];
const yawTo=(x:number,z:number,[tx,tz]:readonly [number,number])=>Math.atan2(-(tz-z),tx-x);
type Label={text:string;fg:string;bg?:string;w:number;h:number;align?:'left'|'center'};
type Quad={label:Label;m:THREE.Matrix4};
export type WayfindingStats={draws:number;fingers:number;lines:number};
/** Geometry (world space) and lettering quads; exported for the test. */
export function wayfindingParts(ground:Ground):{parts:Part[];quads:Quad[];fingers:number}|null{
 const parts:Part[]=[],quads:Quad[]=[],o=new THREE.Object3D();let fingers=0;
 const quad=(label:Label,x:number,y:number,z:number,ry:number)=>{o.position.set(x,y,z);o.rotation.set(0,ry,0);o.updateMatrixWorld(true);quads.push({label,m:o.matrixWorld.clone()});};
 for(const post of FINGERPOSTS){const [x,z]=post.at,y=ground(x,z);if(typeof y!=='number'||!Number.isFinite(y))return null;
  parts.push(box(.1,2.6,.1,'#5e4630',x,y+1.3,z),cone(.09,.14,'#3f3a33',x,y+2.67,z,4,[0,Math.PI/4,0]),cyl(.12,.14,.08,'#4d4b45',x,y+.04,z,6));
  post.to.forEach((name,i)=>{const at=WAYPOINTS[name];if(!at)throw Error('unknown waypoint '+name);const ry=yawTo(x,z,at),c=FINGER_COLOURS[i%FINGER_COLOURS.length],h=y+2.32-i*.24;
   const dx=Math.cos(ry),dz=-Math.sin(ry),L=.78,mid=.06+L/2;
   parts.push(box(L,.17,.035,c,x+dx*mid,h,z+dz*mid,[0,ry,0]),cone(.12,.14,c,x+dx*(.06+L+.07),h,z+dz*(.06+L+.07),3,[0,ry,-Math.PI/2]));
   const nx=Math.sin(ry),nz=Math.cos(ry),label={text:name,fg:'#2b2620',w:.66,h:.12};
   for(const s of [1,-1])quad(label,x+dx*(mid-.02)+nx*s*.021,h,z+dz*(mid-.02)+nz*s*.021,ry+(s<0?Math.PI:0));
   fingers++;});}
 // "What's on today": two posts, a slate panel with a timber frame and a flat drip cap, two columns of lines.
 const [bx,bz]=BOARD.at,by=ground(bx,bz);if(typeof by!=='number'||!Number.isFinite(by))return null;
 const ry=Math.atan2(BOARD.face[0]-bx,BOARD.face[1]-bz),ax=Math.cos(ry),az=-Math.sin(ry),nx=Math.sin(ry),nz=Math.cos(ry);
 const at=(u:number,v:number,w:number):[number,number,number]=>[bx+ax*u+nx*w,by+v,bz+az*u+nz*w];
 const W=2.3,H=1.25,CY=1.45;
 for(const u of [-W/2-.06,W/2+.06])parts.push(box(.1,2.2,.1,'#6e4a30',...at(u,1.1,0),[0,ry,0]));
 parts.push(box(W+.16,H+.16,.06,'#8b6a48',...at(0,CY,0),[0,ry,0]),box(W,H,.02,'#2f3a36',...at(0,CY,.04),[0,ry,0]),box(W+.5,.06,.42,'#5a4a3a',...at(0,CY+H/2+.2,.02),[0,ry,0]));
 quad({text:"WHAT'S ON TODAY",fg:'#f4e7b8',w:1.3,h:.13,align:'center'},...at(0,CY+H/2-.12,.052),ry);
 const rows=Math.ceil(WHATS_ON.length/2),lh=(H-.3)/rows;
 WHATS_ON.forEach(([t,what,where],i)=>{const col=i<rows?0:1,row=i%rows,u=-W/2+.1+col*W/2,v=CY+H/2-.28-row*lh;
  quad({text:t,fg:'#f0d36a',w:.2,h:.075,align:'left'},...at(u+.1,v,.052),ry);
  quad({text:`${what} · ${where}`,fg:'#eef0ea',w:.93,h:.075,align:'left'},...at(u+.2+.465,v,.052),ry);});
 return {parts,quads,fingers};
}
const CW=512,CH=64,COLS=2;
function lettering(quads:Quad[]){
 if(typeof document==='undefined'||typeof document.createElement!=='function'||!quads.length)return null;
 const keyOf=(l:Label)=>l.text+'\u0000'+l.fg+'\u0000'+(l.w/l.h).toFixed(2)+'\u0000'+(l.align??'center');
 const keys=[...new Set(quads.map(q=>keyOf(q.label)))],rows=Math.ceil(keys.length/COLS),canvas=document.createElement('canvas');
 canvas.width=CW*COLS;canvas.height=THREE.MathUtils.ceilPowerOfTwo(rows*CH);const g=canvas.getContext('2d');if(!g)return null;
 const cell=new Map<string,[number,number,number,number]>();
 keys.forEach((k,i)=>{const [text,fg,a,align]=k.split('\u0000'),aspect=+a,cx=(i%COLS)*CW,cy=Math.floor(i/COLS)*CH;
  const w=Math.min(CW,CH*aspect),h=Math.min(CH,CW/aspect),x0=cx+(CW-w)/2,y0=cy+(CH-h)/2;
  let size=Math.floor(h*.8);g.font=`600 ${size}px sans-serif`;const width=g.measureText(text).width;if(width>w*.94){size=Math.floor(size*w*.94/width);g.font=`600 ${size}px sans-serif`;}
  g.fillStyle=fg;g.textBaseline='middle';g.textAlign=align==='left'?'left':'center';g.fillText(text,align==='left'?x0+w*.02:x0+w/2,y0+h/2);
  cell.set(k,[x0/canvas.width,1-(y0+h)/canvas.height,(x0+w)/canvas.width,1-y0/canvas.height]);});
 const pos:number[]=[],uv:number[]=[],nor:number[]=[],v=new THREE.Vector3(),n=new THREE.Vector3(),n3=new THREE.Matrix3();
 for(const q of quads){const [u0,v0,u1,v1]=cell.get(keyOf(q.label))!,hw=q.label.w/2,hh=q.label.h/2;n3.getNormalMatrix(q.m);n.set(0,0,1).applyMatrix3(n3).normalize();
  for(const [x,y,u,w] of [[-hw,-hh,u0,v0],[hw,-hh,u1,v0],[hw,hh,u1,v1],[-hw,-hh,u0,v0],[hw,hh,u1,v1],[-hw,hh,u0,v1]] as const){v.set(x,y,0).applyMatrix4(q.m);pos.push(v.x,v.y,v.z);uv.push(u,w);nor.push(n.x,n.y,n.z);}}
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(nor,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.computeBoundingSphere();
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
 const material=new THREE.MeshStandardMaterial({name:'wayfinding lettering',map:texture,alphaTest:.5,roughness:.8,polygonOffset:true,polygonOffsetFactor:-2});
 const mesh=new THREE.Mesh(geometry,material);mesh.name='wayfinding:lettering';mesh.receiveShadow=true;mesh.userData.cameraTransparent=true;
 return {mesh,dispose(){geometry.dispose();material.dispose();texture.dispose();}};
}
export function createEdenWayfinding(ground:Ground):{group:THREE.Group;dispose():void;stats:WayfindingStats}|null{
 if(typeof ground!=='function')return null;const built=wayfindingParts(ground);if(!built)return null;
 const group=new THREE.Group();group.name='Eden wayfinding (scenery only)';
 const geometry=mergeParts(built.parts),material=new THREE.MeshStandardMaterial({name:'wayfinding painted wood',vertexColors:true,roughness:.8});
 const wood=new THREE.Mesh(geometry,material);wood.name='wayfinding:posts and boards';wood.receiveShadow=true;wood.userData.cameraTransparent=true;group.add(wood);
 let text:ReturnType<typeof lettering>=null;try{text=lettering(built.quads);if(text)group.add(text.mesh);}catch{text=null;}
 let closed=false;
 return {group,stats:{draws:group.children.length,fingers:built.fingers,lines:WHATS_ON.length},dispose(){if(closed)return;closed=true;group.removeFromParent();text?.dispose();geometry.dispose();material.dispose();group.clear();}};
}
