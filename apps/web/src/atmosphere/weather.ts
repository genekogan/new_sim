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
const WEIGHTS:Record<Regime,Record<WeatherKind,number>>={
 fair:{clear:.64,cloudy:.24,rain:.005,wind:.115,fog:0,storm:0},
 unsettled:{clear:.22,cloudy:.42,rain:.115,wind:.21,fog:0,storm:.035},
 misty:{clear:.33,cloudy:.3,rain:.015,wind:0,fog:.355,storm:0},
 breezy:{clear:.42,cloudy:.2,rain:.015,wind:.36,fog:0,storm:.005},
};
function pick<T extends string>(rows:[T,number][],u:number):T{const total=rows.reduce((s,r)=>s+r[1],0);let x=u*total;for(const [k,w] of rows){if(x<w)return k;x-=w;}return rows[rows.length-1][0];}
export function regimeOf(day:number):Regime{return pick(REGIMES,hash01(day,7919));}
/** Scheduled weather kind at a world time (epoch milliseconds, UTC). */
export function weatherKindAt(epochMs:number):WeatherKind{
 const day=Math.floor(epochMs/DAY_MS),hour=(epochMs-day*DAY_MS)/3_600_000,slot=Math.floor(hour/SLOT_HOURS),regime=regimeOf(day);
 const w={...WEIGHTS[regime]};
 // Mist forms around dawn; afternoons convect (showers) a little more often.
 // (2 h slots) mist around dawn, showers and storms in the afternoon
 if(slot===2||slot===3)w.fog*=2.2;else if(slot>=5&&slot<=8)w.fog*=.25;
 if(slot>=6&&slot<=8){w.rain*=1.3;w.storm*=1.8;}
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
const DRY_TAU=300,KEYS=Object.keys(TAU) as (keyof WeatherState)[];
/** Ease `state` toward `target` in place (frame-rate independent). */
export function easeWeather(state:WeatherState,target:WeatherState,dt:number){
 if(!(dt>0))return state;dt=Math.min(dt,5);
 for(const k of KEYS){
  const tau=k==='wet'&&target.wet<state.wet?DRY_TAU:TAU[k];
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
