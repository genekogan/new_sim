// Original Little Martians-inspired landscape proposals, never canonical terrain.
import * as THREE from 'three';
export type VolcanicVistaKind='basalt-ridge'|'dormant-crater';
type P=[number,number,number];
const step=1.25,n=33;
function height(kind:VolcanicVistaKind,x:number,z:number){
  if(kind==='basalt-ridge'){if(Math.abs(x)<=2.5)return 0;const shoulder=Math.min(1,(Math.abs(x)-2.5)/2);return shoulder*(6.5+1.5*Math.sin(z*.19+Math.sign(x)))*Math.exp(-Math.pow((Math.abs(x)-7)/4.2,2))+.22*shoulder*(1+Math.sin(x*.4+z*.27));}
  const r=Math.hypot(x,z),a=Math.atan2(z,x);if(r>=14)return 0;const rim=7.4*(1+.12*Math.sin(a*5)+.07*Math.cos(a*3))*Math.exp(-Math.pow((r-8.3)/2.05,2));return rim+.28*Math.max(0,1-r/6);
}
export function inspectVolcanicLandscapeKit(kind:VolcanicVistaKind){
  if(kind!=='basalt-ridge'&&kind!=='dormant-crater')throw Error('Unknown volcanic vista kind');
  const vertices:P[]=[],indices:number[]=[];
  for(let z=0;z<n;z++)for(let x=0;x<n;x++){const px=-20+x*step,pz=-20+z*step;vertices.push([px,height(kind,px,pz),pz]);}
  for(let z=0;z<n-1;z++)for(let x=0;x<n-1;x++){const a=z*n+x;indices.push(a,a+n+1,a+1,a,a+n,a+n+1);}
  const sample=(x:number,z:number)=>{const gx=(x+20)/step,gz=(z+20)/step,i=Math.min(31,Math.max(0,Math.floor(gx))),j=Math.min(31,Math.max(0,Math.floor(gz))),u=gx-i,v=gz-j,a=vertices[j*n+i][1],b=vertices[j*n+i+1][1],c=vertices[(j+1)*n+i][1],d=vertices[(j+1)*n+i+1][1];return u>=v?a*(1-u)+b*(u-v)+d*v:a*(1-v)+c*(v-u)+d*u;};
  const rocks:{id:string;p:P;radius:number;height:number;phase:number}[]=[];
  if(kind==='basalt-ridge'){for(const side of[-1,1])for(let i=0;i<7;i++){const x=side*(5.4+1.1*Math.sin(i*1.7)),z=-14+i*4.2,r=.8+.19*(i%3);rocks.push({id:'basalt-'+rocks.length,p:[x,sample(x,z),z],radius:r,height:2.2+(i%4)*.9,phase:i*.57});}}
  else for(let i=0;i<12;i++){const a=i*2.399,r=9.8+Math.sin(i)*.5,x=Math.cos(a)*r,z=Math.sin(a)*r;rocks.push({id:'rim-rock-'+i,p:[x,sample(x,z),z],radius:.62+(i%3)*.14,height:.75+(i%4)*.33,phase:i*.7});}
  const rockVertices:P[]=[],rockIndices:number[]=[],rockBands:number[]=[];
  for(const rock of rocks){const start=rockVertices.length,sides=7;
    for(let layer=0;layer<4;layer++)for(let j=0;j<sides;j++){const a=j*Math.PI*2/sides+rock.phase,r=rock.radius*(1-.11*layer)*(1+.06*Math.sin(j*2.1+rock.phase)),x=rock.p[0]+Math.cos(a)*r,z=rock.p[2]+Math.sin(a)*r,y=layer===0?sample(x,z):Math.max(rockVertices[start+(layer-1)*sides+j][1]+rock.height/3,sample(x,z)+rock.height*layer/3);rockVertices.push([x,y,z]);rockBands.push(layer);}
    // Terrain-fitted bottom ring. Capped top; embedded footprint base is proposed terrain.
    for(let layer=0;layer<3;layer++)for(let j=0;j<sides;j++){const a=start+layer*sides+j,b=start+layer*sides+(j+1)%sides,c=b+sides,d=a+sides;rockIndices.push(a,c,b,a,d,c);}
    const cap=rockVertices.length;rockVertices.push([rock.p[0],Math.max(...rockVertices.slice(start+21,start+28).map(p=>p[1]))+.03,rock.p[2]]);rockBands.push(3);for(let j=0;j<sides;j++)rockIndices.push(cap,start+21+(j+1)%sides,start+21+j);
  }
  return{kind,status:'proposed original sculptural landscape' as const,units:'metres',boundsXZ:[-20,-20,20,20],vertices,indices,rockVertices,rockIndices,rockBands,rocks,clearance:kind==='basalt-ridge'?{type:'floor corridor',boundsXZ:[-1,-20,1,20],heightClearance:2.3,datumY:0}:{type:'outer viewing ring',innerRadius:14,outerRadius:17,datumY:0},maximumHeight:Math.max(...vertices.map(p=>p[1]),...rockVertices.map(p=>p[1])),support:false,topology:'32x32 grid,1.25m spacing, min-min/max-max triangles; rock foot rings sample actual triangle surface',sampledRockRoots:rocks.map(r=>({id:r.id,p:[...r.p]}))};
}
export function createVolcanicLandscapeKit(kind:VolcanicVistaKind):{group:THREE.Group;dispose():void}{
  const s=inspectVolcanicLandscapeKit(kind),group=new THREE.Group(),owned:(THREE.BufferGeometry|THREE.Material)[]=[];
  const release=()=>{const errors:unknown[]=[];for(const f of[()=>group.removeFromParent(),...owned.map(r=>()=>r.dispose()),()=>group.clear()])try{f();}catch(e){errors.push(e);}return errors;};
  const mesh=(vertices:P[],indices:number[],colours:string[],name:string,roughness:number)=>{const geometry=new THREE.BufferGeometry();owned.push(geometry);geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices.flat(),3));geometry.setIndex(indices);geometry.setAttribute('color',new THREE.Float32BufferAttribute(colours.flatMap(c=>{const colour=new THREE.Color(c);return[colour.r,colour.g,colour.b];}),3));geometry.computeVertexNormals();const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness,metalness:.06});owned.push(material);const object=new THREE.Mesh(geometry,material);object.name=name;object.castShadow=object.receiveShadow=true;group.add(object);};
  try{mesh(s.vertices,s.indices,s.vertices.map(([x,y,z])=>y>5?'#705d68':y>2?'#8a6b67':Math.sin(x*.39+z*.25)>.4?'#bd916e':'#a78269'),'proposed volcanic triangular ground',.94);mesh(s.rockVertices,s.rockIndices,s.rockBands.map(i=>['#514752','#635567','#847082','#625468'][i]),'sculptural basalt rock strata',.65);group.name='Proposed '+kind+' Little Martians landscape';}
  catch(error){const errors=release();if(errors.length)throw new AggregateError([error,...errors],'Volcanic landscape rollback failed',{cause:error});throw error;}
  let closed=false;return{group,dispose(){if(closed)return;closed=true;const errors=release();if(errors.length)throw new AggregateError(errors,'Volcanic landscape disposal failed',{cause:errors[0]});}};
}
