/** Original seating appearance and uninstalled affordance proposals only. */
import * as THREE from 'three';
import {ThreeResources} from '../../../../lib/three-resources.ts';
export type ContentView={readonly group:THREE.Group;dispose():void};
export type SeatingKind='couch'|'floor-mat'|'yoga-mat';
type V3=readonly[number,number,number];
type Part={name:string;shape:'box'|'cushion';colour:string;p:V3;size:V3};
export type SeatingProposal={name:string;purpose:'sitting'|'floor-sitting'|'stretching-or-lying';centre:V3;size:readonly[number,number];direction:V3;status:'uninstalled-proposal'};
export function inspectSeatingPrefab(kind:SeatingKind){
 if(!['couch','floor-mat','yoga-mat'].includes(kind))throw Error('Unknown seating kind');
 const parts:Part[]=[],zones:SeatingProposal[]=[],clearances:{name:string;min:V3;max:V3;status:'uninstalled-proposal'}[]=[];
 const add=(name:string,colour:string,p:V3,size:V3,shape:Part['shape']='box')=>parts.push({name,colour,p,size,shape});
 if(kind==='couch'){
  for(const x of [-.91,.91])for(const z of [-.31,.31])add('timber-foot:'+x+':'+z,'#70533b',[x,.065,z],[.10,.13,.10]);
  add('timber-front-rail','#a7784f',[0,.15,.42],[2,.06,.06]);
  add('upholstered-base','#52734a',[0,.20,0],[2.2,.18,.9],'cushion');
  for(const [i,x,y]of [[0,-.49,.45],[1,.49,.46]]){
   add('seat-cushion:'+i,i?'#78945c':'#82915c',[x,y-.08,.035],[.94,.16,.65],'cushion');
   add('back-cushion:'+i,i?'#52734a':'#365540',[x,.59,-.365],[.96,.44,.17],'cushion');
   zones.push({name:'couch-seat:'+i,purpose:'sitting',centre:[x,y,.10],size:[.76,.46],direction:[0,0,1],status:'uninstalled-proposal'});
  }
  for(const x of [-1.02,1.02])add('arm:'+x,'#52734a',[x,.3825,0],[.16,.445,.9],'cushion');
  add('small-side-cushion','#d8cbb1',[-.78,.56,-.21],[.23,.22,.12],'cushion');
  clearances.push({name:'front-approach',min:[-1.1,0,.45],max:[1.1,1.75,1.25],status:'uninstalled-proposal'});
 }else if(kind==='floor-mat'){
  add('woven-body','#a79880',[0,.009,0],[1.8,.018,1.5]);
  for(const x of [-.865,.865])add('side-woven-border:'+x,'#70533b',[x,.019,0],[.055,.002,1.5]);
  for(const z of [-.715,.715])add('end-woven-border:'+z,'#70533b',[0,.019,z],[1.69,.002,.055]);
  for(let i=0;i<6;i++)add('sparse-weave:'+i,i%2?'#d8cbb1':'#a7784f',[-.65+i*.26,.0185,0],[.012,.001,1.36]);
  for(const x of [-.45,.45])zones.push({name:'floor-sitting:'+x,purpose:'floor-sitting',centre:[x,.018,0],size:[.65,.7],direction:[0,0,1],status:'uninstalled-proposal'});
  clearances.push({name:'open-above-mat',min:[-.9,.02,-.75],max:[.9,1.77,.75],status:'uninstalled-proposal'});
 }else{
  add('mat-body','#365540',[0,.009,0],[.65,.018,1.8]);
  for(const x of [-.3025,.3025])add('contrast-side-border:'+x,'#78945c',[x,.019,0],[.025,.002,1.8]);
  for(const z of [-.835,.835])add('end-mark:'+z,'#82915c',[0,.019,z],[.55,.002,.015]);
  // No rolled end: entire labelled zone is a thin flat proposed surface.
  zones.push({name:'stretching-or-lying',purpose:'stretching-or-lying',centre:[0,.018,0],size:[.55,1.65],direction:[0,0,-1],status:'uninstalled-proposal'});
  clearances.push({name:'open-above-mat',min:[-.325,.02,-.9],max:[.325,1.77,.9],status:'uninstalled-proposal'});
 }
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const p of parts)for(let a=0;a<3;a++){min[a]=Math.min(min[a],p.p[a]-p.size[a]/2);max[a]=Math.max(max[a],p.p[a]+p.size[a]/2);}
 return {kind,units:'metres',origin:'base-centre',bounds:{min,max},size:max.map((n,i)=>n-min[i]),parts,zones,clearances,status:'uninstalled-proposal'};
}
function cushionGeometry(){
 const s=new THREE.Shape(),r=.06;s.moveTo(-.5+r,-.5);s.lineTo(.5-r,-.5);s.quadraticCurveTo(.5,-.5,.5,-.5+r);s.lineTo(.5,.5-r);s.quadraticCurveTo(.5,.5,.5-r,.5);s.lineTo(-.5+r,.5);s.quadraticCurveTo(-.5,.5,-.5,.5-r);s.lineTo(-.5,-.5+r);s.quadraticCurveTo(-.5,-.5,-.5+r,-.5);
 const g=new THREE.ExtrudeGeometry(s,{depth:1,bevelEnabled:false,curveSegments:2});g.rotateX(-Math.PI/2);g.translate(0,-.5,0);g.clearGroups();return g;
}
/** Unattached group. Caller supplies placement and rotation.y=-yaw. */
export function createSeatingPrefab(kind:SeatingKind):ContentView{
 const spec=inspectSeatingPrefab(kind),group=new THREE.Group();group.name='seating:'+kind;group.userData.inspection=spec;
 const resources=new ThreeResources(),geos=new Map<string,THREE.BufferGeometry>(),materials=new Map<string,THREE.MeshStandardMaterial>(),meshes:THREE.InstancedMesh[]=[];
 const batches=new Map<string,Part[]>();for(const p of spec.parts){const key=p.shape+':'+p.colour;const b=batches.get(key)??[];b.push(p);batches.set(key,b);}
 const matrix=new THREE.Matrix4(),v=new THREE.Vector3(),q=new THREE.Quaternion(),scale=new THREE.Vector3();
 for(const [key,parts]of batches){const first=parts[0];let geo=geos.get(first.shape);if(!geo){geo=first.shape==='box'?new THREE.BoxGeometry(1,1,1):cushionGeometry();geos.set(first.shape,geo);}let mat=materials.get(first.colour);if(!mat){mat=new THREE.MeshStandardMaterial({color:first.colour,roughness:1});materials.set(first.colour,mat);}
  const m=new THREE.InstancedMesh(geo,mat,parts.length);m.name=key;m.userData.partNames=parts.map(p=>p.name);parts.forEach((p,i)=>{matrix.compose(v.fromArray(p.p),q,scale.fromArray(p.size));m.setMatrixAt(i,matrix);});m.instanceMatrix.needsUpdate=true;m.computeBoundingBox();m.computeBoundingSphere();m.castShadow=m.receiveShadow=true;group.add(m);meshes.push(m);
 }
 // Resolve only the existing couch rail/base coplanar front; geometry and shared-kind materials stay exact.
 if(kind==='couch'){const rail=materials.get('#a7784f')!;rail.polygonOffset=true;rail.polygonOffsetFactor=-1;rail.polygonOffsetUnits=-1;}
 // Cosmetic inset piping on the four original seat/back cushions; no changed parts or support zones.
 if(kind==='couch'){
  const positions:number[]=[],corners=[[.405,.405,0],[-.405,.405,Math.PI/2],[-.405,-.405,Math.PI],[.405,-.405,Math.PI*1.5]],outer:number[][]=[],inner:number[][]=[];
  for(const [x,z,start]of corners)for(let step=0;step<=3;step++){const a=start+step*Math.PI/6;outer.push([x+.078*Math.cos(a),z+.078*Math.sin(a)]);inner.push([x+.072*Math.cos(a),z+.072*Math.sin(a)]);}
  for(const part of spec.parts.filter(p=>p.name.startsWith('seat-cushion:')||p.name.startsWith('back-cushion:'))){
   const back=part.name.startsWith('back-'),[x,y,z]=part.p,[sx,sy,sz]=part.size;
   const point=(p:number[])=>back?[x+p[0]*sx*.86,y+p[1]*sy,z+sz/2]:[x+p[0]*sx,y+sy/2,z+p[1]*sz];
   for(let i=0;i<outer.length;i++){const j=(i+1)%outer.length,a=point(outer[i]),b=point(inner[i]),c=point(inner[j]),d=point(outer[j]);
    // Front-plane piping faces +Z; seat-top piping faces +Y.
    for(const v of back?[a,c,b,a,d,c]:[a,b,c,a,c,d])positions.push(...v);
   }
  }
  const seamGeometry=new THREE.BufferGeometry();seamGeometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));seamGeometry.computeVertexNormals();seamGeometry.computeBoundingBox();seamGeometry.computeBoundingSphere();
  const seamMaterial=new THREE.MeshStandardMaterial({color:'#beb79a',roughness:1,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}),seam=new THREE.Mesh(seamGeometry,seamMaterial);seam.name='cosmetic original couch cushion piping';seam.receiveShadow=true;group.add(seam);
 }
 resources.object(group);let closed=false;return {group,dispose(){if(closed)return;closed=true;group.removeFromParent();meshes.forEach(m=>m.dispose());resources.dispose();group.clear();}};
}
