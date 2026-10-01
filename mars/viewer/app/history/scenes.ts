import * as T from 'three';
import {add2025Reconciliation} from './details-2025-reconciliation';
import {Kit,BAY,layers,assignStableIds,type IdEntry,type KitHooks} from './kit';
import {aluminet2021,frontage2024,stair2022,solarRow2022,TRAILERS_2022,ROOF_TOP_2022} from './photographic-corrections';
import {YEAR_NORTH_AZIMUTH_OFFSET,NORTH_AZIMUTH_OFFSET} from '../../engine/env/sun';
import {createBrahman2020Scene,flowerMural} from '../studio-2020/scene';
export const YEARS=[2020,2021,2022,2023,2024,2025,2026] as const;
export const historyNotes:Record<number,string>={
 2020:'Portal, Forest and the public installations, with the separate trailer circle. March drone views and ground photographs; not a surveyed plan.',
 2021:'Two parallel rack wings with a bare-ground corridor, draped aluminet and stepped platforms inside the wings. Dense midseason c6730/c6735/c6727 footage replaces the invented front staircase. This seasonal composite includes later MARS letters; hidden rooms and exact terrace heights remain fitted.',
 2022:'Four separately fitted houses around an asymmetric courtyard: Ba Sing Se, Cahuilla, Chatsubo and Huaqiangbei. Native aerial c273 constrains roof centers and unequal roof depths; broad rack-supported stairs and seven travel trailers replace generic templates. Dimensions and hidden interiors remain approximate.',
 2023:'Dense March drone footage supports seven Chiba bays, internal stepped access, 20 solar modules and parallel Rotapolis with one tall and one low bay. Five travel trailers are individually placed. Exact interbuilding spacing and hidden room boundaries remain under photographic calibration.',
 2024:'Six-bay main Chiba roof plus a lower west terrace; the auditorium and north entrance sit half a bay west of the main-roof center. Open rack-supported seating, north access and Freeside roof/tents follow labeled sources. South access linkage and fine interior geometry remain provisional.',
 2025:'Chiba and Tool Camp face a common courtyard, Freeside sits west, and Bodywork closes the eastern side. A roof-plane fit of the January panorama constrains placement and orientation. Staggered stairs, roof artwork, facades and a dated 21-vehicle census use labeled sources; measurements and hidden details remain approximate.',
 2026:'Existing modular reconstruction and drone alignment, supplemented by kitchen, café and classroom photographs. Some dimensions and hidden interiors remain provisional.'};
function hall(k:Kit,id:string,name:string,x:number,z:number,nx:number,nz:number,h=4.8768,openAisle=false,depth=nz*BAY){const g=k.assembly(id,name,[x,0,z]);k.frame(g,nx,nz,h,true,depth);k.deck(g,nx*BAY,depth,.22);
 if(openAisle){const sideWidth=(nx*BAY-BAY)/2;for(const side of [-1,1])k.deck(g,sideWidth,depth,2.46,side*(BAY+sideWidth)/2,0,true);}
 else k.deck(g,nx*BAY,depth,2.46,0,0,true);return g;}
function _auditorium(k:Kit,g:T.Group,d:number){
 // Tall central projection bay and broad tiered timber seating visible in talk photos.
 k.screen(g,0,2.55,d/2-.1,3.25,Math.PI,4.15);
 k.stairs(g,BAY-.25,5.5,2.2,0,-d/2+2.75,7);
 k.table(g,0,d/2-1.2,1.5,.65,.74);
 for(const side of [-1,1]){k.wall(g,2.3,1.0,side*3.1,-1,1.15,'#b79571');k.table(g,side*3.1,0,2.2,.75,.8);k.screen(g,side*3.1,1.35,-.36,.7);}
}

function roofRails(k:Kit,g:T.Group,w:number,d:number,y:number){for(const z of [-d/2,d/2])k.rod(g,'timber roof railing',[-w/2,y+.95,z],[w/2,y+.95,z],.04,'#ae9165',layers.roof);for(let x=-w/2;x<=w/2+.01;x+=BAY)for(const z of [-d/2,d/2])k.rod(g,'roof rail post',[x,y,z],[x,y+1,z],.035,'#ae9165',layers.roof);}
/** Trailer ring on an ellipse (angle 0 = +Z end, left open by `gap` for the kitchen). `keepOut` (2023/24, Q2 answered
 *  by Gene 2026-09-29: "no trailers under Chiba … side trailers must not touch the walls"): a building's world box
 *  [x0, z0, x1, z1] the ring must stay `clear` metres off. The ring then also leaves open the sector of the ellipse
 *  round the box (the smallest symmetric sector about angle π, where the ellipse meets it, whose edge trailer clears
 *  the box by `clear`), and its trailers spread evenly over the two remaining arcs; ids, headings and lengths follow
 *  the index as before. */
function _ring(k:Kit,count:number,rx:number,rz:number,cz:number,gap=.38,keepOut?:{box:[number,number,number,number];clear:number}){
 const place=(i:number,a:number)=>({x:Math.sin(a)*rx,z:cz+Math.cos(a)*rz,angle:-a+.12*Math.sin(i),length:5.8+(i%4)*.65});
 let e=0;
 if(keepOut){const fits=(i:number,a:number)=>trailerClearance(place(i,a),keepOut.box)>=keepOut.clear;
  // widen the sector (0.005 rad steps) until a trailer of any index (heading / length) on either edge clears the box
  while(e<Math.PI-gap&&![...Array(count).keys()].every(i=>fits(i,Math.PI-e)&&fits(i,Math.PI+e)))e+=.005;}
 const span=Math.PI*2-2*gap-2*e,arc=span/2;
 for(let i=0;i<count;i++){const s=(i/(count-1))*span,a=gap+(s<=arc?s:s+2*e);const t=place(i,a);k.rv(`rv-${i+1}`,t.x,t.z,t.angle,t.length);}
}
function _ringAvoiding(k:Kit,count:number,rx:number,rz:number,cz:number,boxes:[number,number,number,number][]){
 const valid=[];for(let step=0;step<720;step++){const a=2*Math.PI*step/720;
  const t={x:Math.sin(a)*rx,z:cz+Math.cos(a)*rz,angle:-a,length:6.5};
  if(boxes.every(box=>trailerClearance(t,box)>=1))valid.push(a);}
 if(valid.length<count)throw Error('No clear trailer ring for this year');
 for(let i=0;i<count;i++){const a=valid[Math.round(i*(valid.length-1)/(count-1))];
  k.rv(`rv-${i+1}`,Math.sin(a)*rx,cz+Math.cos(a)*rz,-a,6.5);}
}
/** Plan clearance (m) between a Kit trailer (2.35 m wide × `length`, long axis (sin angle, cos angle)) and a world box. */
export function trailerClearance(t:{x:number;z:number;angle:number;length:number},box:[number,number,number,number]){
 const ax=Math.sin(t.angle),az=Math.cos(t.angle),hw=1.175,hl=t.length/2;
 const corners=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([u,v])=>[t.x+az*hw*u+ax*hl*v,t.z-ax*hw*u+az*hl*v]);
 const [x0,z0,x1,z1]=box;
 // separating distance of two convex polygons: 0 if they overlap, else the min distance between their edges
 const inBox=(p:number[])=>p[0]>=x0&&p[0]<=x1&&p[1]>=z0&&p[1]<=z1;
 const inT=(p:number[])=>{const dx=p[0]-t.x,dz=p[1]-t.z;return Math.abs(dx*az-dz*ax)<=hw&&Math.abs(dx*ax+dz*az)<=hl;};
 const boxC=[[x0,z0],[x1,z0],[x1,z1],[x0,z1]];
 if(corners.some(inBox)||boxC.some(inT))return 0;
 const seg=(p:number[],a:number[],b:number[])=>{const vx=b[0]-a[0],vz=b[1]-a[1],l=vx*vx+vz*vz,u=Math.max(0,Math.min(1,((p[0]-a[0])*vx+(p[1]-a[1])*vz)/l));return Math.hypot(p[0]-a[0]-u*vx,p[1]-a[1]-u*vz);};
 let d=Infinity;for(let i=0;i<4;i++){for(const p of boxC)d=Math.min(d,seg(p,corners[i],corners[(i+1)%4]));for(const p of corners)d=Math.min(d,seg(p,boxC[i],boxC[(i+1)%4]));}
 return d;
}
function kitchenBuilding(k:Kit,x:number,z:number,year:number,entityId?:string,bays=3){
 const g=hall(k,'kitchen',entityId?'Freeside · kitchen, lounge and living quarters':'Communal kitchen and lounge',x,z,bays,2);const w=bays*BAY,d=2*BAY;
 if(entityId){g.userData.entity_id=entityId;g.userData.source=`Gene atlas notes and labeled aerials for ${entityId}; footprint/detail still provisional`;}
 // Three bays: enclosed workspaces either side of an open central lounge.
 k.wall(g,w,2.25,0,-d/2,1.36);for(const side of [-1,1]){k.wall(g,d,2.25,side*w/2,0,1.36,'#b99b75',Math.PI/2);k.wall(g,BAY,1.03,side*BAY,d/2,.75);k.wall(g,BAY,.4,side*BAY,d/2,2.25);k.wall(g,BAY,.6,side*BAY,d/2,3.05);}
 const interior=k.assembly('kitchen-interior','Kitchen · sink, pantry and appliances',[-BAY,0,0]);g.add(interior);k.kitchen(interior,BAY,2*BAY,year);
 const cafe=k.assembly('cafe','Café / lounge',[BAY,0,0]);g.add(cafe);k.table(cafe,0,1,2.6,.65,.92);k.screen(cafe,0,1.8,-2.9,1.15);{const floor=k.seat?k.surface(cafe,Kit.footprint(0,1.4,2.8,.08),.9):.1;k.box(cafe,'café painted counter',[2.8,.9-floor,.08],[0,(.9+floor)/2,1.4],k.photo('/history/2023/cafe-front.webp'));/* floor to counter top (.9) */}k.wall(cafe,2.8,1.4,0,-3,1.35,k.photo('/history/2023/swirls.webp'));
 k.solar(g,BAY,3.6,BAY,2.9,-.3,.15);
 // Raised central rooftop canopy, present in the later kitchen aerials.
 k.box(g,'central rooftop canopy',[BAY,.07,BAY],[0,4.45,-BAY/2],'#b89b73',layers.roof);k.stairs(g,2.7,4,2.22,0,5.7,12);
 return g;
}
function classroom(k:Kit,g:T.Group,w:number,d:number){
 k.wall(g,w,2.3,0,-d/2,1.38,'#d0ccc0');k.screen(g,0,1.62,-d/2+.08,1.8);
 for(let z=-d/2+1.7;z<d/2-1;z+=2){k.table(g,-w/4,z,2,.7);k.table(g,w/4,z,2,.7);for(const x of [-w/4,w/4]){k.box(g,'classroom bench',[1.8,.075,.35],[x,.48,z+.75],'#aa8b63');for(const dx of [-.7,.7]){const floor=k.seat?k.surface(g,Kit.footprint(x+dx,z+.75,.065,.25),.4425):0,[h,cy]=k.seat?[.4425-floor,(.4425+floor)/2]:[.4,.25];k.box(g,'bench foot',[.065,h,.25],[x+dx,cy,z+.75],'#685744');}}} // feet: floor to seat underside (held years: as before W46)
}
function make2021(k:Kit){
 // Jan 27 near-nadir c1285 and next-day c6735: 8 (±1) 12-ft rack intervals along the long axis.
 // The 15-ft rack depth and equal-width bare-ground corridor are Gene's corrections, corroborated
 // by the near-overhead. The axes are local to the photographed hall, not a surveyed compass bearing.
 const d=8*BAY,wingDepth=4.572,offset=wingDepth,w=3*wingDepth,g=k.assembly('chiba','Main hall · MARS');
 g.userData.source='c1285 EXIF Jan 27 (posted Jan 28); c6735 Jan 28; c6730 Feb 3; Gene atlas notes on c6735/c6730';
 g.userData.measurement='8 ± 1 rack bays long, 3 × 4.572 m transverse; c1285 pixel ground control in year-2021/RECONSTRUCTION.md';
 // Dense c6730 104/112/339/352s: end bays contain five transverse shelf
 // strips, with the next bay reversing ascent. They are not whole-bay flat decks.
 // Height remains a nominal rack-ratio fit (about ±0.3m), not measured hole counts.
 const lower=[2.14,2.14,2.14,2.14,2.14,2.14,2.14,0];
 for(const side of [-1,1]){
  const wing=new T.Group();wing.userData={...g.userData,layer:layers.steel};wing.position.x=side*offset;wing.rotation.y=Math.PI/2;g.add(wing);
  k.frame(wing,8,2,4.8768,false,wingDepth);
  for(const child of wing.children.slice())if(child.name==='12 foot orange beam'&&child.position.y<1)wing.remove(child);
  // End-bay guard ties step with the transverse shelves (c6730 104/112s),
  // unlike the helper's six uninterrupted 16ft-high rows. Keep central ties.
  for(const beam of wing.children){
   if(beam.name!=='12 foot orange beam')continue;
   const bay=Math.round((beam.position.x+d/2)/BAY-.5);
   const transverse=side*beam.position.z;
   const strip=Math.max(0,Math.min(4,Math.floor((transverse+wingDepth/2-.001)/(wingDepth/5))));
   if(bay===0||bay===6)beam.position.y=2.14*(strip+1)/5+1.0;
   else if(side===1&&(bay===1||bay===5))beam.position.y=Math.min(4.7568,2.14+2.13*(5-strip)/5+1.0);
  }
  const shelf=(bay:number,y:number,strip?:number)=>{
   const z=d/2-(bay+.5)*BAY,depth=strip===undefined?wingDepth:wingDepth/5;
   // strip0 borders the central aisle; strip4 borders the outside utility/RV face.
   const x=side*(offset+(strip===undefined?0:-wingDepth/2+(strip+.5)*depth));
   k.deck(g,depth,BAY-.02,y,x,z,true);
   for(const dx of [-depth/2,depth/2])k.box(g,'terraced rack beam',[.08,.12,BAY],[x+dx,y-.06,z],'#b84c26',layers.steel);
  };
  for(let bay=0;bay<8;bay++){
   if(bay===0||bay===6){
    // Five broad shelf treads climb from the aisle to the outside of the rack.
    for(let strip=0;strip<5;strip++)shelf(bay,2.14*(strip+1)/5,strip);
   }else if(side===1&&(bay===1||bay===5)){
    // Return across the next bay toward the high platform. c6730 t112/96s.
    for(let strip=0;strip<5;strip++)shelf(bay,2.14+2.13*(5-strip)/5,strip);
   }else if(bay<6){
    shelf(bay,2.14);
    if(side===1&&[2,3,4].includes(bay))shelf(bay,4.27);
    // c6730 Feb3 t88/t272: TWO raised patches cover only the aisle-side
    // portion; exposed outer terraces remain. Bay placement is a photo fit.
    if(side===-1&&[1,5].includes(bay)){
     const roofDepth=wingDepth*.6,x=-(wingDepth/2+roofDepth/2),z=d/2-(bay+.5)*BAY;
     k.deck(g,roofDepth,BAY-.02,3.66,x,z,true);
     for(const dx of [-roofDepth/2,roofDepth/2])k.box(g,'partial roof support beam',[.08,.12,BAY],[x+dx,3.60,z],'#b84c26',layers.steel);
    }
   }
   // Rearmost bay is an open shade/dining frame, not a full plywood floor.
  }
  // Ground rooms occupy discrete bays, with openings between them; no continuous blank wall.
  for(const bay of [2,3,5,6]){
   const z=d/2-(bay+.5)*BAY,h=Math.max(1.1,lower[bay]-.08);
   k.wall(g,BAY-.1,h,side*w/2,z,h/2+.1,'#b99b75',Math.PI/2);
  }
  if(side===1){
   // Three banks, each FOUR columns × TWO rows (24 modules), plainly countable in c6735 128s.
   // The panels face out across the wing, not down the length of the campus.
   for(const bay of [2,3,4]){
    const bank=new T.Group();bank.userData={...g.userData,layer:layers.roof};bank.position.set(offset+.5,0,d/2-(bay+.5)*BAY);bank.rotation.y=Math.PI/2;g.add(bank);
    for(let col=0;col<4;col++)for(let row=0;row<2;row++){
     const xx=(col-1.5)*.86,zz=(row-.5)*.96,tilt=.62;
     const p=k.box(bank,'solar panel',[.835,.05,.935],[xx,4.9-zz*Math.sin(tilt),zz*Math.cos(tilt)],'#b8c2c7',layers.roof);p.rotation.x=tilt;
     const cells=k.box(bank,'photovoltaic cells',[.79,.008,.89],[xx,4.94-zz*Math.sin(tilt),zz*Math.cos(tilt)+.024],'#1c344b',layers.roof);cells.rotation.x=tilt;
    }
    for(const x of [-1.7,1.7])k.rod(bank,'solar timber triangle',[x,4.3,-.8],[x,5.5,-.8],.045,'#b99761',layers.roof);
   }
  }
 }
 // c6730 t96: plywood closes the aisle-side part of the solar rear end,
 // with an open outer passage; it is not a full-width room wall.
 k.wall(g,wingDepth*.58,2.1,offset-wingDepth*.21,-d/2,1.15,'#b99b75');
 // c6730 t88: one narrow plywood panel rises above the rear outer wall.
 k.wall(g,1.05,1.52,-w/2,d/2-5.2*BAY,2.90,'#c2a77e',Math.PI/2);
 // c6730 t112: partial room beneath solar return stairs, aisle stays open.
 k.wall(g,wingDepth*.62,1.75,offset+wingDepth*.19,d/2-2*BAY,.975,'#c2a77e');
 aluminet2021(k,g,wingDepth,d*.90);
 // Feb3 aerials: nearly taut silver middle close to the upper deck level,
 // short dropped end aprons. Heights remain photographic estimates.
 const shadeDrop=(z:number)=>1.25*Math.min(1,Math.max(0,(Math.abs(z)-d*.32)/(d*.13)));
 for(const o of g.children){
  if(o.name==='draped silver aluminet'){
   const mesh=o as T.Mesh;mesh.geometry=mesh.geometry.clone();
   const geo=mesh.geometry,p=geo.getAttribute('position');
   for(let i=0;i<p.count;i++){
    const x=p.getX(i),z=p.getZ(i),crossSag=1-Math.pow(2*x/wingDepth,2);
    p.setY(i,4.5-.12*crossSag-.025*Math.pow(Math.sin(z*Math.PI/BAY),2)-shadeDrop(z));
   }
   p.needsUpdate=true;geo.computeVertexNormals();geo.computeBoundingBox();geo.computeBoundingSphere();
   const material=(mesh.material as T.MeshStandardMaterial).clone();
   material.color.set('#e5e8e8');material.metalness=.15;material.roughness=.48;mesh.material=material;
   mesh.userData.source='c6730 Feb3 t88/112/272 and Gene aerials: taut silver middle near upper deck, dropped end aprons';
  }else if(o.name==='aluminet tie')o.position.y+=.25-shadeDrop(o.position.z);
 }

 const room=k.assembly('classroom','Open-sided seminar and projector area',[offset,0,2]);
 room.userData.source='2021/detail-review.jpg panorama and c6730 near interior; exact position along wing remains unverified';
 // The panorama shows folding tables, a whiteboard and a small display against exposed racks.
 for(const z of [-2.0,.2,2.4])k.table(room,0,z,2.1,.72,.76);
 k.wall(room,3.2,1.65,0,-3.45,1.38,'#e8e7dc');k.screen(room,.95,1.65,-3.38,.82);
 const lib=k.assembly('library','Library nook',[-offset,0,-6]);for(let i=0;i<4;i++){k.box(lib,'book shelf',[2.8,.05,.32],[0,.45+i*.43,-1]);for(let b=0;b<11;b++)k.box(lib,'book',[.07+(b%3)*.025,.22+(b%2)*.04,.2],[-1.25+b*.23,.6+i*.43,-1],['#b4af94','#806147','#4a6875','#ac6e57'][b%4]);}k.table(lib,0,1.3);
 lib.userData.source='2021/interior.jpg bookshelf; location within west rack wing is provisional';
 // No external front stair: c6730 ~336s shows both end faces and bare ground.
 // Five broad shelf treads and return terraces are modeled inside the rack footprint.
 // The enormous cutout MARS letters belong to the later Feb 16 state (cited photo image2-E12B6).
 const c=document.createElement('canvas');c.width=1024;c.height=256;const ctx=c.getContext('2d')!;ctx.fillStyle='#ddd9c6';ctx.font='bold 300px sans-serif';ctx.textAlign='center';
 // c1464: cutouts nearly reach the 16-ft rack top, with each pair spanning its wing.
 // Fit actual glyph bounds; a 220px font in a 256px canvas previously shrank them to ~10ft.
 for(const [text,x] of [['MA',175],['RS',849]] as const){const m=ctx.measureText(text)||{width:400,actualBoundingBoxAscent:220};const ascent=m.actualBoundingBoxAscent||220;ctx.save();ctx.translate(x,250);ctx.scale(332/(m.width||400),242/ascent);ctx.fillText(text,0,0);ctx.restore();}const texture=new T.CanvasTexture(c);texture.colorSpace=T.SRGBColorSpace;const mat=new T.MeshStandardMaterial({map:texture,transparent:true,alphaTest:.4,side:T.DoubleSide});const sign=new T.Mesh(new T.PlaneGeometry(w+.2,4.4),mat);sign.position.set(0,2.4,d/2+.55);sign.userData.walkNoCollision=true;k.named(k.tag(g,sign,'MARS cutout letters',layers.wall),'mars-letters');sign.userData.walkNoCollision=true;
 const utility=k.assembly('outdoor-kitchen','Outdoor wash / utility line',[11,0,-1]);
 utility.userData.source='c6730 ~80/96s: low linear wash/storage counter, freestanding black tank, bathtub; no roofed kitchen building';
 for(const z of [-4,-1,2]){
  k.box(utility,'utility counter',[1.05,.08,2.9],[0,1.05,z],'#b99b75');
  k.wall(utility,2.9,.88,.52,z,.61,'#b79b77',Math.PI/2);
  for(const dz of [-1.35,1.35])k.rod(utility,'counter leg',[0,k.surface(utility,[[0,z+dz]],1),z+dz],[0,1.0,z+dz],.035);
 }
 const tank=new T.Mesh(new T.CylinderGeometry(.55,.55,1.8,16),k.mat('#252829'));tank.position.set(1.0,1,-5.2);k.tag(utility,tank,'black water tank',layers.detail);
 k.box(utility,'white bathtub',[.72,.53,1.6],[0,.55,-6.1],'#deded1');
 k.wall(utility,1.05,1.8,0,-5.15,1.1,'#ae8c5d');
 const container=k.assembly('container','White utility container',[10,0,12],Math.PI/2);k.box(container,'shipping container',[6.06,2.59,2.44],[0,1.3,0],'#cac9bc',layers.context);
 // Gene's January aerials: flower on the near end of the parallel white
 // container. Reuse the 2020 vector interpretation, facing the hall-front end.
 const containerMural=new T.Mesh(new T.PlaneGeometry(2.20,2.20),new T.MeshBasicMaterial({map:flowerMural(),side:T.DoubleSide}));
 containerMural.position.set(-3.03-.025,1.30,0);containerMural.rotation.y=-Math.PI/2;
 k.tag(container,containerMural,'Mars flower front mural',layers.detail);containerMural.userData.walkNoCollision=true;
 containerMural.userData.source='Gene supplied 2021 aerials: red flower on near container end; reused 2020 vector interpretation, not exact painted tessellation';
 // Explicit Jan 27 camp placements from c1285, checked against c6735 frame 42. This snapshot
 // has seven clearly separated full-size travel trailers, a bus and smaller motor vehicles;
 // the former 15-trailer ellipse invented both extra units and an east-side residential arc.
 const trailers:[number,number,number,number][]=[
  [-12.6,6.5,-.35,9],[-15.8,-2.1,-.1,8.7],[-17.6,-12.6,-.7,8.4],
  [-14.4,-21.0,-1.0,8.2],[-7.3,-22.5,-1.5,8.2],[1.9,-23.0,-1.43,8.3],
  [23.9,12.2,.7,8.4],[15.7,14.2,1.5,7.6],
 ];
 trailers.forEach(([x,z,angle,length],i)=>{if(i===3)return; // rv-4's old pixel pick is empty ground; c1285 and c6735 ~164s show FIVE trailers in this arc.
  const rv=k.rv(`rv-${i+1}`,x,z,angle,length);rv.userData.source='c1285 Jan 27 near-nadir and supplied Jan28 obliques; individual roof fittings and facade variation, approximate dimensions';
  // Different roof vent counts and facade bands visible across the trailer arc.
  // Preserve the earlier shell and wheel IDs; these are observed fittings, not brands.
  for(const dz of (i===5?[-2.5,2.4]:i===1?[-2.1,2.2]:[-2.3])){
   k.box(rv,'trailer roof vent',[.45,.09,.45],[0,2.83,dz],'#e7e5dc',layers.context);
  }
  const side=i<6?1:-1;
  k.box(rv,'individual trailer entry door',[.035,1.68,.68],[side*1.2,1.47,-length*.27],'#edece2',layers.context);
  k.box(rv,'entry door window',[.04,.45,.4],[side*1.225,1.91,-length*.27],'#344347',layers.detail);
  k.box(rv,'entry step',[.55,.17,.83],[side*1.44,.17,-length*.27],'#484b48',layers.context);
  if(i===5){ // conspicuous dark curved side graphic on the bus-adjacent trailer.
   for(const s of [-1,1])for(let j=0;j<8;j++){
    const zz=-2.8+j*.65,yy=1.45+.20*Math.sin(j*.62);
    k.box(rv,'dark trailer swoop segment',[.035,.14,.67],[s*1.215,yy,zz],'#373b39',layers.detail);
   }
  }
  if(i===0||i===2)for(const s of [-1,1])k.box(rv,'trailer horizontal siding band',[.03,.035,length-.2],[s*1.215,2.46,0],'#aeb2ae',layers.detail);
 });
 // Distinct contextual fixtures visible in c1285 and c6735 ~164s; not inferred dwellings.
 const toilets=k.assembly('portable-toilets','Two blue portable toilets',[32.3,0,-.6]);
 toilets.userData.source='c1285 roof centers around original pixel3255,2011; independently c6735 ~164s';
 for(const x of [-.65,.65]){
  k.box(toilets,'blue toilet cubicle',[1.1,2.15,1.1],[x,1.16,0],'#439cad',layers.context);
  k.box(toilets,'white toilet roof',[1.15,.15,1.16],[x,2.3,0],'#d8e0d8',layers.context);
  k.box(toilets,'toilet door',[.91,1.85,.04],[x,1.12,.57],'#67b5bd',layers.context);
 }
 const dome=k.assembly('small-dome','Small partly covered geodesic dome',[32.6,0,-10.2]);
 dome.userData.source='c1285 and c6735 ~164s; approximate3.8m diameter,2m high';
 const rows=3,segments=10,r=1.9;
 for(let j=0;j<rows;j++)for(let i=0;i<segments;i++){
  const a=i*Math.PI*2/segments,b=(i+1)*Math.PI*2/segments,t=j*Math.PI/(2*rows),u=(j+1)*Math.PI/(2*rows);
  const p:[number,number,number]=[r*Math.cos(t)*Math.cos(a),.1+r*Math.sin(t),r*Math.cos(t)*Math.sin(a)];
  const q:[number,number,number]=[r*Math.cos(t)*Math.cos(b),.1+r*Math.sin(t),r*Math.cos(t)*Math.sin(b)];
  const v:[number,number,number]=[r*Math.cos(u)*Math.cos(a+.3),.1+r*Math.sin(u),r*Math.cos(u)*Math.sin(a+.3)];
  k.rod(dome,'dome strut',p,q,.018,'#86837c',layers.context);k.rod(dome,'dome strut',p,v,.018,'#86837c',layers.context);
 }
 const bus=k.assembly('school-bus','Yellow school bus',[13.4,0,-20.3],.9);
 bus.userData.source='c1285 Jan 27 and c6735 frame 42; orientation and location from overhead';
 k.box(bus,'yellow school bus body',[2.5,2.45,8.9],[0,1.5,0],'#e0ad25',layers.context);
 k.box(bus,'school bus roof',[2.42,.12,8.65],[0,2.79,0],'#e6d7a2',layers.context);
 for(const side of [-1,1])for(let z=-3.3;z<=3.3;z+=1.1)k.box(bus,'school bus window',[.04,.65,.72],[side*1.27,2.02,z],'#34494d',layers.context);
 // Oblique views resolve the conventional hood, front windscreen, black rub
 // rails, folding passenger entry and separate axles of this yellow bus.
 k.box(bus,'school bus hood',[2.0,.88,1.3],[0,1.09,4.95],'#e6b126',layers.context);
 k.box(bus,'bus windscreen',[2.16,.82,.04],[0,2.04,4.49],'#38505a',layers.context);
 k.box(bus,'bus front grille',[1.4,.40,.045],[0,1.0,5.62],'#343939',layers.detail);
 k.box(bus,'bus front bumper',[2.22,.19,.16],[0,.65,5.67],'#313633',layers.context);
 for(const side of [-1,1]){
  for(const y of [1.1,1.35])k.box(bus,'school bus black rub rail',[.045,.08,8.55],[side*1.29,y,0],'#2b2e2b',layers.detail);
  k.box(bus,'bus headlamp',[.30,.25,.06],[side*.82,1.13,5.63],'#e7dfbb',layers.detail);
  k.box(bus,'bus side mirror',[.18,.46,.15],[side*1.55,2.15,4.15],'#303738',layers.detail);
  for(const z of [-2.7,3.2]){
   const wheel=new T.Mesh(new T.CylinderGeometry(.49,.49,.22,16),k.mat('#262925'));wheel.rotation.z=Math.PI/2;wheel.position.set(side*1.21,.34,z);k.tag(bus,wheel,'school bus wheel',layers.context);
  }
 }
 k.box(bus,'school bus folding entry',[.04,1.73,.92],[1.3,1.43,3.47],'#314044',layers.context);
 k.box(bus,'school bus entry step',[.45,.18,.92],[1.48,.10,3.47],'#353a35',layers.context);
 const pop=k.assembly('popup-camper','Pop-up tent camper',[24.8,0,-27.1],Math.PI/2);
 pop.userData.source='c1285 roof pick and c6727 ~272s show fold-out canvas camper, distinct from the seven full-size trailers and two vans';
 k.box(pop,'popup camper chassis',[2.15,.58,3.4],[0,.55,0],'#d8dcd3',layers.context);
 k.box(pop,'canvas camper sides',[2.1,1.35,4.8],[0,1.5,0],'#b9b8a7',layers.context);
 k.box(pop,'popup white roof',[2.2,.12,3.5],[0,2.21,0],'#e0e0d6',layers.context);
 for(const side of [-1,1])k.box(pop,'canvas window',[.035,.83,2.5],[side*1.07,1.62,0],'#5c605c',layers.context);
 for(const [id,x,z,a] of [['van-1',30.4,-22.9,.14],['van-2',39.3,-15.9,.05]] as const){
  const van=k.assembly(id,'Camper van · approximate',[x,0,z],a);
  van.userData.source='c1285 Jan 27 overhead; distinguishes camper vans from travel trailers';
  k.box(van,'camper van body',[2.2,2.5,5.3],[0,1.55,0],'#e3e2d8',layers.context);
  k.box(van,'camper van windscreen',[1.85,.76,.04],[0,2.05,2.69],'#425359',layers.context);
  for(const side of [-1,1]){
   k.box(van,'camper side glazing',[.04,.65,1.8],[side*1.12,1.96,-.55],'#405256',layers.context);
   for(const z of [-1.65,1.65]){const wheel=new T.Mesh(new T.CylinderGeometry(.34,.34,.17,12),k.mat('#282c29'));wheel.rotation.z=Math.PI/2;wheel.position.set(side*1.06,.18,z);k.tag(van,wheel,'camper van wheel',layers.context);}
  }
  if(id==='van-1')k.box(van,'camper roof luggage rack',[1.78,.12,2.2],[0,2.87,-.4],'#393e3b',layers.context);
 }
 // c1285 original roof centres mapped through the existing four rack corners.
 // Roof parallax and uncertain headings: ±2m; no manufacturer inference.
 const cars:[string,number,number,number,string,boolean][]=[
  ['olive-pickup',-4.78,-27.33,1.4,'#65735c',true],['red-pickup',2.84,-30.33,1.5,'#a94949',true],
  ['dark-suv',10.21,-27.3,.1,'#334c51',false],['green-car',39.95,-21.41,1.2,'#3e6460',false],
  ['red-suv',40.36,-8.87,.15,'#9e363c',false],['orange-work-pickup',18.69,3.47,1.3,'#b16b3f',true],
  ['white-pickup',34.54,9.08,.6,'#d9deda',true],['front-green-car',9.3,18.78,1.5,'#365553',false],
 ];
 for(const [id,x,z,a,color,pickup] of cars){
  const car=k.assembly(id,pickup?'Observed pickup truck':'Observed passenger vehicle',[x,0,z],a);
  car.userData.source='c1285 Jan27 original roof-center fit; c6735 and supplied obliques distinguish pickups/cars; heading and dimensions approximate';
  k.box(car,'vehicle lower body',[1.9,.68,4.6],[0,.68,0],color,layers.context);
  k.box(car,'vehicle cab',[1.75,.72,pickup?1.8:2.65],[0,1.33,pickup?.25:0],color,layers.context);
  k.box(car,'vehicle windscreen',[1.55,.50,.04],[0,1.37,pickup?1.17:1.35],'#3c525b',layers.context);
  for(const side of [-1,1]){
   k.box(car,'vehicle side window',[.035,.46,pickup?1.35:2.1],[side*.895,1.38,pickup?.25:0],'#3c525b',layers.detail);
   for(const zz of [-1.4,1.4]){const wh=new T.Mesh(new T.CylinderGeometry(.33,.33,.17,12),k.mat('#272a28'));wh.rotation.z=Math.PI/2;wh.position.set(side*.92,.17,zz);k.tag(car,wh,'vehicle wheel',layers.context);}
  }
  if(pickup)k.box(car,'open pickup bed',[1.48,.04,1.6],[0,1.035,-1.42],'#414844',layers.context);
 }
}
function make2022(k:Kit){
 // As-built pinwheel: DJI_0829 overhead, DJI_0806 orbit, March rooftop panorama and aerial-03.
 // Four measured roof footprints, each with an end stair. Corner passages stay open.
 // Nominal rack scale and estimated spacing; no pre-season SketchUp coordinates.
 // 2022 reconciliation (Gene, 2026-09-29 evening; RECONCILIATION_2022.md §a–§f; W51): the buildings are Ba Sing Se,
 // Cahuilla, Chatsubo and Huaqiangbei (display names; the ids are kept so every stable id, plan and pin still resolves:
 // 2022 `chiba` = Ba Sing Se, `east-house` = Cahuilla, `kitchen` = Chatsubo, `west-house` = Huaqiangbei). `shift` −2
 // (was 3) turns the pinwheel clockwise as in both aerials: each house keeps its quadrant, stair end and rotation, and
 // only the overlap reverses (Ba Sing Se's stair end now stands off Cahuilla's north end). Stairs PARALLEL to the house
 // (stair2022); solar rows face south on 45° triangle frames (solarRow2022; Chatsubo none); no table at the corner (Q1);
 // trailers per aerial-03 (TRAILERS_2022).
 const d=4.572;
 // Native c273 roof-control similarity fit,10° image tilt removed. Nominal36ft
 // long-side scale; rooftop centers, not assumed rotational symmetry.
 const bodyCenters:[[number,number],[number,number],[number,number],[number,number]]=[[1.62,-10.65],[10.43,2.23],[-2.8,10.3],[-11.15,-2.62]];
 const roofDepths=[5.4864,6.858,5.4864,5.4864];
 const ids=['chiba','east-house','kitchen','west-house'];
 const names=['Ba Sing Se','Cahuilla','Chatsubo','Huaqiangbei'];
 // south in the 2022 frame (engine/env/sun.ts YEAR_NORTH_AZIMUTH_OFFSET; compass azimuth 180 → x = sin, z = −cos)
 const north=YEAR_NORTH_AZIMUTH_OFFSET[2022]??NORTH_AZIMUTH_OFFSET,south=new T.Vector3(Math.sin((180+north)*Math.PI/180),0,-Math.cos((180+north)*Math.PI/180));
 for(let i=0;i<4;i++){
  const angle=-i*Math.PI/2,origin=new T.Vector3(BAY/2,0,0).applyAxisAngle(new T.Vector3(0,1,0),angle);
  origin.x+=bodyCenters[i][0];origin.z+=bodyCenters[i][1];
  const g=k.assembly(ids[i],names[i],[origin.x,0,origin.z],angle);
  const rack=new T.Group();rack.userData={...g.userData,layer:layers.steel};rack.position.x=-BAY/2;g.add(rack);
  k.frame(rack,3,2,4.8768,true,d);k.deck(rack,3*BAY,d,.22);k.deck(rack,3*BAY,d,2.46,0,0,true);
  // The kitchen has a smaller high roof and a broad open lower terrace.
  k.deck(rack,(i===2?1:3)*BAY,roofDepths[i],4.86,i===2?-BAY:0,0,true);
  g.userData.source='c273 same-height roof corners,10° corrected similarity fit, year-2022/review-2/roof-fit.json; steel depth retained provisionally, roof overhang measured separately';
  // Exposed timber ceiling joists appear in c55395; Gene confirmed roof framing.
  // These are visible members below the retained nominal deck surfaces, not a change
  // to the engine-wide floor datum or construction recipe.
  for(let x=-1.5*BAY+.12;x<1.5*BAY;x+=.6096){
   k.box(rack,'upper floor timber joist',[.038,.089,d],[x,2.37,0],'#ae9068',layers.steel);
   if(i!==2||x<-.5*BAY)k.box(rack,'roof timber joist',[.038,.089,roofDepths[i]],[x,4.77,0],'#ae9068',layers.roof);
  }
  if(i!==2){
   for(const z of [-roofDepths[i]/2,roofDepths[i]/2]){
    for(const x of [-1.5*BAY,-.5*BAY,.5*BAY,1.5*BAY])k.rod(rack,'roof guard post',[x,4.86,z],[x,5.75,z],.025,'#88734f',layers.roof);
    for(const y of [5.16,5.46,5.75])k.rod(rack,'roof guard cable',[-1.5*BAY,y,z],[1.5*BAY,y,z],.005,'#62645c',layers.roof);
   }
  }

  // Solar (Q13 / Q28 default): the house side that faces south (rack-local ±x / ±z, world normal within 45° of south).
  const side=([[1,0],[-1,0],[0,1],[0,-1]] as [number,number][]).find(([x,z])=>new T.Vector3(x,0,z).applyAxisAngle(new T.Vector3(0,1,0),angle).dot(south)>Math.SQRT1_2)!;
  if(i===3)solarRow2022(k,rack,[1,0],side,[0,side[1]*(d/2-.05)],ROOF_TOP_2022,10,3*BAY/10);
  if(i===1){
   // c273 native crop: nine larger modules along courtyard edge, eight smaller
   // modules in the shorter outer row, plus a loose blue module between rows.
   solarRow2022(k,rack,[1,0],side,[0,1.02],ROOF_TOP_2022,9,1.05);
   solarRow2022(k,rack,[1,0],side,[-2.2,-1.95],ROOF_TOP_2022,8,.68);
   k.box(rack,'loose blue solar module',[1.0,.06,.6],[.5,ROOF_TOP_2022+.06,.1],'#183858',layers.roof);
  }
  if(i===0)for(const [xc,zc] of [[-4.4,.45],[-1.6,0],[1.2,-.45]] as [number,number][])solarRow2022(k,rack,[0,1],side,[xc+side[0]*.58,zc],ROOF_TOP_2022,3); // three short stepped rows across the house
  stair2022(k,g,1.5*BAY,d,BAY-.12);
  // c63403 (`Mars_Houses_bss`), with the 2022 street-art caption naming Ba Sing Se,
  // fixes the blue/green arch mural on that wing. The previous scene put this
  // very same image on Cahuilla's courtyard wall.
  const outer=k.wall(rack,3*BAY,2.23,0,-d/2,1.365,'#b99b75');
  outer.userData.source='Review5: exterior plywood retained; c63403/c33157 place Ba Sing Se mural on courtyard face, not this rear face';
  const endWall=k.wall(rack,d,2.23,-1.5*BAY,0,1.365,i===3?'#517e9c':'#b99b75',Math.PI/2);
  if(i===0||i===1){
   // Completed end mural extends to the high roof. March22 image supplies
   // paint only; its teardown-time removed panels do not govern occupied coverage.
   endWall.geometry=new T.BoxGeometry(d,4.60,.055);endWall.geometry.translate(0,1.185,0);
   endWall.material=k.photo(i===0?'/history/2022/review5-bss-end.webp':'/history/2022/review5-cahuilla-end.webp');
   endWall.userData.source=i===0?'c33157 March22: Ba Sing Se full-height blue-green end mural; paint retained from occupied state':'c33159 March22 completed Cahuilla blue/green end mural; c57008 March9 painting corroborates later-season finish';
  }
  if(i===0){
   const classroomStart=rack.children.length;
   classroom(k,rack,3*BAY,d);
   // classroom() adds a rear wall already supplied by `outer`; one physical
   // wall avoids coincident pale/wood faces and checkerboard z-fighting.
   for(const o of rack.children.slice(classroomStart))if(o.userData.kind==='plywood wall'&&Math.abs(o.position.z+d/2)<.001)rack.remove(o);
   const left=k.wall(rack,BAY,4.60,-BAY,d/2,2.55,k.photo('/history/2022/review5-bss-left.webp'));
   left.userData.source='c63403 February12 completed Ba Sing Se courtyard mural: full-height left pier, open upper two bays';
   const right=k.wall(rack,BAY,2.23,BAY,d/2,1.365,k.photo('/history/2022/review5-bss-right.webp'));
   right.userData.source='c63403 right lower courtyard mural panel';
   const middle=k.wall(rack,1.55*BAY,2.23,.08,d/2+.35,1.365,k.photo('/history/2022/review5-bss-center.webp'));
   middle.userData.source='c63403 finished projecting middle arch panel; c33157 teardown shows same panel shifted outward; depth approximate';
   // Red ceiling swags and upper-room table are visible in the completed Feb12 photo.
   for(const xx of [0,BAY]){
    for(let j=0;j<12;j++){
     const z1=-d/2+j*d/12,z2=-d/2+(j+1)*d/12;
     const y1=4.70-.62*Math.sin(Math.PI*j/12),y2=4.70-.62*Math.sin(Math.PI*(j+1)/12);
     k.rod(rack,'Ba Sing Se red ceiling fabric',[xx,y1,z1],[xx,y2,z2],.065,'#a13c34',layers.detail);
    }
   }
   const upperRoom=k.assembly('ba-sing-se-upper-room','Ba Sing Se upper occupied room',[0,2.46,0]);rack.add(upperRoom);k.table(upperRoom,0,0,1.6,.75,.74);
   // Narrow wooden ladder at the far-right upper room; no new ground stair.
   for(const xx of [BAY-.32,BAY+.32])k.rod(rack,'Ba Sing Se upper roof ladder stile',[xx,2.49,-d/2+.85],[xx,4.95,-d/2+.05],.035,'#b09268',layers.detail);
   for(let j=0;j<8;j++){const t=(j+.5)/8;k.rod(rack,'Ba Sing Se upper roof ladder rung',[BAY-.32,2.49+2.46*t,-d/2+.85-.8*t],[BAY+.32,2.49+2.46*t,-d/2+.85-.8*t],.025,'#b09268',layers.detail);}
  }
  if(i===1){
   const finishedFront=k.wall(rack,3*BAY,2.23,0,d/2,1.365,'#5996b8');
   finishedFront.userData.source='c57008 March9 painting; c33159 March22 completed blue contour facade. Later-season paint, not January build state';
   const contour=k.box(rack,'Cahuilla photographed contour panel',[BAY-.03,2.20,.014],[-BAY,1.365,d/2+.037],k.photo('/history/2022/review5-cahuilla-front.webp'),layers.wall);
   contour.userData.source='c33159 left lower courtyard panel; source includes the contemporary hand-lettered white task board; remaining facade fine artwork unresolved';
   // Gene's Cahuilla kitchen photo c55395 shows the work area between rack
   // posts, with a long three-basin stainless sink, water jugs and open shelving.
   k.kitchen(rack,6,d);
   const ev='Gene human label c55395: Cahuilla kitchen/water area, 2021-12-31 photo; location within this wing provisional';
   const sink=k.box(rack,'three-basin stainless sink',[2.55,.72,.72],[-.35,.57,-d/2+.55],k.mat('#9babad',.65),layers.detail);sink.userData.source=ev;
   for(const x of [-1.12,-.35,.42]){const basin=k.box(rack,'sink basin',[.65,.035,.54],[x,.94,-d/2+.55],'#535f60',layers.detail);basin.userData.source=ev;}
   for(const x of [-1.12,-.35,.42]){const tap=k.rod(rack,'kitchen tap',[x,1.0,-d/2+.2],[x,1.3,-d/2+.2],.016,'#b3bec0',layers.detail);tap.userData.source=ev;}
   for(const x of [-1.5,-1.1,-.7]){const jug=k.box(rack,'blue water jug',[.33,.53,.33],[x,.34,d/2-.42],'#607b92',layers.detail);jug.userData.source=ev;}
  }
  if(i===2){
   // Chatsubo is the bar / Dance Laboratory, not the three-basin Cahuilla
   // kitchen. Gene labeled c395 as the Chatsubo bar; the open serving bay is
   // visible beneath exposed rack beams and magenta/green event lighting.
   const ev='Gene human label c395: Chatsubo bar, 2022; counter position is a photographic estimate';
   const bar=k.box(rack,'Chatsubo bar counter',[2.9,.08,.7],[-.3,.96,.8],'#b59669',layers.detail);bar.userData.source=ev;
   const foil=k.box(rack,'Chatsubo reflective bar front',[2.80,.69,.025],[-.3,.57,1.165],k.mat('#c2bca4',.62),layers.detail);foil.userData.source='c55445 February8 Chatsubo occupied counter has reflective foil front; precise counter position approximate';
   for(const x of [-1.6,.95]){const leg=k.box(rack,'bar counter support',[.08,.82,.55],[x,.51,.8],'#95734e',layers.detail);leg.userData.source=ev;}
   k.wall(rack,BAY,2.23,-BAY,d/2,1.365);k.wall(rack,BAY,.9,BAY,d/2,.75);roofRails(k,rack,3*BAY,d,2.5);
  }
  if(i===3){
   // Huaqiangbei's courtyard face: Gene's c247 identifies this as the projection/DJ wall.
   // c111 and c477 show the same two solid end piers, an open upper middle bay, and a
   // lower plywood projection panel standing proud of the face. The projected colors
   // belong to a night event; the physical wall is pale plywood in c477.
   const ev='Gene atlas c247 (Huaqiangbei), corroborated by c111/c477 courtyard photos; February 2022 event state; panel depth is a photographic estimate';
   for(const x of [-BAY,BAY]){
    const pier=k.wall(rack,BAY,2.23,x,d/2,1.365,'#d3c9b9');pier.userData.source=ev;
    const upper=k.wall(rack,BAY,2.36,x,d/2,3.67,'#d3c9b9');upper.userData.source=ev;
   }
   const panel=k.wall(rack,1.65*BAY,1.95,0,d/2+.42,1.195,'#d4cabc');panel.userData.source=ev;
   const cap=k.box(rack,'projecting panel cap',[1.65*BAY,.075,.57],[0,2.19,d/2+.42],'#b99b75',layers.wall);cap.userData.source=ev;
   const dj=k.box(rack,'upper DJ booth shelf',[2.0,.08,.75],[0,3.18,d/2-.62],'#735b48',layers.detail);dj.userData.source=ev;
   for(const x of [-.88,.88]){const leg=k.box(rack,'DJ shelf support',[.055,.68,.055],[x,2.82,d/2-.62],'#735b48',layers.detail);leg.userData.source=ev;}
  }
 }
 // c273: seven full-size travel trailers. The former rv-7 is a pale canopy,
 // and rv-9 a long silver-roof shelter; neither is evidenced as a generic white RV.
 for(const [id,x,z,a,l] of TRAILERS_2022)if(id!=='rv-7'&&id!=='rv-9')k.rv(id,x,z,a,l);
 const canopy=k.assembly('rear-canopy','Pale canopy behind Ba Sing Se',[4.9,0,-16.6],-.2);
 canopy.userData.source='c273 upper-right of Ba Sing Se; c56834 initial view shows freestanding shade frontage';
 k.box(canopy,'pale shade roof',[6.0,.04,3.0],[0,2.8,0],'#bbd5db',layers.context);
 for(const x of [-3,3])for(const z of [-1.5,1.5])k.rod(canopy,'shade post',[x,0,z],[x,2.8,z],.025,'#967d59',layers.context);
 const silver=k.assembly('silver-shelter','Long silver-roof shelter · type uncertain',[18.9,0,15.1],.8);
 silver.userData.source='c273 native crop, formerly misclassified rv-9; length/height visual fit, underlying vehicle status unverified';
 k.box(silver,'silver shelter shell',[2.5,2.5,9.0],[0,1.3,0],'#999e96',layers.context);
 k.box(silver,'silver shelter roof',[2.65,.10,9.1],[0,2.6,0],'#c2c5ba',layers.context);
 k.box(silver,'shelter end awning',[2.65,.08,1.4],[0,2.55,5.15],'#b6ac91',layers.context);
 const bus=k.assembly('yellow-bus','Yellow school bus with rooftop deck',[25.6,0,-4.5],.06);
 bus.userData.source='c273 east side; c6649 1.5/24/36s independently shows bus rooftop platform and rail framing';
 k.box(bus,'yellow bus body',[2.55,2.4,9.1],[0,1.55,0],'#d9ad32',layers.context);
 k.box(bus,'bus hood',[2.1,1.0,1.1],[0,1.1,5.1],'#d9ad32',layers.context);
 k.box(bus,'bus front windscreen',[2.18,.84,.045],[0,2.04,4.59],'#37454a',layers.context);
 k.box(bus,'bus front bumper',[2.28,.19,.15],[0,.51,5.71],'#353b38',layers.context);
 k.box(bus,'bus radiator grille',[1.3,.43,.045],[0,1.05,5.68],'#343a35',layers.detail);
 const busWheelGeometry=new T.CylinderGeometry(.49,.49,.24,12);
 for(const side of [-1,1]){
  for(const z of [-2.75,3.15]){const wheel=new T.Mesh(busWheelGeometry,k.mat('#242825'));wheel.rotation.z=Math.PI/2;wheel.position.set(side*1.28,.33,z);k.tag(bus,wheel,'bus road wheel',layers.context);}
  k.box(bus,'bus black rub rail',[.04,.105,8.8],[side*1.30,1.20,0],'#333832',layers.detail);
  k.box(bus,'bus headlight',[.29,.26,.05],[side*.83,1.13,5.70],'#e7dfba',layers.detail);
 }
 k.box(bus,'bus passenger entry',[.035,1.72,.81],[1.305,1.43,3.48],'#37454a',layers.context);
 for(const side of [-1,1])for(let z=-3.5;z<4;z+=1.0)k.box(bus,'bus side window',[.04,.7,.78],[side*1.29,2.05,z],'#37454a',layers.context);
 k.deck(bus,2.7,8.7,2.84);
 for(const side of [-1,1]){
  k.rod(bus,'bus roof handrail',[side*1.35,3.75,-4.35],[side*1.35,3.75,4.35],.025,'#343b3a',layers.context);
  for(const z of [-4.35,-2,0,2,4.35])k.rod(bus,'bus rail post',[side*1.35,2.84,z],[side*1.35,3.75,z],.025,'#343b3a',layers.context);
 }
 const hut=k.assembly('detached-shelter','Detached plywood shelter / camper annex',[17.8,0,-17.7],.3);
 hut.userData.source='c273 and c6649 1.5s foreground shelter; identity unknown, keep separate from the four named houses';
 k.deck(hut,4.5,4.8,.22);k.deck(hut,4.5,4.8,2.7);
 k.wall(hut,4.5,2.45,0,-2.4,1.46,'#b79b6d');k.wall(hut,4.8,2.45,-2.25,0,1.46,'#ad9268',Math.PI/2);
 for(const x of [-1.7,1.7])k.wall(hut,1.1,2.45,x,2.4,1.46,'#b89a6a');
 // Fourteen smaller vehicles picked in the same c273 overhead. Body types
 // are coarse; preserve their distinct footprint and placement instead of adding RVs.
 const cars:[number,number,number,string][]=[[-29.04,-10.84,0.1,'#a96a60'],[-25.66,-20.48,1.0,'#283847'],[-19.04,-23.37,-0.3,'#a35e4e'],[-11.08,-31.93,0.8,'#b9bdb7'],[-5.66,-36.51,1.3,'#c7be9d'],[2.77,-33.25,1.4,'#6b6148'],[-1.57,-26.27,0.8,'#afb6ac'],[-3.98,-20.48,0.3,'#d6dedb'],[0.96,-21.69,0.6,'#e1e3d9'],[14.22,-25.30,0.3,'#b8c7c3'],[28.19,7.35,1.2,'#cad7c9'],[27.95,10.72,1.2,'#696e60'],[25.90,14.10,1.3,'#2c3333'],[-28.67,-0.48,0,'#263435']];
 const roadWheelGeometry=new T.CylinderGeometry(.34,.34,.19,10);
 const cabGeometry=new T.BufferGeometry();
 cabGeometry.setAttribute('position',new T.Float32BufferAttribute([
  -.825,-.30,-1.2,.825,-.30,-1.2,.825,-.30,1.2,-.825,-.30,1.2,
  -.76,.30,-.80,.76,.30,-.80,.76,.30,.63,-.76,.30,.63,
 ],3));
 cabGeometry.setIndex([0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7]);cabGeometry.computeVertexNormals();
 cars.forEach(([x,z,a,color],j)=>{
  const car=k.assembly(`car-${j+1}`,'Parked car / pickup · approximate',[x,0,z],a);car.userData.source='c273 overhead: individual small-vehicle footprint; generic shell, not exact vehicle model';
  k.box(car,'vehicle body',[1.9,1.05,4.6],[0,.8,0],color,layers.context);
  const cab=k.box(car,'vehicle roof',[1.65,.6,2.4],[0,1.55,-.2],color,layers.context);cab.geometry=cabGeometry;
  const glass=k.box(car,'vehicle windscreen',[1.46,.59,.035],[0,1.55,.70],'#33484d',layers.context);glass.rotation.x=-.76;
  for(const side of [-1,1]){
   for(const zz of [-1.43,1.43]){const wheel=new T.Mesh(roadWheelGeometry,k.mat('#252a28'));wheel.rotation.z=Math.PI/2;wheel.position.set(side*.96,.18,zz);k.tag(car,wheel,'car road wheel',layers.context);}
   k.box(car,'car side glazing',[.025,.43,1.22],[side*.80,1.53,-.29],'#33484d',layers.context);
   k.box(car,'car headlight',[.31,.20,.04],[side*.61,.95,2.325],'#e1dfc6',layers.detail);
  }
  k.box(car,'car front bumper',[1.84,.16,.09],[0,.49,2.345],'#5a605d',layers.detail);
 });

 // Reproject old photo-derived context centers into the same tilt-corrected plane.
 // Their generic shell dimensions remain approximate; this only aligns site layout.
 const tilt=10*Math.PI/180,scale=8.3/(26.1*.3);
 for(const q of k.root.children){
  if(ids.includes(q.userData.assembly_id))continue;
  const x=q.position.x,z=q.position.z;
  q.position.x=scale*(Math.cos(tilt)*x-Math.sin(tilt)*z);
  q.position.z=scale*(Math.sin(tilt)*x+Math.cos(tilt)*z);
  q.rotation.y-=tilt;
 }

}
function make2023(k:Kit){
 // March 14 occupied state. Counted from c6656 11s/110s and c6653 0s:
 // seven long beam bays, two low terraces, an INTERNAL seven-tier stair.
 // Depth is a 24 ft fit to c6653 end elevation; longitudinal bay count is observed.
 const w=7*BAY,d=2*BAY;
 const g=k.assembly('chiba','Chiba · 2023 seven-bay stepped row',[0,0,0],0,
  'c6656 11s, 90s, 110s; c6653 0s; c6654 roof; dense overlap-v2 4fps. Seven bays, low west terraces, internal upper flight. Rack depth and metric site coordinates remain fitted.');
 g.userData.entity_id='chiba_2023';
 const section=(parent:T.Group,x:number,bays:number,height:number,depth=d)=>{
  const q=new T.Group();q.userData={...parent.userData,layer:layers.steel};q.position.x=x;parent.add(q);
  k.frame(q,bays,1,height,height>3,depth);return q;
 };
 const westLow=section(g,-2.5*BAY,2,2.48);const high=section(g,1.5*BAY,4,4.8768);
 // No terrace-height beam may pass through the suspended west/front cabin.
 for(const o of westLow.children.slice())if(o.name==='12 foot orange beam'&&o.position.x<0&&o.position.z>0&&o.position.y>2)westLow.remove(o);
 for(const o of high.children.slice())if(o.name==='12 foot orange beam'&&o.position.y>4.5&&Math.abs(o.position.x+.5*BAY)<.01&&o.position.z>-d/2+1.22)high.remove(o);
 // Stair bay has rising beam levels, not a roof-height frame grid blocking the flight.
 for(let i=0;i<7;i++){const z=d/2-(i+.5)*d/7,y=2.46+(i+1)*2.4/7;
  k.box(g,'stepped bay upright',[.075,y,.075],[-1.5*BAY,y/2,z],'#344c40',layers.steel);
 }
 k.deck(g,w,d,.22);k.deck(g,w,d,2.46);
 // Retain all deck object transforms/IDs. Cut only the west bay sheets to
 // their rear half so they do not bisect the suspended cabin.
 for(const o of g.children)if(o instanceof T.Mesh&&o.name==='plywood deck sheet'&&Math.abs(o.position.y-2.46)<.01&&o.position.x<-2.5*BAY){
  // Kit caches box geometry; isolate the three cut sheets from all other decks.
  o.geometry=o.geometry.clone();o.geometry.scale(1,1,.5);o.geometry.translate(0,0,-d/4);
 }
 // White roof over the east two bays; middle deck has an open notch with a
 // narrow rear bridge (c6654 4s). No continuous roof across the stair bay.
 const whiteRoofStart=g.children.length;
 k.deck(g,2*BAY,d,4.86,2.5*BAY,0,true);
 for(const o of g.children.slice(whiteRoofStart))if(o instanceof T.Mesh)o.material=k.mat('#d7e0dc');
 k.deck(g,BAY,d,4.86,0,0,true);
 k.deck(g,BAY,1.22,4.86,BAY,-d/2+.61,true);
 // Cargo hammock in the roof notch, seen from both sides in c6656 11s/68s.
 const netY=(x:number,z:number)=>3.2+.68*((x/BAY*2)**2+(z/d*2)**2);
 for(let row=0;row<=12;row++)for(let col=0;col<10;col++){
  const z=(row/12-.5)*d,x=(col/10-.5)*BAY,xx=((col+1)/10-.5)*BAY;
  k.rod(g,'red cargo net',[BAY+x,netY(x,z),z],[BAY+xx,netY(xx,z),z],.018,'#925258',layers.detail);
 }
 for(let col=0;col<=10;col++)for(let row=0;row<12;row++){
  const x=(col/10-.5)*BAY,z=(row/12-.5)*d,zz=((row+1)/12-.5)*d;
  k.rod(g,'red cargo net',[BAY+x,netY(x,z),z],[BAY+x,netY(x,zz),zz],.018,'#925258',layers.detail);
 }
 const rail=(x1:number,z1:number,x2:number,z2:number,y:number)=>{
  k.rod(g,'timber roof handrail',[x1,y+.95,z1],[x2,y+.95,z2],.035,'#ae9165',layers.roof);
  const n=Math.max(1,Math.ceil(Math.hypot(x2-x1,z2-z1)/2));
  for(let i=0;i<=n;i++)k.rod(g,'timber roof post',[x1+(x2-x1)*i/n,y,z1+(z2-z1)*i/n],[x1+(x2-x1)*i/n,y+.95,z1+(z2-z1)*i/n],.035,'#ae9165',layers.roof);
 };
 rail(-w/2,-d/2,-1.5*BAY,-d/2,2.46);rail(-w/2,d/2,-1.5*BAY,d/2,2.46);
 rail(-.5*BAY,-d/2,w/2,-d/2,4.86);rail(1.5*BAY,d/2,w/2,d/2,4.86);
 rail(w/2,-d/2,w/2,d/2,4.86);rail(-.5*BAY,d/2,.5*BAY,d/2,4.86);
 // Broad stepped sitting/stair bay: rack beams and plywood treads, not a
 // speculative ground-to-roof timber staircase protruding into the desert.
 for(let i=0;i<7;i++){
  const y=2.46+(i+1)*2.4/7,z=d/2-(i+.5)*d/7;
  k.box(g,'central rack stair tread',[BAY,.065,d/7-.015],[-BAY,y,z],'#bfa17b',layers.floor);
  k.box(g,'central stair orange beam',[BAY,.12,.075],[-BAY,y-.08,z+d/14],'#b84c26',layers.steel);
 }
 // c6653 0s resolves a narrow blue end ladder. A previously modeled
 // broad rear flight was unsupported and blocked the open rear passage.
 for(const zz of [-.38,.38])k.rod(g,'blue end ladder stile',[w/2+1.05,.15,-d/2+.5+zz],[w/2+.12,2.6,-d/2+.5+zz],.035,'#386a9c',layers.floor);
 for(let i=0;i<9;i++){const t=(i+.5)/9;k.rod(g,'blue end ladder rung',[w/2+1.05-.93*t,.15+2.45*t,-d/2+.12],[w/2+1.05-.93*t,.15+2.45*t,-d/2+.88],.025,'#386a9c',layers.floor);}
 // Front-room surfaces are tied to the drone's visible bay sequence.
 // Gene review4 + Jan27 hoist photo, c6656t90/t100:
 // Robin's Nest is a suspended hexagonal-section cabin in the FRONT half of
 // the west bay. Its door faces west. It is not a red enclosed ground room.
 const hex=k.assembly('robins-nest-hexapod','Robin’s Nest · suspended 2023 Hexapod',[-3*BAY,2.50,1.78]);g.add(hex);
 hex.userData.source='Jan27 archive hoist photo; archive Hexapod photos and archive Robin’s Nest photo; c6656t1,t12,t90,t100,t105 March14. Nominal radius1.60m/length2.75m and suspension geometry fitted, not surveyed.';
 const hexR=1.60,hexL=2.75,hexCorners=Array.from({length:6},(_,i)=>({z:hexR*Math.cos(i*Math.PI/3),y:hexR*Math.sin(i*Math.PI/3)}));
 for(let i=0;i<6;i++){
  const a=hexCorners[i],b=hexCorners[(i+1)%6],geo=new T.BufferGeometry();
  geo.setAttribute('position',new T.Float32BufferAttribute([-hexL/2,a.y,a.z,hexL/2,a.y,a.z,hexL/2,b.y,b.z,-hexL/2,b.y,b.z],3));geo.setIndex([0,1,2,0,2,3]);geo.computeVertexNormals();
  const panel=new T.Mesh(geo,new T.MeshStandardMaterial({color:i<3?'#e0e2d9':'#c0a687',roughness:.92,side:T.DoubleSide}));k.tag(hex,panel,'2023 Hexapod faceted shell',layers.wall);
  for(const xx of [-hexL/2,hexL/2])k.rod(hex,'2023 Hexapod plywood edge',[xx,a.y,a.z],[xx,b.y,b.z],.027,'#b39065',layers.wall);
 }
 for(const side of [-1,1]){
  const shape=new T.Shape();hexCorners.forEach((p,i)=>i?shape.lineTo(p.z,p.y):shape.moveTo(p.z,p.y));shape.closePath();
  if(side===-1){const door=new T.Path();door.moveTo(-.49,-1.20);door.lineTo(-.49,.90);door.lineTo(.49,.90);door.lineTo(.49,-1.20);door.closePath();shape.holes.push(door);}
  const cap=new T.Mesh(new T.ShapeGeometry(shape),new T.MeshStandardMaterial({color:'#d8d6c7',roughness:.9,side:T.DoubleSide}));cap.rotation.y=Math.PI/2;cap.position.x=side*hexL/2;k.tag(hex,cap,'2023 Hexapod end panel',layers.wall);
 }
 for(const zz of [-.53,.53])k.rod(hex,'2023 Hexapod west doorway jamb',[-hexL/2-.018,-1.20,zz],[-hexL/2-.018,.95,zz],.04,'#ae8052',layers.wall);
 k.rod(hex,'2023 Hexapod doorway lintel',[-hexL/2-.018,.95,-.53],[-hexL/2-.018,.95,.53],.04,'#ae8052',layers.wall);
 // Pink/red stripe across the white roof is visible in both end-orbit views.
 for(const i of [0,1,2]){const a=hexCorners[i],b=hexCorners[(i+1)%6];k.rod(hex,'2023 Hexapod roof seam',[-.65,a.y+.015,a.z],[-.65,b.y+.015,b.z],.018,'#b96885',layers.detail);}
 // Hoisting frame and webbing: separate from adjacent low terrace roof.
 for(const xx of [-3.5*BAY,-2.5*BAY])for(const zz of [.12,3.44])k.box(g,'Hexapod hoist rack upright',[.075,4.15,.075],[xx,2.075,zz],'#344c40',layers.steel);
 for(const zz of [.12,3.44])k.box(g,'Hexapod overhead hoist beam',[BAY,.13,.075],[-3*BAY,4.02,zz],'#b64c2e',layers.steel);
 for(const xx of [-3*BAY-1.02,-3*BAY+1.02]){
  for(const side of [-1,1])k.rod(g,'Hexapod suspension webbing',[xx,4.04,1.78+side*1.66],[xx,1.115,1.78+side*.80],.022,'#b6a57c',layers.detail);
  k.rod(g,'Hexapod underfloor sling',[xx,1.10,.98],[xx,1.10,2.58],.022,'#b6a57c',layers.detail);
 }
 // Red/yellow hanging fabric below the pod's south flank; actual source crop,
 // not a solid wall sealing the space under the cabin.
 const hexCloth=k.box(g,'2023 Hexapod photographed red yellow hanging',[2.55,.92,.025],[-3*BAY,1.95,3.42],k.photo('/history/2023/hexapod-fabric-c6656-t12.webp'),layers.detail);
 hexCloth.userData.source='c6656t12 crop(74,608)-(190,649); low-resolution fabric detail; no invented painted motif';
 k.wall(g,BAY,2.16,-2*BAY,d/2,1.35,'#183fad');
 k.wall(g,3*BAY,2.16,BAY,d/2,1.35,'#9e805c');
 k.wall(g,2*BAY,2.16,2.5*BAY,d/2+.03,1.35,k.photo('/history/2023/front-arches-v2.webp'));
 k.wall(g,d,2.2,w/2,0,1.34,'#d4e0dc',Math.PI/2);
 k.wall(g,BAY,4.42,0,-d/2,2.55,'#dbe4de');
 k.wall(g,BAY,2.2,-2*BAY,-d/2,1.34,'#ad875e');
 k.wall(g,2*BAY,2.2,2.5*BAY,-d/2,1.34,'#384b7d');
 // c6656t64/70/80: rear eastern two bays carry blue/green painted panels;
 // the next bay toward the white central wall has a hanging woven textile.
 // Use only unobstructed upper wall pixels, not people/vehicles below them.
 const rearArtGeo=new T.PlaneGeometry(2*BAY,1.50,12,6);
 const rearUV=rearArtGeo.getAttribute('uv');
 for(let i=0;i<rearUV.count;i++){
  const u=rearUV.getX(i),v=rearUV.getY(i);
  const top=[344+(624-344)*u,700+(776-700)*u];
  const bottom=[344+(624-344)*u,883+(945-883)*u];
  rearUV.setXY(i,(bottom[0]+(top[0]-bottom[0])*v)/1920,1-(bottom[1]+(top[1]-bottom[1])*v)/1080);
 }
 const rearArt=new T.Mesh(rearArtGeo,k.photo('/history/2023/review5-rear-c6656-t80.jpg'));
 rearArt.rotation.y=Math.PI;rearArt.position.set(2.5*BAY,1.59,-d/2-.055);
 k.tag(g,rearArt,'2023 rear blue green source painting',layers.wall);rearArt.userData.walkNoCollision=true;
 rearArt.userData.source='c6656t80 pixels quad(344,700)(624,776)(624,945)(344,883); upper painted strip only, lower occluded wall not invented';
 // Flat woven ribbons, curved through the hanging back and outward seat.
 // Exact weave count is unresolved; these are visual strips, not engineering rigging.
 const netPoint=(u:number,v:number)=>new T.Vector3(BAY+(u-.5)*(BAY-.18),4.65-2.02*v-.12*Math.sin(Math.PI*u)*Math.sin(Math.PI*v),-d/2-.06-.12*Math.sin(Math.PI*v)-.54*Math.pow(v,5));
 const ribbon=(across:boolean,t:number)=>{
  const points:number[]=[],indices:number[]=[];
  for(let j=0;j<=20;j++)for(const side of [-1,1]){
   const a=j/20,b=Math.max(0,Math.min(1,t+side*.009));const q=across?netPoint(a,b):netPoint(b,a);points.push(q.x,q.y,q.z);
  }
  for(let j=0;j<20;j++){const n=j*2;indices.push(n,n+1,n+2,n+1,n+3,n+2);}
  const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(points,3));geo.setIndex(indices);geo.computeVertexNormals();
  const mesh=new T.Mesh(geo,new T.MeshStandardMaterial({color:across?'#b38383':'#ad727d',side:T.DoubleSide,roughness:1}));
  k.tag(g,mesh,across?'rear hanging textile cross weave':'rear hanging textile vertical weave',layers.detail);mesh.userData.walkNoCollision=true;mesh.userData.source='c6656t64/70/80: open reddish woven back/seat, one rear bay immediately east of tall white panel; weave density and sag fitted';
 };
 for(let i=0;i<=14;i++)ribbon(false,i/14);
 for(let j=0;j<=9;j++)ribbon(true,j/9);

 k.wall(g,2.5,2.25,-.5*BAY,-d/2+.13,1.37,k.photo('/history/2023/ant-mural-c69219.webp'),Math.PI/2);
 // Explicit panel count/orientation: c6656 11s = 5 columns × 4 rows of
 // landscape modules, not the generic helper's portrait grid.
 const panels=(parent:T.Group,cols:number,rows:number,pw:number,ph:number,x:number,y:number,z:number,tilt:number)=>{
  for(let c=0;c<cols;c++)for(let r=0;r<rows;r++){
   const dz=(r+.5-rows/2)*ph,px=x+(c+.5-cols/2)*pw,py=y-dz*Math.sin(tilt),pz=z+dz*Math.cos(tilt);
   const frame=k.box(parent,'solar module frame',[pw-.025,.045,ph-.025],[px,py,pz],'#a9b0b1',layers.roof);frame.rotation.x=tilt;
   const cells=k.box(parent,'photovoltaic cells',[pw-.075,.008,ph-.075],[px,py+.027*Math.cos(tilt),pz+.027*Math.sin(tilt)],'#172b3c',layers.roof);cells.rotation.x=tilt;
  }
 };
 panels(g,5,4,1.65,.99,.5*BAY,1.65,d/2+1.65,.79);
 for(let c=0;c<=5;c++)k.rod(g,'PV timber leaning support',[(c-2.5)*1.65+.5*BAY,.16,d/2+3.05],[(c-2.5)*1.65+.5*BAY,3.17,d/2+.24],.045,'#aa8d64',layers.detail);
 // Named rooms retain their known identities. Bay boundaries are provisional;
 // the annotated ground sequence gives real room details, not surveyed plans.
 const room=(id:string,name:string,x:number)=>{const r=k.assembly(id,name,[x,0,0]);g.add(r);return r;};
 const bar=room('chatsubo','Chatsubo · west end bar',-2.5*BAY);
 k.table(g,-2.5*BAY,.6,2.6,.7,.92);k.wall(bar,3.3,1.8,0,-d/2+.05,1.08,k.photo('/history/2023/swirls.webp'));
 const cave=room('media-cave','Media Cave · enclosed projection room',.5*BAY);
 k.screen(g,.5*BAY,1.55,-d/2+.09,2.1);k.box(cave,'gray couch',[2.2,.42,.9],[0,.47,.9],'#999b9f');
 const simulation=room('simulation','Simulation · internal stepped bay',-BAY);
 simulation.userData.source='c6656 110s, seven visible wide rack-supported upper tiers';
 const library=room('library','Mars Library · inferred room bay',2*BAY);
 for(let i=0;i<4;i++)k.box(library,'book shelf',[2.7,.045,.32],[0,.7+i*.43,-d/2+.25],'#9d8159');
 const cafe=room('cafe','Niyama café · inferred room bay',3*BAY);k.table(cafe,0,.6,2.2,.8,.86);
 // Rotapolis is parallel to Chiba, across its rear courtyard. The former
 // full-height 2×2 square and end-to-end site placement contradicted the orbit.
 const r=k.assembly('kitchen','Rotapolis · one tower beside low event bay',[8,0,-33],0,
  'c1034 frontal; c6657 0–12s back orbit; c6656 34s and60s. Two 12ft beam bays, only right bay roof-high. Depth33m remains provisional. Lateral8m follows correlated c6656t11/t15 roof-plane visual fits; not calibrated photogrammetry.');
 r.userData.entity_id='rotapolis_2023';
 const rd=4.572;
 section(r,-BAY/2,1,2.48,rd);section(r,BAY/2,1,4.8768,rd);
 k.deck(r,2*BAY,rd,.22);k.deck(r,2*BAY,rd,2.46);k.deck(r,BAY,rd,4.86,BAY/2,0,true);
 const rk=k.assembly('kitchen-interior','Rotapolis enclosed kitchen',[BAY/2,0,0]);r.add(rk);
 k.kitchen(rk,BAY,rd,2023);
 k.wall(rk,BAY,2.18,0,-rd/2,1.35,'#ad8a62');k.wall(rk,rd,2.18,BAY/2,0,1.35,'#ad8a62',Math.PI/2);
 k.wall(rk,rd,2.18,-BAY/2,0,1.35,'#ad8a62',Math.PI/2);
 k.box(rk,'kitchen rear window',[.76,.78,.09],[.6,1.32,-rd/2-.045],'#68878e',layers.detail);
 k.box(rk,'red mini fridge',[.62,.79,.6],[1.18,.4,.68],'#a82d29',layers.detail);
 k.box(r,'Rotapolis lounge bench',[1.9,.47,.76],[-BAY/2,.48,-rd/2+.6],'#5f4b43',layers.detail);
 // c1034 lower flight has exposed orange rack beams and open risers.
 for(let i=0;i<7;i++){
  const y=.24+(i+1)*2.22/7,z=rd/2+3.7-(i+.5)*3.7/7;
  k.box(r,'Rotapolis lower stair tread',[BAY,.065,3.7/7-.01],[BAY/2,y,z],'#bfa17b',layers.floor);
  k.box(r,'Rotapolis stair orange beam',[BAY,.12,.075],[BAY/2,y-.08,z+3.7/14],'#b84c26',layers.steel);
  for(const x of [0,BAY])k.box(r,'Rotapolis stair support',[.075,y,.075],[x,y/2,z],'#344c40',layers.steel);
 }
 panels(r,4,3,.92,1.02,BAY/2,5.91,.42,.86);
 // The upper access is a narrow ladder on the LOW bay, not another broad stair.
 for(const dx of [-.4,.4])k.rod(r,'lookout ladder stile',[-.85+dx,2.49,-rd/2+.3],[.5+dx,4.9,-rd/2+.3],.045,'#ae9165',layers.floor);
 for(let i=0;i<9;i++){const t=(i+.5)/9;k.rod(r,'lookout ladder rung',[-1.25+1.35*t,2.49+2.41*t,-rd/2+.3],[-.45+1.35*t,2.49+2.41*t,-rd/2+.3],.025,'#ae9165',layers.floor);}
 k.rod(r,'Rotapolis flagpole',[BAY,4.7,rd/2],[BAY,9.7,rd/2],.035,'#a38a61',layers.context);
 k.box(r,'blue flag',[1.1,.62,.02],[BAY+.57,9.23,rd/2],'#283c83',layers.context);
 // Trailer parking follows rear/side sectors in c6653,6656,6668. March14 state.
 const trailers:[number,number,number,number,string][]=[
  [8,-8,Math.PI/2,8,'long slide-out tandem trailer directly behind Chiba'],
  [17,-9,0,7.4,'second white tandem trailer northeast side'],
  [19,-16,.1,7,'white trailer outer rear cluster'],
  [24,-8,.1,6.5,'small white trailer outer rear cluster'],
  [-9,-8,0,6.9,'Mesa Ridge trailer behind west Chiba bay'],
 ];
 trailers.forEach(([x,z,a,length,source],i)=>{const rv=k.rv(`rv-${i+1}`,x,z,a,length);rv.userData.source=source;});
 const vehicle=(id:string,name:string,x:number,z:number,rot:number,color:string,len:number)=>{
  const v=k.assembly(id,name,[x,0,z],rot,'March14 c6656/6668 observed class; fitted parking sector.');
  const tall=id==='yellow-service-truck'||id==='painted-school-bus'||id==='census-v03';
  const isVan=tall||name.toLowerCase().includes('van');
  const width=tall?2.35:1.95,bodyHeight=tall?2.25:.7;
  k.box(v,'vehicle body',[width,bodyHeight,len],[0,tall?1.5:.78,0],color,layers.context);
  if(!tall)k.box(v,'vehicle cabin',[width*.89,isVan?1.12:.65,len*(isVan?.8:.57)],[0,isVan?1.58:1.39,-len*.07],color,layers.context);
  const glass=k.box(v,'front windscreen',[width*.8,tall?.65:.48,.035],[0,tall?1.9:(isVan?1.77:1.42),tall?len/2+.03:len*(isVan?.33:.22)],'#3e535b',layers.context);
  if(!isVan)glass.rotation.x=-.38;
  for(const side of [-1,1]){
   if(tall){const count=id==='yellow-service-truck'?2:5;for(let i=0;i<count;i++)k.box(v,'bus side window',[.03,.64,len*(count===2?.19:.1)],[side*(width/2+.015),1.95,(i-(count-1)/2)*len*(count===2?.31:.16)],'#344950',layers.context);}
   else k.box(v,'side glass',[.025,.45,len*(isVan?.47:.43)],[side*(width*.445+.014),isVan?1.79:1.48,-len*.07],'#344950',layers.context);
   for(const zz of [-len*.3,len*.3]){
    const tire=new T.Mesh(new T.CylinderGeometry(tall?.38:.32,tall?.38:.32,.19,12),k.mat('#222527'));
    tire.rotation.z=Math.PI/2;tire.position.set(side*(width/2-.01),tall?.39:.33,zz);k.tag(v,tire,'motor vehicle tire',layers.context);
   }
  }
  return v;
 };
 vehicle('yellow-service-truck','Yellow service box truck',-14,-24,Math.PI/2,'#d3aa43',7.8);
 const bus=vehicle('painted-school-bus','IMU painted school bus',-14.8,1,0,'#c9b17c',7.2);
 panels(bus,2,1,.9,1.6,0,2.75,0,.1);
 vehicle('orange-pickup','Orange pickup',25,-1,Math.PI/2,'#bd552f',5.6);
 vehicle('black-suv','Dark SUV in front of Chiba',-7,7,Math.PI/2,'#33363a',4.8);
 // The same-date orbit also resolves these motor vehicles; IDs correspond
 // to the retained pixel census. Positions are fitted sectors, not GPS fixes.
 const parked:[string,string,number,number,number,string,number][]=[
  ['census-v01','Distant compact car',-28,-27,0,'#66816c',4.2],
  ['census-v02','Silver sedan beside service truck',-19,-15,.4,'#a9ada9',4.6],
  ['census-v03','White blue shuttle bus',-22,-27,Math.PI/2,'#d1d5d4',7.5],
  ['census-v05','Dark pickup beside service truck',-16,-19,Math.PI/2,'#3b3635',5.5],
  ['census-v06','Painted art van',-10,-41,Math.PI/2,'#338f86',4.4],
  ['census-v07','Silver car beyond truck',-8,-36,Math.PI/2,'#a5afb1',4.5],
  ['census-v08','White minivan beside lookout',14,-35,Math.PI/2,'#d6d5c7',4.7],
  ['census-v09','White van beyond lookout',8,-45,Math.PI/2,'#dfded1',5.7],
  ['census-v10','Dark pickup beyond lookout',21,-46,Math.PI/2,'#4a554b',5.2],
  ['census-v11','White SUV behind trailer cluster',24,-28,Math.PI/2,'#dadbd5',4.9],
  ['census-v12','Two tone van at perimeter',38,-37,Math.PI/2,'#aca997',5.0],
  ['census-v15','Dark car outside white trailers',30,-12,.5,'#33373d',4.5],
  ['census-v18','White SUV in foreground',-21,20,.5,'#dedfda',4.9],
  ['census-v19','Dark SUV in foreground',13,19,.5,'#35515a',4.9],
 ];
 for(const [id,name,x,z,rot,color,len] of parked)vehicle(id,name,x,z,rot,color,len);
}
function make2024(k:Kit){
 // Jan 22 near-nadir c30786: the *main roof* is 750×385 source pixels, or
 // 6×3 nominal 12-ft bays (aspect 1.95). The sloping southern frontage is
 // additional to this rectangle. See year-2024/MEASUREMENT.json.
 const w=6*BAY,d=3*BAY,aisleX=-BAY/2,g=k.assembly('chiba','Chiba · painted frontage, solar and glazing');
 // c42733: access is 0.52 bay west of the main-roof midpoint. It occupies
 // the rack bay [-BAY,0], centered on the seven-bay footprint with terrace.
 k.frame(g,6,3,4.8768,true);k.deck(g,w,d,.22);
 for(const o of g.children.slice())if(o.userData.kind==='12 foot orange beam'&&Math.abs(o.position.x-aisleX)<.01&&Math.abs(o.position.y-2.48)<.01)g.remove(o);
 k.deck(g,2*BAY,d,2.46,-2*BAY,0,true);
 k.deck(g,3*BAY,d,2.46,1.5*BAY,0,true);
 g.userData.source='c30786 Jan 22 near-nadir; c42733 Jan 12 north facade; c41609 Mar 4 south facade';
 g.userData.measurement='6×3 nominal 12-ft bays for main roof; auditorium/access one half-bay west of main-roof center (c42733 measured0.52bay); roof corners ±0.5 bay, campus offsets ±5m';
 k.deck(g,w,d,4.86,0,0,true);roofRails(k,g,w,d,4.7);
 // The north facade is two white walls with a central doorway/landing and
 // straight stairs up from the bare courtyard (c42733); it is not red.
 const northGap=3.2;
 for(const [lo,hi] of [[-w/2,aisleX-northGap/2],[aisleX+northGap/2,w/2]])k.wall(g,hi-lo,4.45,(lo+hi)/2,-d/2,2.43,'#e8e7df');
 const northStairs=new T.Group();northStairs.userData={...g.userData,layer:layers.floor};
 northStairs.position.set(aisleX,0,-d/2-3.66);northStairs.rotation.y=Math.PI;g.add(northStairs);
 k.stairs(northStairs,3.2,7.32,2.22,0,0,9);
 k.wall(g,d,2.3,-w/2,0,1.38,'#b32629',Math.PI/2);k.wall(g,d,2.3,w/2,0,1.38,'#c7bca1',Math.PI/2);
 // March frontage photos + Gene's 2026-09-29 front / solarium photos: vertical inset with straight
 // stairs and the door landing, leaning flaps (PV left, plexiglass solarium right), plexiglass end wall + door.
 frontage2024(k,g,w,d);
 // c42733 north oblique + c30786 nadir: roof access bypasses the north
 // doorway canopy on its EAST side. No source roof hatch supports the former
 // generic south interior flight, which terminated under a continuous deck.
 // These endpoints fit the visible diagonal wedge; exact tread count is unresolved.
 const bypassStart=new T.Vector2(.04,-d/2-.92),bypassEnd=new T.Vector2(1.28,-d/2+.10);
 const bypassDelta=bypassEnd.clone().sub(bypassStart),bypassLength=bypassDelta.length(),bypassDir=bypassDelta.clone().normalize();
 const bypassWidth=.82,bypassBase=2.46+.0325,bypassTop=4.86+.0325,bypassRise=bypassTop-bypassBase,bypassSteps=7;
 const bypassAngle=Math.atan2(-bypassDir.x,-bypassDir.y);
 for(let i=0;i<bypassSteps;i++){
  const t=(i+.5)/bypassSteps,p=bypassStart.clone().addScaledVector(bypassDelta,t),y=bypassBase+(i+1)*bypassRise/bypassSteps;
  const tread=k.box(g,'north roof bypass open tread',[bypassWidth,.065,bypassLength/bypassSteps+.015],[p.x,y-.0325,p.y],'#bca078',layers.floor);tread.rotation.y=bypassAngle;
  tread.userData.source='c42733 north doorway-side access; c30786 diagonal exterior wedge east of canopy.7treads and endpoint fit approximate, topology directly observed';
 }
 const bypassNormal=new T.Vector2(-bypassDir.y,bypassDir.x);
 for(const side of [-1,1]){
  const a=bypassStart.clone().addScaledVector(bypassNormal,side*bypassWidth/2),b=bypassEnd.clone().addScaledVector(bypassNormal,side*bypassWidth/2);
  k.rod(g,'north bypass timber stringer',[a.x,bypassBase-.12,a.y],[b.x,bypassTop-.12,b.y],.055,'#a48661',layers.floor);
  k.rod(g,'north bypass handrail',[a.x,bypassBase+.86,a.y],[b.x,bypassTop+.86,b.y],.028,'#a48661',layers.floor);
 }
 // The north roof guard must leave the observed access route clear.
 for(const o of g.children.slice())if(o.userData.kind==='timber roof railing'&&Math.abs(o.position.z+d/2)<.01)g.remove(o);
 for(const [lo,hi] of [[-w/2,.55],[2.01,w/2]])k.rod(g,'north roof guard beside bypass',[lo,5.65,-d/2],[hi,5.65,-d/2],.04,'#ae9165',layers.roof);

 // c30786 roof silhouette includes a one-bay northward roof-access tongue.
 // The elevated east bay remained open to the desert in Feb (c1013/c1016),
 // with a low timber ceiling, black practice mats and a textile wall.
 // c42733/c30786: this silhouette is stair platforms and a small doorway
 // canopy; the previous full-height projecting roof slab was invented.
 k.box(g,'north doorway canopy',[BAY,.085,2.0],[aisleX,4.6,-d/2-.65],'#c2ab78',layers.roof);
 for(const side of [-1,1])k.wall(g,.57,1.98,aisleX+side*1.3,-d/2-.04,3.45,'#e3e2d8');
 k.deck(g,BAY,1.25,2.46,aisleX,-d/2-.48);
 // c42733 Jan12 and c1039 December build: the west strip is enclosed below
 // its north terrace, but open ABOVE the stepped roof-access decks. It is
 // not a fourth full-height roof frame. Heights remain photographic estimates.
 const westTerrace=k.assembly('west-terrace','West stepped roof access / enclosed north end',[-w/2-BAY/2,0,0]);g.add(westTerrace);
 westTerrace.userData.source='c42733 Jan12 north enclosure and open stepped silhouette; c1039 December north wall; c43740 construction varied-height posts; c30786 Jan22 overhead';
 const terraceHeights=[3.1,3.8,4.86];
 k.frame(westTerrace,1,3,4.8768,false);
 // Keep the supporting rack rhythm, but move its transverse ties to the
 // local deck underside and trim supports: no suspended orange grid over it.
 for(const o of westTerrace.children.slice()){
  const bay=Math.max(0,Math.min(2,Math.floor((o.position.z+d/2)/BAY)));
  const h=terraceHeights[bay],kind=o.userData.kind;
  if(kind==='rack upright'){o.scale.y=h/4.8768;o.position.y=h/2;}
  if(kind==='12 foot orange beam'&&o.position.y>4)o.position.y=h-.12;
  if(kind==='upright bracing'){
   const bounds=new T.Box3().setFromObject(o);
   if(bounds.max.y>h-.08)westTerrace.remove(o);
  }
 }
 for(let i=0;i<3;i++){
  const h=terraceHeights[i],z=(i-1)*BAY;
  k.deck(westTerrace,BAY,BAY,h,0,z,true);
  // Outer west edge timber guard follows each terrace, not the main roof.
  for(const zz of [z-BAY/2,z+BAY/2])k.rod(westTerrace,'terrace guard post',[-BAY/2,h,zz],[-BAY/2,h+.85,zz],.035,'#a48661',layers.floor);
  k.rod(westTerrace,'terrace guard rail',[-BAY/2,h+.85,z-BAY/2],[-BAY/2,h+.85,z+BAY/2],.035,'#a48661',layers.floor);
 }
 k.wall(westTerrace,BAY,terraceHeights[0]-.22,0,-d/2,(terraceHeights[0]+.22)/2,'#e8e7df');
 k.rod(westTerrace,'north terrace guard rail',[-BAY/2,terraceHeights[0]+.85,-d/2],[BAY/2,terraceHeights[0]+.85,-d/2],.035,'#a48661',layers.floor);
 for(let i=0;i<2;i++){
  const f=new T.Group();f.userData={...westTerrace.userData};f.position.set(0,terraceHeights[i]-.24,(i-.5)*BAY);f.rotation.y=Math.PI;westTerrace.add(f);k.stairs(f,2.9,1.7,terraceHeights[i+1]-terraceHeights[i],0,0,5);
 }
 // c33391 native west facade: enclosed white outer wall, horizontal paired
 // windows, two tall doors; yellow upper inset beside the stepped terraces.
 // Opening dimensions are proportional fits; no unsupported cabin roof cut.
 const westOpenings=[{z:-4.40,y:1.30,w:.82,h:2.16},{z:-.65,y:1.60,w:2.20,h:.85},{z:-.65,y:3.03,w:2.20,h:.85},{z:1.18,y:1.60,w:.48,h:.62},{z:3.33,y:1.40,w:.86,h:2.36}];
 for(let bay=0;bay<3;bay++){
  const lo=-d/2+bay*BAY,hi=lo+BAY,top=terraceHeights[bay]-.04;
  const cuts=westOpenings.filter(o=>o.z+o.w/2>lo&&o.z-o.w/2<hi);
  const zs=[lo,hi,...cuts.flatMap(o=>[Math.max(lo,o.z-o.w/2),Math.min(hi,o.z+o.w/2)])].sort((a,b)=>a-b);
  const ys=[.22,top,...cuts.flatMap(o=>[Math.max(.22,o.y-o.h/2),Math.min(top,o.y+o.h/2)])].sort((a,b)=>a-b);
  for(let iz=1;iz<zs.length;iz++)for(let iy=1;iy<ys.length;iy++){
   const z=(zs[iz-1]+zs[iz])/2,y=(ys[iy-1]+ys[iy])/2,width=zs[iz]-zs[iz-1],height=ys[iy]-ys[iy-1];
   if(width<.001||height<.001||cuts.some(o=>Math.abs(z-o.z)<o.w/2&&Math.abs(y-o.y)<o.h/2))continue;
   k.wall(westTerrace,width,height,-BAY/2,z,y,'#e7e8df',Math.PI/2);
  }
 }
 for(const o of westOpenings.filter(o=>o.h<1)){
  const glass=k.box(westTerrace,'west facade window glazing',[.022,o.h,o.w],[-BAY/2-.04,o.y,o.z],'#5e7275',layers.wall);
  glass.userData.source='c33391: paired broad horizontal west windows and small lower square window; glazing appearance obscured, size fitted';
 }
 // The yellow upper wall follows the two lowered terrace levels. Its north
 // door is a real opening onto the lowest terrace, rather than a painted panel.
 for(let bay=0;bay<2;bay++){
  const lo=-d/2+bay*BAY,hi=lo+BAY,base=terraceHeights[bay],top=4.86;
  const doorZ=-4.46,doorW=.83,doorTop=4.78;
  if(bay===0){
   for(const [a,b] of [[lo,doorZ-doorW/2],[doorZ+doorW/2,hi]])k.wall(g,b-a,top-base,-w/2,(a+b)/2,(top+base)/2,'#e4c940',Math.PI/2);
   k.wall(g,doorW,top-doorTop,-w/2,doorZ,(top+doorTop)/2,'#e4c940',Math.PI/2);
  }else k.wall(g,BAY,top-base,-w/2,(lo+hi)/2,(top+base)/2,'#e4c940',Math.PI/2);
 }
 const dojo=k.assembly('dojo','Upper east dojo / practice bay',[w/2-BAY/2,2.46,0]);g.add(dojo);
 dojo.userData.source='Gene c1013/c1016 Feb 8; c1027 Jan 25 and c43093: Chiba top east bay, open east side, black floor mats along entire long bay, hanging textile';
 for(let ix=-1;ix<=1;ix++)for(let iz=-4;iz<=4;iz++)k.box(dojo,'black interlocking floor mat',[1.12,.025,1.12],[ix*1.12,.045,iz*1.12],'#25272b',layers.floor);
 k.wall(dojo,BAY,1.8,0,-d/2,1.0,'#d8b2bd');
 // c42690 shows an occupied upper Chiba gallery: low plywood ceiling,
 // white pin-up walls, long shelf, two brown chairs and a red cabinet. Its
 // precise bay is unproven; this west/central placement is a spatial proxy.
 const gallery=k.assembly('upper-gallery','Upper gallery / reading lounge',[-2*BAY,2.46,0]);g.add(gallery);
 gallery.userData.source='c42690 Mar 3 upper Chiba interior; bay placement tentative';
 k.wall(gallery,2*BAY,2.15,0,-BAY/2,1.12,'#e6e5db');
 k.box(gallery,'long display shelf',[3.6,.08,.35],[-.9,1.04,-BAY/2+.23],'#d5c3a1',layers.detail);
 k.box(gallery,'red storage cabinet',[.9,1.45,.6],[-2.4,.74,-.45],'#a7353e',layers.detail);
 for(const x of [-.7,1.15])k.box(gallery,'brown lounge chair',[.8,.53,.84],[x,.34,.75],'#674434',layers.detail);

 // c32034/c43728/c43729: four open plywood seating terraces on orange beams, a full-height
 // screen at the low south end, and a high north landing. The seven-tread
 // generic auditorium helper obscured this interior section.
 k.screen(g,aisleX,2.55,d/2-.18,3.25,Math.PI,4.15);
 for(let i=0;i<4;i++){
  const y=.35+i*.61,z=1.5-i*1.78;
  k.box(g,'auditorium broad seating terrace',[BAY-.15,.085,1.78],[aisleX,y,z],'#b79973',layers.floor);
  // Open fronts are explicit in c43728/29 and under the occupied lowest
  // seat in c32034. These are beam-supported decks, not solid stair boxes.
  for(const dz of [-.83,.83])k.box(g,'auditorium orange seat support',[BAY,.12,.08],[aisleX,y-.103,z+dz],'#bd4e29',layers.steel);
  for(const dx of [-1.05,0,1.05])k.box(g,'auditorium seat joist',[.045,.09,1.66],[aisleX+dx,y-.087,z],'#d2bd96',layers.floor);
  k.box(g,'auditorium plywood front edge',[BAY-.15,.04,.035],[aisleX,y-.019,z+.89],i===0?'#ded9c7':'#c9b28d',layers.floor);
 }
 k.deck(g,BAY,1.0,2.46,aisleX,-d/2+.4);
 for(const side of [-1,1])k.wall(g,8.9,3.98,aisleX+side*BAY/2,-.6,2.37,side===-1?'#dfdfd5':'#bda17b',Math.PI/2);
 const partition=k.box(g,'painted interior rack partition',[4.1,2.15,.015],[aisleX+BAY/2-.045,3.52,-1.0],k.photo('/history/2024/interior-mural-c43728.webp'),layers.wall);
 partition.rotation.y=Math.PI/2;partition.userData.source='c43727/c43728 interior build partition; auditorium aligns between rack lines x=-BAY and0 per c42733 entrance';partition.userData.walkNoCollision=true;
 // The low-ceiling projection room c43185 is distinct from the tall auditorium.
 const lowRoom=k.assembly('low-projection-room','Low ceiling projection lounge',[-2*BAY,0,-1]);g.add(lowRoom);
 lowRoom.userData.source='c43185 low ceiling, rack-lined projection room; west-side bay allocation tentative';
 k.screen(lowRoom,0,1.3,-2.65,BAY-.25,0,1.96);
 k.box(lowRoom,'low ceiling plywood',[BAY,.065,2*BAY],[0,2.3,0],'#a98a67',layers.floor);
 for(const side of [-1,1])k.wall(lowRoom,2*BAY,2.13,side*BAY/2,0,1.3,'#b7976f',Math.PI/2);
 k.box(lowRoom,'projection lounge floor cushion',[2.3,.18,1.6],[0,.34,.55],'#6d5b67',layers.detail);
 // Gene's c43084 is the southwest entrance/shop, while c42761/c43051/c43052
 // put sofas, tables and a glazed lattice roof in the southeast solarium.
 const shop=k.assembly('neomotion-shop','Southwest workshop / entrance',[-w/2+BAY/2,0,d/2-BAY/2]);g.add(shop);
 shop.userData.source='c43084 Jan 15: southwest Chiba corner, plywood wall, rack and workbench';
 k.wall(shop,BAY,2.2,0,-BAY/2,1.35,'#bb986e');k.table(shop,0,.75,2.5,.8,.8);
 const solarium=k.assembly('solarium','Southeast glazed solarium',[w/2-BAY/2,0,d/2+.65]);g.add(solarium);
 solarium.userData.source='c578/c42761/c43051/c43052 Jan 15–17: southeast glazed enclosure, sofa and meeting table';
 // Keep the east end-wall doorway clear; the room photo does not fix the table's exact XY position.
 k.table(solarium,0,1.35,2.8,1.0,.75);k.box(solarium,'solarium sofa',[2.5,.42,.9],[0,.43,-1.65],'#c4b9a6');
 // Gene c42862 names the kitchen as inside Chiba. The photograph shows a
 // metal-grate floor, counter and red under-counter refrigerator; its exact
 // bay is unknown, so keep the position explicitly tentative.
 const chibaKitchen=k.assembly('chiba-kitchen','Chiba kitchen / counter',[BAY/2,0,-BAY/2]);g.add(chibaKitchen);
 chibaKitchen.userData.source='Gene c42862 Feb 21: Chiba kitchen; bay position approximate';
 k.box(chibaKitchen,'steel grate floor',[2.9,.05,2.25],[0,.1,0],'#657078',layers.floor);
 k.box(chibaKitchen,'kitchen counter',[3,.9,.78],[0,.54,-.65],'#a88968',layers.detail);
 k.box(chibaKitchen,'red under-counter refrigerator',[.68,.72,.62],[.8,.43,-.55],'#922d36',layers.detail);

 // In c30786 Freeside is 7 nominal bays across and approximately 2 deep.
 // Its centre is 4m west and 47m north of Chiba, NOT 35m north. Only its
 // middle ~3 bays have a full plywood roof; the outer wings are open rack
 // shelters with tents and low service boxes. The south-central face is PV.
 const fx=-4.0,fz=-46.7,fc=k.assembly('kitchen','Freeside · covered solar hub',[fx,0,fz]);
 fc.userData.entity_id='freeside_2024';fc.userData.source='c30786 Jan 22 near-nadir and c33391 Jan 12 oblique';
 fc.userData.measurement='whole span ~7 rack bays; center (-4,-47)m relative to Chiba; ±5m site offset';
 fc.scale.x=.8; // c30786: roof core ~one third of total frontage, not3/7.
 k.frame(fc,3,2,4.8768,true);k.deck(fc,3*BAY,2*BAY,.22);
 // c30786: continuous central plywood canopy; the lower wings have tarps.
 k.deck(fc,3*BAY,2*BAY,4.86,0,0,true);
 k.wall(fc,3*BAY,2.2,0,-BAY,1.35,'#bd9a68');
 // c30786 original crop resolves two banks of six panels in two courses.
 for(let row=0;row<2;row++)for(let col=0;col<12;col++){
  const x=-5.05+col*.84+(col>=6?.32:0),dz=(row-.5)*1.9;
  // c41728 / c42483: bottom course bears at ground, not above head height.
  const tilt=1.05,centerY=-.16+1.87*Math.sin(tilt)+.05;
  k.solar(fc,.82,1.84,x,centerY-dz*Math.sin(tilt),BAY+1.5+dz*Math.cos(tilt),tilt);
 }
 const kitchenInterior=k.assembly('kitchen-interior','Freeside service / storage counter',[0,0,-BAY/2]);fc.add(kitchenInterior);
 kitchenInterior.userData.source='c43551 camp-services: water and toilet supplies at a folding table in Freeside; no Freeside cooking evidence';
 k.table(kitchenInterior,0,0,2.9,.8,.78);
 for(const x of [-.9,.9])k.box(kitchenInterior,'water jug',[.35,.55,.35],[x,.52,0],'#91b4bb',layers.detail);
 const cafe=k.assembly('cafe','Freeside shared table',[0,0,BAY/2]);fc.add(cafe);k.table(cafe,0,0,2.8,.8,.8);
 for(const side of [-1,1]){
  const wing=k.assembly(side===1?'freeside-wing':'freeside-west-wing',side===1?'Freeside east tent wing':'Freeside west tent wing',[fx+side*2.35*BAY,0,fz]);
  wing.userData.entity_id='freeside_2024';wing.userData.source='c30786 Jan 22 + c41728 storm panorama: rear tents, lower plywood front rooms and blue tarp covers';
  wing.scale.x=1.15; // preserve total observed span while widening each three-shelter wing.
  k.frame(wing,2,2,2.48,false);k.deck(wing,2*BAY,2*BAY,.22);
  k.wall(wing,2*BAY,1.9,0,BAY,1.17,'#b98c5b');
  k.box(wing,'front wing blue tarp canopy',[2*BAY,.04,2.35],[0,2.49,BAY-1.05],'#427da1',layers.roof);
  for(const [i,color] of (side===1?['#d6c9a8','#dce1db','#e2d5b8']:['#4b8886','#207db3','#8da763']).entries()){
   const x=-2.25+i*2.25;
   k.box(wing,'canvas shelter lower wall',[1.96,1.15,2.25],[x,.8,-1.25],color,layers.context);
   const roof=new T.Mesh(new T.CylinderGeometry(0,1.45,1.02,4,1,false,Math.PI/4),k.mat(color));roof.scale.z=1.15;roof.position.set(x,1.87,-1.25);k.tag(wing,roof,'peaked canvas shelter roof',layers.context);
   k.box(wing,'tent dark entrance',[.76,1.04,.025],[x,.78,-.105],'#333b39',layers.detail);
  }
  k.box(wing,'front utility booth',[2.2,2.0,1.8],[side*2.6,1.2,BAY-.1],'#bb9162',layers.wall);
 }
 // Jan 22 parking is a broad U around Freeside, open through the centre of
 // the two-building courtyard. These are individually placed from c30786,
 // not an ellipse. IDs rv-1…rv-18 retain saved Studio references; smaller
 // van/bus/car shapes are explicitly distinguished from travel trailers.
 const observed:[number,number,number,number,'trailer'|'bus'|'van'|'car'][]=[
  [612,415,-1.0,5.2,'van'],[709,422,-.65,7.6,'trailer'],[675,467,-.15,7.0,'bus'],
  [630,526,-.55,6.3,'bus'],[595,581,1.35,8.1,'trailer'],[585,637,1.42,8.0,'trailer'],
  [598,688,1.38,5.3,'van'],[692,886,-.65,8.0,'trailer'],
  [1136,415,.6,7.8,'trailer'],[1183,464,.75,7.4,'trailer'],[1220,488,1.05,6.7,'trailer'],
  [1252,519,.72,6.1,'van'],[1284,633,1.45,8.7,'bus'],[1260,581,1.15,3.9,'van'],
  [1267,740,1.0,5.1,'van'],[1260,789,.85,6.5,'trailer'],[1188,831,.65,4.7,'car'],[1170,867,.55,7.8,'trailer'],
 ];
 const photoX=974,photoY=946,pxPerM=11.84; // c30786 downscaled 1824×1366 display coords
 // Low-poly source-class silhouettes, not manufacturer-specific models.
 // Shared wheel geometry within this year's fleet; no texture downloads.
 const tire2024=new T.CylinderGeometry(.34,.34,.18,10,1,false,Math.PI/10),tireMat2024=k.mat('#292b2c');
 const shapeVehicle2024=(body:T.Mesh,width:number,length:number,type:string)=>{
  const top=type==='bus'?2.625:type==='van'?2.10:1.63,hood=type==='bus'?1.55:type==='van'?1.3:.92;
  const profile:[number,number][]=[[-length/2,.20],[-length/2,type==='pickup'?.88:top-.25],[-length*.38,type==='pickup'?.88:top],[-length*.20,top], [length*.16,top],[length*.33,hood],[length/2,hood-.12],[length/2,.20]];
  const outline=new T.Shape();profile.forEach(([z,y],i)=>i?outline.lineTo(-z,y-body.position.y):outline.moveTo(-z,y-body.position.y));outline.closePath();
  body.geometry=new T.ExtrudeGeometry(outline,{depth:width,bevelEnabled:false});body.geometry.rotateY(Math.PI/2);body.geometry.translate(-width/2,0,0);
 };
 const detailVehicle2024=(v:T.Group,width:number,length:number,type:string)=>{
  for(const side of [-1,1])for(const zz of [-length*.31,length*.30]){
   const wheel=new T.Mesh(tire2024,tireMat2024);wheel.rotation.z=Math.PI/2;wheel.position.set(side*(width/2-.035),.18,zz);k.tag(v,wheel,'observed vehicle tire',layers.context);
  }
  for(const side of [-1,1]){
   k.box(v,'observed vehicle side glazing',[.024,type==='bus'?.63:.48,length*(type==='bus'?.57:.46)],[side*(width/2+.013),type==='bus'?2.10:type==='van'?1.67:1.31,-length*.1],'#435861',layers.context);
   k.box(v,'observed vehicle headlamp',[.30,.17,.035],[side*width*.33,type==='bus'?1.07:.69,length/2+.025],'#e3ddbf',layers.context);
  }
  k.box(v,'observed vehicle front bumper',[width+.05,.15,.13],[0,.43,length/2+.025],'#555b5b',layers.context);
  v.userData.source+='; low-poly class silhouette and trim approximate, no brand/model identity claimed';
 };

 observed.forEach(([px,py,angle,length,type],i)=>{
  const x=(px-photoX)/pxPerM,z=(py-photoY)/pxPerM,id=`rv-${i+1}`;
  if(type==='trailer'){const rv=k.rv(id,x,z,angle,length);rv.userData.source='c30786 Jan 22 topdown; position ±2m, heading approximate';return;}
  const veh=k.assembly(id,type==='bus'?'School bus / service vehicle':type==='van'?'Camper van':'Car',[x,0,z],angle);
  veh.userData.source='c30786 Jan 22 topdown; vehicle class and position approximate';
  const color=type==='bus'?(i===3?'#2d597e':i===2?'#ded7b8':'#d6b747'):i===13?'#a7312a':type==='car'?'#e4e6e6':'#d7d8d4';
  const body=k.box(veh,`${type} body`,[type==='bus'?2.5:2.2,type==='bus'?2.35:1.9,length],[0,type==='bus'?1.45:1.15,0],color,layers.context);
  shapeVehicle2024(body,type==='bus'?2.5:2.2,length,type);detailVehicle2024(veh,type==='bus'?2.5:2.2,length,type);
  const screen=k.box(veh,`${type} windscreen`,[1.85,.58,.05],[0,1.7,length/2+.04],'#445861',layers.context);
  screen.geometry=screen.geometry.clone();screen.geometry.rotateX(-.55);screen.geometry.translate(0,type==='bus'?.35:.02,-length*.255);
  if(i===2)k.solar(veh,2.1,3.3,0,2.8,0,.02); // solar-roof bus in west camp
 });
 // Separate small cars and work vehicles. Their source-pixel centres, unlike
 // the RV ring's, are in the original 5272×3948 image and listed in the
 // machine-readable ledger. Do not infer their persistence through March.
 const smallCars:[number,number,number,number,string,string][]=[
  [1455,1700,.28,4.8,'grey SUV','#545c61'],[1800,1620,-.28,4.9,'dark SUV','#303a39'],
  [1550,1780,.15,4.7,'blue-roof car','#31618b'],[3180,1125,.06,4.7,'Freeside east car','#354c53'],
  [3930,1810,.1,5.3,'black pickup','#272a2b'],[3930,2390,.4,5.6,'black pickup','#292c30'],
  [3500,2500,1.1,4.6,'white car','#d4d8d7'],[3660,2600,.75,4.9,'white utility car','#c9d5d7'],
  [2119,3015,-.8,5.0,'Chiba west white car','#e4e6dd'],[1804,3340,.1,5.4,'south orange work pickup','#c57236'],
  [1928,3307,.05,4.7,'south black car','#252b2d'],
 ];
 smallCars.forEach(([px,py,angle,length,name,color],i)=>{
  const x=(px-974*(5272/1824))/(pxPerM*(5272/1824)),z=(py-946*(3948/1366))/(pxPerM*(3948/1366));
  const car=k.assembly(`car-${i+1}`,name,[x,0,z],angle);
  car.userData.source='c30786 Jan 22 original source-pixel centre; type and heading approximate';
  const body=k.box(car,'small vehicle body',[2.0,1.42,length],[0,.92,0],color,layers.context);
  shapeVehicle2024(body,2,length,name.includes('pickup')?'pickup':'car');detailVehicle2024(car,2,length,'car');
  if(name.includes('pickup'))k.box(car,'observed pickup bed',[1.83,.025,length*.27],[0,.90,-length*.35],'#4b514e',layers.context);
  const screen=k.box(car,'windscreen',[1.72,.47,.04],[0,1.15,length/2+.03],'#42525a',layers.context);
  screen.geometry=screen.geometry.clone();screen.geometry.rotateX(-.75);screen.geometry.translate(0,.14,-length*.255);
 });
}
function make2025(k:Kit){
 const w=3*BAY,d=3*BAY,g=k.assembly('chiba','Chiba · central steps and red wings');
 k.frame(g,3,3,4.8768,true,d);k.deck(g,w,d,.22);
 // The middle of the auditorium stays hollow (c46581 and Gene's correction).
 for(const o of g.children.slice())if(o.name==='12 foot orange beam'&&Math.abs(o.position.x)<.1&&Math.abs(o.position.y-2.48)<.01&&o.position.z>-d/2+.05)g.remove(o);
 g.userData.source='c72593–c72600 Jan 31 cardinal series (three front rack bays), c47305 Feb 22 roof orbit, c46581 Jan 29 auditorium; site topology from c509 panorama, c538 and c47305 orbit; Gene correction: Tool Camp across courtyard, Freeside lateral west';
 g.userData.measurement='Three 12-foot bays across (c72595 front upright sequence); 3-bay depth supported by nine 4-foot plywood sheets in c72596 east facade; nominal bay scale, not surveyed';
 // The January front is three steel rack bays across: open stair/bleacher bay
 // between two enclosed wings. The roof is a broad white deck in February,
 // not two disconnected timber terraces (c47305 frames 48–152).
 for(const o of g.children.slice())if(o.userData.layer===layers.roof)g.remove(o);
 for(const side of [-1,1]){k.deck(g,BAY,d,2.48,side*BAY,0,true);k.deck(g,BAY,d,4.86,side*BAY,0,true);k.wall(g,BAY,2.2,side*BAY,d/2,1.35,'#ba342d');}
 // c47268 completed frontage: red upper room fronts sit BELOW the low
 // terrace, rather than a bare rack opening. Central entrance remains open.
 for(const side of [-1,1]){
  const panel=k.wall(g,BAY,1.30,side*BAY,d/2-.035,3.13,'#ba342d');
  panel.userData.source='c47268 occupied front and c549 west/south: red upper wing panels below lowered terraces; height fitted to nominal upper floor';
  // c46813 late doorway and c47305 t142.5: reused glazed doors are infill
  // beside a real central opening, joined to the roof by a continuous header.
  const opening=1.10,doorWidth=.78,doorX=side*(opening/2+doorWidth/2),doorHeight=2.10;
  const entrance=k.box(g,'upper entrance reused door',[doorWidth,doorHeight,.06],[doorX,2.43+doorHeight/2,d/2-.08],'#e2ded1',layers.wall);
  entrance.userData.source='c46813 late occupied door wall; c47305 t142.5 pale glazed reused doors beside dark interior opening; widths fitted to 12ft rack bay';
  const infillWidth=BAY/2-opening/2-doorWidth;
  k.box(g,'upper entrance outer plywood infill',[infillWidth,doorHeight,.06],[side*(BAY/2-infillWidth/2),2.43+doorHeight/2,d/2-.08],'#b79c74',layers.wall);
  k.box(g,'upper entrance inset window',[.48,.67,.018],[doorX,3.92,d/2-.043],'#485758',layers.detail);
  k.box(g,'upper entrance window mullion',[.035,.67,.022],[doorX,3.92,d/2-.029],'#ddd8c9',layers.detail);
  k.box(g,'upper entrance door handle',[.065,.19,.035],[doorX-side*.28,3.18,d/2-.015],'#877044',layers.detail);
 }
 k.box(g,'upper entrance continuous header',[BAY,.33,.065],[0,4.695,d/2-.08],'#b79c74',layers.wall);
 // No black plane seals the central opening. A narrow physical sill joins
 // the exterior landing through the thickness of the wall.
 k.box(g,'upper entrance threshold',[1.10,.065,.20],[0,2.43,d/2-.04],'#b99c70',layers.floor);
 // c72606: central void continues to the north plywood wall; no upper rear bridge.
 k.deck(g,BAY,d,4.86,0,0,true);
 for(const side of [-1,1])k.box(g,'white roof membrane',[BAY-.025,.035,d-.025],[side*BAY,4.91,0],'#efede8',layers.roof);
 k.box(g,'white roof membrane',[BAY-.025,.035,d-.025],[0,4.91,0],'#efede8',layers.roof);
 // c46522 skeleton + c46118 t9: broad equal-span rack seating staggered
 // laterally; the sixth/top level is the enclosure roof/shared landing below.
 // Dimensions are fitted, not surveyed; never taper these into a tiny stair.
 const stairOffsets=[2.65,2.55,2.40,2.25,2.10],stairWidth=BAY-.08;
 const stairPlank=(kind:string,a:number[],b:number[],width:number,depth:number,color:string)=>{
  const av=new T.Vector3().fromArray(a),bv=new T.Vector3().fromArray(b),delta=bv.clone().sub(av);
  const m=k.box(g,kind,[width,delta.length(),depth],av.clone().add(bv).multiplyScalar(.5).toArray(),color,layers.floor);
  m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),delta.normalize());return m;
 };
 for(let i=0;i<5;i++){
  const y=.28+i*.43,z=d/2+5.7-i*1.02,x=stairOffsets[i];
  const platform=k.box(g,'staggered rack stair platform',[stairWidth,.075,1.1],[x,y,z],['#bd9b70','#967083','#bd9b70','#d5b766','#bd9b70'][i],layers.floor);
  platform.userData.source='c46522 exposed rack spans; c46118 t9 equal-width seating with triangular corner steps; fitted offsets';
  k.box(g,'stair orange rack beam',[stairWidth+.08,.12,.08],[x,y-.12,z+.48],'#b84c26',layers.steel);
  for(const side of [-1,1]){
   const xx=x+side*(stairWidth+.08)/2;
   k.box(g,'stair rack upright',[.065,y+1,.065],[xx,(y+1)/2,z+.48],'#344943',layers.steel);
   if(i>0)k.rod(g,'stair rack end diagonal',[xx,.07,z-.48],[xx,y-.16,z+.48],.018,'#344943',layers.steel);
  }
  // Horizontal triangular half-height treads on the exposed western edge.
  const shape=new T.Shape();shape.moveTo(0,0);shape.lineTo(.72,0);shape.lineTo(0,.75);shape.closePath();
  const m=new T.Mesh(new T.ExtrudeGeometry(shape,{depth:.055,bevelEnabled:false}),k.mat('#bfa36f'));
  m.rotation.x=-Math.PI/2;m.position.set(x-stairWidth/2-.28,y+.21,z+.40);k.tag(g,m,'triangular intermediate stair tread',layers.floor);
  if(i<4)for(const side of [-1,1])stairPlank('front stair timber handrail',[x+side*stairWidth/2,y+.93,z+.48],[stairOffsets[i+1]+side*stairWidth/2,y+1.36,z-.54],.075,.10,'#bea16c');
 }
 // Late occupied c47305 t135/t142.5: TWO deep lowered platforms before the
 // continuous white roof. The former four thin strips mixed building phases.
 for(const side of [-1,1]){
  const lowX=side*.45,highX=side*(BAY/2+.10),z=d/2+1.72,count=side<0?4:6;
  for(let i=0;i<count;i++)k.box(g,'upper flight open timber tread',[Math.abs(highX-lowX)/count+.035,.065,.90],[lowX+(highX-lowX)*(i+.5)/count,2.43+(i+1)*(3.88-2.43)/count,z],'#b89a75',layers.floor);
  // c72612/c72610 show wide rectangular timber stringers, not round poles.
  // c46869 close-up resolves a continuous notched plank directly UNDER
  // every tread. The previous box cross-section put its width across the
  // staircase instead of in the vertical stair plane, making it a flat strip.
  const run=Math.abs(highX-lowX),rise=3.88-2.43,stringerShape=new T.Shape();
  stringerShape.moveTo(0,-.12);stringerShape.lineTo(0,rise/count-.0325);
  for(let i=0;i<count;i++){
   stringerShape.lineTo(run*(i+1)/count,rise*(i+1)/count-.0325);
   if(i<count-1)stringerShape.lineTo(run*(i+1)/count,rise*(i+2)/count-.0325);
  }
  stringerShape.lineTo(run,rise-.30);stringerShape.closePath();
  const stringerGeometry=new T.ExtrudeGeometry(stringerShape,{depth:.065,bevelEnabled:false});
  for(const dz of [-.43,.43]){
   const m=new T.Mesh(stringerGeometry,k.mat('#ac8f69'));m.scale.x=side;m.position.set(lowX,2.43,z+dz-.0325);
   k.tag(g,m,'upper flight timber stringer',layers.floor);m.userData.source='c46869: continuous notched timber support board beneath treads; .065m thickness and lower edge fitted';
  }
  for(const [y,zz] of [[3.88,d/2+1.83],[4.40,d/2+.61]]){
   const deck=k.box(g,'upper side terrace tread',[BAY,.075,1.22],[side*BAY,y,zz],side===-1&&y===4.40?'#785d90':'#bca075',layers.floor);
   deck.userData.source='c47305 t142.5: bare lower standing platform, purple intermediate seating platform, white roof above; heights/depth nominal rack fit';
   k.box(g,'upper side terrace rack beam',[BAY,.12,.08],[side*BAY,y-.10,zz+.58],'#b84c26',layers.steel);
  }
  // c72593/c46522 expose paired full-height rack end frames carrying the
  // terraces, not floating shelves. Nominal post heights are fitted; source
  // shows their tops above the main roof and diagonal ties in the end planes.
  for(const xx of [side*BAY/2,side*1.5*BAY]){
   for(const zz of [d/2+1.18,d/2+2.40]){
    const post=k.box(g,'front terrace rack upright',[.075,5.40,.075],[xx,2.70,zz],'#344943',layers.steel);
    post.userData.source='c72593/c46522 full-height paired terrace end uprights; footprint and5.40m height fitted to nominal rack';
   }
   for(const y of [.20,2.43,4.80,5.15])k.rod(g,'front terrace end horizontal tie',[xx,y,d/2+1.18],[xx,y,d/2+2.40],.023,'#344943',layers.steel);
   for(const [y0,y1,reverse] of [[.20,2.43,0],[2.43,4.80,1]])k.rod(g,'front terrace end diagonal',[xx,y0,d/2+(reverse?2.40:1.18)],[xx,y1,d/2+(reverse?1.18:2.40)],.023,'#344943',layers.steel);
  }
  k.box(g,'front terrace upper guard beam',[BAY,.12,.08],[side*BAY,4.80,d/2+2.40],'#b84c26',layers.steel);
 }
 // c72601 looks upward toward the open south facade; c72606 looks back
 // down toward the north plywood screen wall. Entry is the HIGH seating end.
 // Six tier depths/heights are a nominal fit, not a surveyed stair schedule.
 const auditoriumEntryTop=2.43+.065/2;
 for(let i=0;i<6;i++){
  const y=.42+i*(auditoriumEntryTop-.045-.42)/5,z=d/2-.58-(5-i)*1.15;
  const tier=k.box(g,'auditorium tiered timber platform',[BAY-.12,.09,1.16],[0,y,z],'#a98b64',layers.floor);
  tier.userData.source='c72601/c72606/c46581: open plywood seating rises south to entrance; top surface continuous with shared landing, exact intermediate spacing fitted';
  k.box(g,'auditorium tier supporting beam',[BAY-.12,.12,.08],[0,y-.10,z-.5],'#b84c26',layers.steel);
 }
 // c549/c72595: projecting enclosure under the landing, with passage to its east.
 const roomFront=d/2+2.2,roomLeft=-BAY/2,roomRight=.15,roomHeight=2.18;
 for(const x of [roomLeft,roomRight])k.wall(g,2.2,roomHeight,x,d/2+1.1,roomHeight/2+.22,'#b99b75',Math.PI/2);
 const doorX=-.80,doorW=.88;
 for(const [x,width] of [[(roomLeft+doorX-doorW/2)/2,doorX-doorW/2-roomLeft],[(doorX+doorW/2+roomRight)/2,roomRight-doorX-doorW/2]])k.wall(g,width,roomHeight,x,roomFront,roomHeight/2+.22,'#b99b75');
 k.box(g,'projecting room door',[doorW,1.94,.045],[doorX,1.19,roomFront+.04],'#998b76',layers.wall);
 k.box(g,'projecting room door lintel',[roomRight-roomLeft,.24,.06],[(roomLeft+roomRight)/2,2.27,roomFront],'#bfa17b',layers.wall);
 const sharedLanding=k.box(g,'projecting enclosure roof',[BAY,.065,2.2],[0,2.43,d/2+1.1],'#bfa17b',layers.floor);
 sharedLanding.userData.source='c46522/c72612: broad shared stair landing also roofs the projecting room; not three coplanar overlapping decks';
 const roomFrontArt=new T.Mesh(new T.PlaneGeometry(roomRight-roomLeft,roomHeight),k.photo('/history/2025/review6-room-front.webp'));
 roomFrontArt.position.set((roomLeft+roomRight)/2,roomHeight/2+.22,roomFront+.085);
 k.tag(g,roomFrontArt,'projecting room stickered door source',layers.detail);roomFrontArt.userData.walkNoCollision=true;
 roomFrontArt.userData.source='c549 native quadrilateral (2541,2058)(2901,2065)(2910,2436)(2544,2427): closed six-panel door and sticker-covered plywood, rectified source pixels';
 const roomSideArt=new T.Mesh(new T.PlaneGeometry(2.2,roomHeight),k.photo('/history/2025/review6-room-side.webp'));
 roomSideArt.position.set(roomLeft-.035,roomHeight/2+.22,d/2+1.1);roomSideArt.rotation.y=-Math.PI/2;
 k.tag(g,roomSideArt,'projecting room portrait source',layers.detail);roomSideArt.userData.walkNoCollision=true;
 roomSideArt.userData.source='c549 native quad (2384,2066)(2541,2058)(2544,2427)(2404,2425): painted portrait on protruding west wall; rectified visible source face';
 k.box(g,'projecting door handle',[.055,.09,.055],[doorX-doorW*.37,1.18,roomFront+.10],'#393b36',layers.detail);
 // c549: upholstered two-seat sofa with arms, not a freestanding pink bench.
 k.box(g,'front pink sofa seat',[1.75,.39,.70],[.55,.095,roomFront+.6],'#dc81a9',layers.detail);
 k.box(g,'front pink sofa back',[1.75,.65,.16],[.55,.61,roomFront+.28],'#dc81a9',layers.detail);
 for(const side of [-1,1])k.box(g,'pink sofa upholstered arm',[.16,.50,.72],[.55+side*.80,.24,roomFront+.60],'#d7799f',layers.detail);
 for(const x of [-.15,1.25])for(const z of [roomFront+.33,roomFront+.88])k.box(g,'pink sofa foot',[.09,.06,.09],[x,-.13,z],'#8f6c68',layers.detail);
 k.box(g,'pink sofa center cushion seam',[.009,.007,.51],[.55,.294,roomFront+.60],'#bc648e',layers.detail);
 for(const x of [-BAY/2,BAY/2])k.box(g,'19 foot central upright',[.075,5.7912,.075],[x,2.8956,d/2],'#293c45',layers.steel);
 k.box(g,'raised center crossbeam',[BAY,.12,.08],[0,5.67,d/2],'#b84c26',layers.steel);
 roofRails(k,g,w,d,4.7);
 // One south-facing roof row (c72608 and c46119 f12), and the red roof
 // constellation visible in the February orbit; neither belongs to the Jan
 // 31 unfinished facade state.
 // c46119 12s resolves eight portrait panels: two banks of four and a central gap.
 for(const side of [-1,1])for(let i=0;i<4;i++)k.solar(g,1.02,1.94,side*(.7+i*1.04),5.65,-d/2+.85,.82);
 // c47305 75s (rear elevation): four landscape plywood sheets form the
 // back of the north solar bank. They stand above the white roof; the
 // January facade photograph alone does not contain this later detail.
 for(let i=0;i<4;i++){
  const panel=k.box(g,'north solar plywood back',[2.425,1.2192,.035],[(i-1.5)*2.4384,5.56,-d/2+.22],'#b99b75',layers.roof);
  panel.userData.source='c47305 75s, rear orbit: four landscape plywood sheets above roof behind solar';
 }
 // Five separate pentagonal petals around a white pentagon, not radial triangles.
 for(let i=0;i<5;i++){
  const angle=i*2*Math.PI/5+Math.PI/2;
  const petal=new T.Mesh(new T.CircleGeometry(1.13,5,angle),k.mat('#b93435'));
  petal.rotation.x=-Math.PI/2;petal.position.set(1.79*Math.cos(angle),4.936,-.55-1.79*Math.sin(angle));petal.userData.walkNoCollision=true;k.tag(g,petal,'red pentagonal roof petal',layers.roof);
 }
 // Front-center shelf and the two photographed ornaments (c74008; c47305).
 k.box(g,'front roof ornament shelf',[2.4384,.08,1.2192],[0,5.78,d/2-.30],'#b79a70',layers.roof).userData.source='c47305 t0/t142.5 and c549: broad plywood shelf on raised central beam; nominal8x4ft fit, not measured';
 // c549 close detail shows tangled open red lobes, not a solid polyhedron.
 const redLoopGeometry=new T.TorusKnotGeometry(.22,.028,36,4,2,5);
 const orb=new T.Mesh(redLoopGeometry,k.mat('#d32137'));orb.position.set(0,6.20,d/2+.04);k.tag(g,orb,'red geometric roof ornament',layers.detail);
 orb.userData.source='c549 red open curled sculpture: low-poly loop interpretation, exact weave unresolved';
 for(const side of [-1,1]){const lobe=new T.Mesh(redLoopGeometry,k.mat('#d32137'));lobe.scale.setScalar(.70);lobe.position.set(side*.23,6.02,d/2+.07);k.tag(g,lobe,'red ornament lower curled lobe',layers.detail);lobe.userData.source=orb.userData.source;}
 for(let level=0;level<7;level++)for(let side=0;side<4;side++){
  const t=side*Math.PI/2,r=.22+level*.025,y=5.45+level*.32;
  k.rod(g,'branching wire roof ornament',[r*Math.cos(t),y,d/2+.62+r*Math.sin(t)],[r*Math.cos(t+.9),y+.45,d/2+.62+r*Math.sin(t+.9)],.009,'#796756',layers.detail);
 }
 k.wall(g,d,2.25,-w/2,0,1.37,'#b63229',Math.PI/2);k.wall(g,3.4,2.2,-w/2,-2,3.64,k.photo('/history/2025/flower.webp'),Math.PI/2);
 // Gene-labeled c72598 is the west face, not a generic red wall. Place its
 // full painted surface just outside the existing editable wall pieces.
 const west=k.box(g,'Chiba west painted facade photo',[d,4.5,.008],[-w/2-.065,2.35,0],k.photo('/history/2025/chiba-west-c549.webp'),layers.wall);
 west.rotation.y=Math.PI/2;west.userData.walkNoCollision=true;west.userData.source='Gene-labeled c549 west/south view; rectified occupied-season west painting, corroborated by c47305 105s';
 // c72596: open east doorway near north end, one sheet wide. Preserve
 // the same wall's transform/id while replacing its geometry with a real gap.
 const eastDoorCenter=3.84,eastDoorWidth=.99,eastDoorTop=2.45;
 const eastWall=k.wall(g,d,2.2,w/2,0,1.35,'#ae9772',Math.PI/2);
 const eastPieces:T.Shape[]=[];
 for(const [lo,hi] of [[-d/2,eastDoorCenter-eastDoorWidth/2],[eastDoorCenter+eastDoorWidth/2,d/2]]){
  const sh=new T.Shape();sh.moveTo(lo,-1.1);sh.lineTo(hi,-1.1);sh.lineTo(hi,1.1);sh.lineTo(lo,1.1);sh.closePath();eastPieces.push(sh);
 }
 eastWall.geometry=new T.ExtrudeGeometry(eastPieces,{depth:.055,bevelEnabled:false});eastWall.geometry.translate(0,0,-.0275);
 eastWall.userData.source='c72596 Jan31: doorway near north end, approximately one4ft panel wide; source doorway remains open';
 k.wall(g,d,2.35,w/2,0,3.625,'#bda17b',Math.PI/2).userData.source='c72596 continuous upper east plywood enclosure above lower panel/door course';
 const east=k.box(g,'Chiba east plywood facade photo',[d,4.5,.008],[w/2+.067,2.35,0],k.photo('/history/2025/chiba-east-c72596.webp'),layers.wall);
 east.rotation.y=Math.PI/2;east.userData.walkNoCollision=true;east.userData.source='c72596 Jan 31 east side, rectified crop; mixed white/stenciled lower panels and unfinished upper plywood';
 // Match the photographic plane to the physical opening, including UVs.
 // The existing single billboard painted black doorway pixels over solid wall.
 const ep:number[]=[],eu:number[]=[],ei:number[]=[];
 for(const [x0,x1,y0,y1] of [[-d/2,eastDoorCenter-eastDoorWidth/2,-2.25,2.25],[eastDoorCenter+eastDoorWidth/2,d/2,-2.25,2.25],[eastDoorCenter-eastDoorWidth/2,eastDoorCenter+eastDoorWidth/2,eastDoorTop-2.35,2.25]]){
  const base=ep.length/3;
  for(const [x,y] of [[x0,y0],[x1,y0],[x1,y1],[x0,y1]]){ep.push(x,y,0);eu.push(x/d+.5,y/4.5+.5);}
  ei.push(base,base+1,base+2,base,base+2,base+3);
 }
 east.geometry=new T.BufferGeometry();east.geometry.setAttribute('position',new T.Float32BufferAttribute(ep,3));east.geometry.setAttribute('uv',new T.Float32BufferAttribute(eu,2));east.geometry.setIndex(ei);east.geometry.computeVertexNormals();

 const north=k.box(g,'Chiba north patchwork facade photo',[w,4.5,.008],[0,2.35,-d/2-.067],k.photo('/history/2025/chiba-north-c72594.webp'),layers.wall);
 north.rotation.y=Math.PI;north.userData.walkNoCollision=true;north.userData.source='c72594 Jan 31 north/back face, rectified crop including eye mural';
 // c72606/c72601 establish the low north presenter end; high south entrance
 // up the seating terraces. A screen on the north wall contradicted that
 // evidence. Its projection surface is outside this photograph, so do not
 // invent its position. The visible low-end projector sits on a board.
 const presenter=k.assembly('presenter-station','Auditorium north presenter station',[0,0,-d/2+.75]);g.add(presenter);
 presenter.userData.source='c46581/c72606: presenter at low north end, audience rises toward south entrance; equipment coordinates fitted';
 k.table(presenter,0,0,1.8,.7,.72);
 k.box(presenter,'white tabletop projector',[.36,.10,.28],[-.5,.795,0],'#e9e8e4',layers.detail);
 k.box(presenter,'open laptop base',[.31,.02,.22],[.42,.753,0],'#57595b',layers.detail);
 const laptop=k.box(presenter,'open laptop screen',[.31,.22,.014],[.42,.86,-.1],'#33383b',layers.detail);laptop.rotation.x=-.18;
 const talk=k.assembly('classroom','Chiba lounge and workspace',[-BAY,0,0]);k.table(talk,0,-1.2,2,.7);k.screen(talk,0,1.3,-1.6,1.1);k.box(talk,'pink sofa seat',[2,.38,.85],[0,.48,2],'#a35e75');k.box(talk,'pink sofa back',[2,.58,.15],[0,.82,2.35],'#a35e75');
 // c538 Jan 31: Freeside has three major bays, a high middle loft and a
 // kitchen/living room below. c509/c538 and the roof orbit put it west of Chiba; the attached
 // small pods stand to its west, unlike the former south-site booths.
 const free=kitchenBuilding(k,-17.1,18.9,2025,'freeside_2025');
 free.userData.source='c538 Jan 31 aerial, c46842 living room, c44513/c44558 kitchen, c509 panorama, c538 south oblique, c47305 37.5–60s; c509 low roof plane2.55m fit: center(-17.1,18.9), west/southwest of Chiba; spacing fitted, not surveyed';
 // c538/c537: open lounge at grade, no broad staircase in front of Freeside.
 for(const o of free.children.slice()){
  if(o.name.startsWith('stair ')||(o.name==='12 foot orange beam'&&o.position.y>3))free.remove(o);
  // c538 shows unbroken plywood roof surfaces; the orange support beams sit
  // under the2.46m-centered65mm sheets, including the visible outer edge beams.
  if(o.name==='12 foot orange beam'&&Math.abs(o.position.y-2.48)<.01)o.position.y=2.365;
  if(o.name==='central rooftop canopy'){o.rotation.x=.62;o.position.y=4.04;}
 }
 // c538 Jan31: four LANDSCAPE modules, two columns by two rows, on right roof.
 // Remove only2025 generic solar/front bands and inherited2023 artwork.
 for(const o of free.children.slice()){
  if(['solar panel','photovoltaic cells'].includes(o.userData.kind))free.remove(o);
  if(o.userData.kind==='plywood wall'&&Math.abs(o.position.z-BAY)<.01&&Math.abs(o.position.x)>BAY/2)free.remove(o);
 }
 free.traverse(o=>{if(o instanceof T.Mesh&&o.parent?.userData.assembly_id==='cafe'&&['café painted counter','plywood wall'].includes(o.userData.kind))o.material=k.mat('#bca07c');});
 for(const col of [-1,1])for(const row of [-1,1]){
  const xx=BAY+col*.81,zz=1.55+row*.53,yy=2.78-(zz-1.55)*Math.sin(.15);
  const panel=k.box(free,'solar panel',[1.59,.045,1.03],[xx,yy,zz],'#a6abb1',layers.roof);panel.rotation.x=.15;
  const cells=k.box(free,'photovoltaic cells',[1.53,.008,.97],[xx,yy+.03,zz+.0045],'#1c344b',layers.roof);cells.rotation.x=.15;
  panel.userData.source='c538 Jan31: four landscape photovoltaic modules,2columns×2rows';
 }
 // Left single window: plywood below/above and narrow side piers, not open lattice.
 for(const side of [-1,1])k.wall(free,.78,2.23,-BAY+side*1.43,BAY,1.365,'#bba584');
 k.wall(free,2.06,.62,-BAY,BAY,.57,'#bba584');
 k.wall(free,2.06,.48,-BAY,BAY,2.24,'#bba584');
 const leftGlass=k.box(free,'Freeside left glazed window',[1.95,1.1,.04],[-BAY,1.435,BAY+.01],new T.MeshStandardMaterial({color:'#70817b',metalness:.25,roughness:.25,transparent:true,opacity:.65}),layers.wall);
 leftGlass.userData.source='c538: single wide rectangular glazed opening in leftfront bay';
 for(const yy of [.86,2.01])k.box(free,'Freeside window timber frame',[2.08,.06,.08],[-BAY,yy,BAY+.04],'#ded0af',layers.wall);
 for(const dx of [-1.02,1.02])k.box(free,'Freeside window timber frame',[.06,1.2,.08],[-BAY+dx,1.435,BAY+.04],'#ded0af',layers.wall);
 // Right bay: a narrow art-covered door left of the broad horizontal service hatch.
 const serviceX=BAY+.58,serviceW=2.15;
 k.wall(free,BAY,.50,BAY,BAY,2.23,'#ba9b70');
 k.wall(free,serviceW,.88,serviceX,BAY,.70,'#bba584');
 for(const xx of [BAY-1.78,BAY-.61,BAY+1.78])k.wall(free,.13,2.23,xx,BAY,1.365,'#b99b75');
 k.box(free,'Freeside service counter sill',[2.25,.07,.32],[serviceX,1.16,BAY+.13],'#c9b58a',layers.detail);
 k.box(free,'Freeside service opening dark interior',[serviceW,.84,.035],[serviceX,1.59,BAY-.35],'#292d29',layers.detail);
 // Open pose requested by Gene for navigation; c538 supplies the leaf artwork,
 // not evidence that it historically stood at this angle.
 const freeDoor=new T.Group();freeDoor.userData={...free.userData};freeDoor.position.set(BAY-1.70,0,BAY+.035);freeDoor.rotation.y=-Math.PI/2;free.add(freeDoor);
 k.box(freeDoor,'Freeside painted door',[1.02,2.08,.07],[.51,1.30,0],'#d3c6ac',layers.wall).userData.source='Gene requested open inspection pose; c538 painted leaf';
 // Direct source-image UVs preserve the actual white/black painting without importing2023 artwork.
 const artGeometry=new T.PlaneGeometry(.98,1.84),artUV=artGeometry.attributes.uv;
 [[1237,480],[1314,487],[1234,620],[1315,626]].forEach(([x,y],n)=>artUV.setXY(n,x/1900,1-y/1069));
 const art=new T.Mesh(artGeometry,k.photo('/history/2025/c538-freeside-source.jpg'));art.position.set(.51,1.36,.043);
 k.tag(freeDoor,art,'Freeside photographed black white door art',layers.wall);art.userData.source='c538 Jan31 visible painted door immediatelyleftofservicewindow; oblique source UV mapping';
 k.box(free,'green rooftop lounge carpet',[BAY-.15,.025,2.9],[0,2.55,.95],'#3d6644',layers.detail);
 k.box(free,'rooftop lounge rear backrest',[BAY-.12,1.2,.08],[0,3.12,-.85],'#a88a60',layers.wall);
 k.box(free,'rooftop lounge cushion',[1.3,.4,.85],[.3,2.76,.25],'#727583',layers.detail);
 // Review4: c46748 rear construction, c44578 kitchen, c46842 living room.
 // Cut openings into the original meshes (same wall/assembly IDs), rather than
 // painting opaque rectangles over plywood. Nominal frame sizes are photo fits.
 const freeGlass=new T.MeshStandardMaterial({color:'#adc7c3',roughness:.16,metalness:.08,transparent:true,opacity:.24,side:T.DoubleSide,depthWrite:false});
 type FreeOpening={x:number;y:number;w:number;h:number;round?:boolean;door?:boolean};
 const freeOpenWall=(wall:T.Mesh,width:number,openings:FreeOpening[],source:string)=>{
  // Doorways are not enclosed Shape holes: the contour opens all the way
  // through the wall bottom. No artificial sill/frame may block feet.
  const shape=new T.Shape();shape.moveTo(-width/2,-1.125);
  for(const a of openings.filter(a=>a.door).sort((a,b)=>a.x-b.x)){
   const top=a.y-wall.position.y+a.h/2;
   shape.lineTo(a.x-a.w/2,-1.125);shape.lineTo(a.x-a.w/2,top);
   shape.lineTo(a.x+a.w/2,top);shape.lineTo(a.x+a.w/2,-1.125);
  }
  shape.lineTo(width/2,-1.125);shape.lineTo(width/2,1.125);shape.lineTo(-width/2,1.125);shape.closePath();
  for(const a of openings){
   const hole=new T.Path(),cy=a.y-wall.position.y;
   if(a.round)hole.absellipse(a.x,cy,a.w/2,a.h/2,0,Math.PI*2,true,0);
   else{hole.moveTo(a.x-a.w/2,cy-a.h/2);hole.lineTo(a.x-a.w/2,cy+a.h/2);hole.lineTo(a.x+a.w/2,cy+a.h/2);hole.lineTo(a.x+a.w/2,cy-a.h/2);hole.closePath();}
   if(!a.door)shape.holes.push(hole);
   const pt=(xx:number,yy:number)=>new T.Vector3(xx,yy-wall.position.y,0).applyAxisAngle(new T.Vector3(0,1,0),wall.rotation.y).add(wall.position);
   if(!a.door){
    const glass=new T.Mesh(a.round?new T.CircleGeometry(a.w/2,48):new T.PlaneGeometry(a.w,a.h),freeGlass);glass.position.copy(pt(a.x,a.y));glass.rotation.y=wall.rotation.y;
    k.tag(free,glass,a.round?'Freeside rear round glazing':'Freeside salvaged window glazing',layers.wall);glass.userData.source=source;
   }
   if(a.round){const ring=new T.Mesh(new T.TorusGeometry(a.w/2,.045,8,48),k.mat('#c8a777'));ring.position.copy(pt(a.x,a.y));ring.rotation.y=wall.rotation.y;k.tag(free,ring,'Freeside round window timber rim',layers.wall);}
   else for(const [xx,yy,ww,hh] of [[a.x,a.y-a.h/2,a.w+.07,.055],[a.x,a.y+a.h/2,a.w+.07,.055],[a.x-a.w/2,a.y,.055,a.h],[a.x+a.w/2,a.y,.055,a.h]]){if(a.door&&yy<a.y-a.h/2+.01)continue;const p=pt(xx,yy),frame=k.box(free,'Freeside salvaged window frame',[ww,hh,.075],[p.x,p.y,p.z],'#d9d7c7',layers.wall);frame.rotation.y=wall.rotation.y;frame.userData.source=source;}
  }
  wall.geometry=new T.ExtrudeGeometry(shape,{depth:.055,bevelEnabled:false,curveSegments:32});wall.geometry.translate(0,0,-.0275);wall.userData.source=source;
 };
 for(const o of free.children.slice())if(o instanceof T.Mesh&&o.userData.kind==='plywood wall'){
  if(Math.abs(o.position.z+BAY)<.01&&Math.abs(o.position.x)<.01){
   freeOpenWall(o,3*BAY,[
    {x:-BAY,y:1.40,w:1.95,h:.95}, // living-room rear, c46748
    {x:-.83,y:1.85,w:.74,h:.74,round:true},
    {x:.72,y:1.30,w:.86,h:2.04,door:true},
    {x:BAY+.45,y:1.26,w:1.14,h:1.80},
    ...[-.95,.02,.99].map(dx=>({x:BAY+dx,y:2.22,w:.88,h:.35})),
   ],'c46748 rear build view; c44578 tall kitchen pane and clerestory row; rear center door/round window positions approximate');
  }else if(Math.abs(o.position.x-1.5*BAY)<.01){
   freeOpenWall(o,2*BAY,[{x:-2.03,y:1.56,w:1.80,h:1.05},{x:.05,y:1.37,w:1.50,h:1.50},{x:2.06,y:1.38,w:1.16,h:1.72}], 'Gene: right kitchen/dining side extensively glazed; c44513/c44541/c44576/c46748, salvaged panes vary; exact side spacing provisional');
  }else if(Math.abs(o.position.x+1.5*BAY)<.01){
   freeOpenWall(o,2*BAY,[{x:-1.60,y:1.47,w:1.92,h:1.12}], 'c46842 living room west window overlooking adjacent pods; one broad side opening, rest plywood');
  }
 }
 // Room partitions retain the open front central lounge: solid living-room
 // boundary (c46842), reused sliding glazing on kitchen boundary (c44578).
 const livingPartition=k.wall(free,2*BAY,2.25,-BAY/2,0,1.36,'#b99b75',Math.PI/2);
 freeOpenWall(livingPartition,2*BAY,[{x:2.4,y:1.30,w:.9,h:2.04,door:true}], 'c46842 solid inner living-room plywood wall; rear access position provisional');
 const kitchenPartition=k.wall(free,2*BAY,2.25,BAY/2,0,1.36,'#b99b75',Math.PI/2);
 freeOpenWall(kitchenPartition,2*BAY,[{x:2.25,y:1.30,w:1.55,h:2.04,door:true},{x:.4,y:1.34,w:1.3,h:1.84}], 'c44578 reused sliding glazed frame on kitchen-to-center boundary; doorway position provisional');
 // The generic helper had kitchen and living room reversed. Group moves leave
 // their child component IDs intact; no campus placement change is involved.
 const freeKitchen=free.children.find(o=>o.userData.assembly_id==='kitchen-interior');
 if(freeKitchen){freeKitchen.position.x=BAY;freeKitchen.userData.source='Gene correction; c44513/c44576/c44578: kitchen in right/front bay';
  // Generic left counter/crates crossed both access routes; their placement
  // was not source recovered. Remove the placeholders instead of blocking entry.
  for(const o of freeKitchen.children.slice())if(o.position.x<-1.0&&['table top','table leg','stored food crate'].includes(o.userData.kind))freeKitchen.remove(o);
 }
 const freeLiving=free.children.find(o=>o.userData.assembly_id==='cafe');
 if(freeLiving){
  freeLiving.position.x=-BAY;freeLiving.name='Freeside living room / libaby';freeLiving.userData.source='c46842/c45110: enclosed plywood lounge, sofas/chairs and low coffee table';
  // Unsupported inherited2023 counter, wall and screen are retired, not renamed
  // into unrelated2025 objects. Keep its existing table as a secondary table.
  for(const o of freeLiving.children.slice())if(['café painted counter','plywood wall','screen','display content'].includes(o.userData.kind))freeLiving.remove(o);
  k.box(freeLiving,'Freeside living room sofa seat',[.80,.32,2.1],[-1.30,.48,.20],'#baad7e',layers.detail);
  k.box(freeLiving,'Freeside living room sofa back',[.16,.58,2.1],[-1.65,.84,.20],'#b2a36f',layers.detail);
  k.box(freeLiving,'Freeside living room low table',[.85,.07,1.30],[0,.53,-.4],'#806043',layers.detail);
  for(const x of [-.34,.34])for(const z of [-.95,.15])k.box(freeLiving,'Freeside coffee table leg',[.055,.42,.055],[x,.29,z],'#765438',layers.detail);
 }
 // Actual kitchen service opening: transparent glazing, not an opaque black
 // backing that concealed the corrected kitchen from the courtyard.
 const serviceBacking=free.children.find(o=>o.name==='Freeside service opening dark interior');
 if(serviceBacking instanceof T.Mesh)serviceBacking.material=freeGlass;
 const booths=k.assembly('utility-booths','Freeside living pods',[-27,0,30],.5);
 booths.userData.entity_id='freeside_2025';booths.userData.source='c538 Jan 31 west-of-Freeside small room row; c47347/c46384 living pods';
 for(let i=0;i<3;i++){const x=i*3.3;
  // The old 'pod wall' was a solid 2.6m-deep block. Build a hollow shell
  // with an actual entry; hidden interior fittings remain unspecified.
  const front=k.box(booths,'pod wall',[2.3,2.25,.065],[x,1.13,1.30],'#b99b75',layers.wall);
  const shape=new T.Shape();shape.moveTo(-1.15,-1.125);shape.lineTo(-.44,-1.125);shape.lineTo(-.44,.93);shape.lineTo(.44,.93);shape.lineTo(.44,-1.125);shape.lineTo(1.15,-1.125);shape.lineTo(.70,1.125);shape.lineTo(-.70,1.125);shape.closePath();
  front.geometry=new T.ExtrudeGeometry(shape,{depth:.065,bevelEnabled:false});front.geometry.translate(0,0,-.0325);
  for(const side of [-1,1]){
   const wall=k.box(booths,'pod side wall',[.065,2.25,2.6],[x+side*1.15,1.13,0],'#b99b75',layers.wall);wall.geometry=wall.geometry.clone();const pos=wall.geometry.getAttribute('position');
   for(let j=0;j<pos.count;j++)pos.setX(j,pos.getX(j)-side*.45*(pos.getY(j)+1.125)/2.25);wall.geometry.computeVertexNormals();wall.userData.source='c46384 three flat-topped pods with inward-sloping sides; nominal width/height fitted';
  }
  const rear=k.box(booths,'pod rear wall',[2.3,2.25,.065],[x,1.13,-1.3],'#b99b75',layers.wall);rear.geometry=rear.geometry.clone();const rearPos=rear.geometry.getAttribute('position');for(let j=0;j<rearPos.count;j++)rearPos.setX(j,rearPos.getX(j)*(1-.45/1.15*(rearPos.getY(j)+1.125)/2.25));rear.geometry.computeVertexNormals();
  k.box(booths,'pod flat roof',[1.5,.09,2.7],[x,2.3,0],'#a39c8d',layers.roof);
  const leaf=k.box(booths,'pod door',[.82,2.03,.06],[x-.44,1.03,1.75],i===0?'#c8a65f':'#d1d0c5',layers.wall);leaf.geometry=leaf.geometry.clone();leaf.geometry.translate(.41,0,0);leaf.position.z=1.34;leaf.rotation.y=-Math.PI/2;
  leaf.userData.source='Gene requested open inspection pose; c46384 tan first door, pale later doors; tapered shells observed, nominal size/position fitted, concealed interiors unmodeled';
  if(i===0){
   const clothGeometry=new T.PlaneGeometry(.70,.90),uv=clothGeometry.attributes.uv;
   [[252,800],[390,752],[275,1005],[403,944]].forEach(([u,v],n)=>uv.setXY(n,u/1920,1-v/1280));
   const cloth=new T.Mesh(clothGeometry,k.photo('/history/2025/reconciliation/pods-c46384-native.webp'));cloth.position.set(.41,.34,.041);leaf.add(cloth);k.tag(leaf,cloth,'Freeside first pod actual red patterned door curtain',layers.detail);cloth.userData.walkNoCollision=true;cloth.userData.source='c46384 native cloth corners; follows open leaf for inspection';
  }
 }
 // Bodywork is its own low dojo: c45835–38
 // show the black exercise floor, low rafters and cloth-lined wall; c543 and
 // c564 place its long plywood shell between Chiba and Tool Camp.
 const body=k.assembly('bodywork-dojo','Mars Bodywork Residency · dojo',[24,0,10],-Math.PI/2+.25);
 body.userData.entity_id='mars_bodywork_residency_2025';body.userData.source='Gene notes c45835–38, c543/c564; c45838 steel interior uprights override registry column-free claim; c509 spherical roof-plane fit review3: center(24,10), long axis approximately north-south;4×2-bay envelope nominal, location uncertain by several meters';
 // c45835/c45838 directly contradict the registry's column-free description:
 // blue rack frames with diagonal ties visibly stand inside the black-mat room.
 k.frame(body,4,2,3.66,false,2*BAY);
 for(const z of [-BAY,BAY])k.box(body,'perimeter roof beam',[4*BAY,.12,.12],[0,3.55,z],'#a48661',layers.steel);
 k.deck(body,4*BAY,2*BAY,.22);
 k.box(body,'black dojo mat',[4*BAY-.45,.05,2*BAY-.42],[0,.3,0],'#292b2d',layers.floor);
 k.box(body,'low patchwork roof',[4*BAY,.09,2*BAY],[0,3.61,0],'#aaa492',layers.roof);
 // Source photograph UVs, not generated artwork: c509 Jan23 black roof with
 // white line drawings/text. The spherical panorama is only approximately planar.
 // Source c509 is reused printed banners, not a generated painting. The old
 // two-triangle UV mapping introduced a diagonal kink and distorted its text.
 const roofArtGeometry=new T.PlaneGeometry(4*BAY-.04,2*BAY-.04,32,16);roofArtGeometry.rotateX(-Math.PI/2);
 const roofUV=roofArtGeometry.attributes.uv,roofPos=roofArtGeometry.attributes.position;
 const H=[-.115607208683,-.341533893099,.841052631579,-.121126356748,-.213131271759,.62,-.210116731518,-.373540856031];
 for(let i=0;i<roofUV.count;i++){
  const u=roofPos.getX(i)/(4*BAY-.04)+.5,v=roofPos.getZ(i)/(2*BAY-.04)+.5,den=H[6]*u+H[7]*v+1;
  roofUV.setXY(i,(H[0]*u+H[1]*v+H[2])/den,1-(H[3]*u+H[4]*v+H[5])/den);
 }
 const roofArt=new T.Mesh(roofArtGeometry,k.photo('/history/2025/c509-roof-source.jpg'));roofArt.position.y=3.661;
 k.tag(body,roofArt,'Bodywork photographed black roof artwork',layers.roof);
 roofArt.userData.source='c509 Jan23 panorama, four manual roof-corner UVs in review3/panorama-fit.json; stitched projection distortion retained';

 k.wall(body,4*BAY,2.3,0,-BAY,1.3,'#ad926c');
 for(const side of [-1,1])k.wall(body,2*BAY,2.3,side*2*BAY,0,1.3,'#b29a78',Math.PI/2);
 k.wall(body,1.25*BAY,2.3,-1.38,BAY,1.3,'#b7a27d');
 k.wall(body,1.25*BAY,2.3,1.38,BAY,1.3,'#b7a27d');
 // c543/c564 west-courtyard elevation: the four-bay low hall is enclosed
 // in brown patchwork plywood, with a pair of small high daylight openings.
 // The prior two overlapping center panels left BOTH outer bays entirely open.
 // Preserve those existing panels/ids; close their uncovered outer intervals.
 const occupiedFacade='c543 occupied west elevation; c564 independent broadside: full brown cladding, pale door/patches, small high openings; panel boundaries fitted';
 for(const side of [-1,1]){
  const outer=k.wall(body,BAY,2.3,side*1.5*BAY,BAY,1.3,side<0?'#ad865e':'#b99a71');outer.userData.source=occupiedFacade;
  if(side<0){
   // Cut the photographed doorway through the actual plywood, not just a
   // pale rectangle over a solid wall. Retain the component and provenance.
   const shape=new T.Shape();shape.moveTo(-BAY/2,-1.15);shape.lineTo(BAY/2,-1.15);shape.lineTo(BAY/2,1.15);shape.lineTo(-BAY/2,1.15);shape.closePath();
   const cx=-.08*BAY,hole=new T.Path();hole.moveTo(cx-.475,-1.05);hole.lineTo(cx-.475,1.03);hole.lineTo(cx+.475,1.03);hole.lineTo(cx+.475,-1.05);hole.closePath();shape.holes.push(hole);
   outer.geometry.dispose();outer.geometry=new T.ExtrudeGeometry(shape,{depth:.058,bevelEnabled:false});outer.geometry.translate(0,0,-.029);
   outer.userData.source+='; c45838 pale entrance, actual cut opening; dimensions fitted';
  }
 }
 const addBodyCladding=(width:number,height:number,x:number,y:number,color:string)=>{
  const panel=k.box(body,'Bodywork courtyard upper plywood cladding',[width,height,.058],[x,y,BAY+.002],color,layers.wall);panel.userData.source=occupiedFacade;
 };
 addBodyCladding(4*BAY,.35,0,2.625,'#ac885e');
 addBodyCladding(4*BAY,.31,0,3.505,'#a8855e');
 // Two0.82m-wide openings remain between the three upper plywood sections.
 for(const [lo,hi] of [[-2*BAY,-BAY-.41],[-BAY+.41,BAY-.41],[BAY+.41,2*BAY]])
  addBodyCladding(hi-lo,.55,(lo+hi)/2,3.075,'#b28f65');
 const paleDoor=k.box(body,'Bodywork pale courtyard door',[.95,2.08,.025],[-1.58*BAY,1.29,BAY+.043],'#d5cbb8',layers.wall);paleDoor.geometry=paleDoor.geometry.clone();paleDoor.geometry.translate(.475,0,0);paleDoor.position.x-=.475;paleDoor.rotation.y=-Math.PI/2;paleDoor.userData.source=occupiedFacade+'; open inspection pose, hinge and width fitted';
 const palePatch=k.box(body,'Bodywork pale plywood patch',[1.65,1.92,.025],[.83*BAY,1.21,BAY+.044],'#d9d7cc',layers.wall);palePatch.userData.source=occupiedFacade;
 k.box(body,'dojo fabric liner',[4*BAY-.4,1.8,.035],[0,1.3,-BAY+.09],'#576b61',layers.detail);
 // High unglazed daylight bands and ceiling fabric, visible in c45838.
 for(const z of [-BAY,BAY]){
  const band=k.box(body,'dojo high daylight band',[4*BAY-.3,.62,.035],[0,3.04,z],'#9baab0',layers.detail);
  band.material=new T.MeshStandardMaterial({color:'#c4d2ce',transparent:true,opacity:.23,roughness:.25,side:T.DoubleSide});band.userData.walkNoCollision=true;
  band.userData.source='c45838 bright upper daylight openings; front apertures follow c543/c564 plywood, translucent glazing fitted';
 }
 for(const x of [-BAY,BAY]){
  const cloth=k.box(body,'dojo ceiling fabric',[BAY-.4,.028,2*BAY-.5],[x,3.35,0],'#d8d6c9',layers.detail);
  const geometry=new T.PlaneGeometry(BAY-.4,2*BAY-.5,8,16);geometry.rotateX(-Math.PI/2);const vertices=geometry.getAttribute('position');
  for(let i=0;i<vertices.count;i++){const u=vertices.getX(i)/(BAY-.4)+.5,v=vertices.getZ(i)/(2*BAY-.5)+.5;vertices.setY(i,-.32*Math.sin(Math.PI*u)*Math.sin(Math.PI*v));}geometry.computeVertexNormals();cloth.geometry.dispose();cloth.geometry=geometry;(cloth.material as T.Material).side=T.DoubleSide;cloth.userData.walkNoCollision=true;cloth.userData.source='c45838 white cloth hangs in shallow swags below the roof; fitted sag, not a solid ceiling slab';
 }
 const toolDepth=8.5344,toolSouth=toolDepth/2;
 const dorm=hall(k,'secondary-house','Tool Camp · workshop and south solar wall',12.7,36.1,3,2,4.8768,false,toolDepth);
 dorm.rotation.y=.32;
 dorm.userData.entity_id='tool_camp_2025';dorm.userData.source='Registry states 36×28×16 ft; c518/c505/c46376/c46379 Apr 3 south solar facade and patchwork enclosure; c509 roof-plane fit review3: center(12.7,36.1), yaw0.32rad; uncertain by several meters';
 // User correction + c546: open middle through the upper deck; retain existing
 // left/right plywood sheets (and their IDs), rather than rebuilding the whole floor.
 for(const o of dorm.children.slice())if(o.userData.kind==='plywood deck sheet'&&Math.abs(o.position.y-2.46)<.01&&Math.abs(o.position.x)<BAY/2)dorm.remove(o);
 // Passage into the greenhouse behind the solar slope, with side-wall cladding.
 for(const side of [-1,1])k.wall(dorm,BAY,2.3,side*BAY,toolSouth,1.36);
 for(const side of [-1,1])k.wall(dorm,BAY,1.3,side*BAY,toolSouth,3.25,'#b39b77');
 // c46972: continuous white belt below the north clerestory, with a ground door.
 for(const side of [-1,1])k.wall(dorm,(3*BAY-1.05)/2,2.28,side*(3*BAY+1.05)/4,-toolSouth,1.35,'#b9a27e');
 k.wall(dorm,3*BAY,1.05,0,-toolSouth,3.0,'#d2d1c8');
 k.box(dorm,'north open clerestory dark interior',[3*BAY-.8,.65,.03],[.3,3.93,-toolSouth+.08],'#2b3030',layers.detail);
 k.box(dorm,'north door header',[1.05,.28,.08],[0,2.51,-toolSouth],'#ae936f',layers.wall);
 for(const side of [-1,1]){k.wall(dorm,toolDepth,2.24,side*1.5*BAY,0,1.34,'#af956f',Math.PI/2);
  k.box(dorm,'Tool Camp upper window strip',[.04,.56,3.4],[side*(1.5*BAY+.05),3.55,0],'#475258',layers.wall);
  // c543/c564 occupied-season side walls are clad above the lower floor;
  // the earlier open skeleton must not remain as the March facade. Window extent is fitted.
  k.wall(dorm,toolDepth,.78,side*1.5*BAY,0,2.88,'#ae9064',Math.PI/2);
  k.wall(dorm,toolDepth,.85,side*1.5*BAY,0,4.255,'#ad8d61',Math.PI/2);
  for(const end of [-1,1])k.wall(dorm,(toolDepth-3.4)/2,2.18,side*1.5*BAY,end*(toolDepth+3.4)/4,3.59,'#b19470',Math.PI/2);}
 k.deck(dorm,3*BAY,toolDepth,4.68,0,0,true);
 k.box(dorm,'dark tarp roof',[3*BAY,.055,toolDepth],[0,4.75,0],'#333536',layers.roof);
 // c505 resolves four horizontal courses, two banks separated by a clear access strip.
 for(let row=0;row<4;row++)for(let col=0;col<13;col++){
  const x=col<7?-4.9+col*.72:.88+(col-7)*.72,dz=(row-1.5)*1.49;
  k.solar(dorm,.71,1.44,x,2.35-dz*Math.sin(.65),toolSouth+2.3+dz*Math.cos(.65),.65);
 }

 // Interior review4: only Tool Camp canonical images, not adjacent Freeside meals.
 // c534: substantial wood benches, a left-wall machine line, and a rolling center bench.
 const toolEvidence='c534/DSCF7600 workshop; c554/DSCF7599 and c546/DSCF7622 hydroponics; user correction open center and upper side floors; dimensions/partition position fitted';
 const bench=(x:number,z:number,width:number,depth:number)=>{
  k.box(dorm,'Tool Camp workbench top',[width,.085,depth],[x,.98,z],'#d2b482',layers.detail);
  for(const sx of [-1,1])for(const sz of [-1,1])k.box(dorm,'Tool Camp timber bench leg',[.095,.685,.095],[x+sx*(width/2-.1),.595,z+sz*(depth/2-.1)],'#aa8157',layers.detail);
  k.box(dorm,'Tool Camp bench lower shelf',[width-.1,.06,depth-.08],[x,.42,z],'#ae8d63',layers.detail);
 };
 bench(-4.65,-.4,1.0,5.2);bench(-2.65,.15,1.55,2.5);bench(3.95,-.7,2.2,.75);
 // Distinct silhouettes, not a pile of anonymous cubes: photographed woodworking machines.
 const disc=(kind:string,x:number,y:number,z:number,r:number,color:string)=>{
  const m=new T.Mesh(new T.CylinderGeometry(r,r,.055,20),k.mat(color,.5));m.rotation.x=Math.PI/2;m.position.set(x,y,z);k.tag(dorm,m,kind,layers.detail);return m;
 };
 k.box(dorm,'Tool Camp miter saw base',[.72,.12,.55],[-4.65,1.08,-2.0],'#4c5557',layers.detail);
 disc('Tool Camp miter saw blade',-4.65,1.48,-2.0,.27,'#bfc5c3');
 k.rod(dorm,'Tool Camp saw pivot arm',[-4.65,1.12,-2.25],[-4.65,1.57,-2.18],.055,'#465053',layers.detail);
 k.box(dorm,'Tool Camp saw motor',[.32,.22,.27],[-4.42,1.42,-2.2],'#873e33',layers.detail);
 k.rod(dorm,'Tool Camp drill press column',[-4.65,1.06,-.75],[-4.65,1.85,-.75],.055,'#626b69',layers.detail);
 k.box(dorm,'Tool Camp drill press head',[.36,.23,.50],[-4.65,1.86,-.68],'#4c5251',layers.detail);
 k.box(dorm,'Tool Camp drill table',[.40,.045,.37],[-4.65,1.42,-.53],'#aaaca4',layers.detail);
 k.rod(dorm,'Tool Camp drill spindle',[-4.65,1.5,-.47],[-4.65,1.75,-.47],.025,'#bcbdb3',layers.detail);
 k.box(dorm,'Tool Camp belt sander',[.18,.72,.34],[-4.65,1.39,.28],'#76665f',layers.detail);
 disc('Tool Camp disc sander',-4.65,1.21,.63,.18,'#918d82');
 k.box(dorm,'Tool Camp grinder motor',[.30,.23,.24],[-4.65,1.18,1.42],'#3c4644',layers.detail);
 for(const z of [1.16,1.68])disc('Tool Camp grinder wheel',-4.65,1.2,z,.14,'#505655');
 k.box(dorm,'Tool Camp stored table saw',[.76,.49,.64],[-2.65,.69,.28],'#637375',layers.detail);
 k.box(dorm,'Tool Camp table saw top',[.89,.07,.77],[-2.65,.96,.28],'#313937',layers.detail);
 k.box(dorm,'Tool Camp handheld circular saw',[.30,.23,.30],[-2.4,1.15,.55],'#a6aa26',layers.detail);
 k.box(dorm,'Tool Camp timber tool rail',[.065,.10,1.65],[-5.28,1.93,1.15],'#9d7e54',layers.detail);
 for(let i=0;i<9;i++){
  const z=.43+i*.17;k.rod(dorm,'Tool Camp hanging hand tool',[-5.21,1.88,z],[-5.21,1.55+(i%3)*.05,z],.025,['#d4b526','#355986','#b85935'][i%3],layers.detail);
 }
 for(const x of [-4.65,-2.65,3.95])k.box(dorm,'Tool Camp loose parts box',[.42,.25,.32],[x,1.15,1.0],'#958367',layers.detail);
 k.box(dorm,'Tool Camp electronics shelf',[2.8,.07,.62],[3.85,1.35,-2.1],'#b29b76',layers.detail);
 for(let i=0;i<4;i++)k.box(dorm,'Tool Camp electronics organizer',[.43,.22,.36],[2.8+i*.55,1.495,-2.1],'#c4c7bd',layers.detail);
 // User identifies upstairs pod; c505 confirms enclosed left upper portion. Interior contents unobserved.
 for(const side of [-1,1])k.wall(dorm,.965,1.95,-BAY+side*.8925,1.0,3.5,'#c2b59c');
 k.wall(dorm,.82,.22,-BAY,1.0,4.365,'#c2b59c');
 for(const side of [-1,1])k.wall(dorm,2.4,1.95,-BAY+side*1.375,2.2,3.5,'#b2a58d',Math.PI/2);
 k.box(dorm,'Tool Camp upper pod doorway',[.82,.12,.04],[-BAY,4.25,.955],'#413e36',layers.wall);
 // c554/c546: shaded growing area on sand behind the inclined solar modules.
 // White PV backs, timber battens and a clear central strip are visible from inside.
 const greenhouseZ=toolSouth+1.28;
 for(const side of [-1,1]){
  const backing=k.box(dorm,'Tool Camp solar white backing',[4.48,.025,5.9],[side*2.95,2.31,toolSouth+2.3],'#dad9cb',layers.roof);backing.rotation.x=.65;
 }
 for(const x of [-5.35,-.3,.72,5.32])k.rod(dorm,'Tool Camp sloped solar timber support',[x,4.40,toolSouth-.05],[x,.53,toolSouth+4.67],.055,'#b99a66',layers.steel);
 const clearSlope=k.box(dorm,'Tool Camp solar clear middle strip',[1.02,.022,5.90],[.20,2.34,toolSouth+2.3],new T.MeshStandardMaterial({color:'#dbdfd4',transparent:true,opacity:.26,side:T.DoubleSide}),layers.roof);clearSlope.rotation.x=.65;
 for(let i=0;i<6;i++)k.box(dorm,'Tool Camp greenhouse timber batten',[1.10,.055,.09],[.2,4.05-i*.61,toolSouth+.07+i*.77],'#b89664',layers.steel);
 const tube=(name:string,x:number,y:number,z:number,length:number,color:string)=>k.rod(dorm,name,[x-length/2,y,z],[x+length/2,y,z],.065,color,layers.detail);
 // Left freestanding four-tier white PVC hydroponic rig.
 for(const x of [-1.50,.05])k.rod(dorm,'Tool Camp white grow rack upright',[x,0,greenhouseZ+.50],[x,1.68,greenhouseZ-.15],.027,'#d6d3bf',layers.detail);
 for(let tier=0;tier<4;tier++){
  const yy=.4+tier*.38,zz=greenhouseZ+.48-tier*.18;tube('Tool Camp white grow channel',-.72,yy,zz,1.55,'#d8d3be');
  for(let pot=0;pot<6;pot++){
   const xx=-1.36+pot*.25;const ring=new T.Mesh(new T.TorusGeometry(.045,.011,5,10),k.mat('#7b7560'));ring.rotation.x=Math.PI/2;ring.position.set(xx,yy+.065,zz);k.tag(dorm,ring,'Tool Camp grow net pot',layers.detail);
   if((pot+tier)%3!==0){k.rod(dorm,'Tool Camp seedling stem',[xx,yy+.07,zz],[xx,yy+.25,zz],.007,'#668644',layers.detail);const leaf=k.box(dorm,'Tool Camp seedling leaf',[.13,.014,.06],[xx+.035,yy+.2,zz],'#73964c',layers.detail);leaf.rotation.z=.4;}
  }
 }
 // Right wire rack, three paired dark-blue channels, reservoir below, grow lights above.
 for(const x of [1.0,2.9])for(const z of [greenhouseZ-.18,greenhouseZ+.55])k.rod(dorm,'Tool Camp wire grow rack upright',[x,0,z],[x,2.1,z],.018,'#a5aaa5',layers.detail);
 for(let tier=0;tier<3;tier++){
  const yy=.55+tier*.55;for(const zz of [greenhouseZ,greenhouseZ+.35])tube('Tool Camp blue grow channel',1.95,yy,zz,1.8,'#274f65');
  for(let i=0;i<7;i++)k.rod(dorm,'Tool Camp wire grow shelf',[1.0,yy-.1,greenhouseZ-.18+i*.12],[2.9,yy-.1,greenhouseZ-.18+i*.12],.009,'#a4aaa5',layers.detail);
  for(const xx of [1.45,2.45]){k.box(dorm,'Tool Camp grow light bar',[.47,.04,.06],[xx,yy+.36,greenhouseZ+.15],'#dbdccc',layers.detail);k.box(dorm,'Tool Camp grow light crossbar',[.06,.04,.42],[xx,yy+.36,greenhouseZ+.15],'#dbdccc',layers.detail);}
 }
 for(let pot=0;pot<6;pot++){
  const xx=1.2+pot*.29;k.rod(dorm,'Tool Camp blue rack plant stem',[xx,1.71,greenhouseZ],[xx,2.16,greenhouseZ],.008,'#658547',layers.detail);
  for(const side of [-1,1]){const leaf=k.box(dorm,'Tool Camp blue rack plant leaf',[.20,.015,.08],[xx+side*.07,1.95+side*.09,greenhouseZ],'#6d9248',layers.detail);leaf.rotation.z=side*.45;}
 }
 for(const [x,w] of [[-.65,1.1],[1.95,1.8]])k.box(dorm,'Tool Camp nutrient reservoir',[w,.38,.75],[x,.19,greenhouseZ+.2],'#323b39',layers.detail);
 // c46549: mixed equipment behind/beside the blue bus; positions within work yard estimated.
 for(let i=0;i<3;i++)k.box(dorm,'Tool Camp yard equipment tote',[.70,.42,.48],[-8.7+i*.75,.21,-1.4],'#3b4141',layers.context);
 k.box(dorm,'Tool Camp yard timber stack',[.65,.22,2.8],[-8.0,.11,-2.5],'#a58a63',layers.context);
 for(const x of [-9.0,-7.8])for(const z of [-4.1,-3.3])k.rod(dorm,'Tool Camp yard equipment rack',[x,0,z],[x,1.55,z],.025,'#a0a79f',layers.context);
 for(const y of [.15,.75,1.5])k.box(dorm,'Tool Camp yard equipment shelf',[1.25,.04,.85],[-8.4,y,-3.7],'#a8ada5',layers.context);
 dorm.traverse(o=>{if(o.userData.kind?.startsWith('Tool Camp'))o.userData.source=toolEvidence;});
 // Individually resolved Jan23 c509 panorama vehicles, recorded in
 // year-2025/review2/vehicle-census.json. Coordinates are a bearing/scale fit;
 // the count is source-derived and does not imply every later-season vehicle.
 const rv:[number,number,number,number][]=[
  [-35.8,23.1,-.5,8],[-35.4,14.0,-.5,8],[-32.6,4.4,-.5,8],[-27.8,-4.2,-.5,8],
  [-4,-14,0,7.5],[5,-13,0,7.6],[15,-18,Math.PI/2,7.0],
  [11,-35,0,4.8],[16,-39,0,6.0],
 ];
 rv.forEach(([x,z,angle,length],i)=>{const t=k.rv(`rv-${i+1}`,x,z,angle,length);t.userData.source=`c509 Jan23 individually resolved camping unit ${i+1}; last two distant class uncertain; position fit`});
 const vehicleTire2025=new T.CylinderGeometry(.36,.36,.17,10,1,false,Math.PI/10);vehicleTire2025.translate(-.20,0,0); // old wheel ids retained; seat tire bottoms at ground−.16
 const vehicle=(id:string,name:string,x:number,z:number,angle:number,length:number,color:string,bus=false)=>{
  const v=k.assembly(id,name,[x,0,z],angle);v.userData.source='c509 Jan23 four panorama sectors; discrete observed vehicle, fitted position';
  const width=bus?2.45:1.9,van=/van/.test(name),pickup=/pickup/.test(name),top=bus?2.55:van?2.10:1.55,hood=bus?1.55:van?1.25:.90;
  const body=k.box(v,'vehicle body',[width,bus?2.3:1.3,length],[0,bus?1.4:.9,0],color,layers.context);
  const profile:[number,number][]=[[-length/2,.25],[-length/2,pickup?.88:top-.23],[-length*.36,pickup?.88:top],[-length*.20,top],[length*.16,top],[length*.33,hood],[length/2,hood-.10],[length/2,.25]];
  const outline=new T.Shape();profile.forEach(([z,y],i)=>i?outline.lineTo(-z,y-body.position.y):outline.moveTo(-z,y-body.position.y));outline.closePath();
  body.geometry=new T.ExtrudeGeometry(outline,{depth:width,bevelEnabled:false});body.geometry.rotateY(Math.PI/2);body.geometry.translate(-width/2,0,0);
  const windshield=k.box(v,'vehicle windshield',[bus?2.15:1.65,.6,.05],[0,bus?1.8:1.25,length/2+.03],'#3c4e59',layers.context);
  windshield.geometry=windshield.geometry.clone();windshield.geometry.rotateX(-.65);windshield.geometry.translate(0,bus?.25:van?.32:-.015,-length*.255);
  for(const side of [-1,1])for(const zz of [-length*.3,length*.3]){const wheel=new T.Mesh(vehicleTire2025,k.mat('#272827'));wheel.rotation.z=Math.PI/2;wheel.position.set(side*(bus?1.24:.97),.4,zz);k.tag(v,wheel,'vehicle wheel',layers.context);}
  for(const side of [-1,1]){
   k.box(v,'vehicle side glazing',[.025,bus?.63:.45,length*(bus?.58:pickup?.33:.43)],[side*(width/2+.014),bus?2.06:van?1.68:1.25,pickup?0:-length*.10],'#3c4e59',layers.context);
   k.box(v,'vehicle headlamp',[.29,.16,.04],[side*width*.33,bus?1.03:.68,length/2+.025],'#e6e1c4',layers.context);
  }
  k.box(v,'vehicle front bumper',[width+.06,.15,.13],[0,.44,length/2+.025],'#555c5d',layers.context);
  if(pickup)k.box(v,'pickup open bed interior',[width-.17,.025,length*.29],[0,.90,-length*.345],'#494e4b',layers.context);
  v.userData.source+='; low-poly vehicle class, hood/glazing and trim proportions approximate; no inferred manufacturer';
  return v;
 };
 vehicle('rv-10','Solar Sam bus west of Tool Camp',2.6,40.6,.32,7.6,'#286b9a',true);
 vehicle('observed-black-bus','Dark bus northwest of Chiba',-12,-17,Math.PI/2,7,'#343331',true);
 const small:[number,number,number,string,string][]=[
  [-4,-7,Math.PI/2,'white row-end panel van','#deddd8'],[-44,-5,0,'dark west-row car','#373b39'],
  [-14,-23,Math.PI/2,'light car behind dark bus','#adb7b2'],[6,-48,Math.PI/2,'distant light utility vehicle','#c4c9c0'],[12,-47,Math.PI/2,'distant dark vehicle','#303c41'],
  [18,-32,Math.PI/2,'pickup near distant campers','#65716d'],[18,1,0,'east grey sedan','#67645f'],[22,2,0,'east white pickup','#e1e2db'],
  [21,11,Math.PI/2,'white van behind Bodywork','#d8dfdc'],[29,6,Math.PI/2,'dark east car','#333d3b'],
 ];
 small.forEach(([x,z,angle,name,color],i)=>vehicle(`observed-car-${i+1}`,name,x,z,angle,i===0||i===8?5.4:4.6,color));
 add2025Reconciliation(k,g,free,body,dorm);
}

// 2020 comes from studio-2020/scene; ids use the same stable scheme as Kit (HISTORY_IDS.md).
function tag2020(root:T.Group){root.updateMatrixWorld(true);const entries:IdEntry[]=[];root.children.forEach((g,i)=>{const id=g.userData.id==='portal'?'chiba':String(g.userData.id||`site-${i}`);g.userData.assembly_id=id;g.traverse(o=>{if(o===g)return;if(o instanceof T.Mesh){const name=o.name.toLowerCase();o.userData={...o.userData,assembly_id:id,kind:name||'component',definition_id:name||'component',layer:/beam|upright|brac/.test(name)?layers.steel:/roof|ceiling/.test(name)?layers.roof:/wall|scrim|curtain|climbing sheet/.test(name)?layers.wall:/floor|deck|stair/.test(name)?layers.floor:layers.detail};entries.push({o,assembly:g,assemblyId:id,kind:name||'component'});if(/scrub/.test(name))o.userData.kind='site_context';}});});assignStableIds(entries);}
/** `hooks` exist for id-stability tests (deploy/history-ids.test.mjs); the app passes none. */
export function createHistoricalScene(year:number,hooks:KitHooks={}){
 if(year===2020){const {root}=createBrahman2020Scene();tag2020(root);const k=new Kit(year,hooks);k.visitors(7);root.add(...k.root.children);return root;}
 const k=new Kit(year,hooks);({2021:make2021,2022:make2022,2023:make2023,2024:make2024,2025:make2025} as Record<number,(k:Kit)=>void>)[year](k);k.visitors(year===2021?12:year===2022?16:22);return k.finalize();
}
export function sceneManifest(root:T.Group,year:number){const instances:{id:string;assembly_id:string;layer:string;kind:string;definition_id:string}[]=[],assemblies:{id:string;name:string}[]=[],defs=new Set<string>();root.traverse(o=>{const u=o.userData;if(u.assembly_id&&!u.component_id&&!u.layer&&!assemblies.some(a=>a.id===u.assembly_id))assemblies.push({id:u.assembly_id,name:o.name.replaceAll('_',' ')});if(u.component_id){instances.push({id:u.component_id,assembly_id:u.assembly_id,layer:u.layer||layers.detail,kind:u.kind||'component',definition_id:u.definition_id||'component'});defs.add(u.definition_id||'component');}});return {instances,assemblies,definitions:[...defs],limitations:[historyNotes[year],'Rack bays set to nominal 12 ft. Photographic placement is approximate; this is not a measured inventory or survey.','Visitors and EUC riders are illustrative.']};}
