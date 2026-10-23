/** Owner answers are never cut mid-sentence. 4,000 characters holds a full hourly
 * check-in; anything longer is cut at the last sentence end that fits and marked. */
export const OWNER_ANSWER_MAX=4000;
export function ownerAnswerText(text,max=OWNER_ANSWER_MAX){
 if(typeof text!=='string')return text??null;
 const value=text.trim();if(value.length<=max)return value;
 const head=value.slice(0,max-2),ends=[...head.matchAll(/[.!?](?=\s|$)|;(?=\s)/g)],end=ends.at(-1)?.index;
 return (end>max/2?head.slice(0,end+1):head.replace(/\s+\S*$/,''))+' …';
}
/** The owner report is private. Used only in the wake right after an owner request's
 * own queue finished (the report-due wake): if the mind gave no "owner" text, its bare
 * say steps are the report it meant for its owner, so they go to the owner channel
 * instead of being spoken. With "owner" text present, says stay public as the mind chose. */
export function routeOwnerReport(steps,owner){
 if(typeof owner==='string'&&owner.trim())return {steps,owner,routed:0};
 const report=steps.filter(s=>typeof s?.say==='string'&&s.say.trim()&&!s.act&&!s.converse);
 if(!report.length)return {steps,owner,routed:0};
 return {steps:steps.filter(s=>!report.includes(s)),owner:report.map(s=>s.say.trim()).join(' '),routed:report.length,
  line:`Report sent to your owner privately, not said aloud (${report.length} say step${report.length===1?'':'s'}). Put owner reports in "owner".`};
}
/** Local persistence is distinct from both a model's factual report and world
 * execution. Body/refusal verdicts already qualified by the caller take priority. */
export function ownerReplyWithLocalResults({answer,source,results=[],localResults=[]}={}){
 const verdict=()=>({answer:ownerAnswerText(results.join('; ')),source:'execution-verdict'});
 if(source==='execution-verdict'||typeof answer!=='string'||!answer.trim())return verdict();
 const scheduled=localResults.some(r=>r.operation==='schedule'||r.operation==='compile');
 let report=answer.trim();
 if(scheduled){
  // A local saved binding cannot establish that its future world action ran.
  const unsupported=/\b(?:schedule|routine|bindings?|commitment)\b[^.!?\n]{0,80}\b(?:ran|executed|completed|finished|happened)\b|\b(?:ran|executed|completed|finished)\b[^.!?\n]{0,80}\b(?:schedule|routine|bindings?|commitment)\b/i;
  report=report.split(/(?<=[.!?])\s+|\n+/).filter(clause=>!unsupported.test(clause)).join(' ');
 }
 const warnings=localResults.filter(r=>r.accepted===false||r.operation==='schedule'||r.operation==='compile').map(r=>r.line);
 if(scheduled)warnings.push('Saving a local schedule or binding does not confirm execution.');
 if(!report)return verdict();
 // Keep the authoritative failure visible before an independent report.
 const prefix=warnings.length?warnings.join('; ')+' Model report (unverified): ':'';
 return {answer:ownerAnswerText(prefix+report),source:'model-unverified'};
}
/** 1.9.10 (ACCEPT2 brief 8): owner-facing words never carry queue bookkeeping (queue ids
 * "req-…", receipt ids "r_…", the word "queue"). The mind still sees the raw result lines;
 * only what the owner reads is turned into plain words from the same receipt facts. */
const PHASE_WORDS={started:'under way',running:'under way',waiting:'waiting to start',completed:'done',ended:'done',refused:'refused',replaced:'replaced by something newer',cancelled:'cancelled',failed:'failed'};
export function ownerPlainLine(line){
 if(typeof line!=='string')return line;
 let text=line.replace(/Retained (\d+) ordered steps? in queue \S+?; (?:actual receipt \S+ is (\w+)|physical admission not yet confirmed)\. Future steps are pending, not already accepted or completed\./g,(_,n,phase)=>{
  const steps=Number(n),what=steps===1?'it':`the first of ${steps} steps`;
  // A waiting or unsuccessful canonical phase does not establish that the action ever started.
  if(phase==='waiting')return `I've asked to start ${what}; it is waiting to start.${steps>1?' The rest have not run yet.':''}`;
  if(phase==='replaced')return `The action was replaced by something newer.${steps>1?' The rest have not run yet.':''}`;
  if(['refused','failed','cancelled'].includes(phase))return `${phase==='refused'?`I couldn't start ${what}; it was refused`:`The action ${phase==='cancelled'?'was cancelled':'failed'}`}.${steps>1?' The rest have not run yet.':''}`;
  return ['started','running','completed','ended'].includes(phase)?`I've started ${what}; it is ${PHASE_WORDS[phase]??phase}.${steps>1?' The rest follow in order.':''}`:`I've asked to start ${what}; it has not begun yet.${steps>1?' The rest follow in order.':''}`;
 });
 text=text.replace(/\bQueue req-[A-Za-z0-9_-]+ retained, but (.+?) (?:failed|blocked): ([A-Za-z0-9_.-]+)\. Dependent public steps have not run\./g,(_,what,code)=>`I couldn't ${what.replace(/^(?:[a-z-]+):/,'')} (${code.replace(/[._-]+/g,' ')}). Nothing after it ran.`);
 text=text.replace(/(^|[.;!?]\s+)queue:? req-[A-Za-z0-9_-]+/gi,'$1Your request');
 text=text.replace(/\s*\(?\b(?:actual |final )?receipt:? r_[A-Za-z0-9_-]+\)?/gi,'').replace(/\s*\b(?:in |from |of )?(?:the )?queue:? req-[A-Za-z0-9_-]+/gi,'').replace(/\breq-[A-Za-z0-9_-]+/g,'your request').replace(/\br_[A-Za-z0-9_-]+/g,'it')
  .replace(/\bqueued\b/gi,'lined up').replace(/\bqueues?\b/gi,'plan');
 return text.replace(/\s+([;,.])/g,'$1').replace(/\s{2,}/g,' ').trim();
}
