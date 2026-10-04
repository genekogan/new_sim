import { workerData } from 'node:worker_threads';
import { toyFactory } from '@sim/engine-toy';
import { Db } from '../../src/db.ts';
import { WorldHost } from '../../src/world.ts';
const db=new Db(workerData.path),host=new WorldHost(db,toyFactory,'admission-fixture',1e9,'admission-world');host.boot();
const revision=Object.values(host.intentHistoryOf('s_A').intents)[0].revision;
const append=db.appendEvent.bind(db);
db.appendEvent=(world,event)=>{
  if(event.kind==='intent-admission-v2' && workerData.phase==='before-fact')process.exit(23);
  append(world,event);
  if(event.kind==='intent-admission-v2' && workerData.phase==='after-fact')process.exit(23);
};
void host.enqueueIntentDecision('brain:reflex',{soulId:'s_A',entityId:'h_A',option:'rest',label:'rest',steps:[{verb:'rest',params:{seconds:1}}],reevalTicks:1200,fallback:false,trigger:'new-intent-v2'},
  {intentId:revision.intentId,version:revision.version},()=>true);
host.drainInputs();throw new Error('worker exit boundary was not reached');
