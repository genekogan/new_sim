// Bound a model delivery without truncating an individual fact or advancing its
// handling state. Remaining facts stay in SQLite for the next decision.
export function boundedFacts(facts,{bytes=65536,limit=100}={}){
 const selected=[];let used=2;
 for(const fact of facts){const size=Buffer.byteLength(JSON.stringify(fact))+1;if(selected.length>=limit||selected.length&&used+size>bytes)break;selected.push(fact);used+=size;}
 return selected;
}
