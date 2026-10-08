import * as THREE from 'three';
import type {Ground} from './venue.ts';
type V=[number,number,number];
/** East-edge Dome Quarter on the admitted flat eden-east-ground (Y0). Visual
 * scenery only: no native support, collision, seat, place or route authority.
 * Open strut dome, painted mosaic plaza, arched pergola court and a hexagonal
 * pavilion; every element leaves walking space open and uses few draw calls. */
export const DOME_QUARTER_PLAN=Object.freeze({
 id:'eden-dome-quarter',
 status:'scenery only; inside native eden-east-ground [30,-30,105,85]; no physical admission',
 dome:{root:[99.2,0,36.5] as V,radius:4.6,frequency:2,openings:3},
 court:{root:[99.5,0,48.25] as V,size:[8,11] as [number,number]},
 pavilion:{root:[101.5,0,9] as V,radius:2.6},
 footprintXZ:[94.5,5.5,104.6,54.5] as [number,number,number,number],
});
const PALETTE=['#c96f4a','#e2b552','#4f8f8c','#f1e6cf','#7a5c9e','#2f5d7c'];
/** Geodesic (frequency-2 icosahedron) upper hemisphere: unique edges and faces. */
export function geodesicDome(radius:number){
 const t=(1+Math.sqrt(5))/2,base:V[]=[[-1,t,0],[1,t,0],[-1,-t,0],[1,-t,0],[0,-1,t],[0,1,t],[0,-1,-t],[0,1,-t],[t,0,-1],[t,0,1],[-t,0,-1],[-t,0,1]];
 const faces=[[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]];
 const verts:THREE.Vector3[]=base.map(v=>new THREE.Vector3(...v).normalize()),mid=new Map<string,number>();
 const half=(a:number,b:number)=>{const k=a<b?a+'_'+b:b+'_'+a;let i=mid.get(k);if(i===undefined){i=verts.length;verts.push(verts[a].clone().add(verts[b]).normalize());mid.set(k,i);}return i;};
 const tris:number[][]=[];for(const [a,b,c] of faces){const ab=half(a,b),bc=half(b,c),ca=half(c,a);tris.push([a,ab,ca],[b,bc,ab],[c,ca,bc],[ab,bc,ca]);}
 // Tilt so a pentagon hub sits at the apex, then keep faces fully above the floor.
 const apex=verts[0].clone(),q=new THREE.Quaternion().setFromUnitVectors(apex,new THREE.Vector3(0,1,0));for(const v of verts)v.applyQuaternion(q);
 const keep=tris.filter(f=>f.every(i=>verts[i].y>-1e-6));const edges=new Map<string,[number,number]>();
 for(const f of keep)for(let k=0;k<3;k++){const a=f[k],b=f[(k+1)%3],key=a<b?a+'_'+b:b+'_'+a;if(!edges.has(key))edges.set(key,[a,b]);}
 return {points:verts.map(v=>v.clone().multiplyScalar(radius)),faces:keep,edges:[...edges.values()]};
}
export function createEdenDomeQuarter(ground:Ground){
 if(typeof ground!=='function')return null;
 const [x0,z0,x1,z1]=DOME_QUARTER_PLAN.footprintXZ;
 // Only on verified flat visual ground matching native Y0.
 for(let x=x0;x<=x1;x+=1)for(let z=z0;z<=z1;z+=1){const y=ground(x,z);if(typeof y!=='number'||!Number.isFinite(y)||Math.abs(y)>1e-5)return null;}
 const group=new THREE.Group();group.name='Eden Dome Quarter (scenery only)';
 const geos:THREE.BufferGeometry[]=[],mats:THREE.Material[]=[];let closed=false;
 const material=(m:THREE.Material)=>{mats.push(m);return m;},geometry=<G extends THREE.BufferGeometry>(g:G)=>{geos.push(g);return g;};
 const dispose=()=>{if(closed)return;closed=true;group.removeFromParent();for(const g of geos)g.dispose();for(const m of mats)m.dispose();group.clear();};
 try{
  const steel=material(new THREE.MeshStandardMaterial({color:'#d9d4c7',roughness:.45,metalness:.55}));
  const timber=material(new THREE.MeshStandardMaterial({color:'#8a5a36',roughness:.82}));
  const stone=material(new THREE.MeshStandardMaterial({color:'#b9ad97',roughness:.95}));
  const painted=material(new THREE.MeshStandardMaterial({vertexColors:true,roughness:.7,side:THREE.DoubleSide}));
  const mosaic=material(new THREE.MeshStandardMaterial({vertexColors:true,roughness:.88}));
  const up=new THREE.Vector3(0,1,0),m=new THREE.Matrix4(),quat=new THREE.Quaternion(),scale=new THREE.Vector3();
  const strutsBetween=(pairs:[THREE.Vector3,THREE.Vector3][],radius:number,mat:THREE.Material,name:string)=>{
   const mesh=new THREE.InstancedMesh(geometry(new THREE.CylinderGeometry(radius,radius,1,6)),mat,pairs.length);mesh.name=name;
   pairs.forEach(([a,b],i)=>{const d=b.clone().sub(a),len=d.length();quat.setFromUnitVectors(up,d.normalize());m.compose(a.clone().add(b).multiplyScalar(.5),quat,scale.set(1,len,1));mesh.setMatrixAt(i,m);});
   mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();mesh.castShadow=true;mesh.receiveShadow=true;return mesh;};
  // 1. Geodesic dome: struts, hubs, a lower band of painted panels with three open doorways.
  const dp=DOME_QUARTER_PLAN.dome,dome=geodesicDome(dp.radius),domeGroup=new THREE.Group();domeGroup.name='geodesic-dome';domeGroup.position.fromArray(dp.root);group.add(domeGroup);
  domeGroup.add(strutsBetween(dome.edges.map(([a,b])=>[dome.points[a],dome.points[b]]),.045,steel,'dome-struts'));
  const hubs=new THREE.InstancedMesh(geometry(new THREE.IcosahedronGeometry(.09,0)),steel,dome.points.length);hubs.name='dome-hubs';
  dome.points.forEach((p,i)=>{m.makeTranslation(p.x,p.y,p.z);hubs.setMatrixAt(i,m);});hubs.instanceMatrix.needsUpdate=true;hubs.computeBoundingSphere();domeGroup.add(hubs);
  const panelPositions:number[]=[],panelColours:number[]=[],colour=new THREE.Color();
  dome.faces.forEach((f,i)=>{const c=f.reduce((s,k)=>s.add(dome.points[k]),new THREE.Vector3()).multiplyScalar(1/3);const heading=Math.atan2(c.z,c.x);
   const doorway=[0,2*Math.PI/3,-2*Math.PI/3].some(a=>Math.abs(Math.atan2(Math.sin(heading-a),Math.cos(heading-a)))<.42);
   // Panels only on the low band and every other upper face: open crown lets light and the camera in.
   if(doorway&&c.y<dp.radius*.55)return;if(c.y>dp.radius*.55&&i%2===0)return;
   colour.set(PALETTE[i%PALETTE.length]);for(const k of f){const p=dome.points[k].clone().lerp(c,.06);panelPositions.push(p.x,p.y,p.z);panelColours.push(colour.r,colour.g,colour.b);}});
  const panelGeometry=geometry(new THREE.BufferGeometry());panelGeometry.setAttribute('position',new THREE.Float32BufferAttribute(panelPositions,3));panelGeometry.setAttribute('color',new THREE.Float32BufferAttribute(panelColours,3));panelGeometry.computeVertexNormals();
  const panels=new THREE.Mesh(panelGeometry,painted);panels.name='dome-painted-panels';panels.castShadow=true;panels.receiveShadow=true;domeGroup.add(panels);
  const base=new THREE.Mesh(geometry(new THREE.RingGeometry(dp.radius-.25,dp.radius+.25,30).rotateX(-Math.PI/2)),stone);base.name='dome-footing';base.position.y=.03;base.receiveShadow=true;domeGroup.add(base);
  // 2. Mosaic plaza: concentric painted tile rings under the dome (flat, walkable look).
  const tiles:number[]=[],tileColours:number[]=[];const rings=7;
  for(let r=0;r<rings;r++){const ri=r*(dp.radius-.3)/rings,ro=(r+1)*(dp.radius-.3)/rings,n=8+r*6;for(let k=0;k<n;k++){const a0=k/n*Math.PI*2,a1=(k+1)/n*Math.PI*2;colour.set(PALETTE[(r*3+k)%PALETTE.length]).lerp(new THREE.Color('#efe4cc'),(k+r)%2?.35:.05);
    const pts=[[ri,a0],[ro,a1],[ro,a0],[ri,a0],[ri,a1],[ro,a1]];/* counter-clockwise from above: +Y normal */for(const [rr,a] of pts){tiles.push(rr*Math.cos(a),.02,rr*Math.sin(a));tileColours.push(colour.r,colour.g,colour.b);}}}
  const plazaGeometry=geometry(new THREE.BufferGeometry());plazaGeometry.setAttribute('position',new THREE.Float32BufferAttribute(tiles,3));plazaGeometry.setAttribute('color',new THREE.Float32BufferAttribute(tileColours,3));plazaGeometry.computeVertexNormals();
  const plaza=new THREE.Mesh(plazaGeometry,mosaic);plaza.name='dome-mosaic-plaza';plaza.receiveShadow=true;domeGroup.add(plaza);
  // 3. Arched pergola court: perimeter posts, round arches on the long sides, lattice beams overhead, open centre.
  const cp=DOME_QUARTER_PLAN.court,court=new THREE.Group();court.name='pergola-court';court.position.fromArray(cp.root);group.add(court);
  const [w,d]=cp.size,posts:V[]=[];for(let i=0;i<=4;i++){const z=-d/2+i*d/4;posts.push([-w/2,0,z],[w/2,0,z]);}posts.push([0,0,-d/2],[0,0,d/2]);
  const postMesh=new THREE.InstancedMesh(geometry(new THREE.BoxGeometry(.24,2.8,.24)),timber,posts.length);postMesh.name='court-posts';posts.forEach((p,i)=>{m.makeTranslation(p[0],1.4,p[2]);postMesh.setMatrixAt(i,m);});postMesh.instanceMatrix.needsUpdate=true;postMesh.computeBoundingSphere();postMesh.castShadow=true;court.add(postMesh);
  const beams:[THREE.Vector3,THREE.Vector3][]=[];for(let i=0;i<=6;i++){const z=-d/2+i*d/6;beams.push([new THREE.Vector3(-w/2-.2,2.85,z),new THREE.Vector3(w/2+.2,2.85,z)]);}for(const x of[-w/2,0,w/2])beams.push([new THREE.Vector3(x,2.95,-d/2-.2),new THREE.Vector3(x,2.95,d/2+.2)]);
  court.add(strutsBetween(beams,.07,timber,'court-lattice'));
  const archPairs:[THREE.Vector3,THREE.Vector3][]=[];for(const x of[-w/2,w/2])for(let i=0;i<4;i++){const za=-d/2+i*d/4,zb=za+d/4,mz=(za+zb)/2,r=(zb-za)/2;for(let k=0;k<8;k++){const a0=Math.PI*k/8,a1=Math.PI*(k+1)/8;archPairs.push([new THREE.Vector3(x,2.05+Math.sin(a0)*.7,mz-Math.cos(a0)*r),new THREE.Vector3(x,2.05+Math.sin(a1)*.7,mz-Math.cos(a1)*r)]);}}
  const arches=strutsBetween(archPairs,.08,painted,'court-arches');const archColour=new THREE.Color('#c96f4a');const archColours=new Float32Array(arches.geometry.attributes.position.count*3);for(let i=0;i<archColours.length;i+=3)archColour.toArray(archColours,i);arches.geometry.setAttribute('color',new THREE.BufferAttribute(archColours,3));court.add(arches);
  const paving=new THREE.Mesh(geometry(new THREE.PlaneGeometry(w-.6,d-.6).rotateX(-Math.PI/2)),stone);paving.name='court-paving';paving.position.y=.015;paving.receiveShadow=true;court.add(paving);
  // 4. Hexagonal pavilion with a painted conical roof on six posts.
  const pp=DOME_QUARTER_PLAN.pavilion,pavilion=new THREE.Group();pavilion.name='hex-pavilion';pavilion.position.fromArray(pp.root);group.add(pavilion);
  const hexPosts=new THREE.InstancedMesh(geometry(new THREE.CylinderGeometry(.11,.13,2.6,8)),timber,6);hexPosts.name='pavilion-posts';for(let i=0;i<6;i++){const a=i*Math.PI/3;m.makeTranslation(Math.cos(a)*pp.radius,1.3,Math.sin(a)*pp.radius);hexPosts.setMatrixAt(i,m);}hexPosts.instanceMatrix.needsUpdate=true;hexPosts.computeBoundingSphere();hexPosts.castShadow=true;pavilion.add(hexPosts);
  const roofGeometry=geometry(new THREE.ConeGeometry(pp.radius+.6,1.5,6,1,true));const roofColours:number[]=[];for(let i=0;i<roofGeometry.attributes.position.count;i++){colour.set(PALETTE[Math.floor(i/3)%2?3:1]);roofColours.push(colour.r,colour.g,colour.b);}roofGeometry.setAttribute('color',new THREE.Float32BufferAttribute(roofColours,3));
  const roof=new THREE.Mesh(roofGeometry,painted);roof.name='pavilion-roof';roof.position.y=2.6+.75;roof.castShadow=true;roof.receiveShadow=true;pavilion.add(roof);
  const deck=new THREE.Mesh(geometry(new THREE.CircleGeometry(pp.radius+.3,6).rotateX(-Math.PI/2)),timber);deck.name='pavilion-deck-paint';deck.position.y=.02;deck.receiveShadow=true;pavilion.add(deck);
 }catch(error){dispose();throw error;}
 return {group,plan:DOME_QUARTER_PLAN,dispose};
}
