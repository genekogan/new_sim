// Derived, per-runtime navigation cache. It is rebuilt from the pinned scene after restore;
// authoritative poses, reservations and motion remain in the ordinary walk controller.
import type {Runtime} from '../runtime/runtime.ts';
import {Spatial} from '../spatial/service.ts';
import {FloatPlanner,floaterProfile} from './float.ts';
import {isFloater,floaterBody} from './body.ts';
import {humanoidProfile} from './humanoid.ts';
import type {Entity} from '../world/types.ts';
const cache=new WeakMap<Runtime,{base:Spatial;baseId:string;spatial:Spatial}>();
/** A body's movement profile: a floater's; a humanoid's look (height/build/walkSpeed, bodies/humanoid.ts), which is
 *  HUMAN_PROFILE itself for every body without those params. */
export function bodyProfile(actor:Entity){return isFloater(actor)?floaterProfile(floaterBody(actor.body)):humanoidProfile(actor.body);}
export function bodySpatial(rt:Runtime,actorId?:string):Spatial{
 const base=rt.services.spatial as Spatial;
 if(base.ground?.paged)base.focusOn(rt.world,actorId);
 if(!actorId||!isFloater(rt.world.entities[actorId])||base.ground)return base;
 let found=cache.get(rt);
 if(!found||found.base!==base||found.baseId!==base.baseId){
  const openings=base.base.links.filter(l=>l.reason==='floater-only-opening').map(l=>l.id);
  const planner=new FloatPlanner(base.base,{openings,contributors:base.contributors,baseId:base.baseId,cell:base.cell});
  // The same base service is rebased by prospective nav/boundary facts. A
  // cached body-specific scene must follow that identity, and its epoch cannot
  // reset to an old value that an active glide has already verified.
  planner.spatial.epoch=found?.spatial.epoch??0;
  found={base,baseId:base.baseId,spatial:planner.spatial};cache.set(rt,found);
 }
 found.spatial.sync(rt.world);return found.spatial;
}
