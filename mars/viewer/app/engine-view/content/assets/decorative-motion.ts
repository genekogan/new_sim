import * as THREE from 'three';
import {Builder,Materials,type MatKey} from './eden-regions/kit.ts';
/** Explicit scenery-only motion. Never attached to native carriers or actors. */
export const DECORATIVE_MOTION={value:new THREE.Vector2(0,0)}; // seconds, integrated daytime Ferris angle
export const FERRIS_HUB=[184,16,124] as const;
export const FERRIS_PERIOD=240;
export type Decoration={kind:'wheel'|'gondola'|'boat'|'moored-boat';pivot:readonly [number,number,number];phase?:number};
export type DecorationSink=(base:Builder,part:Decoration,draw:(b:Builder)=>void)=>void;
export function drawDecoration(base:Builder,sink:DecorationSink|undefined,part:Decoration,draw:(b:Builder)=>void){if(sink)sink(base,part,draw);else draw(base);}
export function nextFerrisAngle(angle:number,dt:number,daytime:boolean,reducedMotion=false){return (angle+(!reducedMotion&&daytime?Math.max(0,Math.min(dt,.25))*Math.PI*2/FERRIS_PERIOD:0))%(Math.PI*2);}
/** CPU mirror for bounds/contact tests; shader uses the same explicit formulas. */
export function decorationAt(p:readonly number[],part:Decoration,t:number,angle:number):[number,number,number]{
 const [x,y,z]=p,[px,py,pz]=part.pivot;
 if(part.kind==='wheel'){const c=Math.cos(angle),s=Math.sin(angle);return [px+c*(x-px)-s*(y-py),py+s*(x-px)+c*(y-py),z];}
 if(part.kind==='gondola'){const c=Math.cos(angle),s=Math.sin(angle),dx=px-FERRIS_HUB[0],dy=py-FERRIS_HUB[1];return [x+c*dx-s*dy-dx,y+s*dx+c*dy-dy,z];}
 const ph=part.phase??0;if(part.kind==='moored-boat')return [x,y+.09*Math.sin(t/3.5+ph),z];const a=.025*Math.sin(t/11+ph),c=Math.cos(a),s=Math.sin(a);
 return [px+c*(x-px)+s*(z-pz)+.75*Math.sin(t/35+ph),y+.09*Math.sin(t/3.5+ph),pz-s*(x-px)+c*(z-pz)+.5*Math.sin(t/43+ph)];
}
const HEAD=`uniform vec2 uDecorationTime;attribute vec4 decorationPart;attribute float decorationPhase;
mat3 decorationRotation(){float a=decorationPart.w<1.5?uDecorationTime.y:decorationPart.w>2.5&&decorationPart.w<3.5?.025*sin(uDecorationTime.x/11.0+decorationPhase):0.0;float c=cos(a),s=sin(a);return decorationPart.w<1.5?mat3(c,s,0.,-s,c,0.,0.,0.,1.):mat3(c,0.,-s,0.,1.,0.,s,0.,c);}
`;
const MOVE=`{
if(decorationPart.w<1.5)transformed=decorationPart.xyz+decorationRotation()*(transformed-decorationPart.xyz);
else if(decorationPart.w<2.5){vec2 d=decorationPart.xy-vec2(184.,16.);float c=cos(uDecorationTime.y),s=sin(uDecorationTime.y);transformed.xy+=mat2(c,s,-s,c)*d-d;}
else if(decorationPart.w>3.5)transformed.y+=.09*sin(uDecorationTime.x/3.5+decorationPhase);
else{transformed=decorationPart.xyz+decorationRotation()*(transformed-decorationPart.xyz);transformed+=vec3(.75*sin(uDecorationTime.x/35.+decorationPhase),.09*sin(uDecorationTime.x/3.5+decorationPhase),.5*sin(uDecorationTime.x/43.+decorationPhase));}
}`;
/** All configured pieces stay batched by material; no per-boat/seat frame hooks. */
export class DecorativeMotion {
 private pieces:{builder:Builder;part:Decoration}[]=[];
 readonly sink:DecorationSink=(base,part,draw)=>{const builder=new Builder('decorative');builder.m.copy(base.m);draw(builder);this.pieces.push({builder,part});};
 emit(group:THREE.Group,mats:Materials,geos:THREE.BufferGeometry[],owned:THREE.Material[]):number{
  const batches=new Map<MatKey,{p:number[];n:number[];c:number[];parts:number[];phase:number[]}>();let tris=0;
  for(const {builder,part}of this.pieces)for(const [k,b]of builder.buf){let batch=batches.get(k);if(!batch)batches.set(k,batch={p:[],n:[],c:[],parts:[],phase:[]});batch.p.push(...b.p);batch.n.push(...b.n);batch.c.push(...b.c);const kind=part.kind==='wheel'?1:part.kind==='gondola'?2:part.kind==='boat'?3:4;for(let i=0;i<b.p.length/3;i++){batch.parts.push(...part.pivot,kind);batch.phase.push(part.phase??0);}tris+=b.p.length/9;}
  for(const[k,b]of batches){const geometry=new THREE.BufferGeometry();for(const[name,values,size]of [['position',b.p,3],['normal',b.n,3],['color',b.c,3],['decorationPart',b.parts,4],['decorationPhase',b.phase,1]]as const)geometry.setAttribute(name,new THREE.Float32BufferAttribute(values,size));geometry.computeBoundingBox();geometry.boundingBox!.expandByScalar(3);geometry.computeBoundingSphere();geos.push(geometry);
   const base=mats.get(k),material=base.clone(),previous=base.onBeforeCompile,key=base.customProgramCacheKey;material.onBeforeCompile=function(shader,renderer){previous.call(this,shader,renderer);shader.uniforms.uDecorationTime=DECORATIVE_MOTION;shader.vertexShader=HEAD+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n'+MOVE).replace('#include <beginnormal_vertex>','#include <beginnormal_vertex>\nobjectNormal=decorationRotation()*objectNormal;');};material.customProgramCacheKey=()=>key.call(base)+'|eden-configured-decoration/1';owned.push(material);
   const mesh=new THREE.Mesh(geometry,material);mesh.name='Regions configured decorative motion / '+base.name;mesh.userData.cameraTransparent=true;mesh.userData.nativeSupport='none';mesh.castShadow=false;mesh.receiveShadow=true;mesh.matrixAutoUpdate=false;group.add(mesh);
  }
  this.pieces=[];return tris;
 }
}
