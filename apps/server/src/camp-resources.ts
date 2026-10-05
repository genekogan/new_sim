// Personal affordance bindings come from already logged world cards and stable
// Soul IDs, never the current cast-sort index. They grant no ownership/right:
// native free-hand, support, occupancy and reservations still decide admission.
import type {WorldHost,Mind} from './world.ts';
export type CampResourceSet={id:string;mat:string;bowl:string;spoon:string;bowlReturn:string;spoonReturn:string};
export const LEGACY_CAMP_RESOURCES:readonly CampResourceSet[]=Object.freeze([1,2,3,4].map(n=>Object.freeze({
  id:'camp-personal-'+n,mat:'mat-'+n,bowl:'bowl-'+n,spoon:'spoon-'+n,
  bowlReturn:`dining-table#r${n<=2?0:2}c${n%2?0:4}`,spoonReturn:`dining-table#r${n<=2?0:2}c${n%2?1:5}`,
})));
export type CampResourceBindings={bySoul:Map<string,CampResourceSet>;issues:Map<string,string>};
export function campResourceBindings(host:WorldHost,minds:Mind[],resources:readonly CampResourceSet[]=LEGACY_CAMP_RESOURCES):CampResourceBindings{
  const bySoul=new Map<string,CampResourceSet>(),issues=new Map<string,string>(),claimed=new Set<string>();
  const available=resources.filter(r=>host.engine.world.regions[r.mat]&&host.engine.world.entities[r.bowl]&&host.engine.world.entities[r.spoon]);
  // Historic cards remain immutable and are never repaired/reassigned. Even an
  // temporarily missing physical resource reserves its historical affinity.
  for(const m of minds){
    const name=m.name.toLowerCase();
    const original=host.db.campPersonalCards(host.worldId,m.soulId).filter(c=>host.kernel.vocab.cards[c.name]?.hash===c.hash);
    const cards=original.length?original:[...new Set(host.kernel.decks[m.soulId]?.cards??[])].map(id=>host.kernel.vocab.cards[id]).filter(c=>c?.by==='world'&&(c.name.endsWith(' '+name)&&/^(bunk sleep |eat a bowl of |finish the bowl )/.test(c.name)));
    const slots=resources.filter(r=>cards.some(c=>{
      if(c.name.startsWith('bunk sleep '))return c.during.some(s=>s.verb==='mars:sleep'&&s.params.mat===r.mat);
      if(/^(eat a bowl of |finish the bowl )/.test(c.name))return [...c.approach,...c.during].some(s=>s.params.item===r.bowl||s.params.bowl===r.bowl);
      return false;
    }));
    if(slots.length===1){bySoul.set(m.soulId,slots[0]);claimed.add(slots[0].id);}
    else if(slots.length>1){issues.set(m.soulId,'Existing world cards disagree on this Soul’s personal resources; retain the evidence and resolve explicitly.');for(const r of slots)claimed.add(r.id);}
  }
  for(const [id,r] of bySoul){
    if([...bySoul].some(([other,v])=>other!==id&&v.id===r.id))issues.set(id,'Historical world cards share this personal resource affinity; do not silently rewrite them.');
    else if(!available.includes(r))issues.set(id,'The historical resource affinity remains, but one physical reference is missing.');
  }
  // Existing ID/resource evidence first. New ties may use the historical cast
  // ordering once, then the newly minted card becomes the durable binding.
  for(const m of [...minds].sort((a,b)=>a.name.localeCompare(b.name)||a.soulId.localeCompare(b.soulId))){
    if(bySoul.has(m.soulId)||issues.has(m.soulId))continue;
    const r=available.find(r=>!claimed.has(r.id));if(r){bySoul.set(m.soulId,r);claimed.add(r.id);}else issues.set(m.soulId,'No unbound physical mat/bowl/spoon set is installed; general activities remain available.');
  }
  return {bySoul,issues};
}
