import type {EngineFactory,EngineSnapshot} from '@sim/engine-contract';
import {MarsEngine} from './engine.ts';
import {commonsProvisionsFactory} from './commons-provisions-engine.ts';
import {commonsKitchen} from './commons-kitchen.ts';
export async function commonsKitchenFactory():Promise<EngineFactory>{
  const old=await commonsProvisionsFactory(),provisionVersion=old.rulesVersion+'+commons-provisions/1',version=provisionVersion+'+commons-kitchen/1';
  const install=(e:ReturnType<EngineFactory['create']>,active=false)=>{if(!(e instanceof MarsEngine))throw Error('commons-kitchen.native-required');e.enableCommonsKitchenReaderV1(active);return e;};
  return {rulesVersion:old.rulesVersion,genesis:old.genesis,create:w=>install(old.create(w)),
    canReplayHistory:v=>old.canReplayHistory?.(v)===true||v===version,canRestoreSnapshot:v=>old.canRestoreSnapshot?.(v)===true||v===version,
    restore(snap:EngineSnapshot){const s=structuredClone(snap) as EngineSnapshot&{commonsKitchenV1?:boolean};const active=s.commonsKitchenV1===true;delete s.commonsKitchenV1;
      const e=install(old.restore(s),active);if(active&&!Object.keys(commonsKitchen().entities).every(id=>e.world.entities[id]))throw Error('commons-kitchen.snapshot-incomplete');return e;},
    validateHistoryHead(e,recorded){if(e.rulesVersion!==recorded)throw Error('commons-kitchen.history-head-differs');}};
}
