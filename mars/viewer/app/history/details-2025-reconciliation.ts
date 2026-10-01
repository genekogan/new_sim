import * as T from 'three';
import {Kit,BAY,layers} from './kit';
import {GROUND} from '../studio/ambience-math';
/** Sequential Sept30 source review. Every assembly carries actual observations
 * and explicitly fitted placement. No source-CAD or other-year changes. */
export function add2025Reconciliation(k:Kit,chiba:T.Group,free:T.Group,body:T.Group,tool:T.Group){
 const scissor=k.assembly('solar-sam-scissor','Solar Sam · octagonal scissor canopy',[13.2,0,25.3],.32,
 'Gene c518/c46525/c1052: octagonal lapped timber frame between Tool Camp and Chiba, black shade cloth, gear tables and red Chiba sign. Footprint7.2m, height2.9m, courtyard fit±2m; exact joints/hardware unmeasured.');
 const points:[number,number,number][]=Array.from({length:8},(_,i)=>{const a=Math.PI/8+i*Math.PI/4;return [3.6*Math.cos(a),GROUND,3.6*Math.sin(a)];});
 const timber=(name:string,a:number[],b:number[],width=.09,depth=.045)=>{
  const av=new T.Vector3().fromArray(a),bv=new T.Vector3().fromArray(b),delta=bv.clone().sub(av),m=k.box(scissor,name,[width,delta.length(),depth],av.clone().add(bv).multiplyScalar(.5).toArray(),'#bb9863',layers.steel);m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),delta.normalize());return m;
 };
 for(let i=0;i<8;i++){
  const a=points[i],b=points[(i+1)%8],c=points[(i+2)%8];
  timber('Scissor canopy primary timber post',a,[a[0],2.90,a[2]],.10,.07);
  timber('Scissor canopy crossed face timber brace',a,[b[0],2.86,b[2]],.085,.045);
  timber('Scissor canopy perimeter roof beam',[a[0],2.90,a[2]],[b[0],2.90,b[2]]);
  timber('Scissor canopy reciprocal roof timber',[a[0],2.92,a[2]],[c[0],2.70,c[2]]);
 }
 const shadeShape=new T.Shape();points.forEach((p,i)=>i?shadeShape.lineTo(p[0]*.94,-p[2]*.94):shadeShape.moveTo(p[0]*.94,-p[2]*.94));shadeShape.closePath();
 const shade=new T.Mesh(new T.ShapeGeometry(shadeShape),new T.MeshStandardMaterial({color:'#252927',side:T.DoubleSide,transparent:true,opacity:.9}));shade.rotation.x=-Math.PI/2;shade.position.y=2.77;k.tag(scissor,shade,'Scissor canopy photographed black shade cloth',layers.roof);shade.userData.walkNoCollision=true;
 for(const x of [-1.75,0,1.75])k.table(scissor,x,1.05,1.70,.70,.74);
 k.table(scissor,2.30,-.6,1.05,.65,.91);
 for(const x of [-1.15,1.95]){
  const jug=new T.Mesh(new T.CylinderGeometry(.16,.16,.47,12),k.mat('#73a5b4'));jug.position.set(x,.74+.235,1.05);k.tag(scissor,jug,'Scissor canopy blue drinking-water jug',layers.detail);
  k.box(scissor,'Scissor canopy water jug cap',[.10,.09,.10],[x,1.25,1.05],'#dfdccc',layers.detail);
 }
 const bin=new T.Mesh(new T.CylinderGeometry(.30,.26,.78,12),k.mat('#375c80'));bin.position.set(2.55,GROUND+.39,2.12);k.tag(scissor,bin,'Scissor canopy blue waste bin',layers.detail);
 for(const x of [-.65,.35,1.0]){
  const coil=new T.Mesh(new T.TorusGeometry(.17,.035,5,12),k.mat(x<0?'#303833':'#b85e33'));coil.rotation.x=-Math.PI/2;coil.position.set(x,.80,1.05);k.tag(scissor,coil,'Scissor canopy equipment cable coil',layers.detail);coil.userData.walkNoCollision=true;
 }
 const sign=new T.Mesh(new T.PlaneGeometry(3.1,.64),k.photo('/history/2025/reconciliation/scissor-chiba-sign.webp'));sign.position.set(0,GROUND+.32,3.49);(sign.material as T.Material).side=T.DoubleSide;(sign.material as T.Material).transparent=true;(sign.material as T.Material).alphaTest=.35;k.tag(scissor,sign,'Scissor canopy actual red Chiba sign',layers.detail);sign.userData.walkNoCollision=true;
 // Occupied Jan29/Feb1 auditorium sources show the portable table at low
 // north end, three loose perforated chairs at high entrance, pink upstairs
 // sofa, hanging patterned cloth and warm string bulbs.
 const occupied=k.assembly('chiba-2025-occupied','Chiba · source-backed occupied auditorium',[0,0,0],0,'c46581/c72606/c72601: low north presenter table, loose high-end chairs, pink west upper sofa, patterned ceiling cloth and warm strings. Furniture pose fitted across dates.');chiba.add(occupied);
 const classroom=k.root.children.find(o=>o.userData.assembly_id==='classroom');
 if(classroom){classroom.userData.source='c72606 upper west pink sofa and workspace; placement fitted';for(const o of classroom.children)if(['pink sofa seat','pink sofa back'].includes(o.userData.kind)){o.position.y+=2.48;o.userData.source='c72606: pink sofa on west upper gallery, not ground; position within gallery fitted';}
  for(const x of [-.83,.83])for(const z of [1.68,2.31])k.box(classroom,'Upstairs pink sofa grounded foot',[.09,.2775,.09],[x,2.63125,z],'#684c39',layers.detail);
  for(const x of [-.94,.94])k.box(classroom,'Upstairs pink sofa arm',[.12,.30,.85],[x,3.11,2],'#a35e75',layers.detail);
 }
 // Folding/perforated backs are silhouettes, not expensive transparent grids.
 for(const x of [-1.04,0,1.04]){
  const z=4.66,y=2.4625;
  k.box(occupied,'Auditorium loose dark chair seat',[.45,.055,.43],[x,y+.43,z],'#343b3b',layers.detail);
  k.box(occupied,'Auditorium loose chair perforated-back silhouette',[.45,.30,.045],[x,y+.75,z+.20],'#4f5854',layers.detail);
  for(const xx of [x-.19,x+.19])for(const zz of [z-.16,z+.16])k.rod(occupied,'Auditorium loose chair leg',[xx,y,zz],[xx,y+.43,zz],.014,'#444d49',layers.detail);
 }
 const clothGeom=new T.PlaneGeometry(3.36,5.5,12,16);clothGeom.rotateX(-Math.PI/2);const pos=clothGeom.getAttribute('position');for(let i=0;i<pos.count;i++){const u=(pos.getX(i)+1.68)/3.36,v=(pos.getZ(i)+2.75)/5.5;pos.setY(i,4.66-(.30+.75*Math.pow(Math.sin(3*Math.PI*v),2))*Math.sin(Math.PI*u));}clothGeom.computeVertexNormals();
 const cloth=new T.Mesh(clothGeom,k.photo('/history/2025/reconciliation/auditorium-ceiling-pattern.webp'));cloth.position.z=-.5;k.tag(occupied,cloth,'Auditorium photographed patterned ceiling textile',layers.detail);cloth.userData.walkNoCollision=true;
 for(const x of [-1.68,1.68])for(const z of [-3.25,2.25])k.rod(occupied,'Auditorium cloth fitted ceiling tie',[x,4.66,z],[x,4.83,z],.004,'#c9c2aa',layers.detail).userData.walkNoCollision=true;
 const bulbMaterial=new T.MeshStandardMaterial({color:'#ffe3a4',emissive:'#ffc475',emissiveIntensity:.7});
 for(const x of [-1.73,1.73]){
  k.rod(occupied,'Auditorium warm string cable',[x,2.30,-4.65],[x,2.85,4.65],.005,'#4a4235',layers.detail);
  for(let i=0;i<7;i++){const z=-4.3+i*1.43,y=2.32+.55*(z+4.65)/9.3;const bulb=new T.Mesh(new T.SphereGeometry(.055,8,6),bulbMaterial);bulb.position.set(x,y-.06,z);k.tag(occupied,bulb,'Auditorium warm string bulb',layers.detail);bulb.userData.walkNoCollision=true;}
 }
 // c45838 occupied Bodywork: painted blue rack frames, mat joints,
 // folded blankets and papers. Loose object placement is a photo fit.
 for(const o of body.children)if(o instanceof T.Mesh&&['rack upright','rack diagonal brace'].includes(o.userData.kind)){o.material=k.mat('#416a83');o.userData.source='c45838 exposed blue painted internal frames';}
 for(const x of [-BAY,BAY])for(const dx of [-(BAY-.4)/2,(BAY-.4)/2])for(const z of [-(2*BAY-.5)/2,(2*BAY-.5)/2])k.rod(body,'Bodywork cloth fitted roof tie',[x+dx,3.35,z],[x+dx,3.56,z],.004,'#c9c2aa',layers.detail).userData.walkNoCollision=true;
 const seamMaterial=k.mat('#454749');
 for(let x=-6.4;x<6.5;x+=1.12)k.box(body,'Bodywork foam mat joint',[.008,.004,2*BAY-.43],[x,.327,0],seamMaterial,layers.detail).userData.walkNoCollision=true;
 for(let z=-2.8;z<3;z+=1.12)k.box(body,'Bodywork foam mat joint',[4*BAY-.46,.004,.008],[0,.327,z],seamMaterial,layers.detail).userData.walkNoCollision=true;
 for(let i=0;i<4;i++)k.box(body,'Bodywork folded blanket',[.68,.075,.48],[5.55,.365+i*.075,-2.8],['#c1b7a4','#767d7b','#d7cec0','#697a82'][i],layers.detail);
 for(const x of [4.9,5.4,5.9])k.box(body,'Bodywork small wall paper',[.22,.28,.006],[x,1.52,-BAY+.115],'#dfdfd5',layers.detail).userData.walkNoCollision=true;
 // c44577 supplies the actual six-pentagon roof painting, including rough
 // blue edges, white center and star. Map native pixels using the five center
 // corners; total scale/left-roof placement are fitted, not measured.
 const center=Array.from({length:5},(_,i)=>{const a=-Math.PI/2+i*2*Math.PI/5;return new T.Vector2(.55*Math.cos(a),.55*Math.sin(a));});
 const painted=[center];
 for(let i=0;i<5;i++){
  const a=center[i],b=center[(i+1)%5],d=b.clone().sub(a).normalize();
  painted.push(center.map(p=>{const rel=p.clone().sub(a),projection=d.clone().multiplyScalar(rel.dot(d));return a.clone().add(projection.multiplyScalar(2)).sub(rel);}));
 }
 const H=[568.5191438053,-254.4446610566,948.7892913649,4.3678585153,123.0317152567,457.1980769859,.0000717750,-.2528798106];
 for(const polygon of painted){
  const shape=new T.Shape(polygon),geo=new T.ShapeGeometry(shape);geo.rotateX(-Math.PI/2);
  const pos=geo.getAttribute('position'),uv=geo.getAttribute('uv');
  for(let i=0;i<pos.count;i++){const x=pos.getX(i),z=-pos.getZ(i),den=H[6]*x+H[7]*z+1;uv.setXY(i,(H[0]*x+H[1]*z+H[2])/den/1920,1-(H[3]*x+H[4]*z+H[5])/den/1080);}
  const mesh=new T.Mesh(geo,k.photo('/history/2025/reconciliation/freeside-roof-native.webp'));mesh.position.set(-BAY,2.512,0);k.tag(free,mesh,'Freeside actual blue-edged pentagon roof painting',layers.roof);mesh.userData.walkNoCollision=true;mesh.visible=false;mesh.userData.historicalQuarantine=true;mesh.userData.walkNoCollision=true;mesh.userData.source='QUARANTINED: c44577 uploaded Feb10 2025 with caption in original context, followed by retrospective Chiba last-year question. Capture date/level and 2025 Freeside location not established. Former fitted roof placement retained invisibly for stable-ID inventory, not historical assertion.';
 }
 // Later occupied rear view c46125 shows the round window HIGH in the
 // flower-painted black wall, rather than at door-handle height. Aperture
 // in scenes.ts is corrected too. Native paint mapping is a photo fit.
 const rearShape=new T.Shape();rearShape.moveTo(-1.31,.25);rearShape.lineTo(.29,.25);rearShape.lineTo(.29,2.32);rearShape.lineTo(1.00,2.32);rearShape.lineTo(1.00,2.40);rearShape.lineTo(-1.31,2.40);rearShape.closePath();
 const hole=new T.Path();hole.absellipse(-.83,1.85,.37,.37,0,Math.PI*2,true,0);rearShape.holes.push(hole);
 const rearGeometry=new T.ShapeGeometry(rearShape,32),rearPos=rearGeometry.getAttribute('position'),rearUV=rearGeometry.getAttribute('uv');
 for(let i=0;i<rearPos.count;i++){const x=rearPos.getX(i),y=rearPos.getY(i);rearUV.setXY(i,(922.7-587*x)/2048,1-(1000-(y-.25)*763/2.15)/1150);}
 const rearArt=new T.Mesh(rearGeometry,k.photo('/history/2025/reconciliation/freeside-rear-paint-native.webp'));rearArt.position.z=-BAY-.045;k.tag(free,rearArt,'Freeside photographed floral rear wall paint',layers.wall);rearArt.userData.walkNoCollision=true;rearArt.userData.source='c46125 native black/floral/peach winding mural; photo-fitted mapping around corrected high round aperture, entrance remains open';
 // The aperture has a three-curved-arm wooden ornament, visible in c46125.
 // Preserve an open view through it; curves/radii are source-fitted silhouettes.
 for(let i=0;i<3;i++){
  const a=i*2*Math.PI/3,rotate=(x:number,y:number)=>new T.Vector3(-.83+x*Math.cos(a)-y*Math.sin(a),1.85+x*Math.sin(a)+y*Math.cos(a),-BAY-.052);
  const curve=new T.QuadraticBezierCurve3(rotate(0,.365),rotate(.30,.19),rotate(0,0));
  const arm=new T.Mesh(new T.TubeGeometry(curve,18,.022,5,false),k.mat('#6b5b36'));k.tag(free,arm,'Freeside round window three curved wooden arms',layers.detail);arm.userData.walkNoCollision=true;arm.userData.source='c46125 three curved wooden arms inside high round pane; curves and width fitted';
 }
 const rearLeaf=k.box(free,'Freeside rear painted door open leaf',[.86,2.04,.055],[1.15,1.30,-BAY-.04],'#252a27',layers.wall);rearLeaf.geometry=rearLeaf.geometry.clone();rearLeaf.geometry.translate(-.43,0,0);rearLeaf.rotation.y=Math.PI/2;rearLeaf.userData.source='c46125 photographed painted door; open inspection pose, hinge fitted';
 const rearDoorGeometry=new T.PlaneGeometry(.82,1.99),duv=rearDoorGeometry.getAttribute('uv');[[650,245],[335,245],[650,999],[335,999]].forEach(([x,y],n)=>duv.setXY(n,x/2048,1-y/1150));
 const rearDoorArt=new T.Mesh(rearDoorGeometry,k.photo('/history/2025/reconciliation/freeside-rear-paint-native.webp'));rearDoorArt.position.set(-.43,0,-.034);k.tag(rearLeaf,rearDoorArt,'Freeside actual rear door floral painting',layers.wall);rearDoorArt.userData.walkNoCollision=true;
 // Solar Sam's actual bus (c46549/c518): blue passenger body, white forward
 // cab and yellow lower side accent, not a uniform blue block.
 const bus=k.root.children.find(o=>o.userData.assembly_id==='rv-10');
 if(bus){
  bus.userData.source+='; c46549/c518 white cab and yellow lower trim, details fitted';
  const outline=new T.Shape();outline.moveTo(1.216,.50);outline.lineTo(3.80,.50);outline.lineTo(3.80,1.45);outline.lineTo(2.508,1.55);outline.lineTo(1.216,2.825);outline.closePath();
  for(const side of [-1,1]){
   const geom=new T.ShapeGeometry(outline);const pos=geom.getAttribute('position');for(let i=0;i<pos.count;i++){const z=pos.getX(i),y=pos.getY(i);pos.setXYZ(i,side*1.316,y,z);}geom.computeVertexNormals();
   const panel=new T.Mesh(geom,new T.MeshStandardMaterial({color:'#e7e6df',side:T.DoubleSide,roughness:.88}));k.tag(bus,panel,'Sam bus photographed white cab flank',layers.context);
   k.box(bus,'Sam bus photographed yellow lower band',[.025,.28,7.25],[side*1.320,.65,0],'#bdab39',layers.context);
   k.box(bus,'Sam bus forward door glazing',[.018,.65,.48],[side*1.335,1.81,1.54],'#344e58',layers.context);
   k.rod(bus,'Sam bus mirror support',[side*1.30,1.90,1.96],[side*1.62,1.90,2.08],.018,'#454b4a',layers.context);
   k.box(bus,'Sam bus rectangular mirror housing',[.13,.32,.12],[side*1.66,1.90,2.08],'#292e2e',layers.context);
   k.box(bus,'Sam bus mirror reflective face',[.014,.25,.09],[side*1.732,1.90,2.08],'#9dadb0',layers.context);
  }
  const hood=k.box(bus,'Sam bus white hood skin',[2.53,.025,1.30],[0,1.525,3.154],'#e7e6df',layers.context);hood.rotation.x=.0773;
  k.box(bus,'Sam bus rectangular grille',[1.55,.42,.035],[0,1.10,3.817],'#666d69',layers.context);
  for(const x of [-.48,0,.48])k.box(bus,'Sam bus grille slat',[.035,.39,.045],[x,1.1,3.84],'#a1a6a3',layers.context);
 }
 // Lightweight mirrors on the already source-positioned motor vehicles.
 for(const v of k.root.children.filter(o=>/^(?:observed-)?car-/.test(o.userData.assembly_id||''))){
  const body=v.children.find(o=>o.userData.kind==='vehicle body') as T.Mesh|undefined;if(!body)continue;
  body.geometry.computeBoundingBox();const width=body.geometry.boundingBox!.max.x-body.geometry.boundingBox!.min.x;
  for(const side of [-1,1]){
   k.rod(v,'Vehicle side mirror stalk',[side*width/2,1.35,1.2],[side*(width/2+.17),1.35,1.15],.012,'#353c3c',layers.context);
   k.box(v,'Vehicle side mirror housing',[.18,.12,.12],[side*(width/2+.20),1.35,1.15],'#535b58',layers.context);
  }
 }
 // c526/c518/c46525: northeast star/faceted timber pod. Six visible
 // pentagonal plates form the front shell; depth, fold and placement remain
 // fitted. No unseen furnishings or rectangular substitute hut invented.
 const starPod=k.assembly('northeast-star-pod','Northeast · faceted star pod',[24,0,32],.32,'Gene c526 northeast Bodywork-associated living pod; c518/c46525 beside Tool. Visible six-plate star shell, folds35deg and position±4m fitted; rear/interior unobserved.');
 const base=Array.from({length:5},(_,i)=>{const a=-Math.PI/2+i*2*Math.PI/5;return new T.Vector3(.60*Math.cos(a),.60*Math.sin(a),0);});
 const plates=[base];
 for(let i=0;i<5;i++){
  const a=base[i],b=base[(i+1)%5],axis=b.clone().sub(a).normalize();
  plates.push(base.map(p=>{const rel=p.clone().sub(a),reflected=axis.clone().multiplyScalar(2*rel.dot(axis)).sub(rel);return reflected.applyAxisAngle(axis,35*Math.PI/180).add(a);}));
 }
 const low=Math.min(...plates.flat().map(p=>p.y)),rise=GROUND-low;
 const edges=new Set<string>();
 for(const polygon of plates){
  const positions:number[]=[],uvs:number[]=[];
  for(let i=1;i<4;i++)for(const v of [polygon[0],polygon[i],polygon[i+1]]){positions.push(v.x,v.y+rise,v.z);uvs.push(v.x+.5,v.y+.5);}
  const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(positions,3));geo.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));geo.computeVertexNormals();
  const mat=new T.MeshStandardMaterial({color:'#b89b68',roughness:.94,side:T.DoubleSide});const panel=new T.Mesh(geo,mat);k.tag(starPod,panel,'Northeast star pod visible pentagonal plywood plate',layers.wall);
  for(let i=0;i<5;i++){
   const a=polygon[i],b=polygon[(i+1)%5],key=[a,b].map(v=>v.toArray().map(x=>x.toFixed(3)).join(',')).sort().join('|');if(edges.has(key))continue;edges.add(key);
   k.rod(starPod,'Northeast star pod timber plate edge',[a.x,a.y+rise,a.z],[b.x,b.y+rise,b.z],.025,'#896b44',layers.steel);
  }
 }
 for(const side of [-1,1])k.rod(starPod,'Northeast star pod observed diagonal prop',[side*1.8,GROUND,.3],[side*1.05,1.1,-.25],.045,'#9d7f53',layers.steel);
 k.box(starPod,'Northeast star pod low access panel',[.65,.55,.025],[0,GROUND+.28,.035],'#bba779',layers.wall).userData.source='c526 lower pale access panel; crawl-sized silhouette fitted; hidden access geometry unresolved';
 // c518: one visible IBC beside Tool Camp's northwest end. Tank and metal
 // cage are simple shared shapes; do not invent a regular grid of tanks.
 const ibc=k.assembly('tool-2025-observed-ibc','Tool Camp · observed IBC',[0,0,0],0,'c518 visible caged white tank beside west front; fitted position and standard approximate1m vessel size.');tool.add(ibc);ibc.position.set(-6.70,0,-3.95);
 k.box(ibc,'Tool white IBC tank',[1.05,1.02,1.05],[0,GROUND+.61,0],'#dddeda',layers.context);
 k.box(ibc,'Tool IBC dark pallet',[1.18,.14,1.18],[0,GROUND+.07,0],'#434b46',layers.context);
 for(const side of [-1,1])for(let j=0;j<5;j++){
  const u=-.54+j*.27;
  k.rod(ibc,'Tool IBC cage vertical',[u,GROUND+.14,side*.56],[u,GROUND+1.14,side*.56],.009,'#979f9d',layers.context);
  k.rod(ibc,'Tool IBC cage vertical',[side*.56,GROUND+.14,u],[side*.56,GROUND+1.14,u],.009,'#979f9d',layers.context);
 }
 for(const y of [.35,.65,.95])for(const side of [-1,1]){
  k.rod(ibc,'Tool IBC cage horizontal',[-.56,GROUND+y,side*.56],[.56,GROUND+y,side*.56],.009,'#979f9d',layers.context);
  k.rod(ibc,'Tool IBC cage horizontal',[side*.56,GROUND+y,-.56],[side*.56,GROUND+y,.56],.009,'#979f9d',layers.context);
 }

}
