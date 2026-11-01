// Bound delivery and its durable handling references without truncating facts.
// One whole fact may exceed the delivery byte target to guarantee progress:
// journal payloads are <=64KiB plus a bounded envelope, so this is finite. Its
// source/id reference always fits 8KiB under the journal's identity limits.
// Remaining facts stay in SQLite for the next decision.
export function boundedFacts(facts,{bytes=65536,limit=100}={}){
 const selected=[];let used=2,referenceBytes=2;
 for(const fact of facts){
  const size=Buffer.byteLength(JSON.stringify(fact))+1,referenceSize=Buffer.byteLength(JSON.stringify({source:fact.source,id:fact.event.id}))+1;
  if(selected.length>=limit||selected.length&&(used+size>bytes||referenceBytes+referenceSize>8192))break;
  selected.push(fact);used+=size;referenceBytes+=referenceSize;
 }
 return selected;
}
