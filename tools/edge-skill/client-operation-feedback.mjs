// Bounded local write verdicts. Never replay effects or coerce a refused judgment.
const OPERATIONS=new Set(['remember','schedule','compile']);
const SELECTORS=new Set(['person','place','goal','self','none','multiple']);
const clean=(value,max=240)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,max):'';
const ids=entries=>[...new Set((Array.isArray(entries)?entries:[]).map(e=>typeof e==='string'?e:e?.id).filter(id=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/.test(id)))];
export const REMEMBER_FORMAT_HINT='Choose exactly one flat selector: person/place uses a confirmed ID string and note (<=300 chars); goal uses a string ID or title plus top-level note, horizon (today/week/month), metric and next (<=160 chars each); self uses an array of <=20 single-line strings (<=200 chars each). Goal-only horizon/metric/next fields are not allowed on person/place. Never nest fields inside goal. Example: {"goal":"<goal ID or title>","note":"<your judgment>","horizon":"today","metric":"<measurable progress>","next":"<your next step>"}.';
export function rememberSelector(value){const selected=['person','place','goal','self'].filter(k=>value&&Object.hasOwn(value,k));return selected.length===1?selected[0]:selected.length?'multiple':'none';}
const rememberFormat={
 rule:'Exactly one selector; flat fields only, no nested goal object. Judgments do not edit canonical facts. Extra fields refuse.',
 allowedFields:{person:['person:string confirmed Soul ID','note:string <=300'],place:['place:string confirmed place ID','note:string <=300'],goal:['goal:string ID or title','note:string <=300','horizon:today|week|month','metric:string <=160','next:string <=160'],self:['self:array <=20 single-line strings <=200 each']},
 example:{goal:'<goal ID or title>',note:'<your judgment>',horizon:'today',metric:'<measurable progress>',next:'<your next step>'}
};
export function openLocalOperationFeedback({initial=[],onChange=()=>{}}={}){
 let recent=[];
 const normalized=row=>{if(!OPERATIONS.has(row?.operation)||typeof row.accepted!=='boolean')return null;return {operation:row.operation,accepted:row.accepted,code:row.accepted?`local.${row.operation}-saved`:`local.${row.operation}-refused`,reason:clean(row.reason),...(SELECTORS.has(row.selector)?{selector:row.selector}:{})};};
 recent=(Array.isArray(initial)?initial:[]).map(normalized).filter(Boolean).slice(-6);
 return {
  record(row){const value=normalized(row);if(!value)throw Error('invalid local operation verdict');recent.push(value);recent=recent.slice(-6);onChange(structuredClone(recent));return value;},
  snapshot(){return structuredClone(recent);},
  context(entries=[]){if(!recent.length)return null;const current=ids(entries),value={recent:structuredClone(recent),authority:'Actual local write verdicts; refused means not confirmed saved/compiled. Saved bindings have not run. Use syntax only; retain your own judgment and planning.'};
   if(recent.some(r=>r.operation==='remember'&&!r.accepted))value.rememberFormat=rememberFormat;
   if(recent.some(r=>r.operation==='compile'&&!r.accepted))value.compileFormat={shape:'compile:[{id:string,steps:array,leadRealSeconds?:0..3600}]',rule:'Copy only current supplied schedule IDs exactly; unknown IDs refuse; compilation is not execution.',availableScheduleIDs:current.slice(0,8),omittedIDs:Math.max(0,current.length-8),completeIDsSource:'SCHEDULE ENTRIES NEEDING COMPILATION when supplied'};
   return 'LOCAL OPERATION RESULTS '+JSON.stringify(value);
  }
 };
}
