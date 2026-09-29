import * as T from 'three';
import {Kit,layers} from './kit';

/** February 16 flythrough: woven silver shade, suspended above an unfloored aisle. */
export function aluminet2021(k:Kit,g:T.Group,width:number,length:number){
 const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;
 const ctx=canvas.getContext('2d')!;ctx.fillStyle='#111';ctx.fillRect(0,0,32,32);ctx.fillStyle='#eee';
 for(let i=0;i<32;i+=8){ctx.fillRect(i,0,3,32);ctx.fillRect(0,i,32,2);}
 const weave=new T.CanvasTexture(canvas);weave.wrapS=weave.wrapT=T.RepeatWrapping;weave.repeat.set(width*9,length*9);
 const geo=new T.PlaneGeometry(width,length,24,96);geo.rotateX(-Math.PI/2);
 const p=geo.getAttribute('position');
 for(let i=0;i<p.count;i++){
  const x=p.getX(i),z=p.getZ(i),crossSag=1-Math.pow(2*x/width,2);
  p.setY(i,4.25-crossSag*(.55+.16*Math.pow(Math.sin(z*Math.PI/3.65),2)));
 }
 geo.computeVertexNormals();
 const mesh=new T.Mesh(geo,new T.MeshStandardMaterial({color:'#b8bebc',metalness:.38,roughness:.75,alphaMap:weave,alphaTest:.4,side:T.DoubleSide}));
 mesh.castShadow=true;mesh.receiveShadow=true;k.named(k.tag(g,mesh,'draped silver aluminet',layers.roof),'aluminet');mesh.userData.walkNoCollision=true;
 for(let z=-length/2;z<=length/2+.01;z+=length/6){
  for(const side of [-1,1])k.rod(g,'aluminet tie',[side*width/2,4.25,z],[side*(width/2+.3),4.65,z],.012,'#a1a39d',layers.roof);
 }
}

/** Provenance note carried by every piece of the 2026-09-29 reconstruction edit (Kit `source`). */
export const CHIBA_2024_EDIT='photo 2024 front / interior, 2026-09-29 (reconstruction-edit; provisional photographic fit)';

/**
 * Plexiglass: clear, slightly blue-grey acrylic sheet (renderer-side material only; the engine
 * classifies any kind matching /plexi/ as `glass`: collides, does not occlude the camera).
 */
export function plexiglass(){
 const m=new T.MeshStandardMaterial({color:'#eef4f5',transparent:true,opacity:.3,metalness:.15,roughness:.06,side:T.DoubleSide,depthWrite:false});
 m.name='plexiglass';return m;
}

/**
 * Chiba 2024 front, re-fitted 2026-09-29 to Gene's photos (docs/engineering/evidence/
 * 2024-chiba-facade-front-vertical-inset-stairs-plexiglass.webp, 2024-chiba-solarium-interior-plexiglass-roof.jpg;
 * measurements in docs/engineering/CAMPUS_SCENE.md "Chiba 2024 front"):
 * a VERTICAL inset (2.5 bays) at the frame front holds the sliding double door, the landing and two
 * straight flights; the left (solar) and right (plexiglass solarium) flaps lean back from bottoms
 * 2.65 m proud of the inset to the roof edge; triangular cheeks close the flaps against the inset;
 * the solarium's end is a plexiglass wall with a door (modelled open, the first door object).
 * The lean group `front` keeps its old transform, so untouched pieces on it (PV, the left clear
 * strip) keep their stable ids (HISTORY_IDS.md).
 */
export function frontage2024(k:Kit,g:T.Group,w:number,d:number){
 const rise=4.64,run=2.65,slant=Math.hypot(rise,run),front=new T.Group(),d2=d/2,iw=4.572; // inset half-width: 2.5 bays
 front.userData={...g.userData,layer:layers.wall};front.position.set(0,.22,d2+run);front.rotation.x=-Math.atan2(run,rise);g.add(front);
 const red=k.photo('/history/2024/red-wall.webp'),orange=k.photo('/history/2024/orange-wall.webp'),plexi=plexiglass(),pine='#c9a36b';
 const ev=<O extends T.Object3D>(o:O):O=>{o.userData.source=CHIBA_2024_EDIT;return o;};
 // --- flaps (lean group): left solar flap + its upper step under the two broad PV rows; right glazed flap below.
 ev(k.box(front,'left flap',[w/2-iw,slant,.06],[-(w/2+iw)/2,slant/2,0],red,layers.wall));
 ev(k.box(front,'left flap upper step',[.97,slant-2.8,.06],[-iw+.485,2.8+(slant-2.8)/2,0],red,layers.wall));
 // Photographic array silhouette: two broad upper rows, narrower lower rows,
 // a clear strip, and exposed red base. No PV on the right-hand wing. (unchanged pieces)
 const canvas=document.createElement('canvas');canvas.width=128;canvas.height=64;
 const ctx=canvas.getContext('2d')!;ctx.fillStyle='#20384b';ctx.fillRect(0,0,128,64);ctx.strokeStyle='#69808e';ctx.lineWidth=.8;
 for(let x=0;x<=128;x+=128/12){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,64);ctx.stroke();}
 for(let y=0;y<=64;y+=64/6){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(128,y);ctx.stroke();}
 const cells=new T.CanvasTexture(canvas);cells.colorSpace=T.SRGBColorSpace;cells.anisotropy=4;
 const pv=new T.MeshStandardMaterial({map:cells,metalness:.25,roughness:.4});
 const panel=(x:number,y:number,pw:number,ph:number)=>{
  k.box(front,'solar panel',[pw,ph,.07],[x,y,.1],k.mat('#bcc1bf',.55),layers.roof);
  k.box(front,'photovoltaic cells',[pw-.06,ph-.06,.008],[x,y,.14],pv,layers.roof);
 };
 const left=-w/2;
 for(const y of [slant-1.0,slant-2.03])for(let c=0;c<4;c++)panel(left+.91+c*1.84,y,1.81,.98);
 for(const y of [slant-3.06,.90])for(let c=0;c<2;c++)panel(left+.91+c*1.84,y,1.81,.93);
 // The left flap's clear strip (unchanged piece set).
 const glass=new T.MeshStandardMaterial({color:'#97aaa7',transparent:true,opacity:.33,metalness:.2,roughness:.35,side:T.DoubleSide,depthWrite:false});
 const x0=left+1.8,y0=1.68,ww=3.55,hh=.49;
 k.box(front,'salvaged window backing',[ww,hh,.02],[x0,y0,.075],'#414d49',layers.wall);
 k.box(front,'salvaged glazing',[ww-.06,hh-.06,.018],[x0,y0,.12],glass,layers.wall);
 for(const side of [-1,1]){k.box(front,'window frame',[.045,hh,.065],[x0+side*ww/2,y0,.14],'#c8c2a8',layers.wall);k.box(front,'window frame',[ww,.045,.065],[x0,y0+side*hh/2,.14],'#c8c2a8',layers.wall);}
 // Right flap = the solarium roof: red base, four rows of clear panes on a 2x4 lattice (stepped left
 // edge as photographed), the painted eye pane, red fill where the rows step in. s = slant metres from the bottom.
 const R0=iw,R1=w/2,edge=10.87,wood=(name:string,sz:[number,number,number],p:[number,number,number])=>ev(k.box(front,name,sz,[p[0],p[1],-.05],pine,layers.wall));
 const fill=(x0:number,x1:number,s0:number,s1:number)=>ev(k.box(front,'right flap',[x1-x0,s1-s0,.06],[(x0+x1)/2,(s0+s1)/2,0],red,layers.wall));
 const pane=(x0:number,x1:number,s0:number,s1:number)=>{
  ev(k.box(front,'plexiglass pane',[x1-x0-.03,s1-s0-.03,.006],[(x0+x1)/2,(s0+s1)/2,.012],plexi,layers.wall));
  wood('2x4 lattice mullion',[.038,s1-s0,.089],[x0,(s0+s1)/2,0]);
 };
 fill(R0,R1,0,1.65); // painted base
 fill(R0,R1,5.25,slant); // top edge strip
 fill(edge,R1,1.65,5.25); // outer edge
 // row C (s 1.65–3.2): one tall pane at the left, then 4 × 2 panes
 fill(R0,4.72,1.65,3.2);pane(4.72,6.5,1.65,3.2);
 for(const [s0,s1] of [[1.65,2.42],[2.42,3.2]])for(let c=0;c<4;c++)pane(6.5+c*(edge-6.5)/4,6.5+(c+1)*(edge-6.5)/4,s0,s1);
 // row B (s 3.2–4.3): steps in to 5.4; the eye pane is painted (opaque)
 fill(R0,5.4,3.2,4.3);
 for(const [a,b] of [[5.4,6.4],[6.4,7.3],[8.35,9.2],[9.2,10.05],[10.05,edge]])pane(a,b,3.2,4.3);
 ev(k.box(front,'painted eye window insert',[1.05,1.06,.03],[7.825,3.75,.03],k.photo('/history/2024/eye.webp'),layers.wall));
 wood('2x4 lattice mullion',[.038,1.1,.089],[7.3,3.75,0]);
 // row A (s 4.3–5.25): steps in to 6.3
 fill(R0,6.3,4.3,5.25);pane(6.3,7.6,4.3,5.25);
 for(let c=0;c<5;c++)pane(7.6+c*(edge-7.6)/5,7.6+(c+1)*(edge-7.6)/5,4.3,5.25);
 // lattice rails (along x) at the row boundaries, only across the glazed extent; closing mullion at the edge
 for(const [s,a] of [[1.65,4.72],[2.42,6.5],[3.2,4.72],[4.3,5.4],[5.25,6.3]] as const)wood('2x4 lattice rail',[edge-a,.038,.089],[(a+edge)/2,s,0]);
 wood('2x4 lattice mullion',[.038,5.25-1.65,.089],[edge,(1.65+5.25)/2,0]);
 // --- vertical inset at the frame front: wall with the doorway, murals on its upper band.
 const zI=d2+.045,DOOR=1.33;
 ev(k.box(g,'inset wall',[iw-DOOR,rise,.03],[-(iw+DOOR)/2,.22+rise/2,zI],red,layers.wall));
 ev(k.box(g,'inset wall',[iw-DOOR,rise,.03],[(iw+DOOR)/2,.22+rise/2,zI],red,layers.wall));
 ev(k.box(g,'inset wall',[2*DOOR,4.86-2.3,.03],[0,(2.3+4.86)/2,zI],red,layers.wall));
 k.named(ev(k.box(g,'central flower mural',[3.25,2.0,.06],[0,3.85,zI+.05],k.photo('/history/2024/flower.webp'),layers.wall)),'flower-mural');
 for(const side of [-1,1])ev(k.box(g,'upper orange mural',[2.95,1.9,.025],[side*3.08,3.9,zI+.035],orange,layers.wall));
 // Triangular cheeks close each flap against the inset (seen on the right flap's inner edge).
 const tri=(pts:[number,number][])=>{const sh=new T.Shape();pts.forEach(([u,v],i)=>i?sh.lineTo(u,v):sh.moveTo(u,v));return new T.ShapeGeometry(sh);};
 const yFlap=(dz:number)=>.22+(run-dz)*(rise/run); // flap underside height at dz in front of the frame
 const sidePiece=(geo:T.BufferGeometry,x:number,name:string,mat:T.Material,layer:string)=>{
  const m=new T.Mesh(geo,mat);m.position.set(x,0,d2);m.rotation.y=-Math.PI/2;m.castShadow=m.receiveShadow=true; // shape u → +z, v → y
  return ev(k.tag(g,m,name,layer));
 };
 for(const side of [-1,1])sidePiece(tri([[0,.22],[run,.22],[0,.22+rise]]),side*iw,'flap cheek',red,layers.wall);
 // Sliding double door under the landing: the yellow leaf (existing piece) and its orange-red partner.
 k.wall(g,.75,2.05,-.96,d2+.10,1.27,'#d09c42');
 ev(k.wall(g,.75,2.05,.96,d2+.10,1.27,'#c4502e'));
 ev(k.box(g,'sliding door track',[2.9,.05,.05],[0,2.33,d2+.13],'#3a3a36',layers.wall));
 // Landing (top 2.49, the upper-floor level) on two front posts; its fascia carries the Chiba sign.
 const LW=3.46,LD=1.45;
 for(const o of (()=>{const before=g.children.length;k.deck(g,LW,LD,2.46,0,d2+.06+LD/2);return g.children.slice(before);})())ev(o);
 for(const side of [-1,1]){
  ev(k.box(g,'landing post',[.09,2.43,.09],[side*(LW/2-.05),1.215,d2+.06+LD-.05],'#a93829',layers.floor));
  ev(k.rod(g,'landing rail post',[side*(LW/2-.05),2.49,d2+.06+LD-.05],[side*(LW/2-.05),3.45,d2+.06+LD-.05],.03,'#a93829',layers.floor));
 }
 ev(k.rod(g,'landing rail',[-LW/2+.05,3.45,d2+.06+LD-.05],[LW/2-.05,3.45,d2+.06+LD-.05],.035,'#a93829',layers.floor));
 k.named(ev(k.box(g,'Chiba entry sign',[2.8,.6,.06],[0,2.2,d2+.06+LD+.04],k.photo('/history/2024/entry.webp'),layers.wall)),'entry-sign');
 // Two straight flights (no lean): from the ground at the inset's outer ends up to the landing, against the wall.
 for(const side of [-1,1]){
  const stair=new T.Group();stair.userData={...g.userData,layer:layers.floor};stair.position.set(side*(LW/2+1.3),0,d2+.08+.6);stair.rotation.y=side*Math.PI/2;g.add(stair);
  k.stairs(stair,1.2,2.6,2.08,0,0,12);
  stair.traverse(o=>{if(o instanceof T.Mesh){o.material=k.mat('#a93829');ev(o);}});
 }
 // --- the solarium's end: a plexiglass wall on 2x4 studs with a door, at x = +w/2 under the right flap.
 const xS=w/2+.045,J0=.126,J1=1.374,HEAD=2.224;
 sidePiece(tri([[.05,HEAD+.076],[J1+.019,HEAD+.076],[J1+.019,yFlap(J1+.019)],[.05,yFlap(.05)]]),xS,'plexiglass side wall',plexi,layers.wall);
 sidePiece(tri([[J1+.019,.22],[run,.22],[J1+.019,yFlap(J1+.019)]]),xS,'plexiglass side wall',plexi,layers.wall);
 const stud=(name:string,z0:number,z1:number,y0:number,y1:number)=>ev(k.box(g,name,[.089,y1-y0,z1-z0],[xS,(y0+y1)/2,d2+(z0+z1)/2],pine,layers.wall));
 stud('solarium door jamb',J0-.019,J0+.019,.22,HEAD);stud('solarium door jamb',J1-.019,J1+.019,.22,HEAD);
 stud('solarium door header',J0-.019,J1+.019,HEAD,HEAD+.076);
 // 2x4 grid of the end wall (interior photo: studs ~0.4 m, rails ~0.8 m), never inside the doorway
 for(const z of [1.8,2.2])stud('2x4 stud',z-.019,z+.019,.22,yFlap(z));
 for(const z of [.45,.8,1.1])stud('2x4 stud',z-.019,z+.019,HEAD+.076,yFlap(z));
 const zAt=(y:number)=>run-(y-.22)*run/rise; // where the flap meets height y
 for(const y of [1.0,1.8])stud('2x4 rail',J1+.019,zAt(y),y-.019,y+.019);
 for(const y of [3.1,3.9])stud('2x4 rail',.05,zAt(y),y-.019,y+.019);
 // The door leaf: plexiglass in a 2x4 frame, standing OPEN 90° outward on its hinge jamb, so the opening
 // (1.21 m × 2.0 m) is a real gap for walkers and the camera navmesh. Tagged: pinned id `chiba-solarium-door`,
 // Kit kind 'plexiglass door' (→ engine kind glass), userData.door = the opening it serves.
 const LEAF=J1-J0-.04,lx=xS+.05+LEAF/2,lz=d2+J0;
 const leaf=k.named(ev(k.box(g,'plexiglass door',[LEAF-.07,HEAD-.22-.08,.012],[lx,(.22+HEAD)/2,lz],plexi,layers.wall)),'solarium-door');
 leaf.userData.door={state:'open',swing:'out-90',hinge:[xS,lz],opening:{x:xS,z:[d2+J0+.019,d2+J1-.019],y:[.22,HEAD]},evidence:CHIBA_2024_EDIT};
 for(const s of [-1,1]){
  ev(k.box(g,'door leaf stile',[.038,HEAD-.22-.01,.045],[lx+s*(LEAF/2-.019),(.22+HEAD)/2,lz],pine,layers.wall));
  ev(k.box(g,'door leaf rail',[LEAF,.038,.045],[lx,(.22+HEAD)/2+s*((HEAD-.22)/2-.03),lz],pine,layers.wall));
 }
}

// ---- Mars 2022 reconciliation (Gene's questionnaire, 2026-09-29 evening; RECONCILIATION_2022.md; W51) ----------------
const EV_STAIR='RECONCILIATION_2022 §b (Gene: stairs PARALLEL to the building; aerial-03 + DJI_0829 end slots ≈ 3.5 × 4.5–5 m; foot on the courtyard side = Q29 default); provisional';
const EV_SOLAR='RECONCILIATION_2022 §d (Gene: south-facing rows on triangular wood frames ≈ 45°, low edge on the south roof edge; rows per aerial-03 = Q28 default); provisional';
/** Deck tops of a 2022 rack house (Kit decks: 0.065 m sheets centred at 2.46 / 4.86). */
export const DECK1_TOP_2022=2.46+.0325,ROOF_TOP_2022=4.86+.0325;
/**
 * The end-slot stair of a 2022 rack house, in the house group's frame (house along x, courtyard on +z, the slot
 * centred on `x`). Treads run PARALLEL to the house (their long side along x, one bay less 12 cm wide) and the flight
 * climbs across the depth, from its foot on the sand at the courtyard face (z = +d/2) toward the outer side, to a
 * landing at first-floor deck height over the outer frame bay. The landing reaches past the outer frame into the aisle
 * between the outer and middle end frames, which is where one steps through the end-frame line onto the deck.
 * 13 risers of top/13 (≈ 0.192 m) from y = 0, 12 goings of 0.25 m (≈ 37.5°); risers are walk-through (as Kit.stairs).
 */
export function stair2022(k:Kit,g:T.Group,x:number,d:number,width:number,top=DECK1_TOP_2022){
 const s=new T.Group();s.userData={...g.userData,layer:layers.floor,source:EV_STAIR};s.position.x=x;g.add(s);
 const n=13,r=top/n,go=.25,z0=d/2-.06,zTop=z0-(n-1)*go,zOut=-d/2+.06,w=width,wood='#b89a75',dark='#937654',rail='#a48661';
 for(let i=1;i<n;i++){
  k.box(s,'stair tread',[w,.06,go-.009],[0,i*r-.03,z0-(i-.5)*go],wood,layers.floor);
  const rr=k.box(s,'stair riser',[w,r,.035],[0,(i-.5)*r,z0-(i-1)*go-.0175],dark,layers.floor);rr.userData.walkNoCollision=true;
 }
 const last=k.box(s,'stair riser',[w,r,.035],[0,(n-.5)*r,zTop-.0175],dark,layers.floor);last.userData.walkNoCollision=true;
 k.box(s,'stair landing',[w,.065,zTop-zOut],[0,top-.0325,(zTop+zOut)/2],'#bfa17b',layers.floor);
 // three stringers under the treads, foot on the sand, head under the landing's front edge
 const run=z0-zTop,len=Math.hypot(run,top),tilt=Math.atan2(top,run);
 for(const sx of [-w/2+.06,0,w/2-.06]){const m=k.box(s,'stair stringer',[.045,.286,len],[sx,top/2-.13,(z0+zTop)/2],dark,layers.floor);m.rotation.x=tilt;}
 // landing posts to the sand at its outer corners and under its front edge
 for(const sx of [-w/2+.06,w/2-.06])for(const z of [zOut+.05,zTop-.05])k.rod(s,'stair landing post',[sx,0,z],[sx,top-.065,z],.045,dark,layers.floor);
 // handrail on the open (outer) side of the flight and round the landing's two open edges
 const rx=w/2;k.rod(s,'stair rail',[rx,1.0,z0],[rx,top+1.0,zTop],.035,rail,layers.floor);
 for(let i=0;i<=3;i++){const z=z0-i*run/3,y=i*top/3;k.rod(s,'stair rail post',[rx,y,z],[rx,y+1.0,z],.03,rail,layers.floor);}
 k.rod(s,'stair rail',[rx,top+1.0,zTop],[rx,top+1.0,zOut],.035,rail,layers.floor);
 k.rod(s,'stair rail',[rx,top+1.0,zOut],[-rx,top+1.0,zOut],.035,rail,layers.floor);
 for(const [px,pz] of [[rx,zOut],[-rx,zOut],[0,zOut]] as [number,number][])k.rod(s,'stair rail post',[px,top,pz],[px,top+1.0,pz],.03,rail,layers.floor);
 return s;
}
/**
 * A row of solar modules on triangular 2x4 frames on a flat roof (group frame): `along` is the row axis, `face` the
 * horizontal direction the modules face (south; perpendicular to `along`), `low` a point on the row's low edge at its
 * middle (on the roof top, y = `roof`). Each module (1.65 m up the slope, `width` along the row) is tilted 45°: its
 * low edge on the low-edge line, its high edge 1.17 m further north and 1.17 m up. One triangle frame per module edge
 * (n + 1): a base on the deck, a vertical back prop on the north side and the 45° rafter under the modules.
 */
export function solarRow2022(k:Kit,g:T.Object3D,along:[number,number],face:[number,number],low:[number,number],roof:number,count:number,width=1.05){
 const L=1.65,c=Math.SQRT1_2,p=L*c,rise=L*c,a=new T.Vector3(along[0],0,along[1]).normalize(),f=new T.Vector3(face[0],0,face[1]).normalize();
 const up=new T.Vector3(0,1,0),slope=f.clone().multiplyScalar(-c).addScaledVector(up,c); // up the module, toward the back
 const X=a.clone(),Y=new T.Vector3().crossVectors(slope,X);if(Y.y<0){X.negate();Y.negate();}
 const q=new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(X,Y,slope)),frame='#a8844f';
 const P=(t:number,back:number,y:number):[number,number,number]=>[low[0]+a.x*t-f.x*back,y,low[1]+a.z*t-f.z*back];
 const W=count*width,y0=roof+.045; // frame members 2x4 on edge: the rafter's top carries the module
 for(let j=0;j<=count;j++){
  const t=-W/2+j*width;
  const tag=(o:T.Object3D)=>{o.userData.source=EV_SOLAR;return o;};
  tag(k.rod(g,'solar frame base',P(t,0,roof+.02),P(t,p,roof+.02),.02,frame,layers.roof));
  tag(k.rod(g,'solar frame back prop',P(t,p,roof),P(t,p,y0+rise),.02,frame,layers.roof));
  tag(k.rod(g,'solar frame rafter',P(t,0,roof),P(t,p,y0+rise),.02,frame,layers.roof));
 }
 for(let j=0;j<count;j++){
  const t=-W/2+(j+.5)*width,ctr=new T.Vector3(...P(t,p/2,y0+rise/2)).addScaledVector(Y,.045);
  const panel=k.box(g,'solar panel',[width-.025,.045,L-.025],[ctr.x,ctr.y,ctr.z],k.mat('#a6abb1',.6),layers.roof);panel.quaternion.copy(q);panel.userData.source=EV_SOLAR;
  const cells=k.box(g,'photovoltaic cells',[width-.08,.008,L-.08],[ctr.x+Y.x*.027,ctr.y+Y.y*.027,ctr.z+Y.z*.027],k.mat('#1c344b',.25),layers.roof);cells.quaternion.copy(q);cells.userData.source=EV_SOLAR;
 }
}
/**
 * 2022 trailers from aerial-03 (RECONCILIATION_2022 §c; model frame X = (px − 545)/8.3, Z = (py − 345)/8.3, ±1.5 m;
 * picked by W51 on a 5 m grid over the photo): a nose-to-tail train of five on the −X (north) side, T1 at its head, and
 * four scattered ones (T7 = a light-blue tarp over a trailer-sized box and T9 = a long grey flat trailer are uncertain).
 * [id, x, z, heading (Kit rv angle: the shell's long axis is (sin a, cos a)), length].
 */
export const TRAILERS_2022:readonly [string,number,number,number,number][]=[
 ['rv-1',-21.2,-11.8,2.554,7.2],['rv-2',-24.4,-.8,Math.PI,7.5],['rv-3',-23.4,8.7,-2.761,8.0],['rv-4',-17.9,17.6,-2.356,7.5],['rv-5',-12.9,18.4,-.503,6.9],
 ['rv-6',-7.3,-15.2,1.794,7.8],['rv-7',4.1,-16.6,1.838,6.5],['rv-8',22.4,7.0,-.22,8.2],['rv-9',19.2,14.9,.802,7.5]];
