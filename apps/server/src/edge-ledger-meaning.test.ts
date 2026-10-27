import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveCapability,placeMatchTier,type VocabContext,type VocabPlace} from './edge/ledger/vocabulary.ts';
import type {EdgeCapability} from './edge/contract.ts';
const cap=(verb:string,id:string,label=id):EdgeCapability=>({id:verb+':'+id,verb,label,target:{id,kind:'place'},available:true});
const context=(places:VocabPlace[],caps:EdgeCapability[]):VocabContext=>({places,caps,me:[0,0],yaw:0,root:[],target:c=>{const p=places.find(p=>p.id===c.target?.id);return{names:p?[p.name,p.kind??'',...(p.aliases??[])]:[],around:[],at:p?.center??null};}});
const chosen=(text:string,ctx:VocabContext)=>{const r=resolveCapability(text,ctx);assert.notEqual(r.kind,'unknown',JSON.stringify(r));return r.kind!=='unknown'?r.cap.id:'';};
test('generic swim chooses bank/edge rather than a misleading centroid; unknown location stays unknown',()=>{
 const ps:VocabPlace[]=[{id:'long-lake',name:'Long Lake',kind:'water',center:[100,0],polygon:[[2,-10],[200,-10],[200,10],[2,10]]},{id:'pond',name:'Pond',kind:'water',center:[20,0],polygon:[[18,-2],[22,-2],[22,2],[18,2]]},{id:'bank',name:'Long Lake bank',kind:'shore',parent:'long-lake',center:[0,0]}];
 const c=context(ps,[cap('swim','long-lake'),cap('swim','pond')]);assert.equal(chosen('go for a swim',c),'swim:long-lake');
 assert.equal(chosen('swim',{...c,me:[19,0],here:['bank']}),'swim:long-lake');assert.equal(chosen('swim',{...c,here:['pond']}),'swim:pond');
 const unknown=resolveCapability('swim',{...c,me:null});assert.equal(unknown.kind,'unknown');if(unknown.kind==='unknown')assert.equal(unknown.code,'place.position-unknown');
 const named=resolveCapability('swim in West Lake',{...c,caps:[cap('swim','pond')]});assert.equal(named.kind,'unknown','one available water never replaces an absent named water');
});
test('heading filters building eligibility before nearest ranking; missing heading is explicit',()=>{
 const ps:VocabPlace[]=[{id:'ahead',name:'Front House',kind:'building',center:[3,0]},{id:'behind',name:'Rear Hall',kind:'building',center:[-20,0]},{id:'tree',name:'Tree',kind:'landmark',center:[-1,0]}];
 const c=context(ps,ps.map(p=>cap('walk',p.id)));assert.equal(chosen('enter the nearest building behind you',c),'walk:behind');
 assert.equal(resolveCapability('enter nearest building behind you',{...c,yaw:undefined}).kind,'unknown');
 assert.equal(resolveCapability('enter nearest building behind you',{...c,caps:[cap('walk','ahead')]}).kind,'unknown');
});
test('aliases are first-class names and ambiguous aliases yield candidates',()=>{
 const ps:VocabPlace[]=[{id:'chiba',name:'Chiba',kind:'building',aliases:['auditorium','hall'],center:[20,0]},{id:'dojo',name:'Dojo',kind:'building',aliases:['hall'],center:[5,0]}];
 const c=context(ps,ps.map(p=>cap('walk',p.id)));assert.equal(chosen('go to the auditorium',c),'walk:chiba');assert.equal(placeMatchTier(['auditorium'],ps).tier,0);
 const r=resolveCapability('go to the hall',c);assert.equal(r.kind,'unknown');if(r.kind==='unknown'){assert.equal(r.code,'place.ambiguous');assert.equal(r.didYouMean.length,2);}
});
test('ordinary sit chooses a nearby fixture; named desk never silently becomes a ground pose',()=>{
 const seat=cap('sit','seat','Podium seat'), ground:EdgeCapability={id:'sit:here',verb:'sit',label:'Sit on ground',available:true};
 const c=context([{id:'seat',name:'Podium seat',center:[2,0]}],[ground,seat]);assert.equal(chosen('sit down',c),'sit:seat');
 assert.equal(resolveCapability('sit at the missing desk',{...c,caps:[ground]}).kind,'unknown');
});


test('relational where names the actual bank and stays silent without position',async()=>{
 const {whereLine}=await import('./edge/perception/semantic-location.ts');
 const water={id:'lake',name:'West Lake',kind:'water',parent:'world',polygon:[[0,0],[20,0],[20,20],[0,20]],level:0,enclosed:false,capacity:null,starting:false} as const;
 const bank={...water,id:'bank',name:'West Lake bank',kind:'shore',semanticParent:'lake'};
 assert.equal(whereLine([water,bank] as never,['bank'],[-1,10]),'On the bank of West Lake');assert.equal(whereLine([water,bank] as never,['lake','bank'],[2,10]),'In West Lake');assert.equal(whereLine([water,bank] as never,['bank'],null),undefined);
});
