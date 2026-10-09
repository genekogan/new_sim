import {readFileSync,writeFileSync,existsSync,renameSync,lstatSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {openMemoryFolder} from './memory-folder.mjs';
import {currentPlaceAncestors,recordedVisitParent} from './client-place-arrivals.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const safe=path=>{try{if(lstatSync(path).isSymbolicLink())throw Error('linked memory evidence refused');}catch(e){if(e.code!=='ENOENT')throw e;}return path;};
/** Typed adapter: public normalized data only; no HTTP/identity/auth state here. */
export function openClientMemory(directory,{scope,now=()=>new Date().toISOString(),onProblem=()=>{}}){
 const root=realpathSync(directory),file=join(root,'.client-memory-evidence.json');
 let state=existsSync(file)?JSON.parse(readFileSync(safe(file),'utf8')):{scope,times:{},place:null,people:{}};
 if(state.scope!==scope)throw Error('memory belongs to a different world/Soul; use another folder');
 state.refusals??={};
 const memory=openMemoryFolder(root);
 const save=()=>{safe(file);safe(file+'.tmp');writeFileSync(file+'.tmp',JSON.stringify(state)+'\n',{mode:0o600});renameSync(file+'.tmp',file);};
 const timed=(id,body)=>{if(!state.times[id]){state.times[id]=now();save();}return {id,at:state.times[id],...body};};
 const fold=(id,body)=>memory.fold(timed(id,body));
 const refs=references=>{if(references.length)fold('references:'+hash(references),{type:'public.references',references});};
 const observed=place=>{if(place)fold('observed-place:'+hash(place),{type:'place.observed',place:{id:place,name:place}});};
 const coveredParent=place=>{state.coveredParents??=[];if(place&&state.parentDestinations?.includes(place)&&!state.coveredParents.includes(place)){observed(place);fold('arrival-parent:'+hash([scope,place]),{type:'arrival',placeId:place});state.coveredParents.push(place);save();}};
 const api={
  catalogue(cache){const places=cache.places.map(p=>({id:p.id,name:p.name,admittedDestination:p.walkable===true,goodFor:(Array.isArray(p.goodFor)?p.goodFor:typeof p.goodFor==='string'?[p.goodFor]:[]).filter(value=>typeof value==='string'&&value.trim())}));fold('catalogue:'+hash(places),{type:'gazetteer',places});refs(cache.references??[]);state.hierarchy=cache.hierarchy??{};state.parentDestinations=cache.places.filter(p=>p.walkable&&p.kind!=='world'&&p.kind!=='sleeping-mat').map(p=>p.id);save();},
  here(frame){const observationMs=Date.parse(now()),idle=frame.me?.activity?.kind==='idle',previous=state.observation;if(idle&&previous?.idle&&observationMs>previous.at&&observationMs-previous.at<=120000)fold('idle:'+hash([previous.at,observationMs]),{type:'idle.sample',milliseconds:observationMs-previous.at});state.observation={at:observationMs,idle};save();const place=frame.me?.place??null;observed(place);if(place&&place!==state.place){fold('arrival:'+hash([scope,frame.tick,place,state.place]),{type:'arrival',placeId:place});state.place=place;save();}for(const parent of currentPlaceAncestors(place,state.hierarchy).slice(1))coveredParent(parent);},
  terminal(receipt,step){
   if(!['completed','failed','replaced'].includes(receipt.phase))return;
   const out=receipt.outcome??{kind:'act',summary:`${receipt.capability} ${receipt.phase}.`,learned:[],produced:[],met:[],untrusted:false};
   const met=(out.met??[]).map(p=>({id:p.soulId??p.id,name:p.name,where:p.placeId??null}));
   const produced=(out.produced??[]).map(o=>({id:o.id,title:o.title,kind:o.kind,where:o.where??null}));
   observed(receipt.endedAt?.place);for(const where of [...met.map(p=>p.where),...produced.map(o=>o.where)])observed(where);refs((out.learned??[]).map(f=>({id:f.about,kind:'public',name:f.about.slice(0,200),source:f.source})));
   fold('terminal:'+receipt.id,{type:'outcome',receiptId:receipt.id,act:receipt.capability??step.act,phase:receipt.phase,summary:out.summary,untrusted:!!out.untrusted,learned:(out.learned??[]).map(f=>({fact:f.fact,about:f.about,source:f.source,provenance:f.provenance==='authored-content'?'authored-fiction':f.provenance??'world-fact',untrusted:!!f.untrusted})),produced,met,...(receipt.endedAt?.place?{placeId:receipt.endedAt.place}:{})});
   if(receipt.phase==='completed'&&step.fixes&&state.refusals[step.fixes]){const r=state.refusals[step.fixes];fold('lesson:'+receipt.id,{type:'lesson',attempt:r.act,fix:receipt.capability??step.act,refusalId:r.id,successId:'terminal:'+receipt.id});}
   for(const p of met)state.people[p.id]=p.name;
   if(receipt.phase==='completed'&&receipt.endedAt?.place&&receipt.endedAt.place!==state.place){fold('arrival-receipt:'+receipt.id,{type:'arrival',placeId:receipt.endedAt.place});state.place=receipt.endedAt.place;}const parent=recordedVisitParent(receipt);if(parent&&parent!==receipt.endedAt.place)coveredParent(parent);save();
  },
  queue(queue){for(const s of queue.steps){if(s.status==='failed'&&s.code&&!state.refusals[s.id]){const id='refusal:'+s.id;fold(id,{type:'refusal',act:s.act,code:s.code});state.refusals[s.id]={id,act:s.act};save();}}fold('queue:'+hash(queue),{type:'queue',steps:queue.steps.map(s=>({id:s.id,act:s.act,status:['dispatching','stopping'].includes(s.status)?'running':s.status==='superseded'?'cancelled':s.status==='interrupted'?'failed':s.status==='blocked'||s.status==='waiting-condition'?'waiting':s.status,attempts:s.attempts??0,...(s.reason?{reason:s.reason}:{})}))});},
  cost(record){fold('cost:'+hash([record.runId,record.t,record.session,record.reason]),{type:'cost',usd:record.usd??null,modelCalls:1});},
  speech(event){const from=event.from??event.turn?.from,text=event.text??event.turn?.text,personId=from?.soulId??from?.id;if(!personId||!from?.name||!text||!['speech','conversation.turn'].includes(event.kind))return;const eventId=hash(event.id??[event.kind,event.conversation,event.turn?.seq,event.tick,personId,text]),legacy=memory.eventValue('encounter:'+eventId),key='communication:'+eventId,prior=memory.eventValue(key);
   const replayFold=(key,body)=>{const previous=memory.eventValue(key);return previous?memory.fold({...previous,...body}):fold(key,body);};
   if(legacy){if(legacy.type!=='meet'||legacy.person.id!==personId)throw Error('memory: conflicting legacy communication identity');}else replayFold(key,{type:'communication',person:{id:personId,name:prior?.person.name??from.name},channel:event.kind==='conversation.turn'?'private-conversation':'public-speech',recipientPlace:prior?prior.recipientPlace:event.replay?null:state.place,...(event.conversation?{conversationId:event.conversation}:{})});
   state.people[personId]=from.name;state.speakers=[...new Set([personId,...(state.speakers??[])])].slice(0,8);save();if(event.kind==='conversation.turn'&&event.conversation)replayFold('conversation:'+hash([event.conversation,personId]),{type:'conversation',conversationId:event.conversation,personId});replayFold('speech:'+eventId,{type:'speech',personId,text:String(text).slice(0,1000),untrusted:true});},

  scorecard(window){return memory.scorecard({id:'scorecard:'+hash([window.clock,window.period,window.from,window.to]),at:now(),...window});},
  remember(input){
   if(!input)return;const value={...input,id:'judgment:'+hash([input,now()]),at:now()};
   if(value.person&&!state.people[value.person]){const match=Object.entries(state.people).find(([,name])=>name===value.person);if(match)value.person=match[0];}
   if(value.goal&&!/^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/.test(value.goal)){value.note??=value.goal;value.goal='goal:'+hash(value.goal);}
   if(value.goal){value.note??=value.goal;value.horizon??='today';value.metric??='Owner-defined progress';value.next??='Choose a next step';}
   memory.remember(value);
  },
  factualOutcomes(){return memory.factualOutcomes();},
  retrieve(frame,attempt,{recall=false}={}){return memory.retrieve({day:now().slice(0,10),recall,...(frame?.me?.place?{place:frame.me.place}:{}),people:[...new Set([...(frame?.near??[]).map(p=>p.id),...(state.speakers??[])])].slice(0,8),...(attempt?{attempt}:{})})+'\n## Owner schedule — bounded local notes\n'+readFileSync(safe(join(root,'memory','schedule.md')),'utf8').split('\n').slice(0,20).join('\n').slice(0,3000);},
 };
 return api;
}
