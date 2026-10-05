import {hashOf,type EngineFactory,type EngineSnapshot} from '@sim/engine-contract';
import {MarsEngine,EDEN_SAFE_COMMONS_WORLD,type MarsWorldConfig} from './engine.ts';
import {commonsKitchenFactory} from './commons-kitchen-engine.ts';
import {createRetainedCommonsShoreReader} from './retained-shore.ts';
import {loadMars} from './load.ts';
import {commonsProvisions} from './commons-provisions.ts';
import {commonsKitchen} from './commons-kitchen.ts';

/** Old genesis and all prior provisions/kitchen facts remain authoritative. */
export async function retainedCommonsShoreFactory():Promise<EngineFactory>{
  const old=await commonsKitchenFactory({version:'commons-kitchen/2'}),reader=await createRetainedCommonsShoreReader(),m=await loadMars();
  const cfg={...EDEN_SAFE_COMMONS_WORLD,safeCrewRemoval:true,walkBlockV1:true};
  const prefix='sim-mars/1+'+reader.rulesVersion+'+crew-removal/1+commons/1+arrival-clearance/1+walk-block/1';
  const nextVersions=new Set([prefix,prefix+'+commons-provisions/1',prefix+'+commons-provisions/1+commons-kitchen/1',prefix+'+commons-provisions/1+commons-kitchen/2']);
  const install=(e:ReturnType<EngineFactory['create']>)=>{if(!(e instanceof MarsEngine))throw Error('retained-shore.native-required');e.installRetainedCommonsShoreReader(reader);return e;};
  const physicalCfg=({clock,sleepBlockTicks,quietSeatCourtesy,fixtureGroundGoalsV1,...rest}:MarsWorldConfig)=>rest;
  return {rulesVersion:old.rulesVersion,genesis:old.genesis,create:w=>install(old.create(w)),
    canReplayHistory:v=>old.canReplayHistory?.(v)===true||nextVersions.has(v),
    canRestoreSnapshot:v=>old.canRestoreSnapshot?.(v)===true||nextVersions.has(v),
    restore(raw:EngineSnapshot){
      if(!('physicalBinding' in raw))return install(old.restore(raw));
      const s=structuredClone(raw) as EngineSnapshot&{physicalBinding:string;mars:any;cfg:MarsWorldConfig;programs:any[];nextProg:number;leaving:string[];quiet?:boolean;commonsVersion?:string;commonsProvisionsV1?:boolean;commonsKitchenV1?:boolean;commonsKitchenVersion?:'commons-kitchen/1'|'commons-kitchen/2'};
      if(s.format!=='sim-mars-snapshot/1'||s.physicalBinding!==reader.rulesVersion||s.commonsVersion!=='commons/1'||hashOf(physicalCfg(s.cfg))!==hashOf(cfg))throw Error('retained-shore.snapshot-binding');
      if(s.commonsKitchenV1&&!s.commonsProvisionsV1)throw Error('retained-shore.snapshot-resource-policy');
      if(!s.commonsKitchenV1&&s.commonsKitchenVersion!==undefined)throw Error('retained-shore.snapshot-resource-policy');
      const e=install(new MarsEngine(m,reader.restore(s.mars),s.cfg,{programs:s.programs,nextProg:s.nextProg,leaving:s.leaving},reader));
      e.enableCommonsProvisionsReaderV1(s.commonsProvisionsV1===true);e.enableCommonsKitchenReaderV1(s.commonsKitchenV1===true,s.commonsKitchenVersion??'commons-kitchen/1');
      if(s.commonsProvisionsV1){const p=commonsProvisions();if(!Object.keys(p.entities).every(id=>e.world.entities[id])||!Object.keys(p.regions).every(id=>e.world.regions[id]))throw Error('retained-shore.snapshot-resource-policy');}
      if(s.commonsKitchenV1&&!Object.keys(commonsKitchen(s.commonsKitchenVersion??'commons-kitchen/1').entities).every(id=>e.world.entities[id]))throw Error('retained-shore.snapshot-resource-policy');
      if(s.quiet)e.beginQuiet();
      if(!nextVersions.has(e.rulesVersion)||e.world.tick!==s.tick||e.stateHash()!==s.stateHash)throw Error('retained-shore.snapshot-state');
      return e;
    },
    validateHistoryHead(e,recorded){if(e.rulesVersion!==recorded||!(old.canReplayHistory?.(recorded)||nextVersions.has(recorded)))throw Error('retained-shore.history-head');},
  };
}
