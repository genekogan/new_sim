import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { marsFactory } from '@sim/engine-mars';
import { toyFactory } from '@sim/engine-toy';
import type { Engine, EngineFactory } from '@sim/engine-contract';
import { kernelHash } from '@sim/kernel';
import { publicEvent } from '@sim/protocol';
import { Db } from './db.ts';
import { WorldHost, replayFromGenesis, replayKernel } from './world.ts';
import { initKernel } from './fold.ts';
import { optionsFor } from './deck.ts';

// A deterministic adapter fault at execution, not a graceful feasibility refusal.
function faultyFactory(): EngineFactory {
  const wrap=(e:Engine) => { let armed=false; const perform=e.perform.bind(e), step=e.step.bind(e);
    e.perform=p=>{if(p.label==='bad test') armed=true; return perform(p);};
    e.step=()=>{if(armed) throw new Error('fixture.bad-card'); return step();}; return e; };
  return {...toyFactory,create:w=>wrap(toyFactory.create(w)),restore:s=>wrap(toyFactory.restore(s))};
}
test('fault restores checkpoint and filtered log; three faults quarantine; restart and both replay paths agree',()=>{
  const db=new Db(join(mkdtempSync(join(tmpdir(),'sim-recovery-')),'sim.db')), factory=faultyFactory();
  const h=new WorldHost(db,factory,'recovery',1e9); h.boot();
  void h.enqueue('birth','test',{soulId:'s_A',entityId:'h_A',name:'A',description:'quiet',owner:'private-owner'}); h.tickOnce(); h.saveSnapshot();
  for(let fault=1;fault<=3;fault++) {
    void h.enqueue('decision','test',{soulId:'s_A',entityId:'h_A',option:'rest',card:'rest',label:'bad test',steps:[{verb:'rest',params:{seconds:60}}],target:null,approachLen:0,reevalTicks:1200,trigger:'test',fallback:true});
    h.tickOnce(); assert.equal((h.extra.cardFaults as any).rest,fault); assert.equal(h.engine.runtime.violations.length,0);
    assert.ok(!optionsFor(h,h.minds.get('s_A')!).some(o=>o.card==='rest'),'faulty card withheld while choosing again');
    for(let i=0;i<1201;i++) h.tickOnce();
  }
  assert.ok(!optionsFor(h,h.minds.get('s_A')!).some(o=>o.card==='rest'),'third fault persists quarantine');
  void h.enqueue('rules','test',{checkpoint:'exact tick'}); h.drainInputs();
  const events=db.events(h.worldId), replay=replayFromGenesis(factory,'recovery',events,h.engine.world.tick), k=replayKernel(initKernel(factory.create(factory.genesis('recovery'))),events);
  assert.equal(replay.engine.stateHash(),h.engine.stateHash()); assert.equal(kernelHash(replay.kernel),kernelHash(h.kernel)); assert.equal(kernelHash(k),kernelHash(h.kernel));
  const next=new WorldHost(db,factory,'recovery',1e9); next.boot(); assert.equal(next.engine.stateHash(),h.engine.stateHash()); assert.equal(kernelHash(next.kernel),kernelHash(h.kernel)); assert.deepEqual(next.extra.cardFaults,h.extra.cardFaults);
  const repair=events.filter(e=>e.payload?.recovery).at(-1)!; assert.ok(JSON.stringify(repair).includes('private-owner')); assert.ok(!JSON.stringify(publicEvent(repair)).includes('private-owner')); assert.ok(!JSON.stringify(publicEvent(repair)).includes('baseline'));
  db.close();
});

test('historical Mars invariant receipts survive restart without being treated as fresh faults',async()=>{
 const db=new Db(join(mkdtempSync(join(tmpdir(),'sim-old-receipts-')),'sim.db')),factory=await marsFactory();
 const h=new WorldHost(db,factory,'historic',1e9);h.boot();
 void h.enqueue('birth','test',{soulId:'s_A',entityId:'h_A',name:'A',description:'quiet',owner:'test'});h.tickOnce();
 h.engine.runtime.violations.push({tick:0,code:'historic.receipt',message:'A previously recorded violation, already resolved'});h.saveSnapshot();
 const fresh=new WorldHost(db,factory,'historic',1e9);fresh.boot();assert.equal(fresh.engine.runtime.violations.length,1);fresh.tickOnce();
 assert.equal(fresh.engine.runtime.violations.length,1);assert.equal(db.events(h.worldId).filter(e=>e.payload?.recovery).length,0);db.close();
});
