// Authored successor scene. The ceramic generators own geometry; these footprints own navigation.
import data from '../../../../worlds/littlemartians/scene.json' with {type:'json'};
import {emptyWorld} from '../world/factory.ts';
import type {Region} from '../world/types.ts';
import type {SpatialScene} from '../spatial/types.ts';
export const LITTLE_MARTIANS_SCENE=data.scene as SpatialScene;
export const LITTLE_MARTIANS_RENDER={buildings:data.buildings,kin:data.kin};
export function littleMartiansWorld(seed='littlemartians'){
 const w=emptyWorld('littlemartians',LITTLE_MARTIANS_SCENE,seed);
 for(const r of data.regions)w.regions[r.id]=structuredClone(r) as Region;
 return w;
}
