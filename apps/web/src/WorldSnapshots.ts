import * as THREE from 'three';
import {EDEN_VIEWER_PLACES} from './WorldEdenPlaceData.ts';
/** W2 eyes + W5 map snapshots (edge §9/§13): small, low-quality images rendered
 * on demand from the same scene the viewer draws. Gene's sizes: first-person
 * 320×180 and overhead 256×256, low-quality JPEG; the overhead map defaults to
 * the whole Eden layout. Pure renderer utilities: the steward request queue
 * (Core C10) decides who may ask and when; this never touches simulation. */
export const SNAPSHOT_SIZES=Object.freeze({eyes:[320,180] as const,overhead:[256,256] as const,map:[512,384] as const});
export type EyesPose={position:[number,number,number];yaw:number;pitch?:number;fov?:number};
const target=(w:number,h:number)=>new THREE.WebGLRenderTarget(w,h,{depthBuffer:true,colorSpace:THREE.SRGBColorSpace});
function readJpeg(renderer:THREE.WebGLRenderer,rt:THREE.WebGLRenderTarget,quality:number,overlay?:(ctx:CanvasRenderingContext2D)=>void){
 const {width:w,height:h}=rt,px=new Uint8Array(w*h*4);renderer.readRenderTargetPixels(rt,0,0,w,h,px);
 const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d')!,img=ctx.createImageData(w,h);
 for(let y=0;y<h;y++)img.data.set(px.subarray((h-1-y)*w*4,(h-y)*w*4),y*w*4);// GL rows are bottom-up
 ctx.putImageData(img,0,0);overlay?.(ctx);return canvas.toDataURL('image/jpeg',quality);
}
function renderInto(renderer:THREE.WebGLRenderer,scene:THREE.Scene,camera:THREE.Camera,rt:THREE.WebGLRenderTarget){
 const previous=renderer.getRenderTarget();try{renderer.setRenderTarget(rt);renderer.clear();renderer.render(scene,camera);}finally{renderer.setRenderTarget(previous);}
}
/** First-person "eyes" frame from a Soul's head pose (yaw 0 looks toward −Z). */
export function renderEyes(renderer:THREE.WebGLRenderer,scene:THREE.Scene,pose:EyesPose,quality=.5){
 const [w,h]=SNAPSHOT_SIZES.eyes,camera=new THREE.PerspectiveCamera(pose.fov??70,w/h,.1,400),rt=target(w,h);
 camera.position.fromArray(pose.position);const p=pose.pitch??-.08;camera.lookAt(camera.position.clone().add(new THREE.Vector3(Math.sin(pose.yaw)*Math.cos(p),Math.sin(p),-Math.cos(pose.yaw)*Math.cos(p))));camera.updateMatrixWorld();
 try{renderInto(renderer,scene,camera,rt);return readJpeg(renderer,rt,quality);}finally{rt.dispose();}
}
/** Overhead frame a few metres above a point, looking straight down. */
export function renderOverhead(renderer:THREE.WebGLRenderer,scene:THREE.Scene,at:[number,number,number],halfSpan=12,quality=.5){
 const [w,h]=SNAPSHOT_SIZES.overhead,camera=new THREE.OrthographicCamera(-halfSpan,halfSpan,halfSpan,-halfSpan,.1,200),rt=target(w,h);
 camera.position.set(at[0],at[1]+60,at[2]);camera.up.set(0,0,-1);camera.lookAt(at[0],at[1],at[2]);camera.updateMatrixWorld();
 try{renderInto(renderer,scene,camera,rt);return readJpeg(renderer,rt,quality);}finally{rt.dispose();}
}
/** Labelled map of Eden (W5): orthographic top-down over the layout bounds with
 * named top-level places and optional Soul markers. */
export function renderMap(renderer:THREE.WebGLRenderer,scene:THREE.Scene,opts:{bounds?:[number,number,number,number];souls?:{name:string;x:number;z:number}[];quality?:number}={}){
 const [x0,z0,x1,z1]=opts.bounds??[-100,-65,105,85],[w,h]=SNAPSHOT_SIZES.map,rt=target(w,h),cx=(x0+x1)/2,cz=(z0+z1)/2,half=Math.max((x1-x0)/2,(z1-z0)/2*w/h);
 const camera=new THREE.OrthographicCamera(-half,half,half*h/w,-half*h/w,.1,400);camera.position.set(cx,150,cz);camera.up.set(0,0,-1);camera.lookAt(cx,0,cz);camera.updateMatrixWorld();
 const toPx=(x:number,z:number)=>[(x-(cx-half))/(2*half)*w,(z-(cz-half*h/w))/(2*half*h/w)*h] as const;
 try{renderInto(renderer,scene,camera,rt);return readJpeg(renderer,rt,opts.quality??.6,ctx=>{
  ctx.font='600 10px system-ui,sans-serif';ctx.textAlign='center';ctx.lineWidth=3;ctx.strokeStyle='rgba(0,0,0,.65)';ctx.fillStyle='#fff';
  // Larger places first; skip a label whose box would overlap one already drawn.
  const area=(poly:[number,number][])=>Math.abs(poly.reduce((t,[x,z],i)=>{const [x2,z2]=poly[(i+1)%poly.length];return t+x*z2-x2*z;},0))/2;
  const candidates=EDEN_VIEWER_PLACES.filter(p=>['building','venue','pavilion','water','outdoor','garden'].includes(p.kind)&&p.parent!==null&&(p.parent==='eden'||p.parent==='eden-east'||p.parent==='field')).sort((a,b)=>area(b.polygon)-area(a.polygon));
  const boxes:[number,number,number,number][]=[];
  for(const p of candidates){const n=p.polygon.length,[mx,mz]=p.polygon.reduce(([a,b],[x,z])=>[a+x/n,b+z/n],[0,0]),[px,py]=toPx(mx,mz),name=p.name.replace(/ \(.*\)$/,''),tw=ctx.measureText(name).width,box:[number,number,number,number]=[px-tw/2-2,py-10,px+tw/2+2,py+3];
   if(boxes.some(b=>box[0]<b[2]&&b[0]<box[2]&&box[1]<b[3]&&b[1]<box[3]))continue;boxes.push(box);ctx.strokeText(name,px,py);ctx.fillText(name,px,py);}
  for(const s of opts.souls??[]){const [px,py]=toPx(s.x,s.z);ctx.fillStyle='#ffd34d';ctx.beginPath();ctx.arc(px,py,3.5,0,Math.PI*2);ctx.fill();ctx.fillStyle='#fff';ctx.strokeText(s.name,px,py-6);ctx.fillText(s.name,px,py-6);}
 });}finally{rt.dispose();}
}
