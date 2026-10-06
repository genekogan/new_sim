import type {Program,Engine} from '@sim/engine-contract';
import type {WorldHost,Mind} from './world.ts';
import type {WorldState as NativeWorld} from '../../../mars/viewer/engine/world/types.ts';
/** One synchronous read can share the detached rise, never a live admission.
 * The probe expires on return and never survives a tick/writer boundary. */
export function withHumanSleepStopReadV1<T>(host:WorldHost,m:Mind,read:(preview:(program:Program)=>string|null)=>T):T{
 let open=true,attempted=false,copy:Engine|undefined,before:string|undefined,id:string|null=null;
 const source=host.engine,factory=host.factory,restore=factory.restore;
 const preview=(program:Program):string|null=>{
  if(!open||host.engine!==source||host.factory!==factory||factory.restore!==restore||!host.extra.intentHumanSleepTransitionV1||program.actor!==m.entityId||host.quietBarrier)return null;
  const current=source.programOf(m.entityId),action=current?source.programAction?.(current):null;
  if(!current||action?.actor!==m.entityId||action.action.verb!=='sleep'||!(source.world as NativeWorld).entities[m.entityId]?.human?.sleepPose||source.canSnapshot?.()!==true)return null;
  const hash=source.stateHash();if(before!==undefined&&before!==hash)return null;
  if(!attempted){attempted=true;before=hash;id=current;
   try{const candidate=factory.restore(structuredClone(source.snapshot()));if(candidate===source||candidate.world===source.world||candidate.stateHash()!==before)return null;
    candidate.stop(id);for(let i=0;i<120&&candidate.programOf(m.entityId)===id;i++)candidate.step();
    if(candidate.programOf(m.entityId)!==null||(candidate.world as NativeWorld).entities[m.entityId]?.human?.sleepPose||candidate.runtime.violations.length)return null;copy=candidate;
   }catch{return null;}
  }
  if(!copy||current!==id)return null;
  try{const projected=copy.stateHash(),issue=copy.canPerform(program);if(copy.stateHash()!==projected){copy=undefined;return null;}return issue?null:id;}catch{copy=undefined;return null;}
 };
 try{const result=read(preview);if(result&&typeof(result as {then?:unknown}).then==='function')throw Error('human-sleep-transition.synchronous-read-required');return result;}
 finally{open=false;copy=undefined;if(before!==undefined&&source.stateHash()!==before)throw Error('human-sleep-transition.preview-mutated-source');}
}
/** Detached native projection, never an admission or a change to the live body.
 * Only the existing resumable sleep codec can qualify this narrow transition. */
export function previewHumanSleepStopV1(host:WorldHost,m:Mind,program:Program):string|null{
 return withHumanSleepStopReadV1(host,m,preview=>preview(program));
}
