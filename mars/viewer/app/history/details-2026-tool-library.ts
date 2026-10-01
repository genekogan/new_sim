import * as T from 'three';import {Kit,layers} from './kit';import {componentMeshes} from './cad-components';import {cutCompoundOpening} from './details-2026-compound';
/** Upper NE Tool bay identified by Gene. c48660/c73776 clear empty views;
 * retained floor1931 supplies elevation, axis and location. Open east kept. */
export function add2026ToolLibrary(root:T.Group){
 if(root.getObjectByName('Tool Camp · northeast library'))return;
 let host:T.Object3D|undefined;root.traverse(o=>{if(o.userData.assembly_id==='north-workshops'&&!o.userData.component_id)host=o;});if(!host)return;
 host.updateWorldMatrix(true,true);const k=new Kit(2026),g=k.assembly('tool-2026-library','Tool Camp · northeast library',[-29.43,2.697,-85.34],-.651,'Gene: upstairs northeast bay; c48306/c50521/c48660/c48833/c50581/c73776/c50588. Native books/map; furniture sizes fitted to CAD1931 floor.');
 root.updateMatrixWorld(true);const world=new T.Vector3(-29.43,2.697,-85.34);g.position.copy(host.worldToLocal(world));g.rotation.y=-.651-new T.Euler().setFromQuaternion(host.getWorldQuaternion(new T.Quaternion())).y;
 // Four shelves, separate timber supports and native spines (one texture per
 // bank rather than hundreds of book meshes); space between bank and low table.
 for(const x of [-1.51,1.51])k.box(g,'Tool library bookshelf upright',[.045,1.90,.29],[x,.95,-1.56],'#b39c72',layers.detail);
 for(const y of [.36,.74,1.12,1.50,1.88])k.box(g,'Tool library bookshelf timber shelf',[3.07,.03,.30],[0,y,-1.56],'#b49b70',layers.detail);
 const books=new T.Mesh(new T.PlaneGeometry(3.0,1.43),k.photo('/history/2026/accuracy/tool-library-books.webp'));books.position.set(0,1.12,-1.397);k.tag(g,books,'Tool library native book spines c73776',layers.detail);books.userData.walkNoCollision=true;
 for(const x of [-1.30,1.30])for(const z of [-.36,.36])k.box(g,'Tool library low table leg',[.065,.44,.065],[x,.22,z],'#a28c66',layers.detail);
 k.box(g,'Tool library long three panel coffee tabletop',[2.80,.055,.86],[0,.47,0],'#a38e6d',layers.detail);
 for(const x of [-.92,0,.92])k.box(g,'Tool library black inset table panel',[.83,.012,.76],[x,.504,0],'#373c3b',layers.detail);
 for(const [x,z]of [[-.7,.80],[.65,.80],[-.70,-.80],[.65,-.8]]){const c=new T.Mesh(new T.SphereGeometry(1,12,6),k.mat('#c1baa6'));c.scale.set(.25,.045,.25);c.position.set(x,.045,z);k.tag(g,c,'Tool library pale floor cushion',layers.detail);}
 for(let i=0;i<6;i++)k.box(g,'Tool library coffee table book stack',[.22,.025,.15],[-.65,.523+i*.025,0],['#8a6a57','#d7cfb9','#51646c'][i%3],layers.detail);
 const board=k.box(g,'Tool library leaning whiteboard',[.95,1.58,.035],[1.55,.83,-1.10],'#e0e0d4',layers.detail);board.rotation.z=-.12;
 // c48833 wooden hexagonal ring and three-lobed ring: actual cutout openings.
 const ring=(name:string,r:number,hole:number,sides:number,p:[number,number,number],horizontal=false)=>{const shape=new T.Shape();for(let i=0;i<=sides;i++){const a=i/sides*Math.PI*2;const x=r*Math.cos(a),y=r*Math.sin(a);if(i){shape.lineTo(x,y);}else{shape.moveTo(x,y);}}const path=new T.Path();for(let i=0;i<=32;i++){const a=-i/32*Math.PI*2;const x=hole*Math.cos(a),y=hole*Math.sin(a);if(i){path.lineTo(x,y);}else{path.moveTo(x,y);}}shape.holes.push(path);const m=new T.Mesh(new T.ExtrudeGeometry(shape,{depth:.018,bevelEnabled:false}),k.mat('#baa077'));m.position.set(...p);if(horizontal)m.rotation.x=-Math.PI/2;k.tag(g,m,name,layers.detail);};
 ring('Tool library hexagonal mathematical cutout',.39,.28,6,[-.8,.05,1.15],true);const lobes=new T.Shape();for(let i=0;i<=72;i++){const a=i/72*Math.PI*2,r=.41+.11*Math.cos(3*a),x=r*Math.cos(a),y=r*Math.sin(a);if(i){lobes.lineTo(x,y);}else{lobes.moveTo(x,y);}}const hole=new T.Path();hole.absarc(0,0,.25,0,Math.PI*2,true);lobes.holes.push(hole);const tri=new T.Mesh(new T.ExtrudeGeometry(lobes,{depth:.018,bevelEnabled:false}),k.mat('#baa077'));tri.rotation.x=-Math.PI/2;tri.position.set(.4,.04,1.20);k.tag(g,tri,'Tool library three lobed mathematical cutout',layers.detail);
 // Permanent ground workshop under the side deck; leave full-height middle
 // bay clear. c78/50113/33370 show black-yellow supply bins and worktables.
 const base=-2.73;
 k.box(g,'Tool ground workshop long bench top',[3.10,.06,.75],[0,base+.89,-1.54],'#ab9271',layers.detail);
 for(const x of [-1.35,1.35])for(const z of [-1.80,-1.27])k.box(g,'Tool workbench grounded legs',[.07,.86,.07],[x,base+.43,z],'#8f765b',layers.detail);
 k.box(g,'Tool ground bench lower storage shelf',[3.0,.04,.68],[0,base+.27,-1.54],'#a38b68',layers.detail);
 for(const x of [-1.08,-.36,.36,1.08]){k.box(g,'Tool workshop black storage bin',[.58,.31,.49],[x,base+.445,-1.54],'#282f30',layers.detail);k.box(g,'Tool workshop yellow bin lid',[.60,.035,.51],[x,base+.6175,-1.54],'#d4b834',layers.detail);}
 k.box(g,'Tool bench vise base',[.25,.035,.17],[-1.08,base+.944,-1.29],'#53626c',layers.detail);k.box(g,'Tool bench vise jaws',[.20,.18,.13],[-1.08,base+1.05,-1.29],'#637888',layers.detail);
 k.rod(g,'Tool bench vise spindle',[-1.26,base+1.01,-1.29],[-.85,base+1.01,-1.29],.018,'#737c7c',layers.detail);
 for(const x of [-.40,.02,.40]){k.box(g,'Tool workshop drill case',[.22,.13,.15],[x,base+.985,-1.55],'#62747b',layers.detail);k.box(g,'Tool workshop drill handle',[.07,.14,.08],[x,base+.945,-1.50],'#454e51',layers.detail);}
 k.box(g,'Tool workshop folding table',[1.8,.04,.74],[0,base+.75,.45],'#bba282',layers.detail);for(const x of [-.75,.75])for(const z of [.19,.71])k.box(g,'Tool workshop folding table leg',[.035,.73,.035],[x,base+.365,z],'#4c5756',layers.detail);
 g.userData.groundWorkshopEvidence='c78/73/50113/33370: folding worktable, side workbench, tools and black-yellow bins. Chess/event inventory omitted as temporary; bench location fitted under northeast deck.';
 // Open east face deliberately receives no wall/window; three source views
 // look straight through this bay to the open roof terrace and eastern desert.
 g.userData.openEast=true;g.userData.sourceLimits='Exact NE bay attribution from Gene; CAD1931 bay location is fitted correspondence, not a measured camera solution. Book titles preserved in native texture; tabletop inventory representative.';
 // c50588: open east room continues into a roofless plywood terrace,
 // with low north/far plywood parapets and a right-side exit. Native deck
 // rays beyond x2.2 find no donor floor, so this observed bay is restored.
 k.box(g,'Tool library photographed continuing east terrace',[3.66,.065,3.66],[3.65,-.02956,0],'#bca17b',layers.floor);
 for(const x of [1.82,5.48])for(const z of [-1.83,1.83])k.box(g,'Tool east terrace source blue upright',[.075,3.76,.075],[x,-2.697+1.72,z],'#236f9b',layers.steel);
 for(const z of [-1.83,1.83])k.box(g,'Tool east terrace orange floor beam',[3.66,.12,.08],[3.65,-.095,z],'#b8522c',layers.steel);
 for(const x of [1.82,5.48])k.box(g,'Tool east terrace transverse orange floor beam',[.08,.12,3.66],[x,-.095,0],'#b8522c',layers.steel);
 for(const x of [2.22,2.83,3.44,4.05,4.66,5.27])k.box(g,'Tool east terrace plywood support joist',[.07,.14,3.66],[x,-.13,0],'#a18762',layers.floor);
 k.box(g,'Tool east terrace north low plywood parapet',[3.66,.90,.035],[3.65,.45,-1.83],'#b7a07b',layers.wall);
 k.box(g,'Tool east terrace far low plywood parapet',[.035,.90,2.55],[5.48,.45,-.555],'#b7a07b',layers.wall);
 g.userData.terraceEvidence='c50588 roofless continuing east deck, north/far low plywood parapets and right exit; one nominal3.66m rack bay restored beyond missing donor floor; exact parcel placement fitted';
 k.box(g,'Tool library north full plywood book backing',[3.20,2.015,.035],[0,1.0075,-1.735],'#b49b72',layers.wall);
 k.finalize();for(const o of g.children){const kind=o.userData.kind||'';if(kind.startsWith('Tool ground')||kind.startsWith('Tool workbench')||kind.startsWith('Tool workshop')||kind.startsWith('Tool bench'))o.position.y-=.127;}host.add(g);root.updateMatrixWorld(true);
 // Actual surrounding CAD frames1975/76/78/79/86 top at4.7183m.
 // Donor1973 combines a lower2.687m deck and unsupported low4.048m roof.
 // Align that upper roof to those existing supports, never lift the furniture
 // above the roof. Native sourcec50588 keeps floor/ceiling/open east topology.
 const roof=componentMeshes(root,'wood_component-1973');
 for(const m of roof.meshes){m.geometry=m.geometry.clone();const p=m.geometry.attributes.position,inv=m.matrixWorld.clone().invert(),v=new T.Vector3();for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(m.matrixWorld);if(v.y>4.0){v.y+=4.71828-4.04812;v.applyMatrix4(inv);p.setXYZ(i,v.x,v.y,v.z);}}p.needsUpdate=true;m.geometry.computeVertexNormals();m.geometry.computeBoundingBox();m.geometry.computeBoundingSphere();}
 root.updateMatrixWorld(true);const wallFrame=new T.Matrix4().makeRotationY(-Math.PI/2).multiply(g.matrixWorld.clone().invert());
 for(const m of roof.meshes){m.geometry=cutCompoundOpening(m.geometry,wallFrame.clone().multiply(m.matrixWorld),[-1.80,1.70,.035,1.95],[1.74,1.92]);}
 if(roof.owner)roof.owner.userData.openEastSource='c50588 open east vista: retained1973 side panel opened fromfloor to upperbeam, structural posts retained';
 if(roof.owner)roof.owner.userData.roofContactReview='c50588 continuous plywood ceiling; upper donor1973 raised0.67016m to surrounding original frame tops1975/76/78/79/86; lower deck unchanged';
 g.userData.floorSource='retained1931 at2.69994m, overlapping1973 lower2.687m surface; original floor receiver retained';
 g.userData.registration='Gene NE bay; surrounding retained post-top roof contact4.7183m; sourcefloor/ceiling/openvista, dimensions fitted';
 return g;
}
