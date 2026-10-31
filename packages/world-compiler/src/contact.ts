/** How far an opted-in drawer (kit role `drawer`) slides out, in the def's metres (Soul Actions entry 24). */
export const DRAWER_TRAVEL=.32;
/** Opted-in physical actuators. This small shared predicate keeps admission,
 * completion and the viewer's depicted-state clock on the same contract. */
export function contactStateKey(def:{tags?:readonly string[];components?:{light?:unknown;lights?:unknown;opening?:unknown;container?:unknown}},action?:string):'on'|'open'|null {
  if((def.components?.light||def.components?.lights)&&(!action||['switch-on','switch-off'].includes(action)))return 'on';
  if((def.components?.opening||def.components?.container)&&def.tags?.includes('hand-operated')&&(!action||['open','close'].includes(action)))return 'open';
  return null;
}
/** Soul Actions entry 42: a hand-operated container's storage (its `shelf` slots, the mouth and what fits), else null.
 *  Shared by the server (offers, refusals, perception), the engine adapter (interior surface slots) and the viewer. */
export type ContainerInside={lip:number;face:number;stand:[number,number];fit:[number,number,number];word:string;slots:{id:string;p:readonly number[]}[]};
export function containerInside(def:{tags?:readonly string[];components?:{container?:unknown};slots?:readonly {id:string;kind:string;p:readonly number[]}[]}|undefined):ContainerInside|null{
  const c=def?.components?.container as {inside?:Omit<ContainerInside,'slots'>}|undefined;
  if(!c?.inside||!def?.tags?.includes('hand-operated'))return null;
  const slots=(def.slots??[]).filter(s=>s.kind==='shelf').map(s=>({id:s.id,p:s.p}));
  return slots.length?{...c.inside,slots}:null;
}
