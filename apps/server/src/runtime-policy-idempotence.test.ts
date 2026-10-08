import test from 'node:test';import assert from 'node:assert/strict';import {setImmediate} from 'node:timers/promises';
import {Db} from './db.ts';import {WorldHost} from './world.ts';import {marsFactory,GREEN_FIELD_WORLD} from '@sim/engine-mars';
test('prospective courtesy/fixture/rest policies preserve exact head/hash after snapshot and genesis restart',async()=>{
 const db=new Db(':memory:'),factory=await marsFactory(GREEN_FIELD_WORLD),hosts:WorldHost[]=[];
 async function install(host:WorldHost){for(const work of [()=>host.enableQuietLandingCourtesyV1(),()=>host.enableGroundFixtureGoalsV1(),()=>host.enableHumanRestNeedsV1()]){const p=work();host.drainInputs();await p;await setImmediate();}}
 try{let host=new WorldHost(db,factory,'policy-idempotence',1e9,'fixture-policy-world');hosts.push(host);host.boot();await install(host);
  const expected={tick:host.engine.world.tick,head:host.seq,hash:host.engine.stateHash()};await install(host);assert.equal(host.seq,expected.head);assert.equal(host.engine.stateHash(),expected.hash);
  host.saveSnapshot(true);host.stop();host=new WorldHost(db,factory,'policy-idempotence',1e9,'fixture-policy-world');hosts.push(host);assert.equal(host.boot().from,'snapshot');await install(host);assert.equal(host.seq,expected.head);assert.equal(host.engine.stateHash(),expected.hash);
  db.db.exec('DELETE FROM snapshots');host.stop();host=new WorldHost(db,factory,'policy-idempotence',1e9,'fixture-policy-world');hosts.push(host);assert.equal(host.boot().from,'genesis');await install(host);assert.equal(host.seq,expected.head);assert.equal(host.engine.stateHash(),expected.hash);assert.equal(host.engine.world.tick,expected.tick);
 }finally{for(const host of hosts)host.stop();db.close();}
});
