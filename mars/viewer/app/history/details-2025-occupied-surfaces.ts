import * as T from 'three';
import {Kit,BAY,layers,slug} from './kit';

/** October1 source corrections. Called after preserved Sept30 details.
 * New pieces carry year-specific kinds; existing component placements remain.
 * Photograph dates are capture dates only where independently established. */
export function add2025OccupiedSurfaces(k:Kit,chiba:T.Group,free:T.Group,body:T.Group,tool:T.Group){
 const add=(g:T.Object3D,name:string,size:[number,number,number],at:[number,number,number],color:string,source:string,layer:string=layers.detail)=>{
  const m=k.box(g,name,size,at,color,layer);m.userData.source=source;return m;
 };
 // Exterior photographs are DoubleSide materials: the model previously exposed
 // the north eye mural inside the auditorium. c72606 shows unpainted plywood.
 // A physical inner skin blocks those pixels without introducing another floor.
 const inside='c72606 Feb1 occupied auditorium: blank inner north plywood, unlike exterior c72594 eye mural; sheet joints and nominal rack coordinates fitted.';
 add(chiba,'2025 auditorium north interior plywood',[3*BAY-.14,4.48,.025],[0,2.36,-1.5*BAY+.070],'#b99b75',inside,layers.wall);
 for(const y of [1.22,2.44,3.66])add(chiba,'2025 auditorium inner plywood sheet joint',[3*BAY-.16,.012,.005],[0,y,-1.5*BAY+.086],'#9a815f',inside);
 // c45838: fabric covers the left long wall and the far lower wall; preserve
 // the visible high daylight openings. Simple cloth geometry carries sag only.
 const clothSource='c45838 occupied Bodywork interior: green hanging long-wall cloth and lower end-wall cloth. Extents/transform fitted; no claim of hidden faces.';
 add(body,'2025 Bodywork long-wall green fabric',[.018,1.87,2*BAY-.45],[-2*BAY+.10,1.34,0],'#647970',clothSource).userData.walkNoCollision=true;
 add(body,'2025 Bodywork right end green fabric',[2.5,1.30,.018],[3.6,.96,-BAY+.112],'#667c73',clothSource).userData.walkNoCollision=true;
 const living=free.children.find(o=>o.userData.assembly_id==='cafe');
 if(living){
  const src='c45110 occupied Libaby photograph: wooden book/game shelf, dark upholstered chair, loose books, hanging bulbs and small metal alien figure. Coordinates and dimensions fitted; upload date not capture date.';
  const sign=new T.Mesh(new T.PlaneGeometry(.50,.50),k.photo('/history/2025/occupied-20261001/libaby-sign.webp'));sign.rotation.y=-Math.PI/2;sign.position.set(BAY/2-.08,1.88,1.10);k.tag(living,sign,'2025 Libaby actual photographed sign',layers.detail);sign.userData.source=src+' Native sign quadrilateral from c45110(1379,177)(1369,356)(1557,342)(1556,168), generated preview coordinates; position fitted.';sign.userData.walkNoCollision=true;
  const warm=new T.MeshStandardMaterial({color:'#f4e8c3',emissive:'#ffce8b',emissiveIntensity:.4});
  for(const x of [-1.4,1.4]){
   k.rod(living,'2025 Libaby occupied ceiling string',[x,2.31,-3],[x,2.31,3],.004,'#484c42',layers.detail).userData.walkNoCollision=true;
   for(let i=0;i<6;i++){const bulb=new T.Mesh(new T.SphereGeometry(.034,8,6),warm);bulb.position.set(x,2.20,-2.6+i*1.04);k.tag(living,bulb,'2025 Libaby occupied hanging bulb',layers.detail);bulb.userData.walkNoCollision=true;bulb.userData.source=src;}
  }
  // Shelf close to the room wall keeps the central/partition passages clear.
  add(living,'2025 Libaby bookshelf side',[.055,1.06,.34],[1.46,.79,1.36],'#a18358',src);
  add(living,'2025 Libaby bookshelf side',[.055,1.06,.34],[.55,.79,1.36],'#a18358',src);
  for(const y of [.30,.66,1.02,1.30])add(living,'2025 Libaby bookshelf shelf',[.97,.045,.34],[1.005,y,1.36],'#b49364',src);
  for(let level=0;level<2;level++)for(let i=0;i<8;i++){
   const book=add(living,'2025 Libaby observed book spine',[.067,.24+(i%3)*.025,.22],[.64+i*.10,.44+level*.36,1.39],['#425661','#b7ac84','#616b45','#86594c'][i%4],src);book.rotation.z=(i%3-1)*.035;
  }
  for(let i=0;i<3;i++)add(living,'2025 Libaby board game box',[.47,.06,.28],[.91,1.35+i*.06,1.36],['#ad9a76','#843e3a','#b2aa86'][i],src);
  // Source shelf follows the room's side wall; keep it beyond the retained
  // table footprint rather than intersecting its rear edge.
  const shelfGroup=k.assembly('libaby-2025-bookcase','Libaby · observed bookcase',[0,0,0],0,src);living.add(shelfGroup);shelfGroup.position.set(1.59,0,1.60);shelfGroup.rotation.y=-Math.PI/2;
  for(const o of living.children.slice())if(/2025 Libaby (?:bookshelf|observed book spine|board game box)/.test(o.userData.kind||'')){o.position.x-=1.005;o.position.z-=1.36;o.userData.assembly_id=shelfGroup.userData.assembly_id;shelfGroup.add(o);}
  const cx=.85,cz=-2.45;
  add(living,'2025 Libaby dark armchair seat',[.76,.18,.74],[cx,.54,cz],'#40465d',src);
  add(living,'2025 Libaby dark armchair back',[.76,.67,.16],[cx,.91,cz-.30],'#45485f',src);
  for(const side of [-1,1])add(living,'2025 Libaby dark armchair arm',[.15,.29,.76],[cx+side*.35,.72,cz],'#40465d',src);
  for(const side of [-1,1])for(const end of [-1,1])add(living,'2025 Libaby dark armchair foot',[.07,.22,.07],[cx+side*.29,.34,cz+end*.27],'#625643',src);
  // Photo figure is a slender metallic humanoid; simplified silhouette avoids
  // inventing its exact fabrication or detailed facial features.
  const figure=k.assembly('libaby-2025-observed-metal-figure','Libaby · photographed metal figure',[0,0,0],0,src);living.add(figure);figure.position.set(-.45,.57,-2.48);
  const head=new T.Mesh(new T.SphereGeometry(.10,8,6),k.mat('#939d95',.65));head.scale.set(.8,1.3,.75);head.position.y=.48;k.tag(figure,head,'2025 Libaby metal figure head',layers.detail);
  const torso=new T.Mesh(new T.SphereGeometry(.09,8,6),k.mat('#939d95',.65));torso.scale.set(.85,1.45,.7);torso.position.y=.27;k.tag(figure,torso,'2025 Libaby metal figure torso',layers.detail);
  for(const side of [-1,1]){
   k.rod(figure,'2025 Libaby metal figure arm',[side*.06,.34,0],[side*.13,.17,.02],.012,'#939d95',layers.detail);
   k.rod(figure,'2025 Libaby metal figure leg',[side*.045,.18,0],[side*.05,0,.03],.014,'#939d95',layers.detail);
  }
 }
 const centralSource='c46124 occupied Freeside central rear: floral upholstered sofa beneath round wooden motif. Width/depth and placement fitted to rear opening; no occupant recreation.';
 add(free,'2025 Freeside central rear floral sofa seat',[1.75,.24,.76],[-.83,.61,-2.99],'#d8cfb5',centralSource);
 add(free,'2025 Freeside central rear floral sofa back',[1.75,.61,.16],[-.83,.91,-3.28],'#d8cfb5',centralSource);
 for(const side of [-1,1])add(free,'2025 Freeside central sofa upholstered arm',[.16,.38,.77],[-.83+side*.80,.77,-2.99],'#d8cfb5',centralSource);
 for(const x of [-1.47,-.19])for(const z of [-3.25,-2.73])add(free,'2025 Freeside central sofa foot',[.09,.26,.09],[x,.36,z],'#816346',centralSource);
 const sofaMaterial=(k.photo('/history/2025/occupied-20261001/central-sofa-floral.webp') as T.MeshStandardMaterial).clone();
 sofaMaterial.map=sofaMaterial.map!.clone();sofaMaterial.map.wrapS=sofaMaterial.map.wrapT=T.RepeatWrapping;sofaMaterial.map.repeat.set(4,2);sofaMaterial.map.needsUpdate=true;
 for(const o of free.children)if(o instanceof T.Mesh&&/2025 Freeside central (?:rear floral sofa|sofa upholstered)/.test(o.userData.kind)){o.material=sofaMaterial;o.userData.source+='; c46124 unobscured fabric crop(210,1120)-(300,1230), repeated fitted textile scale';}
 const kitchen=free.children.find(o=>o.userData.assembly_id==='kitchen-interior');
 if(kitchen){
  const src='c44533/c44541 occupied kitchen: olive green two-door pantry cupboard, narrow jar shelf, adjacent tall salvaged glazed partition. Cabinet coordinates fitted; do not infer cardboard-covered glass as painted wall.';
  const cx=-.55,cz=-2.90;
  const fridgeSource='c44576 occupied daylight kitchen: two separate white refrigerator cabinets along back; nominal size and fit beside retained first refrigerator, not exact model.';
  add(kitchen,'2025 Freeside second white refrigerator',[.70,1.67,.68],[.46,1.09,-3.12],'#d9dbd3',fridgeSource);
  add(kitchen,'2025 Freeside second freezer seam',[.69,.012,.018],[.46,1.52,-2.771],'#727b75',fridgeSource);
  for(const y of [1.11,1.69])add(kitchen,'2025 Freeside second refrigerator handle',[.035,.20,.035],[.19,y,-2.757],'#747c73',fridgeSource);
  add(kitchen,'2025 Freeside green pantry cupboard',[.94,1.56,.39],[cx,1.10,cz],'#6e7964',src);
  for(const side of [-1,1]){
   add(kitchen,'2025 Freeside pantry door',[.449,1.48,.022],[cx+side*.231,1.12,cz+.207],'#737d68',src);
   add(kitchen,'2025 Freeside pantry door handle',[.027,.16,.035],[cx+side*.07,1.14,cz+.233],'#b6b69d',src);
  }
  for(const y of [.72,1.18,1.65])add(kitchen,'2025 Freeside pantry side jar shelf',[.50,.044,.30],[cx+.73,y,cz],'#9a7f5d',src);
  for(let level=0;level<3;level++)for(let j=0;j<3;j++)add(kitchen,'2025 Freeside pantry side jar',[.10,.18,.10],[cx+.57+j*.15,.835+level*.465,cz],['#c1ac7c','#6c7467','#ae9479'][j],src);
 }
 // Open the observed workshop window through the existing component rather
 // than overlaying transparent pixels on its solid plywood. The chosen model
 // flank follows the already fitted machine-line side, not a surveyed bearing.
 const toolWall=tool.children.find(o=>o instanceof T.Mesh&&o.userData.kind==='plywood wall'&&Math.abs(o.position.x+1.5*BAY)<.02&&Math.abs(o.position.y-1.34)<.02) as T.Mesh|undefined;
 if(toolWall){
  const width=8.5344,height=2.24,cx=-1.10,cy=.40,ww=1.92,hh=1.10;
  const shape=new T.Shape();shape.moveTo(-width/2,-height/2);shape.lineTo(width/2,-height/2);shape.lineTo(width/2,height/2);shape.lineTo(-width/2,height/2);shape.closePath();
  const hole=new T.Path();hole.moveTo(cx-ww/2,cy-hh/2);hole.lineTo(cx-ww/2,cy+hh/2);hole.lineTo(cx+ww/2,cy+hh/2);hole.lineTo(cx+ww/2,cy-hh/2);hole.closePath();shape.holes.push(hole);
  const geometry=new T.ExtrudeGeometry(shape,{depth:.055,bevelEnabled:false});geometry.translate(0,0,-.0275);toolWall.geometry=geometry;
  toolWall.userData.source+='; c534: large ground workshop window behind machine bench;1.92×1.10m and model flank fitted';
  const glazing=add(tool,'2025 Tool workshop actual ground window',[.026,hh,ww],[-1.5*BAY-.008,1.74,1.10],'#b5c3bb',toolWall.userData.source,layers.wall);
  glazing.material=new T.MeshStandardMaterial({color:'#b5c3bb',transparent:true,opacity:.20,roughness:.35,side:T.DoubleSide}); // Source window is glazed: transparent sightline, physical walking boundary.
  for(const z of [1.10-ww/2,1.10+ww/2])add(tool,'2025 Tool workshop window frame',[.07,hh+.09,.055],[-1.5*BAY-.024,1.74,z],'#d6ceb8',toolWall.userData.source,layers.wall);
  for(const y of [1.74-hh/2,1.74+hh/2])add(tool,'2025 Tool workshop window frame',[.07,.055,ww+.09],[-1.5*BAY-.024,y,1.10],'#d6ceb8',toolWall.userData.source,layers.wall);
 }
 // c518 exposed canopy shows a timber base perimeter; later c46525 retains
 // it under the occupied tables. It is independent of the black roof shade.
 const canopy=k.root.children.find(o=>o.userData.assembly_id==='solar-sam-scissor');
 if(canopy)for(let i=0;i<8;i++){
  const a=Math.PI/8+i*Math.PI/4,b=Math.PI/8+(i+1)*Math.PI/4;
  const start=new T.Vector3(3.6*Math.cos(a),-.12,3.6*Math.sin(a)),end=new T.Vector3(3.6*Math.cos(b),-.12,3.6*Math.sin(b)),delta=end.clone().sub(start);
  const bar=add(canopy,'2025 Scissor observed base timber',[.09,delta.length(),.065],start.clone().add(end).multiplyScalar(.5).toArray() as [number,number,number],'#bb9863','c518 exposed octagonal canopy base timber links; c46525 occupied tables and roof shade. Existing nominal7.2m footprint retained; joint/hardware details fitted.',layers.steel);bar.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),delta.normalize());
 }
 // c564 resolves blue as the roof belt and the glazing as a broad black
 // flank, with white lower passenger body. Retain the old blue base/IDs under
 // the observed livery skins. Opposite-side repetition is explicitly fitted.
 const sam=k.root.children.find(o=>o.userData.assembly_id==='rv-10');
 if(sam){
  // Combined geometry found only0.24m between the complete bus envelope and
  // Tool Camp. Shift0.28m toward the workshop's local west (same parking axis).
  sam.position.x-=.28*Math.cos(tool.rotation.y);sam.position.z+=.28*Math.sin(tool.rotation.y);
  sam.userData.source+='; October1 integrated actual-envelope clearance: original fitted center(2.6,40.6) shifted0.28m workshop-local west to(2.3342140829,40.6880786370), retaining heading/class/IDs; nominal clearance fit, not surveyed parking';
  sam.rotation.y=.32+Math.PI; // same fitted long axis; c564 cab faces courtyard/IBC rather than the rear field
  sam.userData.source+='; c564 cab/front end faces Chiba courtyard and observed IBC; bearing remains fitted';
  const src='c564 occupied courtyard: Sam bus white lower passenger body, blue roof belt, broad black glazing and yellow lower accent; side panel/window proportions fitted, opposite-side repetition inferred.';
  for(const side of [-1,1]){
   add(sam,'2025 Sam bus white passenger flank',[.022,.78,5.16],[side*1.344,1.16,-1.24],'#e5e6de',src,layers.context);
   add(sam,'2025 Sam bus broad black passenger glazing',[.024,.84,5.16],[side*1.346,2.045,-1.24],'#26312f',src,layers.context);
   add(sam,'2025 Sam bus blue roof belt',[.026,.12,5.16],[side*1.346,2.51,-1.24],'#3473a2',src,layers.context);
  }
 }
 // Combined occupied view exposed the formerly fitted background van inside
 // the dojo. Keep its census owner/geometry, move it outside the rear flank.
 // This is a clearance fit, not a new photographic coordinate claim.
 const bodyVan=k.root.children.find(o=>o.userData.assembly_id==='observed-car-9');
 if(bodyVan){bodyVan.position.copy(new T.Vector3(.23,0,-7).applyEuler(body.rotation).add(body.position));bodyVan.userData.source+='; October1 occupied combined view: old fitted coordinate intersected Bodywork. Rear-flank position refitted to clear whole van from nominal shell; actual survey coordinate unavailable';}
 // Two other census fits grazed the same shell. Their class/heading stays;
 // only the bounded clearance coordinate changes, without a survey claim.
 for(const [id,axis,value] of [['observed-car-8','x',-10.4],['observed-car-10','z',-6.35]] as const){const v=k.root.children.find(o=>o.userData.assembly_id===id);if(!v)continue;const local=v.position.clone().sub(body.position).applyEuler(new T.Euler(0,-body.rotation.y,0));local[axis]=value;v.position.copy(local.applyEuler(body.rotation).add(body.position));v.userData.source+='; October1 whole-vehicle clearance fit outside Bodywork shell; surveyed location unavailable';}
 const toolWestSource='c564 occupied courtyard: red, pale and brown upper patchwork panels on Tool face beside Sam bus; native crop(5844,2734)-(6455,2818). Assignment to fitted machine-line west flank and height/width provisional; no transparent center strip visible on this photographed face.';
 const oldWestWindow=tool.children.find(o=>o.userData.kind==='Tool Camp upper window strip'&&o.position.x<0);
 if(oldWestWindow){oldWestWindow.visible=false;oldWestWindow.userData.walkNoCollision=true;oldWestWindow.userData.source+='; hidden on this fitted flank after c564 occupied panel evidence; ID preserved';}
 add(tool,'2025 Tool completed west upper infill',[.038,.56,3.4],[-1.5*BAY,3.55,0],'#ae9064',toolWestSource,layers.wall);
 const patchwork=new T.Mesh(new T.PlaneGeometry(8.48,1.28),k.photo('/history/2025/occupied-20261001/tool-upper-native.webp'));patchwork.rotation.y=-Math.PI/2;patchwork.position.set(-1.5*BAY-.078,4.06,0);k.tag(tool,patchwork,'2025 Tool native completed upper patchwork',layers.wall);patchwork.userData.source=toolWestSource;patchwork.userData.walkNoCollision=true;
 const machineSource='c534/DSCF7600 Tool workshop: twin green compressor reservoirs and yellow coiled hose below machine bench; caster wheels and linear lights visible. Positions/sizes fitted.';
 for(const z of [-1.65,-1.28]){
  const tank=new T.Mesh(new T.CylinderGeometry(.15,.15,.47,12),k.mat('#718969'));tank.rotation.x=Math.PI/2;tank.position.set(-4.5,.43,z);k.tag(tool,tank,'2025 Tool compressor green reservoir',layers.detail);tank.userData.source=machineSource;
 }
 add(tool,'2025 Tool compressor motor',[.33,.21,.26],[-4.5,.69,-1.48],'#465451',machineSource);
 const helix:T.Vector3[]=Array.from({length:81},(_,i)=>{const t=i/80,a=t*10*Math.PI;return new T.Vector3(-4.50+.17*Math.cos(a),.44+.17*Math.sin(a),-1.13+t*.72);});
 const hose=new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(helix),80,.012,4,false),k.mat('#d8bb3c'));k.tag(tool,hose,'2025 Tool compressor yellow coil hose',layers.detail);hose.userData.source=machineSource;hose.userData.walkNoCollision=true;
 for(const x of [-3.30,-2.0])for(const z of [-.96,1.26]){
  const wheel=new T.Mesh(new T.CylinderGeometry(.055,.055,.038,8),k.mat('#7b5148'));wheel.rotation.z=Math.PI/2;wheel.position.set(x,.29,z);k.tag(tool,wheel,'2025 Tool central bench caster',layers.detail);wheel.userData.source=machineSource;
 }
 for(const x of [-BAY,BAY])add(tool,'2025 Tool linear ceiling light',[2.4,.022,.08],[x,2.34,-.6],'#e9eadb',machineSource);
 // c72606 occupied Chiba and c534 Tool show weathered blue/navy-grey
 // rack steel. Preserve Bodywork's independently source-matched blue finish.
 k.root.traverse(o=>{if(!(o instanceof T.Mesh)||o.userData.assembly_id==='bodywork-dojo')return;if(/^(?:rack upright|upright bracing|rack diagonal brace|front terrace rack upright|front terrace end (?:horizontal tie|diagonal)|stair rack upright|stair rack end diagonal)$/.test(o.userData.kind||'')){o.material=k.mat('#4d6274',.55);o.userData.source=(o.userData.source||'')+'; c72606/c534 occupied2025 weathered blue/navy-grey rack finish, nominal color under neutral viewer lighting';}});
 // Pin all newly added details to explicit semantic names. Later photo-fitting
 // can adjust geometry/placement without changing their persisted identity.
 const names=new Map<string,number>();
 k.root.traverse(o=>{const kind=String(o.userData.kind||'');if(!kind.startsWith('2025 '))return;const key=String(o.userData.assembly_id)+'|'+kind,n=(names.get(key)||0)+1;names.set(key,n);k.named(o,slug(kind)+'-'+String(n).padStart(2,'0'));});

}
