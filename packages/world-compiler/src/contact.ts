/** Opted-in physical actuators. This small shared predicate keeps admission,
 * completion and the viewer's depicted-state clock on the same contract. */
export function contactStateKey(def:{tags?:readonly string[];components?:{light?:unknown;lights?:unknown;opening?:unknown;display?:{controlAt?:readonly number[]}}},action?:string):'on'|'open'|null {
  if((def.components?.light||def.components?.lights||(def.tags?.includes('hand-powered-display')&&def.components?.display?.controlAt))&&(!action||['switch-on','switch-off'].includes(action)))return 'on';
  if(def.components?.opening&&def.tags?.includes('hand-operated')&&(!action||['open','close'].includes(action)))return 'open';
  return null;
}
