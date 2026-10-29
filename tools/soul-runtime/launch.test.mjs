import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {superviseProcess} from './launch.mjs';
function fakeSpawner(outcomes){let count=0,kills=[];return {spawnProcess:()=>{const c=new EventEmitter();c.pid=++count;c.kill=s=>{kills.push(s);queueMicrotask(()=>c.emit('exit',null,s));};const outcome=outcomes[count-1];if(outcome)setImmediate(()=>c.emit('exit',...outcome));return c;},count:()=>count,kills};}
test('outer process owner restarts killed controller but never replays explicit failure',async()=>{
 const f=fakeSpawner([[null,'SIGKILL'],[0,null]]),states=[];await superviseProcess({...f,onState:s=>states.push(s)});assert.equal(f.count(),2);assert.equal(states[1].state,'controller-restarting');
 const bad=fakeSpawner([[1,null]]);await assert.rejects(superviseProcess(bad),{code:'CONTROLLER_FAILED'});assert.equal(bad.count(),1);
});
test('stop terminates owned controller and never launches a replacement',async()=>{
 const f=fakeSpawner([]),stop=new AbortController();const p=superviseProcess({...f,signal:stop.signal});stop.abort();await p;assert.deepEqual(f.kills,['SIGTERM']);assert.equal(f.count(),1);
});
