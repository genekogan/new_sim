// Source-owned installer for the existing Eden control plane. Explicitly
// selected by main; no default factory or environment/config value changes.
import {marsFactory,marsCommonsTransitionFactory,marsCrewRemovalTransitionFactory,GREEN_FIELD_WORLD,EDEN_SAFE_COMMONS_WORLD} from '@sim/engine-mars';
import type {EngineFactory} from '@sim/engine-contract';
import type {Db} from './db.ts';
import type {WorldHost} from './world.ts';
import type {Config} from './config.ts';
import type {LivingWorld} from './living.ts';
import type {Brain} from './brain.ts';
import type {IntentControlV2} from './intent-control.ts';

export function edenCoreRequested(cfg:Config,env:NodeJS.ProcessEnv){return cfg.worldKey==='eden'&&cfg.engine==='mars'&&env.ENABLE_EDEN_CORE==='1';}
export async function edenHistoryFactory(db:Db,worldId:string):Promise<EngineFactory>{
  const header=db.world(worldId);
  if(!header)return marsFactory({...EDEN_SAFE_COMMONS_WORLD,safeCrewRemoval:true});
  const policy=db.db.prepare("SELECT seq FROM events WHERE world_id=? AND kind='rules' AND json_extract(payload,'$.crewRemovalTransition.contract')='crew-removal-transition/1' ORDER BY seq LIMIT 1").get(worldId);
  if(policy)return marsCrewRemovalTransitionFactory();
  const physical=db.db.prepare("SELECT payload FROM events WHERE world_id=? AND kind='rules' AND json_extract(payload,'$.commonsTransition.contract')='commons-transition/1' ORDER BY seq LIMIT 1").get(worldId) as {payload:string}|undefined;
  const originalRules=physical?JSON.parse(physical.payload).commonsTransition.fromRulesVersion:header.rules_version;
  if(!physical&&header.rules_version.includes('+commons/1'))return marsFactory({...EDEN_SAFE_COMMONS_WORLD,safeCrewRemoval:true});
  if(originalRules.includes('+crew-removal/1'))return marsCommonsTransitionFactory({...GREEN_FIELD_WORLD,safeCrewRemoval:true},{safeArrivalV1:true});
  return marsCrewRemovalTransitionFactory();
}

export async function installEdenCore(host:WorldHost,options:{applyCrew:boolean;applyCommons:boolean;retainReader?:boolean}){
  if(options.retainReader){if(options.applyCrew||options.applyCommons)throw Error('eden-bootstrap.retain-reader-cannot-install');return [];}
  const crew=!host.engine.rulesVersion.includes('+crew-removal/1'),commons=host.engine.world.base.campus!=='eden-commons';
  if(crew&&!options.applyCrew)throw Error('eden-bootstrap.explicit-crew-checkpoint-required');
  if(commons&&!options.applyCommons)throw Error('eden-bootstrap.explicit-commons-checkpoint-required');
  if((crew||commons)&&host.stationHistoryV1())throw Error('eden-bootstrap.station-carry-required');
  if(crew||commons){
    // Preview both steps on detached resumable native data before committing
    // either. Never erase a successfully committed prefix after a later fault.
    if(!host.engine.canSnapshot?.())throw Error('eden-bootstrap.resumable-boundary-required');
    const copy=host.factory.restore(host.engine.snapshot());
    if(copy.stateHash()!==host.engine.stateHash())throw Error('eden-bootstrap.preview-restore-differs');
    if(crew){const p=copy.previewCrewRemovalTransitionV1?.();if(!p?.ok)throw Error(p?p.diagnostic.code:'eden-bootstrap.crew-reader-unavailable');copy.adoptCrewRemovalTransitionV1!(p.transition);}
    if(commons){const p=copy.previewCommonsTransition?.();if(!p?.ok)throw Error(p?p.diagnostic.code:'eden-bootstrap.commons-reader-unavailable');
      const known=new Set(host.engine.anchors().map(a=>a.id));for(const a of p.anchors)if(!known.has(a.id)&&host.kernel.things[a.id])throw Error('eden-bootstrap.kernel-collision');}
  }
  const facts=[];
  if(crew){const p=host.adoptCrewRemovalPolicyV1('operator:eden-core-bootstrap');host.drainInputs();facts.push(await p);}
  if(commons){const p=host.adoptCommons('operator:eden-core-bootstrap');host.drainInputs();facts.push(await p);}
  if(!host.engine.rulesVersion.includes('+crew-removal/1')||host.engine.world.base.campus!=='eden-commons')throw Error('eden-bootstrap.installation-incomplete');
  return facts;
}

export async function settleEmptyEden(host:WorldHost,living:LivingWorld|null,customs:string[]){
  if(!living)return;
  const installation=living.install(customs);host.drainInputs();await installation;
  if(host.minds.size===0&&host.living!.lastDay<0){for(let i=0;i<4;i++){host.tickOnce();host.drainInputs();}if(host.quietBarrier)throw Error('eden-bootstrap.empty-renewal-unsettled');}
}

/** Quiesce before calling. Clock/DB remain alive, including an explicitly
 * paused clock whose sequencer still must finish already accepted writes. */
export async function drainEdenThought(host:WorldHost,brain:Brain,service:IntentControlV2|undefined,acceptedRequests:Promise<unknown>=Promise.resolve()){
  brain.quiesce();
  let fail!:(error:unknown)=>void;const failure=new Promise<never>((_,reject)=>fail=reject);
  const pump=setInterval(()=>{try{host.drainInputs();}catch(error){fail(error);clearInterval(pump);}},10);
  const drain=async()=>{await acceptedRequests;await Promise.all([brain.settled(),service?.settled()]);host.drainInputs();};
  try{await Promise.race([drain(),failure]);}
  finally{clearInterval(pump);}
}
