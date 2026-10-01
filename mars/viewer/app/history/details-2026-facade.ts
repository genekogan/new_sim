import * as T from 'three';
import {Kit,layers} from './kit';

/** Source facade correction: original GLB immutable; IDs retained. Native upper
 * mural UVs and south access/doorway evidence: review-20260929/FACADE.md. */
export function add2026FacadeDetails(root:T.Group){
 const chiba=root.getObjectByName('Chiba')??root;
 let target:T.Object3D|undefined;
 chiba.traverse(o=>{if(o.userData.component_id==='wood_component-0666'||o.name==='wood_component-0666')target=o;});
 if(!target)return [];
 root.updateMatrixWorld(true);
 const changed:T.Object3D[]=[];
 target.traverse(o=>{if((o as T.Mesh).isMesh&&!o.userData.review2026WestWall){const wall=o as T.Mesh;if(correctWestFace(wall,chiba))changed.push(wall);}});
 const access=addSouthAccess(chiba);if(access)changed.push(access);
 return changed;
}
function correctWestFace(wall:T.Mesh,chiba:T.Object3D){
 const toChiba=chiba.matrixWorld.clone().invert().multiply(wall.matrixWorld);
 const source=wall.geometry,geometry=source.index?source.toNonIndexed():source.clone();
 const position=geometry.getAttribute('position');
 const uv=geometry.getAttribute('uv')?.clone()??new T.BufferAttribute(new Float32Array(position.count*2),2);
 geometry.setAttribute('uv',uv);
 const originalMaterials=Array.isArray(wall.material)?wall.material:[wall.material];
 const texture=new T.TextureLoader().load('/history/2026/review-20260929/chiba-west-upper-wall.webp');texture.colorSpace=T.SRGBColorSpace;texture.userData.source='DJI_0029.MP4 t23.00 four-corner upper-wall rectification';
 const material=new T.MeshStandardMaterial({map:texture,roughness:.94});material.name='2026 west upper wall · native t23 photograph';
 const newIndex=originalMaterials.length,groups=geometry.groups.map(g=>({...g}));geometry.clearGroups();
 const point=(i:number)=>new T.Vector3().fromBufferAttribute(position,i).applyMatrix4(toChiba);
 const origin=new T.Vector3(-8.47875,0,8.925),u=new T.Vector3(.9045,0,.4265),v=new T.Vector3(.4265,0,-.9045);
 // Bounds measured directly from the existing CAD mesh, not inferred from photo.
 const vMin=.136175644,vMax=11.29201689,zMin=3.167496443,zMax=6.122027874;
 let faces=0;
 for(let i=0;i<position.count;i+=3){
  const a=point(i),b=point(i+1),c=point(i+2),normal=b.clone().sub(a).cross(c.clone().sub(a)).normalize();
  const center=a.clone().add(b).add(c).multiplyScalar(1/3),U=center.clone().sub(origin).dot(u);
  const old=groups.find(g=>i>=g.start&&i<g.start+g.count)?.materialIndex??0;
  const selected=normal.dot(u)<-.9&&Math.abs(U)<.15;
  if(selected){
   for(let j=0;j<3;j++){const p=point(i+j),V=p.clone().sub(origin).dot(v);uv.setXY(i+j,(vMax-V)/(vMax-vMin),(p.y-zMin)/(zMax-zMin));}
   faces++;
  }
  geometry.addGroup(i,3,selected?newIndex:old);
 }
 if(!faces){geometry.dispose();material.dispose();texture.dispose();return false;}
 uv.needsUpdate=true;wall.geometry=geometry;wall.material=[...originalMaterials,material];
 wall.userData.review2026WestWall={source:'media/drone/2026/DJI_0029.MP4',timestamp_seconds:23,faces,method:'Manually registered planar native frame; no geometry changes; original illumination retained',uncertainty:'Four-corner correspondence approximate; wall dimensions retain source CAD.'};
 return true;
}


/** Subtract a rectangular doorway from the original wall triangles, interpolating
 * original UVs/normals. This retains all finish outside the opening and IDs. */
function cutDoor(mesh:T.Mesh,toHall:T.Matrix4){
 const g=mesh.geometry.index?mesh.geometry.toNonIndexed():mesh.geometry.clone();
 const names=Object.keys(g.attributes),sizes=names.map(n=>g.getAttribute(n).itemSize),offsets:number[]=[];let len=0;for(const size of sizes){offsets.push(len);len+=size;}
 const pOffset=offsets[names.indexOf('position')],out:number[][]=names.map(()=>[]),groups=g.groups.map(q=>({...q}));
 const pos=(v:number[])=>new T.Vector3(v[pOffset],v[pOffset+1],v[pOffset+2]).applyMatrix4(toHall);
 const coord=(v:number[],axis:number)=>{const p=pos(v);return axis===0?(p.x+8.47875)*.9045+(p.z-8.925)*.4265:p.y;};
 const clip=(poly:number[][],axis:number,bound:number,less:boolean)=>{const result:number[][]=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],av=coord(a,axis)-bound,bv=coord(b,axis)-bound,ina=less?av<=0:av>=0,inb=less?bv<=0:bv>=0;if(ina)result.push(a);if(ina!==inb){const t=av/(av-bv);result.push(a.map((x,j)=>x+(b[j]-x)*t));}}return result;};
 const geometry=new T.BufferGeometry();let emitted=0;
 const emit=(poly:number[][],material:number)=>{for(let j=1;j<poly.length-1;j++){for(const v of [poly[0],poly[j],poly[j+1]])names.forEach((_,k)=>out[k].push(...v.slice(offsets[k],offsets[k]+sizes[k])));geometry.addGroup(emitted,3,material);emitted+=3;}};
 for(let i=0;i<g.getAttribute('position').count;i+=3){let poly:number[][]=[];for(let j=0;j<3;j++){const vertex:number[]=[];names.forEach((n,k)=>{const a=g.getAttribute(n);for(let c=0;c<sizes[k];c++)vertex.push(a.array[(i+j)*sizes[k]+c]);});poly.push(vertex);}
  const material=groups.find(q=>i>=q.start&&i<q.start+q.count)?.materialIndex??0;
  // Disjoint exterior pieces: left, right, below, above. Interior remainder drops.
  for(const [axis,bound,less]of [[0,1.45,true],[0,2.40,false],[1,3.28,true],[1,5.30,false]]as const){emit(clip(poly,axis,bound,less),material);poly=clip(poly,axis,bound,!less);if(!poly.length)break;}
 }
 names.forEach((n,k)=>geometry.setAttribute(n,new T.Float32BufferAttribute(out[k],sizes[k])));geometry.computeBoundingBox();geometry.computeBoundingSphere();mesh.geometry=geometry;mesh.userData.review2026SouthDoor='True aperture U1.45–2.40, z3.28–5.30; fitted t160; original UVs interpolated';g.dispose();
}
function addSouthAccess(chiba:T.Object3D){
 if(chiba.children.some(o=>o.userData.assembly_id==='chiba-south-access'))return;
 const panels:T.Object3D[]=[];chiba.traverse(o=>{if(['wood_component-0699','wood_component-0700','wood_component-0702'].includes(o.userData.component_id))panels.push(o);});
 if(panels.length!==3)return; // Do not invent an access assembly without its CAD anchors.
 chiba.updateMatrixWorld(true);const inverse=chiba.matrixWorld.clone().invert();
 for(const panel of panels)panel.traverse(o=>{if((o as T.Mesh).isMesh&&!o.userData.review2026SouthDoor)cutDoor(o as T.Mesh,inverse.clone().multiply(o.matrixWorld));});
 const k=new Kit(2026),angle=-Math.atan2(.4265,.9045),g=k.assembly('chiba-south-access','Chiba · source south flight and yellow upper door',[-8.47875,0,8.925],angle,'DJI0010; DJI0029 t130/t160: seven broad treads plus upper landing, yellow door; fitted run/width, CAD landing datum');
 const top=3.086,depth=.91,landingDepth=1.22,width=3.6576,run=landingDepth+7*depth,rise=top/8;
 for(let i=0;i<8;i++){
  const landing=i===7,y=rise*(i+1),z=landing?landingDepth/2:run-depth*(i+.5),d=landing?landingDepth:depth;
  const color=['#d4cbb3','#d9ded4','#d9ded4','#ddd8c7','#b5666b','#4c8196','#a0a9a4','#aaa48b'][i];
  const deck=k.box(g,landing?'south access upper landing':'south access broad tread',[width,.05,d],[width/2,y-.025,z],color,layers.detail);deck.userData.source='Native DJI0029t160 visible step ordering; thickness fitted';
  k.box(g,'south stair orange front beam',[width,.12,.07],[width/2,y-.11,z+d/2-.035],'#a84027',layers.steel);
  for(const x of [.075,width-.075])k.box(g,'south stair grounded support',[.06,y-.05,.06],[x,(y-.05)/2,z+d/2-.09],'#afb9b5',layers.steel);
 }
 // Source timber handrails on both sides, retained clear central walking route.
 for(const x of [.055,width-.055]){
  for(const i of [0,2,4,6,7]){const z=i===7?.12:run-depth*(i+.9),y=rise*(i+1),railY=rise+.88+(top-rise)*(run-.05-z)/(run-.17);k.box(g,'south stair timber guard post',[.055,railY-y+.02,.055],[x,(y+railY+.02)/2,z],'#b7a178',layers.detail);}
  k.rod(g,'south stair sloping timber handrail',[x,rise+.88,run-.05],[x,top+.88,.12],.035,'#c2ae83',layers.detail);
 }
 // The source threshold has small intermediate blocks above the broad landing.
 k.box(g,'south door threshold lower',[1.02,.095,.52],[1.925,top+.0475,.30],'#aaa28d',layers.detail);
 k.box(g,'south door threshold upper',[.98,.099,.44],[1.925,top+.1445,.10],'#b9ad90',layers.detail);
 for(const x of [1.425,2.425])k.box(g,'south upper doorway jamb',[.05,2.08,.07],[x,4.29,-.015],'#8d7453',layers.detail);
 k.box(g,'south upper doorway header',[1.10,.06,.08],[1.925,5.33,-.015],'#8d7453',layers.detail);
 // Open yellow leaf lies to the left of the dark doorway in the actual t160 image.
 k.box(g,'south source yellow door leaf',[.91,2.0,.04],[.965,4.28,.04],'#c5a329',layers.detail);
 k.box(g,'south yellow door upper glass',[.67,.44,.014],[.965,4.94,.067],'#596e74',layers.detail);
 for(const x of [.605,1.325])k.box(g,'south yellow door window stile',[.035,.50,.025],[x,4.94,.076],'#bcb79e',layers.detail);
 for(const y of [4.70,5.18])k.box(g,'south yellow door window rail',[.75,.035,.025],[.965,y,.076],'#bcb79e',layers.detail);
 k.box(g,'south yellow door handle',[.045,.19,.035],[1.31,4.25,.079],'#626259',layers.detail);
 // c50158 source pattern and wire guard infill on the broad upper stair.
 const motif=new T.Mesh(new T.PlaneGeometry(1.10,1.25),k.photo('/history/2026/accuracy/stair-white-pixel-motif.webp'));motif.position.set(3.18,4.44,.023);k.tag(g,motif,'Chiba native white black pixel fascia c50158',layers.detail);motif.userData.walkNoCollision=true;
 k.box(g,'Chiba west upper sliding door black track',[2.28,.075,.045],[1.26,5.35,.087],'#343c39',layers.detail);
 for(const x of [.67,1.20])k.box(g,'Chiba sliding door track roller',[.05,.19,.07],[x,5.30,.105],'#343c39',layers.detail);
 for(const side of [.057,width-.057])for(let i=0;i<20;i++){const z=run-depth*3.2-i*.095,y=rise+.88+(top-rise)*(run-.05-z)/(run-.17);k.rod(g,'Chiba stair fine wire guard infill',[side,y-.65,z],[side,y-.06,z],.003,'#a2aaa1',layers.detail);}
 g.userData.accuracy='CAD landing top3.086 retained; 3.6576width,7.59run,dooropening and7rises+landing fitted from March aerials, not surveyed. Source shows broad bleacher steps, not conventional fine stairs.';
 k.finalize();chiba.add(g);return g;
}
