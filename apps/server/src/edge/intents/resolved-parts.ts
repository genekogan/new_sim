import type {EdgeLedger} from '../ledger/ledger.ts';
import type {MeaningPart} from '../../god/meaning.ts';
import type {Place} from '../ledger/places.ts';
import type {EdgeCapability, EdgeSoul} from '../contract.ts';

export function knownPart(L:EdgeLedger,soul:EdgeSoul,owner:Place,part:MeaningPart):boolean {
  return L.knowledge.knows(soul.soulId,owner.id) && (!part.target?.ref || ![...L.places.byId.values()].some(p=>p.ref && (p.ref===part.target!.ref || part.target!.ref!.startsWith(p.ref+'/')) && !L.knowledge.knows(soul.soulId,p.id)));
}

/** Discovery only: the caller still chooses every action. Never infer an affordance from prose. */
export function resolvedParts(L:EdgeLedger,soul:EdgeSoul,selected:EdgeCapability|string,query=''):Record<string,unknown> {
  const id=typeof selected==='string'?selected:selected.id;
  const target=typeof selected==='string'?undefined:selected.target;
  const ref=id.replace(/^[^:]+:/,'');
  const place=target?.kind==='place'?L.places.byId.get(target.id):[...L.places.byId.values()].find(p=>p.id===ref||p.ref===ref);
  if(!place?.parts?.length||!L.knowledge.knows(soul.soulId,place.id))return {};
  const terms=query.toLowerCase().split(/\W+/).filter(w=>w.length>2);
  const score=(p:NonNullable<typeof place.parts>[number])=>terms.filter(w=>[p.title,...(p.aliases??[])].join(' ').toLowerCase().includes(w)).length;
  const parts=place.parts.filter(part=>knownPart(L,soul,place,part))
    .map((p,i)=>({p,i,score:score(p)})).sort((a,b)=>b.score-a.score||a.i-b.i).slice(0,8);
  // L3 (b): each part's own id as offered now (the one offer, else on demand), without building the whole menu
  const asOffered=(capability:string)=>L.resolveIdV1(soul,capability);
  return {parts:parts.map(({p})=>{
    const affordances=[p.walk,p.sit].filter((x):x is string=>!!x).map(capability=>{
      const r=asOffered(capability);
      if(r.kind==='unknown')return {capability,available:false,reason:r.reason};
      if(r.cap.id!==capability)return {capability,available:false,reason:'This exact part action is not offered now.'};
      return {capability:r.cap.id,available:r.cap.available,...(r.cap.blocked?{reason:r.cap.blocked.reason,code:r.cap.blocked.code}:{})};
    });
    return {id:p.id,name:p.title,...(p.what?{what:p.what}:{}),...(p.target?{target:p.target}:{}),...(affordances.length?{affordances}:{})};
  })};
}
