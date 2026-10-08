import * as THREE from 'three';
import type {Ground} from './venue.ts';
/** Street details: lamp posts beside the residential routes and festive
 * bunting over the pergola court and the market kiosks. Visual scenery only.
 * Lamp points were chosen clear (0.6 m) of every installed expansion object
 * and of the 2.4 m route widths; each still verifies flat ground at Y0. */
export const EDEN_STREET_DETAILS_PLAN=Object.freeze({
 id:'eden-street-details',
 status:'scenery only; no lighting authority, collision, support or route change',
 lamps:[[32,3.25],[50,3.25],[63.75,9],[60.25,18],[40,25.75],[31,22.25],[63.75,28],[58,36.25],[49,39.75],[40,36.25],[31,39.75]] as [number,number][],
 // Park lamps along the landscape walks (western nature loop, south-country loop and link, southern forest loop,
 // farm-orchard loop, pond bank, footbridge): 0.6 m beside each path edge, off every other path, water bed and the
 // native commons/shore, and 0.6 m clear of every installed expansion object's bounds (checked offline). They
 // stand on the sampled visual ground.
 parkLamps:[[-33.33,23.65],[-48.51,23.53],[-63.86,29.73],[-80.94,23.51],[-88.7,31.36],[-91.42,46.09],[-76.65,54.9],[-62.15,59.1],[-50.46,50.41],[-35.9,40.35],
  [-18.15,58.86],[-19.4,71.79],[-8.31,75.85],[7.05,79.22],[16.89,73.08],[23.41,63.9],[14.1,56.4],[7,31.9],[2.1,38],
  [-73.88,65.12],[-57.19,69.25],[-40.84,72.48],[-32.99,64.87],[29.9,47.03],[34.1,61.53],[34.59,75.62],[54.04,74.95],[69.76,77.47],[-31.5,14],[-65.5,-20]] as [number,number][],
 // Low post lanterns at the rest stops: west meadow, southern shade clearing, west lake, forest reading, garden.
 parkLanterns:[[-53.5,43],[-46.5,64],[-94.5,17.5],[14,-33.5],[60.5,46]] as [number,number][],
 // Bunting runs: [from, to] at height, with sag in metres.
 bunting:[
  ...[0,1,2,3,4].map(i=>({from:[95.5,2.75,42.75+i*2.75],to:[103.5,2.75,42.75+i*2.75],sag:.45})),
  {from:[53.6,2.35,-25.8],to:[61.4,2.35,-25.8],sag:.35},
 ] as {from:[number,number,number];to:[number,number,number];sag:number}[],
 // Two planters flank each of the dome's three doorways (r 5.3, ±0.55 rad).
 planters:[[103.72,0,33.73],[103.72,0,39.27],[99.34,0,41.8],[94.54,0,39.03],[94.54,0,33.97],[99.34,0,31.2]] as [number,number,number][],
});
const FLAGS=['#c96f4a','#e2b552','#4f8f8c','#f1e6cf','#7a5c9e','#2f5d7c','#b8473a'];
export function createEdenStreetDetails(ground:Ground){
 if(typeof ground!=='function')return null;
 const P=EDEN_STREET_DETAILS_PLAN,flat=(x:number,z:number)=>{const y=ground(x,z);return typeof y==='number'&&Number.isFinite(y)&&Math.abs(y)<=1e-5;};
 const lamps=P.lamps.filter(([x,z])=>flat(x,z)),planters=P.planters.filter(([x,,z])=>flat(x,z));
 const sampled=(list:readonly [number,number][])=>list.flatMap(([x,z])=>{const y=ground(x,z);return typeof y==='number'&&Number.isFinite(y)?[[x,y,z] as [number,number,number]]:[];});
 const parkLamps=sampled(P.parkLamps),parkLanterns=sampled(P.parkLanterns);
 const group=new THREE.Group();group.name='Eden street details (scenery only)';
 const geos:THREE.BufferGeometry[]=[],mats:THREE.Material[]=[];let closed=false;
 const mat=<M extends THREE.Material>(m:M)=>{mats.push(m);return m;},geo=<G extends THREE.BufferGeometry>(g:G)=>{geos.push(g);return g;};
 const dispose=()=>{if(closed)return;closed=true;group.removeFromParent();for(const g of geos)g.dispose();for(const m of mats)m.dispose();group.clear();};
 const finish=(mesh:THREE.InstancedMesh,name:string,shadow=true)=>{mesh.name=name;mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();mesh.castShadow=shadow;mesh.receiveShadow=true;group.add(mesh);return mesh;};
 try{
  const iron=mat(new THREE.MeshStandardMaterial({color:'#2f3633',roughness:.55,metalness:.6}));
  const lanternGlass=mat(new THREE.MeshStandardMaterial({color:'#fff1c9',emissive:'#ffcf7a',emissiveIntensity:.55,roughness:.4}));
  const m=new THREE.Matrix4();
  // Street and park lamps (full 3 m posts) and low lanterns (1.5 m posts) share the same three instanced draws.
  const all:[number,number,number,number][]=[...lamps.map(([x,z])=>[x,0,z,3] as [number,number,number,number]),...parkLamps.map(([x,y,z])=>[x,y,z,3.01] as [number,number,number,number]),...parkLanterns.map(([x,y,z])=>[x,y,z,1.5] as [number,number,number,number])];
  if(all.length){
   const posts=new THREE.InstancedMesh(geo(new THREE.CylinderGeometry(.05,.08,3,8)),iron,all.length),heads=new THREE.InstancedMesh(geo(new THREE.CylinderGeometry(.16,.12,.38,6)),lanternGlass,all.length),caps=new THREE.InstancedMesh(geo(new THREE.ConeGeometry(.22,.2,6)),iron,all.length);
   const q=new THREE.Quaternion(),one=new THREE.Vector3(1,1,1),v=new THREE.Vector3();
   all.forEach(([x,y,z,h],i)=>{posts.setMatrixAt(i,m.compose(v.set(x,y+h/2,z),q,new THREE.Vector3(1,h/3,1)));heads.setMatrixAt(i,m.compose(v.set(x,y+h+.19,z),q,one));caps.setMatrixAt(i,m.compose(v.set(x,y+h+.48,z),q,one));});
   finish(posts,'street-lamp-posts');finish(heads,'street-lamp-lanterns',false);finish(caps,'street-lamp-caps');
  }
  // Night light anchors for the viewer's light map ([x, groundY, z, kind]).
  group.userData.edenLightSources=all.map(([x,y,z,h])=>[x,y,z,h<2?'lantern':h>3?'park-lamp':'lamp']);
  // Bunting: catenary-like sag; one cord mesh and one vertex-coloured flag mesh.
  const cord:number[][]=[],flagPositions:number[]=[],flagColours:number[]=[],c=new THREE.Color();let flagIndex=0;
  for(const run of P.bunting){const a=new THREE.Vector3(...run.from),b=new THREE.Vector3(...run.to),len=a.distanceTo(b),n=Math.max(4,Math.round(len/.45)),at=(t:number)=>a.clone().lerp(b,t).add(new THREE.Vector3(0,-run.sag*4*t*(1-t),0));
   for(let i=0;i<n;i++)cord.push([...at(i/n).toArray(),...at((i+1)/n).toArray()]);
   const dir=b.clone().sub(a).normalize();for(let i=1;i<n;i++){const p=at(i/n),half=dir.clone().multiplyScalar(.14);c.set(FLAGS[flagIndex++%FLAGS.length]);
    for(const v of [p.clone().sub(half),p.clone().add(half),p.clone().add(new THREE.Vector3(0,-.32,0))]){flagPositions.push(v.x,v.y,v.z);flagColours.push(c.r,c.g,c.b);}}}
  const cords=new THREE.InstancedMesh(geo(new THREE.CylinderGeometry(.008,.008,1,4)),iron,cord.length),up=new THREE.Vector3(0,1,0),q=new THREE.Quaternion(),s=new THREE.Vector3();
  cord.forEach((seg,i)=>{const p0=new THREE.Vector3(seg[0],seg[1],seg[2]),p1=new THREE.Vector3(seg[3],seg[4],seg[5]),d=p1.clone().sub(p0),l=d.length();q.setFromUnitVectors(up,d.normalize());cords.setMatrixAt(i,m.compose(p0.add(p1).multiplyScalar(.5),q,s.set(1,l,1)));});
  finish(cords,'bunting-cords',false);
  const flagGeometry=geo(new THREE.BufferGeometry());flagGeometry.setAttribute('position',new THREE.Float32BufferAttribute(flagPositions,3));flagGeometry.setAttribute('color',new THREE.Float32BufferAttribute(flagColours,3));flagGeometry.computeVertexNormals();
  const flags=new THREE.Mesh(flagGeometry,mat(new THREE.MeshStandardMaterial({vertexColors:true,roughness:.9,side:THREE.DoubleSide})));flags.name='bunting-flags';flags.castShadow=true;
  // Thin cloth: never treat as a camera occluder.
  flags.userData.cameraTransparent=true;cords.userData.cameraTransparent=true;group.add(flags);
  // Planters with flowers at the dome doorways.
  if(planters.length){
   const boxes=new THREE.InstancedMesh(geo(new THREE.BoxGeometry(.9,.5,.5)),mat(new THREE.MeshStandardMaterial({color:'#9a6b46',roughness:.9})),planters.length),blooms=new THREE.InstancedMesh(geo(new THREE.IcosahedronGeometry(.16,0)),mat(new THREE.MeshStandardMaterial({vertexColors:false,color:'#d9567a',roughness:.8})),planters.length*5),leaves=new THREE.InstancedMesh(geo(new THREE.SphereGeometry(.2,7,5)),mat(new THREE.MeshStandardMaterial({color:'#4f7f3a',roughness:.9})),planters.length*3);
   planters.forEach(([x,,z],i)=>{const yaw=Math.atan2(x-99.2,z-36.5);q.setFromEuler(new THREE.Euler(0,yaw,0));boxes.setMatrixAt(i,m.compose(new THREE.Vector3(x,.25,z),q,s.set(1,1,1)));
    for(let k=0;k<5;k++)blooms.setMatrixAt(i*5+k,m.compose(new THREE.Vector3(x+Math.cos(yaw)*(-.32+k*.16),.62+(k%2)*.06,z-Math.sin(yaw)*(-.32+k*.16)),q,s.set(1,1,1)));
    for(let k=0;k<3;k++)leaves.setMatrixAt(i*3+k,m.compose(new THREE.Vector3(x+Math.cos(yaw)*(-.25+k*.25),.52,z-Math.sin(yaw)*(-.25+k*.25)),q,s.set(1,.7,1)));});
   finish(boxes,'dome-planters');finish(blooms,'dome-planter-blooms');finish(leaves,'dome-planter-leaves');
  }
 }catch(error){dispose();throw error;}
 return {group,plan:EDEN_STREET_DETAILS_PLAN,lamps:lamps.length,parkLamps:parkLamps.length+parkLanterns.length,dispose};
}
