import * as T from 'three';
import {Kit,layers} from './kit';
import {GROUND} from '../studio/ambience-math';

/** Occupied Mimos furniture from DSCF1259/1263/1264 and IMG6074.
 * Counts reproduce these views, not a season-wide census. Annex-local layout
 * is fitted; photo and CAD floor checks distinguish plywood from mat on sand. */
export function add2026MimosHome(root:T.Group){
 let cafe:T.Object3D|undefined;
 root.traverse(o=>{if(o.userData.assembly_id==='mimos-details'&&!o.userData.component_id)cafe=o;});
 if(!cafe)return;
 if(cafe.children.some(o=>o.userData.assembly_id==='mimos-home'))return;
 const k=new Kit(2026),g=k.assembly('mimos-home','Mimos · occupied lounge and study corner',[0,0,0],0,'DSCF1259/1263/1264; IMG6074: occupied cafe furniture; dimensions and exact arrangement fitted');
 const box=(name:string,size:[number,number,number],p:[number,number,number],color:string)=>k.box(g,name,size,p,color,layers.detail);
 const round=(name:string,r:number,h:number,p:[number,number,number],color:string)=>{const m=new T.Mesh(new T.CylinderGeometry(r,r,h,12),k.mat(color));m.position.set(...p);k.tag(g,m,name,layers.detail);return m;};
 const photo=(name:string,w:number,h:number,p:[number,number,number],url:string,horizontal=false)=>{const m=new T.Mesh(new T.PlaneGeometry(w,h),k.photo(url));m.position.set(...p);if(horizontal)m.rotation.x=-Math.PI/2;k.tag(g,m,name,layers.detail);m.userData.walkNoCollision=true;return m;};
 // The raised-floor table and mismatched chairs appear behind the red fridge
 // in DSCF1259/1263. This is separate from the low glazed-bay tea table.
 box('Mimos folding study tabletop',[1.80,.045,.70],[.15,.735,-2.30],'#ddd9c9');
 for(const x of [-.57,.87])for(const z of [-2.55,-2.05])box('Mimos study table leg',[.035,.712,.035],[x,.356,z],'#777f78');
 for(const x of [-.57,.87])k.rod(g,'Mimos folding table diagonal',[x,.12,-2.57],[x,.70,-2.03],.012,'#646d66',layers.detail);
 // Three dark ladder-back/perforated chairs and one pale folding chair:
 // observed varieties, positioned around the photographed study table.
 const chair=(x:number,z:number,yaw:number,light=false,perforated=false,base=0)=>{
  const parts:T.Object3D[]=[];const before=new Set(g.children),color=light?'#c8c5b9':'#343731';
  box('Mimos study chair seat',[.44,.055,.43],[0,base+.46,0],light?'#cac7bb':'#46473f');
  for(const xx of [-.18,.18])for(const zz of [-.17,.17])box('Mimos chair grounded leg',[.025,.432,.025],[xx,base+.216,zz],color);
  for(const xx of [-.18,.18])box('Mimos chair back upright',[.028,.57,.03],[xx,base+.715,-.18],color);
  if(perforated){
   for(let i=0;i<6;i++)box('Mimos perforated chair back slat',[.025,.30,.025],[-.16+i*.064,base+.83,-.18],color);
   for(const yy of [.68,.98])box('Mimos perforated chair back rim',[.39,.03,.03],[0,base+yy,-.18],color);
  }else for(const yy of [.70,.83,.96])box('Mimos ladder chair back slat',[.39,.055,.028],[0,base+yy,-.18],color);
  for(const o of g.children)if(!before.has(o))parts.push(o);
  for(const o of parts){o.position.applyAxisAngle(new T.Vector3(0,1,0),yaw).add(new T.Vector3(x,0,z));o.rotation.y+=yaw;}
 };
 chair(-.50,-1.68,0);chair(.63,-1.68,0,false,true);chair(.15,-2.93,Math.PI,true);chair(1.20,-2.32,-Math.PI/2);
 // Open books and tea cups make the actual study use legible, without
 // freezing source people or reproducing private laptop screen contents.
 for(const [i,color]of ['#8b5b45','#e1d8c2','#586b7d','#b0a07c','#ded8c6'].entries())box('Mimos study book stack',[.24,.025,.17],[-.47,.773+i*.026,-2.34],color);
 box('Mimos open study book left',[.19,.015,.25],[.32,.772,-2.26],'#e5dfca');
 box('Mimos open study book right',[.19,.015,.25],[.515,.772,-2.26],'#e5dfca');
 for(const x of [.80,1.00]){const mug=round('Mimos study ceramic mug',.045,.08,[x,.80,-2.30],'#cec5b5');mug.geometry=new T.CylinderGeometry(.045,.042,.08,12,1,true);round('Mimos study mug coffee',.038,.006,[x,.827,-2.30],'#493627');round('Mimos study mug bottom',.042,.006,[x,.763,-2.30],'#cec5b5');const handle=new T.Mesh(new T.TorusGeometry(.030,.007,5,10),k.mat('#cec5b5'));handle.position.set(x+.051,.81,-2.30);k.tag(g,handle,'Mimos study mug handle',layers.detail);}
 round('Mimos study black insulated flask',.065,.27,[.03,.89,-2.41],'#303735');
 // Raised-floor rug uses only native photographed rug pixels, not a generated
 // substitute pattern. Bookroom furnishings touch the .37m CAD deck.
 photo('Mimos photographed burgundy floor rug',2.80,1.80,[.20,.012,-2.16],'/history/2026/home/mimos-rug.webp',true);
 // A whiteboard in the study area is confirmed by both native views; this
 // preserves its physical frame without inventing unseen marker writing.
 box('Mimos study whiteboard',[1.37,.95,.035],[.08,1.28,-3.22],'#e3e2d5');
 for(const x of [-.63,.79])box('Mimos whiteboard side frame',[.025,1.0,.045],[x,1.28,-3.22],'#8d9288');
 for(const y of [.79,1.77])box('Mimos whiteboard top bottom frame',[1.44,.025,.045],[.08,y,-3.22],'#8d9288');
 box('Mimos whiteboard marker ledge',[1.25,.025,.075],[.08,.795,-3.16],'#a1a79e');
 for(const x of [-.61,.77]){
  const leg=box('Mimos fitted whiteboard support',[.035,.80,.035],[x,.40,-3.24],'#8b9187');leg.userData.source='Whiteboard observed DSCF1259/1263; support stand is inferred, fixing method unresolved';
  box('Mimos fitted whiteboard stand foot',[.05,.02,.30],[x,.01,-3.24],'#8b9187').userData.source=leg.userData.source;
 }
 // Ground-level lounge: the native DSCF1264 papasan has a round cane base,
 // brown cushion and curved back; no block-shaped substitute armchair.
 const base=GROUND-.37;
 const loungeBefore=new Set(g.children);
 const papasan=(x:number,z:number,yaw:number)=>{
  const before=new Set(g.children);
  round('Mimos papasan cane pedestal',.29,.22,[0,base+.11,0],'#896443');
  const rim=new T.Mesh(new T.TorusGeometry(.59,.035,6,24),k.mat('#9c7550'));rim.rotation.x=Math.PI/2-.30;rim.position.set(0,base+.63,0);k.tag(g,rim,'Mimos papasan round cane rim',layers.detail);
  const cushion=new T.Mesh(new T.SphereGeometry(1,16,10),k.mat('#b08a61'));cushion.scale.set(.59,.13,.58);cushion.rotation.x=-.30;cushion.position.set(0,base+.57,0);k.tag(g,cushion,'Mimos papasan broad brown cushion',layers.detail);
  const back=new T.Mesh(new T.SphereGeometry(1,16,10),k.mat('#b08a61'));back.scale.set(.60,.47,.15);back.rotation.x=-.28;back.position.set(0,base+.88,-.34);k.tag(g,back,'Mimos papasan curved brown back',layers.detail);
  for(let i=0;i<10;i++){const a=2*Math.PI*i/10;k.rod(g,'Mimos papasan cane spoke',[.26*Math.cos(a),base+.21,.26*Math.sin(a)],[.55*Math.cos(a),base+.63-.16*Math.sin(a),.55*Math.sin(a)],.012,'#a98253',layers.detail);}
  for(const o of g.children)if(!before.has(o)){o.position.applyAxisAngle(new T.Vector3(0,1,0),yaw).add(new T.Vector3(x,0,z));o.rotation.y+=yaw;}
 };
 papasan(1.85,1.57,-Math.PI/2);
 // IMG6074 clearly shows dark stools around the low tea table. Three are
 // modeled; hidden seats/census intentionally left unresolved.
 for(const [x,z]of [[-.75,1.55],[.06,.77],[-.72,2.12]]){
  round('Mimos glazed tea table stool',.18,.05,[x,base+.40,z],'#353b34');
  for(const [dx,dz]of [[-.12,-.12],[.12,-.12],[0,.13]])box('Mimos tea stool grounded leg',[.025,.375,.025],[x+dx,base+.1875,z+dz],'#3c443c');
 }
 for(const o of g.children)if(!loungeBefore.has(o))o.userData.support='ground-level glazed bay; CAD floor absent, IMG6074/DSCF1264';
 // Mug/food jar/book details around existing tea table, all source observed.
 for(const [x,z,color]of [[-.17,1.42,'#584230'],[.05,1.52,'#4b4636'],[-.30,1.70,'#8b6950']]as const)round('Mimos shared tea jar',.055,.13,[x,base+.615,z],color);
 box('Mimos shared tea book',[.27,.025,.17],[.02,base+.565,1.80],'#d8c5a0');
 // Source ceiling festoon: emissive globes rather than costly local lights.
 const bulbs=new T.MeshStandardMaterial({color:'#eee1c2',emissive:'#dacba7',emissiveIntensity:.35,roughness:.7});
 for(let i=0;i<9;i++){const x=-1.4+i*.40,y=2.33-.12*Math.sin(Math.PI*i/8),z=-2.1;const m=new T.Mesh(new T.SphereGeometry(.035,8,6),bulbs);m.position.set(x,y,z);k.tag(g,m,'Mimos source festoon globe',layers.detail);m.userData.walkNoCollision=true;if(i)k.rod(g,'Mimos festoon cable',[-1.4+(i-1)*.40,2.33-.12*Math.sin(Math.PI*(i-1)/8),z],[x,y,z],.003,'#454a3f',layers.detail);}
 g.userData.accuracy='Furniture forms observed; exact occupancy/layout is fitted. Study set represents DSCF1259/1263, low tea zone IMG6074, papasan DSCF1264. No claim all furniture occupied identical positions at once.';
 k.finalize();cafe.add(g);return g;
}
