// Opt-in native bridge qualification. Actual bodies/controllers/log/SQLite;
// synthetic compiler transport, fake Jev, no network model or paid spend.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { marsFactory } from '@sim/engine-mars';
import { buildMidRequest, newLife, type CompileOut, type callTool } from '@sim/brain';
import { INTENT_V2, publicEvent } from '@sim/protocol';
import { Brain } from './brain.ts';
import { config } from './config.ts';
import { Db } from './db.ts';
import { IntentPublisher } from './intent-publisher.ts';
import { IntentRequests, type IntentRequestScope } from './intent-requests.ts';
import { WorldHost, replayFromGenesis } from './world.ts';

const factory = await marsFactory({ scene: 'eden-camp', arrival: [16,-10], arrivalPlace: 'bunkhouse',
  reference: [16,-9], grounds: { id: 'grounds', name: 'grounds' } });
async function accept<T>(host: WorldHost, promise: Promise<T>) {
  let done = false; promise.then(() => done = true, () => done = true);
  for (let i = 0; i < 50 && !done; i++) { await setImmediate(); host.drainInputs(); }
  assert.ok(done, 'producer settled through the actual sequencer'); return promise;
}
async function ticks(host: WorldHost, n: number, stop: () => boolean = () => false) {
  for (let i = 0; i < n && !stop(); i++) { host.tickOnce(); if (i % 10 === 0) await setImmediate(); }
}
function fixture(t: TestContext, enabled = true) {
  const db = new Db(':memory:'); t.after(() => db.close());
  db.upsertUser({ id: 'owner', role: 'user', email: null, wallet: null }); db.setInvited('owner','fixture');
  const host = new WorldHost(db, factory, 'ordinary-response', 1e9, 'native-response'); host.boot();
  db.createSoul({ id: 's_A', entityId: 'h_A', worldId: host.worldId, owner: 'owner', name: 'Alice', description: 'fixture', native: false });
  void host.enqueue('birth','fixture',{ soulId:'s_A', entityId:'h_A', owner:'owner', name:'Alice', description:'fixture' }); host.drainInputs();
  const mind = host.minds.get('s_A')!; mind.life = newLife(0); mind.nextEvalTick = 1e9;
  let calls = 0;
  const compilerCall: typeof callTool = async <T>(input: Parameters<typeof callTool>[0]) => {
    calls++; assert.match(input.system, /ordinary actionable present direction/);
    assert.ok(JSON.stringify(input.messages).includes('go to the campfire'));
    const out: CompileOut = { understood:true, agenda:[{ card:'go to', target:'campfire' }],
      alignment:{ understanding:'Walk to the campfire.', trigger:{ kind:'now' } } };
    return { out:out as T, ms:0, inputTokens:0, outputTokens:0, cachedTokens:0, costUsd:0, request:null, raw:{ synthetic:true } };
  };
  const brain = new Brain(host, db, { ...config, worldKey:'eden', brainMode:'fake', typesafeKey:undefined,
    anthropicKey:'synthetic-compiler-fixture', compilerModel:'synthetic-compiler-fixture', budgetUsdPerDay:0.5 },
    { clients:()=>0,onCall(){},onCamera(){},onTicker(){},onNarrative(){},onTalk(){} }, { compilerCall, intentV2Choices:enabled });
  const store = new IntentRequests(db), publisher = new IntentPublisher(host,store);
  const scope: IntentRequestScope = { worldId:host.worldId, soulId:'s_A', source:{ kind:'owner',ownerId:'owner',principalId:'private-principal',channel:'web' },
    currentAuthority:row=>row.owner==='owner' && !!db.user('owner')?.invited_by };
  return { db,host,mind,brain,store,publisher,scope,get calls(){return calls;} };
}
async function received(f: ReturnType<typeof fixture>, requestId: string, words: string) {
  const r = await accept(f.host,f.publisher.receive(f.scope,{ contract:INTENT_V2,op:'upsert',requestId,words }));
  assert.ok(r.reservation.created); return r.reservation;
}
async function sleep(f: ReturnType<typeof fixture>) {
  await accept(f.host,f.host.enqueue('decision','fixture',{ soulId:'s_A',entityId:'h_A',option:'sleep-fixture',label:'sleep on mat',
    steps:[{ verb:'mars:sleep',params:{ mat:'mat-1',duration:600 } }],reevalTicks:1e9,fallback:false,trigger:'fixture' }));
  await ticks(f.host,1800,()=>f.host.engine.world.entities.h_A.human!.activity==='sleep');
  assert.equal(f.host.engine.world.entities.h_A.human!.activity,'sleep','actual ground-mat controller reached sleep');
  return f.host.engine.programOf('h_A');
}

test('ordinary V2 direction wakes an actually sleeping native body; older purpose stays private context and model-free replay agrees',async t=>{
  const f=fixture(t);
  const old=await received(f,'older','PRIVATE_OLDER purpose: make friends if you feel like it');
  await accept(f.host,f.publisher.publish(f.scope,old,{ summary:'Welcome company.',agenda:[{card:'rest',target:null}],trigger:{kind:'none'} }));
  f.mind.nextEvalTick=1e9;
  const sleeping=await sleep(f); assert.ok(sleeping);
  const request=await received(f,'campfire','go to the campfire');
  const published=await accept(f.host,f.publisher.interpretAndPublish(f.scope,request,async guard=>{
    f.brain.mode='live';
    try {
      const c=await f.brain.compile(f.mind,request.request.op==='upsert'?request.request.words:'','intent-v2',guard,f.store.journal(request));
      assert.ok(c?.ok && c.alignment); return { summary:c.alignment.understanding,agenda:c.agenda,trigger:c.alignment.trigger };
    } finally { f.brain.mode='fake'; }
  }));
  assert.equal(published.receipt?.phase,'understood'); assert.equal(f.calls,1); assert.equal(f.db.paidCost(),0);
  const origin=f.host.engine.world.tick, before=[...f.host.engine.world.entities.h_A.pose.p];
  const ctx=f.brain.midContext(f.mind,'new-intent-v2');
  assert.equal(ctx.purposes?.length,2); assert.ok(JSON.stringify(buildMidRequest(ctx).request).includes('PRIVATE_OLDER'));
  await ticks(f.host,100,()=>f.host.engine.world.entities.h_A.human!.activity==='walk');
  const motionTick=f.host.engine.world.tick;
  assert.equal(f.host.engine.world.entities.h_A.human!.activity,'walk');
  assert.ok(motionTick-origin<=100,'first observed walking within five simulation seconds');
  assert.notEqual(f.host.engine.programOf('h_A'),sleeping);
  await ticks(f.host,1800,()=>f.host.kernel.things.s_A.at==='campfire');
  assert.equal(f.host.kernel.things.s_A.at,'campfire','arrival effect follows native approach');
  assert.notDeepEqual(f.host.engine.world.entities.h_A.pose.p,before);
  const decisions=f.db.events(f.host.worldId).filter(e=>e.kind==='decision' && e.author==='brain:reflex');
  assert.equal(decisions[0].payload.card,'go to'); assert.equal(decisions[0].tick,published.event.tick+1);
  assert.equal(Object.keys(f.host.intentHistoryOf('s_A').intents).length,2);
  assert.ok(!JSON.stringify(f.db.events(f.host.worldId).map(publicEvent)).includes('PRIVATE_OLDER'));
  assert.deepEqual(f.host.engine.runtime.violations,[]);
  const replay=replayFromGenesis(factory,'ordinary-response',f.db.events(f.host.worldId),f.host.engine.world.tick);
  assert.equal(replay.engine.stateHash(),f.host.engine.stateHash());
  t.diagnostic(`publication=${published.event.tick}; decision=${decisions[0].tick}; walking=${motionTick}; arrival=${f.host.engine.world.tick}; paid=$0`);
});

test('default reader records understanding without waking the native sleeper',async t=>{
  const f=fixture(t,false), sleeping=await sleep(f), r=await received(f,'disabled','go to the campfire');
  await accept(f.host,f.publisher.publish(f.scope,r,{ summary:'Walk to the campfire.',agenda:[{card:'go to',target:'campfire'}],trigger:{kind:'now'} }));
  await ticks(f.host,100);
  assert.equal(f.host.engine.programOf('h_A'),sleeping); assert.equal(f.host.engine.world.entities.h_A.human!.activity,'sleep');
  assert.equal(f.brain.midContext(f.mind,'timer').purposes,undefined);
});

test('a newer standing purpose never reissues an older immediate direction',async t=>{
  const f=fixture(t), a=await received(f,'immediate','go to the campfire');
  await accept(f.host,f.publisher.publish(f.scope,a,{summary:'Walk to the campfire.',agenda:[{card:'go to',target:'campfire'}],trigger:{kind:'now'}}));
  const b=await received(f,'standing','rest if you feel like it');
  await accept(f.host,f.publisher.publish(f.scope,b,{summary:'Rest optionally.',agenda:[{card:'rest',target:null}],trigger:{kind:'none'}}));
  const ctx=f.brain.midContext(f.mind,'new-intent-v2');
  assert.equal(ctx.purposes?.length,2); assert.ok(!ctx.options.some(o=>o.card==='go to' && o.servesIntent));
  assert.deepEqual(f.mind.agenda,[],'retained purposes do not replace a legacy agenda');
});

test('withdrawal accepted ahead of a prepared native choice prevents its admission',async t=>{
  const f=fixture(t), r=await received(f,'queued-direction','go to the campfire');
  const published=await accept(f.host,f.publisher.publish(f.scope,r,{summary:'Walk to the campfire.',agenda:[{card:'go to',target:'campfire'}],trigger:{kind:'now'}}));
  assert.equal(published.receipt?.phase,'understood');
  const revision=published.receipt!.phase==='understood'?published.receipt.revision:null;assert.ok(revision);
  const withdrawal=await accept(f.host,f.publisher.receive(f.scope,{contract:INTENT_V2,requestId:'withdraw-queued',op:'withdraw',
    edit:{intentId:revision.intentId,expectedVersion:revision.version}}));assert.ok(withdrawal.reservation.created);
  // Queue withdrawal first, while the live projection still contains the
  // direction. Preparing a choice from that projection must not outrun it.
  const pending=f.publisher.publish(f.scope,withdrawal.reservation);
  await f.brain.evaluate(f.mind,'new-intent-v2');
  await accept(f.host,pending);await setImmediate();
  assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='decision').length,0);
  assert.equal(f.host.engine.programOf('h_A'),null);
  assert.equal(f.host.intentHistoryOf('s_A').intents[revision.intentId].status,'withdrawn');
});
