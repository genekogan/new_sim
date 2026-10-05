// Actual owned old-preview BACKUP only. No input admission, Brain or provider.
import assert from 'node:assert/strict';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {writeFileSync} from 'node:fs';
const [input,dataDir,out]=process.argv.slice(2);assert.ok(input&&dataDir&&out);
assert.ok(resolve(dataDir).includes('/sim-wt/core/.e2e/'),'Core-owned disposable derivative only');
const load=p=>import(pathToFileURL(resolve(input,p)).href);
const {Db}=await load('apps/server/src/db.ts'),{WorldHost}=await load('apps/server/src/world.ts');
const {marsCrewRemovalTransitionFactory}=await load('packages/engine-mars/src/index.ts'),{kernelHash}=await load('packages/kernel/src/index.ts'),{hashOf}=await load('packages/engine-contract/src/index.ts');
const db=new Db(join(dataDir,'sim.db')),worldId='pm-preview-eden-20261004',factory=await marsCrewRemovalTransitionFactory();
let h=new WorldHost(db,factory,db.world(worldId).seed,1e9,worldId,{durableClockV1:true}),failure,proof;
try {
  const boot=h.boot(),before={engine:h.engine.stateHash(),kernel:kernelHash(h.kernel),tick:h.engine.world.tick},rows=db.liveSouls(worldId),events=db.events(worldId),minds=hashOf([...h.minds.values()]),world=hashOf(h.engine.world);
  const p=h.adoptCrewRemovalPolicyV1('operator:copied-policy-proof');h.drainInputs();const event=await p;
  assert.equal(hashOf(h.engine.world),world);assert.equal(kernelHash(h.kernel),before.kernel);assert.equal(hashOf([...h.minds.values()]),minds);assert.deepEqual(db.liveSouls(worldId),rows);assert.deepEqual(db.events(worldId).slice(0,events.length),events);
  const head={engine:h.engine.stateHash(),kernel:kernelHash(h.kernel),tick:h.engine.world.tick};h.saveSnapshot(true);h.stop();
  h=new WorldHost(db,factory,db.world(worldId).seed,1e9,worldId,{durableClockV1:true});const restarted=h.boot();assert.equal(restarted.from,'snapshot');assert.deepEqual({engine:h.engine.stateHash(),kernel:kernelHash(h.kernel),tick:h.engine.world.tick},head);
  proof={status:'PASS',input:resolve(input),copiedDB:resolve(dataDir),boot,restarted,originalOwners:rows.map(r=>({soulId:r.id,owner:r.owner,entityId:r.entity_id})),originalEventCount:events.length,originalHistoryHash:hashOf(events),before,event,head,bodyWorldExact:true,mindsExact:true,kernelExact:true,originalPersistedRowsExact:true,snapshotExact:true,paidUSD:db.paidCost(),limits:['Read-only original preview backup; actual copied-old history/policy/snapshot only','No full1.7million-tick original genesis soak; separate bounded owned genesis fixture qualifies policy replay','No physical commons change/lifecycle creation/live DB/release/realAuth/browser claim']};
}catch(e){failure=e;proof={status:'FAIL',failure:String(e),input:resolve(input),copiedDB:resolve(dataDir)};}
finally {h.stop();db.close();writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});}
if(failure)throw failure;
console.log(JSON.stringify({status:'PASS',out}));
