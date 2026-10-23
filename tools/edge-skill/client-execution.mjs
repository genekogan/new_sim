const ATTENTION=/^(look|turn|face|glance)\b/i;
export const bodyStep=step=>!!(step.act&&!ATTENTION.test(step.act)||step.mark||step.project||step.object&&step.action);
export function publicVerdict(value){
 if(value?.accepted===false||value?.ok===false)return false;
 if(typeof value?.accepted==='boolean')return value.accepted;
 if(typeof value?.ok==='boolean')return value.ok;
 return null;
}
/** Only explicit actual facts: no prompt/headers, inferred admission or model claims. */
export function executionContext(queue,receipt,results=[]){return {
 queueId:queue.id??null,source:queue.source??null,notice:queue.notice??null,
 currentReceipt:receipt?{id:receipt.id,capability:receipt.capability,phase:receipt.phase,code:receipt.code??null,reason:receipt.reason??null,endedAt:receipt.endedAt??null}:null,
 steps:queue.steps.slice(0,8).map(s=>({id:s.id,act:s.act,status:s.status,localProtectionEnabled:s.protected===true,unappliedProtectionParameter:Object.hasOwn(s.params??{},'protected')?s.params.protected:null,receiptId:s.receiptId??null,code:s.code??null,reason:s.reason??null,lastReconciledAt:s.lastReconciledAt??null})),omittedSteps:Math.max(0,queue.steps.length-8),
 recentPublicResults:results.slice(-8).map(r=>({at:r.at,operation:r.operation,accepted:r.accepted??null,readOnly:r.readOnly===true,followupRequested:r.followupRequested===true,code:r.code??null,reason:r.reason??null,receiptId:r.receiptId??null,queueRetained:r.queueRetained??false,line:String(r.line??'').slice(0,240)})),
 };}
/** Body-dependent utterances follow a completed body step in the durable queue.
 * Public-only replies remain independent of ongoing physical work. Entire mixed
 * replies are retained atomically before any public effect; prefix public steps
 * then run in declared order. Local retention is not physical admission. */
export async function executeReplySteps(steps,{queue,id,source,replace=false,force=false,pump,runPublic}={}){
 const first=steps.findIndex(bodyStep),results=[];
 const refusal=(code,reason,extra={})=>{results.push({operation:'ordered-reply',accepted:false,code,reason,line:`refused ${code}: ${reason}`,...extra});return {results,again:true,retained:false};};
 if(first>=0){
  let retained;try{retained=queue.enqueue(steps.map(s=>s.act&&ATTENTION.test(s.act)?{publicStep:s}:s),{id,source,replace,force});}catch(error){return refusal('local.queue-refused',error.message);}
  const repair=steps.some(s=>s.fixes!==undefined)?retained.repairs?.at(-1):null,dropped=repair?.droppedSpeech?.length??0;
  if(dropped)results.push({operation:'speech-redraft',accepted:null,readOnly:true,code:'local.speech-redraft',line:`Dropped ${dropped} pre-written speech step${dropped===1?'':'s'} queued after the refused ${repair.failedStep.act}: written before the refusal, not said. Speak only after the replacement finishes, and only about what actually happened.`});
  const state=await pump();
  for(const s of (state.skips??[]).slice(retained.skips?.length??0))results.push({operation:'refused-step-skipped',accepted:null,readOnly:true,code:'local.refused-step-skipped',line:`Skipped the refused ${s.act} (${s.code??'refused'}) ${s.why}; the queue went on with its next step.${s.droppedSpeech?.length?` Dropped ${s.droppedSpeech.length} pre-written speech step${s.droppedSpeech.length===1?'':'s'} after it, not said.`:''}`});
  const failed=state.steps.find(s=>['failed','blocked','interrupted'].includes(s.status));
  if(failed){results.push({operation:failed.act,accepted:false,code:failed.code??state.notice?.reason??failed.status,reason:failed.reason??state.notice?.reason??failed.status,queueRetained:true,line:`Queue ${state.id} retained, but ${failed.act} ${failed.status}: ${failed.code??state.notice?.reason??''}. Dependent public steps have not run.`});return {results,again:true,retained:true};}
  const current=state.steps.find(s=>s.receiptId),accepted=!!current?.receiptId;
  results.push({operation:'ordered-reply',accepted:accepted?true:null,receiptId:current?.receiptId??null,queueRetained:true,line:`Retained ${retained.steps.length} ordered steps in queue ${state.id}; ${accepted?`actual receipt ${current.receiptId} is ${current.receipt?.phase??current.status}`:'physical admission not yet confirmed'}. Future steps are pending, not already accepted or completed.`});
  return {results,again:false,retained:true};
 }
 for(const step of steps){let result;try{result=await runPublic(step);}catch(error){result={accepted:false,code:'local.public-error',reason:error.message,line:'error: '+String(error.message).slice(0,200),again:true};}results.push({operation:step.converse?'converse:'+step.converse:step.act??(step.say?'say':'public-step'),...result});if(result.accepted!==true&&result.readOnly!==true)return {results,again:true,retained:false};}
 return {results,again:results.some(r=>r.again),retained:false};
}
export function boundedRememberChoice(value){if(!value||typeof value!=='object')return {type:typeof value};const list=Array.isArray(value)?value.slice(0,3):[value];return list.map(v=>({keys:Object.keys(v??{}).slice(0,12),...Object.fromEntries(['person','place','goal','horizon'].filter(k=>typeof v?.[k]==='string').map(k=>[k,v[k].slice(0,160)])),selfLines:Array.isArray(v?.self)?v.self.length:undefined}));}

const identityText=value=>String(value??'').normalize('NFKC').replace(/\s+/gu,' ').trim().toLocaleLowerCase('en-US');
export const literalSoulReference=(text,reference)=>{const id=typeof reference==='string'&&/^s_[A-Za-z0-9_-]+$/.test(reference);const source=id?String(text??'').normalize('NFKC').replace(/\s+/gu,' ').trim():identityText(text),needle=id?reference:identityText(reference);if(!needle)return false;let offset=-1;while((offset=source.indexOf(needle,offset+1))>=0){if(!/[\p{L}\p{N}_-]/u.test(source[offset-1]??'')&&!/[\p{L}\p{N}_-]/u.test(source[offset+needle.length]??''))return true;}return false;};
const GENERIC_IDENTITY_BASES=new Set(['anyone','anyone nearby','someone','someone nearby','somebody','somebody nearby','people nearby','everyone nearby','everyone','any nearby person']);
export const literalGenericIdentityBases=ownerText=>[...GENERIC_IDENTITY_BASES].filter(basis=>literalSoulReference(ownerText,basis));
/** R2 sociability: while an owner request is open, a Soul may still greet, wave at or chat with people the
 * world itself perceives within a few metres. Never for other person-directed acts (give, hug, follow…), never
 * when the owner said not to, and never for someone whose name shares a word with the owner's text left after
 * the full names of present people are removed (no similar-name substitution for a person the owner named). */
export const NEARBY_SOCIAL_METRES=5;
const SOCIAL_ACT=/^(?:wave|greet|nod|bow|cheer|clap|smile)(?:$|[\s:-])/i;
export const socialIdentityStep=step=>step?.converse==='start'||typeof step?.act==='string'&&SOCIAL_ACT.test(step.act.trim());
const NO_SOCIAL=/\b(?:do ?n[o']?t|never|no)\s+(?:talk|speak|chat|greet|wave|social[a-z]*|interact|convers[a-z]*|engage)|\b(?:talk|speak|chat)\s+(?:to|with)\s+(?:no ?one|nobody)|\b(?:avoid|ignore)\s+(?:everyone|everybody|people|others|anyone)\b|\bkeep to yourself\b|\b(?:stay|keep|be)\s+(?:quiet|silent)\b|\bin silence\b/i;
export const ownerForbidsSocial=text=>NO_SOCIAL.test(String(text??'').normalize('NFKC').replace(/[\u2018\u2019]/g,"'"));
const nameWords=name=>identityText(name).split(/[^\p{L}\p{N}]+/u).filter(w=>w.length>=2);
function nearbySocialChoice(ownerText,chosen,nearby,selfName){
 const row=nearby.find(p=>p?.id===chosen?.id);if(!row||!Number.isFinite(row.dist)||row.dist>NEARBY_SOCIAL_METRES||ownerForbidsSocial(ownerText))return false;
 let rest=identityText(ownerText);for(const p of [...nearby,chosen,{name:selfName}])if(p?.name&&literalSoulReference(ownerText,p.name))rest=rest.split(identityText(p.name)).join(' ');
 return !nameWords(chosen.name??row.name).some(w=>literalSoulReference(rest,w));
}
/** ACCEPT2 class 2: the owner said only the first name ("wave to Wren"). It binds the chosen Soul when that first name is
 * unique in the same public evidence and the owner did not go on to name another surname ("Wren Other"); several Souls with
 * that first name return soul.name-ambiguous with their full names as did_you_mean. */
function firstNameBinding(ownerText,chosen,resolve){
 const words=String(chosen?.name??'').normalize('NFKC').trim().split(/\s+/u),first=words[0];if(!first||!literalSoulReference(ownerText,first))return null;
 const text=String(ownerText).normalize('NFKC'),re=new RegExp('(?<![\\p{L}\\p{N}_-])'+first.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?![\\p{L}\\p{N}_-])\\s+([\\p{L}\\p{N}_-]+)','giu');
 for(const m of text.matchAll(re)){const next=m[1];if(/^\p{Lu}|\p{N}/u.test(next)&&identityText(next)!==identityText(words[1]??''))return null;}
 const r=resolve([first]);if(!r.ok)return r.code==='soul.name-ambiguous'?r:null;return r.chosen[0]?.id===chosen.id?{ok:true}:null;
}
/** Validate supplied references, not arbitrary prose semantics. A generic choice
 * needs an explicit supported selector actually present in the trusted request.
 * Neither a model judgment nor a similar first name supplies owner authority. */
export function bindLiveSoulReferences(refs,{ownerText='',identityBasis,resolve,social=false,nearby=[],selfName=null}={}){
 const list=Array.isArray(refs)?refs:[refs],generic=GENERIC_IDENTITY_BASES.has(identityText(identityBasis))&&literalSoulReference(ownerText,identityBasis);
 const resolved=resolve(list);if(!resolved.ok)return resolved;let nearbySocial=false;
 if(ownerText&&!generic){for(let i=0;i<list.length;i++){const ref=list[i],chosen=resolved.chosen[i],name=typeof ref==='string'&&!ref.startsWith('s_')?ref:ref?.name??chosen.name,id=typeof ref==='string'&&ref.startsWith('s_')?ref:ref?.id??chosen.id;
  if(chosen.nameAmbiguous&&!literalSoulReference(ownerText,chosen.id))return {ok:false,code:'identity.reassigned-name',reason:'The named label was reassigned. An explicit canonical ID must come from the trusted owner request, not a model-invented pair; clarify instead of substituting.',requested:resolved.requested,chosen:resolved.chosen};
  if(!literalSoulReference(ownerText,name)&&!literalSoulReference(ownerText,id)&&social&&nearbySocialChoice(ownerText,chosen,nearby,selfName)){nearbySocial=true;continue;}
  if(!literalSoulReference(ownerText,name)&&!literalSoulReference(ownerText,id)){const byFirst=firstNameBinding(ownerText,chosen,resolve);if(byFirst?.ok===false)return {...byFirst,requested:resolved.requested};if(byFirst)continue;}
  if(!literalSoulReference(ownerText,name)&&!literalSoulReference(ownerText,id))return {ok:false,code:'identity.owner-binding-required',reason:'Selected full name/ID is not a literal reference in the trusted owner request. '+(literalGenericIdentityBases(ownerText).length?'For an intended generic choice, this request contains a literal selector: retry the step with top-level identityBasis:'+JSON.stringify(literalGenericIdentityBases(ownerText)[0])+', keeping the exact observed with/targetSoul reference. identityBasis belongs on this do step, not inside params. This is a repair hint, not acceptance or consent.':'Use the exact intended full name, wait for it, or ask for clarification; no similar-name substitution.'),requested:resolved.requested,chosen:resolved.chosen};}}
 return {...resolved,basis:ownerText?(generic?'literal-generic-choice':nearbySocial?'nearby-social-choice':'literal-owner-reference'):'observed-autonomous-choice'};
}
