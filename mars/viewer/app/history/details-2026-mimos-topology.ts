import * as T from 'three';
import {Kit,layers} from './kit';
import {componentMeshes} from './cad-components';
import {cutCompoundOpening} from './details-2026-compound';
/** Gene's explicit L plan plus c70/c49429/49430/c52748. CAD solarium frame
 * determines extents; four west minibay subdivisions are nominal equal fits. */
export function correct2026MimosTopology(root:T.Group){
 const chiba=root.getObjectByName('Chiba');if(!chiba||chiba.getObjectByName('Mimos · corrected open L'))return;
 const angle=-Math.atan2(.4265,.9045)+Math.PI/2,k=new Kit(2026);
 const g=k.assembly('mimos-open-l','Mimos · corrected open L',[2.05645,.37,-8.92635],angle,'Gene Sep30 explicit wall/floor plan; c70 bare enclosure,c49429/49430 furnished open L,c52748 south glass. Room shell extents from CAD; minibay division fitted.');
 chiba.updateWorldMatrix(true,true);g.updateMatrix();const frame=chiba.matrixWorld.clone().multiply(g.matrix).invert();
 // Clip only the southwest ground minibay and the east ground wing from the
 // retained raised deck. Preserve all unrelated kitchen floor and stable IDs.
 for(const id of ['wood_component-0016']){const {owner,meshes}=componentMeshes(chiba,id);for(const m of meshes){const uv=new T.Matrix4().set(1,0,0,0,0,0,1,0,0,1,0,0,0,0,0,1).multiply(frame).multiply(m.matrixWorld);m.geometry=cutCompoundOpening(m.geometry,uv,[-1.9,.08,-4.75,3.70]);m.geometry=cutCompoundOpening(m.geometry,uv,[-1.9,2.22,0,3.70]);m.geometry=cutCompoundOpening(m.geometry,uv,[-1.85,5.92,-8.63,-4.73]);}if(owner)owner.userData.reviewSource='Gene floor plan: southwest west minibay and east pair on sand, north three west minibays raised';}
 // Photographed diner is reverse of the west wall. Replace the old western
 // floor patch in place; extend missing north station support continuously.
 k.box(g,'Dining northern annex continuous plywood floor',[7.77,.07,3.90],[2.035,-.035,-6.68],'#b69870',layers.floor);
 for(const x of [-1.65,.30,2.25,4.20,5.72])for(const z of [-8.36,-5.0])k.box(g,'Dining raised floor ground bearing',[.12,.45,.12],[x,-.295,z],'#9c815b',layers.detail);
 k.box(g,'Mimos three north west minibays raised plywood',[5.83,.07,4.73],[3.005,-.035,-2.365],'#b69870',layers.floor);
 // Solid north divider, south divider has ONLY the existing upright frames.
 k.box(g,'Mimos east rear wooden poster backing',[.025,2.35,3.66],[2.11,1.175,1.83],'#bba17c',layers.wall);
 k.box(g,'Mimos north closed wooden bay divider',[3.71,2.35,.024],[4.065,1.175,0],'#baa27d',layers.wall);
 // Back-west wall retains CAD0640 and receives an actual alcove doorway.
 const {owner,meshes}=componentMeshes(chiba,'wood_component-0640');
 for(const m of meshes){const facade=new T.Matrix4().set(0,0,1,0,0,1,0,0,1,0,0,0,0,0,0,1).multiply(frame).multiply(m.matrixWorld);m.geometry=cutCompoundOpening(m.geometry,facade,[-3.55,-2.65,-.4,1.70],[5.87,5.98]);
  // c49429/70: the west wing continues north through this CAD cross-wall.
  // Open only its western portion; keep east rear poster wall unchanged.
  m.geometry=cutCompoundOpening(m.geometry,facade,[-4.76,-.018,-.5,3.2],[2.20,2.23]);}
 if(owner)owner.userData.reviewSource='c49422 back west closed wall and alcove door; existing walls kept, only fitted90cm doorway cut';
 const door=k.box(g,'Mimos rear alcove open pale door',[.035,2.08,.86],[5.92,.66,-3.55],'#e3dfcf',layers.detail);door.geometry=door.geometry.clone().translate(0,0,.43);door.rotation.y=-1.15;
 // Red sofa just inside kitchen/west door (c49817), and honey three-seat
 // sofa below the native Portuguese art posters on east rear wall(c49417).
 const sofa=(x:number,z:number,rotation:number,color:string)=>{
  const a=k.assembly(x<0?'mimos-source-west-entry-sofa':'mimos-source-east-back-sofa','Mimos source sofa',[x,-.40,z],rotation,'c49817 entry sofa; c49417 honey east sofa; silhouettes observed, dimensions fitted');g.add(a);
  k.box(a,'Mimos source sofa plinth',[2.25,.27,.83],[0,.24,0],color,layers.detail);k.box(a,'Mimos source sofa back',[2.25,.67,.16],[0,.70,-.37],color,layers.detail);
  for(const xx of [-1.03,1.03])k.box(a,'Mimos source sofa rounded arm',[.22,.47,.87],[xx,.52,0],color,layers.detail);
  for(let i=0;i<3;i++)k.box(a,'Mimos sofa separate cushion',[.67,.13,.69],[-.71+i*.71,.44,.03],color,layers.detail);
  for(const xx of [-.91,.91])for(const zz of [-.29,.29])k.box(a,'Mimos sofa short feet',[.09,.12,.09],[xx,.06,zz],'#766044',layers.detail);
 };
 sofa(-.83,-4.15,0,'#a44b36');sofa(1.62,1.74,-Math.PI/2,'#c4a060');
 // c49817/49592: pale recliner opposite the red entry sofa, not another
 // long couch. Upholstery sits on the southwest ground-level section.
 const seat=k.assembly('mimos-cream-recliner','Mimos cream source recliner',[-.53,-.40,-2.37],-.18,'c49817/49592 cream recliner at shared coffee table; shape observed, fit estimated');g.add(seat);
 k.box(seat,'Mimos cream recliner low base',[.92,.30,.85],[0,.25,0],'#d5c8a7',layers.detail);k.box(seat,'Mimos cream recliner cushion',[.76,.14,.72],[0,.44,.06],'#ddd0b2',layers.detail);const back=k.box(seat,'Mimos cream recliner padded back',[.85,.79,.18],[0,.82,-.35],'#dacbaa',layers.detail);back.rotation.x=-.14;
 for(const x of [-.40,.40])k.box(seat,'Mimos cream recliner arm',[.17,.39,.85],[x,.58,0],'#cfc19f',layers.detail);
 k.box(g,'Mimos occupied west shared coffee tabletop',[1.70,.04,.82],[-.75,.16,-1.20],'#b8ab8c',layers.detail);for(const x of [-1.4,-.1])for(const z of [-1.50,-.90])k.box(g,'Mimos west coffee table short leg',[.06,.53,.06],[x,-.125,z],'#746149',layers.detail);
 for(const [i,c]of ['#c8b796','#b35d57','#427785','#ece4d4'].entries()){const mug=new T.Mesh(new T.CylinderGeometry(.045,.038,.085,10,1,true),k.mat(c));mug.position.set(-1.24+i*.24,.222,-1.22+(i%2)*.16);k.tag(g,mug,'Mimos west coffee table ceramic cup',layers.detail);}
 
 const art=new T.Mesh(new T.PlaneGeometry(3.12,1.20),k.photo('/history/2026/accuracy/mimos-east-posters.webp'));art.rotation.y=-Math.PI/2;art.position.set(2.084,1.55,1.78);k.tag(g,art,'Mimos native Portuguese love posters c49417',layers.detail);art.userData.walkNoCollision=true;
 // Table at deep rear west, framed art and blackboard(c49422); source study
 // furniture moves onto this deeper raised wing, not the east ground lounge.
 const cafe=chiba.children.find(o=>o.userData.assembly_id==='mimos-details');
 if(cafe){for(const o of cafe.children){if(o instanceof T.Mesh&&!o.userData.support){o.position.x+=2.8;o.position.z-=3.5;}}
  const home=cafe.children.find(o=>o.userData.assembly_id==='mimos-home');if(home)for(const o of home.children){if(!o.userData.support){o.position.x+=3.75;if(/whiteboard/.test(o.userData.kind??'')){const dx=o.position.x-3.83,dz=o.position.z+3.22;o.position.x=5.85+dz;o.position.z=-1.45-dx;o.rotation.y+=Math.PI/2;o.userData.registration='c49422/50225: board against deep north back wall, fitted position';}}else if(o.userData.kind?.startsWith('Mimos papasan'))o.position.x-=2.4;}
 }
 // c49430 occupied south glazing: angular red/white/blue lower-pane
 // decoration and southeast clothing rail, rather than bare build-phase glass.
 for(const z of [-3.40,-2.15,-.9,.35,1.60,2.85]){
  for(const [j,color]of ['#ece9dc','#d84942','#2456ad'].entries()){
   const shape=new T.Shape();shape.moveTo(-.53,-.20);shape.lineTo(.53,-.20);shape.lineTo(j===1?.20:-.34,.24);shape.closePath();
   const decal=new T.Mesh(new T.ShapeGeometry(shape),new T.MeshStandardMaterial({color,roughness:.88,side:T.DoubleSide}));decal.rotation.y=Math.PI/2;decal.position.set(-1.78+j*.002,.34+j*.11,z+(j-1)*.17);k.tag(g,decal,'Mimos source angular lower-glazing graphic',layers.detail);decal.userData.walkNoCollision=true;decal.userData.source='c49430 geometric red white blue panel motifs; silhouettes/color observed, individual outline fit';
  }
 }
 for(const z of [1.85,3.45]){k.rod(g,'Mimos southeast clothing rack upright',[-1.40,-.37,z],[-1.40,1.36,z],.018,'#c1bbb0',layers.detail);k.rod(g,'Mimos clothing rack ground foot',[-1.65,-.36,z],[-1.12,-.36,z],.018,'#a3a499',layers.detail);}
 k.rod(g,'Mimos photographed clothing rail',[-1.40,1.36,1.85],[-1.40,1.36,3.45],.019,'#b5b5a9',layers.detail);
 for(let i=0;i<9;i++){const z=1.94+i*.16,shape=new T.Shape();shape.moveTo(-.11,.04);shape.lineTo(-.26,-.10);shape.lineTo(-.22,-.27);shape.lineTo(-.13,-.23);shape.lineTo(-.13,-.60);shape.lineTo(.13,-.60);shape.lineTo(.13,-.23);shape.lineTo(.22,-.27);shape.lineTo(.26,-.10);shape.lineTo(.11,.04);shape.closePath();const cloth=new T.Mesh(new T.ShapeGeometry(shape),new T.MeshStandardMaterial({color:['#343b36','#d6ceb9','#858a74','#4b675e'][i%4],roughness:1,side:T.DoubleSide}));cloth.position.set(-1.40,1.28,z);k.tag(g,cloth,'Mimos source hanging garment',layers.detail);cloth.userData.walkNoCollision=true;k.rod(g,'Mimos garment hanger hook',[-1.40,1.25,z],[-1.40,1.36,z],.006,'#666963',layers.detail);}
 const toy=k.assembly('mimos-source-giraffe','Mimos photographed giraffe toy',[-1.40,-.40,-4.00],.18,'c49430 giraffe toy by draped glazed corner; recognizable low-poly silhouette, fitted scale');g.add(toy);
 const oval=(kind:string,p:number[],scale:number[])=>{const m=new T.Mesh(new T.SphereGeometry(1,10,7),k.mat('#bc8a3e'));m.position.fromArray(p);m.scale.fromArray(scale);k.tag(toy,m,kind,layers.detail);return m;};
 oval('Mimos giraffe toy body',[0,.40,0],[.22,.14,.10]);oval('Mimos giraffe toy head',[.21,.90,0],[.12,.07,.065]);k.rod(toy,'Mimos giraffe toy long neck',[.13,.44,0],[.20,.86,0],.065,'#bc8a3e',layers.detail);
 for(const x of [-.13,.12])for(const z of [-.06,.06])k.rod(toy,'Mimos giraffe toy grounded leg',[x,.02,z],[x,.39,z],.032,'#a37737',layers.detail);
 for(const x of [.18,.23])k.rod(toy,'Mimos giraffe toy ossicone',[x,.95,0],[x,1.02,0],.014,'#775530',layers.detail);
 g.userData.topology={northClosedDivider:{x:[2.21,5.92],z:0},southOpenDivider:{x:[-1.85,2.21],z:0},raisedWestThree:{x:[.09,5.92],z:[-4.73,0]},groundWestOne:{x:[-1.85,.09],z:[-4.73,0]},groundEastTwo:{x:[-1.85,2.21],z:[0,3.66]}};
 k.finalize();const entrySofa=g.children.find(o=>o.userData.assembly_id==='mimos-source-west-entry-sofa');if(entrySofa){entrySofa.position.x=-.8;entrySofa.position.z=-3.5;entrySofa.rotation.y=Math.PI/2;}// Gene Oct1: poster wall is perpendicular rear enclosure, not a divider
 // through the glazed lounge. Same-role owner IDs retained after finalization.
 const posterWall=g.children.find(o=>o.userData.kind==='Mimos east rear wooden poster backing');
 if(posterWall){const m=posterWall as T.Mesh;m.geometry=new T.BoxGeometry(.025,2.35,2.68);posterWall.position.set(.75,1.175,0);posterWall.rotation.y=Math.PI/2;}
 art.position.set(.75,1.55,.019);art.rotation.y=0;art.scale.x=2.60/3.12;
 const eastSofa=g.children.find(o=>o.userData.assembly_id==='mimos-source-east-back-sofa');
 if(eastSofa){eastSofa.position.x=.75;eastSofa.position.z=.57;eastSofa.rotation.y=0;}
 for(const o of g.children){const kind=o.userData.kind??'';
  if(kind==='Mimos source angular lower-glazing graphic'){o.visible=false;o.userData.walkNoCollision=true;o.userData.sourceCorrection='Gene Oct1: bogus protruding triangle geometry removed; original ID retained';}
  if(/Mimos southeast clothing|Mimos clothing rack|Mimos photographed clothing rail|Mimos source hanging garment|Mimos garment hanger/.test(kind)){o.position.x+=.65;o.position.z=.65+(o.position.z-1.85)*.625;const m=o as T.Mesh;if(m.isMesh){m.updateMatrix();const geom=m.geometry.clone(),pos=geom.attributes.position,inv=m.matrix.clone().invert(),q=new T.Vector3();for(let i=0;i<pos.count;i++){q.fromBufferAttribute(pos,i).applyMatrix4(m.matrix);q.z=m.position.z+(q.z-m.position.z)*.625;q.applyMatrix4(inv);pos.setXYZ(i,q.x,q.y,q.z);}geom.computeVertexNormals();geom.computeBoundingBox();geom.computeBoundingSphere();m.geometry=geom;}}
 }
 chiba.add(g);return g;
}
