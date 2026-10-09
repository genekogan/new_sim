const ID=/^s_[A-Za-z0-9_-]{1,100}$/;
const plain=x=>x&&typeof x==='object'&&!Array.isArray(x);
export const normalizedSoulName=value=>value.normalize('NFKC').trim().replace(/\s+/gu,' ').toLowerCase();
const validName=x=>typeof x==='string'&&x.trim().length>0&&x.length<=200&&!/[\u0000-\u001f\u007f]/u.test(x);
const refuse=(code,reason,requested)=>({ok:false,code,reason,requested});
function reference(value){
 if(typeof value==='string'){const t=value.trim();if(ID.test(t))return {id:t};if(/^h_/i.test(t))throw Error('Entity IDs are not Soul IDs; no ID conversion is allowed.');if(validName(t))return {name:t};}
 if(plain(value)&&Object.keys(value).every(k=>k==='id'||k==='name')&&(value.id!==undefined||value.name!==undefined)){if(value.id!==undefined&&!ID.test(value.id))throw Error('Canonical Soul ID required.');if(value.name!==undefined&&!validName(value.name))throw Error('Bounded exact full Soul name required.');return {...(value.id?{id:value.id}:{}),...(value.name?{name:value.name}:{} )};}
 throw Error('A canonical Soul ID, full name or {id,name} reference is required.');
}
/** Pure exact identity lookup over already entitled public evidence. This does
 * not fetch a directory, infer an entity→Soul ID, locate/approach somebody,
 * authorize an invitation, grant consent, or parse trusted owner prose. */
export function resolveSoulReferences(values,{worldId,rosters,constraints}={}){
 if(typeof worldId!=='string'||!worldId||!Array.isArray(rosters)||rosters.length>4)return refuse('soul.scope-required','Explicit same-world public roster provenance is required.',values);
 if(!Array.isArray(values)||values.length<1||values.length>8)return refuse('soul.references-invalid','Supply1..8 Soul references without substituting other people.',values);
 let requested;try{requested=values.map(reference);}catch(error){return refuse('soul.reference-invalid',error.message,values);}
 const byId=new Map();
 for(const source of rosters){
  if(!plain(source)||source.worldId!==worldId)return refuse('soul.scope-mismatch','Roster belongs to another or unknown world; nothing was chosen.',requested);
  if(!['perceived','public-directory','conversation-participants'].includes(source.kind)||!Array.isArray(source.rows)||source.rows.length>512)return refuse('soul.roster-invalid','Only bounded perceived, entitled conversation-participant or public-directory Soul rows are accepted.',requested);
  for(const row of source.rows){
   if(!plain(row)||row.worldId!==undefined&&row.worldId!==worldId)return refuse('soul.scope-mismatch','Row belongs to another or unknown world; nothing was chosen.',requested);
   const id=row.soulId??row.id;if(!ID.test(id??'')||row.soulId!==undefined&&row.id!==undefined&&row.soulId!==row.id||!validName(row.name))return refuse('soul.roster-invalid','Public roster must give canonical Soul IDs with exact full names; entity IDs are not converted.',requested);
   const prior=byId.get(id);if(prior&&(normalizedSoulName(prior.name)!==normalizedSoulName(row.name)||typeof prior.available==='boolean'&&typeof row.available==='boolean'&&prior.available!==row.available))return refuse('soul.roster-conflict','Public sources disagree about one Soul identity/availability; refresh instead of choosing.',requested);
   const item=prior??{id,name:row.name,nameAmbiguous:row.nameAmbiguous===true,available:typeof row.available==='boolean'?row.available:null,provenance:[]};if(item.available===null&&typeof row.available==='boolean')item.available=row.available;
   item.nameAmbiguous ||= row.nameAmbiguous===true;item.provenance.push({worldId,kind:source.kind});byId.set(id,item);
  }
 }
 function pick(ref){
  if(ref.id){const row=byId.get(ref.id);if(!row)return refuse('soul.reference-unavailable','That Soul ID is absent from supplied current same-world public evidence; refresh or wait, never substitute.',ref);if(ref.name&&normalizedSoulName(ref.name)!==normalizedSoulName(row.name))return refuse('soul.id-name-mismatch','Requested full name and canonical ID identify different people; nothing was chosen.',ref);if(row.available===false)return refuse('soul.reference-unavailable','That exact Soul is currently reported unavailable; nothing was substituted.',ref);return {ok:true,chosen:{id:row.id,name:row.name,...(row.nameAmbiguous?{nameAmbiguous:true}:{}),matchedBy:ref.name?'id+name':'id',availability:'identity-observed; action admission remains server-owned',provenance:structuredClone(row.provenance)}};}
  const hits=[...byId.values()].filter(row=>normalizedSoulName(row.name)===normalizedSoulName(ref.name));
  if(!hits.length)return refuse('soul.reference-unavailable','That exact full name is absent from supplied current same-world public evidence; wait/clarify instead of using a similar or nearby name.',ref);
  if(hits.length===1&&hits[0].nameAmbiguous)return refuse('soul.name-ambiguous','This full name was reassigned from another immutable Soul identity. Ask for an explicit canonical ID; no earlier person was inferred.',ref);
  if(hits.length>1)return {...refuse('soul.name-ambiguous','Several public Souls have that exact normalized full name; an explicit canonical ID is required.',ref),ambiguous:hits.map(row=>({id:row.id,name:row.name}))};
  return pick({id:hits[0].id,name:ref.name});
 }
 const chosen=[];for(const ref of requested){const result=pick(ref);if(!result.ok)return {...result,requested};chosen.push({...result.chosen,matchedBy:ref.id?result.chosen.matchedBy:'name'});}
 if(new Set(chosen.map(c=>c.id)).size!==chosen.length)return refuse('soul.references-duplicate','Several supplied references name the same Soul; nothing was implicitly duplicated.',requested);
 if(constraints!==undefined){if(!Array.isArray(constraints)||constraints.length<1||constraints.length>8)return refuse('soul.constraints-invalid','Trusted explicit identity constraints must be a bounded reference list.',requested);let bound;try{bound=constraints.map(reference).map(pick);}catch(error){return refuse('soul.constraints-invalid',error.message,requested);}const unavailable=bound.find(r=>!r.ok);if(unavailable)return {...unavailable,requested,reason:'An original explicit identity constraint is unavailable or inconsistent; do not replace it with another name.'};const expected=bound.map(r=>r.chosen.id).sort(),actual=chosen.map(r=>r.id).sort();if(JSON.stringify(expected)!==JSON.stringify(actual))return refuse('soul.constraint-mismatch','Chosen participants do not match the original explicit identity constraints; nothing was chosen.',requested);}
 return {ok:true,worldId,requested,chosen,note:'Exact identity only. Presence, distance, consent and physical admission are not inferred.'};
}
export function resolveSoulReference(value,options){const result=resolveSoulReferences([value],options);return result.ok?{...result,requested:result.requested[0],chosen:result.chosen[0]}:result;}
