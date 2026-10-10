import * as THREE from 'three';
import type {Ground} from './venue.ts';
type V=[number,number,number];
/** Varied small buildings in clear 6-9 m squares of native eden-east-ground
 * (each square measured free of installed objects and route widths). Visual
 * scenery only: no native support, collision, seat or route. The yurt and the A-frame are
 * open inside (furnished by the Buildings & Interiors lane, eden-interiors/existing.ts); the tower house is too (WN11). */
export const EDEN_ARTIST_ROW_PLAN=Object.freeze({
 id:'eden-artist-row',
 status:'scenery only; inside native eden-east-ground [30,-30,105,85]; no physical admission',
 aFrame:{root:[76.5,0,-25.5] as V,yaw:.4},
 yurt:{root:[67.5,0,-18.5] as V,yaw:-.6},
 towerHouse:{root:[69,0,20] as V,yaw:Math.PI/2},
 teaHouse:{root:[92.5,0,4.5] as V,yaw:0},
 muralWall:{root:[73.5,0,5.4] as V,yaw:0},
 waterTower:{root:[102,0,-27] as V,yaw:0},
 footprints:[[73,-29,80,-22],[64,-22,71,-15],[66,17,72,23],[89.5,1.5,95.5,7.5],[70.5,4,76.5,7],[99.5,-29.5,104.5,-24.5]] as [number,number,number,number][],
});
export function createEdenArtistRow(ground:Ground){
 if(typeof ground!=='function')return null;
 for(const [x0,z0,x1,z1] of EDEN_ARTIST_ROW_PLAN.footprints)for(let x=x0;x<=x1+1e-9;x+=.5)for(let z=z0;z<=z1+1e-9;z+=.5){const y=ground(x,z);if(typeof y!=='number'||!Number.isFinite(y)||Math.abs(y)>1e-5)return null;}
 const P=EDEN_ARTIST_ROW_PLAN,group=new THREE.Group();group.name='Eden artist row (scenery only)';
 const geos:THREE.BufferGeometry[]=[],mats:THREE.Material[]=[];let closed=false;
 const mat=(color:string,extra:THREE.MeshStandardMaterialParameters={})=>{const m=new THREE.MeshStandardMaterial({color,roughness:.88,...extra});mats.push(m);return m;},geo=<G extends THREE.BufferGeometry>(g:G)=>{geos.push(g);return g;};
 const dispose=()=>{if(closed)return;closed=true;group.removeFromParent();for(const g of geos)g.dispose();for(const m of mats)m.dispose();group.clear();};
 const site=(name:string,at:V,yaw:number)=>{const g=new THREE.Group();g.name=name;g.position.fromArray(at);g.rotation.y=yaw;group.add(g);return g;};
 const part=(parent:THREE.Object3D,g:THREE.BufferGeometry,m:THREE.Material,name:string,at:V,rot:V=[0,0,0])=>{const mesh=new THREE.Mesh(g,m);mesh.name=name;mesh.position.fromArray(at);mesh.rotation.set(...rot);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;};
 // Repeated parts: one instanced draw per (geometry, material).
 const repeat=(parent:THREE.Object3D,g:THREE.BufferGeometry,m:THREE.Material,name:string,poses:{at:V;rot?:V}[])=>{const mesh=new THREE.InstancedMesh(g,m,poses.length),o=new THREE.Object3D();poses.forEach((p,i)=>{o.position.fromArray(p.at);o.rotation.set(...(p.rot??[0,0,0]));o.updateMatrix();mesh.setMatrixAt(i,o.matrix);});mesh.name=name;mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;};
 const prism=(w:number,h:number,d:number)=>{const s=new THREE.Shape();s.moveTo(-w/2,0);s.lineTo(w/2,0);s.lineTo(0,h);s.closePath();const g=new THREE.ExtrudeGeometry(s,{depth:d,bevelEnabled:false});g.translate(0,0,-d/2);return geo(g);};
 try{
  const timber=mat('#8a5a36'),darkTimber=mat('#4e3423'),shingle=mat('#5d4a3f'),glass=mat('#2b3a40',{roughness:.3,metalness:.2}),cream=mat('#efe6d2'),ochre=mat('#d9a441'),teal=mat('#3f8481'),rust=mat('#b8473a'),felt=mat('#d8c9a8'),plum=mat('#7a5c9e'),steel=mat('#7d8784',{roughness:.5,metalness:.55});
  // 1. A-frame cabin: steep shingle prism, painted gable end, dark door and window.
  // WN6: enterable — the roof is a hollow Λ shell, the front gable has a real doorway, the door stands open.
  const a=site('a-frame-cabin',P.aFrame.root,P.aFrame.yaw);
  {const sh=new THREE.Shape(),t=.16;sh.moveTo(-2.5,0);sh.lineTo(0,5.2);sh.lineTo(2.5,0);sh.lineTo(2.5-t*1.1,0);sh.lineTo(0,5.2-t*2.2);sh.lineTo(-2.5+t*1.1,0);sh.closePath();
   const g=geo(new THREE.ExtrudeGeometry(sh,{depth:6,bevelEnabled:false}));g.translate(0,0,-3);part(a,g,shingle,'a-frame-roof',[0,0,0]);}
  part(a,geo(new THREE.BoxGeometry(4.3,.25,5.6)),timber,'a-frame-floor',[0,.12,0]);
  {const sh=new THREE.Shape();sh.moveTo(-2.25,0);sh.lineTo(2.25,0);sh.lineTo(0,4.7);sh.closePath();const hole=new THREE.Path();hole.moveTo(-.48,.2);hole.lineTo(.48,.2);hole.lineTo(.48,2.15);hole.lineTo(-.48,2.15);hole.closePath();sh.holes.push(hole);
   const g=geo(new THREE.ExtrudeGeometry(sh,{depth:.12,bevelEnabled:false}));g.translate(0,0,-.06);part(a,g,ochre,'a-frame-gable',[0,.05,3.02]);}
  part(a,prism(4.5,4.7,.12),ochre,'a-frame-back-gable',[0,.05,-3.02]);
  part(a,geo(new THREE.BoxGeometry(.9,1.9,.05)),darkTimber,'a-frame-door',[-.48+.45*Math.cos(1.2),.25+.95,3.0-.45*Math.sin(1.2)],[0,1.2,0]);
  part(a,geo(new THREE.CircleGeometry(.45,6)),glass,'a-frame-window',[0,3.1,3.1]);
  // 2. Yurt: felt drum, conical roof with crown ring, painted door frame.
  const y=site('yurt',P.yurt.root,P.yurt.yaw);
  // WN6: enterable — open felt drum with a doorway gap, open roof cone seen from inside, timber floor, door open.
  felt.side=THREE.DoubleSide;plum.side=THREE.DoubleSide;
  const gap=1.05/3;part(y,geo(new THREE.CylinderGeometry(3,3,2.2,20,1,true,gap/2,Math.PI*2-gap)),felt,'yurt-wall',[0,1.1,0]);
  part(y,geo(new THREE.ConeGeometry(3.25,1.6,20,1,true)),plum,'yurt-roof',[0,3,0]);
  part(y,geo(new THREE.CylinderGeometry(2.97,2.97,.08,20)),timber,'yurt-floor',[0,.04,0]);
  part(y,geo(new THREE.TorusGeometry(.45,.07,6,14)),timber,'yurt-crown',[0,3.75,0],[Math.PI/2,0,0]);
  repeat(y,geo(new THREE.BoxGeometry(.14,2,.16)),rust,'yurt-door-jambs',[{at:[-.6,1,2.94]},{at:[.6,1,2.94]}]);
  part(y,geo(new THREE.BoxGeometry(1.34,.16,.16)),rust,'yurt-door-lintel',[0,2.04,2.94]);
  part(y,geo(new THREE.BoxGeometry(.9,1.75,.06)),darkTimber,'yurt-door',[-.5+.45*Math.cos(1.25),.08+.875,2.9-.45*Math.sin(1.25)],[0,1.25,0]);
  const bandMesh=part(y,geo(new THREE.CylinderGeometry(3.02,3.02,.22,20,1,true)),teal,'yurt-band',[0,1.7,0]);bandMesh.castShadow=false;
  // 3. Tower house: three narrow storeys, alternating paint, pitched cap, window strips.
  // Tower-house WN11: enterable — each storey is a hollow 0.14 m shell. The ground storey has a doorway
  // (1.0 × 2.0 m) at the front (+Z) and an inward-open door. Timber floors at 2.6 m and 5.2 m have
  // stairwell openings (left, then right). The roof prism's underside is the top ceiling. Furnished by
  // eden-interiors/existing.ts (towerHouse). Each paint is one instanced draw, as before.
  const t=site('tower-house',P.towerHouse.root,P.towerHouse.yaw);
  {const W=3.4,T=.14,H=2.6,h=W/2-T/2,inner=W-2*T,slab=(x0:number,x1:number,z0:number,z1:number,y:number)=>({at:[(x0+x1)/2,y,(z0+z1)/2] as V,s:[x1-x0,.12,z1-z0] as V});
   const walls=(i:number)=>{const y=H/2+i*H,front=i===0?[{at:[-1.1,y,h] as V,s:[1.2,H,T] as V},{at:[1.1,y,h] as V,s:[1.2,H,T] as V},{at:[0,2+(H-2)/2,h] as V,s:[1,H-2,T] as V}]:[{at:[0,y,h] as V,s:[W,H,T] as V}];
    return [{at:[0,y,-h] as V,s:[W,H,T] as V},{at:[-h,y,0] as V,s:[T,H,inner] as V},{at:[h,y,0] as V,s:[T,H,inner] as V},...front];};
   const boxes=(parent:THREE.Object3D,m:THREE.Material,name:string,items:{at:V;s:V}[])=>{const mesh=new THREE.InstancedMesh(geo(new THREE.BoxGeometry(1,1,1)),m,items.length),o=new THREE.Object3D();
    items.forEach((p,k)=>{o.position.fromArray(p.at);o.scale.fromArray(p.s);o.updateMatrix();mesh.setMatrixAt(k,o.matrix);});mesh.name=name;mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;};
   boxes(t,cream,'tower-storeys-cream',[...walls(0),...walls(2)]);boxes(t,teal,'tower-storey-2',walls(1));
   const e=inner/2;boxes(t,timber,'tower-floors',[slab(-e,e,-e,e,.04),slab(-.84,e,-e,e,2.6),slab(-e,-.84,.36,e,2.6),slab(-e,.84,-e,e,5.2),slab(.84,e,.36,e,5.2)].map(p=>p.at[1]<.1?{at:[p.at[0],p.at[1],p.at[2]] as V,s:[p.s[0],.08,p.s[2]] as V}:p));}
  part(t,prism(3.9,1.9,3.9),rust,'tower-roof',[0,7.8,0]);
  repeat(t,geo(new THREE.BoxGeometry(.8,1,.06)),glass,'tower-windows',[0,1,2].flatMap(i=>[-.85,.85].map(x=>({at:[x+(i===0?Math.sign(x)*.12:0),1.5+i*2.6,1.72] as V}))));
  part(t,geo(new THREE.BoxGeometry(1.3,.16,.2)),darkTimber,'tower-door-lintel',[0,2.08,1.73]);
  part(t,geo(new THREE.BoxGeometry(.95,1.96,.06)),darkTimber,'tower-door',[-.5+.475*Math.cos(1.25),1.04,1.63-.04-.475*Math.sin(1.25)],[0,1.25,0]);
  // 4. Octagonal tea house: low deck, lattice walls (open between posts), two-tier roof.
  const h=site('tea-house',P.teaHouse.root,P.teaHouse.yaw);
  part(h,geo(new THREE.CylinderGeometry(2.8,2.8,.3,8)),timber,'tea-deck',[0,.15,0]);
  repeat(h,geo(new THREE.BoxGeometry(.16,2.3,.16)),darkTimber,'tea-posts',[...Array(8).keys()].map(i=>{const ang=i*Math.PI/4+Math.PI/8;return{at:[Math.cos(ang)*2.4,1.45,Math.sin(ang)*2.4] as V};}));
  // Rail open on the west bay (towards the library fountain), with a step up to the deck (OBSTACLES-v1).
  const rail=geo(new THREE.TorusGeometry(2.4,.05,4,7,Math.PI*7/4));part(h,rail,darkTimber,'tea-rail',[0,1.05,0],[Math.PI/2,0,Math.PI*9/8]);
  part(h,geo(new THREE.BoxGeometry(.5,.15,1.5)),timber,'tea-step',[-2.4*Math.cos(Math.PI/8)-.45,.075,0]);
  part(h,geo(new THREE.ConeGeometry(3.3,1.1,8)),teal,'tea-roof-lower',[0,3.15,0],[0,Math.PI/8,0]);
  part(h,geo(new THREE.ConeGeometry(1.7,1.1,8)),teal,'tea-roof-upper',[0,3.95,0],[0,Math.PI/8,0]);
  part(h,geo(new THREE.SphereGeometry(.16,8,6)),ochre,'tea-finial',[0,4.55,0]);
  // 5. Mural wall: low plastered wall with a vertex-coloured abstract mural on both faces.
  const w=site('mural-wall',P.muralWall.root,P.muralWall.yaw);
  part(w,geo(new THREE.BoxGeometry(5.6,2.2,.35)),cream,'mural-wall-body',[0,1.1,0]);
  part(w,geo(new THREE.BoxGeometry(5.9,.16,.5)),timber,'mural-wall-coping',[0,2.28,0]);
  const mural:number[]=[],colours:number[]=[],cols=['#c96f4a','#e2b552','#4f8f8c','#7a5c9e','#2f5d7c','#b8473a'],c=new THREE.Color();
  for(const side of[1,-1])for(let i=0;i<14;i++){const x0=-2.7+i*5.4/14,x1=x0+5.4/14,y0=.25+((i*7)%5)*.12,y1=1.95-((i*3)%4)*.14,z=side*.181;c.set(cols[(i+(side>0?0:3))%cols.length]);
   const tri=side>0?[[x0,y0],[x1,y0],[x1,y1],[x0,y0],[x1,y1],[x0,y1]]:[[x0,y0],[x1,y1],[x1,y0],[x0,y0],[x0,y1],[x1,y1]];for(const [x,y2] of tri){mural.push(x,y2,z);colours.push(c.r,c.g,c.b);}}
  const muralGeometry=geo(new THREE.BufferGeometry());muralGeometry.setAttribute('position',new THREE.Float32BufferAttribute(mural,3));muralGeometry.setAttribute('color',new THREE.Float32BufferAttribute(colours,3));muralGeometry.computeVertexNormals();
  const muralMesh=new THREE.Mesh(muralGeometry,(()=>{const m=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.85});mats.push(m);return m;})());muralMesh.name='mural-paint';muralMesh.receiveShadow=true;w.add(muralMesh);
  // Small upward-facing ground lamps use the existing shared night-light map, not extra real lights.
  for(const x of[-2.1,0,2.1]){
   part(w,geo(new THREE.CylinderGeometry(.09,.11,.09,8)),steel,'mural-ground-uplight-base',[x,.045,.65]);
   part(w,geo(new THREE.BoxGeometry(.14,.018,.14)),cream,'mural-ground-uplight-lens',[x,.11,.63],[-Math.PI/4,0,0]);
  }
  w.userData.edenLightSources=[-2.1,0,2.1].map(x=>[P.muralWall.root[0]+x,0,P.muralWall.root[2]+.65,'mural-uplight',1]);
  // 6. Water tower: four splayed steel legs, cross bracing, timber tank and conical lid.
  const o=site('water-tower',P.waterTower.root,P.waterTower.yaw);
  repeat(o,geo(new THREE.CylinderGeometry(.09,.12,6.2,6)),steel,'tower-legs',[[-1.3,-1.3],[1.3,-1.3],[1.3,1.3],[-1.3,1.3]].map(([x,z])=>({at:[x*.92,3.1,z*.92] as V,rot:[z*-.06,0,x*.06] as V})));
  repeat(o,geo(new THREE.BoxGeometry(2.5,.07,.07)),steel,'tower-braces',[2,4].flatMap(yy=>[0,1,2,3].map(i=>({at:[Math.sin(i*Math.PI/2)*1.22,yy,Math.cos(i*Math.PI/2)*1.22] as V,rot:[0,i*Math.PI/2,0] as V}))));
  part(o,geo(new THREE.CylinderGeometry(1.6,1.6,2.2,18)),timber,'tower-tank',[0,7.3,0]);
  repeat(o,geo(new THREE.CylinderGeometry(1.64,1.64,.12,18,1,true)),steel,'tower-hoops',[{at:[0,6.7,0]},{at:[0,7.9,0]}]);
  part(o,geo(new THREE.ConeGeometry(1.75,.9,18)),rust,'tower-lid',[0,8.85,0]);
 }catch(error){dispose();throw error;}
 return {group,plan:EDEN_ARTIST_ROW_PLAN,dispose};
}
