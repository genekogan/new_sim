import test from 'node:test';import assert from 'node:assert/strict';import {judge} from './v7-receipt.mjs';
const run=(w,dpr,over={})=>({world:w,dpr,geometry:{canvasCss:[1352,780],buffer:[1352*dpr,780*dpr]},ui:{simEntity:true,revealed:'true',arrival:false},errors:[],input:{drag:true,wheel:true,wasd:false,doubleClick:false},...over});
const old=[1,2].flatMap(d=>['eden','mars','littlemartians'].map(w=>run(w,d)));
const fresh={runs:[1,2].map(d=>({dpr:d,created:'http://x/worlds/w/a',geometry:{canvasCss:[1352,780]},errors:[],input:{drag:true,wheel:true},joinLine:'ok'}))};
test('passes a healthy walk',()=>assert.equal(judge({old,fresh}).status,'pass'));
test('fails on page error, missing run, bad dpr, dead input',()=>{
  assert.equal(judge({old:[...old.slice(1)],fresh}).status,'fail');
  assert.equal(judge({old:old.map((r,i)=>i?r:{...r,errors:['boom']}),fresh}).status,'fail');
  assert.equal(judge({old:old.map(r=>({...r,geometry:{canvasCss:[1352,780],buffer:[1352,780]}})),fresh}).status,'fail');
  assert.equal(judge({old:old.map(r=>({...r,input:{}})),fresh}).status,'fail');
  assert.equal(judge({old,fresh,rcNew:1}).status,'fail');
  assert.equal(judge({old,fresh,rcLauncher:1}).status,'fail'); assert.equal(judge({old,fresh,rcLauncher:NaN}).status,'fail');
});
