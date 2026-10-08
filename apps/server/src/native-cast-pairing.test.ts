import test from 'node:test';import assert from 'node:assert/strict';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';import {Souls} from './souls.ts';
test('native cast pairing readiness fences issuance and exchange without changing default pairing',async t=>{
 const f=fixture(':memory:');t.after(()=>{f.host.stop();f.db.close();});f.brain.quiesce();await invite(f,'owner');
 const row=await accept(f.host,f.souls.create('dev:owner',{name:'Cast',description:'local custody fixture'}));
 let ready=false;const guarded=new Souls(f.host,f.db,f.brain,f.brain.cfg,{controlReady:()=>ready});
 assert.equal(f.souls.controlReady(row),true);assert.equal(guarded.controlReady(row),false);
 assert.throws(()=>guarded.pairCode(row,'http://127.0.0.1:4958'),(e:any)=>e.status===409);
 ready=true;const issued=guarded.pairCode(row,'http://127.0.0.1:4958');ready=false;
 assert.throws(()=>guarded.pairExchange(issued.code,'scripted-fixture'),(e:any)=>e.code==='pair-invalid');assert.equal(f.db.soul(row.id)!.token_hash,null);
 ready=true;const next=guarded.pairCode(row,'http://127.0.0.1:4958'),credential=guarded.pairExchange(next.code,'scripted-fixture');assert.ok(credential.token);assert.ok(f.db.soul(row.id)!.token_hash);
});
