/** How far an opted-in drawer (kit role `drawer`) slides out, in the def's metres (Soul Actions entry 24). */
export const DRAWER_TRAVEL=.32;
/** Opted-in physical actuators. This small shared predicate keeps admission,
 * completion and the viewer's depicted-state clock on the same contract. */
export function contactStateKey(def:{tags?:readonly string[];components?:{light?:unknown;lights?:unknown;opening?:unknown;sign?:unknown;container?:unknown;display?:{controlAt?:readonly number[]}};state?:Record<string,unknown>},action?:string):'on'|'open'|'text'|'locked'|null {
  // Entry 9: an opted-in display's power control is the same on/off contact as a light switch.
  if((def.components?.light||def.components?.lights||(def.tags?.includes('hand-powered-display')&&def.components?.display?.controlAt))&&(!action||['switch-on','switch-off'].includes(action)))return 'on';
  if((def.components?.opening||def.components?.container)&&def.tags?.includes('hand-operated')&&(!action||['open','close'].includes(action)))return 'open';
  // Soul Actions entry 32: a lockable door's key / thumb-turn and a knock on its leaf are hand contact too.
  if(def.components?.opening&&def.tags?.includes('hand-operated')&&def.tags.includes('lockable')&&(action==='lock'||action==='unlock'))return 'locked';
  if(def.components?.opening&&def.tags?.includes('hand-operated')&&def.tags.includes('lockable')&&action==='knock')return 'open';
  if(def.components?.sign&&def.tags?.includes('hand-writable')&&(!action||['write','erase','pin','unpin','sign','unsign','vote','mark','reply','take-on'].includes(action)))return 'text';
  // Opted-in drawn coverings without a hinge (curtains, a roller blind): open/close at a pull cord, the same contact.
  if(!def.components?.opening&&def.tags?.includes('hand-operated')&&def.state&&Object.hasOwn(def.state,'open')&&(!action||['open','close'].includes(action)))return 'open';
  // Opted-in hand switches without a light (a tap, a shower valve): the same on/off contact. Entry 37: a radio's
  // tuning knob (`change-station`) is the same contact; the station it sets is depicted on the same clock.
  if(!def.components?.opening&&def.tags?.includes('hand-operated')&&(!action||['switch-on','switch-off','change-station'].includes(action)))return 'on';
  // Opted-in fire (a candle, a campfire): "light" / "put out" are the same on/off contact, under their own words.
  if(def.tags?.includes('hand-operated')&&action!==undefined&&['light','put-out'].includes(action))return 'on';
  return null;
}
/** Entry 37: besides `on`/`open`, the other fields a hand contact sets that viewers depict on the same clock. */
export const CONTACT_EXTRA_FIELDS=['station'] as const;
