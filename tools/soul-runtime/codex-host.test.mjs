import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {CodexHost} from './codex-host.mjs';
async function fixture(t,options={}){
 const host=new CodexHost({command:process.execPath,args:[fileURLToPath(new URL('./fixtures/fake-codex.mjs',import.meta.url))],requestTimeoutMs:1000,...options});
 t.after(()=>host.close());await host.connect();return host;
}
test('completion before request acknowledgement does not leave a phantom active turn',async t=>{
 const host=await fixture(t);const first=await host.begin('complete-before-ack');assert.equal((await first.completed).text,'finished');assert.equal(host.activeTurnId,null);
 const next=await host.begin('wait');assert.equal(host.activeTurnId,next.turnId);await assert.rejects(host.begin('overlap'),{code:'HOST_BUSY'});
 assert.equal((await host.interrupt()).status,'interrupted');assert.equal((await next.completed).status,'interrupted');
});
test('steer binds exact turn and does not retry a rejected stale turn',async t=>{
 const host=await fixture(t);const turn=await host.begin('wait');await assert.rejects(host.steer('alert','old-turn'),/mismatch/);
 assert.equal((await host.steer('alert',turn.turnId)).turnId,turn.turnId);await host.interrupt();await assert.rejects(host.steer('too late'),{code:'HOST_IDLE'});
});
test('host death rejects pending begin instead of silently starting another session',async t=>{
 const host=await fixture(t);await assert.rejects(host.begin('exit'),{code:'HOST_EXITED'});assert.equal(host.closed,true);
});
test('ambiguous request timeout invalidates connection and never replays start',async t=>{
 const host=await fixture(t,{requestTimeoutMs:150});await assert.rejects(host.begin('timeout'),{code:'HOST_REQUEST_TIMEOUT'});assert.equal(host.closed,true);await assert.rejects(host.request('turn/start',{}),{code:'HOST_REQUEST_TIMEOUT'});
});
test('missing executable fails connection and cleanup terminates without waiting for an exit event',async()=>{
 const host=new CodexHost({command:'/nonexistent-sim-codex-executable',requestTimeoutMs:200});
 await assert.rejects(host.connect(),{code:'HOST_START_FAILED'});
 const status=await host.close();assert.equal(status.startFailed,true);
});
