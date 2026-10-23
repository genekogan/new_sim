/** 1.9.10 (ACCEPT2 brief 7, A27): a new owner request never runs a step carried over from an earlier request.
 * Live 2026-10-23 04:20:59 (c1): owner "stroll through the gardens"; the mind queued "take a walk through the park",
 * word for word an earlier owner request, and the Soul walked to the park. A body step in an owner wake that repeats an
 * earlier request's words (or one of its world actions) and shares no content word with the new request is replaced by
 * the owner's own words, which the world resolves itself. Steps that echo the new request are never touched. */
const STOP=new Set('the a an to and then of in on at for with by from into onto through around near over up down your my me you it its this that some please can could would will just go do take make have get let lets come back here there now a bit little walk stroll wander run jog head move hike roam visit again'.split(' '));
const norm=s=>String(s??'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const target=s=>/^[a-z-]+:\S+$/i.test(String(s??'').trim())?String(s).trim().replace(/^[^:]+:/,''):s;
const words=s=>norm(target(s)).split(' ').filter(w=>w.length>=3&&!STOP.has(w)).map(w=>w.replace(/(?:ies)$/,'y').replace(/(?<=[a-z]{3})s$/,''));
/** prior: earlier owner requests as {text, acts:[...]} (acts = queued step words and capability ids). */
export function guardStaleOwnerSteps(steps,ownerText,prior=[]){
 const mine=new Set(words(ownerText)),seen=new Set();
 for(const p of prior){if(norm(p.text)&&norm(p.text)!==norm(ownerText))seen.add(norm(p.text));for(const a of p.acts??[])if(norm(a))seen.add(norm(a));}
 const replaced=[];
 const out=steps.map(step=>{
  if(typeof step?.act!=='string'||!seen.has(norm(step.act))||norm(step.act)===norm(ownerText))return step;
  if(words(step.act).some(w=>mine.has(w)))return step;
  replaced.push(step.act);return {...step,act:String(ownerText).trim(),params:{},staleReplaced:step.act};
 });
 return {steps:out,replaced,line:replaced.length?`Dropped ${replaced.length===1?'a step':replaced.length+' steps'} carried over from an earlier request (${replaced.map(a=>`"${a}"`).join(', ')}); acting on your owner's own words instead.`:null};
}
/** Earlier owner requests from the replies file: their words, queued step words and receipt capabilities. */
export function priorOwnerRequests(replies,currentId,limit=20){
 return replies.filter(r=>r&&r.id!==currentId).slice(-limit).map(r=>({text:r.text,acts:[...(r.queue?.id===r.id?(r.queue.steps??[]).flatMap(s=>[s.act,s.receipt?.capability]):[])].filter(Boolean)}));
}
