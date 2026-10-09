import * as THREE from 'three';
/** Hot-air balloons drifting on slow, lazy loops over Eden (Gene's favourites; they used to hang
 * still in the merged Regions geometry). The three original balloons drift on their loops; a fourth takes off and lands at a supported festival meadow anchor. Every few
 * minutes its burner flares: the basket flame brightens and the envelope rises a little. ONE draw. All motion
 * is computed in the vertex shader from (time, per-balloon constants), so the CPU cost per frame is one uniform
 * write. Decorative: never a camera/raycast root, no shadows. Periods divide 7200 s because the atmosphere
 * clock wraps at 7200 s, so the loops never jump. */
export type Drifter={c:readonly [number,number];r:readonly [number,number];y:number;period:number;phase:number;s:number;cols:readonly string[];landing?:boolean};
export const DRIFTERS:readonly Drifter[]=[
 {c:[-190,40],r:[70,40],y:60,period:900,phase:0,s:4,cols:['#c43a2a','#f3eee2','#3d8ab0']},
 {c:[-140,140],r:[55,35],y:75,period:1200,phase:2.1,s:4.2,cols:['#7a4a8a','#f0c040']},
 {c:[295,62],r:[24,20],y:60,period:1200,phase:0,s:3.4,cols:['#c43a2a','#f0c040'],landing:true},
 {c:[-260,-20],r:[60,50],y:68,period:1440,phase:4.2,s:3.8,cols:['#5aa070','#f3eee2']},
];
/** Centre of the envelope at time t (same formula as the shader; used by tests and future rides). */
export function drifterAt(d:Drifter,t:number):[number,number,number]{const a=t*Math.PI*2/d.period+d.phase,bob=Math.sin(t*Math.PI*2/240+d.phase*3)*2.5;
 return [d.c[0]+Math.cos(a)*d.r[0],d.y+bob+burn(d,t)*1.2,d.c[1]+Math.sin(a)*d.r[1]];}
/** Vertical takeoff/landing stays over the clear authored meadow spot. Drift
 * begins only at cruise altitude and closes its loop before descent. */
export function landingDrifterAt(d:Drifter,t:number,landing:readonly [number,number,number]):[number,number,number]{
 const u=((t%d.period)+d.period)%d.period/d.period,smooth=(v:number)=>{const k=Math.max(0,Math.min(1,v));return k*k*(3-2*k);};
 const height=smooth((u-.075)/.1)*(1-smooth((u-.825)/.1)),f=Math.max(0,Math.min(1,(u-.175)/.65)),a=f*Math.PI*2;
 const floor=landing[1]+d.s*1.28+1.73,aloft=d.y+Math.sin(t*Math.PI*2/240)*2.5;
 return [landing[0]+(Math.cos(a)-1)*d.r[0],floor+(aloft-floor)*height,landing[2]+Math.sin(a)*d.r[1]];
}
/** 0..1 burner flare: one ~12 s burn every 90 s, staggered per balloon. */
export function burn(d:Drifter,t:number){const u=((t+d.phase*13)%90+90)%90;return u<12?Math.sin(u/12*Math.PI):0;}
const VERT_HEAD=/* glsl */`
attribute float aIdx;
attribute float aFlame;
uniform float uBalloonT;
uniform vec4 uBP[${DRIFTERS.length}]; // centre x, centre z, radius x, radius z
uniform vec4 uBL; // validated landing x, ground y, z, enabled
uniform vec4 uBQ[${DRIFTERS.length}]; // altitude, angular speed, phase, landing basket offset
float bBurn(float ph){float u=mod(uBalloonT+ph*13.0,90.0);return u<12.0?sin(u/12.0*3.14159):0.0;}
`;
export class Balloons{
 readonly mesh:THREE.Mesh;
 private uniforms={uBL:{value:new THREE.Vector4(0,0,0,0)},uBalloonT:{value:0},uBP:{value:DRIFTERS.map(d=>new THREE.Vector4(d.c[0],d.c[1],d.r[0],d.r[1]))},uBQ:{value:DRIFTERS.map(d=>new THREE.Vector4(d.y,Math.PI*2/d.period,d.phase,d.landing?d.s*1.28+1.73:0))}};
 constructor(){
  const pos:number[]=[],col:number[]=[],idx:number[]=[],flame:number[]=[],c=new THREE.Color();
  const tri=(i:number,f:number,color:string,...v:[number,number,number][])=>{c.set(color);for(const p of v){pos.push(...p);col.push(c.r,c.g,c.b);idx.push(i);flame.push(f);}};
  const quad=(i:number,f:number,color:string,a:[number,number,number],b:[number,number,number],cc:[number,number,number],d:[number,number,number])=>{tri(i,f,color,a,b,cc);tri(i,f,color,a,cc,d);};
  const box=(i:number,f:number,color:string,x:number,y:number,z:number,w:number,h:number,dd:number)=>{const X=[x-w/2,x+w/2],Y=[y,y+h],Z=[z-dd/2,z+dd/2];
   quad(i,f,color,[X[0],Y[0],Z[1]],[X[1],Y[0],Z[1]],[X[1],Y[1],Z[1]],[X[0],Y[1],Z[1]]);quad(i,f,color,[X[1],Y[0],Z[0]],[X[0],Y[0],Z[0]],[X[0],Y[1],Z[0]],[X[1],Y[1],Z[0]]);
   quad(i,f,color,[X[1],Y[0],Z[1]],[X[1],Y[0],Z[0]],[X[1],Y[1],Z[0]],[X[1],Y[1],Z[1]]);quad(i,f,color,[X[0],Y[0],Z[0]],[X[0],Y[0],Z[1]],[X[0],Y[1],Z[1]],[X[0],Y[1],Z[0]]);
   quad(i,f,color,[X[0],Y[1],Z[1]],[X[1],Y[1],Z[1]],[X[1],Y[1],Z[0]],[X[0],Y[1],Z[0]]);};
  DRIFTERS.forEach((d,i)=>{const s=d.s;
   // envelope: 6 latitude bands x 14 gores, narrowing to a mouth at the bottom
   for(let j=0;j<6;j++){const p0=-Math.PI/2+j/6*Math.PI,p1=-Math.PI/2+(j+1)/6*Math.PI;
    for(let g=0;g<14;g++){const a=g/14*Math.PI*2,b=(g+1)/14*Math.PI*2,R0=Math.cos(p0)*(j===0?.35:1)*s,R1=Math.cos(p1)*s,Y0=Math.sin(p0)*s*1.15,Y1=Math.sin(p1)*s*1.15;
     quad(i,0,d.cols[g%d.cols.length],[Math.cos(a)*R0,Y0,Math.sin(a)*R0],[Math.cos(a)*R1,Y1,Math.sin(a)*R1],[Math.cos(b)*R1,Y1,Math.sin(b)*R1],[Math.cos(b)*R0,Y0,Math.sin(b)*R0]);}}
   // basket, ropes and the burner flame between them
   const by=-s*1.15-1.7;box(i,0,'#8a5a36',0,by,0,s*.36,s*.26,s*.36);box(i,0,'#5b4030',0,by+s*.26,0,s*.38,.06,s*.38);
   for(const [dx,dz] of [[-1,-1],[1,-1],[1,1],[-1,1]] as [number,number][])quad(i,0,'#4a3626',[dx*s*.17,by+s*.26,dz*s*.17],[dx*s*.17+.04,by+s*.26,dz*s*.17],[dx*s*.34+.04,-s*1.1+.15,dz*s*.34],[dx*s*.34,-s*1.1+.15,dz*s*.34]);
   const fy=by+s*.26+.15;for(let g=0;g<5;g++){const a=g/5*Math.PI*2,b=(g+1)/5*Math.PI*2;tri(i,1,'#ffb347',[Math.cos(a)*.16,fy,Math.sin(a)*.16],[0,fy+.9,0],[Math.cos(b)*.16,fy,Math.sin(b)*.16]);}
  });
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));
  g.setAttribute('aIdx',new THREE.Float32BufferAttribute(idx,1));g.setAttribute('aFlame',new THREE.Float32BufferAttribute(flame,1));g.computeVertexNormals();
  const m=new THREE.MeshStandardMaterial({name:'atmosphere: drifting balloons',vertexColors:true,roughness:.8,side:THREE.DoubleSide});
  m.onBeforeCompile=sh=>{Object.assign(sh.uniforms,this.uniforms);
   sh.vertexShader=VERT_HEAD+sh.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
    int bi=int(aIdx+.5);vec4 P=uBP[bi],Q=uBQ[bi];float ang=uBalloonT*Q.y+Q.z,burnK=bBurn(Q.z);
    vec3 centre=vec3(P.x+cos(ang)*P.z,Q.x+sin(uBalloonT*6.28318530718/240.0+Q.z*3.0)*2.5+burnK*1.2,P.y+sin(ang)*P.w);
    if(Q.w>0.0&&uBL.w>.5){float u=mod(uBalloonT,1200.0)/1200.0,k=smoothstep(.075,.175,u)*(1.-smoothstep(.825,.925,u)),a=clamp((u-.175)/.65,0.,1.)*6.28318530718;
      centre=vec3(uBL.x+(cos(a)-1.)*P.z,mix(uBL.y+Q.w,Q.x+sin(uBalloonT*6.28318530718/240.0)*2.5,k),uBL.z+sin(a)*P.w);}
    transformed+=centre;`)
    .replace('#include <color_vertex>',`#include <color_vertex>
    vColor.rgb*=1.0+aFlame*(.4+3.0*bBurn(uBQ[int(aIdx+.5)].z));`);};
  m.customProgramCacheKey=()=>'eden-drifting-balloons/2';
  this.mesh=new THREE.Mesh(g,m);this.mesh.name='atmosphere: drifting hot-air balloons';this.mesh.frustumCulled=false;this.mesh.castShadow=false;this.mesh.receiveShadow=false;
  this.mesh.userData.cameraTransparent=true;this.mesh.raycast=()=>{};this.mesh.matrixAutoUpdate=false;
 }
 /** Unsupported/missing anchors keep the balloon aloft. No ground fallback. */
 setLanding(p:readonly number[]|null){const v=this.uniforms.uBL.value;if(p?.length===3&&p.every(Number.isFinite))v.set(p[0],p[1],p[2],1);else v.w=0;}
 /** t: atmosphere clock (seconds, wraps at 7200). */
 update(t:number){this.uniforms.uBalloonT.value=t;}
 dispose(){this.mesh.removeFromParent();this.mesh.geometry.dispose();(this.mesh.material as THREE.Material).dispose();}
}
