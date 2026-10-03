import * as T from 'three';
import {Kit,BAY,layers} from './kit';
export function hall(k:Kit,id:string,name:string,x:number,z:number,nx:number,nz:number,h=4.8768,openAisle=false,depth=nz*BAY){const g=k.assembly(id,name,[x,0,z]);k.frame(g,nx,nz,h,true,depth);k.deck(g,nx*BAY,depth,.22);
 if(openAisle){const sideWidth=(nx*BAY-BAY)/2;for(const side of [-1,1])k.deck(g,sideWidth,depth,2.46,side*(BAY+sideWidth)/2,0,true);}
 else k.deck(g,nx*BAY,depth,2.46,0,0,true);return g;}
export function auditorium(k:Kit,g:T.Group,d:number){
 // Tall central projection bay and broad tiered timber seating visible in talk photos.
 k.screen(g,0,2.55,d/2-.1,3.25,Math.PI,4.15);
 k.stairs(g,BAY-.25,5.5,2.2,0,-d/2+2.75,7);
 k.table(g,0,d/2-1.2,1.5,.65,.74);
 for(const side of [-1,1]){k.wall(g,2.3,1.0,side*3.1,-1,1.15,'#b79571');k.table(g,side*3.1,0,2.2,.75,.8);k.screen(g,side*3.1,1.35,-.36,.7);}
}

export function roofRails(k:Kit,g:T.Group,w:number,d:number,y:number){for(const z of [-d/2,d/2])k.rod(g,'timber roof railing',[-w/2,y+.95,z],[w/2,y+.95,z],.04,'#ae9165',layers.roof);for(let x=-w/2;x<=w/2+.01;x+=BAY)for(const z of [-d/2,d/2])k.rod(g,'roof rail post',[x,y,z],[x,y+1,z],.035,'#ae9165',layers.roof);}
/** Trailer ring on an ellipse (angle 0 = +Z end, left open by `gap` for the kitchen). `keepOut` (2023/24, Q2 answered
 *  by Gene 2026-09-29: "no trailers under Chiba … side trailers must not touch the walls"): a building's world box
 *  [x0, z0, x1, z1] the ring must stay `clear` metres off. The ring then also leaves open the sector of the ellipse
 *  round the box (the smallest symmetric sector about angle π, where the ellipse meets it, whose edge trailer clears
 *  the box by `clear`), and its trailers spread evenly over the two remaining arcs; ids, headings and lengths follow
 *  the index as before. */
export function ring(k:Kit,count:number,rx:number,rz:number,cz:number,gap=.38,keepOut?:{box:[number,number,number,number];clear:number}){
 const place=(i:number,a:number)=>({x:Math.sin(a)*rx,z:cz+Math.cos(a)*rz,angle:-a+.12*Math.sin(i),length:5.8+(i%4)*.65});
 let e=0;
 if(keepOut){const fits=(i:number,a:number)=>trailerClearance(place(i,a),keepOut.box)>=keepOut.clear;
  // widen the sector (0.005 rad steps) until a trailer of any index (heading / length) on either edge clears the box
  while(e<Math.PI-gap&&![...Array(count).keys()].every(i=>fits(i,Math.PI-e)&&fits(i,Math.PI+e)))e+=.005;}
 const span=Math.PI*2-2*gap-2*e,arc=span/2;
 for(let i=0;i<count;i++){const s=(i/(count-1))*span,a=gap+(s<=arc?s:s+2*e);const t=place(i,a);k.rv(`rv-${i+1}`,t.x,t.z,t.angle,t.length);}
}
export function ringAvoiding(k:Kit,count:number,rx:number,rz:number,cz:number,boxes:[number,number,number,number][]){
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
export function kitchenBuilding(k:Kit,x:number,z:number,year:number,entityId?:string,bays=3){
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
export function classroom(k:Kit,g:T.Group,w:number,d:number){
 k.wall(g,w,2.3,0,-d/2,1.38,'#d0ccc0');k.screen(g,0,1.62,-d/2+.08,1.8);
 for(let z=-d/2+1.7;z<d/2-1;z+=2){k.table(g,-w/4,z,2,.7);k.table(g,w/4,z,2,.7);for(const x of [-w/4,w/4]){k.box(g,'classroom bench',[1.8,.075,.35],[x,.48,z+.75],'#aa8b63');for(const dx of [-.7,.7]){const floor=k.seat?k.surface(g,Kit.footprint(x+dx,z+.75,.065,.25),.4425):0,[h,cy]=k.seat?[.4425-floor,(.4425+floor)/2]:[.4,.25];k.box(g,'bench foot',[.065,h,.25],[x+dx,cy,z+.75],'#685744');}}} // feet: floor to seat underside (held years: as before W46)
}
