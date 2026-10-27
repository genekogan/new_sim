// Explicitly frozen destination credit; never infer a parent from proximity or prose.
import {sha256} from './hash.mjs';
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export function destinationBinding(snapshot,ref){
 const entity=(snapshot.entities??[]).find(e=>e.name===ref&&e.in?.parent==='world');
 if(!entity)throw Error(`first destination requires exact root entity: ${ref}`);
 const definition=(snapshot.defs??[]).find(d=>d.ref===entity.def||`sha:${d.hash}`===entity.def);
 if(!definition?.hash)throw Error(`first destination definition missing: ${ref}`);
 const physical=structuredClone(entity);for(const k of ['about','by','born','v'])delete physical[k];
 return{ref,entityId:entity.id,placeId:`g-${ref}`,entitySha256:sha256(JSON.stringify(canonical({entity:physical,definitionHash:definition.hash})))};
}
export function assertDestinationBindings(scenario,snapshot){
 for(const entry of scenario.director?.script??[])for(const choice of entry.expect?.journey?.firstDestinationChoices??[]){
  const b=choice.binding,actual=destinationBinding(snapshot,b?.ref);
  if(JSON.stringify(canonical(b))!==JSON.stringify(canonical(actual)))throw Error(`stale first destination physical binding: ${b?.ref}`);
  const valid=[`walk:${b.ref}`,`walk:${b.placeId}`];
  if(choice.receipt?.verb!=='walk'||!choice.receipt.capabilities?.length||choice.receipt.capabilities.some(c=>!valid.includes(c)))throw Error('first destination must bind exact physical place walk capabilities');
 }
}
export function destinationChoiceMatches(receipt,choice){
 if(!choice.receipt?.capabilities?.includes(receipt.capability))return false;
 if(receipt.chosen){const targets=[receipt.chosen.target,receipt.chosen.place].filter(v=>v!==undefined);if(!targets.length||targets.some(v=>v!==choice.binding.placeId))return false;}
 return true;
}
