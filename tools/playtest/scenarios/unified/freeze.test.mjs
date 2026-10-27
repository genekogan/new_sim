import test from 'node:test';import assert from 'node:assert/strict';import{comparePhysicalPoses}from'./freeze.mjs';
const s=(id,extra={})=>({entities:[{id,name:'hall',def:'hall@1',p:[1,.373,2],...extra}]});
test('pose parity ignores generated ids/meaning but catches support, parent, params and missing entities',()=>{
 assert.equal(comparePhysicalPoses(s('a'),s('b',{about:{title:'Village Hall'}})).same,true);
 for(const extra of [{p:[1,0,2]},{params:{w:3}},{in:{parent:'other'}}])assert.equal(comparePhysicalPoses(s('a'),s('b',extra)).same,false);
 assert.equal(comparePhysicalPoses(s('a'),{entities:[]}).same,false);
 assert.equal(comparePhysicalPoses(s('a'),{entities:[...s('b').entities,{id:'c',name:'new',p:[0,0,0]}]}).same,false);
});
test('pose parity resolves parent ids to stable paths and excludes temporary Soul bodies',()=>{
 const a={entities:[...s('a').entities,{id:'chairA',name:'chair',in:{parent:'a'},p:[1,2,3]}]};
 const b={entities:[...s('b').entities,{id:'chairB',name:'chair',in:{parent:'b'},p:[1,2,3]},{id:'h_probe',name:'probe',p:[0,0,0]}]};
 assert.equal(comparePhysicalPoses(a,b).same,true);
});
