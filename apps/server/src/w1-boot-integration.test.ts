import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {coreAWorld} from '../test/core-a-fixture.ts';
import {buildLedgerBoot,paginatedBoot,BOOT_BYTE_BUDGET} from './edge/boot/routes.ts';
import {EDGE_ACT_VERBS} from './edge/events/schema.ts';
import {INTENT_VERBS} from './edge/intents/intents.ts';
import {compactDoHere} from './edge/perception/here.ts';
import {freshBootClock} from './edge/boot/clock.ts';
import type {WorldHost} from './world.ts';
import {resolveBootPlace} from './edge/boot/place-resolution.ts';

test('W1 exact declared hyphenated aliases precede ID shape; unique fuzzy names report score; ambiguous and invented IDs refuse',()=>{
 const places=[{id:'native-woods',name:'Northern woodland',aliases:['north-woods'],access:'admitted' as const,level:0,nativeRegion:'native-woods'},
  {id:'native-garden',name:'Northern garden',aliases:[],access:'admitted' as const,level:0,nativeRegion:'native-garden'}];
 const caps=places.map(p=>({id:'walk:'+p.id,placeId:p.id,available:true}));
 const alias=resolveBootPlace('north-woods',places,caps);assert.ok(alias.ok);assert.equal(alias.chosen.matchedBy,'alias');
 const typo=resolveBootPlace('Nothern woodland',places,caps);assert.ok(typo.ok);assert.equal(typo.chosen.matchedBy,'fuzzy');assert.ok(typo.chosen.confidence!.score>=.9);assert.equal(typo.chosen.place,'native-woods');
 assert.equal(resolveBootPlace('north-woods',places,caps,'id').ok,false);assert.equal(resolveBootPlace('native-woodland',places,caps).ok,false);
 const duplicate=resolveBootPlace('Northern woodland',[...places,{...places[0],id:'other-woods'}],caps);assert.ok(!duplicate.ok);assert.equal(duplicate.code,'place.ambiguous');
 const fuzzyTie=resolveBootPlace('Nothern woodland',[...places,{...places[0],id:'other-woods'}],caps);assert.ok(!fuzzyTie.ok);assert.equal(fuzzyTie.code,'place.ambiguous');
 const unavailable=resolveBootPlace('Nothern woodland',places,[{...caps[0],available:false,blocked:{code:'route.blocked',reason:'Native path blocked'}}]);assert.ok(!unavailable.ok);assert.equal(unavailable.code,'route.blocked');
 assert.equal(resolveBootPlace('Nothern woodland',[{...places[0],access:'unsupported-floor'}],caps).ok,false);
});

test('W1 mounted boot: canonical cached complete catalogue/pages, fresh authenticated context, dry-run/act chosen parity', {timeout:180000}, async t=>{
 const w=await coreAWorld(1);t.after(()=>w.close());const soul=w.souls[0],headers={authorization:`Bearer ${soul.soulId}`};
 const request=(url:string,extra:Record<string,string>={})=>w.app.request(url,{headers:{...headers,...extra}});
 assert.equal((await w.app.request('/v1/edge/boot')).status,401);
 const staticRes=await request('/v1/edge/boot/static'),raw=await staticRes.text(),etag=staticRes.headers.get('etag')!,manifest=JSON.parse(raw);
 assert.equal(staticRes.status,200);assert.equal(etag,'"'+createHash('sha256').update(raw).digest('hex')+'"');assert.ok(Buffer.byteLength(raw)<=BOOT_BYTE_BUDGET);
 const cached=await request('/v1/edge/boot/static',{'if-none-match':etag});assert.equal(cached.status,304);assert.equal(await cached.text(),'');
 const catalogRes=await request('/v1/edge/boot/places'),catalogRaw=await catalogRes.text(),catalog=JSON.parse(catalogRaw);
 assert.equal(catalog.places.length,w.ledger.places.byId.size);assert.equal(catalogRes.headers.get('etag'),'"'+createHash('sha256').update(catalogRaw).digest('hex')+'"');
 const rows=[...manifest.places];
 for(const page of manifest.destinationPages??[]){const res=await request(page.url),text=await res.text();assert.ok(Buffer.byteLength(text)<=BOOT_BYTE_BUDGET);assert.equal(res.headers.get('etag'),page.etag);rows.push(...JSON.parse(text).places);}
 const source=buildLedgerBoot(w.ledger,[...EDGE_ACT_VERBS,...INTENT_VERBS]);assert.deepEqual(rows,source.payload.places);assert.equal(new Set(rows.map(p=>p.id)).size,rows.length);
 assert.equal(rows.length,manifest.coverage.listedDestinations);assert.ok(EDGE_ACT_VERBS.every(v=>manifest.verbs.some((verb:any)=>verb.id===v)));
 const before=await request('/v1/edge/boot'),session1=await before.json() as any;assert.equal(before.headers.get('cache-control'),'no-store');assert.equal(session1.apiContract,'eden-edge/1.1');assert.equal(session1.me.soulId,soul.soulId);
 await w.ticks(3);const after=await request('/v1/edge/boot',{'if-none-match':session1.staticEtag}),session2=await after.json() as any;
 assert.equal(after.status,200);assert.ok(session2.tick>session1.tick);assert.equal(session2.staticEtag,session1.staticEtag);assert.equal(session2.here.tick,session2.tick);assert.ok(session2.here.me.placePath);assert.ok(Array.isArray(session2.here.exits));const lean=await (await request('/v1/edge/here?include=doHere')).json() as any;assert.ok(Array.isArray(lean.here.doHere));assert.equal(lean.apiContract,'eden-edge/1.1');assert.ok(Buffer.byteLength(JSON.stringify(lean.here))<=2600);assert.equal((await (await request('/v1/edge/here')).json() as any).here.doHere,undefined);
 assert.ok(Array.isArray(session2.here.doHere));assert.ok(Buffer.byteLength(JSON.stringify(session2.here.doHere))<=1800);for(const c of session2.here.doHere){const offered=w.ledger.capabilities(soul).find(o=>o.id===c.id)!;assert.ok(offered?.available);assert.deepEqual(c.params,offered.params);assert.ok(!['walk','stroll'].includes(c.verb));}
 const counts=()=>({events:w.f.db.events(w.f.host.worldId).length,receipts:Number((w.f.db.db.prepare('SELECT COUNT(*) AS n FROM edge_receipts_v1').get() as any).n)}),baseline=counts();
 const resolve=async(body:object)=>{const res=await w.app.request('/v1/edge/resolve',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify(body)});return (await res.json() as any).resolve;};
 const cap=w.ledger.capabilities(soul).find(c=>c.verb==='walk'&&c.available&&c.target?.kind==='place'&&w.ledger.places.byId.get(c.target.id)?.parent!==null)!;assert.ok(cap);
 const place=w.ledger.places.byId.get(cap.target!.id)!;
 const dryName=await resolve({verb:'go',target:{place:place.name}});
 assert.ok(dryName.ok,JSON.stringify(dryName));assert.equal(dryName.would.chosen.place,place.id);assert.equal(dryName.would.chosen.matchedBy,'name');
 const dryCap=await resolve({capability:'walk:'+place.name});
 assert.deepEqual(dryCap.would.chosen.place,dryName.would.chosen.place);
 for(const bad of ['region-beach','region-old-town.market','region-amphitheatre','region-northern-woodland']){
  const out=await resolve({capability:'walk:'+bad});assert.equal(out.ok,false);assert.equal(out.code,'capability.unknown');assert.ok(out.did_you_mean.length>0);
 }
 assert.deepEqual(counts(),baseline,'boot and resolve append no event or receipt');
 const accepted=(await w.http(soul,'POST','/v1/edge/act',{capability:'walk:'+place.name,clientRef:'w1-name-once'})).body;
 assert.ok(accepted.accepted,JSON.stringify(accepted));assert.equal(accepted.receipt.chosen.place,place.id);assert.equal(accepted.receipt.chosen.matchedBy,'name');
 const retry=(await w.http(soul,'POST','/v1/edge/act',{capability:'walk:'+place.name,clientRef:'w1-name-once'})).body;assert.equal(retry.receipt.id,accepted.receipt.id);
 // Exercise overflowing pagination independently of currently admitted counts.
 const small=paginatedBoot(source);const all=small.pages.length?small.pages.flatMap(p=>JSON.parse(p.serialized).places):small.payload.places;
 assert.deepEqual(all,source.payload.places);
 console.log('W1_BOOT_PROOF '+JSON.stringify({places:catalog.places.length,destinations:rows.length,staticBytes:Buffer.byteLength(raw),catalogueBytes:Buffer.byteLength(catalogRaw),pages:manifest.destinationPages?.length??0,verbs:manifest.verbs.length,chosen:accepted.receipt.chosen,staticEtag:etag}));
});


test('W1 clock exposes calendar/tick/wall units and never guesses a paused or missing calendar',()=>{
 const host={engine:{world:{tick:72000}},living:{origin:0,dayTicks:72000},clockRate:2,paused:false} as WorldHost;
 const c=freshBootClock(host,1000);assert.equal(c.day,1);assert.equal(c.worldDayIndex,1);assert.equal(c.absoluteWorldMinutes,1800);assert.equal(c.time,'06:00');assert.equal(c.ticksPerWorldMinute,50);assert.equal(c.nativeTicksPerSecond,20);assert.equal(c.nativeSecondsPerWorldMinute,2.5);assert.equal(c.realMsPerWorldMinute,1250);assert.equal(c.sampledAtRealMs,1000);
 host.paused=true;assert.equal(freshBootClock(host).realMsPerWorldMinute,null);assert.equal(freshBootClock(host).paused,true);
 const missing=freshBootClock({...host,living:undefined} as WorldHost);assert.equal(missing.absoluteWorldMinutes,null);assert.equal(missing.dayTicks,null);
});


test('W1 doHere copies actual local parameter schemas; remote walks/places and oversized offers stay explicit',()=>{
 const caps=[{id:'read:here',verb:'read',label:'Read here',available:true,params:{seconds:{type:'integer',min:1,max:1800,default:180}}},
  {id:'read:far',verb:'read',label:'Remote',available:true,target:{kind:'place',id:'far'}},{id:'walk:near',verb:'walk',label:'Walk',available:true,target:{kind:'place',id:'near'}},
  {id:'look:here',verb:'look',label:'Large',available:true,params:{description:'x'.repeat(2000)}},
  {id:'sit:here',verb:'sit',label:'Blocked',available:false}];
 const result=compactDoHere(caps,new Set(['near']));assert.deepEqual(result.doHere.map(c=>c.id),['read:here']);assert.deepEqual(result.doHere[0].params,caps[0].params);assert.equal(result.doHereCoverage.omitted,1);assert.equal(result.doHereCoverage.complete,false);
 (result.doHere[0].params!.seconds as any).max=5;assert.equal(caps[0].params!.seconds!.max,1800,'consumer mutation never aliases the ledger schema');
});
