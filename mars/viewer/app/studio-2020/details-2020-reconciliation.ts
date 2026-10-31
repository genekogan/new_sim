import * as T from 'three';
import {GROUND} from '../studio/ambience-math';
import {photoTexture} from '../history/archive-photos';
const BAY=3.6576;
/** March2020 source reconciliations. Pin original identities before any fitting.
 * beforeDetails callback belongs to the historical dispatcher; standalone also works. */
export function add2020ReconciliationDetails(root:T.Group){
 root.traverse(o=>{const a=String(o.userData.assembly_id??''),id=String(o.userData.component_id??'');if(a&&id.startsWith(a+'-'))o.userData.named_id=id.slice(a.length+1);});
 const group=(id:string)=>root.children.find(g=>g.userData.id===id)!;
 const mat=(color:string)=>new T.MeshStandardMaterial({color,roughness:.88});
 const plywood=mat('#b39470'),navy=mat('#273747'),dark=mat('#273036'),white=mat('#d4d4cb'),red=mat('#c24237'),glass=mat('#324d59');
 const name=(o:T.Object3D,id:string)=>{o.name=id;o.userData.named_id='2020-'+id.toLowerCase().replace(/[^a-z0-9]+/g,'-');return o;};
 const box=(g:T.Object3D,id:string,size:[number,number,number],p:[number,number,number],m:T.Material=plywood)=>{const o=new T.Mesh(new T.BoxGeometry(...size),m);o.position.set(...p);o.castShadow=true;o.receiveShadow=true;g.add(o);name(o,id);return o;};
 const plane=(g:T.Object3D,id:string,w:number,h:number,p:[number,number,number],url:string,ry=0)=>{const map=photoTexture(url);map.colorSpace=T.SRGBColorSpace;const o=new T.Mesh(new T.PlaneGeometry(w,h),new T.MeshBasicMaterial({map,side:T.DoubleSide}));o.position.set(...p);o.rotation.y=ry;g.add(o);name(o,id);return o;};
 const all=(g:T.Object3D,n:string)=>{const a:T.Mesh[]=[];g.traverse(o=>{if(o instanceof T.Mesh&&o.name===n)a.push(o);});return a;};
 const hide=(o:T.Object3D,why:string)=>{o.visible=false;o.userData.walkNoCollision=true;o.userData.sourceQuarantine=why;};
 const portal=group('portal');
 // Mar17 9s: center is one continuous roof at the stair-run top; higher steel is guard framing.
 all(portal,'raised center rooftop deck').forEach(o=>o.position.y=2.49);
 all(portal,'dark ceiling above the TV aisle').forEach(o=>hide(o,'Duplicate roof slab after source-level correction; ID retained'));
 [...all(portal,'raised center cross beam'),...all(portal,'raised center length beam')].forEach(o=>o.position.y=2.42);
 for(const o of all(portal,'rack upright')){const h=Math.abs(o.position.x)<BAY?3.6576:3.06;o.scale.y=h/(o.geometry as T.BoxGeometry).parameters.height;o.position.y=h/2;o.material=navy;}
 for(const o of [...all(portal,'upright diagonal'),...all(portal,'upright crossbar')]){o.material=navy;if(o.position.y>3.02&&(Math.abs(o.position.x)>BAY||o.position.y>3.65))hide(o,'Original excess brace above dated frame fit');}
 // Climbing face is flush with outer 10ft frame. The earlier four-metre face exceeded it.
 for(const o of all(portal,'4 ft plywood climbing sheet')){const upper=o.position.y>2;o.scale.y=upper?1.01/1.85:1;o.position.y=upper?2.59:1.055;}
 for(const o of [...all(portal,'climbing hold'),...all(portal,'route tape tag')])if(o.position.y>2.96)o.position.y=2.96-(o.position.y-2.96)*.65;
 // Mar17 frontal9/32s: FIVE visible broad levels above ground in each side bay.
 // Retain seven original owners, quarantine the two surplus treads/risers per side.
 for(const side of [-1,1]){
  const ts=all(portal,'side stair plywood tread').filter(o=>Math.sign(o.position.x)===side).sort((a,b)=>b.position.z-a.position.z);
  const rs=all(portal,'side stair timber riser').filter(o=>Math.sign(o.position.x)===side).sort((a,b)=>b.position.z-a.position.z),run=2*BAY/5;
  for(let i=0;i<7;i++){if(i>=5){hide(ts[i],'Five visible source levels; surplus fitted tread ID retained');hide(rs[i],'Surplus fitted riser ID retained');continue;}
   const top=.9+i*.4,z=BAY-(i+.5)*run;ts[i].position.set(side*BAY,top-.035,z);ts[i].scale.z=(run-.018)/(2*BAY/7-.018);rs[i].position.set(side*BAY,top-.2,z+run/2-.035);rs[i].scale.y=.382/(2.22/7-.018);
  }
 }
 // Retain native twelve-screen source crops. Photograph shows black rows mounted to open steel.
 for(const s of [-1,1])for(const y of [.48,1.07,1.66,2.25])box(portal,`screen rail ${s<0?'left':'right'} ${y}`,[.045,.055,6.8],[s*(BAY/2-.15),y,0],navy);
 box(portal,'left pink sofa seat',[2.45,.32,.80],[-BAY,.4375,2.42],mat('#ca719b'));
 box(portal,'left pink sofa back',[2.45,.65,.17],[-BAY,.8825,2.05],mat('#bf6591'));
 box(portal,'right fuchsia foam cube',[1.45,.50,.78],[BAY,.5275,2.9],mat('#b33d80'));
 box(portal,'orange white foam chair base',[1.1,.14,.85],[-BAY,.3475,1.16],mat('#dc6d39'));
 box(portal,'orange white foam chair cushion',[.96,.48,.72],[-BAY,.6575,1.16],white);
 // Upper center perimeter: wood guards observed Mar17, station and cross-section fitted.
 for(const s of [-1,1]){box(portal,`roof timber guard ${s<0?'left':'right'}`,[.055,.065,5.7],[s*1.65,3.34,0]);for(let j=0;j<8;j++)box(portal,`guard post ${s<0?'left':'right'} ${j}`,[.055,.82,.055],[s*1.65,2.935,-2.66+j*.76]);}
 const container=group('container');
 const flower=all(container,'magenta flower end mural')[0];if(flower){const map=photoTexture('/history/2020/2020-container-flower.webp');map.colorSpace=T.SRGBColorSpace;flower.material=new T.MeshBasicMaterial({map,side:T.DoubleSide});}
 // DJI_0108/DJI_0112: eight small panels, paired in four stations, propped above roof.
 const panels=all(container,'solar panel'),frames=all(container,'solar panel frame');
 for(let i=0;i<8;i++){const x=-2.15+Math.floor(i/2)*1.4,z=(i%2?1:-1)*.62;const o=panels[i]??box(container,`extra solar panel ${i}`,[1.12,.015,.63],[x,2.86,z],dark);o.position.set(x,2.76,z);o.scale.set(panels.includes(o)?1.12/1.22:1,1,panels.includes(o)?.63/.68:1);o.rotation.x=-.28;const frame=frames[i]??box(container,`extra solar frame ${i}`,[1.20,.045,.69],[x,2.755,z],navy);frame.position.set(x,2.755,z);frame.scale.set(frames.includes(frame)?1.20/1.3:1,1,frames.includes(frame)?.69/.76:1);frame.rotation.x=-.28;
  for(let j=0;j<7;j++)box(container,`solar cell row ${i} ${j}`,[.008,.004,.59],[x-.49+j*.163,2.897,z],white).rotation.x=-.28;
  const foot=2.635,top=2.76+.23*Math.sin(.28)-.0075*Math.cos(.28);
  box(container,`solar prop ${i}`,[.8,top-foot,.035],[x,(top+foot)/2,z+.23],dark);
 }
 // Mar17 3s: wrapped water reservoir alongside flower end, not an invented IBC cage.
 const tank=new T.Mesh(new T.CylinderGeometry(.54,.54,2.14,12),white);tank.position.set(3.12,GROUND+1.07,-1.77);container.add(tank);name(tank,'wrapped cylindrical water reservoir');
 // Mar17 workshop16s: opposite side shelf/counter, central tables, jugs and stove.
 const canopy=group('canopy');
 box(canopy,'container side work counter',[.72,.065,5.25],[-3.23,.94,.0]);
 for(const z of [-2.1,0,2.1])box(canopy,`side counter support ${z<0?'rear':z>0?'front':'middle'}`,[.065,.7675,.065],[-3.23,.52375,z],navy);
 box(canopy,'second central worktable',[2,.075,.85],[.05,.86,-.65]);
 for(const x of [-.72,.82])for(const z of [-.96,-.34])box(canopy,`second table leg ${x<0?'left':'right'} ${z<-.5?'rear':'front'}`,[.07,.6825,.07],[x,.48125,z]);
 const griddle=all(canopy,'flat cooking griddle')[0];if(griddle)griddle.material=red;
 for(let j=0;j<4;j++)box(canopy,`griddle knob ${j}`,[.10,.10,.04],[-2.2+j*.23,.975,-2.24],dark);
 for(let i=0;i<6;i++){box(canopy,`water supply jug ${i}`,[.21,.37,.23],[2.03,.325,-2.12+i*.64],white);box(canopy,`jug cap ${i}`,[.07,.04,.07],[2.03,.53,-2.12+i*.64],red);}
 for(let i=0;i<3;i++)box(canopy,`workstation monitor ${i}`,[.025,.35,.49],[-3.16,1.15,-1.7+i*1.5],dark);
 const bottle=new T.Mesh(new T.CylinderGeometry(.16,.17,.48,8),white);bottle.position.set(-1.8,.38,-2.38);canopy.add(bottle);name(bottle,'griddle propane cylinder');
 // MCDA: source shows a real service opening and an upper loft, not opaque black painted void.
 const mcda=group('mcda');all(mcda,'serving window void').forEach(o=>hide(o,'Real aperture replacing solid black filler'));
 const front=all(mcda,'MCDA plywood wall').find(o=>o.position.z>0);if(front){hide(front,'Opening cut into facade, original owner retained');box(mcda,'front wall below opening',[3.4,.925,.055],[0,.5625,1.52]);box(mcda,'front wall above opening',[3.4,.615,.055],[0,2.3825,1.52]);box(mcda,'front wall left jamb',[1.355,1.05,.055],[-1.0225,1.55,1.52]);box(mcda,'front wall right jamb',[.595,1.05,.055],[1.4025,1.55,1.52]);}
 all(mcda,'painted MCDA wall').forEach(o=>hide(o,'Synthetic random graffiti unsupported; only photographed visible strip reproduced'));
 plane(mcda,'native MCDA visible painted strip',.70,2.55,[-1.723,1.39,.96],'/history/2020/2020-mcda-visible-painted-strip.webp',-Math.PI/2);
 box(mcda,'MCDA backbar bottle shelf',[2.6,.075,.38],[0,.8875,-1.2]);
 for(const x of [-1.14,1.14])box(mcda,`MCDA backbar leg ${x<0?'left':'right'}`,[.065,.685,.065],[x,.5075,-1.2]);
 box(mcda,'MCDA upper loft shelf',[3.18,.075,1.1],[0,1.92,-.91]);
 for(let i=0;i<5;i++)box(mcda,`MCDA backbar shelf bottle ${i}`,[.09,.23,.09],[-.82+i*.28,1.04,-1.2],i%2?white:glass);
 // Feb24–25 the dated tesseract; Mar9 aerial193s shows its separate wood lattice.
 const tess=new T.Group();tess.position.set(6,0,25);tess.userData={id:'2020-tesseract',title:'Timber tesseract',confidence:'medium',source:'a 2020 resident blog Feb24–25; DJI_0094 Mar9 193s; location and2.4m size fitted'};root.add(tess);
 for(const level of [GROUND+.045,GROUND+2.4])for(const q of [-1,1]){box(tess,`tesseract horizontal x ${level<1?'low':'high'} ${q<0?'back':'front'}`,[2.4,.075,.075],[0,level,q*1.2]);box(tess,`tesseract horizontal z ${level<1?'low':'high'} ${q<0?'left':'right'}`,[.075,.075,2.4],[q*1.2,level,0]);}
 for(const x of [-1.2,1.2])for(const z of [-1.2,1.2])box(tess,`tesseract corner ${x<0?'left':'right'} ${z<0?'rear':'front'}`,[.075,2.4,.075],[x,GROUND+1.2,z]);
 // C05A4576 shows diagonal corner braces and two small timber polyhedra,
 // rather than an invented inner cube. Wire edges retain the source's open character.
 for(const x of [-1.2,1.2])for(const z of [-1.2,1.2])for(const high of [false,true]){
  const a=new T.Vector3(x,GROUND+(high?2.4:0),z),b=new T.Vector3(x*.55,GROUND+(high?1.92:.48),z),delta=b.clone().sub(a);
  const o=new T.Mesh(new T.CylinderGeometry(.025,.025,delta.length(),5),plywood);o.position.copy(a).add(b).multiplyScalar(.5);o.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),delta.normalize());tess.add(o);name(o,`wood corner brace ${x<0?'left':'right'} ${z<0?'rear':'front'} ${high?'high':'low'}`);
 }
 for(const [label,p] of [['hanging',[0,1.05,0]],['ground',[1.35,GROUND+.47,1.15]]] as const){const geo=new T.IcosahedronGeometry(.47,0);const o=new T.LineSegments(new T.EdgesGeometry(geo),new T.LineBasicMaterial({color:'#b39470'}));geo.dispose();o.position.set(p[0],p[1],p[2]);tess.add(o);o.name='2020 timber polyhedron '+label;}
 // Original RV owners retain identities. Visible campsite has two travel trailers and four motorhomes.
 const vehicleKind=['small travel trailer','black stripe motorhome','blue painted motorhome','white motorhome','Puma travel trailer','white motorhome'];
 for(let i=1;i<=6;i++){const g=group('rv-'+i);g.userData.sourceVehicleType=vehicleKind[i-1];const shell=all(g,'vehicle shell')[0],length=(shell.geometry as T.BoxGeometry).parameters.width;
  if(i===1||i===5){all(g,'front windscreen').forEach(o=>hide(o,'Travel trailer has no driving windshield'));box(g,'travel trailer A frame tongue',[.85,.09,.66],[length/2+.43,.41,0],dark);box(g,'travel trailer jack',[.06,.57,.06],[length/2+.67,.296,0],dark);}
  else for(const s of [-1,1])box(g,`motorhome mirror ${s<0?'left':'right'}`,[.16,.30,.12],[length/2-.3,1.98,s*1.30],dark);
  box(g,'RV roof air conditioner',[.71,.24,.75],[0,2.74,0],white);
  for(const s of [-1,1]){box(g,`RV side trim ${s<0?'left':'right'}`,[length-.07,.095,.027],[0,1.05,s*1.142],i===2?dark:glass);box(g,`RV entry door ${s<0?'left':'right'}`,[.62,1.58,.025],[length*.17,1.43,s*1.155],white);}
  for(const end of [-1,1]){box(g,`RV bumper ${end<0?'rear':'front'}`,[.12,.16,2.12],[end*(length/2+.08),.57,0],dark);for(const s of [-1,1])box(g,`RV light ${end<0?'rear':'front'} ${s<0?'left':'right'}`,[.035,.12,.23],[end*(length/2+.15),.78,s*.87],end<0?red:white);}
  if(i===2)for(const s of [-1,1])box(g,`black motorhome window band ${s<0?'left':'right'}`,[length-.15,.48,.022],[0,1.92,s*1.153],dark);
  if(i===5){plane(g,'Puma native upper front',2.18,.91,[length/2+.091,1.94,0],'/history/2020/2020-puma-upper-front.webp',Math.PI/2);for(const q of [-1,1]){const tank=new T.Mesh(new T.CylinderGeometry(.17,.17,.48,8),white);tank.position.set(length/2+.36,.695,q*.21);g.add(tank);name(tank,`Puma propane ${q<0?'left':'right'}`);}}
  if(i===3)plane(g,'native painted motorhome visible side',length-.18,1.40,[0,1.76,1.177],'/history/2020/2020-coach-upper-paint.webp');
 }
 // March9 campsite: white minivan and black SUV, distinct from the six RVs.
 for(const [id,p,color] of [['white-minivan',[0,0,-54],'#ecece3'],['black-SUV',[-17,0,-35],'#34383a']] as const){const g=new T.Group();g.userData={id:'2020-'+id.toLowerCase(),title:id,source:'DJI_0094 March9 375s; DJI_0127 campsite still',confidence:'medium'};g.position.set(p[0],p[1],p[2]);root.add(g);const h=id==='white-minivan'?1.47:1.55;box(g,id+' lower body',[4.6,.55,1.84],[0,GROUND+.71,0],mat(color));box(g,id+' cabin',[2.65,h-.55,1.76],[-.25,GROUND+.99+(h-.55)/2,0],mat(color));for(const s of [-1,1]){box(g,id+` side glass ${s<0?'left':'right'}`,[2.48,.54,.018],[-.22,GROUND+1.28,s*.887],glass);for(const x of [-1.45,1.43]){const w=new T.Mesh(new T.CylinderGeometry(.33,.33,.19,10),dark);w.rotation.x=Math.PI/2;w.position.set(x,GROUND+.33,s*.94);g.add(w);name(w,id+` wheel ${s<0?'left':'right'} ${x<0?'rear':'front'}`);}}}
}
