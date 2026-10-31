/** How far an opted-in drawer (kit role `drawer`) slides out, in the def's metres (Soul Actions entry 24). */
export const DRAWER_TRAVEL=.32;
/** Opted-in physical actuators. This small shared predicate keeps admission,
 * completion and the viewer's depicted-state clock on the same contract. */
export function contactStateKey(def:{tags?:readonly string[];components?:{light?:unknown;lights?:unknown;opening?:unknown;sign?:unknown;container?:unknown};state?:Record<string,unknown>},action?:string):'on'|'open'|'text'|'locked'|null {
  if((def.components?.light||def.components?.lights)&&(!action||['switch-on','switch-off'].includes(action)))return 'on';
  if((def.components?.opening||def.components?.container)&&def.tags?.includes('hand-operated')&&(!action||['open','close'].includes(action)))return 'open';
  // Soul Actions entry 32: a lockable door's key / thumb-turn and a knock on its leaf are hand contact too.
  if(def.components?.opening&&def.tags?.includes('hand-operated')&&def.tags.includes('lockable')&&(action==='lock'||action==='unlock'))return 'locked';
  if(def.components?.opening&&def.tags?.includes('hand-operated')&&def.tags.includes('lockable')&&action==='knock')return 'open';
  if(def.components?.sign&&def.tags?.includes('hand-writable')&&(!action||['write','erase','pin','unpin','sign','unsign','vote','mark'].includes(action)))return 'text';
  // Opted-in drawn coverings without a hinge (curtains, a roller blind): open/close at a pull cord, the same contact.
  if(!def.components?.opening&&def.tags?.includes('hand-operated')&&def.state&&Object.hasOwn(def.state,'open')&&(!action||['open','close'].includes(action)))return 'open';
  // Opted-in hand switches without a light (a tap, a shower valve): the same on/off contact.
  if(!def.components?.opening&&def.tags?.includes('hand-operated')&&(!action||['switch-on','switch-off'].includes(action)))return 'on';
  // Opted-in fire (a candle, a campfire): "light" / "put out" are the same on/off contact, under their own words.
  if(def.tags?.includes('hand-operated')&&action!==undefined&&['light','put-out'].includes(action))return 'on';
  return null;
}
