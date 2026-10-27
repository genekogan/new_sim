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
test('declared place aliases beat object tags and preserve distant place admission',()=>{
 const places=[p('library-1','Village Library',['library'])],book=c('book','e_book',['library']);
 const offered=resolveCapability('go to the library',context(places,[c('library-1','g-library-1',['library']),book]));assert.notEqual(offered.kind,'unknown',JSON.stringify(offered));if(offered.kind!=='unknown')assert.equal(offered.cap.id,'walk:library-1');
 const far=resolveCapability('go to the library',context(places,[book]));assert.equal(far.kind,'unknown',JSON.stringify(far));if(far.kind==='unknown'){assert.equal(far.code,'place.unreachable');assert.equal(far.place,'g-library-1');}
});

test('unnamed object kinds may use nearest while colliding proper names remain choices',()=>{
 const caps=[c('east-stair','e_east'),c('west-stair','e_west')].map((c,i)=>({...c,label:`Walk to ${i?'west':'east'} stair, a mars-tool-library-stair, by lawn (30 m)`,aliases:['Spiral']}));
 const ctx=context([],caps);ctx.target=cap=>({names:[],around:[],at:cap.id==='walk:east-stair'?[10,0]:[30,0]});
 for(const input of ['go to the library stair','walk to the stairs']){const r=resolveCapability(input,ctx);assert.notEqual(r.kind,'unknown',JSON.stringify(r));if(r.kind!=='unknown')assert.equal(r.cap.id,'walk:east-stair');}
 const named=resolveCapability('walk to Spiral',ctx);assert.equal(named.kind,'unknown');if(named.kind==='unknown')assert.equal(named.code,'place.ambiguous');
});
test('a specifically named child place beats its enclosing place description',()=>{
 const field={...p('commons','Commons Field'),description:'A field with the pavilion on the commons'},pavilion={...p('commons-pavilion','Commons Pavilion'),parent:'g-commons'};
 const caps=[{...c('commons','g-commons'),label:'Walk to Commons Field, the pavilion on the commons is here'},c('commons-pavilion','g-commons-pavilion')];
 const r=resolveCapability('walk to the pavilion on the commons',context([field,pavilion],caps));assert.notEqual(r.kind,'unknown',JSON.stringify(r));if(r.kind!=='unknown')assert.equal(r.cap.id,'walk:commons-pavilion');
});

test('unnamed spot activities use nearest offered instance and preserve blocked group reasons',()=>{
 const make=(verb:string,id:string,available=true):EdgeCapability=>({id:verb+':'+id,verb,label:verb+' at '+id,available,target:{id,kind:'spot'},...(!available?{blocked:{code:'activity.no-partner',reason:'Nobody is at the story circle.'}}:{})});
 for(const [verb,input] of [['feed','feed the koi'],['hear-story','join the story circle'],['yoga-class','join the yoga class']]){
  const caps=[make(verb,'east',false),make(verb,'west',false)],ctx=context([],caps);ctx.target=c=>({names:[],around:[],at:c.target?.id==='east'?[10,0]:[30,0]});
  const r=resolveCapability(input,ctx);assert.notEqual(r.kind,'unknown',JSON.stringify(r));if(r.kind!=='unknown'){assert.equal(r.cap.id,verb+':east');assert.equal(r.cap.available,false);assert.equal(r.cap.blocked?.reason,'Nobody is at the story circle.');}
  const named=resolveCapability(verb+' at an unknown club',ctx);assert.equal(named.kind,'unknown','explicit place constraint is not discarded');
 }
});

test('authored names beat generic definition aliases, which remain usable as unnamed kinds',()=>{
 const pier={...p('west-pier','West Pier',['pier']),genericAliases:['pier']},boardwalk={...p('boardwalk','Boardwalk',['pier']),genericAliases:['pier']};
 const ctx=context([pier,boardwalk],[c('west-pier',pier.id,['pier']),c('boardwalk',boardwalk.id,['pier'])]);ctx.target=cap=>({names:ctx.places.filter(p=>p.id===cap.target?.id).flatMap(p=>[p.name,...p.aliases??[]]),around:[],at:cap.target?.id===pier.id?[50,0]:[5,0]});
 const own=resolveCapability('walk to the pier',ctx);assert.notEqual(own.kind,'unknown',JSON.stringify(own));if(own.kind!=='unknown')assert.equal(own.cap.id,'walk:west-pier','proper name words beat a nearer generic tag');
 const cabins=[{...p('east-home','East Home',['cottage']),genericAliases:['cottage']},{...p('west-home','West Home',['cottage']),genericAliases:['cottage']}];const generic=context(cabins,cabins.map(p=>c(p.ref!,p.id,['cottage'])));generic.target=cap=>({names:['cottage'],around:[],at:cap.target?.id===cabins[0].id?[10,0]:[30,0]});
 const nearest=resolveCapability('walk to a cottage',generic);assert.notEqual(nearest.kind,'unknown');if(nearest.kind!=='unknown')assert.equal(nearest.cap.id,'walk:east-home');
 const named=context(cabins.map(p=>({...p,aliases:[...p.aliases!,'Retreat']})),generic.caps.map(c=>({...c,aliases:[...c.aliases!,'Retreat']})));assert.equal(resolveCapability('walk to Retreat',named).kind,'unknown');
});
