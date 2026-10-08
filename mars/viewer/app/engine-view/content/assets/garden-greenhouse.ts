/** Original static garden greenhouse appearance. No registered support, climate or growth. */
import * as THREE from 'three';
export type ContentView = { readonly group: THREE.Group; dispose(): void };
type V3 = [number, number, number];
type MaterialName = 'stone' | 'timber' | 'dark-timber' | 'tray' | 'soil' | 'leaf-sage' | 'leaf-olive' | 'glass';
type Part = { name: string; material: MaterialName; shape: 'box' | 'leaf'; centre: V3; size: V3; rotationZ: number };
const PALETTE: Record<MaterialName,string> = {stone:'#a79880',timber:'#a7784f','dark-timber':'#70533b',tray:'#776f60',soil:'#514438','leaf-sage':'#78945c','leaf-olive':'#52734a',glass:'#b8d4c6'};
export function inspectGardenGreenhouse() {
 const parts: Part[] = [];
 const box = (name:string,material:MaterialName,centre:V3,size:V3,rotationZ=0) => parts.push({name,material,shape:'box',centre,size,rotationZ});
 for(const x of [-2.9,2.9]) {
  box('side-plinth:'+x,'stone',[x,.12,0],[.2,.24,4]);
  box('side-eave:'+x,'dark-timber',[x,2.6,0],[.16,.16,4]);
  for(const z of [-1.9,0,1.9])box('side-post:'+x+':'+z,'timber',[x,1.34,z],[.14,2.44,.14]);
  box('side-window-sill:'+x,'timber',[x,.55,0],[.14,.09,3.8]);
  box('side-glazing:'+x,'glass',[x,1.565,0],[.018,1.94,3.72]);
 }
 for(const z of [-1.92,1.92]) {
  box('gable-tie:'+z,'dark-timber',[0,2.58,z],[5.8,.16,.14]);
  if(z<0){box('rear-plinth','stone',[0,.12,z],[5.8,.24,.16]);box('rear-glazing','glass',[0,1.42,z],[5.64,2.24,.018]);}
  else for(const x of [-1.91,1.91]){box('front-plinth:'+x,'stone',[x,.12,z],[2.02,.24,.16]);box('front-glazing:'+x,'glass',[x,1.42,z],[2,2.24,.018]);}
 }
 for(const x of [-.88,.88])box('door-jamb:'+x,'timber',[x,1.29,1.92],[.12,2.34,.14]);
 box('door-lintel','timber',[0,2.48,1.92],[1.88,.16,.14]);
 const slope=Math.atan2(.84,2.94),length=Math.hypot(.84,2.94);
 for(const x of [-1.47,1.47]) {
  const angle=x<0?slope:-slope;
  box('pitched-roof-glazing:'+x,'glass',[x,3.06,0],[length,.018,3.8],angle);
  for(const z of [-1.92,0,1.92])box('roof-rafter:'+x+':'+z,'timber',[x,3.06,z],[length,.10,.12],angle);
 }
 box('roof-ridge','dark-timber',[0,3.48,0],[.12,.12,4]);
 const proposedTops: {name:string;centre:V3;size:[number,number];normal:V3;nativeSupport:false}[]=[];
 for(const x of [-1.85,1.85]) {
  box('growing-table-top:'+x,'timber',[x,.76,0],[1.45,.08,2.9]);
  proposedTops.push({name:'table-top:'+x,centre:[x,.80,0],size:[1.45,2.9],normal:[0,1,0],nativeSupport:false});
  for(const dx of [-.57,.57])for(const z of [-1.25,1.25])box('table-leg:'+x+':'+dx+':'+z,'dark-timber',[x+dx,.36,z],[.10,.72,.10]);
  for(const z of [-1.05,-.35,.35,1.05]) {
   box('soil-tray:'+x+':'+z,'soil',[x,.84,z],[1.2,.08,.52]);
   for(const dx of [-.62,.62])box('tray-long-rim:'+x+':'+z+':'+dx,'tray',[x+dx,.86,z],[.04,.12,.60]);
   for(const dz of [-.28,.28])box('tray-end-rim:'+x+':'+z+':'+dz,'tray',[x,.86,z+dz],[1.2,.12,.04]);
   for(let i=0;i<3;i++) {
    const px=x+(i-1)*.35,pz=z+(i%2===0?.08:-.08),height=.23+.055*((i+(z>0?1:0))%3);
    box('plant-stem:'+x+':'+z+':'+i,'dark-timber',[px,.88+height/2,pz],[.022,height,.022]);
    for(const sign of [-1,1])parts.push({name:'original-leaf:'+x+':'+z+':'+i+':'+sign,material:sign<0?'leaf-sage':'leaf-olive',shape:'leaf',centre:[px+sign*.085,.94+height*.55,pz],size:[.24,.12,.16],rotationZ:sign*.4});
   }
  }
 }
 return {name:'garden-greenhouse',status:'uninstalled-appearance-proposal',nativeSupport:false,units:'metres',origin:'base-centred; Y up; caller rotation.y=-yaw',footprint:[6,4],bounds:{min:[-3,0,-2],max:[3,3.54,2]},materials:Object.entries(PALETTE).map(([name,colour])=>({name,colour,transparent:name==='glass',opacity:name==='glass'?.18:1})),parts,doorway:{name:'empty-front-doorway',min:[-.80,0,1.84],max:[.80,2.30,2.04]},aisle:{name:'continuous-empty-central-aisle',min:[-.80,0,-1.84],max:[.80,2.4,2.04]},roofUndersideMinimum:2.50,proposedTopSurfaces:proposedTops,proposedBaseContacts:[{name:'edge-plinth-contacts',normal:[0,1,0],nativeSupport:false,parts:parts.filter(p=>p.material==='stone').map(p=>p.name)}],limits:'Static glazing and plants only; no installed floor/support/glass collision, animated door, growing or climate/controller claims.'};
}
export function createGardenGreenhouse(): ContentView {
 const spec=inspectGardenGreenhouse(),group=new THREE.Group();group.name='garden-greenhouse:uninstalled';group.userData.inspection=spec;
 const box=new THREE.BoxGeometry(1,1,1),leaf=new THREE.OctahedronGeometry(.5,0),geometries=[box,leaf],materials:THREE.Material[]=[],instances:THREE.InstancedMesh[]=[],matrix=new THREE.Matrix4(),position=new THREE.Vector3(),scale=new THREE.Vector3(),q=new THREE.Quaternion(),axis=new THREE.Vector3(0,0,1);
 for(const name of Object.keys(PALETTE) as MaterialName[]) {
  const glass=name==='glass',material=new THREE.MeshStandardMaterial({color:PALETTE[name],roughness:glass?.24:1,transparent:glass,opacity:glass?.18:1,depthWrite:!glass,side:glass?THREE.DoubleSide:THREE.FrontSide});material.forceSinglePass=true;materials.push(material);
  const parts=spec.parts.filter(p=>p.material===name);
  if(glass)for(const p of parts){const m=new THREE.Mesh(box,material);m.name=p.name;m.position.fromArray(p.centre);m.scale.fromArray(p.size);m.rotation.z=p.rotationZ;m.userData.partNames=[p.name];m.renderOrder=1;group.add(m);}
  else {const m=new THREE.InstancedMesh(name.startsWith('leaf')?leaf:box,material,parts.length);m.name=name;m.userData.partNames=parts.map(p=>p.name);parts.forEach((p,i)=>{q.setFromAxisAngle(axis,p.rotationZ);matrix.compose(position.fromArray(p.centre),q,scale.fromArray(p.size));m.setMatrixAt(i,matrix);});m.instanceMatrix.needsUpdate=true;m.computeBoundingBox();m.computeBoundingSphere();m.castShadow=m.receiveShadow=true;instances.push(m);group.add(m);}
 }
 let closed=false;return {group,dispose(){if(closed)return;closed=true;const errors:unknown[]=[],attempt=(fn:()=>void)=>{try{fn();}catch(e){errors.push(e);}};attempt(()=>group.removeFromParent());for(const m of instances)attempt(()=>m.dispose());for(const g of geometries)attempt(()=>g.dispose());for(const m of materials)attempt(()=>m.dispose());for(const child of [...group.children])attempt(()=>group.remove(child));if(errors.length)throw new AggregateError(errors,'Garden greenhouse cleanup callbacks failed');}};
}
