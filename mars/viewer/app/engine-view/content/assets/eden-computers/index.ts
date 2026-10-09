import * as THREE from 'three';
import {VertexSoup,local} from '../vertex-soup.ts';
/** Computers at the desks inside Eden's buildings (scenery only): a monitor, keyboard and mouse with a tower
 * under the desk at the office's six workstations (three floors) and the library's east writing desk, and an
 * open laptop on the bedroom desks of houses 3 and 4. Bodies and peripherals are one merged mesh; the screens
 * are a second, softly self-lit mesh (a desktop's blue-white, a little brighter at night). Two draws.
 * Activity spots `use-computer` (proposal: CONTRACTS/proposals/WORLD-COMPUTERS-use-computer.md). */
export type Desk={id:string;at:[number,number,number];yaw:number;kind:'desktop'|'laptop';floorY?:number};
/** Work position on each desk (x, desk-top y, z) and the yaw the screen faces (toward the chair). */
export const COMPUTER_DESKS:readonly Desk[]=Object.freeze([
 ...[0,1,2].flatMap(lv=>[91.3,94.4].map((x,i)=>({id:`office-${lv}-${i+1}`,at:[x,.95+lv*3,15.22] as [number,number,number],yaw:0,kind:'desktop' as const}))),
 {id:'library-east',at:[75.65,.85,-9],yaw:0,kind:'desktop',floorY:.1},
 {id:'house-3-bedroom',at:[29.3,.95,31.0],yaw:0,kind:'laptop'},
 {id:'house-4-bedroom',at:[49.3,.95,31.0],yaw:0,kind:'laptop'},
]);
const SCREEN=['#cfe3f4','#d9ecf0','#e6e1f4','#d2ecdc'];
export function createEdenComputers(ground:(x:number,z:number)=>number|null){
 if(typeof ground!=='function')return null;
 const body=new VertexSoup(),screen=new VertexSoup();
 COMPUTER_DESKS.forEach((d,i)=>{const L=local(d.at,d.yaw),y=0;
  if(d.kind==='desktop'){
   body.box(L(0,y+.01,-.12),[.2,.02,.16],'#2a2d30',d.yaw);body.box(L(0,y+.12,-.13),[.04,.22,.03],'#2a2d30',d.yaw);
   body.box(L(0,y+.36,-.12),[.56,.34,.035],'#1c1e20',d.yaw);screen.box(L(0,y+.36,-.1),[.51,.29,.006],SCREEN[i%SCREEN.length],d.yaw);
   body.box(L(0,y+.01,.16),[.44,.018,.14],'#2f3236',d.yaw);for(let r=0;r<3;r++)body.box(L(0,y+.022,.12+r*.035),[.39,.006,.022],'#cfd2d4',d.yaw);
   body.box(L(.3,y+.012,.17),[.06,.024,.1],'#2f3236',d.yaw);
   const t=L(.42,0,0);body.box([t[0],(d.floorY??d.at[1]-.85)+.2,t[2]],[.18,.4,.42],'#2a2d30',d.yaw);
  }else{
   body.box(L(0,y+.009,.04),[.33,.018,.23],'#9aa0a6',d.yaw);body.box(L(0,y+.02,.06),[.29,.004,.12],'#3a3f44',d.yaw);
   body.box(L(0,y+.12,-.085),[.33,.22,.012],'#9aa0a6',d.yaw,-.25);screen.box(L(0,y+.12,-.078),[.29,.18,.004],SCREEN[(i+1)%SCREEN.length],d.yaw,-.25);
  }});
 const mb=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.5,metalness:.2});mb.name='Eden computers';
 const ms=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.2,metalness:0,emissive:'#ffffff',emissiveIntensity:.0});ms.name='Eden computer screens (lit)';
 // the screen's own colour is its light: steady by day, a little brighter against the dark at night
 ms.onBeforeCompile=sh=>{sh.fragmentShader=sh.fragmentShader.replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance+=diffuseColor.rgb*'+(sh.uniforms.uEdenNight?'(.55+.35*uEdenNight.x)':'.6')+';');};
 ms.customProgramCacheKey=()=>'eden-computer-screens-v1';
 const a=new THREE.Mesh(body.geometry(),mb),b=new THREE.Mesh(screen.geometry(),ms);a.name='computers: monitors, keyboards, towers, laptops';b.name='computers: screens';
 for(const m of [a,b]){m.castShadow=m===a;m.receiveShadow=true;m.userData.cameraTransparent=true;}
 const group=new THREE.Group();group.name='Eden computers (scenery only)';group.add(a,b);
 let closed=false;
 return {group,stats:{draws:2,triangles:body.triangles+screen.triangles,computers:COMPUTER_DESKS.length},dispose(){if(closed)return;closed=true;group.removeFromParent();a.geometry.dispose();b.geometry.dispose();mb.dispose();ms.dispose();}};
}
