// LINK (spec SOUL-LINK r3, COMMON-LINK §2): one state for a Soul's agent and body, read defensively.
// The server fields (`link` on the owner inbox, `body` and `now` on the public Soul) land in parallel lanes, so every
// reader here accepts absent or malformed values and falls back to today's presence; nothing here throws.
// All text from the server is untrusted and rendered as text only.
import {clockAt,type AgentHere} from './agent-presence.ts';

export type LinkState='pairing'|'connected'|'disconnected';
export type LinkReason='listening'|'pending-approval'|'approved-waiting'|'stopped-listening'|'replaced'|'revoked'|'never';
export type Link={state:LinkState;reason:LinkReason;since:number|null;holder:{label:string|null;since:number|null}|null;approvalId?:string};
export type BodyState='awake'|'idle'|'zombie'|'asleep';
export type BodyDoing='standing'|'sitting'|'dozing'|'drifting'|'floating';
export type Body={state:BodyState;doing:BodyDoing|null;since:number};
export type Now={text:string;at:number};

const STATES:readonly LinkState[]=['pairing','connected','disconnected'];
const REASONS:readonly LinkReason[]=['listening','pending-approval','approved-waiting','stopped-listening','replaced','revoked','never'];
const BODIES:readonly BodyState[]=['awake','idle','zombie','asleep'];
const DOINGS:readonly BodyDoing[]=['standing','sitting','dozing','drifting','floating'];
const obj=(v:unknown):Record<string,unknown>|null=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
const time=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>0?v:null;
const label=(v:unknown)=>typeof v==='string'&&v.trim()?v.trim().slice(0,80):null;

export function readLink(raw:unknown):Link|null{
 const d=obj(raw);if(!d||!STATES.includes(d.state as LinkState))return null;
 const state=d.state as LinkState,reason=REASONS.includes(d.reason as LinkReason)?d.reason as LinkReason:state==='connected'?'listening':state==='pairing'?'pending-approval':'stopped-listening';
 const h=obj(d.holder),approvalId=typeof d.approvalId==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(d.approvalId)?d.approvalId:undefined;
 return {state,reason,since:time(d.since),holder:h?{label:label(h.label),since:time(h.since)}:null,...(approvalId?{approvalId}:{})};
}
export function readBody(raw:unknown):Body|null{
 const d=obj(raw);if(!d||!BODIES.includes(d.state as BodyState))return null;
 return {state:d.state as BodyState,doing:DOINGS.includes(d.doing as BodyDoing)?d.doing as BodyDoing:null,since:time(d.since)??0};
}
/** ≤140 chars after trim, control characters stripped (the server does the same; this is the viewer's own guard). */
export function readNow(raw:unknown):Now|null{
 const d=obj(raw);if(!d||typeof d.text!=='string')return null;
 // eslint-disable-next-line no-control-regex
 const text=d.text.replace(/[\u0000-\u001f\u007f-\u009f]+/g,' ').replace(/\s{2,}/g,' ').trim().slice(0,140).trimEnd();
 return text?{text,at:time(d.at)??0}:null;
}
/** The newest of several sources (replica, public record, stream event): a later `since`/`at` wins. */
export function newest<T extends {since?:number;at?:number}>(...xs:(T|null|undefined)[]):T|null{
 let best:T|null=null;for(const x of xs)if(x&&(!best||(x.since??x.at??0)>(best.since??best.at??0)))best=x;return best;
}

/** The owner's one state. `link` wins; without it (an older server) today's presence decides; null = not known yet. */
export function ownerLink(link:Link|null,here:AgentHere|null):Link|null{
 if(link)return link;
 if(!here)return null;
 if(!here.away)return {state:'connected',reason:'listening',since:here.since,holder:null};
 return {state:'disconnected',reason:here.since==null?'never':'stopped-listening',since:here.since,holder:null};
}

/** "the pond" as the card says it: the most specific named place in the public record's path. */
export const placeOf=(path:readonly {name?:string}[]|undefined)=>path?.map(p=>p.name?.trim()).filter((n):n is string=>!!n)[0]??null;
const by=(place:string|null)=>place?` by ${place}`:'';
const sinceText=(at:number|null|undefined,now:number)=>at?` since ${clockAt(at,now)}`:'';
/** The dim slot next to the status word. Connected and directed: "at the pond"; idle: "dozing by the pond";
 * zombie: "zombie, wandering by the pond since 14:02"; asleep: "asleep by the pond since 14:02" (floating: "asleep, floating …"). */
export function bodyPhrase(body:Body|null,place:string|null,now=Date.now()):string{
 if(!body||body.state==='awake')return place?`at ${place}`:'';
 if(body.state==='idle')return body.doing?`${body.doing}${by(place)}`:place?`at ${place}`:'';
 if(body.state==='zombie')return `zombie, wandering${by(place)}${sinceText(body.since,now)}`;
 return `asleep${body.doing==='floating'?', floating':''}${by(place)}${sinceText(body.since,now)}`;
}
/** Visitors (and Explore rows) say Awake / Zombie / Asleep; an idle body is awake. */
export function bodyWord(body:Body|null):'Awake'|'Zombie'|'Asleep'|null{
 return !body?null:body.state==='zombie'?'Zombie':body.state==='asleep'?'Asleep':'Awake';
}
/** The visitor's dim slot: same as the owner's without repeating the word ("by the pond since 14:02"). */
export function visitorPhrase(body:Body|null,place:string|null,now=Date.now()):string{
 if(!body||body.state==='awake')return place?`at ${place}`:'';
 if(body.state==='idle')return body.doing?`${body.doing}${by(place)}`:place?`at ${place}`:'';
 if(body.state==='zombie')return `wandering${by(place)}${sinceText(body.since,now)}`.trim();
 return `${body.doing==='floating'?'floating':''}${by(place)}${sinceText(body.since,now)}`.trim();
}
/** "3 min ago" / "2 h ago" / "yesterday" / "Oct 21". */
export function ageText(at:number,now=Date.now()){
 const m=Math.round((now-at)/60_000);
 if(m<1)return 'just now';if(m<60)return `${m} min ago`;if(m<24*60)return `${Math.round(m/60)} h ago`;
 if(m<48*60)return 'yesterday';return new Date(at).toLocaleDateString([],{month:'short',day:'numeric'});
}
/** The Reconnect box's two lines: `why` (the dim reason) and `ask`, the same stem for every reason. */
export function reconnectSentence(name:string,link:Link,now=Date.now()):{why:string;ask:string}{
 const at=link.since?` at ${clockAt(link.since,now)}`:'';
 const why=link.reason==='replaced'?`Another session took over${at}, then stopped.`
  :link.reason==='revoked'?`You disconnected the agent${at}.`
  :link.reason==='never'?'No agent has connected yet.'
  :link.reason==='approved-waiting'?'The agent never started listening.'
  :'The agent stopped listening.';
 return {why,ask:`Reconnect to ${name} by prompting your agent:`};
}
/** The link details' second line under "Held by your agent": "eden-agent 1.9.16 · paired 14:02 · listening now".
 * Owner terms, never a bare internal label: an eden-agent label is the client's name; any other grant label is quoted
 * as where the agent connected from ("from “travel”"). */
export const holderClient=(label:string)=>/^eden-agent(\s|$)/.test(label)?label:`from “${label}”`;
export function holderLine(link:Link,here:AgentHere|null,now=Date.now()){
 const parts:string[]=[];
 if(link.holder?.label)parts.push(holderClient(link.holder.label));
 const paired=link.holder?.since??null;if(paired)parts.push(`paired ${clockAt(paired,now)}`);
 parts.push(here?.state==='working'?'working through your messages':'listening now');
 return parts.join(' · ');
}
/** Approved-waiting offers the prompt again only after a minute. */
export const WAITING_PROMPT_MS=60_000;
/** The spectator stream's `{kind:'body', soulId, state, doing, since}` events: the newest per Soul. */
export function bodiesFromEvents(messages:readonly {kind?:string;[k:string]:unknown}[]):Map<string,Body>{
 const out=new Map<string,Body>();
 for(const m of messages){if(m.kind!=='body'||typeof m.soulId!=='string')continue;const b=readBody(m);if(b)out.set(m.soulId,b);}
 return out;
}
