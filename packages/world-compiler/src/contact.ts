/** Opted-in physical actuators. This small shared predicate keeps admission,
 * completion and the viewer's depicted-state clock on the same contract. */
export function contactStateKey(def:{tags?:readonly string[];components?:{light?:unknown;lights?:unknown;opening?:unknown};state?:Record<string,unknown>},action?:string):'on'|'open'|null {
  if((def.components?.light||def.components?.lights)&&(!action||['switch-on','switch-off'].includes(action)))return 'on';
  if(def.components?.opening&&def.tags?.includes('hand-operated')&&(!action||['open','close'].includes(action)))return 'open';
  // Opted-in drawn coverings without a hinge (curtains, a roller blind): open/close at a pull cord, the same contact.
  if(!def.components?.opening&&def.tags?.includes('hand-operated')&&def.state&&Object.hasOwn(def.state,'open')&&(!action||['open','close'].includes(action)))return 'open';
  // Opted-in hand switches without a light (a tap, a shower valve): the same on/off contact.
  if(!def.components?.opening&&def.tags?.includes('hand-operated')&&(!action||['switch-on','switch-off'].includes(action)))return 'on';
  return null;
}
