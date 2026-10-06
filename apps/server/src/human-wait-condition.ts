import type {WorldHost,Mind} from './world.ts';
import type {WorldState as NativeWorld} from '../../../mars/viewer/engine/world/types.ts';
/** Temporary native obstacles an accepted owner goal can wait through. Reading
 * them never stops, clears or poses a body; the ordinary controller acts later. */
const WAITABLE=new Set(['program.safe-stop-required','program.safe-stop-pending','construction.committed','activity.readiness-committed','shore.occupied-route']);
export type HumanWaitConditionV1={code:string;condition:'quiet-renewal'|'asleep'|'seated'|'moving'|'busy'|'route-busy'|'world-settling';explanation:string};
export type HumanBodyStateV1={programId:string|null;action:{verb:string;status:string;phase?:string}|null;activity:string|null;asleep:boolean;seated:boolean;moving:boolean;quietRenewal:boolean;worldResumable:boolean|null};
const MOVING=new Set(['walk_to','commons_shore_travel','ambient_wander','swim_to','wade_to']);
/** Read-only own-body summary. No other body, owner or private fact is read. */
export function humanBodyStateV1(host:WorldHost,m:Mind):HumanBodyStateV1|null{
 const body=(host.engine.world as NativeWorld).entities[m.entityId];if(!body?.human)return null;
 const programId=host.engine.programOf(m.entityId),read=programId?host.engine.programAction?.(programId):null,action=read&&read.actor===m.entityId?{verb:read.action.verb,status:read.action.status,...(read.action.phase?{phase:read.action.phase}:{})}:null;
 const activity=typeof body.human.activity==='string'?body.human.activity:null;
 return {programId,action,activity,asleep:!!body.human.sleepPose||action?.verb==='sleep',seated:activity==='sit'||action?.verb==='sit',moving:!!action&&MOVING.has(action.verb)||activity==='walk'||activity==='swim'||activity==='wade',quietRenewal:host.quietBarrier,worldResumable:host.engine.canSnapshot?host.engine.canSnapshot():null};
}
export function humanWaitConditionV1(host:WorldHost,m:Mind,code:string|undefined):HumanWaitConditionV1|null{
 if(!code||!WAITABLE.has(code))return null;const s=humanBodyStateV1(host,m);if(!s)return null;const who=m.name;
 if(code==='construction.committed'||code==='activity.readiness-committed')return {code,condition:'busy',explanation:`${who} is committed to ${code==='construction.committed'?'a construction step':'a starting lecture'} and will continue once that commitment ends.`};
 if(code==='shore.occupied-route'&&!s.quietRenewal&&!s.asleep)return {code,condition:'route-busy',explanation:`Other residents are in the way on the shore route right now; ${who} will go in as soon as the way clears.`};
 if(s.quietRenewal)return {code,condition:'quiet-renewal',explanation:`${who} ${s.asleep?'is asleep while':'is waiting while'} Eden quietly renews before first light; this starts as soon as renewal finishes.`};
 if(s.asleep)return {code,condition:'asleep',explanation:`${who} is asleep and will get up as soon as it is safe to rise (at the latest when this sleep ends), then continue.`};
 if(s.seated)return {code,condition:'seated',explanation:`${who} is seated and will stand safely first.`};
 if(s.moving)return {code,condition:'moving',explanation:`${who} is finishing the current movement to safe footing first.`};
 return {code,condition:'world-settling',explanation:`${who} is waiting for the current activity to reach a safe stopping point first.`};
}
/** Specific owner-facing words for a supported binding that cannot wait. */
export function humanBlockedExplanationV1(code:string|undefined,label:string):string{
 const what=label.slice(0,120);
 if(!code||code==='physical.unavailable')return `${what} is supported, but it is physically unavailable right now.`;
 if(/occupied|claimed|held/.test(code))return `${what} is supported, but someone else is using it right now (${code}).`;
 if(/path|route|unreachable|navigation/.test(code))return `${what} is supported, but no walkable route reaches it from here right now (${code}).`;
 return `${what} is supported, but the world blocks it right now (${code}).`;
}
