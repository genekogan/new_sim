// Explicit reviewer annotations join logical writes to native effects. Neither
// repeated text nor multiple effect kinds from one request proves duplication.
const cited=x=>Array.isArray(x)&&x.length>0&&x.every(v=>typeof v==='string'&&v.length>0);
export function auditPublicEffects(effects,complete,audit){
 const result=(status,detail,evidence=[])=>({status,detail,evidence});
 const cross=audit?.crossKeyReview;
 if(cross?.status==='fail'&&cited(cross.evidence))return result('fail','Source-cited repeated intent across request keys',cross.evidence);
 if(!Array.isArray(effects)||!audit||!Array.isArray(audit.logicalWrites))return result('unknown','Complete native effects and a source-cited logical-write audit are required');
 const native=new Map(),covered=new Set(),groups=new Set(),duplicates=[],missing=[];
 for(const e of effects){
  if(typeof e?.id!=='string'||!e.id||typeof e.actor!=='string'||!e.actor||typeof e.type!=='string'||!e.type||!cited(e.evidence)){missing.push('Native effect identity, actor, kind or source missing');continue;}
  // IDs must already be canonical within this world's export (conversation
  // turns include conversation+sequence). Actor is authorship, not identity.
  const old=native.get(e.id);
  if(old&&(old.type!==e.type||old.actor!==e.actor))return result('fail','Conflicting native effect authorship or kind',[e.id]);
  native.set(e.id,e);
 }
 for(const group of audit.logicalWrites){
  if(typeof group?.id!=='string'||!group.id||typeof group.actor!=='string'||!cited(group.evidence)||!cited(group.cardinalityEvidence)||!Array.isArray(group.effectIds)||!group.expectedCardinality||typeof group.expectedCardinality!=='object'||Array.isArray(group.expectedCardinality)){missing.push('Logical write needs explicit native linkage and endpoint cardinality evidence');continue;}
  const identity=JSON.stringify([group.actor,group.id]);
  if(groups.has(identity))return result('fail','Repeated logical-write audit identity',[identity]);groups.add(identity);
  const expected=Object.entries(group.expectedCardinality);
  if(!expected.length||expected.some(([kind,max])=>!kind||!Number.isSafeInteger(max)||max<0)){missing.push('Expected effect cardinality is missing or invalid');continue;}
  const counts=new Map();
  for(const id of new Set(group.effectIds)){
   const effect=native.get(id);
   if(!effect){missing.push('Audited effect absent from native enumeration');continue;}
   if(effect.actor!==group.actor)return result('fail','Logical write contradicts native effect author',[id]);
   if(covered.has(id))return result('fail','One native effect assigned to multiple logical writes',[id]);
   covered.add(id);counts.set(effect.type,(counts.get(effect.type)??0)+1);
  }
  for(const [kind,count] of counts){
   if(!Object.hasOwn(group.expectedCardinality,kind)){missing.push('Endpoint cardinality omits an observed effect kind');continue;}
   if(count>group.expectedCardinality[kind])duplicates.push({logicalWrite:identity,kind,count,maximum:group.expectedCardinality[kind],evidence:group.evidence});
  }
 }
 if(duplicates.length)return result('fail','Excess native effects for source-cited logical writes',duplicates);
 if(missing.length||complete!==true||audit.coverageComplete!==true||!cited(audit.evidence)||covered.size!==native.size||cross?.status!=='pass'||!cited(cross.evidence))return result('unknown','Full native coverage and a source-cited cross-key intent review remain required',missing);
 return result('pass','Complete logical-write cardinality and cross-key intent audit',audit.evidence);
}
