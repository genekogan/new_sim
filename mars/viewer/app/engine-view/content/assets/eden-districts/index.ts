import * as THREE from 'three';
import {VertexSoup,local} from '../vertex-soup.ts';
/** District identity (scenery only): each quarter gets its own colours on a pair of banner poles at its
 * approaches and a few things that say what the place is —
 *  - Harbour (boardwalk): lobster pots, rope coils, buoys, a crate stack, an anchor and life rings; navy and white.
 *  - Artists' quarter (yurt, A-frame, tower house): a stacked painted-block sculpture, a painted sphere on a plinth,
 *    a paint-spattered drop cloth; plum and ochre.
 *  - Observatory hill: a brass telescope on its tripod, a sundial, a star-chart board; midnight blue and gold.
 *  - Market street (kiosks and the market hall): a fruit cart, a flower barrow; red and cream.
 * Poles and props are one merged mesh; the banner cloths a second (they belly in the wind: the atmosphere's
 * banner sway finds them by name). Two draws. Positions checked clear of every built object and path. */
type Dist={id:string;colors:[string,string];poles:[number,number,number][]};
export const DISTRICTS:readonly Dist[]=Object.freeze([
 {id:'harbour',colors:['#2f4f7c','#f4f1e8'],poles:[[30.4,0,135],[-35.2,0,135]]},
 {id:'artists',colors:['#7a5c9e','#d9a441'],poles:[[60.5,0,-22.5],[70,0,-12.5]]},
 {id:'observatory',colors:['#1f2c4a','#e2b552'],poles:[[33.5,0,78.5],[39.6,0,77.4]]},
 {id:'market',colors:['#b8392f','#f1e6cf'],poles:[[53,0,-28.8],[63.5,0,32.5]]},
]);
const C={timber:'#8a6440',dark:'#2c3033',iron:'#3a3f44',brass:'#c9a24b',stone:'#b9ad97',rope:'#c8b48a',red:'#c43b2e',white:'#f4f1e8',orange:'#e8743a',yellow:'#f1c84b',green:'#4f7d4a',plum:'#7a5c9e',teal:'#3f8481'};
export function createEdenDistricts(ground:(x:number,z:number)=>number|null){
 if(typeof ground!=='function')return null;
 const gy=(x:number,z:number)=>{const y=ground(x,z);return y!==null&&Number.isFinite(y)?y:0;};
 const s=new VertexSoup(),cloth=new VertexSoup();
 // banner poles: a pole with a crossbar and a long two-colour banner
 for(const d of DISTRICTS)for(const [x,,z] of d.poles){const y=gy(x,z),yaw=Math.atan2(x-40,z-30);
  s.cyl([x,y+1.9,z],.05,3.8,C.dark,8);s.ball([x,y+3.85,z],.07,C.brass);const L=local([x,y,z],yaw);s.cyl(L(0,3.55,.28),.02,.62,C.dark,6,yaw,Math.PI/2);
  cloth.box(L(0,2.95,.3),[.02,1.15,.5],d.colors[0],yaw);cloth.box(L(.012,3.2,.3),[.02,.16,.5],d.colors[1],yaw);cloth.box(L(.012,2.6,.3),[.02,.08,.5],d.colors[1],yaw);
  cloth.box(L(0,2.33,.3),[.02,.1,.5],d.colors[1],yaw,0,0);}
 // harbour: on the boardwalk (deck .55) between benches and lamps
 {const y=.55;
  for(let k=0;k<3;k++)for(let j=0;j<2-(k>1?1:0);j++){const x=5+j*.75+k*.35,yy=y+k*.42;s.box([x,yy+.2,137.1],[.68,.4,.5],C.timber);s.box([x,yy+.2,137.1],[.6,.32,.52],C.rope);}
  for(const [x,z] of [[16.5,137.05],[17.3,137.2]] as const){for(let k=0;k<4;k++)s.cyl([x,y+.03+k*.045,z],.3-k*.04,.04,C.rope,14);}
  for(const [x,z,c] of [[18.4,137.0,C.red],[18.9,137.2,C.white],[18.6,137.5,C.orange]] as const)s.ball([x,y+.18,z],.18,c,[1,1.2,1]);
  for(let k=0;k<3;k++)for(let j=0;j<3-k;j++)s.box([44.6+j*.5+k*.25,y+.15+k*.3,137.05],[.48,.3,.4],k%2?'#9c7a52':'#8a6a48');
  {const x=57,z=137.2;s.cyl([x,y+.6,z],.05,1.2,C.iron,8);s.cyl([x,y+1.2,z],.03,.7,C.iron,8,0,0,Math.PI/2);s.add(new THREE.TorusGeometry(.32,.04,6,12,Math.PI),[x,y+.3,z],C.iron,0,0,Math.PI);s.box([x,y+.04,z],[.7,.08,.5],C.stone);}
  for(const x of [-12.6,24.6,72.6]){s.add(new THREE.TorusGeometry(.3,.07,6,16),[x,y+.7,141.33],C.orange,0,0,0);for(let a=0;a<4;a++)s.box([x+Math.cos(a*Math.PI/2)*.3,y+.7+Math.sin(a*Math.PI/2)*.3,141.33],[.09,.09,.15],C.white);}}
 // artists' quarter
 {const y=gy(62,-24);[[0,.25,0,C.plum],[.12,.7,.05,C.yellow],[-.06,1.12,-.04,C.teal],[.08,1.5,.03,C.red]].forEach(([dx,yy,dz,c],i)=>s.box([62+(dx as number),y+(yy as number),-24+(dz as number)],[.5-i*.06,.42,.5-i*.06],c as string,i*.5,0,i%2?.12:-.1));
  const y2=gy(66,-25.5);s.box([66,y2+.4,-25.5],[.5,.8,.5],C.stone);s.ball([66,y2+1.15,-25.5],.36,C.yellow);for(let k=0;k<5;k++){const a=k*1.25;s.ball([66+Math.cos(a)*.25,y2+1.15+Math.sin(a*1.7)*.2,-25.5+Math.sin(a)*.25],.09,[C.red,C.teal,C.plum,C.green,C.white][k]);}
  const y3=gy(64.4,-27.2);s.box([64.4,y3+.006,-27.2],[1.8,.012,1.2],'#e8e2d2',.3);for(let k=0;k<14;k++){const a=k*2.4,r=.15+(k%5)*.12;s.box([64.4+Math.cos(a)*r,y3+.014,-27.2+Math.sin(a)*r*.6],[.09,.004,.07],[C.red,C.teal,C.plum,C.yellow][k%4],a);}}
 // observatory hill
 {const x=39.8,z=83,y=gy(x,z);for(let k=0;k<3;k++){const a=k*2.094+.4;s.rod([x,y+1.05,z],[x+Math.cos(a)*.45,y,z+Math.sin(a)*.45],.018,C.timber);}
  s.cyl([x,y+1.12,z],.05,.12,C.brass,8);s.cyl([x+.12,y+1.32,z-.25],.075,.95,C.brass,12,0,-1.05);s.cyl([x+.12,y+1.56,z-.66],.09,.12,C.dark,12,0,-1.05);
  const sx=33,sz=81.5,sy=gy(sx,sz);s.cyl([sx,sy+.45,sz],.18,.9,C.stone,8);s.cyl([sx,sy+.92,sz],.28,.05,C.brass,16);s.box([sx,sy+1.03,sz],[.02,.18,.24],C.brass,.6,0,0);
  const bx=39.6,bz=80.8,by=gy(bx,bz),L=local([bx,by,bz],Math.PI);for(const dx of [-.45,.45])s.box(L(dx,.6,0),[.06,1.2,.06],C.timber,Math.PI);s.box(L(0,1.15,0),[1.0,.7,.04],'#1f2c4a',Math.PI);
  for(let k=0;k<16;k++){const u=((k*37)%17)/17-.5,v=((k*53)%13)/13-.5;s.box(L(u*.85,1.15+v*.55,-.025),[.025,.025,.01],k%5?'#f4f1e8':C.brass,Math.PI);}}
 // market street: a fruit cart and a flower barrow
 {const x=64.5,z=26.5,y=gy(x,z),L=local([x,y,z],.4);s.box(L(0,.75,0),[1.3,.12,.75],C.timber,.4);for(const dz of [-.36,.36])s.add(new THREE.TorusGeometry(.28,.04,6,12),L(.2,.3,dz),C.dark,.4);
  s.rod(L(-.65,.75,-.25),L(-1.25,.5,-.25),.025,C.timber);s.rod(L(-.65,.75,.25),L(-1.25,.5,.25),.025,C.timber);s.box(L(-.2,.4,0),[.06,.7,.06],C.timber,.4);
  for(let k=0;k<12;k++)s.ball(L(-.45+(k%4)*.3,.88+(k>7?.08:0),-.22+Math.floor(k/4)*.22),.08,[C.red,C.orange,C.yellow,C.green][k%4]);
  const fx=66.2,fz=25.2,fy=gy(fx,fz);s.box([fx,fy+.45,fz],[.8,.35,.5],'#5f7f8f');for(let k=0;k<5;k++){s.cyl([fx-.3+k*.15,fy+.72,fz],.06,.18,C.green,6);s.ball([fx-.3+k*.15,fy+.84,fz],.08,['#e86aa8','#f1c84b','#d9485f','#f4f1e8','#9b6fd1'][k]);}}
 const mA=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.7,metalness:.08});mA.name='Eden district dressing';
 const mB=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.9,side:THREE.DoubleSide});mB.name='district banners';
 const a=new THREE.Mesh(s.geometry(),mA),b=new THREE.Mesh(cloth.geometry(),mB);a.name='districts: poles and props';b.name='district banners';
 for(const m of [a,b]){m.castShadow=true;m.receiveShadow=true;m.userData.cameraTransparent=true;}
 const group=new THREE.Group();group.name='Eden district identity (scenery only)';group.add(a,b);
 let closed=false;
 return {group,stats:{draws:2,triangles:s.triangles+cloth.triangles},dispose(){if(closed)return;closed=true;group.removeFromParent();a.geometry.dispose();b.geometry.dispose();mA.dispose();mB.dispose();}};
}
