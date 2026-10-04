import { humanBirthRequestSchema, type Engine, type EngineFactory, type HumanBirthProbe } from '@sim/engine-contract';

/** Run the existing native placer in an exact detached checkpoint. This never
 * accepts a birth, advances live time, reserves capacity or repairs old logs.
 * Non-resumable live work defers; invariant/codec errors remain errors. */
export function probeNativeHumanBirth(engine:Engine,factory:EngineFactory,raw:unknown):HumanBirthProbe {
  const request=humanBirthRequestSchema.parse(raw);
  if(!engine.rulesVersion.startsWith('sim-mars/1+')||factory.rulesVersion!==engine.rulesVersion)
    throw new Error('Native birth probe requires the matching native engine factory');
  const base={schema:engine.schema,rulesVersion:engine.rulesVersion,tick:engine.world.tick,stateHash:engine.stateHash()};
  const common={contract:'detached-native-birth/1' as const,base,request};
  const existing=engine.world.entities[request.id];
  if(existing){
    if(existing.kind==='human'&&existing.human?.soul===request.soul&&existing.label===request.label)
      return {...common,outcome:'existing',position:[...existing.pose.p]};
    return {...common,outcome:'unavailable',diagnostic:{code:'birth.identity-conflict',message:'The entity id already belongs to a different body identity.'}};
  }
  if(!engine.canSnapshot?.())return {...common,outcome:'deferred',diagnostic:{code:'birth.checkpoint-required',message:'Current native activity has no exact resumable checkpoint.'}};
  const snapshot=engine.snapshot() as ReturnType<Engine['snapshot']>&{dropped?:number};
  if(snapshot.dropped!==0||snapshot.tick!==base.tick||snapshot.stateHash!==base.stateHash)
    throw new Error('Native birth checkpoint is not exact');
  const detached=factory.restore(snapshot);
  if(detached.stateHash()!==base.stateHash)throw new Error('Native birth checkpoint did not restore exactly');
  try{
    try{detached.spawnHuman(request);}
    catch(error){
      if(error instanceof Error&&error.message==='no free standing room at the arrival point')
        return {...common,outcome:'unavailable',diagnostic:{code:'birth.arrival-unavailable',message:error.message}};
      throw error;
    }
    const body=detached.world.entities[request.id];
    if(!body||body.kind!=='human'||body.human?.soul!==request.soul)throw new Error('Native birth probe did not create the requested body identity');
    return {...common,outcome:'ready',position:[...body.pose.p]};
  }finally{
    if(engine.stateHash()!==base.stateHash||engine.world.tick!==base.tick)throw new Error('Native birth probe changed the authoritative world');
  }
}
