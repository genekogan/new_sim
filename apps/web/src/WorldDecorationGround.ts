import type {SceneInfo} from './WorldGeometry.ts';
import {publishedGroundSampler} from './WorldPublishedGround.ts';
type Soil=(x:number,z:number)=>number|null;
/** Decoration anchors only. Match WorldGeometry's drawn level-0 plane/deck Y;
 * never edit the selected publication or give this sampler to body/support/nav.
 * Terrain keeps precedence inside its cut-out (the flat plane is not drawn there).
 * The caller supplies actual triangle samplers, never analytic relief or roofs. */
export function highestDrawnDecorationSoil(info:Pick<SceneInfo,'scene'|'shore'>|undefined,...layers:Soil[]):Soil{
 const drawn=info?{...info,scene:info.scene?{...info.scene,surfaces:info.scene.surfaces.filter(s=>s.level===0).map(s=>({...s,y:s.y<=.05?s.y-.01:s.y}))}:null}:undefined;
 const native=publishedGroundSampler(drawn);
 return (x,z)=>{
  if(!Number.isFinite(x)||!Number.isFinite(z))return null;
  let top=native(x,z);
  for(const sample of layers){const y=sample(x,z);if(y!==null&&Number.isFinite(y)&&(top===null||y>top))top=y;}
  return top;
 };
}
