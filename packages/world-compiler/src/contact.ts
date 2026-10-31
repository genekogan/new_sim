/** Opted-in physical actuators. This small shared predicate keeps admission,
 * completion and the viewer's depicted-state clock on the same contract. */
export function contactStateKey(def:{tags?:readonly string[];components?:{light?:unknown;lights?:unknown;opening?:unknown;sign?:unknown}},action?:string):'on'|'open'|'text'|null {
  if((def.components?.light||def.components?.lights)&&(!action||['switch-on','switch-off'].includes(action)))return 'on';
  if(def.components?.opening&&def.tags?.includes('hand-operated')&&(!action||['open','close'].includes(action)))return 'open';
  // Opted-in hand switches without a light (a tap, a shower valve): the same on/off contact.
  if(!def.components?.opening&&def.tags?.includes('hand-operated')&&(!action||['switch-on','switch-off'].includes(action)))return 'on';
  if(def.components?.sign&&def.tags?.includes('hand-writable')&&(!action||['write','erase','mark'].includes(action)))return 'text';
  return null;
}
