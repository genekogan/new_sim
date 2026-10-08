// Original local decorative vocabulary; no placement, native support or growth.
import * as THREE from 'three';
export type UnderstoryKind='fern'|'flowering-shrub'|'vine';
type P=[number,number,number];type Batch={positions:number[];colours:number[];colour:string};
const batch=(colour:string):Batch=>({positions:[],colours:[],colour});
function tri(b:Batch,a:P,c:P,d:P,colour=b.colour){const col=new THREE.Color(colour);for(const p of [a,c,d]){b.positions.push(...p);b.colours.push(col.r,col.g,col.b);}}
function tube(b:Batch,points:P[],radius:number){
  const ring=(p:P,j:number):P=>[p[0]+Math.cos(j*Math.PI/3)*radius,p[1],p[2]+Math.sin(j*Math.PI/3)*radius];
  for(let i=0;i<points.length-1;i++)for(let j=0;j<6;j++){const a=ring(points[i],j),c=ring(points[i],j+1),d=ring(points[i+1],j+1),e=ring(points[i+1],j);tri(b,a,d,c);tri(b,a,e,d);}
  for(let j=0;j<6;j++){tri(b,points[0],ring(points[0],j),ring(points[0],j+1));tri(b,points.at(-1)!,ring(points.at(-1)!,j+1),ring(points.at(-1)!,j));}
}
function leaf(b:Batch,a:P,tip:P,width:number,colour:string,ridge=.009){
  const dx=tip[0]-a[0],dz=tip[2]-a[2],n=Math.hypot(dx,dz),side:[number,number]=n>0?[-dz/n,dx/n]:[1,0],mid:P=[a[0]+dx*.48,a[1]+(tip[1]-a[1])*.48,a[2]+dz*.48],left:P=[mid[0]+side[0]*width,mid[1],mid[2]+side[1]*width],right:P=[mid[0]-side[0]*width,mid[1],mid[2]-side[1]*width],rib:P=[mid[0],mid[1]+ridge,mid[2]];
  tri(b,a,left,rib,colour);tri(b,left,tip,rib,colour);tri(b,tip,right,rib,colour);tri(b,right,a,rib,colour);
}
function forms(kind:UnderstoryKind){const stems=batch('#6b7944'),leaves=batch('#52734a'),flowers=batch('#e3d7a7');
  if(kind==='fern'){
    for(let i=0;i<8;i++){const angle=i*2.399+.17,r=.25+.095*Math.sin(i*1.7),h=.48+.065*Math.cos(i*1.4),point=(t:number):P=>[Math.cos(angle)*r*Math.pow(t,1.25),h*(1.5*t-.5*t*t),Math.sin(angle)*r*Math.pow(t,1.25)];tube(stems,Array.from({length:10},(_,j)=>point(j/9)),.0045);
      for(let j=1;j<=7;j++){const t=j/9,p=point(t),len=.065*(1-t*.58),side=[-Math.sin(angle),Math.cos(angle)];for(const s of [-1,1])leaf(leaves,p,[p[0]+side[0]*s*len+Math.cos(angle)*.023,p[1]+.012-t*.026,p[2]+side[1]*s*len+Math.sin(angle)*.023],.013*(1-t*.3),j%3===0?'#78945c':'#52734a',.004);}
      const p=point(.89);leaf(leaves,p,point(1),.012,'#78945c',.004);
    }
  }else if(kind==='flowering-shrub'){
    for(let i=0;i<9;i++){const angle=i*2.399+.35,r=.26+.075*Math.sin(i*1.7),h=.72+.10*Math.cos(i*1.3),point=(t:number):P=>[Math.cos(angle)*r*t*t,h*t,Math.sin(angle)*r*t*t];tube(stems,Array.from({length:7},(_,j)=>point(j/6)),.008);
      for(let j=2;j<=6;j++){const p=point(j/6);for(const s of [-1,1]){const a=angle+s*(.65+j*.11),length=.105+.025*Math.sin(i+j);leaf(leaves,p,[p[0]+Math.cos(a)*length,p[1]+.018,p[2]+Math.sin(a)*length],.038+(i%3)*.006,(i+j)%3===0?'#78945c':'#365540',.014);}}
      if(i!==3){const p=point(1),centre:P=[p[0],p[1]+.025,p[2]];tube(stems,[p,centre],.003);for(let j=0;j<5;j++){const a=j*Math.PI*2/5+i*.43;leaf(flowers,centre,[centre[0]+Math.cos(a)*.043,centre[1]+.005,centre[2]+Math.sin(a)*.043],.014,i%3===0?'#cdb9a1':'#e3d7a7',.002);}}
    }
  }else{
    const point=(t:number):P=>[.024*Math.sin(t*Math.PI*3),1.5*t,.016*Math.sin(t*Math.PI*2)];tube(stems,Array.from({length:31},(_,j)=>point(j/30)),.0035);
    for(let j=1;j<=14;j++){const p=point(j/15),s=j%2===0?1:-1;leaf(leaves,p,[p[0]+s*(.105+.014*Math.sin(j)),p[1]+.035,p[2]+.025*Math.sin(j*1.7)],.032,j%3===0?'#78945c':'#52734a',.008);}
  }
  return[stems,leaves,...(flowers.positions.length?[flowers]:[])];
}
export function createForestUnderstory(kind:UnderstoryKind):{readonly group:THREE.Group;dispose():void}{
  if(kind!=='fern'&&kind!=='flowering-shrub'&&kind!=='vine')throw Error('Unknown forest understory kind');
  const data=forms(kind),group=new THREE.Group(),owned:(THREE.BufferGeometry|THREE.Material)[]=[];group.name='Original local '+kind+' appearance';
  const release=()=>{const errors:unknown[]=[];try{group.removeFromParent();}catch(e){errors.push(e);}for(const resource of owned){try{resource.dispose();}catch(e){errors.push(e);}}for(const child of [...group.children]){try{group.remove(child);}catch(e){errors.push(e);}}return errors;};
  try{for(const [i,b]of data.entries()){const geometry=new THREE.BufferGeometry();owned.push(geometry);geometry.setAttribute('position',new THREE.Float32BufferAttribute(b.positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(b.colours,3));geometry.computeVertexNormals();const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,side:i===0?THREE.FrontSide:THREE.DoubleSide});owned.push(material);const mesh=new THREE.Mesh(geometry,material);mesh.name=i===0?'curved stems':i===1?'two-sided leaf blades':'restrained five-petal flowers';mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);}}
  catch(error){const errors=release();if(errors.length)throw new AggregateError([error,...errors],'Understory creation and rollback failed',{cause:error});throw error;}
  let closed=false;return{group,dispose(){if(closed)return;closed=true;const errors=release();if(errors.length)throw new AggregateError(errors,'Understory disposal failed',{cause:errors[0]});}};
}
