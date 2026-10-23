/** Deterministic weather for the Eden world (presentation only).
 *
 * The world clock picks a weather "kind" per 3-hour slot, seeded by the day so
 * the same clock always shows the same weather. A per-day regime correlates the
 * slots (a showery day, a fair day, a misty day). The rendered state never
 * jumps: it eases toward the scheduled target with time constants of a minute
 * or more of viewing time, and wetness lags rain (soaks in fast, dries slowly).
 * Pure functions; no three.js, no DOM except the optional URL override. */
export const WEATHER_KINDS=['clear','cloudy','rain','wind','fog','storm'] as const;
export type WeatherKind=typeof WEATHER_KINDS[number];
/** Continuous rendered weather. All in 0..1. */
export type WeatherState={cloud:number;rain:number;wind:number;fog:number;mist:number;wet:number};
export const SLOT_HOURS=2;
const DAY_MS=86_400_000;

/** 32-bit integer hash → [0,1). */
export function hash01(a:number,b=0){let h=(Math.imul(a|0,0x27d4eb2d)^Math.imul(b|0,0x165667b1))>>>0;h=Math.imul(h^(h>>>15),0x85ebca6b)>>>0;h=Math.imul(h^(h>>>13),0xc2b2ae35)>>>0;return((h^(h>>>16))>>>0)/4294967296;}

type Regime='fair'|'unsettled'|'misty'|'breezy';
const REGIMES:[Regime,number][]=[['fair',.34],['unsettled',.26],['misty',.2],['breezy',.2]];
// Gene 2026-10-07: rain about 5% of the time, storms rarer still (was ~16% rain+storm).
// WEATHER-RULES: unsettled rain/storm weights raised so the one-slot shower cap keeps those totals (wet ~5%, storm ~1.5%).
const WEIGHTS:Record<Regime,Record<WeatherKind,number>>={
 fair:{clear:.64,cloudy:.24,rain:.005,wind:.115,fog:0,storm:0},
 unsettled:{clear:.22,cloudy:.42,rain:.125,wind:.21,fog:0,storm:.06},
 misty:{clear:.33,cloudy:.3,rain:.015,wind:0,fog:.355,storm:0},
 breezy:{clear:.42,cloudy:.2,rain:.015,wind:.36,fog:0,storm:.005},
};
function pick<T extends string>(rows:[T,number][],u:number):T{const total=rows.reduce((s,r)=>s+r[1],0);let x=u*total;for(const [k,w] of rows){if(x<w)return k;x-=w;}return rows[rows.length-1][0];}
export function regimeOf(day:number):Regime{return pick(REGIMES,hash01(day,7919));}
/** Scheduled weather kind at a world time (epoch milliseconds, UTC). */
export function weatherKindAt(epochMs:number):WeatherKind{
 const day=Math.floor(epochMs/DAY_MS),hour=(epochMs-day*DAY_MS)/3_600_000,slot=Math.floor(hour/SLOT_HOURS);
 // WEATHER-RULES (Gene 2026-10-23, "rain lasts too long"): a shower is one slot at most; the slot after a wet one is dry
 const k=slotKind(day,slot);if(!wetKind(k))return k;
 const prev=slot>0?slotKind(day,slot-1):slotKind(day-1,24/SLOT_HOURS-1);
 return wetKind(prev)?slotKind(day,slot,true):k;
}
const wetKind=(k:WeatherKind)=>k==='rain'||k==='storm';
function slotKind(day:number,slot:number,dry=false):WeatherKind{
 const w={...WEIGHTS[regimeOf(day)]};
 // (2 h slots) mist around dawn, showers and storms in the afternoon
 if(slot===2||slot===3)w.fog*=2.2;else if(slot>=5&&slot<=8)w.fog*=.25;
 if(slot>=6&&slot<=8){w.rain*=1.3;w.storm*=1.8;}
 if(dry)w.rain=w.storm=0;
 return pick(Object.entries(w) as [WeatherKind,number][],hash01(day,slot*131+17));
}
/** Hour of day (0..24) at a world time. */
export function hourOf(epochMs:number){const d=Math.floor(epochMs/DAY_MS);return(epochMs-d*DAY_MS)/3_600_000;}
/** Low morning mist factor (0..1) peaking just after dawn. */
export function morningMist(hour:number){return Math.max(0,1-Math.abs(hour-6.5)/2.5);}
/** Target rendered state for a kind (wet is the rain-driven lagging channel; its target is rain). */
function setState(t:WeatherState,cloud:number,rain:number,wind:number,fog:number,mist:number,wet:number){t.cloud=cloud;t.rain=rain;t.wind=wind;t.fog=fog;t.mist=mist;t.wet=wet;return t;}
export function targetFor(kind:WeatherKind,hour:number|null,out?:WeatherState):WeatherState{
 const t=out??{cloud:0,rain:0,wind:0,fog:0,mist:0,wet:0};
 if(kind==='clear')setState(t,.15,0,.28,0,0,0);else if(kind==='cloudy')setState(t,.72,0,.4,.03,0,0);else if(kind==='rain')setState(t,.95,1,.55,.25,0,1);
 else if(kind==='wind')setState(t,.38,0,1,0,0,0);else if(kind==='storm')setState(t,1,1,.85,.3,0,1);else setState(t,.5,0,.06,1,.8,.25);
 const m=hour===null?0:morningMist(hour);
 t.mist=Math.min(1,Math.max(t.mist,m*(kind==='clear'?.45:kind==='cloudy'?.35:kind==='fog'?1:.1)));
 return t;
}
/** Seconds to cover ~63% of the way to a new target, per channel. */
export const TAU:Record<keyof WeatherState,number>={cloud:70,rain:35,wind:45,fog:80,mist:90,wet:45};
/** Ground dries slowly; a shower, though, stops within about half a minute rather than tapering for minutes
 * (E2 #8: with rain's 35 s build-up constant it was still visibly falling 2–3 minutes after the sky cleared). */
const DRY_TAU=300,RAIN_STOP_TAU=8,KEYS=Object.keys(TAU) as (keyof WeatherState)[];
/** A god's weather change eases this many times faster than the schedule, so it shows in about 10–25 s. */
export const GOD_EASE=3.5;
/** ... and for this long after the god's last change, including a return to the scheduled ('auto') weather. */
export const GOD_SETTLE_S=90;
/** The easing speed-up for this frame: a god's set weather, or the settling time after a god changed (or cleared) it. */
export function weatherEaseRate(set:boolean,secondsSinceGodChange:number,cycle=false){return cycle?4:set||secondsSinceGodChange<GOD_SETTLE_S?GOD_EASE:1;}
type SetChannels={kind:string;clouds:number;rain:number;wind:number;fog:number;intensity:number};
/** Did the god's set weather change (including being set, or cleared back to the schedule)? */
export function setWeatherChanged(a:SetChannels|null,b:SetChannels|null){
 if(!a||!b)return a!==b;
 return a.kind!==b.kind||a.clouds!==b.clouds||a.rain!==b.rain||a.wind!==b.wind||a.fog!==b.fog||a.intensity!==b.intensity;
}
/** Ease `state` toward `target` in place (frame-rate independent). */
export function easeWeather(state:WeatherState,target:WeatherState,dt:number){
 if(!(dt>0))return state;dt=Math.min(dt,5);
 for(const k of KEYS){
  const tau=k==='wet'&&target.wet<state.wet?DRY_TAU:k==='rain'&&target.rain<state.rain?RAIN_STOP_TAU:TAU[k];
  state[k]+=(target[k]-state[k])*(1-Math.exp(-dt/tau));
 }
 return state;
}
export function copyWeather(into:WeatherState,from:WeatherState){into.cloud=from.cloud;into.rain=from.rain;into.wind=from.wind;into.fog=from.fog;into.mist=from.mist;into.wet=from.wet;return into;}
/** Parse a `?weather=` override (clear|cloudy|rain|wind|fog|cycle|off|afterrain). `from` starts the
 * rendered state at another kind so the transition itself can be reviewed (afterrain = rain clearing). */
export type WeatherOverride={kind:WeatherKind|'cycle'|'off';from?:WeatherKind}|null;
export function parseWeatherOverride(search:string):WeatherOverride{
 const v=new URLSearchParams(search).get('weather');if(!v)return null;
 if(v==='windy')return{kind:'wind'};if(v==='afterrain'||v==='rainbow')return{kind:'clear',from:'rain'};if(v==='mist'||v==='foggy')return{kind:'fog'};if(v==='cloud'||v==='overcast')return{kind:'cloudy'};
 return (WEATHER_KINDS as readonly string[]).includes(v)||v==='cycle'||v==='off'?{kind:v as WeatherKind|'cycle'|'off'}:null;
}
/** Demo cycle for `?weather=cycle`: each kind for 45 s of viewing time. */
export function cycleKind(seconds:number):WeatherKind{return WEATHER_KINDS[Math.floor(Math.max(0,seconds)/45)%WEATHER_KINDS.length];}
/** Parse the world clock (a naive local ISO datetime; read as UTC so every viewer agrees) to epoch ms. */
export function clockMs(clock:string|null|undefined):number|null{if(!clock)return null;const m=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?/.exec(clock);if(!m)return null;const t=Date.parse(m[0]+'Z');return Number.isFinite(t)?t:null;}
