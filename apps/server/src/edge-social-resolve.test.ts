// SOCIAL-INVITE: planning a social act must offer the same distant approach as acting it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {edenNavWorld} from '../test/eden-nav-fixture.ts';
import {coreAWorld} from '../test/core-a-fixture.ts';

test('activity intents preserve companions through place and target resolution, with consent and identity guards', async t => {
  const w=await coreAWorld(3),[a,b,c]=w.souls;t.after(w.close);
  const target='eden-library-1'; // fixture's admitted native library; decorative sub-places deliberately refuse
  for(const spec of [{place:target,with:b.name,seconds:60},{target,with:[b.soulId],seconds:60}]){
    const dry=await w.http(a,'POST','/v1/edge/resolve',{verb:'read',target:spec});
    assert.equal(dry.body.resolve.ok,true,JSON.stringify(dry));
    assert.deepEqual(dry.body.resolve.would.params,{seconds:60,with:spec.with});
    assert.equal(w.ledger.together.invitesFor(b.soulId).length,0,'dry run never invites');
  }
  const bad=await w.http(a,'POST','/v1/edge/act',{verb:'read',target:{place:target,with:false}});
  assert.equal(bad.body.accepted,false);assert.equal(bad.body.code,'capability.params');
  const prior=w.f.host.soulNameRefusal;w.f.host.soulNameRefusal=ref=>ref===b.name?'soul.name-ambiguous':prior.call(w.f.host,ref);
  const stale=await w.http(a,'POST','/v1/edge/act',{verb:'read',target:{place:target,with:b.name}});
  assert.equal(stale.body.accepted,false);assert.equal(stale.body.code,'soul.name-ambiguous');w.f.host.soulNameRefusal=prior;
  const started=await w.http(a,'POST','/v1/edge/act',{verb:'read',target:{place:target,seconds:60,with:b.name}});
  assert.equal(started.body.accepted,true,JSON.stringify(started));
  const inv=w.ledger.together.invitesFor(b.soulId)[0];assert.ok(inv,'same requested read creates an invitation, never silently solo');
  assert.equal(inv.seconds,60);
  assert.equal(inv.activity,'read','short browse epilogue is not the requested activity');
  // Both acceptance branches start from a guest's default180s plan; the invitation owns the requested duration.
  for(const same of [true,false]){
    const id=same?inv.capability:'read:fixture-neighbor',at=inv.meetAt??w.pos(a);
    const steps=[{verb:'walk_to',params:{to:at}},{verb:'mars:pose_v1',params:{activity:'browse',seconds:4}},{verb:'mars:pose_v1',params:{activity:'read',seconds:180}},{verb:'mars:pose_v1',params:{activity:'browse',seconds:3}}];
    const caps=[{id,verb:'read',label:'Fixture reading place',available:true,target:{id:'fixture-spot',kind:'spot' as const}}];
    const plans=new Map([[id,{label:'Read',steps}]]);
    const guest=w.ledger.together.acceptPlan(b,inv.id,caps,plans);assert.ok('steps' in guest,JSON.stringify(guest));
    assert.equal(guest.steps.find(x=>x.params.activity==='read')?.params.seconds,60,same?'same named place':'nearby free spot');
    assert.deepEqual(guest.steps.filter(x=>x.params.activity==='browse').map(x=>x.params.seconds),[4,3],'shelf visits keep their native durations');
    assert.equal(steps[2].params.seconds,180,'cached guest default plan is not mutated');
  }
  assert.equal(w.ledger.together.invitesFor(c.soulId).length,0);
  const outsider=await w.http(c,'POST','/v1/edge/act',{capability:'accept:'+inv.id});assert.equal(outsider.body.accepted,false);
  const accepted=await w.http(b,'POST','/v1/edge/act',{capability:'accept:'+inv.id});assert.equal(accepted.body.accepted,true,JSON.stringify(accepted));
  // Isolate the guest duration from unrelated simultaneous shelf occupancy in this older native fixture.
  // This is timer/receipt proof, not a claim that the two bodies complete shared reading together.
  await w.http(a,'POST','/v1/edge/act',{capability:'stand:here'});
  let readStart:number|undefined,readEnd:number|undefined;
  await w.ticks(6000,()=>{
    if(w.body(b).human.activity==='read')readStart??=w.engine.world.tick;
    const rec=w.receipt(b,accepted.body.receipt.id);
    if(rec.phase==='completed'){readEnd=w.engine.world.tick;return true;}
    assert.ok(!['failed','cancelled','replaced'].includes(rec.phase),JSON.stringify(rec));return false;
  });
  assert.notEqual(readStart,undefined,'guest actually begins native reading');assert.notEqual(readEnd,undefined,'guest actually completes requested reading');
  const readSeconds=(readEnd!-readStart!)/20;assert.ok(readSeconds>=55&&readSeconds<=90,`native guest reading plus join-window/epilogue lasted ${readSeconds}s, expected requested60 not default180`);
  t.diagnostic(JSON.stringify({guestNativeReadThroughReceiptSeconds:readSeconds,invitedSeconds:inv.seconds,guestReceipt:w.receipt(b,accepted.body.receipt.id).phase}));
});

test('dry-running a named social approach outside sight resolves without inviting or changing the listing', async t => {
  const w = await edenNavWorld(2), [a, b] = w.souls;
  t.after(() => {w.f.host.stop(); w.f.db.close();});
  // Fixture positions in opposite known places; no movement simulation is needed to test dry-run resolution.
  for (const [s, id] of [[a, 'eden-north-woods'], [b, 'eden-gardens']] as const) {
    const p = w.ledger.places.byId.get(id)!.polygon;
    const body = w.engine.world.entities[s.entityId];
    body.pose.p[0] = p.reduce((n, xy) => n + xy[0], 0) / p.length;
    body.pose.p[2] = p.reduce((n, xy) => n + xy[1], 0) / p.length;
  }
  const caps = w.ledger.capabilities(a).map(c => c.id), tick = w.engine.world.tick;
  assert.ok(!caps.includes('go-near:' + b.soulId), 'target is outside the visible listing');
  for (const [words, verb] of [['hug', 'hug'], ['dance with', 'dance-with'], ['high five', 'high-five']] as const) {
    const result = w.ledger.intents.dryRun(a, {capability: `${words} ${b.name}`}) as any;
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.would.capability, `${verb}:${b.soulId}`);
    assert.equal(result.would.available, true);
  }
  assert.equal(w.engine.world.tick, tick);
  assert.deepEqual(w.ledger.capabilities(a).map(c => c.id), caps, 'dry run leaves cached offered capabilities unchanged');
  assert.deepEqual(w.ledger.together.invitesFor(b.soulId), [], 'dry run sends no invitation');
});
