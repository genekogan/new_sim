// Original cosmetic gravel union on accepted native flat Y0. No physical path grant.
import * as THREE from 'three';
import { ThreeResources } from '../../../../lib/three-resources.ts';
import type { ContentView } from './commons.ts';
type Point=[number,number];
export function inspectCommonsPaths(){
  const r=.7,angle=Math.atan2(-1,5),outline:Point[]=[];
  const arc=(x:number,z:number,start:number,end:number,steps:number)=>{for(let i=0;i<=steps;i++){const a=start+(end-start)*i/steps;outline.push([x+r*Math.cos(a),z+r*Math.sin(a)]);}};
  outline.push([4,5+r]);arc(9,5,Math.PI/2,Math.PI/2+angle,4);
  arc(14,4,Math.PI/2+angle,-Math.PI/2+angle,24);
  // Inner offset intersection, contained in both original capsule strips.
  outline.push([9+r*Math.tan(angle/2),5-r],[4,5-r]);arc(4,5,-Math.PI/2,-3*Math.PI/2,24);
  // Explicit authored local centres, far from the ribbon edge; seed-free fixed scatter.
  const centres:Point[]=[[4.1,5.1],[4.4,4.8],[4.7,5.2],[5,4.9],[5.3,5.3],[5.6,4.7],[5.9,5.1],[6.2,4.9],[6.5,5.3],[6.8,4.8],[7.1,5.15],[7.4,4.75],[7.7,5.3],[8,4.9],[8.3,5.1],[8.6,4.7],[8.9,5.2],[9.2,4.8],[9.5,5.1],[9.8,4.6],[10.1,4.95],[10.4,4.5],[10.7,4.8],[11,4.35],[11.3,4.65],[11.6,4.3],[11.9,4.6],[12.2,4.1],[12.5,4.45],[12.8,4],[13.1,4.3],[13.4,3.85],[13.7,4.1],[14,4.2]];
  const flecks=centres.map(([x,z],i)=>({id:'commons-path-fleck-'+i,p:[x,.006,z] as [number,number,number],size:[.09+(i%3)*.018,.006,.055+(i%2)*.015] as [number,number,number],yaw:i*.73}));
  return {nativeGroundY:0,cosmeticRibbonY:.002,maximumCosmeticY:.012,width:1.4,corridors:[[[14,0,4],[9,0,5]],[[9,0,5],[4,0,5]]],outline,flecks};
}
export function createCommonsPaths():ContentView{
  const data=inspectCommonsPaths(),group=new THREE.Group(),resources=new ThreeResources();group.name='Cosmetic corrected commons path union';
  const shape=new THREE.Shape(data.outline.map(([x,z])=>new THREE.Vector2(x,z))),geometry=new THREE.ShapeGeometry(shape);
  // Preserve X/Z authored plane; triangulation is one union without overlapping layers.
  const attr=geometry.attributes.position;for(let i=0;i<attr.count;i++){const x=attr.getX(i),z=attr.getY(i);attr.setXYZ(i,x,data.cosmeticRibbonY,z);}geometry.computeVertexNormals();
  const ribbon=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:'#baae91',roughness:1,side:THREE.DoubleSide}));ribbon.name='joined gravel ribbon';ribbon.receiveShadow=true;group.add(ribbon);
  const flecks=new THREE.InstancedMesh(new THREE.OctahedronGeometry(.5),new THREE.MeshStandardMaterial({color:'#d1c7b1',roughness:1}),data.flecks.length),matrix=new THREE.Matrix4(),rotation=new THREE.Quaternion();
  data.flecks.forEach((p,i)=>{rotation.setFromAxisAngle(new THREE.Vector3(0,1,0),-p.yaw);matrix.compose(new THREE.Vector3(...p.p),rotation,new THREE.Vector3(...p.size));flecks.setMatrixAt(i,matrix);});flecks.name='original shallow stone flecks';flecks.instanceMatrix.needsUpdate=true;flecks.computeBoundingBox();flecks.computeBoundingSphere();flecks.castShadow=flecks.receiveShadow=true;group.add(flecks);resources.object(group);
  let closed=false;return{group,dispose(){if(closed)return;closed=true;group.removeFromParent();flecks.dispose();resources.dispose();group.clear();}};
}
