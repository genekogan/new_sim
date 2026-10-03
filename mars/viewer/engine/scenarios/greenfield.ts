import {emptyWorld} from '../world/factory.ts';
import type {SpatialScene} from '../spatial/types.ts';
export const GREEN_FIELD_SCENE:SpatialScene={bounds:[-30,-30,30,30],levels:[{id:0,y:0,label:'green field'}],surfaces:[{id:'green-field',level:0,y:0,obb:{c:[0,0],half:[30,30],yaw:0},label:'green field'}],obstacles:[],links:[]};
export function greenFieldWorld(seed='eden'){
 const w=emptyWorld('greenfield',GREEN_FIELD_SCENE,seed);
 w.regions.field={id:'field',label:'Green field',kind:'walkable',level:0,polygon:[[-30,-30],[30,-30],[30,30],[-30,30]],provenance:{origin:'design-edit',confidence:'hypothetical'}};
 return w;
}
