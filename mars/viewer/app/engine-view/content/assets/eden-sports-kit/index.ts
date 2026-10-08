import * as THREE from 'three';
import {VertexSoup,local} from '../vertex-soup.ts';
/** Sports in the park, on the walkable ground east and south of the pond (scenery only): a sand beach-volleyball
 * court with its net, a gravel pétanque court with boules, a jack and a bench, a few frisbees on the grass, and an
 * outdoor gym along the south edge of the South lawn (by the avenue) — rubber mat, pull-up bars, dip bars, two flat benches, a bench press
 * with a loaded barbell, a dumbbell and kettlebell rack and an open mat for floor exercises. One merged mesh.
 * Activity spots + Core proposal: CONTRACTS/proposals/WORLD-SPORTS-gym-volleyball-petanque.md. */
export const SPORTS_PLAN=Object.freeze({
 volleyball:{court:[9,111,27,121] as const,net:18},
 petanque:{court:[.5,121.5,3.5,134.5] as const},
 gym:{mat:[-16.5,83,2.5,87] as const},
});
const C={sand:'#dccb98',line:'#f4f1e8',post:'#d9d9d4',net:'#2a2d30',gravel:'#b7ab93',timber:'#8a6440',steel:'#4a4f55',chrome:'#c9ccd0',rubber:'#3e4a40',pad:'#2f3a44',iron:'#25282b',red:'#b8392f',blue:'#2f5d8a',yellow:'#e2b552',green:'#4f7d4a',white:'#f4f1e8',orange:'#e8743a'};
export function createEdenSportsKit(ground:(x:number,z:number)=>number|null){
 if(typeof ground!=='function')return null;
 const P=SPORTS_PLAN,gy=(x:number,z:number)=>{const y=ground(x,z);return y!==null&&Number.isFinite(y)?y:0;};
 const s=new VertexSoup();
 // beach volleyball: sand pit, boundary tapes, net on two posts across the middle (along z)
 {const [x0,z0,x1,z1]=P.volleyball.court,cx=(x0+x1)/2,cz=(z0+z1)/2,y=gy(cx,cz);
  s.box([cx,y+.02,cz],[x1-x0,.05,z1-z0],C.sand);
  for(const [a,b] of [[[x0+1,z0+1],[x1-1,z0+1]],[[x0+1,z1-1],[x1-1,z1-1]],[[x0+1,z0+1],[x0+1,z1-1]],[[x1-1,z0+1],[x1-1,z1-1]]] as const)s.box([(a[0]+b[0])/2,y+.05,(a[1]+b[1])/2],[Math.abs(b[0]-a[0])+.05,.006,Math.abs(b[1]-a[1])+.05],C.line);
  const nx=P.volleyball.net;for(const z of [z0+.6,z1-.6]){s.cyl([nx,y+1.25,z],.05,2.5,C.post,8);}
  s.box([nx,y+2.15,cz],[.02,.9,z1-z0-1.3],C.net);s.box([nx,y+2.6,cz],[.03,.06,z1-z0-1.3],C.white);
  for(let k=0;k<9;k++)s.box([nx,y+1.72+k*.1,cz],[.025,.008,z1-z0-1.3],C.white);
  s.ball([nx-3,y+.13,cz+2],.11,C.yellow);}
 // pétanque: gravel court with a timber border, boules and the jack, a bench alongside
 {const [x0,z0,x1,z1]=P.petanque.court,cx=(x0+x1)/2,cz=(z0+z1)/2,y=gy(cx,cz);
  s.box([cx,y+.015,cz],[x1-x0,.03,z1-z0],C.gravel);
  for(const [x,z,w,d] of [[x0,cz,.12,z1-z0+.12],[x1,cz,.12,z1-z0+.12],[cx,z0,x1-x0,.12],[cx,z1,x1-x0,.12]])s.box([x,y+.07,z],[w,.14,d],C.timber);
  s.ball([cx+.2,y+.05,z0+4],.03,C.orange);
  for(const [dx,dz] of [[.1,3.3],[-.4,4.6],[.6,5.1],[-.2,3.8],[.45,2.9],[-.6,5.6]])s.ball([cx+dx,y+.07,z0+dz],.04,C.chrome);
  const L=local([x1+1.1,y,cz],Math.PI/2);s.box(L(0,.45,0),[1.6,.06,.4],C.timber,Math.PI/2);for(const dx of [-.65,.65])s.box(L(dx,.22,0),[.08,.44,.36],C.steel,Math.PI/2);}
 // frisbees resting on the grass between the courts
 for(const [x,z,c] of [[6.5,118.5,C.red],[7.2,124,C.yellow],[-1.5,119,C.blue]] as const){const y=gy(x,z);s.cyl([x,y+.02,z],.13,.025,c,14);}
 // outdoor gym
 {const [x0,z0,x1,z1]=P.gym.mat,zc=(z0+z1)/2,y=gy((x0+x1)/2,zc),Y=Math.PI/2,L=local([x0+.5,y,zc],Y); // the gym runs along +x (local z)
  s.box([(x0+x1)/2,y+.02,zc],[x1-x0,.04,z1-z0],C.rubber);
  // pull-up bars: three heights
  [[-1.4,2.0],[0,2.25],[1.4,2.45]].forEach(([dx,h],i)=>{if(i===0)s.cyl(L(dx-.7,h/2,1.5),.05,h,C.steel,8,Y);s.cyl(L(dx+.7,h/2,1.5),.05,h,C.steel,8,Y);s.cyl(L(dx,h,1.5),.022,1.4,C.chrome,8,Y,0,Math.PI/2);});
  // dip bars
  for(const dx of [-.3,.3]){for(const dz of [3.6,4.6])s.cyl(L(dx,.6,dz),.04,1.2,C.steel,8,Y);s.cyl(L(dx,1.2,4.1),.025,1.1,C.chrome,8,Y,Math.PI/2);}
  // two flat benches
  for(const dz of [6.4,8.2]){s.box(L(0,.42,dz),[1.25,.08,.3],C.pad,Y);for(const dx of [-.5,.5])s.box(L(dx,.2,dz),[.06,.4,.3],C.steel,Y);}
  // bench press: bench, uprights with the bar on its hooks, plates
  {const dz=11;s.box(L(0,.45,dz),[.3,.08,1.2],C.pad,Y);for(const ddz of [-.45,.45])s.box(L(0,.22,dz+ddz),[.28,.44,.06],C.steel,Y);
   for(const dx of [-.55,.55]){s.cyl(L(dx,.6,dz-.45),.035,1.2,C.steel,8,Y);s.box(L(dx,.98,dz-.45),[.12,.04,.08],C.chrome,Y);}
   s.cyl(L(0,1.02,dz-.45),.016,1.9,C.chrome,8,Y,0,Math.PI/2);for(const dx of [-.78,-.72,.72,.78])s.cyl(L(dx,1.02,dz-.45),.2,.04,C.iron,14,Y,0,Math.PI/2);}
  // dumbbell + kettlebell rack
  {const dz=14;s.box(L(0,.35,dz),[1.6,.05,.4],C.steel,Y);s.box(L(0,.7,dz),[1.6,.05,.4],C.steel,Y);for(const dx of [-.75,.75])s.box(L(dx,.4,dz),[.05,.8,.38],C.steel,Y);
   for(let k=0;k<5;k++){const dx=-.6+k*.3,r=.05+k*.012;for(const yy of [.4,.75])for(const e of [-.12,.12])s.cyl(L(dx,yy+r,dz+e),r,.05,C.iron,10,Y,Math.PI/2);for(const yy of [.4,.75])s.cyl(L(dx,yy+r,dz),.014,.24,C.chrome,6,Y,Math.PI/2);}
   for(const dx of [-.5,0,.5]){s.ball(L(dx,.15,dz+.65),.12,C.iron);s.cyl(L(dx,.31,dz+.65),.05,.03,C.iron,10,Y,0,Math.PI/2);}}
  // floor-exercise mat area
  s.box(L(0,.05,16.3),[2.4,.012,1.3],C.blue,Y);
  s.box(L(-1.85,.6,16.3),[.4,1.1,.06],C.steel,Y);s.box(L(-1.85,1.05,16.33),[.36,.3,.01],C.white,Y);}
 const mat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.75,metalness:.1});mat.name='Eden sports kit (courts, gym)';
 const mesh=new THREE.Mesh(s.geometry(),mat);mesh.name='sports: volleyball, petanque, outdoor gym';mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData.cameraTransparent=true;
 const group=new THREE.Group();group.name='Eden sports kit (scenery only)';group.add(mesh);
 let closed=false;
 return {group,plan:P,stats:{draws:1,triangles:s.triangles},dispose(){if(closed)return;closed=true;group.removeFromParent();mesh.geometry.dispose();mat.dispose();}};
}
