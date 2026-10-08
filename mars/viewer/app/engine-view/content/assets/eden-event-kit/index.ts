import * as THREE from 'three';
import {VertexSoup,local} from '../vertex-soup.ts';
/** Event kit (scenery only, ready for the happenings Core schedules): the performance stage gets a band's
 * backline (drum kit, keyboard, guitar and bass on stands with amps, two microphones, monitor wedges and a pair
 * of PA speakers on tripods) and festoon bulbs along its roof; the amphitheatre's painted stage a microphone,
 * a stool with a guitar and two small speakers; the bandstand a string quartet's chairs, music stands, a cello
 * and a violin; and paper lanterns are strung over the bandstand green to the market stalls. One merged
 * vertex-coloured mesh plus one night-lit lantern mesh (two draws). Lanterns and bulbs publish glow anchors
 * (`paper-lantern` / `festoon`) for the viewer's lamp halos. Activity spots and Core proposal:
 * CONTRACTS/proposals/WORLD-EVENTS-stage-music.md. */
export const EVENT_KIT_PLAN=Object.freeze({
 stage:{deck:[89,-32,95,-28] as const,top:.6},
 amphitheatre:{stage:[76,80.6] as const},
 bandstand:{c:[38.5,-26] as const,top:.35},
 lanternPoles:[[48.5,-29.8],[48.5,-22.2]] as const,
});
const C={black:'#1f2124',dark:'#2c3033',chrome:'#c9ccd0',wood:'#8a5a36',maple:'#d9a45f',red:'#b8392f',cream:'#efe6d2',grey:'#5b6066',blue:'#2f5d8a',brass:'#c9a24b',walnut:'#5a3a22',cloth:'#3a3f44'};
function micStand(s:VertexSoup,L:ReturnType<typeof local>,x:number,z:number,y0:number){
 for(let k=0;k<3;k++){const a=k*2.094;s.rod(L(x,y0,z),L(x+Math.cos(a)*.28,y0,z+Math.sin(a)*.28),.012,C.black);}
 s.rod(L(x,y0,z),L(x,y0+1.45,z),.013,C.black);s.rod(L(x,y0+1.45,z),L(x,y0+1.52,z+.32),.01,C.black);s.ball(L(x,y0+1.54,z+.36),.035,C.chrome,[1,1,1.4]);
}
function guitarOnStand(s:VertexSoup,L:ReturnType<typeof local>,x:number,z:number,y0:number,body:string,yaw:number){
 s.rod(L(x-.18,y0,z-.15),L(x,y0+.55,z-.05),.012,C.black);s.rod(L(x+.18,y0,z-.15),L(x,y0+.55,z-.05),.012,C.black);s.rod(L(x,y0,z+.2),L(x,y0+.55,z-.05),.012,C.black);
 s.box(L(x,y0+.32,z),[.34,.38,.08],body,yaw,-.12);s.box(L(x,y0+.58,z-.03),[.28,.2,.08],body,yaw,-.12);
 s.box(L(x,y0+.95,z-.08),[.05,.6,.03],C.walnut,yaw,-.12);s.box(L(x,y0+1.3,z-.12),[.08,.14,.03],C.black,yaw,-.12);
 s.cyl(L(x,y0+.36,z+.045),.05,.01,C.black,10,yaw,Math.PI/2-.12);
}
function speakerOnTripod(s:VertexSoup,L:ReturnType<typeof local>,x:number,z:number,y0:number,yaw:number){
 for(let k=0;k<3;k++){const a=k*2.094+.5;s.rod(L(x,y0+.55,z),L(x+Math.cos(a)*.45,y0,z+Math.sin(a)*.45),.015,C.black);}
 s.rod(L(x,y0,z),L(x,y0+1.45,z),.02,C.black);
 s.box(L(x,y0+1.8,z),[.42,.66,.36],C.black,yaw);s.cyl(L(x,y0+1.7,z+.185),.13,.01,C.grey,14,yaw,Math.PI/2);s.cyl(L(x,y0+1.98,z+.185),.06,.01,C.grey,10,yaw,Math.PI/2);
}
function drumKit(s:VertexSoup,L:ReturnType<typeof local>,x:number,z:number,y0:number,yaw:number){
 s.cyl(L(x,y0+.28,z),.28,.38,C.red,16,yaw,Math.PI/2);s.cyl(L(x,y0+.28,z+.195),.25,.01,C.cream,16,yaw,Math.PI/2);
 s.cyl(L(x+.42,y0+.62,z+.18),.18,.14,C.red,14);s.cyl(L(x+.42,y0+.7,z+.18),.18,.005,C.cream,14);s.rod(L(x+.42,y0,z+.18),L(x+.42,y0+.55,z+.18),.012,C.chrome);
 s.cyl(L(x-.16,y0+.72,z+.02),.15,.14,C.red,14,0,.25);s.cyl(L(x+.16,y0+.72,z+.02),.15,.14,C.red,14,0,.25);
 s.cyl(L(x-.45,y0+.42,z-.05),.2,.38,C.red,14);
 for(const [dx,h] of [[-.6,1.05],[.65,1.15],[.55,.85]] as const){s.rod(L(x+dx,y0,z+.05),L(x+dx,y0+h,z+.05),.01,C.chrome);s.cyl(L(x+dx,y0+h+.01,z+.05),.21,.008,C.brass,16,0,.12);}
 s.cyl(L(x,y0+.25,z-.6),.17,.06,C.black,12);s.rod(L(x,y0,z-.6),L(x,y0+.22,z-.6),.02,C.chrome);
}
function keyboard(s:VertexSoup,L:ReturnType<typeof local>,x:number,z:number,y0:number,yaw:number){
 s.rod(L(x-.45,y0,z-.15),L(x+.45,y0+.8,z+.15),.015,C.black);s.rod(L(x+.45,y0,z-.15),L(x-.45,y0+.8,z+.15),.015,C.black);
 s.box(L(x,y0+.85,z),[1.22,.08,.32],C.black,yaw);s.box(L(x,y0+.895,z+.06),[1.14,.012,.16],C.cream,yaw);
 for(let k=0;k<14;k++)if(k%7!==2&&k%7!==6)s.box(L(x-.53+k*.08,y0+.905,z+.03),[.03,.012,.09],C.black,yaw);
}
function amp(s:VertexSoup,L:ReturnType<typeof local>,x:number,z:number,y0:number,yaw:number){s.box(L(x,y0+.24,z),[.5,.46,.28],C.black,yaw);s.box(L(x,y0+.2,z+.142),[.42,.3,.005],C.cloth,yaw);s.box(L(x,y0+.43,z+.142),[.42,.05,.006],C.brass,yaw);}
function wedge(s:VertexSoup,L:ReturnType<typeof local>,x:number,z:number,y0:number,yaw:number){s.box(L(x,y0+.15,z),[.5,.3,.36],C.black,yaw,-.5);}
function chair(s:VertexSoup,L:ReturnType<typeof local>,x:number,z:number,y0:number,yaw:number){const l=local(L(x,y0,z),yaw);
 for(const [dx,dz] of [[-.18,-.18],[.18,-.18],[-.18,.18],[.18,.18]])s.box(l(dx,.22,dz),[.03,.44,.03],C.black,yaw);s.box(l(0,.46,0),[.42,.04,.42],C.walnut,yaw);s.box(l(0,.72,-.2),[.42,.5,.03],C.walnut,yaw);}
function musicStand(s:VertexSoup,L:ReturnType<typeof local>,x:number,z:number,y0:number,yaw:number){s.rod(L(x,y0,z),L(x,y0+1.05,z),.01,C.black);s.box(L(x,y0+1.15,z),[.48,.32,.01],C.black,yaw,-.35);s.box(L(x,y0+1.16,z+.012),[.4,.26,.004],C.cream,yaw,-.35);}
function cello(s:VertexSoup,L:ReturnType<typeof local>,x:number,z:number,y0:number,yaw:number,scale=1){
 s.ball(L(x,y0+.3*scale,z),.24*scale,C.maple,[1,1.25,.45]);s.ball(L(x,y0+.62*scale,z),.18*scale,C.maple,[1,1.2,.45]);
 s.box(L(x,y0+1.0*scale,z),[.045*scale,.5*scale,.04*scale],C.black,yaw);s.box(L(x,y0+1.3*scale,z),[.06*scale,.12*scale,.05*scale],C.walnut,yaw);
 if(scale>.6)s.rod(L(x,y0,z),L(x,y0+.1,z),.006,C.chrome);
}
const LANTERN=['#e8473a','#f1c84b','#f4f1e8','#ef8a3a','#e86aa8','#7fb3d9'];
export function createEdenEventKit(ground:(x:number,z:number)=>number|null){
 if(typeof ground!=='function')return null;
 const P=EVENT_KIT_PLAN,flat=(x:number,z:number)=>{const y=ground(x,z);return y!==null&&Number.isFinite(y)&&Math.abs(y)<1e-3;};
 if(![[92,-30],[76,80.6],[38.5,-26],...P.lanternPoles].every(([x,z])=>flat(x,z)))return null;
 const s=new VertexSoup(),glow=new VertexSoup(),anchors:[number,number,number,string,number][]=[];
 // performance stage (front = +z, deck top .6)
 {const L=local([92,0,-30],0),y=P.stage.top;
  drumKit(s,L,0,-1.05,y,0);keyboard(s,L,1.7,-1.05,y,-.25);amp(s,L,-1.55,-1.5,y,.3);amp(s,L,2.4,-1.55,y,-.3);
  guitarOnStand(s,L,-2.3,-.9,y,C.red,.2);guitarOnStand(s,L,2.45,-.6,y,C.blue,-.2);
  micStand(s,L,0,1.25,y);micStand(s,L,-1.4,1.1,y);wedge(s,L,0,1.75,y,0);wedge(s,L,-1.4,1.7,y,.1);
  speakerOnTripod(s,L,-3.6,2.3,0,.25);speakerOnTripod(s,L,3.6,2.3,0,-.25);
  // festoon bulbs under the front edge of the roof
  for(let k=0;k<=12;k++){const x=-2.85+k*.475,sag=.12*Math.sin(Math.PI*((k%4)/4)),p=L(x,2.98-sag,1.95);glow.ball(p,.045,'#ffe7b0');anchors.push([p[0],p[1],p[2],'festoon',1]);}}
 // amphitheatre painted stage (audience on the steps to +z)
 {const L=local([76,0,80.6],0);micStand(s,L,0,-.1,.03);speakerOnTripod(s,L,-1.9,-.9,0,.4);speakerOnTripod(s,L,1.9,-.9,0,-.4);
  s.cyl(L(.75,.33,-.35),.18,.04,C.walnut,12);for(let k=0;k<3;k++){const a=k*2.094;s.rod(L(.75,.31,-.35),L(.75+Math.cos(a)*.18,0,-.35+Math.sin(a)*.18),.012,C.black);}
  guitarOnStand(s,L,1.15,-.55,.03,C.maple,-.3);}
 // bandstand: a string quartet in a half circle facing the opening (+z)
 {const L=local([38.5,0,-26],0),y=P.bandstand.top;
  [[-1.2,-.2,.7],[-.45,-.75,.25],[.45,-.75,-.25],[1.2,-.2,-.7]].forEach(([x,z,yaw],i)=>{chair(s,L,x,z,y,yaw);musicStand(s,L,x+Math.sin(yaw)*.55,z+Math.cos(yaw)*.55,y,yaw);
   if(i===3)cello(s,L,x+.35,z+.25,y,yaw);else if(i===0)cello(s,L,x-.3,z+.1,y+.46,yaw,.45);});
  s.box(L(0,y+.06,.6),[.7,.12,.5],C.walnut,0);}
 // paper lanterns strung from the bandstand eaves to two poles and on to the market stalls
 {const poles=P.lanternPoles.map(([x,z])=>[x,0,z] as [number,number,number]);
  for(const [x,,z] of poles){s.rod([x,0,z],[x,3.45,z],.06,C.walnut);s.cyl([x,.05,z],.16,.1,C.grey,8);}
  const runs:[number[],number[]][]=[[[41.75,3.05,-26.9],[poles[0][0],3.35,poles[0][2]]],[[41.75,3.05,-25.1],[poles[1][0],3.35,poles[1][2]]],[[poles[0][0],3.35,poles[0][2]],[poles[1][0],3.35,poles[1][2]]],[[poles[0][0],3.35,poles[0][2]],[53.7,2.3,-27.1]]];
  let n=0;for(const [a,b] of runs){const len=Math.hypot(b[0]-a[0],b[2]-a[2]),steps=Math.max(3,Math.round(len/.9)),pts:number[][]=[];
   for(let k=0;k<=steps;k++){const t=k/steps;pts.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t-.45*4*t*(1-t),a[2]+(b[2]-a[2])*t]);}
   for(let k=1;k<pts.length;k++)s.rod(pts[k-1],pts[k],.006,C.dark);
   for(let k=1;k<pts.length-1;k++){const p=pts[k],c=LANTERN[(n++)%LANTERN.length];glow.ball([p[0],p[1]-.2,p[2]],.13,c,[1,1.15,1],8);s.cyl([p[0],p[1]-.05,p[2]],.05,.05,C.dark,6);anchors.push([p[0],p[1]-.2,p[2],'paper-lantern',1]);}}}
 const matA=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.6,metalness:.1});matA.name='Eden event kit (stage, instruments, PA)';
 const matB=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.8});matB.name='Eden festival lanterns and bulbs (night-lit)';
 // the lanterns' own colour glows from inside at night (the viewer's shared night strength; inert without it)
 matB.onBeforeCompile=sh=>{if(!sh.uniforms.uEdenNight)return;sh.fragmentShader=sh.fragmentShader.replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance+=diffuseColor.rgb*uEdenNight.x*1.25;');};
 matB.customProgramCacheKey=()=>'eden-festival-lanterns-v1';
 const kit=new THREE.Mesh(s.geometry(),matA);kit.name='event kit: stage backline, PA, quartet, lantern poles';kit.castShadow=true;kit.receiveShadow=true;kit.userData.cameraTransparent=true;
 const lanterns=new THREE.Mesh(glow.geometry(),matB);lanterns.name='event kit: paper lanterns and festoon bulbs';lanterns.castShadow=false;lanterns.userData.cameraTransparent=true;
 const group=new THREE.Group();group.name='Eden event kit (scenery only)';group.add(kit,lanterns);group.userData.edenLightSources=anchors;
 let closed=false;
 return {group,plan:P,stats:{draws:2,triangles:s.triangles+glow.triangles,lanterns:anchors.length},dispose(){if(closed)return;closed=true;group.removeFromParent();kit.geometry.dispose();lanterns.geometry.dispose();matA.dispose();matB.dispose();}};
}
