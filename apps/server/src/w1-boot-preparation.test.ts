import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import type {Place} from './edge/ledger/places.ts';
import {buildBootStatic,assembleBootSession,type BootStaticInput} from './edge/boot/boot-pack.ts';
import {resolveBootPlace} from './edge/boot/place-resolution.ts';
import type {DestinationCapability as Capability} from './edge/boot/place-resolution.ts';
const fixtures=JSON.parse(readFileSync(new URL('../test/fixtures/w1-boot/worlds.json',import.meta.url),'utf8'));
const eden=JSON.parse(readFileSync(new URL('../../../worlds/eden/places.v1.json',import.meta.url),'utf8')).places as Place[];
const rules={earshotMetres:12,perceptionMetres:30,secondsCaps:{walk:600}},verbs=[{id:'walk',summary:'Follow an admitted native destination; route checked at act time.'}];
const edenAliases={'region-harbour.beach':['the beach','beach'],'region-old-town.market-street':['old town market'],'eden-amphitheatre':['amphitheatre'],'eden-north-woods':['woods','northern woodland']};
const allInputs=(places:Place[],worldId:string):BootStaticInput=>({worldId,places,nativePlaces:places.filter(p=>p.parent!==null&&!p.carrier&&p.level===0&&p.kind!=='sleeping-mat').slice(0,38).map(p=>({id:p.id,level:p.level,polygon:p.polygon})),rules,verbs});
const nativeFor=(id:string)=>{const p=eden.find(p=>p.id===id)!;return {id:p.id,level:p.level,polygon:p.polygon};};
const fieldInput:BootStaticInput={worldId:'eden-fixture',places:eden,nativePlaces:Object.values(fixtures.fieldRefusals).map(id=>nativeFor(id as string)),aliases:edenAliases,rules,verbs};
const caps=(pack:ReturnType<typeof buildBootStatic>):Capability[]=>pack.index.filter(p=>p.access==='admitted').map(p=>({placeId:p.id,id:'walk:'+p.id,available:true}));

test('complete authored catalog remains available while compact destination gazetteer declares coverage and budget',()=>{
 const input=allInputs(eden,'eden-fixture'),before=JSON.stringify(input),pack=buildBootStatic(input);
 assert.equal(pack.fullMap.places.length,eden.length);assert.equal(pack.payload.coverage.totalPlaces,232);assert.equal(pack.payload.places.length,38);assert.ok(pack.bytes<=10240);assert.ok(pack.payload.places.every(p=>p.goodFor.split(/\s+/).filter(Boolean).length<=8));
 assert.equal(JSON.stringify(input),before);assert.equal('\"'+createHash('sha256').update(pack.serialized).digest('hex')+'\"',pack.etag);assert.equal('\"'+createHash('sha256').update(pack.fullMapSerialized).digest('hex')+'\"',pack.fullMapEtag);assert.equal(pack.fullMap.places.find(p=>p.id==='eden-north-woods')!.description,eden.find(p=>p.id==='eden-north-woods')!.description);
 assert.throws(()=>buildBootStatic({...input,byteBudget:100}),/boot-pack.overflow/);assert.equal(buildBootStatic({...input,places:[...eden].reverse(),nativePlaces:[...input.nativePlaces].reverse()}).etag,pack.etag);
});

test('ID then exact normalized name then declared alias; low-confidence fuzzy guesses refuse',()=>{
 const pack=buildBootStatic(fieldInput),current=caps(pack);
 for(const [asked,target,matchedBy] of [['region-harbour.beach','region-harbour.beach','id'],['  BEACH  ','region-harbour.beach','name'],['the beach','region-harbour.beach','alias'],['woods','eden-north-woods','alias']]){
  const result=resolveBootPlace(asked,pack.index,current);assert.equal(result.ok,true);if(result.ok)assert.deepEqual(result.chosen,{place:target,name:pack.index.find(p=>p.id===target)!.name,matchedBy,capability:'walk:'+target});
 }
 for(const [bad,target] of Object.entries(fixtures.fieldRefusals)){
  const result=resolveBootPlace(bad,pack.index,current,'id');assert.equal(result.ok,false);if(!result.ok){assert.equal(result.code,'capability.unknown');assert.ok(result.did_you_mean.some(c=>c.placeId===target));}
 }
 const typo=resolveBootPlace('beech',pack.index,current,'name');assert.equal(typo.ok,false);if(!typo.ok)assert.equal(typo.did_you_mean[0].placeId,'region-harbour.beach');
 const unknown=resolveBootPlace('region-beach',pack.index,current);assert.equal(unknown.ok,false);if(!unknown.ok){assert.deepEqual(unknown.resolvedIfName,{input:'beach',placeId:'region-harbour.beach',name:'Beach'});assert.equal(unknown.did_you_mean[0].id,'walk:region-harbour.beach');}
});

test('duplicate names/aliases refuse without nearest, availability or array-order tie breaking',()=>{
 const pack=buildBootStatic(fieldInput),current=caps(pack),a=pack.index.find(p=>p.id==='region-harbour.beach')!,b=pack.index.find(p=>p.id==='eden-north-woods')!;
 for(const list of [[{...a,name:'Shared'},{...b,name:'Shared'}],[{...a,aliases:['shared']},{...b,aliases:['shared']}]] as any[]){
  const result=resolveBootPlace('shared',list,current);assert.equal(result.ok,false);if(!result.ok){assert.equal(result.code,'place.ambiguous');assert.equal(result.ambiguous!.length,2);}
  assert.deepEqual(resolveBootPlace('shared',[...list].reverse(),current),result);
 }
});

test('fresh body capabilities and actual blocked reason remain authoritative after name matching',()=>{
 const pack=buildBootStatic(fieldInput),current=caps(pack),beach=current.find(c=>c.placeId==='region-harbour.beach')!;
 const r=resolveBootPlace('Beach',pack.index,current.map(c=>c===beach?{...c,available:false,blocked:{code:'route.blocked',reason:'Current admitted route is blocked'}}:c));assert.equal(r.ok,false);if(!r.ok){assert.equal(r.code,'route.blocked');assert.equal(r.reason,'Current admitted route is blocked');}
 const none=resolveBootPlace('Beach',pack.index,[]);assert.equal(none.ok,false);if(!none.ok){assert.equal(none.code,'place.unwalkable');assert.deepEqual(none.did_you_mean,[],'never invent offered walk IDs');}
});

for(const key of ['mars','littlemartians'])test('pure '+key+' source fixture validates independent world place namespace',()=>{
 const data=fixtures[key],source=readFileSync(new URL('../../../'+data.source,import.meta.url));assert.equal(createHash('sha256').update(source).digest('hex'),data.sourceSHA256);
 const pack=buildBootStatic({worldId:key+'-fixture',places:data.places,nativePlaces:data.nativePlaces,rules,verbs}),current=caps(pack);
 for(const p of pack.payload.places){const r=resolveBootPlace(p.name,pack.index,current,'name');assert.equal(r.ok,true);if(r.ok)assert.equal(r.chosen.place,p.id);}
 assert.equal(resolveBootPlace('region-harbour.beach',pack.index,current,'id').ok,false);
});

test('admitted higher levels, unsupported authored floors, verified native aliases and moving carriers stay explicit',()=>{
 const input=fixtures.littlemartians,ground=input.places.find((p:Place)=>p.id==='tower-L0'),upper=input.places.find((p:Place)=>p.id==='tower-L1');
 const carrier={...ground,id:'balloon-basket',name:'Basket',level:0,carrier:{entity:'balloon',frame:'local' as const}},extra={...upper,id:'unsupported-L99',name:'Unadmitted upper room'};
 const aliasPlace={...ground,id:'lm-tower-ground',name:'Authored Tower ground'};
 const pack=buildBootStatic({worldId:'lm-fixture',places:[...input.places,carrier,extra,aliasPlace],nativePlaces:input.nativePlaces,nativeAliases:[{place:aliasPlace.id,nativeRegion:'tower-L0'}],rules,verbs});
 assert.equal(pack.index.find(p=>p.id==='tower-L0')!.access,'admitted');assert.equal(pack.index.find(p=>p.id===aliasPlace.id)!.nativeRegion,'tower-L0');assert.equal(pack.index.find(p=>p.id===extra.id)!.access,'unsupported-floor');assert.equal(pack.index.find(p=>p.id===carrier.id)!.access,'dynamic-carrier');assert.equal(pack.fullMap.places.find(p=>p.id===carrier.id)!.centre,null);
 for(const [id,code] of [[extra.id,'place.unsupported-floor'],[carrier.id,'place.dynamic']]){const r=resolveBootPlace(id,pack.index,caps(pack));assert.equal(r.ok,false);if(!r.ok)assert.equal(r.code,code);}
 assert.throws(()=>buildBootStatic({worldId:'lm-fixture',places:[...input.places,{...aliasPlace,level:99}],nativePlaces:input.nativePlaces,nativeAliases:[{place:aliasPlace.id,nativeRegion:'tower-L0'}],rules,verbs}),/unqualified native alias/);
});

test('static ETag excludes clock/Me churn; authenticated session assembly is always fresh/no-store',()=>{
 const pack=buildBootStatic(fieldInput),context={worldId:'eden-fixture',tick:1,clock:{day:1,time:'08:00',realMsPerWorldMinute:2500,dayNightBoundaries:null},me:{soulId:'s_own',name:'Own',character:'Fixture',place:null},here:{posture:'standing'}};
 const first=assembleBootSession(pack,context),second=assembleBootSession(pack,{...context,tick:2,clock:{...context.clock,time:'08:01'},me:{...context.me,place:'region-harbour.beach'},here:{posture:'walking'}});
 assert.equal(first.staticEtag,second.staticEtag);assert.notDeepEqual(first.clock,second.clock);assert.notDeepEqual(first.me,second.me);assert.equal(second.cacheControl,'no-store');assert.equal(second.tick,2);assert.notEqual(buildBootStatic({...fieldInput,aliases:{...edenAliases,'region-harbour.beach':['shore']}}).etag,pack.etag);
 assert.throws(()=>assembleBootSession(pack,{...context,worldId:'other'}),/fresh world\/tick/);
});


test('public projection excludes wider config fields and session fields cannot override static identity',()=>{
 const pack=buildBootStatic({...fieldInput,rules:{...rules,token:'synthetic-config-extra'} as any,verbs:[{...verbs[0],secret:'synthetic-verb-extra'} as any]});
 assert.equal(JSON.stringify(pack.payload).includes('synthetic-'),false);
 const session=assembleBootSession(pack,{worldId:'eden-fixture',tick:1,clock:{day:1,time:'08:00',realMsPerWorldMinute:null,dayNightBoundaries:null,token:'synthetic-clock-extra'},me:{soulId:'s_own',name:'Own',character:'Fixture',place:null,token:'synthetic-me-extra'},here:{},token:'synthetic-session-extra',staticEtag:'wrong'} as any);
 assert.equal(JSON.stringify(session).includes('synthetic-'),false);assert.equal(session.staticEtag,pack.etag);
});
