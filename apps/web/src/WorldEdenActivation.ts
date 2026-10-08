import type {SceneInfo} from './WorldGeometry.ts';
/** App supplies the manifest/route gate. World independently requires the
 * hash-verified selected-world capture and its admitted east/north surfaces.
 * Hostnames and one temporary preview world ID are not release authority. */
export function edenExpansionCapture(requested:boolean,worldId:string|undefined,info:SceneInfo|null,verifiedPublication:unknown,history:boolean){
 if(!requested||history||!worldId||!info?.scene||info.ground!=='grass'||info.shore?.profile!=='connected-commons-shore/1'||info.shore.metadata.physicalBase.campus!=='eden-commons-shore-expanded/1')return false;
 const capture=verifiedPublication as {contract?:unknown;worldId?:unknown;ref?:{contract?:unknown;hash?:unknown}}|null;
 if(!capture||capture.contract!=='render-scene-capture/1'||capture.worldId!==worldId||capture.ref?.contract!=='render-scene-ref/1'||typeof capture.ref.hash!=='string'||! /^[a-f0-9]{64}$/.test(capture.ref.hash))return false;
 const matches=(id:string,c:number[],half:number[])=>info.scene!.surfaces.some(s=>s.id===id&&s.level===0&&s.y===0&&s.obb.yaw===0&&s.obb.c.every((v,i)=>v===c[i])&&s.obb.half.every((v,i)=>v===half[i]));
 return matches('eden-east-ground',[67.5,27.5],[37.5,57.5])&&matches('eden-north-ground',[5,-47.5],[25,17.5]);
}
