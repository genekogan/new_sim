import {publicVerdict} from './client-execution.mjs';
import {attendedStepRefusal} from './client-dispatch-authority.mjs';
/** Actual live public-step path, injected transports/bookkeeping only. Reads
 * may reconcile accepted membership; attendance suppresses subsequent writes. */
export async function runConversationStep(st,{conversations,refresh,converse,isPaused=()=>false,log=()=>{},onAcceptedStart=()=>{},reconcile=()=>{},clip=(s,n)=>String(s??'').slice(0,n)}={}){
 const op=st.converse,request={id:st.id,conversation:st.id,with:st.with,text:st.text,separate:st.separate,topic:st.topic,reason:st.reason};
 if(isPaused())return attendedStepRefusal();
 let decision=conversations.guard(op,request);
 if(!decision.allowed&&decision.code==='conversation.context-unknown'){await refresh('unknown-state');if(isPaused())return attendedStepRefusal();decision=conversations.guard(op,request);}
 if(!decision.allowed){log({conversationGuard:{op,allowed:false,code:decision.code,conversation:decision.conversation??st.id??null,existingIds:decision.existingIds??[]}});return {accepted:false,code:decision.code,reason:decision.reason,line:`refused ${decision.code}: ${decision.reason}${decision.conversation?' Existing ID '+decision.conversation:''}`,again:true};}
 if(isPaused())return attendedStepRefusal();
 const r=op==='start'?await converse('start',st.with,...(st.text?[st.text]:[])):op==='say'?await converse('say',st.id,st.text??''):await converse(op,st.id),verdict=publicVerdict(r),recorded=conversations.response(op,request,r,{revision:decision.revision}),cv=recorded.conversation??r.conversation?.id??r.conversation??st.id;
 if(op==='start'&&verdict===true&&typeof cv==='string')onAcceptedStart(cv);reconcile();
 log({conversationVerdict:{op,accepted:verdict,code:r.code??null,conversation:typeof cv==='string'?cv:null}});
 if(verdict!==true)return {accepted:verdict,code:r.code??'conversation.verdict-unknown',reason:r.reason??r.error??'No explicit accepted conversation verdict',line:`${verdict===false?'refused':'unconfirmed'} ${r.code??'conversation.verdict-unknown'}: ${clip(r.reason??r.error??'No explicit accepted verdict',120)}`,again:true};
 if(op==='accept'&&st.text){
  const partial=(code,reason,sent=false,accepted=false)=>({accepted:true,acceptedMembership:true,partial:true,conversation:cv,code,reason,followingSpeech:{sent,accepted},again:code!=='local.attended',line:'Accepted membership; following speech '+(sent?'was refused or unconfirmed':'not sent')+': '+reason});
  if(isPaused())return partial('local.attended','an attended session owns the mind');
  const next={id:st.id,conversation:st.id,text:st.text},guard=conversations.guard('say',next);
  if(!guard.allowed)return partial(guard.code,guard.reason);
  if(isPaused())return partial('local.attended','an attended session owns the mind');
  let said;try{said=await converse('say',st.id,st.text);}catch(error){if(error.code==='local.attended'&&error.requestNotSent)return partial(error.code,error.message);throw error;}
  conversations.response('say',next,said,{revision:guard.revision});if(publicVerdict(said)!==true)return partial(said.code??'conversation.say-unconfirmed',said.reason??'No confirmed speech admission',true,publicVerdict(said));
 }
 return {accepted:true,line:'accepted'+(typeof cv==='string'?' '+cv:'')};
}
