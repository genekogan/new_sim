import test from 'node:test';import assert from 'node:assert/strict';import {judge,GOD_CHECKS} from './v7-receipt.mjs';
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
