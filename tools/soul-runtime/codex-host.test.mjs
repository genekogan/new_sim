import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {EventEmitter} from 'node:events';
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
// Lifecycle tests use an in-memory protocol peer, never Codex or inference.
function protocol(t,options={},reply=()=>false){
 const requests=[],child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();let turn=0,ended=false;
 const deliver=message=>child.stdout.emit('data',Buffer.from(JSON.stringify(message)+'\n'));
 child.stdin.write=line=>{const message=JSON.parse(line);requests.push(message);if(message.id!==undefined)queueMicrotask(()=>{
  const respond=result=>deliver({id:message.id,result}),refuse=(code,messageText)=>deliver({id:message.id,error:{code,message:messageText}});
  if(reply(message,respond,refuse))return;
  if(message.method==='thread/start'||message.method==='thread/resume')respond({thread:{id:message.params.threadId??'owned-thread'}});
  else if(message.method==='turn/start')respond({turn:{id:'turn-'+(++turn),status:'inProgress'}});
  else respond({});
 });return true;};
 child.stdin.end=()=>{if(!ended){ended=true;queueMicrotask(()=>child.emit('exit',0,null));}};
 const host=new CodexHost({model:'synthetic-model',spawnProcess:()=>child,requestTimeoutMs:1000,...options});t.after(()=>host.close());
 return {host,requests,deliver};
}
async function until(predicate){for(let n=0;n<30;n++){if(predicate())return;await new Promise(setImmediate);}throw Error('Synthetic protocol condition not reached');}
test('durable start remains default and routine close never archives its thread',async t=>{
 const p=protocol(t);const connected=await p.host.connect();
 assert.equal(p.requests.find(r=>r.method==='thread/start').params.ephemeral,false);assert.equal(connected.ephemeral,false);assert.equal(connected.name,null);
 await p.host.close();assert.equal(p.requests.some(r=>r.method==='thread/archive'),false);
});
test('readable name is acknowledged before a first turn can start',async t=>{
 let finishName;const p=protocol(t,{name:' Sim · Eden · Reader '},(m,respond)=>{if(m.method==='thread/name/set'){finishName=()=>respond({});return true;}return false;});
 const connecting=p.host.connect();await until(()=>finishName);
 await assert.rejects(p.host.begin('synthetic'),{code:'HOST_NOT_CONNECTED'});assert.equal(p.requests.some(r=>r.method==='turn/start'),false);
 finishName();assert.equal((await connecting).name,'Sim · Eden · Reader');await p.host.begin('synthetic');
 const name=p.requests.find(r=>r.method==='thread/name/set');assert.deepEqual(name.params,{threadId:'owned-thread',name:'Sim · Eden · Reader'});
 assert.ok(p.requests.indexOf(name)<p.requests.findIndex(r=>r.method==='turn/start'));
});
test('ephemeral mode starts explicitly and cannot silently resume a retained thread',async t=>{
 const p=protocol(t,{ephemeral:true,name:'Sim probe',internalProbe:true});
 await assert.rejects(p.host.connect({threadId:'retained-durable-thread'}),{code:'HOST_EPHEMERAL_RESUME'});assert.equal(p.requests.length,0);
 const connected=await p.host.connect();assert.equal(connected.ephemeral,true);assert.equal(p.requests.find(r=>r.method==='thread/start').params.ephemeral,true);
 assert.deepEqual(await p.host.archiveCompleted(),{threadId:'owned-thread',archived:false,ephemeral:true});assert.equal(p.requests.some(r=>r.method==='thread/archive'),false);
});
test('ephemeral readable names stay local when installed host rejects metadata updates',async t=>{
 const p=protocol(t,{ephemeral:true,name:'Sim ephemeral probe'},(m,_respond,refuse)=>{if(m.method==='thread/name/set'){refuse(-32600,'ephemeral thread does not support metadata updates');return true;}return false;});
 const connected=await p.host.connect();assert.equal(connected.ephemeral,true);assert.equal(connected.name,'Sim ephemeral probe');assert.equal(p.host.name,'Sim ephemeral probe');
 assert.equal(p.requests.some(r=>r.method==='thread/name/set'||r.method==='thread/resume'),false);assert.equal(p.requests.filter(r=>r.method==='thread/start').length,1);
 await p.host.begin('synthetic');assert.equal(p.requests.filter(r=>r.method==='turn/start').length,1);
});
test('explicit durable override resumes the exact ID and names it without automatic archival',async t=>{
 const p=protocol(t,{ephemeral:true});await p.host.connect({threadId:'retained-thread',ephemeral:false,name:'Sim resumed Reader'});
 const resume=p.requests.find(r=>r.method==='thread/resume');assert.equal(resume.params.threadId,'retained-thread');assert.equal('ephemeral' in resume.params,false);
 assert.equal(p.requests.find(r=>r.method==='thread/name/set').params.threadId,'retained-thread');assert.equal(p.requests.some(r=>r.method==='thread/start'||r.method==='thread/archive'),false);
});
test('archive requires explicit internal probe ownership and cannot target another thread',async t=>{
 const normal=protocol(t);await normal.host.connect({threadId:'normal-user-thread'});
 await assert.rejects(normal.host.archiveCompleted(),{code:'HOST_ARCHIVE_NOT_OWNED'});assert.equal(normal.requests.some(r=>r.method==='thread/archive'),false);
 const owned=protocol(t,{internalProbe:true});await owned.host.connect();
 await assert.rejects(owned.host.archiveCompleted({expectedThreadId:'another-thread'}),{code:'HOST_THREAD_MISMATCH'});assert.equal(owned.requests.some(r=>r.method==='thread/archive'),false);
});
test('archive rejects starting and active turns, then archives only after explicit idle invocation',async t=>{
 let finishStart;const p=protocol(t,{internalProbe:true},(m,respond)=>{if(m.method==='turn/start'){finishStart=()=>respond({turn:{id:'active-turn'}});return true;}return false;});await p.host.connect();
 const starting=p.host.begin('synthetic');await until(()=>finishStart);
 await assert.rejects(p.host.archiveCompleted(),{code:'HOST_BUSY'});finishStart();const turn=await starting;
 await assert.rejects(p.host.archiveCompleted(),{code:'HOST_BUSY'});assert.equal(p.requests.some(r=>r.method==='thread/archive'),false);
 p.deliver({method:'turn/completed',params:{threadId:'owned-thread',turn:{id:'active-turn',status:'completed'}}});await turn.completed;
 assert.equal(p.requests.some(r=>r.method==='thread/archive'),false,'turn completion is not run completion or permission to archive');
 assert.deepEqual(await p.host.archiveCompleted({expectedThreadId:'owned-thread'}),{threadId:'owned-thread',archived:true});
 await assert.rejects(p.host.begin('do not reactivate'),{code:'HOST_ARCHIVED'});assert.equal((await p.host.archiveCompleted()).alreadyArchived,true);
 assert.equal(p.requests.filter(r=>r.method==='thread/archive').length,1);await p.host.close();assert.equal(p.requests.filter(r=>r.method==='thread/archive').length,1);
});
test('archive acknowledgement serializes against new turns and coalesces concurrent explicit requests',async t=>{
 let finishArchive;const p=protocol(t,{internalProbe:true},(m,respond)=>{if(m.method==='thread/archive'){finishArchive=()=>respond({});return true;}return false;});await p.host.connect();
 const first=p.host.archiveCompleted();await until(()=>finishArchive);
 await assert.rejects(p.host.begin('race'),{code:'HOST_ARCHIVED'});const second=p.host.archiveCompleted();assert.equal(p.host.archived,false);
 finishArchive();assert.deepEqual(await first,{threadId:'owned-thread',archived:true});assert.deepEqual(await second,await first);assert.equal(p.requests.filter(r=>r.method==='thread/archive').length,1);
});
test('failed naming or archival never reports lifecycle success or silently starts a turn',async t=>{
 const naming=protocol(t,{name:'Sim refused'},(m,_respond,refuse)=>{if(m.method==='thread/name/set'){refuse(-32600,'name refused');return true;}return false;});
 await assert.rejects(naming.host.connect(),/name refused/);await assert.rejects(naming.host.begin('synthetic'),{code:'HOST_NOT_CONNECTED'});assert.equal(naming.requests.some(r=>r.method==='turn/start'),false);
 const archive=protocol(t,{internalProbe:true},(m,_respond,refuse)=>{if(m.method==='thread/archive'){refuse(-32600,'archive refused');return true;}return false;});await archive.host.connect();
 await assert.rejects(archive.host.archiveCompleted(),/archive refused/);assert.equal(archive.host.archived,false);assert.equal(archive.host.archiving,null);assert.equal(archive.requests.filter(r=>r.method==='thread/archive').length,1);
});
test('invalid lifecycle options fail before a subprocess could be spawned',()=>{
 let spawned=0;const spawnProcess=()=>{spawned++;throw Error('must not spawn');};
 for(const options of [{ephemeral:'true'},{internalProbe:'yes'},{name:'\nsecret'},{name:'   '}])assert.throws(()=>new CodexHost({spawnProcess,...options}),e=>['HOST_INVALID_NAME','HOST_INVALID_OPTION'].includes(e.code));
 assert.equal(spawned,0);
});
