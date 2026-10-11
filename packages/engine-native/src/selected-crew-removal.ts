import {hashOf,type Engine,type EngineFactory,type EngineSnapshot} from '../../engine-contract/src/index.ts';
import {MarsEngine,marsFactory,type MarsWorldConfig} from '../../engine-mars/src/engine.ts';
import {decodeSnapshot} from '../../../mars/viewer/engine/runtime/snapshot.ts';
/** Selected native world dual reader. Genesis, layout and old policy remain
 * exactly the original factory until its existing accepted crew-removal fact.
 * No defaults, map upgrade, quiet mutation or actor changes are introduced. */
export async function selectedNativeCrewRemovalFactoryV1(selected:MarsWorldConfig):Promise<EngineFactory>{
 if(selected.safeCrewRemoval!==undefined&&selected.safeCrewRemoval!==false)throw Error('selected-crew-removal.legacy-config-required');
 const cfg=structuredClone(selected),old=await marsFactory(cfg),next=await marsFactory({...cfg,safeCrewRemoval:true});
 const versions=new Set([old.rulesVersion,next.rulesVersion]),base=hashOf(old.genesis('selected-native-reader-base').base);
 const install=(e:Engine)=>{if(!(e instanceof MarsEngine))throw Error('selected-crew-removal.native-required');e.enableCrewRemovalTransitionReaderV1();return e;};
 return {rulesVersion:old.rulesVersion,genesis:old.genesis,
  canReplayHistory:v=>versions.has(v),canRestoreSnapshot:v=>versions.has(v),
  create(w){if(hashOf(w.base)!==base)throw Error('selected-crew-removal.genesis-base');return install(old.create(w));},
  restore(raw:EngineSnapshot){
   const s=raw as EngineSnapshot&{cfg?:MarsWorldConfig;mars:Parameters<typeof decodeSnapshot>[0]};
   if(!s.cfg||s.cfg.safeCrewRemoval!==undefined&&typeof s.cfg.safeCrewRemoval!=='boolean')throw Error('selected-crew-removal.snapshot-policy');
   if(s.cfg.scene!==cfg.scene||(s.cfg.map??null)!==(cfg.map??null)||hashOf(decodeSnapshot(s.mars).world.base)!==base)throw Error('selected-crew-removal.snapshot-base');
   const e=install((s.cfg.safeCrewRemoval?next:old).restore(raw));
   if(!versions.has(e.rulesVersion)||e.stateHash()!==raw.stateHash)throw Error('selected-crew-removal.snapshot-state');return e;
  },validateHistoryHead(e,recorded){if(!versions.has(recorded)||e.rulesVersion!==recorded)throw Error('selected-crew-removal.history-head');},
 };
}
