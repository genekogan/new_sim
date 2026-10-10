// Eden presentation only: no environment clock, native illumination or needs changes.
import {parseLocalDateTime,sunTimes} from '../../../../mars/viewer/engine/env/sun.ts';
const clamp=(x:number)=>Math.max(0,Math.min(1,x));
const smooth=(x:number)=>{const t=clamp(x);return t*t*(3-2*t);};
export const TWILIGHT_WORLD_HOURS=2.5;
const hour=(iso:string)=>{const t=parseLocalDateTime(iso);return t.hour+t.minute/60+t.second/3600;};
/** Stateless smooth 2.5-world-hour ramps, centred on actual sunrise and sunset. */
export function visualDaylight(hour:number,rise:number,set:number){
 const half=TWILIGHT_WORLD_HOURS/2;
 return smooth((hour-rise+half)/TWILIGHT_WORLD_HOURS)*(1-smooth((hour-set+half)/TWILIGHT_WORLD_HOURS));
}
/** One calendar-date cache per scene, bounded even after long history scrubbing. */
export function createEdenDaylight(){
 let date='',rise=0,set=0,valid=false;
 return (datetime:string,original:{daylight:number;warmth:number;blueHour:number})=>{
  const next=datetime.slice(0,10);
  if(next!==date){date=next;const times=sunTimes(next+'T12:00');valid=!!times.sunriseLocal&&!!times.sunsetLocal;
   if(valid){rise=hour(times.sunriseLocal!);set=hour(times.sunsetLocal!);}}
  if(!valid)return original;
  const daylight=visualDaylight(hour(datetime),rise,set);
  return {daylight,warmth:4*daylight*(1-daylight),blueHour:Math.max(0,1-Math.abs(daylight-.2)/.2)};
 };
}
/** Seeded smooth heavy/light spells, repeatable under pause, seek and cold replay. */
export function leafSpell(seconds:number,wind:number){
 const x=seconds/23,i=Math.floor(x),t=smooth(x-i);
 const hash=(n:number)=>{let h=Math.imul(n,374761393);h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967296;};
 const a=hash(i),b=hash(i+1),spell=a+(b-a)*t;
 return .18+.82*clamp(.25*wind+.75*spell);
}

/** Strong decorative wind now comes in smooth seeded spells instead of staying
 * continuously at gale strength. Light/moderate breezes are exactly preserved;
 * the caller retains its original weather state for facts, rain and physics. */
export function visualWindStrength(seconds:number,wind:number){
 if(wind<=.75)return wind;
 const x=seconds/37,i=Math.floor(x),t=smooth(x-i);
 const hash=(n:number)=>{let h=Math.imul(n+83,374761393);h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967296;};
 const noise=hash(i)+(hash(i+1)-hash(i))*t,strong=smooth((noise-.28)/.6);
 const weight=smooth((wind-.75)/.2),spell=.75+(wind-.75)*strong;
 return wind+(spell-wind)*weight;
}
