import {readFileSync,writeFileSync,renameSync,existsSync,lstatSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {parseSchedule,nextReview} from './client-schedule.mjs';
import {clockAt,timePair,routineOccurrences} from './client-cadence.mjs';
import {replySteps} from './client-queue.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const done=s=>['completed','cancelled','skipped','superseded'].includes(s.status);
const safe=path=>{try{const st=lstatSync(path);if(st.isSymbolicLink()||st.isFile()&&st.nlink>1)throw Error('linked cadence file refused');}catch(e){if(e.code!=='ENOENT')throw e;}return path;};
const day=ms=>new Date(ms).toISOString().slice(0,10);
const hhmm=minutes=>{const m=((Math.floor(minutes)%1440)+1440)%1440;return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');};
/** Local cadence coordinator only. The queue owns dispatch/recovery; the server
 * reminder is an advisory timer, never a server plan or a source of body acts. */
export function openClientLiving(directory,{scope,queue,adapter={},now=Date.now,onWake=()=>{},onEvent=()=>{}}){
 const root=resolve(directory),file=join(root,'.client-cadence.json'),schedule=join(root,'memory','schedule.md');safe(root);
 let state=existsSync(safe(file))?JSON.parse(readFileSync(file,'utf8')):{version:1,scope,bindings:{},occurrences:{},reminders:{},reviewCalls:{},reviews:{},pendingReviews:[],lastWorld:null,lastReal:now(),priorityPending:false};
 if(state.version!==1||state.scope!==scope)throw Error('cadence scope/version mismatch');
 state.scoreWorldStart??=state.lastReal;state.worldReviewCalls??={};
 let parsed={routines:[],commitments:[],reviews:[]},text='',digest=null,pumping=null,anchor=null,clock=null;
 const save=()=>{safe(file);safe(file+'.tmp');writeFileSync(file+'.tmp',JSON.stringify(state)+'\n',{mode:0o600});renameSync(file+'.tmp',file);};
 const event=(kind,data)=>onEvent({cadence:{kind,...data}});
 const load=()=>{const next=existsSync(safe(schedule))?readFileSync(schedule,'utf8'):'';const h=hash(next);if(h!==digest){parsed=parseSchedule(next);text=next;digest=h;const ids=new Set([...parsed.routines,...parsed.commitments].map(e=>e.id));for(const o of Object.values(state.occurrences))if(o.status==='pending'&&!ids.has(o.routineId))o.status='cancelled';for(const [key,r] of Object.entries(state.reminders))if(r.id&&r.status==='active'&&!ids.has(key.split('@')[0]))r.cancelPending=true;event('schedule-loaded',{digest,routines:parsed.routines.length,commitments:parsed.commitments.length});}return parsed;};
 const pair=world=>anchor?timePair(anchor,world):{worldMinutes:world,realMs:null,paused:true};
 const card=(clockKind,period,from,to)=>event('scorecard-due',{clock:clockKind,period,from:new Date(from).toISOString(),to:new Date(to).toISOString()});
 const addReview=(key,instruction,clockKind='real')=>{if(state.reviews[key])return;if(clockKind==='world'){for(const old of state.pendingReviews.filter(r=>r.clock==='world'))state.reviews[old.key]='superseded';state.pendingReviews=state.pendingReviews.filter(r=>r.clock!=='world');}state.reviews[key]='pending';state.pendingReviews.push({key,instruction,clock:clockKind});save();event('review-due',{key,clock:clockKind});onWake('review');};
 const refreshClock=value=>{if(!value||!Number.isFinite(value.absoluteWorldMinutes)||!Number.isFinite(value.sampledAtRealMs))return false;const candidate={worldMinutes:value.absoluteWorldMinutes,realMs:value.sampledAtRealMs,realMsPerWorldMinute:value.realMsPerWorldMinute,paused:!!value.paused};try{clockAt(candidate,now());}catch{return false;}clock=structuredClone(value);anchor=candidate;state.clockNotice=null;return true;};
 const requestReminder=async(key,at,instruction)=>{
  const body={clientRef:'cadence-'+hash([scope,key,at,instruction]),text:instruction.slice(0,500),at};const saved=state.reminders[key];if(saved?.id||saved?.retryAt>now())return;
  state.reminders[key]={body,status:'registering'};save();let response;try{response=await adapter.registerReminder?.(body);}catch{}if(response?.id){state.reminders[key]={...state.reminders[key],id:response.id,status:response.state??response.status??'active'};save();event('reminder-registered',{key,id:response.id,at});}else{state.reminders[key].retryAt=now()+60000;save();event('reminder-unavailable',{key});}
 };
 const pendingCompilation=()=>[...parsed.routines,...parsed.commitments].filter(e=>!state.bindings[e.id]).map(e=>({id:e.id,instruction:e.instruction,...(e.durationWorldMinutes?{durationWorldMinutes:e.durationWorldMinutes}:{atRealMs:e.atRealMs}),clock:e.durationWorldMinutes?'world':'real'}));
 async function pump({clock:fresh,paused=false}={}){
  load();if(fresh)refreshClock(fresh);const real=now(),q=queue.snapshot();for(const r of Object.values(state.reminders)){if(!r.cancelPending||r.cancelRetryAt>real)continue;let result;try{result=await adapter.cancelReminder?.(r.id);}catch{}if(result?.cancelled||result?.alreadyDelivered){r.status=result.alreadyDelivered?'delivered':'cancelled';r.cancelPending=false;event('reminder-cancelled',{id:r.id,status:r.status});}else r.cancelRetryAt=real+60000;save();}
  for(const o of Object.values(state.occurrences)){if(o.status==='dispatching'){o.status=q.id===o.key?'queued':[...parsed.routines,...parsed.commitments].some(e=>e.id===o.routineId)?'pending':'cancelled';save();}if(o.status==='queued'&&q.id===o.key){if(q.steps.every(done)){o.status='completed';o.completedRealMs=real;o.deadlinePassed=o.clock==='real'&&real>o.atRealMs;event('occurrence-completed',{key:o.key});}else if(q.steps.some(s=>['failed','interrupted','blocked'].includes(s.status))){o.status='interrupted';event('occurrence-interrupted',{key:o.key});}}}
  if(pendingCompilation().length&&!state.compileNotice){state.compileNotice=true;save();onWake('schedule-compile');}
  if(!pendingCompilation().length)state.compileNotice=false;
  if(anchor){
   let current=clockAt(anchor,real).worldMinutes;const crossingDay=state.lastWorld!==null&&Math.floor(current/1440)>Math.floor(state.lastWorld/1440),crossingRoutine=parsed.routines.some(r=>{const target=Math.floor(current/1440)*1440+r.minute;return state.lastWorld!==null&&target>state.lastWorld&&target<=current;});if((crossingDay||crossingRoutine)&&adapter.refreshClock){const authoritative=await adapter.refreshClock();if(authoritative){refreshClock(authoritative);current=clockAt(anchor,real).worldMinutes;}else{event('world-clock-refresh-unavailable',{});return status();}}
   if(state.lastWorld===null)state.lastWorld=current-1e-6;
   if(current<state.lastWorld){event('clock-rebased',{previous:state.lastWorld,current});state.lastWorld=current;}
   const weekdayMonday=(clock.weekdayUTC+6)%7,epoch=((weekdayMonday-Math.floor(clock.absoluteWorldMinutes/1440)%7)+7)%7;
   if(Number.isInteger(clock.weekdayUTC)){
    const due=routineOccurrences({routines:parsed.routines,fromWorldMinutes:state.lastWorld,toWorldMinutes:current,epochWeekday:epoch,completedKeys:Object.keys(state.occurrences),maxDays:1});
    if(due.truncated)event('offline-window-truncated',{before:due.discardedBeforeWorldMinutes});
    for(const o of due.occurrences){state.occurrences[o.key]={...o,status:current-o.atWorldMinutes>10?'missed':'pending',clock:'world'};event('routine-due',{key:o.key,...pair(o.atWorldMinutes),status:state.occurrences[o.key].status});}
    const before=Math.floor(state.lastWorld/1440),after=Math.floor(current/1440);if(after>before){card('world','world-day-'+(after-1),state.scoreWorldStart??state.lastReal,real);state.scoreWorldStart=real;addReview('world-review@'+after,'Briefly review the completed world day, using its scorecard.','world');}
    state.lastWorld=current;
    for(const r of parsed.routines){const next=routineOccurrences({routines:[r],fromWorldMinutes:current,toWorldMinutes:current+8*1440,epochWeekday:epoch,maxDays:9}).occurrences[0];if(next)await requestReminder(next.key,{clock:'world',worldDayIndex:Math.floor(next.atWorldMinutes/1440),time:hhmm(next.atWorldMinutes)},'Routine due: '+r.instruction);}
   }
  }
  if(day(real)!==day(state.lastReal)){card('real',day(state.lastReal),state.scoreRealStart??Date.parse(day(state.lastReal)+'T00:00:00Z'),real);state.scoreRealStart=real;if(!parsed.reviews.some(r=>r.weekday===null))addReview('daily-review@'+day(real),'Review the completed real day: measurable goal progress, lessons and next steps.');if(new Date(real).getUTCDay()===1&&!parsed.reviews.some(r=>r.weekday!==null))addReview('weekly-review@'+day(real),'Review measurable weekly goal progress, choose next steps and update goal horizons.');}
  for(const r of parsed.reviews){const next=nextReview(r,state.lastReal);if(next.atRealMs<=real)addReview(next.key,next.instruction);}
  for(const c of parsed.commitments){const binding=state.bindings[c.id],lead=(binding?.leadRealSeconds??0)*1000,key=c.id+'@'+c.atRealMs;if(c.atRealMs-lead<=real&&!state.occurrences[key]){state.occurrences[key]={key,routineId:c.id,instruction:c.instruction,atRealMs:c.atRealMs,status:real>c.atRealMs?'missed':'pending',clock:'real'};event('commitment-due',{key,atRealMs:c.atRealMs,worldMinutes:anchor&&!anchor.paused?clockAt(anchor,c.atRealMs).worldMinutes:null});}if(c.atRealMs>real)await requestReminder(key,{clock:'real',time:new Date(c.atRealMs).toISOString()},c.instruction);}
  state.lastReal=real;save();
  if(paused||q.steps.some(s=>!done(s)))return status();
  const occurrence=Object.values(state.occurrences).find(o=>o.status==='pending'&&state.bindings[o.routineId]);if(!occurrence)return status();
  if(occurrence.clock==='world'){
   if(real-clock.sampledAtRealMs>1000){const authoritative=await adapter.refreshClock?.();if(!authoritative||!refreshClock(authoritative)){state.clockNotice='Authoritative world clock refresh unavailable; pending routine not dispatched';save();event('world-clock-refresh-unavailable',{key:occurrence.key});return status();}}if(!clock||!anchor)return status();const actual=clockAt(anchor,now()).worldMinutes;if(actual<occurrence.atWorldMinutes||clock.paused)return status();if(actual-occurrence.atWorldMinutes>10){occurrence.status='missed';save();event('occurrence-missed',{key:occurrence.key});return status();}
  }
  let steps=structuredClone(state.bindings[occurrence.routineId].steps);if(occurrence.clock==='world'){
   if(!(clock.nativeSecondsPerWorldMinute>0)){event('routine-clock-unqualified',{key:occurrence.key});return status();}
   const routine=parsed.routines.find(r=>r.id===occurrence.routineId),seconds=occurrence.durationWorldMinutes*clock.nativeSecondsPerWorldMinute,last=steps.findLastIndex(s=>s.act&&!/^(look|turn|face|glance)\b/i.test(s.act));
   if(last<0)throw Error('routine requires an actual body activity');if(seconds<=600&&!routine?.untilWorldTime){steps[last].for=seconds;delete steps[last].until;}else{delete steps[last].for;steps[last].until={worldMinutes:occurrence.atWorldMinutes+occurrence.durationWorldMinutes};}
  }
  occurrence.status='dispatching';save();
  try{queue.enqueue(steps,{id:occurrence.key,source:occurrence.clock==='world'?'routine':'commitment'});occurrence.status='queued';occurrence.queuedRealMs=now();save();event('occurrence-queued',{key:occurrence.key,clock:occurrence.clock,modelCalls:0});}catch(error){occurrence.status='pending';save();event('occurrence-deferred',{key:occurrence.key,reason:String(error.message).slice(0,160)});}
  return status();
 }
 function status(){load();const real=now(),world=anchor?clockAt(anchor,real).worldMinutes:null;const next=[];
  if(anchor&&Number.isInteger(clock.weekdayUTC)){const weekdayMonday=(clock.weekdayUTC+6)%7,epoch=((weekdayMonday-Math.floor(clock.absoluteWorldMinutes/1440)%7)+7)%7;for(const o of routineOccurrences({routines:parsed.routines,fromWorldMinutes:world,toWorldMinutes:world+8*1440,epochWeekday:epoch,maxDays:9}).occurrences.slice(0,3))next.push({id:o.key,kind:'routine',...pair(o.atWorldMinutes),instruction:o.instruction});}
  for(const c of parsed.commitments.filter(c=>c.atRealMs>=real))next.push({id:c.id,kind:'commitment',realMs:c.atRealMs,worldMinutes:anchor&&!anchor.paused?clockAt(anchor,c.atRealMs).worldMinutes:null,instruction:c.instruction});for(const r of parsed.reviews){const n=nextReview(r,real);next.push({id:n.key,kind:'review',realMs:n.atRealMs,worldMinutes:anchor&&!anchor.paused?clockAt(anchor,n.atRealMs).worldMinutes:null,instruction:n.instruction});}
  next.sort((a,b)=>(a.realMs??Infinity)-(b.realMs??Infinity));return {scheduleHash:digest,clockNotice:state.clockNotice??null,clockSampleAgeMs:clock?real-clock.sampledAtRealMs:null,clockAuthority:clock?(!state.clockNotice&&real-clock.sampledAtRealMs<=1000?'fresh-authoritative-sample':'last-sample-projection; current pause/rate unqualified'):'unavailable',pausedAtSample:anchor?.paused??null,uncompiled:pendingCompilation(),pendingReviews:structuredClone(state.pendingReviews),reviewCallsToday:state.reviewCalls[day(real)]??0,reviewLimit:10,worldReviewLimit:8,worldReviewCallsToday:state.worldReviewCalls[day(real)]??0,priorityPending:state.priorityPending,worldMinutes:world,realMs:real,paused:clock&&!state.clockNotice&&real-clock.sampledAtRealMs<=1000?anchor.paused:null,next:next.slice(0,4).map(e=>({...e,worldDayIndex:Number.isFinite(e.worldMinutes)?Math.floor(e.worldMinutes/1440):null,worldTime:Number.isFinite(e.worldMinutes)?hhmm(e.worldMinutes):null,realTime:Number.isFinite(e.realMs)?new Date(e.realMs).toISOString():null,inWorldMinutes:Number.isFinite(e.worldMinutes)&&world!==null?e.worldMinutes-world:null,inRealSeconds:Number.isFinite(e.realMs)?(e.realMs-real)/1000:null})),nativeSecondsPerWorldMinute:clock?.nativeSecondsPerWorldMinute??null,occurrences:structuredClone(Object.fromEntries(Object.entries(state.occurrences).slice(-8))),occurrenceHistoryShown:8,occurrencesTotal:Object.keys(state.occurrences).length};
 }
 return {pump(options){if(!pumping)pumping=pump(options).finally(()=>{pumping=null;});return pumping;},status,refreshClock,
  needsWorldClock(steps=[]){load();const hold=steps.find(s=>!done(s))?.until;return parsed.routines.length>0||Object.values(state.occurrences).some(o=>o.clock==='world'&&['pending','dispatching'].includes(o.status))||!!(hold&&(hold.worldTime!==undefined||hold.worldMinutes!==undefined));},
  clockUnavailable(message='Authoritative clock refresh unavailable; only last-sample projection remains'){state.clockNotice=message;save();},
  compile(bindings){load();if(!Array.isArray(bindings)||bindings.length>64)throw Error('bounded compiled bindings required');for(const b of bindings){if(![...parsed.routines,...parsed.commitments].some(e=>e.id===b.id))throw Error('unknown schedule binding');const steps=replySteps({do:b.steps});if(!steps.length)throw Error('compiled binding needs steps');if(b.leadRealSeconds!==undefined&&(!Number.isFinite(b.leadRealSeconds)||b.leadRealSeconds<0||b.leadRealSeconds>3600))throw Error('lead must be0..3600 real seconds');state.bindings[b.id]={steps,leadRealSeconds:b.leadRealSeconds??0};}state.compileNotice=false;save();},
  setSchedule(value,expectedHash){load();if(expectedHash!==digest)throw Error('owner schedule changed during decision; reload before writing');parseSchedule(value);safe(schedule);safe(schedule+'.tmp');writeFileSync(schedule+'.tmp',value,{mode:0o600});renameSync(schedule+'.tmp',schedule);digest=null;load();save();},
  prioritiesChanged(){state.priorityPending=true;save();},
  nextReview(){load();if((state.reviewCalls[day(now())]??0)>=10)return null;return state.pendingReviews.find(r=>r.clock!=='world')??((state.worldReviewCalls[day(now())]??0)<8?state.pendingReviews.find(r=>r.clock==='world'):null)??(pendingCompilation().length?{key:'compile@'+digest,instruction:'Compile the listed schedule entries into public queue steps once. Do not execute them now.',clock:'real',compile:true}:null);},
  reserveReview(task){const d=day(now()),count=state.reviewCalls[d]??0;if(count>=10||task.clock==='world'&&(state.worldReviewCalls[d]??0)>=8){event('review-budget-exhausted',{key:task.key});return false;}state.reviewCalls[d]=count+1;if(task.clock==='world')state.worldReviewCalls[d]=(state.worldReviewCalls[d]??0)+1;save();return true;},
  completeReview(task){state.reviews[task.key]='completed';state.pendingReviews=state.pendingReviews.filter(r=>r.key!==task.key);if(!task.compile)state.priorityPending=false;save();},
  event(e){if(e.kind==='reminder.due'){if(e.dueClocks)refreshClock(e.dueClocks);const own=Object.values(state.reminders).find(r=>r.id===e.reminder?.id&&r.body.clientRef===e.reminder?.clientRef);if(own){own.status='delivered';save();}event('reminder-received',{id:e.reminder?.id??null,clientRef:e.reminder?.clientRef??null});onWake('cadence-due');}},
 };
}
