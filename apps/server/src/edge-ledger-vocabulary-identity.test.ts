import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveCapability,type VocabContext,type VocabPlace} from './edge/ledger/vocabulary.ts';
import type {EdgeCapability} from './edge/contract.ts';
const p=(id:string,name:string,aliases:string[]=[]):VocabPlace=>({id:'g-'+id,ref:id,name,aliases,kind:'building',center:[20,20]});
const c=(id:string,target:string,aliases:string[]=[],available=true):EdgeCapability=>({id:'walk:'+id,verb:'walk',label:'Walk to '+id,aliases,available,target:{id:target,kind:target.startsWith('g-')?'place':'object'}});
const context=(places:VocabPlace[],caps:EdgeCapability[]):VocabContext=>({places,caps,root:[],me:[0,0],target:cap=>({names:places.filter(p=>p.id===cap.target?.id).flatMap(p=>[p.name,...p.aliases??[]]),around:[],at:[20,20]})});
test('natural exact target refs and place titles outrank inherited part and generic tag aliases',()=>{
 const places=[p('mimos','Mimos Lounge'),p('kitchen','Campus Kitchen'),p('showers','Campus Showers',['mimos'])];
 const caps=[c('mimos','g-mimos'),c('kitchen','g-kitchen'),c('showers','g-showers',['mimos']),c('mimos/part-lounge','e_mimos',['mimos','Mimos Lounge']),c('kitchen/part-dining','e_kitchen',['kitchen','Campus Kitchen']),c('cup','e_cup',['kitchen'])];
 for(const [input,want]of [['walk to Mimos','walk:mimos'],['walk to the kitchen','walk:kitchen'],['go to Mimos Lounge','walk:mimos'],['walk to Campus Kitchen','walk:kitchen'],['walk:cup','walk:cup']]){
  const r=resolveCapability(input,context(places,caps));assert.notEqual(r.kind,'unknown',JSON.stringify({input,r}));if(r.kind!=='unknown')assert.equal(r.cap.id,want);
 }
 const unavailable=resolveCapability('walk to Mimos',context(places,caps.map(x=>x.id==='walk:mimos'?{...x,available:false}:x)));assert.notEqual(unavailable.kind,'unknown');if(unavailable.kind!=='unknown')assert.equal(unavailable.cap.available,false,'exact blocked identity cannot become an available alias elsewhere');
});
test('equally named places remain ambiguous; generic aliases still work when no exact identity exists',()=>{
 const places=[p('hall-east','Reading Hall'),p('hall-west','Reading Hall')],caps=[c('hall-east','g-hall-east',['Reading Hall']),c('hall-west','g-hall-west',['Reading Hall'])];
 const r=resolveCapability('walk to Reading Hall',context(places,caps));assert.equal(r.kind,'unknown');if(r.kind==='unknown')assert.equal(r.code,'place.ambiguous');
 const a=resolveCapability('walk to canteen',context([p('hall-east','Dining Hall',['canteen'])],[c('hall-east','g-hall-east',['canteen'])]));assert.notEqual(a.kind,'unknown');if(a.kind!=='unknown')assert.equal(a.cap.id,'walk:hall-east');
});
