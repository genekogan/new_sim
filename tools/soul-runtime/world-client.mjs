// Narrow authenticated world transport. Credentials stay in this closure, never
// in model context, journal entries, URLs or diagnostics. No automatic write retry.
import {createEventReader} from './sse.mjs';
const segment=v=>encodeURIComponent(String(v));
const error=(code,message,extra={})=>Object.assign(Error(message),{code,...extra});
export const isTransientRead=e=>e?.transient===true;
export function createWorldClient({world,token,fetchImpl=fetch,timeoutMs=65000}){
 const base=new URL(world);
 if(base.username||base.password||base.search||base.hash||!(base.protocol==='https:'||(base.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(base.hostname))))throw Error('World must be HTTPS or loopback HTTP without credentials/query');
 if(typeof token!=='string'||!token)throw Error('Missing paired Soul credential');
 const origin=base.href.replace(/\/$/,'');
 async function request(path,{method='GET',body,operationId,signal,readOnly=method==='GET'}={}){
  const headers={'content-type':'application/json',authorization:`Bearer ${token}`};
  if(operationId)headers['idempotency-key']=operationId;
  let response;
  try{response=await fetchImpl(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs)});}
  catch(e){throw error('transport.unreachable',signal?.aborted?'Request aborted':'World request did not return',{transient:readOnly&&!signal?.aborted,uncertain:!readOnly});}
  let data;
  try{const text=await response.text();if(Buffer.byteLength(text)>4*1024*1024)throw Error();data=JSON.parse(text);}
  catch{throw error('transport.body','World response body was incomplete or invalid',{transient:readOnly&&(response.status>=500||response.status<300),uncertain:!readOnly,status:response.status});}
  if(!response.ok)throw error(data.error?.code??data.code??`http.${response.status}`,data.error?.message??'World request refused',{status:response.status,transient:readOnly&&(response.status===429||response.status>=500),uncertain:!readOnly&&response.status>=500});
  return data;
 }
 const eventPage=createEventReader({open:async(after,signal)=>{
  let response;
  try{response=await fetchImpl(origin+'/v1/edge/events?'+new URLSearchParams({cursor:after??'c_0',format:'envelope'}),{headers:{authorization:`Bearer ${token}`,accept:'text/event-stream'},redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs)});}
  catch{throw error('transport.unreachable','Event stream unavailable',{transient:!signal?.aborted});}
  if(!response.ok)throw error('stream.refused','Event stream refused',{status:response.status,transient:response.status===429||response.status>=500});
  return response;
 }});
 return {
  eventPage,
  async reconcile(call,operationId,signal){
   const route=call.command==='act'?'/v1/edge/act':call.command==='say'?'/v1/edge/say':call.command==='converse'?'/v1/edge/converse':call.command==='object'?'/v1/edge/objects/'+segment(call.args.id)+'/act':null;
   if(!route)return {state:'unknown',note:'No authoritative lookup for this operation'};
   return request('/v1/edge/operations/'+segment(operationId)+'?'+new URLSearchParams({route:'POST '+route}),{signal});
  },
  async worldPage({after,signal}){const d=await request('/v1/edge/wait?'+new URLSearchParams({after:after??'c_0',timeout:'50'}),{signal});return {cursor:d.cursor,events:d.events??[],gap:d.gap??false};},
  async ownerPage({after,signal}){const d=await request('/v1/edge/inbox/listen?'+new URLSearchParams({timeoutMs:'50000',...(after?{after}:{})}),{signal});
   const list=Array.isArray(d.backlog)?d.backlog:d.inbox?.latest?[d.inbox.latest]:[];
   const events=list.filter(m=>m?.id&&m.state!=='acknowledged').map(m=>({id:m.id,kind:'owner.message',text:m.text,sentAt:m.sentAt}));
   return {cursor:events.at(-1)?.id??after,events};
  },
  async read(command,args={},signal){
   if(command==='resync'){const observation=await request('/v1/edge/observe',{signal}),conversations=await request('/v1/edge/conversations',{signal});return {observation,conversations,historyIncomplete:true,note:'Current facts refreshed; missing historical events were not reconstructed.'};}
   if(command==='here')return request('/v1/edge/here?include=doHere',{signal});
   if(command==='observe')return request('/v1/edge/observe',{signal});
   if(command==='explore')return request('/v1/edge/around'+(args.query?'?to='+segment(args.query):''),{signal});
   if(command==='resolve')return request('/v1/edge/resolve',{method:'POST',body:{capability:args.capability,params:args.params??{}},signal,readOnly:true});
   if(command==='receipt')return request('/v1/edge/receipts/'+segment(args.id),{signal});
   if(command==='conversations')return request('/v1/edge/conversations',{signal});
   if(command==='turns')return request('/v1/edge/conversations/'+segment(args.id)+'/turns?after='+segment(args.after??0),{signal});
   if(command==='calendar')return request('/v1/edge/calendar',{signal});
   if(command==='reminders')return request('/v1/edge/reminders?state=active',{signal});
   if(command==='object')return request('/v1/edge/objects/'+segment(args.id),{signal});
   throw Error('Unsupported world read');
  },
  async write(command,args,operationId,signal){
   if(typeof operationId!=='string'||!/^[A-Za-z0-9._:-]{1,100}$/.test(operationId))throw Error('Stable operation identity required');
   let path,body;
   if(command==='act'){path='/v1/edge/act';body={capability:args.capability,params:args.params??{},clientRef:operationId};}
   else if(command==='say'){path='/v1/edge/say';body={text:args.text};}
   else if(command==='converse'){path='/v1/edge/converse';body={op:args.op,...(args.with?{with:args.with}:{}),...(args.conversation?{conversation:args.conversation}:{}),...(args.text?{text:args.text}:{})};}
   else if(command==='ack'){path='/v1/edge/inbox/'+segment(args.id)+'/ack';body={reply:args.reply};}
   else if(command==='result'){path='/v1/edge/inbox/'+segment(args.id)+'/result';body={outcome:args.outcome,text:args.text};}
   else if(command==='remind'){path='/v1/edge/reminders';body={clientRef:operationId,text:args.text,at:args.at};}
   else if(command==='object'){path='/v1/edge/objects/'+segment(args.id)+'/act';body={action:args.action,params:args.params??{}};}
   else throw Error('Unsupported world write');
   return request(path,{method:'POST',body,operationId,signal});
  },
 };
}
