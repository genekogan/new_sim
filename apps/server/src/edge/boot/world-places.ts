import type {EdgeLedger} from '../ledger/ledger.ts';
import type {EdgeCapability,EdgeSoul} from '../contract.ts';
import {strictCheck} from '../intents/strict.ts';
import {resolveBootPlace,normalizedPlaceName,type KnownBootPlace,type DestinationCapability} from './place-resolution.ts';
// Declared name aliases are public authored vocabulary, never fuzzy choices.
const ALIASES:Readonly<Record<string,readonly string[]>>={
 'region-park':['park','the park'],
 'shore-water':['pond','the pond'],
 'region-harbour.beach':['beach','the beach'],
 'region-old-town.market-street':['old town market','market street'],
 'eden-amphitheatre':['amphitheatre','the amphitheatre'],
 'eden-north-woods':['woods','northern woodland','the woods'],
};
export function bootAliases(L:EdgeLedger){return Object.fromEntries(Object.entries(ALIASES).filter(([id])=>L.places.byId.has(id)));}
export function nativeAliasesOf(L:EdgeLedger){return (L.worldProfile as typeof L.worldProfile&{nativePlaceAliases?:readonly {place:string;nativeRegion:string}[]})?.nativePlaceAliases??[];}
/** With `soulId`, secret places that Soul does not know are left out (knowledge/1): a name never confirms one exists. */
export function knownBootPlaces(L:EdgeLedger,soulId?:string):KnownBootPlace[]{
 const regions=L.host.engine.world.regions,aliases=new Map(nativeAliasesOf(L).map(a=>[a.place,a.nativeRegion])),names=bootAliases(L);
 return [...L.places.byId.values()].filter(p=>soulId===undefined||(L.knowledge?.knows(soulId,p.id)??true)).map(p=>{const id=aliases.get(p.id)??p.id,r=regions[id] as (typeof regions)[string]&{placeLevel?:number}|undefined,admitted=!!r&&(r.placeLevel??r.level??0)===p.level,god=!r&&!p.carrier&&!!L.placeWalkable?.(p.id);
  return {id:p.id,name:p.name,aliases:names[p.id]??[],level:p.level,nativeRegion:admitted?id:null,access:p.carrier?'dynamic-carrier':admitted||god?'admitted':p.level!==0?'unsupported-floor':'scenery'};
 });
}
export function destinationOffers(caps:readonly EdgeCapability[],verb:string):DestinationCapability[]{return caps.filter(c=>c.verb===verb&&c.target?.kind==='place').map(c=>({id:c.id,placeId:c.target!.id,available:c.available,blocked:c.blocked}));}
export function resolvePlaceForVerb(L:EdgeLedger,soul:EdgeSoul,input:unknown,verb='walk'){
 const caps=L.coreA.binds(soul).caps,offers=destinationOffers(caps,verb);
 const places=knownBootPlaces(L,soul.soulId);
 let resolved=resolveBootPlace(input,places,offers);
 // F6 (SOULSIM-H): a known place the listing leaves out for distance only (a far building's room: rooms are listed within
 // 80 m) gets its one walk on demand, as words do: the capability it names is then acted as offered (see explicitPlaceCapability)
 if(!resolved.ok&&verb==='walk'&&resolved.code==='place.unwalkable'&&L.walkOnDemand){
  const named=resolveBootPlace(input,places,places.map(p=>({placeId:p.id,id:p.id,available:true}))),more=[...caps];
  if(named.ok&&places.find(p=>p.id===named.chosen.place)?.access==='admitted'&&L.walkOnDemand(soul,named.chosen.place,more,new Map())){const again=resolveBootPlace(input,places,destinationOffers(more,verb));if(again.ok)resolved=again;}
 }
 if(!resolved.ok&&verb==='walk'&&resolved.code==='place.unwalkable')return {...resolved,reason:resolved.reason+' no walk reaches it in the current offered destinations.'};
 return resolved;
}
/** Identity only: for a room/waypoint whose separate native seat/route check
 * follows. It grants no action or geometric admission. */
export function lookupPlaceIdentity(L:EdgeLedger,input:unknown,soulId?:string){const places=knownBootPlaces(L,soulId).map(p=>({...p,access:'admitted' as const}));return resolveBootPlace(input,places,places.map(p=>({placeId:p.id,id:p.id,available:true})));}
/** Legacy go-to-object names remain distinct from authored place names. Exact
 * offered labels win over aliases, but same-stage ambiguity never picks nearest. */
export function offeredWalkObject(L:EdgeLedger,soul:EdgeSoul,input:string){
 const q=normalizedPlaceName(input),caps=L.coreA.binds(soul).caps.filter(c=>c.verb==='walk'&&c.target?.kind==='object'),places=knownBootPlaces(L,soul.soulId);
 const exact=caps.filter(c=>normalizedPlaceName(c.label)===q),objects=exact.length?exact:caps.filter(c=>q==='the '+normalizedPlaceName(c.label));
 if(!objects.length)return null;
 const namePlaces=places.filter(p=>normalizedPlaceName(p.name)===q),aliasPlaces=places.filter(p=>p.aliases.some(a=>normalizedPlaceName(a)===q));
 if(!exact.length&&namePlaces.length)return null; // exact authored name wins over an article alias
 const collision=exact.length?namePlaces:aliasPlaces;
 if(objects.length+collision.length>1)return {ok:false as const,code:'place.ambiguous',reason:'Several current destinations have that name or alias; use an exact offered capability ID.',did_you_mean:[...objects.map(c=>({id:c.id,label:c.label})),...collision.map(p=>({id:'walk:'+p.id,label:p.name}))]};
 const cap=objects[0];if(!cap.available)return {ok:false as const,code:cap.blocked?.code??'physical.unavailable',reason:cap.blocked?.reason??'The current native destination capability is unavailable.',did_you_mean:[]};
 return {ok:true as const,cap,matchedBy:exact.length?'name' as const:'alias' as const};
}
export function explicitPlaceCapability(L:EdgeLedger,soul:EdgeSoul,asked:string){
 const i=asked.indexOf(':');if(i<=0)return null;const verb=asked.slice(0,i),target=asked.slice(i+1);
 const caps=L.coreA.binds(soul).caps;
 if(caps.some(c=>c.id===asked)||target==='here')return null;
 // Never route a Soul, fixture, spot, item or object ID through place matching.
 if(!['walk','stroll','hang-out','gather','swim','read','lie','nap','sit-ground'].includes(verb))return null;
 if(verb==='walk'){const object=offeredWalkObject(L,soul,target);if(object)return object.ok?null:object;}
 const q=normalizedPlaceName(target),named=knownBootPlaces(L,soul.soulId).some(p=>p.id===target||normalizedPlaceName(p.name)===q||p.aliases.some(a=>normalizedPlaceName(a)===q));
 // Preserve strict/1 unknown-ID diagnostics without blocking declared idlike aliases.
 if(!named){const strict=strictCheck(L,soul,asked,caps);if(strict)return {ok:false as const,...strict};}
 if(!named&&verb!=='walk'&&verb!=='stroll'&&verb!=='gather'&&verb!=='hang-out')return null;
 const r=resolvePlaceForVerb(L,soul,target,verb);
 // F6: the asked ID is itself the walk offered on demand: act/resolve read it as an offered ID (it is not in the listing)
 return r.ok&&r.chosen.capability===asked?null:r;
}
