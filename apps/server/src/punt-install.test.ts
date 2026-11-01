import test from 'node:test';
import assert from 'node:assert/strict';
import type {WorldHost} from './world.ts';
import type {EdgeLedger} from './edge/ledger/ledger.ts';
import type {CarrierInstallSpec} from '../../../mars/viewer/engine/vehicles/carrier.ts';
import {installPuntActivities} from './punt-install.ts';

type Result={state:'pending'}|{state:'cancelled'}|{state:'done';candidates:CarrierInstallSpec[]};
const spec={id:'punt-fixture',def:'rowing-punt',label:'Punt',bank:{door:[0,0,0]}} as unknown as CarrierInstallSpec;
function fixture(make:(generation:number)=>{advance(ms:number):Result;cancel():unknown},running=true){
  let generations=0;
  const logs:string[]=[],objects=new Map<string,unknown>(),requests:{spec:CarrierInstallSpec;accept():void;reject():void}[]=[];
  const engine=()=>({world:{tick:0,base:{staticHash:'ground'},entities:{} as Record<string,{carrier:unknown}>},
    puntCandidatesV1:()=>{throw Error('resumable adapter must not invoke synchronous search');},
    puntCandidatesJobV1:()=>make(++generations),
    carriers(){return Object.keys(this.world.entities).map(id=>({id,def:'rowing-punt',label:'Punt',state:{bank:{door:[0,0,0]}}}));},
  });
  const host={engine:engine(),running,listeners:[] as {afterTick(tick:number):void}[],
    installCarrierV1(s:CarrierInstallSpec){
      const source=this.engine;
      return new Promise<void>((resolve,reject)=>requests.push({spec:s,accept(){source.world.entities[s.id]={carrier:{}};resolve();},reject(){reject(Error('live bank refused'));}}));
    },
  };
  const edge={comms:{objects:{has:(id:string)=>objects.has(id),create:(o:{id:string})=>objects.set(o.id,o)}},places:{containing:()=>[],byId:new Map([['world',{id:'world',parent:null}]])}};
  const handle=installPuntActivities(host as unknown as WorldHost,edge as unknown as EdgeLedger,m=>logs.push(m));
  const tick=(n:number)=>{host.engine.world.tick=n;for(const l of [...host.listeners])l.afterTick(n);};
  return {host,engine,logs,objects,requests,tick,handle,generations:()=>generations};
}
const settle=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};

test('served punt search waits initially, then advances every completed tick and publishes only after admission',async()=>{
  const slices:number[]=[];let steps=0;
  const f=fixture(()=>({advance(ms){slices.push(ms);return ++steps<3?{state:'pending'}:{state:'done',candidates:[spec]};},cancel(){}}));
  f.tick(1);for(let n=2;n<=219;n++)f.tick(n);
  assert.equal(f.generations(),0);
  f.tick(220);f.tick(221);assert.equal(f.requests.length,0);f.tick(222);
  assert.equal(f.generations(),1);assert.deepEqual(slices,[8,8,8]);assert.equal(f.requests.length,1);
  assert.equal(f.objects.size,0,'speculative completion is not a public ride');
  f.tick(223);assert.equal(slices.length,3,'no search while durable installation is pending');
  f.requests[0].accept();await settle();assert.equal(f.objects.has('ride-punt-fixture'),true);
  assert.deepEqual(f.logs,['rowing punt installed: punt-fixture']);f.handle.close();
});

test('cancellation restarts after a backoff, engine replacement cancels old work at once, and close prevents publication',async()=>{
  const cancelled:number[]=[],advanced:number[]=[];
  const f=fixture(g=>({advance(){advanced.push(g);return g===1?{state:'cancelled'}:{state:'pending'};},cancel(){cancelled.push(g);}}),false);
  f.tick(20);for(let n=21;n<120;n++)f.tick(n);assert.deepEqual(advanced,[1],'L4: a cancelled search waits 100 ticks before it starts over');
  f.tick(120);f.tick(121);assert.deepEqual(advanced,[1,2,2],'then it starts over and advances every tick');
  f.host.engine=f.engine();f.tick(122);
  assert.deepEqual(cancelled,[2]);assert.deepEqual(advanced,[1,2,2,3]);
  f.handle.close();f.tick(123);await settle();
  assert.deepEqual(cancelled,[2,3]);assert.equal(f.host.listeners.length,0);assert.equal(f.requests.length,0);assert.equal(f.objects.size,0);
});

test('repeated cancellations back off longer and longer (capped at two minutes)',()=>{
  const starts:number[]=[];
  const f=fixture(()=>({advance(){starts.push(f.host.engine.world.tick);return {state:'cancelled'};},cancel(){}}),false);
  for(let n=20;n<=6000;n++)f.tick(n);
  assert.deepEqual(starts.slice(0,5),[20,120,320,720,1520]);
  assert.equal(starts[6]-starts[5],2400);f.handle.close();
});

test('search exceptions release pending state and retry after one second; a completed empty search is not repeated until the statics change',()=>{
  const cancelled:number[]=[];let epoch=1;
  const f=fixture(g=>({advance(){if(g===1)throw Error('fixture search failure');return {state:'done',candidates:[]};},cancel(){cancelled.push(g);}}),false);
  (f.host.engine as unknown as {staticEpochV1():number}).staticEpochV1=()=>epoch;
  f.tick(20);assert.deepEqual(cancelled,[1]);assert.match(f.logs[0],/search failed: fixture search failure/);
  for(let n=21;n<40;n++)f.tick(n);assert.equal(f.generations(),1);
  f.tick(40);assert.equal(f.generations(),2);
  for(let n=41;n<=5000;n++)f.tick(n);assert.equal(f.generations(),2,'L4: the negative result holds while the static epoch stands');
  epoch=2;for(let n=5001;n<5200;n++)f.tick(n);assert.equal(f.generations(),2,'the settled key is looked at every 200 ticks');f.tick(5200);assert.equal(f.generations(),3,'a static change searches again at the next look');f.handle.close();
});

// R2 gate (2026-10-31): the two baseline ids L4 renamed, kept for what of their contracts still holds under L4's cancel
// backoff and negative cache (the renamed tests above pin the new timings). A cancellation by engine replacement is still
// restarted on the next tick, even inside a cancel backoff; an empty completed search is still held at least a minute.
test('cancellation restarts on the next tick, engine replacement cancels old work, and close prevents publication',async()=>{
  const cancelled:number[]=[],advanced:number[]=[];
  const f=fixture(g=>({advance(){advanced.push(g);return g===1?{state:'cancelled'}:{state:'pending'};},cancel(){cancelled.push(g);}}),false);
  f.tick(20);f.tick(21);f.tick(22);assert.deepEqual(advanced,[1],'a self-cancelled search is in its L4 backoff');
  f.host.engine=f.engine();f.tick(23);
  assert.deepEqual(advanced,[1,2],'a replacement engine cancels the backoff and its search starts on the next tick');
  assert.deepEqual(cancelled,[],'the old search had already ended; nothing to cancel');
  f.tick(24);assert.deepEqual(advanced,[1,2,2]);
  f.host.engine=f.engine();f.tick(25);assert.deepEqual(cancelled,[2],'replacement cancels the old engine\'s pending work');assert.deepEqual(advanced,[1,2,2,3]);
  f.handle.close();f.tick(26);await settle();
  assert.deepEqual(cancelled,[2,3]);assert.equal(f.host.listeners.length,0);assert.equal(f.requests.length,0);assert.equal(f.objects.size,0);
});

test('search exceptions release pending state and retry after one second; completed empty search retains minute backoff',()=>{
  const cancelled:number[]=[];
  const f=fixture(g=>({advance(){if(g===1)throw Error('fixture search failure');return {state:'done',candidates:[]};},cancel(){cancelled.push(g);}}),false);
  f.tick(20);assert.deepEqual(cancelled,[1]);assert.match(f.logs[0],/search failed: fixture search failure/);
  for(let n=21;n<40;n++)f.tick(n);assert.equal(f.generations(),1,'held for one second after an exception');
  f.tick(40);assert.equal(f.generations(),2,'and retried at one second');
  for(let n=41;n<=40+20*60;n++)f.tick(n);assert.equal(f.generations(),2,'an empty completed search is not repeated within a minute');
  f.handle.close();
});

test('new ground source bypasses retry backoff, and live admission refusal creates no ride object',async()=>{
  const f=fixture(()=>({advance:()=>({state:'done',candidates:[spec]}),cancel(){}}),false);
  f.tick(20);f.requests[0].reject();await settle();
  assert.equal(f.objects.size,0);assert.match(f.logs[0],/rowing punt refused: live bank refused/);
  f.tick(40);assert.equal(f.generations(),1);
  f.host.engine.world.base.staticHash='changed';f.tick(60);
  assert.equal(f.generations(),2);assert.equal(f.requests.length,2);
  f.handle.close();f.requests[1].accept();await settle();assert.equal(f.objects.size,0,'closing prevents late presentation publication');
});

test('replacement during installation cannot install the remaining candidates into a different engine',async()=>{
  const second={...spec,id:'second-punt'};
  const f=fixture(()=>({advance:()=>({state:'done',candidates:[spec,second]}),cancel(){}}),false);
  f.tick(20);assert.equal(f.requests.length,1);
  f.host.engine=f.engine();f.requests[0].accept();await settle();
  assert.equal(f.requests.length,1);assert.equal(f.objects.size,0);f.handle.close();
});
