import type {PlayView,TalkLine} from '@sim/protocol';
type PublicActivity={key:string;tick:number;kind:'action'|'words';title:string;detail:string;raw:string|null};
const uint=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
const text=(value:unknown,max:number):value is string=>typeof value==='string'&&!!value.trim()&&value.length<=max;
/** Public wire records only. Tick ordering never establishes causality between streams. */
export function publicSoulActivity(soulId:string,plays:readonly PlayView[],talk:readonly TalkLine[]):PublicActivity[]{
 const rows=new Map<string,PublicActivity>();
 for(const p of plays){
  if(!p||p.soulId!==soulId||!uint(p.seq)||!uint(p.tick)||!text(p.card,200)||typeof p.ok!=='boolean')continue;
  const target=text(p.targetName,200)?` · ${p.targetName}`:'';
  rows.set('play:'+p.seq,{key:'play:'+p.seq,tick:p.tick,kind:'action',title:p.ok?'Recorded action':'Action refused',detail:p.card+target,raw:p.ok?null:text(p.reason,2000)?p.reason:null});
 }
 for(const t of talk){
  if(!t||(t.from!==soulId&&t.to!==soulId)||!uint(t.id)||!uint(t.tick)||!text(t.text,4000))continue;
  const outgoing=t.from===soulId,name=outgoing?t.toName:t.fromName;
  rows.set('talk:'+t.id,{key:'talk:'+t.id,tick:t.tick,kind:'words',title:`Public words ${outgoing?'to':'from'} ${text(name,200)?name:'someone'}`,detail:t.text.length>240?t.text.slice(0,240)+'…':t.text,raw:t.text.length>240?t.text:null});
 }
 return [...rows.values()].sort((a,b)=>b.tick-a.tick||a.key.localeCompare(b.key)).slice(0,8);
}
export function PublicSoulActivity({soulId,plays,talk}:{soulId:string;plays:readonly PlayView[];talk:readonly TalkLine[]}){
 const rows=publicSoulActivity(soulId,plays,talk);
 return <section aria-label="Public Soul activity"><h2>Recent public activity</h2>
  <p className="small dim">From the public action and conversation records available here. This is a recent window, not a complete history or proof a whole direction was fulfilled. Entries at the same tick do not establish their order.</p>
  {rows.length?<ol className="human-history">{rows.map(row=><li key={row.key}><b>{row.title}</b><p>{row.detail}</p><details><summary>Public record details</summary><p className="small dim">{row.kind==='words'?'Words':'Action'} · tick {row.tick}</p>{row.raw&&<p>{row.raw}</p>}</details></li>)}</ol>:<p className="dim">No public activity in the available records yet.</p>}
 </section>;
}
