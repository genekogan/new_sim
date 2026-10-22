import test from 'node:test';import assert from 'node:assert/strict';
import {APPROVAL_COPY,answerApprovalTabs,approvalChannelName,approvalTitle,askOpenTab} from './approval-link.ts';
const id='ap_'+'c'.repeat(32);

test('card title is the Soul name from the request, never its ID; copy is Gene\'s line',()=>{
 assert.equal(APPROVAL_COPY,'If you approve, the connecting agent will be able to control this Soul.');
 assert.equal(approvalTitle({name:'Longrun Ada',soulId:'s_a1'}),'Longrun Ada');
 assert.equal(approvalTitle({name:'s_a12cf7e1e6',soulId:'s_a12cf7e1e6'}),'Your Soul');
 assert.equal(approvalTitle({name:'s_other',soulId:null}),'Your Soul');
 assert.equal(approvalTitle({name:'  ',soulId:null}),'Your Soul');
 assert.equal(approvalTitle(null),null);
});

test('an #approve link with no open tab of the world gets no answer (the tab boots the world as before)',async()=>{
 assert.equal(await askOpenTab(approvalChannelName('w-none-'+Date.now()),id,{probeMs:60}),false);
 assert.equal(await askOpenTab('x',id,{Channel:undefined,probeMs:10}).then(v=>typeof v),'boolean');
});

test('the open tab most recently in front opens the card; other worlds and other tabs do not',async()=>{
 const name=approvalChannelName('w-'+Date.now()),opened:string[]=[];
 const stops=[answerApprovalTabs(name,i=>opened.push('old:'+i),()=>100),answerApprovalTabs(name,i=>opened.push('front:'+i),()=>200),
  answerApprovalTabs(approvalChannelName('another'),i=>opened.push('other-world:'+i),()=>999)];
 try{assert.equal(await askOpenTab(name,id,{probeMs:80}),true);assert.deepEqual(opened,['front:'+id]);}
 finally{stops.forEach(s=>s());}
});

test('a tab that never confirms leaves the asking tab to boot (no silent loss of the link)',async()=>{
 const name=approvalChannelName('mute-'+Date.now());
 const ch=new BroadcastChannel(name);ch.onmessage=e=>{const m=e.data;if(m.t==='probe')ch.postMessage({t:'here',ask:m.ask,tab:'t1',seen:1});};
 try{assert.equal(await askOpenTab(name,id,{probeMs:60,openMs:80}),false);}finally{ch.close();}
});
