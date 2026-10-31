import test from 'node:test';
import assert from 'node:assert/strict';
import {marsFactory, GREEN_FIELD_WORLD, type MarsEngine} from './engine.ts';

const factory = await marsFactory(GREEN_FIELD_WORLD);
test('concurrent link egress is prospective, hashed, retained and idempotent', () => {
  const e = factory.create(factory.genesis('concurrent-egress-policy')) as MarsEngine;
  const before = e.stateHash(), historical = factory.restore(e.snapshot()) as MarsEngine;
  assert.equal(Object.hasOwn((e.snapshot() as any).cfg, 'concurrentLinkEgressV1'), false);
  assert.equal((historical as any).rt.services.concurrentLinkEgressV1, undefined);
  assert.equal(historical.stateHash(), before);
  e.configureRuntimePolicy({sleepBlockTicks:1200, concurrentLinkEgressV1:true});
  assert.notEqual(e.stateHash(), before);
  const accepted = e.stateHash();
  e.configureRuntimePolicy({sleepBlockTicks:1200, concurrentLinkEgressV1:true});
  assert.equal(e.stateHash(), accepted);
  const copy = factory.restore(e.snapshot()) as MarsEngine;
  assert.equal((copy as any).rt.services.concurrentLinkEgressV1, true);
  for (let i=0;i<20;i++) {e.step();copy.step();assert.equal(copy.stateHash(),e.stateHash());}
  assert.equal((copy.snapshot() as any).cfg.concurrentLinkEgressV1,true);
});

test('invalid policy admission cannot partially activate concurrent egress or other runtime flags', () => {
  const e = factory.create(factory.genesis('concurrent-egress-refusal')) as MarsEngine;
  const before = JSON.stringify(e.snapshot()), hash = e.stateHash();
  for (const policy of [
    {sleepBlockTicks:1200, concurrentLinkEgressV1:'bad', spreadV2:true},
    {sleepBlockTicks:0, concurrentLinkEgressV1:true, spreadV2:true},
    {sleepBlockTicks:1200, concurrentLinkEgressV1:true, quietSeatCourtesy:'bad', spreadV2:true},
  ]) {
    assert.throws(()=>e.configureRuntimePolicy(policy as any), /runtime-policy\./);
    assert.equal(e.stateHash(),hash);
    assert.equal(JSON.stringify(e.snapshot()),before);
    assert.equal((e as any).rt.services.concurrentLinkEgressV1,undefined);
  }
});
