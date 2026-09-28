import * as T from 'three';
import {Kit,BAY,layers,assignStableIds,type IdEntry,type KitHooks} from './kit';
import {aluminet2021,frontage2024} from './photographic-corrections';
import {createBrahman2020Scene} from '../studio-2020/scene';
export const YEARS=[2020,2021,2022,2023,2024,2025,2026] as const;
export const historyNotes:Record<number,string>={
 2020:'Portal, Forest and the public installations, with the separate trailer circle. March drone views and ground photographs; not a surveyed plan.',
 2021:'Two separate parallel buildings, an equally wide bare-ground corridor and draped silver aluminet. February flythrough and ground views; hidden room boundaries remain estimated.',
 2022:'Four buildings rotated around a square courtyard, with four open corner passages. Drone orbit, overhead and March rooftop views; dimensions remain a photographic fit.',
 2023:'Broad rooftop Chiba, inclined solar frontage and a separate kitchen across the trailer circle. Ground views and drone footage; concealed interiors are provisional.',
 2024:'Red Chiba façade: vertical inset with straight central stairs and the door landing, leaning flaps with stepped solar panels (left) and a plexiglass solarium (right), a plexiglass end wall with a door, and a separate kitchen. March façade photos, the 2024 front and solarium photos, January aerials; trailer locations may have changed.',
 2025:'Compact Chiba with long central steps, painted side walls and a separate kitchen / lounge. January aerials and February–March ground views.',
 2026:'Existing modular reconstruction and drone alignment, supplemented by kitchen, café and classroom photographs. Some dimensions and hidden interiors remain provisional.'};
function hall(k:Kit,id:string,name:string,x:number,z:number,nx:number,nz:number,h=4.8768,openAisle=false,depth=nz*BAY){const g=k.assembly(id,name,[x,0,z]);k.frame(g,nx,nz,h,true,depth);k.deck(g,nx*BAY,depth,.22);
 if(openAisle){const sideWidth=(nx*BAY-BAY)/2;for(const side of [-1,1])k.deck(g,sideWidth,depth,2.46,side*(BAY+sideWidth)/2,0,true);}
 else k.deck(g,nx*BAY,depth,2.46,0,0,true);return g;}
function auditorium(k:Kit,g:T.Group,d:number){
 // Tall central projection bay and broad tiered timber seating visible in talk photos.
 k.screen(g,0,2.55,d/2-.1,3.25,Math.PI,4.15);
 k.stairs(g,BAY-.25,5.5,2.2,0,-d/2+2.75,7);
 k.table(g,0,d/2-1.2,1.5,.65,.74);
 for(const side of [-1,1]){k.wall(g,2.3,1.0,side*3.1,-1,1.15,'#b79571');k.table(g,side*3.1,0,2.2,.75,.8);k.screen(g,side*3.1,1.35,-.36,.7);}
}

function roofRails(k:Kit,g:T.Group,w:number,d:number,y:number){for(const z of [-d/2,d/2])k.rod(g,'timber roof railing',[-w/2,y+.95,z],[w/2,y+.95,z],.04,'#ae9165',layers.roof);for(let x=-w/2;x<=w/2+.01;x+=BAY)for(const z of [-d/2,d/2])k.rod(g,'roof rail post',[x,y,z],[x,y+1,z],.035,'#ae9165',layers.roof);}
function ring(k:Kit,count:number,rx:number,rz:number,cz:number,gap=.38){for(let i=0;i<count;i++){const a=gap+(i/(count-1))*(Math.PI*2-2*gap);k.rv(`rv-${i+1}`,Math.sin(a)*rx,cz+Math.cos(a)*rz,-a+.12*Math.sin(i),5.8+(i%4)*.65);}}
function kitchenBuilding(k:Kit,x:number,z:number,year:number){
 const g=hall(k,'kitchen','Communal kitchen and lounge',x,z,3,2);const w=3*BAY,d=2*BAY;
 // Three bays: enclosed workspaces either side of an open central lounge.
 k.wall(g,w,2.25,0,-d/2,1.36);for(const side of [-1,1]){k.wall(g,d,2.25,side*w/2,0,1.36,'#b99b75',Math.PI/2);k.wall(g,BAY,1.03,side*BAY,d/2,.75);k.wall(g,BAY,.4,side*BAY,d/2,2.25);k.wall(g,BAY,.6,side*BAY,d/2,3.05);}
 const interior=k.assembly('kitchen-interior','Kitchen · sink, pantry and appliances',[-BAY,0,0]);g.add(interior);k.kitchen(interior,BAY,2*BAY,year);
 const cafe=k.assembly('cafe','Café / lounge',[BAY,0,0]);g.add(cafe);k.table(cafe,0,1,2.6,.65,.92);k.screen(cafe,0,1.8,-2.9,1.15);k.box(cafe,'café painted counter',[2.8,.8,.08],[0,.5,1.4],k.photo('/history/2023/cafe-front.webp'));k.wall(cafe,2.8,1.4,0,-3,1.35,k.photo('/history/2023/swirls.webp'));
 k.solar(g,BAY,3.6,BAY,2.9,-.3,.15);
 // Raised central rooftop canopy, present in the later kitchen aerials.
 k.box(g,'central rooftop canopy',[BAY,.07,BAY],[0,4.45,-BAY/2],'#b89b73',layers.roof);k.stairs(g,2.7,4,2.22,0,5.7,12);
 return g;
}
function classroom(k:Kit,g:T.Group,w:number,d:number){
 k.wall(g,w,2.3,0,-d/2,1.38,'#d0ccc0');k.screen(g,0,1.62,-d/2+.08,1.8);
 for(let z=-d/2+1.7;z<d/2-1;z+=2){k.table(g,-w/4,z,2,.7);k.table(g,w/4,z,2,.7);for(const x of [-w/4,w/4]){k.box(g,'classroom bench',[1.8,.075,.35],[x,.48,z+.75],'#aa8b63');for(const dx of [-.7,.7])k.box(g,'bench foot',[.065,.4,.25],[x+dx,.25,z+.75],'#685744');}}
}
function make2021(k:Kit){
 const d=6*BAY,wingDepth=4.572,offset=wingDepth,w=3*wingDepth,g=k.assembly('chiba','Main hall · MARS');
 // Two parallel rack wings. The 12 ft beams run along the long axis;
 // the middle aisle is a shaded void, not a full-height third rack bay.
 for(const side of [-1,1]){
  const wing=new T.Group();wing.userData={...g.userData,layer:layers.steel};wing.position.x=side*offset;wing.rotation.y=Math.PI/2;g.add(wing);k.frame(wing,6,2,4.8768,true,wingDepth);
  k.deck(g,wingDepth,d,.22,side*offset);k.deck(g,wingDepth,d,2.46,side*offset,0,true);
  if(side===1){k.deck(g,wingDepth,14,4.86,side*offset,0,true);k.solar(g,1.8,14,side*offset,5.1,0,.04);}
  k.wall(g,9,2.3,side*w/2,-3,1.38,'#a78c63',Math.PI/2);
 }
 aluminet2021(k,g,wingDepth,d*.90);
 const room=k.assembly('classroom','Classroom and projector',[offset,0,2]);classroom(k,room,BAY,7);
 const lib=k.assembly('library','Library nook',[-offset,0,-6]);for(let i=0;i<4;i++){k.box(lib,'book shelf',[2.8,.05,.32],[0,.45+i*.43,-1]);for(let b=0;b<11;b++)k.box(lib,'book',[.07+(b%3)*.025,.22+(b%2)*.04,.2],[-1.25+b*.23,.6+i*.43,-1],['#b4af94','#806147','#4a6875','#ac6e57'][b%4]);}k.table(lib,0,1.3);
 k.stairs(g,2.8,6,2.22,-offset,d/2+3,14);
 // The enormous cutout MARS letters are an observed 2021 landmark.
 const c=document.createElement('canvas');c.width=1024;c.height=256;const ctx=c.getContext('2d')!;ctx.fillStyle='#ddd9c6';ctx.font='bold 245px sans-serif';ctx.textAlign='center';ctx.font='bold 220px sans-serif';ctx.fillText('MA',218,226);ctx.fillText('RS',806,226);const texture=new T.CanvasTexture(c);texture.colorSpace=T.SRGBColorSpace;const mat=new T.MeshStandardMaterial({map:texture,transparent:true,alphaTest:.4,side:T.DoubleSide});const sign=new T.Mesh(new T.PlaneGeometry(w+.2,4.4),mat);sign.position.set(0,2.4,d/2+.55);sign.userData.walkNoCollision=true;k.named(k.tag(g,sign,'MARS cutout letters',layers.wall),'mars-letters');sign.userData.walkNoCollision=true;
 const utility=k.assembly('outdoor-kitchen','Outdoor utility kitchen',[11,0,0]);const uf=new T.Group();uf.userData={...utility.userData,layer:layers.steel};uf.rotation.y=Math.PI/2;utility.add(uf);k.frame(uf,4,1,2.4384,false,BAY);k.deck(utility,BAY,4*BAY,.2);k.kitchen(utility,BAY,10);
 const container=k.assembly('container','White utility container',[10,0,12],Math.PI/2);k.box(container,'shipping container',[6.06,2.59,2.44],[0,1.3,0],'#cac9bc',layers.context);
 ring(k,15,29,33,2,.65);
}
function make2022(k:Kit){
 // As-built pinwheel: DJI_0829 overhead, DJI_0806 orbit and March rooftop panorama.
 // Four matching footprints, each with an end stair. Corner passages stay open.
 // Nominal rack scale and estimated spacing; no pre-season SketchUp coordinates.
 const d=4.572,radius=8.6,shift=3;
 const ids=['chiba','east-house','kitchen','west-house'];
 const names=['North classroom','Painted arches house','South kitchen','West painted house'];
 for(let i=0;i<4;i++){
  const angle=-i*Math.PI/2,origin=new T.Vector3(-shift,0,-radius).applyAxisAngle(new T.Vector3(0,1,0),angle);
  const g=k.assembly(ids[i],names[i],[origin.x,0,origin.z],angle);
  const rack=new T.Group();rack.userData={...g.userData,layer:layers.steel};rack.position.x=-BAY/2;g.add(rack);
  k.frame(rack,3,2,4.8768,true,d);k.deck(rack,3*BAY,d,.22);k.deck(rack,3*BAY,d,2.46,0,0,true);
  // The kitchen has a smaller high roof and a broad open lower terrace.
  k.deck(rack,(i===2?1:3)*BAY,d,4.86,i===2?-BAY:0,0,true);
  if(i!==2)k.solar(rack,3*BAY,1.65,0,5.05,-d/2+.6,.24);
  const stair=new T.Group();stair.userData={...g.userData,layer:layers.floor};stair.position.x=1.5*BAY;stair.rotation.y=Math.PI/2;g.add(stair);
  k.stairs(stair,d-.12,BAY,2.22,0,0,8);
  k.wall(rack,3*BAY,2.23,0,-d/2,1.365);
  k.wall(rack,d,2.23,-1.5*BAY,0,1.365,i===3?'#517e9c':'#b99b75',Math.PI/2);
  if(i===0){classroom(k,rack,3*BAY,d);k.screen(rack,0,1.65,d/2+.07,3.5,0,2.0);}
  if(i===1){k.wall(rack,3*BAY,2.23,0,d/2,1.365,k.photo('/history/2022/arches.webp'));k.wall(rack,BAY,2.2,-BAY,d/2,3.66,k.photo('/history/2022/arches-upper.webp'));}
  if(i===2){k.kitchen(rack,6,d);k.wall(rack,BAY,2.23,-BAY,d/2,1.365);k.wall(rack,BAY,.9,BAY,d/2,.75);roofRails(k,rack,3*BAY,d,2.5);}
  if(i===3){k.wall(rack,BAY,2.23,-BAY,d/2,1.365,'#517e9c');k.wall(rack,BAY,1,BAY,d/2,.8,'#517e9c');k.table(rack,0,d/2+1.2,3,.8);}
 }
 ring(k,12,25,28,0,.45);
}
function make2023(k:Kit){
 const w=7*BAY,d=8.5344,g=hall(k,'chiba','Chiba · roof terrace and main room',0,0,7,3,4.8768,true,d);
 k.deck(g,w,d,4.86,0,0,true);roofRails(k,g,w,d,4.7);k.wall(g,w,2.25,0,-d/2,1.37);k.wall(g,d,2.3,-w/2,0,1.38,k.photo('/history/2022/arches.webp'),Math.PI/2);k.wall(g,d,2.3,w/2,0,1.38,'#b79a76',Math.PI/2);
 k.solar(g,8.7,7.0,-6.5,2.24,7,.62);k.solar(g,8.7,6.2,6.5,2.15,6.8,.62);k.stairs(g,3.4,6.2,4.4,.4,8.5,20);auditorium(k,g,d);
 kitchenBuilding(k,0,43,2023).rotation.y=Math.PI;
 ring(k,16,30,24,22,.5);
}
function make2024(k:Kit){
 const w=6*BAY,d=3*BAY,g=hall(k,'chiba','Chiba · painted frontage, solar and glazing',0,0,6,3,4.8768,true);
 k.deck(g,w,d,4.86,0,0,true);roofRails(k,g,w,d,4.7);
 k.wall(g,w,2.25,0,-d/2,1.37);k.wall(g,d,2.3,-w/2,0,1.38,'#b32629',Math.PI/2);k.wall(g,d,2.3,w/2,0,1.38,k.photo('/history/2022/arches.webp'),Math.PI/2);
 // March frontage photos + Gene's 2026-09-29 front / solarium photos: vertical inset with straight
 // stairs and the door landing, leaning flaps (PV left, plexiglass solarium right), plexiglass end wall + door.
 frontage2024(k,g,w,d);
 const upperStair=new T.Group();upperStair.userData={...g.userData,layer:layers.floor};upperStair.position.y=2.3;g.add(upperStair);k.stairs(upperStair,2.7,3.6,2.1,0,d/2-1.7,10);

 auditorium(k,g,d);
 kitchenBuilding(k,0,43,2024).rotation.y=Math.PI;ring(k,18,32,24,22,.55);
}
function make2025(k:Kit){
 const w=3*BAY,d=3*BAY,g=hall(k,'chiba','Chiba · central steps and red wings',0,0,3,3);
 // Open central staircase / seating bay, flanked by two roof terraces.
 for(const o of g.children.slice())if(o.userData.layer===layers.roof)g.remove(o);
 for(const side of [-1,1]){k.deck(g,BAY,d,2.48,side*BAY,0,true);k.deck(g,BAY,d,4.86,side*BAY,0,true);k.wall(g,BAY,2.2,side*BAY,d/2,1.35,'#ba342d');}
 k.stairs(g,BAY-.15,8.8,4.35,0,1.05,18);
 for(const x of [-BAY/2,BAY/2])k.box(g,'19 foot central upright',[.075,5.7912,.075],[x,2.8956,-d/2],'#293c45',layers.steel);
 k.box(g,'raised center crossbeam',[BAY,.12,.08],[0,5.67,-d/2],'#b84c26',layers.steel);
 roofRails(k,g,w,d,4.7);
 k.wall(g,d,2.25,-w/2,0,1.37,'#b63229',Math.PI/2);k.wall(g,3.4,2.2,-w/2,-2,3.64,k.photo('/history/2025/flower.webp'),Math.PI/2);
 k.wall(g,d,2.2,w/2,0,1.35,'#ae9772',Math.PI/2);
 k.screen(g,0,2.55,d/2-.12,3.25,Math.PI,4.15);
 const talk=k.assembly('classroom','Chiba lounge and workspace',[-BAY,0,0]);k.table(talk,0,-1.2,2,.7);k.screen(talk,0,1.3,-1.6,1.1);k.box(talk,'pink sofa seat',[2,.38,.85],[0,.48,2],'#a35e75');k.box(talk,'pink sofa back',[2,.58,.15],[0,.82,2.35],'#a35e75');
 kitchenBuilding(k,-18,20,2025);
 const booths=k.assembly('utility-booths','Utility booths',[-27,0,20]);for(let i=0;i<3;i++){const x=i*1.7;k.box(booths,'booth wall',[1.6,2.4,1.6],[x,1.2,0],'#a28a63',layers.wall);k.box(booths,'white door',[.76,2.03,.06],[x,1.04,.83],i===1?'#713a4a':'#d1d0c5',layers.wall);}
 const dorm=hall(k,'secondary-house','Secondary two-storey house',22,20,3,2);k.wall(dorm,3*BAY,2.3,0,BAY,1.36);k.wall(dorm,3*BAY,1.3,0,BAY,3.25,'#e1e0d8');k.deck(dorm,3*BAY,2*BAY,4.68,0,0,true);
 ring(k,18,36,30,20,.55);
}
// 2020 comes from studio-2020/scene; ids use the same stable scheme as Kit (HISTORY_IDS.md).
function tag2020(root:T.Group){root.updateMatrixWorld(true);const entries:IdEntry[]=[];root.children.forEach((g,i)=>{const id=g.userData.id==='portal'?'chiba':String(g.userData.id||`site-${i}`);g.userData.assembly_id=id;g.traverse(o=>{if(o===g)return;if(o instanceof T.Mesh){const name=o.name.toLowerCase();o.userData={...o.userData,assembly_id:id,kind:name||'component',definition_id:name||'component',layer:/beam|upright|brac/.test(name)?layers.steel:/roof|ceiling/.test(name)?layers.roof:/wall|scrim|curtain|climbing sheet/.test(name)?layers.wall:/floor|deck|stair/.test(name)?layers.floor:layers.detail};entries.push({o,assembly:g,assemblyId:id,kind:name||'component'});if(/scrub/.test(name))o.userData.kind='site_context';}});});assignStableIds(entries);}
/** `hooks` exist for id-stability tests (deploy/history-ids.test.mjs); the app passes none. */
export function createHistoricalScene(year:number,hooks:KitHooks={}){
 if(year===2020){const {root}=createBrahman2020Scene();tag2020(root);const k=new Kit(year,hooks);k.visitors(7);root.add(...k.root.children);return root;}
 const k=new Kit(year,hooks);({2021:make2021,2022:make2022,2023:make2023,2024:make2024,2025:make2025} as Record<number,(k:Kit)=>void>)[year](k);k.visitors(year===2021?12:year===2022?16:22);return k.finalize();
}
export function sceneManifest(root:T.Group,year:number){const instances:{id:string;assembly_id:string;layer:string;kind:string;definition_id:string}[]=[],assemblies:{id:string;name:string}[]=[],defs=new Set<string>();root.traverse(o=>{const u=o.userData;if(u.assembly_id&&!u.component_id&&!u.layer&&!assemblies.some(a=>a.id===u.assembly_id))assemblies.push({id:u.assembly_id,name:o.name.replaceAll('_',' ')});if(u.component_id){instances.push({id:u.component_id,assembly_id:u.assembly_id,layer:u.layer||layers.detail,kind:u.kind||'component',definition_id:u.definition_id||'component'});defs.add(u.definition_id||'component');}});return {instances,assemblies,definitions:[...defs],limitations:[historyNotes[year],'Rack bays set to nominal 12 ft. Photographic placement is approximate; this is not a measured inventory or survey.','Visitors and EUC riders are illustrative.']};}
