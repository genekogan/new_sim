// Optional renderer input over an already selected and verified recorded body take.
// App owns station transport/history. This module never fetches or chooses a cue.
import type {Take} from '../../../mars/viewer/engine/take/types.ts';
import type {DepictionBeat} from '../../../mars/viewer/app/engine-view/station-depiction.ts';
export type WorldDepictionQuery=Readonly<{worldId:string;take:Readonly<Take>;tick:number;mode:'live'|'history'}>;
export type WorldBeatSampler=(query:WorldDepictionQuery)=>DepictionBeat|null;
/** Missing/gap input and a failed optional adapter must not freeze the body frame.
 * The adapter reads the supplied take without mutation and returns Core-derived phase.
 * It cannot grant an activity; HumanViews still uses the recorded activity/contact. */
export function worldDepictionBeat(sampler:WorldBeatSampler|undefined,worldId:string|undefined,take:Take,
  tick:number,mode:WorldDepictionQuery['mode'],exactRecording:boolean):DepictionBeat|null {
  if(!sampler||!exactRecording||!worldId||!Number.isFinite(tick)||tick<take.startTick||tick>take.startTick+take.ticks)return null;
  try{
    const hint=sampler(Object.freeze({worldId,take,tick,mode}));
    if(!hint||typeof hint.cueId!=='string'||!hint.cueId||hint.cueId.length>128||!Number.isFinite(hint.beat)||hint.beat<0||hint.beat>=128)return null;
    // Retain only the renderer hint; never pass through a transport/private object.
    return Object.freeze({cueId:hint.cueId,beat:hint.beat});
  }catch{return null;}
}
