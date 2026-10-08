/** Original rural shell. Geometry, floor, entry and frame are uninstalled proposals. */
import * as THREE from 'three';
type Part={name:string;p:[number,number,number];size:[number,number,number];colour:string;pitch:number};
function variant(value:unknown){if(value!=='standard')throw new TypeError('Unsupported farm barn variant');}
export function inspectFarmBarnProposal(value:'standard'='standard'){
 variant(value);const parts:Part[]=[],box=(name:string,p:Part['p'],size:Part['size'],colour:string,pitch=0)=>parts.push({name,p,size,colour,pitch});
 box('proposed-floor',[0,.05,0],[12,.1,8],'#a79880');
 for(let i=0;i<40;i++)box('north-board:'+i,[-5.85+i*.3,1.8,-3.92],[.3,3.4,.16],i%4?'#a7784f':'#ad9269');
 for(const side of[-1,1])for(let i=0;i<14;i++)box('south-side-board:'+side+':'+i,[side*(1.2+(i+.5)*4.8/14),1.8,3.92],[4.8/14,3.4,.16],i%4?'#a7784f':'#ad9269');
 for(let i=0;i<8;i++)box('entry-head-board:'+i,[-1.05+i*.3,3.1,3.92],[.3,.8,.16],'#a7784f');
 for(const x of[-5.92,5.92])for(let i=0;i<26;i++)box('gable-side-board:'+x+':'+i,[x,1.8,-4+(i+.5)*8/26],[.16,3.4,8/26],i%4?'#a7784f':'#ad9269');
 for(const x of[-5.6,5.6])for(const z of[-3.6,3.6])box('interior-frame-post:'+x+':'+z,[x,1.74,z],[.2,3.28,.2],'#70533b');
 for(const z of[-3.6,3.6])box('eave-timber:'+z,[0,3.38,z],[11.4,.2,.2],'#70533b');
 const angle=Math.atan2(2,4.2),length=Math.hypot(2,4.2)-.09;
 for(const x of[-5.6,0,5.6]){box('raised-tie-beam:'+x,[x,3.24,0],[.16,.18,7.4],'#70533b');for(const side of[-1,1])box('pitched-rafter:'+x+':'+side,[x,4.4,side*2.1],[.16,.16,length],'#70533b',side*angle);}
 return{status:'proposed-uninstalled',nativeSupport:false,variant:value,origin:'local base-centre/metres/Y-up; caller negative renderer yaw',mainFootprintXZ:[-6,-4,6,4],bounds:{min:[-6.2,0,-4.2],max:[6.2,5.5,4.2]},wallTopY:3.5,ridgeY:5.5,floor:{boundsXZ:[-6,-4,6,4],topY:.1,status:'proposed'},entry:{side:'south/+Z',x:[-1.2,1.2],y:[.1,2.7],z:[3.84,4.08],width:2.4,clearHeight:2.6,doors:'omitted/open geometry'},clearPath:{bodyRadius:.28,bodyHeight:1.75,centreX:[-.92,.92],centreZ:[0,5.2],floorY:.1},roof:{boundsXZ:[-6.2,-4.2,6.2,4.2],eaveTopY:3.5,ridgeTopY:5.5,verticalThickness:.12},frame:{lowestRaisedTieBottomY:3.15,postsOutsideClearPath:true},outsideStepMetres:.1,parts,limits:['floor and frame/roof loading not admitted','outside0→floor.1 step is not accessible/terrain-qualified','no animal/crop/product/activity or door-controller truth']};
}
function roofGeometry(){
 const positions:number[]=[],indices=[0,1,2,0,2,3,4,7,6,4,6,5,0,4,5,0,5,1,1,5,6,1,6,2,2,6,7,2,7,3,3,7,4,3,4,0];
 for(const side of[-1,1]){const z0=side<0?-4.2:0,z1=side<0?0:4.2,y0=side<0?3.5:5.5,y1=side<0?5.5:3.5,v=[[-6.2,y0-.12,z0],[6.2,y0-.12,z0],[6.2,y1-.12,z1],[-6.2,y1-.12,z1],[-6.2,y0,z0],[6.2,y0,z0],[6.2,y1,z1],[-6.2,y1,z1]];for(const i of indices)positions.push(...v[i]);}
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();return geometry;
}
export function createFarmBarnProposal(value:'standard'='standard'):{readonly group:THREE.Group;dispose():void}{
 const spec=inspectFarmBarnProposal(value),group=new THREE.Group();group.name='farm-barn:proposed-uninstalled';group.userData.inspection=structuredClone(spec);const cube=new THREE.BoxGeometry(1,1,1),geometries:THREE.BufferGeometry[]=[cube],materials=new Map<string,THREE.MeshStandardMaterial>(),instances:THREE.InstancedMesh[]=[];
 const material=(colour:string)=>{let m=materials.get(colour);if(!m){m=new THREE.MeshStandardMaterial({color:colour,roughness:.94});materials.set(colour,m);}return m;};const batches=new Map<string,Part[]>();for(const p of spec.parts){const list=batches.get(p.colour)??[];list.push(p);batches.set(p.colour,list);}const matrix=new THREE.Matrix4(),position=new THREE.Vector3(),scale=new THREE.Vector3(),rotation=new THREE.Quaternion();for(const[colour,parts]of batches){const mesh=new THREE.InstancedMesh(cube,material(colour),parts.length);mesh.name='barn-parts:'+colour;mesh.userData.parts=structuredClone(parts);parts.forEach((p,i)=>{rotation.setFromAxisAngle(new THREE.Vector3(1,0,0),p.pitch);matrix.compose(position.fromArray(p.p),rotation,scale.fromArray(p.size));mesh.setMatrixAt(i,matrix);});mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingBox();mesh.computeBoundingSphere();mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);instances.push(mesh);}
 const roof=roofGeometry(),roofMesh=new THREE.Mesh(roof,material('#776f60'));roofMesh.name='pitched-painted-roof';roofMesh.castShadow=roofMesh.receiveShadow=true;group.add(roofMesh);geometries.push(roof);
 const shape=new THREE.Shape();shape.moveTo(-4,3.5);shape.lineTo(4,3.5);shape.lineTo(0,5.5);shape.closePath();const gable=new THREE.ExtrudeGeometry(shape,{depth:.16,bevelEnabled:false});geometries.push(gable);for(const x of[-6,5.84]){const mesh=new THREE.Mesh(gable,material('#a7784f'));mesh.name='gable-upper-wall:'+x;mesh.position.x=x;mesh.rotation.y=Math.PI/2;mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);}
 let closed=false;return{group,dispose(){if(closed)return;closed=true;const errors:unknown[]=[],attempt=(f:()=>void)=>{try{f();}catch(e){errors.push(e);}};attempt(()=>group.removeFromParent());for(const m of instances)attempt(()=>m.dispose());for(const g of geometries)attempt(()=>g.dispose());for(const m of materials.values())attempt(()=>m.dispose());for(const child of[...group.children])attempt(()=>group.remove(child));instances.length=0;geometries.length=0;materials.clear();if(errors.length)throw new AggregateError(errors,'Farm barn cleanup failed');}};
}
