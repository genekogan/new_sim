// Convex subtraction on NEW owned expansion meshes only; canonical shore never passed here.
import * as THREE from 'three';
import {triangulateWetUnion} from './wet-union.mjs';
function split(poly,a,b,sign){
 const value=p=>sign*((b[0]-a[0])*(p[2]-a[1])-(b[1]-a[1])*(p[0]-a[0])),inside=[],outside=[];
 for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length],u=value(p),v=value(q),pi=u>=-1e-9,qi=v>=-1e-9;(pi?inside:outside).push(p);if(pi!==qi){const t=u/(u-v),cross=p.map((n,k)=>n+(q[k]-n)*t);inside.push(cross);outside.push(cross);}}
 return{inside,outside};
}
/** A triangle/polygon minus one convex wet outline, retaining XYZ+optionalRGB. */
export function subtractWetPolygon(poly,outline){
 const sign=Math.sign(outline.reduce((a,p,i)=>{const q=outline[(i+1)%outline.length];return a+p[0]*q[1]-q[0]*p[1];},0));if(!sign)throw Error('Expansion wet outline has no area');
 const out=[];let remaining=poly;
 for(let i=0;i<outline.length&&remaining.length>=3;i++){const s=split(remaining,outline[i],outline[(i+1)%outline.length],sign);if(s.outside.length>=3)out.push(s.outside);remaining=s.inside;}return out;
}
function triangles(mesh,colors=false){
 const p=mesh.geometry.attributes.position,c=mesh.geometry.attributes.color,index=mesh.geometry.index,rows=[];mesh.updateWorldMatrix(true,false);
 for(let j=0;j<(index?.count??p.count);j+=3){const poly=[];for(let k=0;k<3;k++){const i=index?index.getX(j+k):j+k,v=new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld);poly.push([...v.toArray(),...(colors?[c.getX(i),c.getY(i),c.getZ(i)]:[])]);}rows.push(poly);}return rows;
}
function fan(polys,colors=false){const position=[],color=[];for(const p of polys)for(let i=1;i<p.length-1;i++)for(const v of[p[0],p[i],p[i+1]]){position.push(...v.slice(0,3));if(colors)color.push(...v.slice(3,6));}return{position,color};}
export function joinExpansionWater(entries,root,registerGeometry,registerMaterial){
 const outlines=entries.map(({owner})=>{const water=owner.group.children.find(m=>m.userData.cameraTransparent);water.updateWorldMatrix(true,false);const p=water.geometry.attributes.position;return Array.from({length:p.count-1},(_,i)=>{const v=new THREE.Vector3().fromBufferAttribute(p,i+1).applyMatrix4(water.matrixWorld);return[v.x,v.z];});});
 const removedBankFaces=[];
 for(let k=0;k<entries.length;k++){
  const {owner}=entries[k],water=owner.group.children.find(m=>m.userData.cameraTransparent),bed=owner.group.children.find(m=>!m.userData.cameraTransparent);
  if(!bed){owner.group.remove(water);removedBankFaces.push(0);continue;}
  const beds=[];let clipped=0;
  for(const tri of triangles(bed,true)){let pieces=[tri];for(let j=0;j<outlines.length;j++)if(j!==k)pieces=pieces.flatMap(p=>subtractWetPolygon(p,outlines[j]));if(pieces.length!==1||JSON.stringify(pieces[0])!==JSON.stringify(tri))clipped++;beds.push(...pieces);}
  const f=fan(beds,true),geometry=new THREE.BufferGeometry();registerGeometry(geometry);geometry.setAttribute('position',new THREE.Float32BufferAttribute(f.position,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(f.color,3));geometry.computeVertexNormals();
  // Geometry is owned new output. Original factory keeps/disposes its original geometry.
  bed.geometry=geometry;bed.matrix.identity();bed.matrixAutoUpdate=false;bed.position.set(0,0,0);bed.rotation.set(0,0,0);bed.scale.set(1,1,1);
  // Positions above are world coordinates; move the new bed into the root instead.
  owner.group.remove(bed);root.add(bed);owner.group.remove(water);removedBankFaces.push(clipped);
 }
 const unified=triangulateWetUnion(outlines),f={position:unified.positions},geometry=new THREE.BufferGeometry();registerGeometry(geometry);geometry.setAttribute('position',new THREE.Float32BufferAttribute(f.position,3));geometry.setIndex(unified.indices);geometry.computeVertexNormals();
 const material=new THREE.MeshStandardMaterial({color:'#286a8d',roughness:.32,transparent:true,opacity:.88,depthWrite:false});registerMaterial(material);
 const water=new THREE.Mesh(geometry,material);water.name='Connected NEW lake/river water union; no native water contacts';water.userData.cameraTransparent=true;water.raycast=()=>{};root.add(water);
 return{removedBankFaces,waterTriangles:unified.indices.length/3,boundaryLoops:unified.boundaryLoops,joinBedPolicy:'remove overlapping NEW bed pieces from internal wet overlap; buriedcosmeticground remains below; native originals untouched',scope:'NEW owned expansion water/above-water bank seams only'};
}
