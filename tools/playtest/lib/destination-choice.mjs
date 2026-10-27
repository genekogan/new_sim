// Explicitly frozen destination credit; never infer a parent from proximity or prose.
import {sha256} from './hash.mjs';
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export function destinationBinding(snapshot,ref,{portable=false,room}={}){
 const entity=(snapshot.entities??[]).find(e=>e.name===ref&&e.in?.parent==='world');
 if(!entity)throw Error(`first destination requires exact root entity: ${ref}`);
 const definition=(snapshot.defs??[]).find(d=>d.ref===entity.def||`sha:${d.hash}`===entity.def);
 if(!definition?.hash)throw Error(`first destination definition missing: ${ref}`);
 const physical=structuredClone(entity);for(const k of ['about','by','born','v',...(portable?['id']:[])])delete physical[k];
 if(room!==undefined&&(!portable||typeof room!=='string'||!room||!/^[a-z0-9-]+$/.test(room)))throw Error('invalid exact destination room');
 return{ref,...(portable?{portable:true,...(room?{room}:{})}:{entityId:entity.id}),placeId:`g-${ref}${room?'.'+room:''}`,entitySha256:sha256(JSON.stringify(canonical({entity:physical,definitionHash:definition.hash,...(room?{room}:{})})))};
}
export function assertDestinationBindings(scenario,snapshot){
 const verified=[];
 for(const entry of scenario.director?.script??[])for(const choice of entry.expect?.journey?.firstDestinationChoices??[]){
  const b=choice.binding,actual=destinationBinding(snapshot,b?.ref,{portable:b?.portable===true,room:b?.room});
  if(JSON.stringify(canonical(b))!==JSON.stringify(canonical(actual)))throw Error(`stale first destination physical binding: ${b?.ref}`);
  const valid=[`walk:${b.ref}${b.room?'/'+b.room:''}`,`walk:${b.placeId}`];
  if(choice.receipt?.verb!=='walk'||!choice.receipt.capabilities?.length||choice.receipt.capabilities.some(c=>!valid.includes(c)))throw Error('first destination must bind exact physical place walk capabilities');
  verified.push({requestId:entry.id,ref:b.ref,room:b.room,entityId:snapshot.entities.find(e=>e.name===b.ref&&e.in?.parent==='world').id,placeId:b.placeId,entitySha256:b.entitySha256});
 }
 return verified;
}
export function destinationChoiceMatches(receipt,choice){
 if(!choice.receipt?.capabilities?.includes(receipt.capability))return false;
 if(receipt.chosen){const targets=[receipt.chosen.target,receipt.chosen.place].filter(v=>v!==undefined);if(!targets.length||targets.some(v=>v!==choice.binding.placeId))return false;}
 return true;
}
