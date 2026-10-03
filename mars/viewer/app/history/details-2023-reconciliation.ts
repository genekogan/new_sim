import * as T from 'three';
import {Kit, BAY, layers} from './kit';

/** October1 source inventory. Call after make2023's retained assemblies exist.
 * Source classes and inventory are observed; dimensions/hidden sides remain fits.
 * No shared cached geometry is mutated. Named additions retain independent IDs. */
export function add2023Reconciliation(k:Kit){
 const find=(id:string)=>{let g:T.Object3D|undefined;k.root.traverse(o=>{if(o.userData.assembly_id===id&&!o.userData.layer)g??=o;});if(!g)throw Error(`Missing2023 assembly ${id}`);return g;};
 const b=(g:T.Object3D,id:string,size:[number,number,number],p:[number,number,number],color:string,layer:string=layers.detail)=>k.named(k.box(g,`2023 ${id}`,size,p,color,layer),`2023-${id.replace(/(^| )-/g,'$1minus-')}`);
 const rod=(g:T.Object3D,id:string,a:[number,number,number],z:[number,number,number],r=.018,color='#343b3c')=>k.named(k.rod(g,`2023 ${id}`,a,z,r,color,layers.detail),`2023-${id.replace(/(^| )-/g,'$1minus-')}`);
 const chair=(g:T.Object3D,id:string,x:number,z:number,y=.253)=>{
  b(g,`${id} upholstered seat`,[.45,.07,.43],[x,y+.43,z],'#333839');
  for(const dx of [-.19,.19])for(const dz of [-.17,.17])b(g,`${id} leg ${dx} ${dz}`,[.025,.43,.025],[x+dx,y+.215,z+dz],'#303839');
  for(const dx of [-.2,.2])b(g,`${id} back upright ${dx}`,[.027,.46,.027],[x+dx,y+.69,z-.19],'#303839');
  for(let i=0;i<3;i++)b(g,`${id} ladder back ${i}`,[.40,.035,.025],[x,y+.59+i*.115,z-.19],'#303839');
 };
 const foldTable=(g:T.Object3D,id:string,x:number,z:number,w=1.8,d=.72)=>{
  b(g,`${id} white tabletop`,[w,.05,d],[x,1.01,z],'#d8dbd4');
  for(const side of [-1,1])for(const dz of [-d*.32,d*.32])rod(g,`${id} folding leg ${side} ${dz}`,[x+side*w*.34,.253,z+dz],[x+side*w*.34,.985,z+dz],.023,'#565c5c');
 };
 const bar=find('chatsubo');
 // c989/c1000: longitudinal partition alongside the auditorium; source surface
 // shares the ant mural's x plane. Its narrow doorway is an actual aperture.
 const wallX=BAY/2,doorZ=.57,doorWidth=.83,lo=-BAY,hi=BAY-2.5;
 for(const [id,start,end] of [['rear',lo,doorZ-doorWidth/2],['front',doorZ+doorWidth/2,hi]] as const){
  if(end>start){const m=b(bar,`bar swirl ${id} partition`,[.055,2.12,end-start],[wallX,1.313,(start+end)/2],'#d8d7cc',layers.wall);m.material=k.photo('/history/2023/swirls.webp');}
 }
 b(bar,'bar door lintel',[.055,.23,doorWidth],[wallX,2.26,doorZ],'#b39470',layers.wall);
 const counterX=BAY/2-.45;
 b(bar,'bar counter plywood body',[.60,.72,3.10],[counterX,.613,-.34],'#a88d6a');
 b(bar,'bar collage tabletop',[.72,.06,3.15],[counterX,1.003,-.34],'#6f6855');
 const painted=b(bar,'bar actual landscape counter face',[.026,.72,3.10],[counterX-.32,.613,-.34],'#b09468');painted.material=k.photo('/history/2023/cafe-front.webp');
 // Reuse the actual counter art, never a synthetic new mural.
 painted.userData.source='c989 March29 photographed yellow sun and mountain counter; retained native cafe-front crop, physical counter length fitted';
 b(bar,'bar water stand top',[.34,.04,.34],[-1.42,.41,-1.3],'#b3976f');
 for(const dx of [-.13,.13])for(const dz of [-.13,.13])b(bar,`bar water stand leg ${dx} ${dz}`,[.025,.1375,.025],[-1.42+dx,.32125,-1.3+dz],'#b3976f');
 b(bar,'bar water dispenser',[.26,.47,.26],[-1.42,.665,-1.3],'#cfdad5');
 b(bar,'bar water bottle',[.27,.43,.27],[-1.42,1.105,-1.3],'#9bafad');
 const cave=find('media-cave');cave.userData.source+='; c1023 March29 white board room, projector, two tripod speakers, mixer and chairs; bay placement fitted';
 b(cave,'media rear white panel',[BAY-.12,2.12,.05],[0,1.32,-3.50],'#d9dcd4',layers.wall);
 b(cave,'media east white panel',[.05,2.12,3.8],[BAY/2-.1,1.32,-1.63],'#d9dcd4',layers.wall);
 foldTable(cave,'media mixer table',0,-2.95,2.1,.58);
 b(cave,'media mixer',[.46,.08,.25],[0,1.075,-2.95],'#293235');
 b(cave,'media hanging projector',[.32,.16,.28],[-1.42,2.16,-2.7],'#dce0dc');
 b(cave,'media projector lens',[.06,.07,.015],[-1.42,2.16,-2.55],'#283b43');
 for(const x of [-1.25,1.25]){
  const id=`media speaker ${x}`;b(cave,id,[.34,.62,.30],[x,1.62,-2.94],'#23282a');rod(cave,`${id} tripod mast`,[x,.33,-2.94],[x,1.35,-2.94]);
  for(let i=0;i<3;i++){const a=i*2*Math.PI/3;rod(cave,`${id} tripod foot ${i}`,[x,.52,-2.94],[x+Math.sin(a)*.32,.253,-2.94+Math.cos(a)*.32]);}
 }
 for(const [i,x,z] of [[0,-.95,-.8],[1,0,-.35],[2,.95,-.8]] as const)chair(cave,`media chair ${i}`,x,z);
 const classroom=k.assembly('2023-classroom-detail','2023 photographed classroom',[2*BAY,0,0],0,'c1007 March29 white board, plywood partition, white table and dark ladder chairs. Exact bay assignment remains fitted.');find('chiba').add(classroom);
 b(classroom,'classroom rear plywood',[BAY-.1,2.1,.05],[0,1.31,-3.5],'#b79770',layers.wall);
 b(classroom,'classroom white board',[.05,1.38,2.7],[-BAY/2+.10,1.47,-1.05],'#d8dbd3',layers.wall);
 foldTable(classroom,'classroom table',0,-2.7,1.82,.73);
 for(const [i,x,z] of [[0,.95,-2.7],[1,.8,-.6],[2,0,.1],[3,-.9,.6]] as const)chair(classroom,`classroom chair ${i}`,x,z);
 b(classroom,'classroom portable projector',[.31,.12,.24],[-1.1,.86,-1.4],'#d9ded9');
 b(classroom,'classroom projector stool',[.48,.05,.43],[-1.1,.77,-1.4],'#535752');
 for(const s of [-1,1]){rod(classroom,`projector stool crossed leg ${s}`,[-1.1+s*.20,.253,-1.59],[-1.1-s*.20,.745,-1.21],.016,'#8c9694');}
 const power=k.assembly('2023-pv-work-aisle','2023 occupied PV power and tool aisle',[.5*BAY,0,4.15],0,'c1019 March29: yellow/blue bins on low tables, white batteries against wall; open dirt aisle behind front leaning PV. Width and box layout fitted.');
 for(let i=0;i<2;i++){
  b(power,`tool bench ${i}`,[2.9,.06,.65],[i*3.0-1.5,.79,.6],'#8e866d');
  for(const xx of [-1.2,1.2])b(power,`tool bench leg ${i} ${xx}`,[.04,.92,.04],[i*3.0-1.5+xx,.30,.6],'#4c5350');
  for(let j=0;j<3;j++)b(power,`open parts bin ${i} ${j}`,[.58,.21,.38],[i*3.0-2.1+j*.6,.925,.6],j===2?'#355674':'#ddb227');
 }
 for(let i=0;i<3;i++)b(power,`battery box ${i}`,[.47,.39,.31],[i*.55-.65,.035,-.14],'#d4d6cf');
 const chiba=find('chiba');
 b(chiba,'auditorium hanging projector',[.32,.16,.30],[0,2.15,-3.05],'#dfe2df');
 b(chiba,'auditorium projector suspension',[.055,.20,.055],[0,2.34,-3.05],'#363c3a');
 const mats=k.assembly('2023-auditorium-mats','2023 rolled mats beside stepped auditorium',[.5*BAY-.55,0,-2.0],0,'c998 March29 lower side cabinet and rolled exercise mats; local placement fitted');chiba.add(mats);
 b(mats,'mat cabinet',[.95,.5,.56],[0,.51,0],'#405a66');
 const rollGeo=new T.CylinderGeometry(.08,.08,.65,10);
 for(let i=0;i<5;i++){const m=new T.Mesh(rollGeo,k.mat(['#7a5c7b','#536f75','#3d4249'][i%3]));m.rotation.z=Math.PI/2;m.position.set(0,.86+(i>2?.13:0),-.22+i*.1);k.named(k.tag(mats,m,'2023 rolled auditorium mat',layers.detail),`2023-mat-${i}`);}
 // Class-level low-cost fleet recognizers; no invented logos or face imagery.
 const wheelGeometries=new Map<number,T.CylinderGeometry>();
 for(const g of k.root.children.filter(g=>g.children.some(o=>o.name==='vehicle body'))){
  const body=g.children.find(o=>o.name==='vehicle body') as T.Mesh<T.BoxGeometry>;
  const {width:w,depth:len}=body.geometry.parameters,high=body.position.y>1;
  // Authored tire bottoms were .01 above zero; actual Studio soil is −.16.
  // Assembly shift keeps wheel/body registration and all component-local IDs.
  g.position.y=-.17;
  for(const tire of g.children.filter(o=>o.name==='motor vehicle tire') as T.Mesh<T.CylinderGeometry>[]){
   const radius=tire.geometry.parameters.radiusTop;let geo=wheelGeometries.get(radius);if(!geo){geo=new T.CylinderGeometry(radius,radius,.19,12);wheelGeometries.set(radius,geo);}tire.geometry=geo;
  }
  for(const side of [-1,1]){
   rod(g,`mirror arm ${side}`,[side*w/2,high?1.83:1.38,len*.25],[side*(w/2+.16),high?1.83:1.38,len*.25]);
   b(g,`mirror housing ${side}`,[.095,.14,.18],[side*(w/2+.19),high?1.83:1.38,len*.25],'#343c3e',layers.context);
   b(g,`front lamp ${side}`,[.26,.13,.035],[side*w*.32,high?.93:.79,len/2+.025],'#d5d7bd',layers.context);
   b(g,`rear lamp ${side}`,[.14,.16,.035],[side*w*.40,high?.83:.73,-len/2-.025],'#963c36',layers.context);
  }
  for(const s of [-1,1])b(g,`bumper ${s}`,[w,.14,.09],[0,high?.63:.54,s*(len/2+.06)],'#5d6666',layers.context);
  if(String(g.name).toLowerCase().includes('pickup')){
   b(g,'pickup open bed dark inset',[w-.19,.025,len*.32],[0,1.145,-len*.31],'#333b3c',layers.context);
   for(const s of [-1,1])b(g,`pickup bed rail ${s}`,[.07,.20,len*.34],[s*(w/2-.06),1.24,-len*.31],'#797f76',layers.context);
  }
 }
 const truck=find('yellow-service-truck'),truckBody=truck.children.find(o=>o.name==='vehicle body') as T.Mesh;
 truckBody.material=k.mat('#d6cbb1');
 for(const side of [-1,1])b(truck,`service yellow lower band ${side}`,[.03,.27,7.68],[side*1.192,.75,0],'#c9a12f',layers.context);
 // c1034/c6656: four small rooftop panels on the yellow service truck.
 for(let c=0;c<2;c++)for(let rr=0;rr<2;rr++){
  const m=b(truck,`service roof PV ${c} ${rr}`,[.95,.04,1.22],[(c-.5)*.99,2.82,(rr-.5)*1.27],'#263d46',layers.roof);m.rotation.x=.23;
 }
 const bus=find('painted-school-bus');
 b(bus,'school bus rear AC',[.56,.43,.21],[0,2.14,-3.73],'#a8b0a9',layers.context);
 for(const side of [-1,1]){
  b(bus,`school bus yellow belt ${side}`,[.025,.22,6.97],[side*1.192,1.10,0],'#c39a39',layers.context);
  for(const xx of [.73,.93])b(bus,`school bus rear flash ${side} ${xx}`,[.15,.14,.027],[side*xx,2.31,-3.63],'#8a3934',layers.context);
 }
 // March14t12/t110 already show the small white faceted shelter east of
 // Rotapolis, so this does not import March29 parked-vehicle positions.
 const toilets=k.assembly('2023-blue-portable-toilets','2023 paired blue portable toilets',[16,-.16,27],0,'c6654t4 March14 and c1030 March29: two blue toilets, white domed tops and reddish guys beside tire boundary. Exact site center and facing fitted.');
 const roofGeo=new T.SphereGeometry(1,12,8,0,Math.PI*2,0,Math.PI/2);
 for(let i=0;i<2;i++){
  const x=i*1.16;b(toilets,`toilet blue body ${i}`,[1.07,2.03,1.10],[x,1.015,0],'#256387',layers.context);
  b(toilets,`toilet door inset ${i}`,[.88,1.82,.032],[x,1.025,.569],'#1c5276',layers.context);
  b(toilets,`toilet door handle ${i}`,[.055,.13,.035],[x+.34,1.13,.602],'#bec6c5',layers.context);
  const roof=new T.Mesh(roofGeo,k.mat('#d3dad6'));roof.scale.set(.57,.16,.58);roof.position.set(x,2.03,0);k.named(k.tag(toilets,roof,'2023 toilet rounded white roof',layers.context),`2023-toilet-roof-${i}`);
  for(const xx of [-.42,.42])rod(toilets,`toilet red guy ${i} ${xx}`,[x+xx,1.92,-.49],[x+xx*2,.02,-1.2],.011,'#a3696b');
 }
 const dome=k.assembly('2023-white-faceted-shelter','2023 white faceted shelter',[18,-.16,-25],0,'c6656t12/t110 March14 and c1034 March29: small white faceted dome with circular front windows. Center/radius/door facing fitted; tent identity unspecified.');
 const domeGeo=new T.SphereGeometry(1.8,10,5,0,Math.PI*2,0,Math.PI/2);domeGeo.clearGroups();domeGeo.computeVertexNormals();
 const domeMesh=new T.Mesh(domeGeo,new T.MeshStandardMaterial({color:'#d7dfd9',flatShading:true,side:T.DoubleSide,roughness:.93}));k.named(k.tag(dome,domeMesh,'2023 faceted white shelter cover',layers.context),'2023-white-shelter-cover');
 // Triangle seams and two dark round windows describe the observed faceted form.
 for(const side of [-1,1]){
  const radial=new T.Vector3(side*.65,1.25,1.12).normalize(),probe=new T.Mesh(domeGeo,domeMesh.material);probe.updateMatrixWorld(true);
  const hit=new T.Raycaster(radial.clone().multiplyScalar(3),radial.clone().negate()).intersectObject(probe,false)[0];
  if(!hit?.face)throw Error('2023 shelter window facet missing');
  const normal=hit.face.normal.clone(),pane=new T.Mesh(new T.CircleGeometry(.17,16),k.mat('#65787c'));pane.position.copy(hit.point).addScaledVector(normal,.007);pane.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),normal);k.named(k.tag(dome,pane,'2023 shelter round window',layers.context),`2023-shelter-window-${side<0?'left':'right'}`);
 }
 const seam=new T.LineSegments(new T.WireframeGeometry(domeGeo),new T.LineBasicMaterial({color:'#788b8f'}));dome.add(seam);seam.userData.walkNoCollision=true;
 const tarp=k.assembly('2023-pickup-tarp','2023 beige guyed tarp beside orange pickup',[24,-.16,9],0,'c6656t12 March14: beige triangular/ridge tarp beside orange pickup. Span/height/parking coordinates fitted, no enclosed room invented.');
 const clothGeo=new T.BufferGeometry();clothGeo.setAttribute('position',new T.Float32BufferAttribute([-2,1.25,-1.6,0,2.25,-1.6,0,2.25,1.6,-2,1.25,1.6,0,2.25,-1.6,2,1.25,-1.6,2,1.25,1.6,0,2.25,1.6],3));clothGeo.setIndex([0,1,2,0,2,3,4,5,6,4,6,7]);clothGeo.computeVertexNormals();
 const cloth=new T.Mesh(clothGeo,new T.MeshStandardMaterial({color:'#c9bd8d',side:T.DoubleSide,roughness:1}));k.named(k.tag(tarp,cloth,'2023 beige photographed tarp',layers.context),'2023-pickup-tarp-cover');cloth.userData.walkNoCollision=true;
 for(const z of [-1.6,1.6])rod(tarp,`tarp ridge pole ${z}`,[0,0,z],[0,2.25,z],.025,'#8f8973');
 for(const xx of [-2,2])for(const zz of [-1.6,1.6])rod(tarp,`tarp guy ${xx} ${zz}`,[xx,1.25,zz],[xx*1.4,.025,zz*1.6],.009,'#797967');
 const shade=k.assembly('2023-small-open-shade','2023 small open sunshade',[27,-.16,-18],0,'c6656t12: low four-post orange timber canopy behind trailer group. Fabric and dimensions fitted; fully open sides.');
 for(const xx of [-1.8,1.8])for(const zz of [-1.2,1.2])b(shade,`shade post ${xx} ${zz}`,[.065,2.15,.065],[xx,1.075,zz],'#ba7f4c',layers.context);
 b(shade,'shade roof',[3.7,.035,2.5],[0,2.15,0],'#c0af82',layers.context).userData.walkNoCollision=true;
 // c6656t70 directly resolves rv1's road-side slide-out and rv5 Mesa Ridge dark nose.
 const slide=find('rv-1');b(slide,'slideout body',[.54,1.5,2.48],[-1.40,1.6,.10],'#d2d5cd',layers.context);
 b(slide,'slideout black glazing',[.025,.6,1.92],[-1.68,1.9,.10],'#2d4147',layers.context);
 const mesa=find('rv-5');b(mesa,'Mesa Ridge dark front',[2.28,1.96,.03],[0,1.83,3.46],'#455558',layers.context);
 b(mesa,'Mesa Ridge pale nose inset',[1.97,1.49,.018],[0,1.91,3.48],'#d1d7d4',layers.context);
 for(let n=1;n<=5;n++){
  const rv=find(`rv-${n}`);b(rv,'entry dark glass',[.026,.55,.42],[1.23,1.95,-[8,7.4,7,6.5,6.9][n-1]*.27],'#34464a',layers.context);
  for(let i=0;i<2;i++)b(rv,`entry stair ${i}`,[.43,.07,.66],[1.4+i*.18,.20+i*.17,-[8,7.4,7,6.5,6.9][n-1]*.27],'#646b69',layers.context);
 }
}

/** Occupied February23 kitchen replaces the generic Kit.kitchen inventory.
 * c6657t0/c6656t34 resolve the glazed reused door on the outside end, not rear. */
export function add2023RotapolisKitchen(k:Kit,g:T.Object3D,depth:number){
 g.userData.source='c68884/85/87 February23 occupied kitchen; c6657t0/c6656t34 March14 exterior door face. Counter arrangement and dimensions fitted to one rack bay; no invented white standing fridge.';
 const floor=.2525,doorZ=-.55,doorW=.87,doorH=1.97,x=BAY/2;
 const b=(id:string,size:[number,number,number],p:[number,number,number],color:string,layer:string=layers.detail)=>k.named(k.box(g,`2023 Rotapolis ${id}`,size,p,color,layer),`2023-rotapolis-${id.replace(/(^| )-/g,'$1minus-')}`);
 // Full rear wall; end wall cut into three infill rectangles around actual door.
 b('rear plywood',[BAY,2.18,.06],[0,1.3425,-depth/2],'#ad8a62',layers.wall);
 const low=-depth/2,high=depth/2,left=doorZ-doorW/2,right=doorZ+doorW/2;
 b('door rear infill',[.06,2.18,left-low],[x,1.3425,(low+left)/2],'#ad8a62',layers.wall);
 b('door front infill',[.06,2.18,high-right],[x,1.3425,(right+high)/2],'#ad8a62',layers.wall);
 b('door header',[.06,2.18-doorH,doorW],[x,floor+doorH+(2.18-doorH)/2,doorZ],'#ad8a62',layers.wall);
 b('inner plywood',[.06,2.18,depth],[-x,1.3425,0],'#ad8a62',layers.wall);
 // Door remains a leaf held open beside its frame; dark rectangle is real glazing.
 const door=new T.Group();door.userData={...g.userData};door.position.set(x+.035,floor,doorZ-doorW/2);door.rotation.y=1.4;g.add(door);
 const leaf=(id:string,size:[number,number,number],p:[number,number,number],c:string)=>k.named(k.box(door,`2023 Rotapolis white door ${id}`,size,p,c,layers.wall),`2023-rotapolis-door-${id}`);
 leaf('lower panel',[.055,.68,doorW],[0,.34,doorW/2],'#d5d9d3');
 for(const zz of [.04,doorW-.04])leaf(`stile ${zz}`,[.055,doorH,.08],[0,doorH/2,zz],'#d5d9d3');
 for(const yy of [.72,1.33,1.93])leaf(`cross rail ${yy}`,[.055,.065,doorW],[0,yy,doorW/2],'#d5d9d3');
 leaf('glazed upper panel',[.022,1.10,doorW-.17],[0,1.30,doorW/2],'#819ea5');
 b('door latch',[.04,.06,.06],[x+.08,1.12,doorZ+.32],'#535958');
 // Source right-wall continuous sink/stove worktop, with red mini refrigerator below.
 b('sink stove countertop',[2.76,.065,.68],[0,1.16,-depth/2+.40],'#b99c76');
 for(const xx of [-1.25,1.25])b(`counter leg ${xx}`,[.075,.91,.075],[xx,.7075,-depth/2+.40],'#b99c76');
 b('red refrigerator',[.63,.81,.61],[-.72,floor+.405,-depth/2+.43],'#9f302d');
 b('red fridge handle',[.25,.025,.025],[-.72,1.00,-depth/2+.747],'#aaaead');
 b('red fridge latch',[.085,.05,.03],[-.96,.74,-depth/2+.75],'#a4aaab');
 b('double sink steel rim',[1.05,.035,.54],[.57,1.212,-depth/2+.42],'#9ba9a9');
 for(const xx of [.30,.83])b(`sink basin ${xx}`,[.44,.017,.42],[xx,1.233,-depth/2+.42],'#465455');
 k.named(k.rod(g,'2023 Rotapolis sink tap',[.57,1.24,-depth/2+.16],[.57,1.55,-depth/2+.16],.019,'#a7b0b0',layers.detail),'2023-rotapolis-sink-tap');
 b('green stove base',[.56,.10,.32],[-.60,1.245,-depth/2+.42],'#365951');
 b('green stove open lid',[.56,.36,.04],[-.60,1.475,-depth/2+.27],'#365951');
 const burnerGeo=new T.CylinderGeometry(.087,.087,.015,12);
 for(const xx of [-.74,-.46]){const m=new T.Mesh(burnerGeo,k.mat('#343b3d'));m.position.set(xx,1.306,-depth/2+.43);k.named(k.tag(g,m,'2023 Rotapolis stove burner',layers.detail),`2023-rotapolis-burner-${xx}`);}
 // The opposite photographed preparation table and one pantry shelf.
 b('white preparation tabletop',[1.51,.055,.70],[-x+.49,1.015,.65],'#d2d7d1');
 for(const zz of [.38,.92])for(const xx of [-x+.09,-x+.89])b(`preparation leg ${xx} ${zz}`,[.028,.735,.028],[xx,.62,zz],'#5c6665');
 b('black chest freezer',[.88,.88,.67],[-x+.50,floor+.44,1.75],'#303633');
 b('black chest freezer lid',[.92,.055,.70],[-x+.50,1.16,1.75],'#242a29');
 b('condiment shelf',[.34,.045,1.87],[-x+.18,1.84,.68],'#a38b69');
 for(let i=0;i<9;i++)b(`shelf ingredient ${i}`,[.12,.13+(i%3)*.04,.14],[-x+.20,1.945,.02+i*.16],['#bbaf82','#697753','#9d6a42'][i%3]);
 const cookerGeo=new T.CylinderGeometry(.16,.16,.25,12),cooker=new T.Mesh(cookerGeo,k.mat('#a1a8a8',.5));cooker.position.set(-x+.5,1.17,.61);k.named(k.tag(g,cooker,'2023 Rotapolis pressure cooker',layers.detail),'2023-rotapolis-pressure-cooker');
 b('pressure cooker black lid',[.35,.045,.35],[-x+.5,1.318,.61],'#353b39');
 b('red kettle',[.18,.24,.17],[-x+.5,1.17,.96],'#a63030');
 // Distinct colored outdoor chairs remain in the source open lower lounge bay.
 g.userData.source='c68884/85/87 February23 occupied kitchen; c6657t0/c6656t34 March14 exterior door face. Counter arrangement and dimensions fitted to one rack bay; no invented white standing fridge.';
}

/** Freeze every preexisting component owner ID before source corrections.
 * Unsupported proxy triangles remain invisible quarantined owners, so old
 * saved objects never silently bind to a different photographed part. */
export function reconcile2023Source(k:Kit){
 k.finalize();
 k.root.traverse(o=>{if(o.userData.component_id){const prefix=String(o.userData.assembly_id)+'-';o.userData.named_id=String(o.userData.component_id).slice(prefix.length);}});
 const find=(id:string)=>{let g:T.Object3D|undefined;k.root.traverse(o=>{if(o.userData.assembly_id===id&&!o.userData.layer)g??=o;});if(!g)throw Error(id);return g;};
 const hide=(o:T.Object3D,why:string)=>{o.visible=false;o.userData.walkNoCollision=true;o.userData.source_quarantine=why;};
 const g=find('chiba'),bar=find('chatsubo'),cave=find('media-cave');
 // March14 parking sectors are observed, but centers are fitted. Combined
 // runtime review exposed a blocked kitchen door and touching trailer corners.
 const doorVan=find('census-v08');doorVan.position.x=16;
 doorVan.userData.source+='; center fitted outward 2m to leave photographed end doorway usable';
 const outerTrailer=find('rv-3');outerTrailer.position.set(20,outerTrailer.position.y,-18);
 outerTrailer.userData.source+='; outer rear cluster center fitted outward to avoid trailer corner contact';
 // A fitted room center must not straddle the photographed auditorium void.
 // The one-bay media room remains a placement hypothesis, clearly sourced.
 cave.position.x=BAY;
 const library=find('library');for(const o of library.children)hide(o,'generic bookshelf coordinates overlap c1007 classroom fit; library exists but its exact shelves are unregistered');
 library.userData.source+='; shelf proxies quarantined where they overlap finished photographed classroom; precise library contents/bay remain unavailable';
 for(const o of g.children)if((o.name==='screen bezel'||o.name==='display content')&&Math.abs(o.position.x-.5*BAY)<.01)hide(o,'c1023 equipped media room supersedes generic portal image on incorrectly registered rear wall');
 // c998/69300/69412: lower auditorium void and stepped floor.
 for(const o of g.children)if(o instanceof T.Mesh&&o.name==='plywood deck sheet'&&Math.abs(o.position.y-2.46)<.01&&Math.abs(o.position.x)<BAY/2){o.geometry=o.geometry.clone();o.geometry.scale(1,1,.48/(2*BAY));o.geometry.translate(0,0,BAY-.24);}
 g.traverse(o=>{if(o.name==='12 foot orange beam'){const p=g.worldToLocal(o.getWorldPosition(new T.Vector3()));if(Math.abs(p.x)<.01&&Math.abs(p.y-2.48)<.01)hide(o,'c998 lower audience bay is hollow below middle landing; original owner retained');}});
 for(let i=0;i<7;i++){
  const run=2*BAY-.48,step=run/7,y=.22+(i+1)*2.24/7,z=-BAY+(i+.5)*step;
  k.named(k.box(g,'2023 lower auditorium plywood tier',[BAY-.1,.065,step-.012],[0,y,z],'#bfa17b',layers.floor),`2023-lower-auditorium-tier-${i}`);
  k.named(k.box(g,'2023 lower auditorium orange support',[BAY-.1,.12,.075],[0,y-.08,z-step/2+.04],'#b84c26',layers.steel),`2023-lower-auditorium-support-${i}`);
 }
 const ant=g.children.find(o=>o.name==='plywood wall'&&(o as T.Mesh<T.BoxGeometry,T.MeshStandardMaterial>).material.map&&((o as T.Mesh<T.BoxGeometry,T.MeshStandardMaterial>).material.map?.image as {src?:string}|undefined)?.src?.includes('ant-mural'));
 // Offline texture stubs store sourceUrl; browser maps use the image src.
 const antPanel=ant??g.children.find(o=>o.name==='plywood wall'&&Math.abs(o.position.x+.5*BAY)<.01&&Math.abs(o.rotation.y-Math.PI/2)<.01);
 if(antPanel)antPanel.position.z=BAY-1.25;
 for(const o of bar.children.slice())hide(o,'c989/c1000 longitudinal bar partition supersedes generic rear wall; original owner retained');
 for(const o of g.children)if((o.name==='table top'||o.name==='table leg')&&Math.abs(o.position.x+2.5*BAY)<1.4)hide(o,'c989 counter belongs beside auditorium, not far-west generic table');
 bar.position.x=-BAY;bar.name='Chatsubo · beside internal auditorium';
 for(const o of cave.children)if(o.name==='gray couch')hide(o,'c1023 source furnished projection room has chairs/equipment; old couch proxy owner retained');
 const kitchen=find('kitchen-interior');for(const o of kitchen.children.slice())hide(o,'February23 source kitchen supersedes generic inventory/incorrect window; original owners retained');
 add2023RotapolisKitchen(k,kitchen,4.572);
 add2023Reconciliation(k);
}
