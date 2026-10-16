import {hash01} from './weather.ts';

/** Presentation-only desert profile. The episode envelope is evaluated directly
 * from the shared world clock, so arrivals, reloads and rewind agree. No local
 * easing, wall-clock lottery, accumulated wetness or simulation consequences. */
export const DESERT_DUST_SEED=4126;
export const DUST_CYCLE_MS=100*3_600_000;
export const DUST_TRANSITION_MS={faint:20*60_000,heavy:10*60_000} as const;
export type DustKind='clear'|'faint'|'heavy';
export type DustSample={kind:DustKind;intensity:number;phaseMs:number;worldMs:number};
export type DustOverride=DustKind|null;
const HOUR=3_600_000;
const smooth=(x:number)=>{const t=Math.max(0,Math.min(1,x));return t*t*(3-2*t);};
export function parseDustOverride(search:string):DustOverride{
 const value=new URLSearchParams(search).get('dust');
 return value==='clear'||value==='faint'||value==='heavy'?value:null;
}
/** 100-world-hour cycle: 8 hours faint and 2 heavy (including their ramps),
 * separated by clear spells. The seeded phase is stable; peak strengths vary
 * by cycle. Faint ramps take 20 world minutes each; heavy ramps take 10. */
export function desertDustAt(worldMs:number,seed=DESERT_DUST_SEED,override:DustOverride=null,out?:DustSample):DustSample{
 const at=Number.isFinite(worldMs)?worldMs:0,shift=hash01(seed,91)*DUST_CYCLE_MS;
 const cycle=Math.floor((at+shift)/DUST_CYCLE_MS),phaseMs=at+shift-cycle*DUST_CYCLE_MS;
 const sample=out??{kind:'clear',intensity:0,phaseMs,worldMs:at};
 sample.phaseMs=phaseMs;sample.worldMs=at;
 if(override){sample.kind=override;sample.intensity=override==='heavy'?.4:override==='faint'?.035:0;return sample;}
 sample.kind=phaseMs<8*HOUR?'faint':phaseMs>=48*HOUR&&phaseMs<50*HOUR?'heavy':'clear';
 if(sample.kind==='clear'){sample.intensity=0;return sample;}
 const heavy=sample.kind==='heavy',elapsed=phaseMs-(heavy?48*HOUR:0),duration=(heavy?2:8)*HOUR;
 const ramp=heavy?DUST_TRANSITION_MS.heavy:DUST_TRANSITION_MS.faint;
 const peak=heavy?.3+.2*hash01(cycle,seed+23):.02+.03*hash01(cycle,seed+17);
 sample.intensity=peak*smooth(elapsed/ramp)*smooth((duration-elapsed)/ramp);
 return sample;
}
