import type {Program} from '@sim/engine-contract';
import type {WorldHost,Mind} from './world.ts';
import type {WorldState as NativeWorld} from '../../../mars/viewer/engine/world/types.ts';
/** Detached native projection, never an admission or a change to the live body.
 * Only the existing resumable sleep codec can qualify this narrow transition. */
export function previewHumanSleepStopV1(host:WorldHost,m:Mind,program:Program):string|null{
 if(!host.extra.intentHumanSleepTransitionV1||program.actor!==m.entityId||host.quietBarrier)return null;
 const id=host.engine.programOf(m.entityId),action=id?host.engine.programAction?.(id):null;
 if(!id||action?.actor!==m.entityId||action.action.verb!=='sleep'||!(host.engine.world as NativeWorld).entities[m.entityId]?.human?.sleepPose||host.engine.canSnapshot?.()!==true)return null;
 const before=host.engine.stateHash();
 try{
  const snapshot=host.engine.snapshot(),copy=host.factory.restore(structuredClone(snapshot));
  if(copy===host.engine||copy.world===host.engine.world||copy.stateHash()!==before)return null;
  copy.stop(id);for(let i=0;i<120&&copy.programOf(m.entityId)===id;i++)copy.step();
  if(copy.programOf(m.entityId)!==null||(copy.world as NativeWorld).entities[m.entityId]?.human?.sleepPose||copy.runtime.violations.length||copy.canPerform(program))return null;
  return id;
 }catch{return null;}
 finally{if(host.engine.stateHash()!==before)throw Error('human-sleep-transition.preview-mutated-source');}
}
