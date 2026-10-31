/** Opted-in physical actuators. This small shared predicate keeps admission,
 * completion and the viewer's depicted-state clock on the same contract. */
export function contactStateKey(def:{tags?:readonly string[];components?:{light?:unknown;lights?:unknown;opening?:unknown}},action?:string):'on'|'open'|null {
  if((def.components?.light||def.components?.lights)&&(!action||['switch-on','switch-off'].includes(action)))return 'on';
  if(def.components?.opening&&def.tags?.includes('hand-operated')&&(!action||['open','close'].includes(action)))return 'open';
  // Opted-in hand switches without a light (a tap, a shower valve): the same on/off contact. Entry 37: a radio's
  // tuning knob (`change-station`) is the same contact; the station it sets is depicted on the same clock.
  if(!def.components?.opening&&def.tags?.includes('hand-operated')&&(!action||['switch-on','switch-off','change-station'].includes(action)))return 'on';
  return null;
}
/** Entry 37: besides `on`/`open`, the other fields a hand contact sets that viewers depict on the same clock. */
export const CONTACT_EXTRA_FIELDS=['station'] as const;
