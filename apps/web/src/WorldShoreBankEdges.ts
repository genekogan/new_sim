import type {NativeShoreTerrainInput} from '../../../mars/viewer/app/engine-view/content/environment/native-shore-terrain.ts';
/** The closure mesh's name (WorldGeometry). */
export const SHORE_BANK_EDGE_NAME='Captured shore north/south visual bank edge closure (no support)';
/** The flat backdrop a cosmetic landscape replaces: the outside-ground planes and the bank closure that only joins the
 * captured terrain to them. The Eden expansion's own ground rises from the captured edge heights, so a closure kept
 * under it stood up to 3.5 m above that ground as a flat brown wall along the commons pond. */
export const isFlatBackdrop=(o:{name:string})=>o.name==='outside-ground'||o.name===SHORE_BANK_EDGE_NAME;
/** Close the vertical gap between captured terrain's north/south edges and the
 * existing flat visual backdrop. No top surface, west connector, nav or support.
 * Exact captured bed vertices remain unchanged; the water datum is never an input. */
export function shoreBankEdgePositions(terrain:NativeShoreTerrainInput,backdropY:number){
 const p:number[]=[];
 for(const j of [0,terrain.rows-1])for(let i=1;i<terrain.columns;i++){
  const x0=terrain.originXZ[0]+(i-1)*terrain.spacingMetres,x1=x0+terrain.spacingMetres,z=terrain.originXZ[1]+j*terrain.spacingMetres;
  const y0=Math.fround(terrain.heightMetres[j][i-1]),y1=Math.fround(terrain.heightMetres[j][i]);
  if(y0>=backdropY&&y1>=backdropY)continue;
  p.push(x0,y0,z,x1,y1,z,x1,Math.max(y1,backdropY),z,x0,y0,z,x1,Math.max(y1,backdropY),z,x0,Math.max(y0,backdropY),z);
 }
 return p;
}
