import {humanActivity} from './human-activity.ts';
/** Current owner status options are suggestions, never commands or promises. */
export function availableActionLabels(raw:unknown):string[]{
 if(!Array.isArray(raw))return [];
 const labels:string[]=[],seen=new Set<string>();
 for(const item of raw){
  if(!item||typeof item!=='object'||typeof item.id!=='string'||typeof item.label!=='string'||!item.id.trim()||!item.label.trim()||item.label.length>200||seen.has(item.id))continue;
  seen.add(item.id);labels.push(item.label);if(labels.length===8)break;
 }
 return labels;
}
export function AvailableActions({options,onChoose,disabled=false,summary='What could I ask for?',soulId}:{options:unknown;onChoose?(label:string):void;disabled?:boolean;summary?:string;soulId?:string}){
 const labels=availableActionLabels(options);
 if(!labels.length)return null;
 return <details className="playing-help"><summary>{summary}</summary>
  <p>Options from your Soul’s latest status. {onChoose?'Choose one to start an empty draft, then edit it or send when ready. Clear existing text before choosing another.':'Describe one in your own words above.'} These can change as the world moves; a listed option is not a promise that it will happen.</p>
  <ul>{labels.map((label,index)=><li key={index}>{onChoose?<button type="button" disabled={disabled} onClick={()=>onChoose(label)}>{humanActivity(label,soulId).label}</button>:humanActivity(label,soulId).label}</li>)}</ul>
 </details>;
}
