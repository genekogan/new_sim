import * as T from 'three';

import {Kit, BAY, layers} from './kit';
import {reconcile2023Source} from './details-2023-reconciliation';




export function make2023(k:Kit){
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
 reconcile2023Source(k);
}
