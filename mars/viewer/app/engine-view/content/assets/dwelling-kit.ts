/** Original fixed dwellings. Appearance/proposed surfaces only; no installed habitation/support. */
import * as THREE from 'three';
export type DwellingKind='timber-courtyard'|'concrete-balcony';
export type ContentView={readonly group:THREE.Group;dispose():void};
type V3=[number,number,number];type MaterialName='plaster'|'timber'|'roof'|'stone'|'steel';
type Part={name:string;material:MaterialName;centre:V3;size:V3};
const PALETTE:Record<MaterialName,string>={plaster:'#d8cbb1',timber:'#a7784f',roof:'#70533b',stone:'#a79880',steel:'#776f60'};
const known=(kind:unknown):kind is DwellingKind=>kind==='timber-courtyard'||kind==='concrete-balcony';
export function inspectDwelling(kind:DwellingKind){
 if(!known(kind))throw Error('Unknown dwelling kind');
 const parts:Part[]=[],openings:{name:string;min:V3;max:V3;nativeSupport:false}[]=[],tops:{name:string;centre:V3;size:[number,number];normal:V3;nativeSupport:false}[]=[];
 const box=(name:string,material:MaterialName,centre:V3,size:V3)=>parts.push({name,material,centre,size});
 const slab=(name:string,material:MaterialName,x:number,z:number,width:number,depth:number,top:number,thickness=.12)=>{box(name,material,[x,top-thickness/2,z],[width,thickness,depth]);tops.push({name:name+':top',centre:[x,top,z],size:[width,depth],normal:[0,1,0],nativeSupport:false});};
 const wall=(name:string,axis:'x'|'z',at:number,start:number,end:number,bottom:number,top:number,holes:{name:string;centre:number;width:number;bottom:number;top:number}[])=>{
  const cuts=[...new Set([start,end,...holes.flatMap(h=>[h.centre-h.width/2,h.centre+h.width/2])])].sort((a,b)=>a-b);
  for(const h of holes){const min:V3=axis==='x'?[h.centre-h.width/2,h.bottom,at-.11]:[at-.11,h.bottom,h.centre-h.width/2],max:V3=axis==='x'?[h.centre+h.width/2,h.top,at+.11]:[at+.11,h.top,h.centre+h.width/2];openings.push({name:h.name,min,max,nativeSupport:false});}
  for(let i=0;i<cuts.length-1;i++){const low=cuts[i],high=cuts[i+1],middle=(low+high)/2,h=holes.find(h=>middle>h.centre-h.width/2&&middle<h.centre+h.width/2),spans=h?[[bottom,h.bottom],[h.top,top]]:[[bottom,top]];for(let j=0;j<spans.length;j++){const [y0,y1]=spans[j];if(y1-y0<1e-8)continue;box(name+':'+i+':'+j,'plaster',axis==='x'?[middle,(y0+y1)/2,at]:[at,(y0+y1)/2,middle],axis==='x'?[high-low,y1-y0,.14]:[.14,y1-y0,high-low]);}}
 };
 const window=(name:string,centre:number,floor:number,width=1.2)=>({name,centre,width,bottom:floor+.8,top:floor+1.9}),door=(name:string,centre:number,floor:number)=>({name,centre,width:1.2,bottom:floor,top:floor+2.2});
 let interiorCeilings:{floorTop:number;ceilingUnderside:number}[],courtyard:null|{min:V3;max:V3}=null,balcony:null|{min:V3;max:V3;guardHeight:number;landingMin:V3;landingMax:V3}=null,stair:null|{width:number;rise:number;run:number;from:V3;to:V3}=null;
 if(kind==='timber-courtyard'){
  for(const x of [-2.5,2.5]){slab('side-room-floor:'+x,'timber',x,0,2,3,.12);slab('side-room-roof:'+x,'roof',x,0,2,3,2.82,.20);}
  for(const z of [-2.25,2.25]){slab('end-room-floor:'+z,'timber',0,z,7,1.5,.12);slab('end-room-roof:'+z,'roof',0,z,7,1.5,2.82,.20);}
  slab('courtyard-patio','stone',0,0,3,3,.08,.08);courtyard={min:[-1.5,.08,-1.5],max:[1.5,2.62,1.5]};
  wall('front-facade','x',-2.93,-3.5,3.5,.12,2.62,[door('street-door',0,.12),window('front-window-west',-2.4,.12),window('front-window-east',2.4,.12)]);
  wall('rear-facade','x',2.93,-3.5,3.5,.12,2.62,[window('rear-window',0,.12)]);
  for(const x of [-3.43,3.43])wall('side-facade:'+x,'z',x,-2.86,2.86,.12,2.62,[window('side-window:'+x,0,.12)]);
  wall('court-front-wall','x',-1.57,-1.5,1.5,.12,2.62,[door('courtyard-door',0,.12)]);
  wall('court-rear-wall','x',1.57,-1.5,1.5,.12,2.62,[window('court-rear-window',0,.12)]);
  for(const x of [-1.57,1.57])wall('court-side-wall:'+x,'z',x,-1.5,1.5,.12,2.62,[window('court-window:'+x,0,.12)]);
  for(const x of [-.69,.69])box('street-timber-jamb:'+x,'timber',[x,1.22,-2.99],[.12,2.2,.02]);
  box('street-timber-lintel','timber',[0,2.39,-2.99],[1.5,.14,.02]);interiorCeilings=[{floorTop:.12,ceilingUnderside:2.62}];
 }else{
  slab('ground-floor','stone',0,0,8,6,.12);slab('upper-floor','stone',0,0,8,6,2.6);slab('terrace-roof','plaster',0,0,8,6,5.22,.20);
  for(const floor of [.12,2.6]){
   wall('front-facade:'+floor,'x',-2.93,-4,4,floor,floor<1?2.48:floor+2.42,floor<1?[door('ground-door',0,floor),window('front-window-west:'+floor,-2.3,floor),window('front-window-east:'+floor,2.3,floor)]:[door('balcony-door',1.8,floor),window('upper-front-window',-2.1,floor)]);
   wall('rear-facade:'+floor,'x',2.93,-4,4,floor,floor<1?2.48:floor+2.42,[window('rear-window:'+floor,0,floor,1.6)]);
   for(const x of [-3.93,3.93])wall('side-facade:'+floor+':'+x,'z',x,-2.86,2.86,floor,floor<1?2.48:floor+2.42,[window('side-window:'+floor+':'+x,0,floor,1.6)]);
  }
  slab('balcony-floor','stone',0,-4,5,2,2.6);balcony={min:[-2.5,2.6,-5],max:[2.5,3.6,-3],guardHeight:1,landingMin:[1.2,2.6,-5],landingMax:[2.4,4.8,-3]};
  for(const x of [-2.55,2.55]){for(const z of [-5.05,-4,-3.12])box('balcony-side-post:'+x+':'+z,'steel',[x,3.1,z],[.08,1,.08]);for(const y of [3.1,3.56])box('balcony-side-rail:'+x+':'+y,'steel',[x,y,-4.085],[.08,.08,1.93]);}
  for(const x of [-2.55,-.8,1.16,2.44])box('balcony-front-post:'+x,'steel',[x,3.1,-5.05],[.08,1,.08]);
  for(const y of [3.1,3.56])box('balcony-front-long-rail:'+y,'steel',[-.695,y,-5.05],[3.63,.08,.08]);
  stair={width:1.2,rise:.1625,run:4.48,from:[1.8,0,-9.48],to:[1.8,2.6,-5]};for(let i=0;i<16;i++){const top=(i+1)*.1625,z=-9.48+(i+.5)*.28;slab('external-tread:'+i,'stone',1.8,z,1.2,.28,top,top);}
  interiorCeilings=[{floorTop:.12,ceilingUnderside:2.48},{floorTop:2.6,ceilingUnderside:5.02}];
 }
 const min:V3=[Infinity,Infinity,Infinity],max:V3=[-Infinity,-Infinity,-Infinity];for(const p of parts)for(let i=0;i<3;i++){min[i]=Math.min(min[i],p.centre[i]-p.size[i]/2);max[i]=Math.max(max[i],p.centre[i]+p.size[i]/2);}
 return{kind,status:'uninstalled-appearance-proposal',nativeSupport:false,units:'metres',origin:'local base-centre; Y up; caller rotation.y=-yaw',footprint:kind==='timber-courtyard'?[7,6]:[8,6],materials:Object.entries(PALETTE).map(([name,colour])=>({name,colour})),parts,bounds:{min,max},openings,proposedTopSurfaces:tops,courtyard,balcony,stair,interiorCeilings,semanticSlots:parts.map(p=>({part:p.name,material:p.material,scope:'optional cosmetic details only; no registration'})),limits:'No installed floor/stair/door/guard/load/habitation or body clearance grant. Balcony cantilever and external unguarded stairs are appearance proposals; ground-to-upper circulation and full structural design require Core.'};
}
export function createDwelling(kind:DwellingKind):ContentView{
 const spec=inspectDwelling(kind),group=new THREE.Group();group.name='dwelling:'+kind+':uninstalled';group.userData.inspection=spec;const geometry=new THREE.BoxGeometry(1,1,1),materials:THREE.Material[]=[],instances:THREE.InstancedMesh[]=[],matrix=new THREE.Matrix4(),p=new THREE.Vector3(),scale=new THREE.Vector3(),q=new THREE.Quaternion();
 for(const name of Object.keys(PALETTE) as MaterialName[]){const parts=spec.parts.filter(p=>p.material===name);if(!parts.length)continue;const mat=new THREE.MeshStandardMaterial({color:PALETTE[name],roughness:name==='steel'?.7:1,metalness:name==='steel'?.15:0}),mesh=new THREE.InstancedMesh(geometry,mat,parts.length);materials.push(mat);instances.push(mesh);mesh.name=name;mesh.userData.partNames=parts.map(p=>p.name);parts.forEach((part,i)=>{matrix.compose(p.fromArray(part.centre),q,scale.fromArray(part.size));mesh.setMatrixAt(i,matrix);});mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingBox();mesh.computeBoundingSphere();mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);}
 let closed=false;return{group,dispose(){if(closed)return;closed=true;const errors:unknown[]=[],attempt=(fn:()=>void)=>{try{fn();}catch(e){errors.push(e);}};attempt(()=>group.removeFromParent());for(const m of instances)attempt(()=>m.dispose());attempt(()=>geometry.dispose());for(const m of materials)attempt(()=>m.dispose());for(const child of [...group.children])attempt(()=>group.remove(child));if(errors.length)throw new AggregateError(errors,'Dwelling cleanup callbacks failed');}};
}
