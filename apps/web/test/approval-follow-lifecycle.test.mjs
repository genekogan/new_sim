import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {build} from 'esbuild';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const temp=mkdtempSync(resolve('.approval-follow-fixture-'));
const file=join(temp,'hook.mjs');
const built=await build({entryPoints:[resolve('apps/web/src/useApprovalFollow.ts')],bundle:true,write:false,platform:'node',format:'esm',packages:'external'});
writeFileSync(file,built.outputFiles[0].text);
const {useApprovalFollow}=await import(pathToFileURL(file));
process.once('exit',()=>rmSync(temp,{recursive:true,force:true}));

test('actual approval hook waits for depicted body, confirms Follow, and releases retries before manual navigation',()=>{
  const internals=React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const oldDispatcher=internals.H,oldInterval=globalThis.setInterval,oldClear=globalThis.clearInterval;
  let effect,cleanup,timer,body=false,complete=0;
  const completions=[],calls=[],pending={soulId:'s_new',scope:'eden/account-a'};
  const handle={canFollowSoul:id=>id==='s_new'&&body,selectSoul:id=>{calls.push(['select',id]);return true;},setCameraMode:mode=>calls.push(['mode',mode])};
  const render=(state,scope=pending.scope,authed=true)=>{
    internals.H={useEffect:create=>{effect=create;}};
    useApprovalFollow(pending,scope,authed,handle,state,followed=>{complete++;completions.push(followed);});
    cleanup?.();cleanup=effect();
  };
  globalThis.setInterval=fn=>{timer=fn;return 1;};globalThis.clearInterval=()=>{timer=null;};
  try{
    // Roster selection already succeeds, but the delayed recording lacks its body.
    render({presentation:'live',cameraMode:'manual',selection:{soulId:'s_new'}});
    timer();assert.deepEqual(calls,[]);assert.equal(complete,0);
    body=true;timer();assert.deepEqual(calls,[['select','s_new'],['mode','follow']]);
    assert.equal(complete,0,'an issued command is not observed camera success');
    render({presentation:'live',cameraMode:'follow',selection:{soulId:'s_other'}});
    assert.equal(complete,0,'a different followed Soul cannot consume arrival');
    render({presentation:'live',cameraMode:'follow',selection:{soulId:'s_new'}});
    assert.equal(complete,1);assert.equal(timer,null,'confirmed arrival leaves no timer fighting later WASD');
    calls.length=0;
    render({presentation:'live',cameraMode:'manual',selection:{soulId:'s_new'}},'mars/account-a');
    assert.equal(complete,2);assert.deepEqual(calls,[]);assert.equal(timer,null);
    render(null,pending.scope,false);assert.equal(complete,3);assert.deepEqual(calls,[]);assert.deepEqual(completions,[true,false,false]);
    render({presentation:'live',cameraMode:'manual',inputOwned:true,selection:{soulId:'s_new'}});
    assert.deepEqual(calls,[],'arrival must not release a human’s active manual input');assert.equal(timer,null);assert.deepEqual(completions,[true,false,false]);
    render({presentation:'live',cameraMode:'manual',inputOwned:false,selection:{soulId:'s_new'}});
    assert.deepEqual(calls,[['select','s_new'],['mode','follow']],'pending arrival retries after manual input is released');
  }finally{cleanup?.();internals.H=oldDispatcher;globalThis.setInterval=oldInterval;globalThis.clearInterval=oldClear;}
});
