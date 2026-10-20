import test from 'node:test';import assert from 'node:assert/strict';import {judge as judgeAll,GOD_CHECKS,APPROVE_SCENARIOS,WINDOW_CHECKS} from './v7-receipt.mjs';
const approve={scenarios:APPROVE_SCENARIOS.map(name=>({name,ok:true,firstAt:300,lapses:0,end:{onTop:true,status:'pending'}}))};
const win={steps:WINDOW_CHECKS.map(id=>({name:`${id} a check`,ok:true}))};
const judge=(a)=>judgeAll({approve,window:win,...a});
const run=(w,dpr,over={})=>({world:w,dpr,geometry:{canvasCss:[1352,780],buffer:[1352*dpr,780*dpr]},ui:{simEntity:true,revealed:'true',arrival:false},errors:[],input:{drag:true,wheel:true,wasd:false,doubleClick:false},...over});
const old=[1,2].flatMap(d=>['eden','mars','littlemartians'].map(w=>run(w,d)));
const fresh={runs:[1,2].map(d=>({dpr:d,created:'http://x/worlds/w/a',geometry:{canvasCss:[1352,780]},errors:[],input:{drag:true,wheel:true},joinLine:'ok'}))};
const god={steps:GOD_CHECKS.map(id=>({name:`${id} a check`,ok:true}))};
test('passes a healthy walk',()=>assert.equal(judge({old,fresh,god}).status,'pass'));
test('the God modal e2e: a failed or missing check, or its exit code, fails V7',()=>{
  assert.equal(judge({old,fresh}).status,'fail');
  assert.equal(judge({old,fresh,god:{steps:god.steps.slice(1)}}).status,'fail');
  assert.equal(judge({old,fresh,god:{steps:god.steps.map((x,i)=>i===5?{...x,ok:false}:x)}}).status,'fail');
  assert.equal(judge({old,fresh,god,rcGod:1}).status,'fail');
});
test('fails on page error, missing run, bad dpr, dead input',()=>{
  assert.equal(judge({god,old:[...old.slice(1)],fresh}).status,'fail');
  assert.equal(judge({god,old:old.map((r,i)=>i?r:{...r,errors:['boom']}),fresh}).status,'fail');
  assert.equal(judge({god,old:old.map(r=>({...r,geometry:{canvasCss:[1352,780],buffer:[1352,780]}})),fresh}).status,'fail');
  assert.equal(judge({god,old:old.map(r=>({...r,input:{}})),fresh}).status,'fail');
  assert.equal(judge({old,fresh,god,rcNew:1}).status,'fail');
});
test('lane HF: the approval-link walk must be there and pass, every scenario',()=>{
  assert.equal(judge({old,fresh,god}).status,'pass');
  assert.equal(judge({old,fresh,god,approve:null}).status,'fail');
  assert.equal(judge({old,fresh,god,approve:{scenarios:approve.scenarios.slice(1)}}).status,'fail');
  assert.equal(judge({old,fresh,god,approve:{scenarios:approve.scenarios.map((x,i)=>i===0?{...x,ok:false,lapses:33}:x)}}).status,'fail');
  assert.equal(judge({old,fresh,god,rcApprove:1}).status,'fail');
});
test('lane PUX: the in-window walk must be there and pass, every check',()=>{
  assert.equal(judge({old,fresh,god}).status,'pass');
  assert.equal(judge({old,fresh,god,window:null}).status,'fail');
  assert.equal(judge({old,fresh,god,window:{steps:win.steps.slice(1)}}).status,'fail');
  assert.equal(judge({old,fresh,god,window:{steps:win.steps.map((x,i)=>i===3?{...x,ok:false}:x)}}).status,'fail');
  assert.equal(judge({old,fresh,god,rcWindow:1}).status,'fail');
});
