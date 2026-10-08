import {Vector3,type PerspectiveCamera} from 'three';
import type {VisibleViewport} from './WorldViewport.ts';

/** CSS pixels relative to the canvas origin; no text or private state. */
export type WorldSpeechAnchor={soulId:string;x:number;y:number;visible:boolean;distance?:number};
export type SpeechAnchorPoint={soulId:string;point:readonly[number,number,number];rendered:boolean};
/** Camera already has the current inset composition. A caller supplies the
 * scenery/fixture visibility query; absence of that evidence hides the anchor. */
export function projectSpeechAnchors(points:readonly SpeechAnchorPoint[],camera:PerspectiveCamera,width:number,height:number,area:VisibleViewport|null,clear?:(point:readonly[number,number,number])=>boolean):WorldSpeechAnchor[]{
  if(!area||![width,height].every(v=>Number.isFinite(v)&&v>0))return [];
  camera.updateMatrixWorld();const projected=new Vector3();
  return points.slice(0,32).flatMap(({soulId,point,rendered})=>{
    if(!soulId||point.length!==3||!point.every(Number.isFinite))return [];
    projected.fromArray(point).project(camera);
    if(![projected.x,projected.y,projected.z].every(Number.isFinite))return [];
    const x=(projected.x+1)*width/2,y=(1-projected.y)*height/2;
    const inside=projected.z>=-1&&projected.z<=1&&x>=area.left&&x<=area.left+area.width&&y>=area.top&&y<=area.top+area.height;
    return [{soulId,x,y,distance:camera.position.distanceTo(new Vector3(...point)),visible:rendered&&inside&&!!clear?.(point)}];
  });
}
