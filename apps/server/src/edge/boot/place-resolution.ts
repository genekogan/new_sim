// W1 additive place resolution. World metadata identifies a
// place; a fresh per-body capability remains the authority to act there.
export type PlaceAccess='admitted'|'scenery'|'unsupported-floor'|'dynamic-carrier';
export type KnownBootPlace={id:string;name:string;aliases:readonly string[];access:PlaceAccess;level:number;nativeRegion:string|null};
export type DestinationCapability={placeId:string;id:string;available:boolean;blocked?:{code:string;reason:string}};
export type PlaceResolution=
 |{ok:true;chosen:{place:string;name:string;matchedBy:'id'|'name'|'alias'|'fuzzy';capability:string;confidence?:{metric:'normalized-edit-distance/1';score:number;runnerUpScore:number}}}
 |{ok:false;code:string;reason:string;did_you_mean:{id:string;label:string;placeId:string}[];resolvedIfName?:{input:string;placeId:string;name:string};ambiguous?:string[]};
/** No token deletion, nearest-place choice or stemming. Fuzzy acceptance is
 * unique high-confidence edit distance for plain names only; the score is returned. */
export const normalizedPlaceName=(s:string)=>s.normalize('NFKC').toLowerCase().trim().replace(/\s+/gu,' ');
function editScore(a:string,b:string){
 if(a.length<6||b.length<6||Math.abs(a.length-b.length)>2)return 0;
 let prev=Array.from({length:b.length+1},(_,i)=>i);
 for(let i=1;i<=a.length;i++){const row=[i];for(let j=1;j<=b.length;j++)row[j]=Math.min(row[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));prev=row;}
 return prev[b.length]<=2?1-prev[b.length]/Math.max(a.length,b.length):0;
}
const ordered=(a:KnownBootPlace,b:KnownBootPlace)=>a.id<b.id?-1:a.id>b.id?1:0;
const looksId=(s:string)=>/^[a-z0-9]+(?:[._-][a-z0-9]+)+$/.test(s);
function similarity(a:string,b:string){
 const words=(s:string)=>new Set(normalizedPlaceName(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean)),x=words(a),y=words(b);
 const shared=[...x].filter(w=>y.has(w)).length;
 const pairs=(s:string)=>{const p=new Set<string>();for(let i=0;i<s.length-1;i++)p.add(s.slice(i,i+2));return p;},A=pairs(a),B=pairs(b),hit=[...A].filter(p=>B.has(p)).length;
 return shared*2+2*hit/Math.max(1,A.size+B.size);
}
/** Explicit ID inputs never recover by choosing another ID. Automatic mode also
 * retains lower-case composite ID refusals; fuzzy matches are hints only. */
export function resolveBootPlace(input:unknown,places:readonly KnownBootPlace[],capabilities:readonly DestinationCapability[],inputKind:'auto'|'id'|'name'='auto'):PlaceResolution{
 const sorted=[...places].sort(ordered),byId=new Map(sorted.map(p=>[p.id,p]));
 if(byId.size!==places.length)throw Error('boot-places.invalid: duplicate id');
 const text=typeof input==='string'?input.trim():'';
 if(!text||text.length>200)return {ok:false,code:'capability.params',reason:'A place ID or name of 1..200 characters is required.',did_you_mean:[]};
 const idLike=inputKind==='id'||inputKind==='auto'&&looksId(text),q=normalizedPlaceName(text),hintWords=normalizedPlaceName(text.replace(/^(?:region|eden|int|social|camp|lm|mars)[._-]/,'').replace(/[._-]/g,' '));
 const exact=byId.get(text),names=sorted.filter(p=>normalizedPlaceName(p.name)===q),aliases=sorted.filter(p=>p.aliases.some(a=>normalizedPlaceName(a)===q));
 let found=exact?[exact]:inputKind==='id'?[]:names.length?names:aliases;
 let match: 'id'|'name'|'alias'|'fuzzy'=exact?'id':names.length?'name':'alias';
 let confidence:{metric:'normalized-edit-distance/1';score:number;runnerUpScore:number}|undefined;
 if(!found.length&&!idLike){
  const scores=sorted.map(p=>({p,score:Math.max(editScore(q,normalizedPlaceName(p.name)),...p.aliases.map(a=>editScore(q,normalizedPlaceName(a))))})).sort((a,b)=>b.score-a.score||ordered(a.p,b.p));
  const best=scores[0],runnerUp=scores[1]?.score??0;
  if(best&&best.score>=.9&&best.score-runnerUp<.08){found=scores.filter(x=>x.score>=best.score-.08).map(x=>x.p);match='fuzzy';}
  if(best&&best.score>=.9&&best.score-runnerUp>=.08){found=[best.p];match='fuzzy';confidence={metric:'normalized-edit-distance/1',score:Number(best.score.toFixed(6)),runnerUpScore:Number(runnerUp.toFixed(6))};}
 }
 const hintNames=sorted.filter(p=>normalizedPlaceName(p.name)===hintWords),hintAliases=sorted.filter(p=>p.aliases.some(a=>normalizedPlaceName(a)===hintWords)),hint=hintNames.length?hintNames:hintAliases;
 const suggestions=sorted.map(p=>({p,score:Math.max(similarity(hintWords,normalizedPlaceName(p.name)),...p.aliases.map(a=>similarity(hintWords,normalizedPlaceName(a))))})).filter(x=>x.score>0&&capabilities.some(c=>c.placeId===x.p.id)).sort((a,b)=>b.score-a.score||ordered(a.p,b.p)).slice(0,3).map(({p})=>({id:capabilities.find(c=>c.placeId===p.id)!.id,label:p.name,placeId:p.id}));
 const refuse=(code:string,reason:string):Extract<PlaceResolution,{ok:false}>=>({ok:false,code,reason,did_you_mean:suggestions,...(idLike&&hint.length===1?{resolvedIfName:{input:hintWords,placeId:hint[0].id,name:hint[0].name}}:{})});
 if(!found.length)return refuse('capability.unknown',idLike?'That place ID is unknown; nothing was chosen. Names in the hints are suggestions only.':'No unique exact name, declared alias or high-confidence fuzzy name matched; nothing was chosen.');
 if(found.length>1)return {...refuse('place.ambiguous','Several places have that name or alias; use an exact ID.'),ambiguous:found.map(p=>p.id),did_you_mean:found.flatMap(p=>{const c=capabilities.find(c=>c.placeId===p.id);return c?[{id:c.id,label:p.name,placeId:p.id}]:[];})};
 const place=found[0];
 if(place.access==='dynamic-carrier')return refuse('place.dynamic','This place moves with a carrier; read its fresh ride/body context rather than using a static destination.');
 if(place.access==='unsupported-floor')return refuse('place.unsupported-floor','This authored floor has no admitted native destination; nothing was chosen.');
 if(place.access!=='admitted')return refuse('place.unwalkable','This authored place is scenery without an admitted native destination; nothing was chosen.');
 const current=capabilities.filter(c=>c.placeId===place.id);
 if(current.length>1)return refuse('place.ambiguous','Several current capabilities claim this destination; refresh capabilities.');
 const cap=current[0];if(!cap)return refuse('place.unwalkable','This body has no current destination capability for that place; refresh capabilities.');
 if(!cap.available)return refuse(cap.blocked?.code??'physical.unavailable',cap.blocked?.reason??'The current native destination capability is unavailable.');
 return {ok:true,chosen:{place:place.id,name:place.name,matchedBy:match,capability:cap.id,...(confidence?{confidence}:{})}};
}
