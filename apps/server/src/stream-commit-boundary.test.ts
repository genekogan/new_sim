import test from 'node:test';
import assert from 'node:assert/strict';
import {eventsFixture} from './edge/events/testing.ts';
import {tx} from './edge/comms/store.ts';

test('stream subscribers observe only committed events across nested transactions', () => {
  const f = eventsFixture(['CommitProbe']);
  const seen: unknown[] = [], soul = f.id('CommitProbe');
  try {
    f.runtime.streams.onEvent((_soul, event) => seen.push(event));
    assert.throws(() => tx(f.db.db, () => {
      f.runtime.streams.deliver(soul, 'world.notice', 1, {text: 'Synthetic rollback canary'});
      throw new Error('after stream insert, before outer commit');
    }), /before outer commit/);
    const stored = f.runtime.streams.read(soul, 0).events;
    console.log('STREAM_COMMIT_BOUNDARY ' + JSON.stringify({storedAfterRollback: stored.length,notifiedAfterRollback: seen.length}));
    assert.equal(stored.length, 0);
    assert.equal(seen.length, 0, 'an advisory callback must not publish a rolled-back event');
    tx(f.db.db, () => {
      f.runtime.streams.deliver(soul, 'world.notice', 2, {text: 'Committed synthetic notice'});
      assert.equal(seen.length, 0, 'nested stream savepoint is not the outer commit');
    });
    assert.equal(seen.length, 1);
    assert.equal(f.runtime.streams.read(soul, 0).events.length, 1);
  } finally { f.destroy(); }
});

test('nested inner rollback discards only its notifications; outer commit is synchronous and reentrant FIFO',()=>{
 const f=eventsFixture(['CommitProbe']),soul=f.id('CommitProbe'),seen:string[]=[];
 try{
  f.runtime.streams.onEvent((_id,e)=>{seen.push(String(e.text));if(e.text==='first')f.runtime.streams.deliver(soul,'world.notice',3,{text:'reentrant'});});
  tx(f.db.db,()=>{
   f.runtime.streams.deliver(soul,'world.notice',1,{text:'first'});
   assert.throws(()=>tx(f.db.db,()=>{f.runtime.streams.deliver(soul,'world.notice',2,{text:'rolled inner'});throw Error('inner rollback');}));
   tx(f.db.db,()=>{const e=f.runtime.streams.deliver(soul,'world.notice',2,{text:'second',nested:{value:'stored'}});e.text='producer mutation';(e.nested as {value:string}).value='changed';});
   assert.deepEqual(seen,[]);
  });
  assert.deepEqual(seen,['first','second','reentrant']);assert.deepEqual(f.runtime.streams.read(soul,0).events.map(e=>e.text),seen);
  assert.deepEqual(f.runtime.streams.read(soul,0).events[1].nested,{value:'stored'});
 }finally{f.destroy();}
});

test('publishing inside untracked raw transactions fails closed; no rolled-back callback or event',()=>{
 const f=eventsFixture(['CommitProbe']),soul=f.id('CommitProbe');let seen=0;
 try{f.runtime.streams.onEvent(()=>seen++);f.db.db.exec('BEGIN');
  assert.throws(()=>f.runtime.streams.deliver(soul,'world.notice',1,{text:'raw transaction'}),/untracked-outer/);f.db.db.exec('ROLLBACK');
  assert.equal(seen,0);assert.equal(f.runtime.streams.read(soul,0).events.length,0);
  f.runtime.streams.deliver(soul,'world.notice',2,{text:'normal'});assert.equal(seen,1);
 }finally{f.destroy();}
});

test('waiters wake only after outer commit, never after rolled-back inner release',async()=>{
 const f=eventsFixture(['CommitProbe']),soul=f.id('CommitProbe'),ac=new AbortController();let woke=false;
 try{const waiting=f.runtime.streams.waitForEvent(soul,3000,ac.signal).then(()=>{woke=true;});
  assert.throws(()=>tx(f.db.db,()=>{f.runtime.streams.deliver(soul,'world.notice',1,{text:'rollback'});throw Error('rollback');}));
  await Promise.resolve();assert.equal(woke,false);
  tx(f.db.db,()=>{f.runtime.streams.deliver(soul,'world.notice',2,{text:'committed'});assert.equal(woke,false);});
  await waiting;assert.equal(woke,true);
 }finally{ac.abort();f.destroy();}
});

test('actual receipt callback and fake webhook cannot publish a rolled-back terminal outcome',async()=>{
 const requests:{events:unknown[];insideTransaction:boolean}[]=[];
 let transaction=()=>false;
 const f=eventsFixture(['CommitProbe'],{comms:{fetch:async(_url,init)=>{requests.push({events:JSON.parse(init.body).events,insideTransaction:transaction()});return {ok:true,status:200};}}}),soul=f.id('CommitProbe');transaction=()=>f.db.db.isTransaction;
 try{
  f.runtime.webhooks.subscribe({soulId:soul,entityId:'h_'+soul,name:'CommitProbe',owner:'fixture'},{url:'https://receiver.example/fixture',secret:'x'.repeat(16)});
  const notify=()=>f.ledger.receipt({id:'r_synthetic',soulId:soul,capability:'read:here',phase:'completed',endedTick:2,outcome:{contract:'eden-edge/1.1',kind:'read',summary:'Synthetic committed fact',learned:[],produced:[],changed:[],met:[],detail:{},untrusted:false}});
  assert.throws(()=>tx(f.db.db,()=>{notify();assert.equal(requests.length,0);throw Error('outer terminal rollback');}));
  assert.equal(requests.length,0);assert.equal(f.runtime.streams.read(soul,0).events.length,0);
  tx(f.db.db,()=>{notify();assert.equal(requests.length,0);});
  assert.equal(requests.length,1,'fetch starts synchronously only after outer commit');assert.equal(requests[0].insideTransaction,false);assert.equal(requests[0].events.length,1);
  await f.runtime.webhooks.push(soul);await Promise.resolve();notify();assert.equal(f.runtime.streams.read(soul,0).events.length,1,'seen marker and event committed once');
 }finally{f.destroy();}
});
