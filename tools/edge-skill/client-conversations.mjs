const CV=/^cv_[A-Za-z0-9_-]{1,40}$/,SOUL=/^s_[A-Za-z0-9_-]{1,100}$/;
const copy=structuredClone,plain=x=>x&&typeof x==='object'&&!Array.isArray(x),text=(x,max)=>typeof x==='string'?x.slice(0,max):null;
const refs=(xs,max=12)=>{if(!Array.isArray(xs)||xs.length>max)throw Error('invalid bounded conversation roster');const out=new Map();for(const x of xs){if(!plain(x)||!SOUL.test(x.soulId)||typeof x.name!=='string')throw Error('invalid conversation Soul reference');out.set(x.soulId,{soulId:x.soulId,name:x.name.slice(0,200),...(x.nameAmbiguous===true?{nameAmbiguous:true}:{})});}return [...out.values()];};
const ids=xs=>xs.map(x=>x.soulId),party=g=>[...new Set([...ids(g.members),...ids(g.invited)])].sort().join('|');
const active=g=>g.state==='open'&&g.attached&&g.role==='member';
const ordinal=id=>typeof id==='string'&&/^c_\d+$/.test(id)&&Number.isSafeInteger(Number(id.slice(2)))?Number(id.slice(2)):null;
/** Pure local bookkeeping of already-entitled own server payloads. No files,
 * auth, network, automatic speech, consent or server-side group coalescing. */
export function openClientConversations({scope,soulId,name=soulId,initial,onChange=()=>{},now=Date.now}={}){
 if(typeof scope!=='string'||!scope||!SOUL.test(soulId))throw Error('conversation scope/Soul required');
 let revision=0;const groups=new Map(),seen=new Set();
 const self={soulId,name:String(name).slice(0,200)};
 const blank=id=>({id,state:'unknown',role:'unknown',attached:false,detached:false,members:[],invited:[],asks:[],asksComplete:false,membersComplete:false,invitedComplete:false,turnCount:null,lastTurn:null,topic:null,departed:[],lastSelfMembershipRevision:0,lastEventOrdinal:null,updatedAt:now(),untrusted:true});
 const get=id=>{if(!CV.test(id))throw Error('invalid conversation ID');if(!groups.has(id)){if(groups.size>=64){const old=[...groups].find(([,g])=>!g.attached);if(!old)throw Error('conversation active limit');groups.delete(old[0]);}groups.set(id,blank(id));}return groups.get(id);};
 const snapshot=()=>({version:1,scope,soulId,revision,groups:copy([...groups.values()])});
 const changed=()=>{revision++;onChange(snapshot());};
 const validateView=v=>{if(!plain(v)||!CV.test(v.id)||!['open','closed'].includes(v.state))throw Error('invalid conversation view');const members=refs(v.members),invited=refs(v.invited,8),asks=v.asks===undefined?[]:refs(v.asks,64);if(ids(members).some(id=>ids(invited).includes(id)))throw Error('member cannot still be invited');const role=v.role??(ids(members).includes(soulId)?'member':ids(invited).includes(soulId)?'invited':ids(asks).includes(soulId)?'asked':'none');if(!['member','invited','asked','none'].includes(role)||role==='member'&&!ids(members).includes(soulId)||role==='invited'&&!ids(invited).includes(soulId)||role==='asked'&&v.asks!==undefined&&!ids(asks).includes(soulId))throw Error('conversation view role mismatch');return {id:v.id,state:v.state,role,members,invited,asks,asksComplete:v.asks!==undefined,membersComplete:true,invitedComplete:true,turnCount:Number.isSafeInteger(v.turns)&&v.turns>=0?v.turns:null,closedReason:text(v.closedReason,200)};};
 const turn=(g,t,source)=>{if(!plain(t)||!Number.isSafeInteger(t.seq)||t.seq<1||!plain(t.from)||!SOUL.test(t.from.soulId)||typeof t.text!=='string')return false;if(g.lastTurn&&t.seq<=g.lastTurn.seq)return false;g.lastTurn={seq:t.seq,tick:Number.isFinite(t.tick)?t.tick:null,at:Number.isFinite(t.at)?t.at:null,from:refs([t.from])[0],text:t.text.slice(0,500),textTruncated:t.text.length>500,source,untrusted:true};g.turnCount=Math.max(g.turnCount??0,t.seq);return true;};
 const applyView=(v,{stale=false}={})=>{const parsed=validateView(v),g=get(v.id);if(!stale){Object.assign(g,parsed);g.attached=g.state==='open'&&['member','invited','asked'].includes(g.role);g.detached=!g.attached;if(g.attached)g.lastSelfMembershipRevision=revision+1;}else{
   // An HTTP response captured before a newer stream event cannot undo a
   // joined/left roster or reopen a closed/local-detached conversation.
   if(g.state==='unknown'&&g.lastEventOrdinal===null){Object.assign(g,parsed);g.attached=g.state==='open'&&g.role!=='none';}else if(g.state==='open'&&g.attached){for(const ref of parsed.invited)if(!ids(g.members).includes(ref.soulId)&&!g.departed.includes(ref.soulId)&&!ids(g.invited).includes(ref.soulId))g.invited.push(ref);}
  }g.updatedAt=now();return g;};
 if(initial!==undefined){if(!plain(initial)||initial.version!==1||initial.scope!==scope||initial.soulId!==soulId||!Array.isArray(initial.groups)||initial.groups.length>64)throw Error('conversation snapshot scope/version mismatch');for(const raw of initial.groups){if(!plain(raw)||!CV.test(raw.id)||!['unknown','open','closed'].includes(raw.state)||!['unknown','member','invited','asked','none','left','declined','expired'].includes(raw.role))throw Error('invalid conversation snapshot');const g=get(raw.id);Object.assign(g,{state:raw.state,role:raw.role,attached:!!raw.attached,detached:!!raw.detached,members:refs(raw.members),invited:refs(raw.invited,8),asks:refs(raw.asks??[],64),asksComplete:!!raw.asksComplete,membersComplete:!!raw.membersComplete,invitedComplete:!!raw.invitedComplete,turnCount:raw.turnCount??null,topic:raw.topic?{text:text(raw.topic.text,200),source:text(raw.topic.source,80),untrusted:true}:null,lastEventOrdinal:Number.isSafeInteger(raw.lastEventOrdinal)?raw.lastEventOrdinal:null});g.lastSelfMembershipRevision=Number.isSafeInteger(raw.lastSelfMembershipRevision)?raw.lastSelfMembershipRevision:0;g.closedReason=text(raw.closedReason,200);g.closedForMe=raw.closedForMe===true;g.detachedReason=text(raw.detachedReason,200);g.updatedAt=Number.isFinite(raw.updatedAt)?raw.updatedAt:now();g.departed=Array.isArray(raw.departed)?raw.departed.filter(id=>SOUL.test(id)).slice(0,32):[];if(raw.lastTurn)turn(g,raw.lastTurn,'retained-own-snapshot');}revision=Number.isSafeInteger(initial.revision)?initial.revision:0;}
 function guard(op,request={}){
  const denied=(code,reason,extra={})=>({allowed:false,code,reason,revision,...extra});
  if(!['start','accept','decline','say','leave','ask'].includes(op))return denied('conversation.invalid','Unknown automated conversation operation.');
  if(op==='start'){
   const withIds=typeof request.with==='string'?[request.with]:request.with;
   if(!Array.isArray(withIds)||withIds.length<1||withIds.length>8||withIds.some(id=>typeof id!=='string'||!SOUL.test(id))||withIds.includes(soulId))return denied('conversation.participant-ids','Start needs1..8 distinct other Soul IDs from current public perception; no name/nearest guess.');
   const wanted=[...new Set([soulId,...withIds])].sort().join('|'),same=[...groups.values()].filter(g=>g.state==='open'&&g.attached&&['member','invited','asked'].includes(g.role)&&[...new Set([...ids(g.members),...ids(g.invited),soulId])].sort().join('|')===wanted),separate=request.separate===true;
   if(!same.length){if([...groups.values()].some(g=>g.attached&&g.state==='open'&&(!g.membersComplete||!g.invitedComplete)||g.state==='unknown'&&g.role==='unknown'&&g.lastTurn))return denied('conversation.context-unknown','An attached party is incomplete; refresh current owned conversation views before starting another group.');return {allowed:true,revision};}
   const existingIds=same.map(g=>g.id).sort();
   if(separate&&typeof request.reason==='string'&&request.reason.trim().length>=3&&request.reason.length<=200&&typeof request.topic==='string'&&request.topic.trim().length>=3&&request.topic.length<=200&&same.length<2&&same.every(g=>g.role==='member')&&same.every(g=>g.topic?.text?.trim().toLowerCase()!==request.topic.trim().toLowerCase()))return {allowed:true,revision,separate:true,reason:request.reason,topic:request.topic};
   return denied(separate?'conversation.separate-policy':'conversation.already-current',separate?'An explicit separate discussion requires a distinct topic/reason and at most one extra current group with this party.':'A current conversation already has this party; no new group or utterance was sent.',{conversation:existingIds[0],existingIds,hint:'Continue explicitly with converse say in the existing ID, or leave it intentionally. Pending invitees still choose their own consent.'});
  }
  if(request.id!==undefined&&request.conversation!==undefined&&request.id!==request.conversation)return denied('conversation.invalid','Request conversation IDs disagree.');
  const id=request.conversation??request.id;if(!CV.test(id??''))return denied('conversation.invalid','A current conversation ID is required.');const g=groups.get(id);
  if(op==='ask')return {allowed:true,revision}; // server owns proximity/admission
  if(!g)return denied('conversation.context-unknown','Current own conversation membership is unknown; refresh the existing owned context before acting.',{conversation:id});
  if(g.state==='closed'||!g.attached)return denied('conversation.not-current','This group is closed or no longer attached to this Soul.',{conversation:id});
  if(op==='say'&&g.role!=='member')return denied('conversation.not-member','Invitation/request is not consented membership; accept or decline independently before speaking.',{conversation:id});
  if(op==='accept'&&g.role==='member')return denied('conversation.already-member','You are already a member; no new acceptance or utterance was sent.',{conversation:id,hint:'Use an explicit converse say if a new substantive turn is warranted.'});
  if(op==='accept'&&g.role!=='invited')return denied('conversation.not-invited','No current invitation to accept; a join request still awaits a member.',{conversation:id});
  if(op==='decline'&&g.role!=='invited'||op==='leave'&&!['member','asked'].includes(g.role))return denied('conversation.not-current','That operation does not match current consent state.',{conversation:id});
  return {allowed:true,revision};
 }
 function response(op,request,result,{revision:beganRevision}={}){
  const accepted=plain(result)&&(result.accepted===true||result.accepted===undefined&&result.ok===true)&&result.ok!==false;
  if(!accepted){const id=typeof result?.conversation==='string'?result.conversation:request.conversation??request.id,g=groups.get(id);if(g&&result?.code==='conversation.closed'){g.state='closed';g.attached=false;changed();}return {recorded:false,accepted:false,code:result?.code??'conversation.refused'};}
  const view=plain(result.conversation)?result.conversation:null,id=view?.id??result.conversation??request.conversation??request.id;if(!CV.test(id??''))return {recorded:false,accepted:true,warning:'Accepted response lacked a canonical conversation ID.'};
  const newerOwnMembership=Number.isSafeInteger(beganRevision)&&(groups.get(id)?.lastSelfMembershipRevision??0)>beganRevision;const stale=Number.isSafeInteger(beganRevision)&&beganRevision!==revision;let g;
  if(view){g=applyView(view,{stale});}else{g=get(id);if(op!=='say')return {recorded:false,accepted:true,conversation:id,warning:'Canonical roster missing; refresh owned context, no open membership invented.'};}
  if(op==='start'&&!g.topic&&typeof(request.topic??request.text)==='string')g.topic={text:(request.topic??request.text).slice(0,200),source:request.separate?'explicit-separate-topic':'accepted-start-opening',untrusted:true};
  if(op==='say'&&typeof request.text==='string'&&plain(result.turn))turn(g,{...result.turn,from:self,text:request.text.trim()},'accepted-own-turn');
  if((op==='leave'||op==='decline')&&!newerOwnMembership){g.role=op==='leave'?'left':'declined';g.attached=false;}
  g.updatedAt=now();changed();return {recorded:true,accepted:true,conversation:id};
 }
 function event(e){
  if(!plain(e)||!['conversation.invite','conversation.member','conversation.turn','conversation.closed'].includes(e.kind)||e.type==='edge'||e.spectator===true)return false;
  let memberRefs=null,actor=null;try{if(e.members!==undefined)memberRefs=refs(e.members);if(e.soul!==undefined)actor=refs([e.soul])[0];if(e.kind==='conversation.turn'&&(!plain(e.turn)||!Number.isSafeInteger(e.turn.seq)||e.turn.seq<1||typeof e.turn.text!=='string'||!plain(e.turn.from)))return false;if(e.kind==='conversation.turn')refs([e.turn.from]);}catch{return false;}
  const id=e.conversation;if(!CV.test(id??''))return false;if(e.id&&seen.has(e.id))return false;const seq=ordinal(e.id),g=get(id);if(seq!==null&&g.lastEventOrdinal!==null&&seq<=g.lastEventOrdinal)return false;
  if(e.id){seen.add(e.id);if(seen.size>512)seen.delete(seen.values().next().value);}if(seq!==null)g.lastEventOrdinal=seq;
  if(e.kind==='conversation.invite'){
   if(g.state==='closed')return false;g.state='open';g.role='invited';g.attached=true;if(memberRefs){g.members=memberRefs;g.membersComplete=true;}g.invited=[...g.invited.filter(x=>x.soulId!==soulId),self];g.invitedComplete=false;if(typeof e.text==='string'&&!g.topic)g.topic={text:e.text.slice(0,200),source:'private-invitation-opening',untrusted:true};
  }else if(e.kind==='conversation.member'){
   if(memberRefs){g.members=memberRefs;g.membersComplete=true;}
   const who=e.soul?.soulId;if(who&&['joined','declined','invite-expired','left','dropped'].includes(e.change)){g.invited=g.invited.filter(x=>x.soulId!==who);g.asks=g.asks.filter(x=>x.soulId!==who);if(['left','dropped','declined','invite-expired'].includes(e.change))g.departed=[...new Set([...g.departed,who])].slice(-32);else g.departed=g.departed.filter(id=>id!==who);}
   if(g.state!=='closed'){g.state='open';if(ids(g.members).includes(soulId)&&(!g.detached||who===soulId&&e.change==='joined'&&e.replay!==true)){g.role='member';g.attached=true;g.detached=false;if(who===soulId&&e.change==='joined'&&e.replay!==true)g.lastSelfMembershipRevision=revision+1;}else if(who===soulId&&['left','dropped','declined','invite-expired'].includes(e.change)){g.role=e.change==='left'||e.change==='dropped'?'left':e.change==='declined'?'declined':'expired';g.attached=false;}}
   if(e.change==='asked'&&e.soul){const asking=actor;g.asks=[...g.asks.filter(x=>x.soulId!==asking.soulId),asking];}
  }else if(e.kind==='conversation.closed'){
   if(['invite-expired','request-expired'].includes(e.reason)&&['invited','asked'].includes(g.role)){g.role='expired';g.attached=false;g.closedForMe=true;}else{g.state='closed';g.attached=false;}g.closedReason=text(e.reason,200);
  }else{
   if(memberRefs){g.members=memberRefs;g.membersComplete=true;}
   if(e.state==='closed'){g.state='closed';g.attached=false;}
   if(g.state!=='closed'&&!g.detached&&e.replay!==true&&!['left','declined','expired'].includes(g.role)){g.state='open';g.role='member';g.attached=true;if(!ids(g.members).includes(soulId)){g.members.push(self);g.membersComplete=false;}}
   turn(g,e.turn,'private-turn');
  }
  g.updatedAt=now();changed();return true;
 }
 function reconcile(list){
  if(!plain(list)||!Array.isArray(list.conversations)||list.conversations.length>64)throw Error('Current owned conversation list required');const parsed=list.conversations.map(validateView),present=new Set(parsed.map(v=>v.id));
  for(const view of list.conversations)applyView(view);
  for(const g of groups.values())if(g.attached&&!present.has(g.id)){g.state='unknown';g.role='none';g.attached=false;g.detached=true;g.detachedReason='absent-current-owned-list; left-or-closed unknown';}
  changed();return snapshot();
 }
 function turns(payload){if(!plain(payload)||!Array.isArray(payload.turns)||payload.turns.length>100)throw Error('Bounded entitled turn response required');const view=validateView(payload.conversation);if(view.role!=='member')throw Error('Turn history requires current own membership');const g=applyView(payload.conversation);for(const t of payload.turns)turn(g,t,'owned-turn-history');changed();return snapshot();}
 function context(){
  const all=[...groups.values()].sort((a,b)=>b.updatedAt-a.updatedAt||a.id.localeCompare(b.id)),attached=all.filter(g=>g.attached),detached=all.filter(g=>!g.attached&&(g.lastTurn||g.topic||g.closedReason));
  const shown=[...attached.slice(0,6),...detached.slice(0,2)],shortRef=r=>({soulId:r.soulId,name:r.name.slice(0,80)});
  const rows=shown.map(g=>({id:g.id,state:g.state,role:g.role,attached:g.attached,members:g.members.map(shortRef),membersComplete:g.membersComplete,invited:g.invited.map(shortRef),invitedComplete:g.invitedComplete,asks:g.asks.slice(0,3).map(shortRef),asksTotal:g.asksComplete?g.asks.length:null,turnCount:g.turnCount,topic:g.topic?{text:g.topic.text?.slice(0,160),untrusted:true}:null,lastTurn:g.lastTurn?{seq:g.lastTurn.seq,from:shortRef(g.lastTurn.from),text:g.lastTurn.text.slice(0,240),textTruncated:!!g.lastTurn.textTruncated||g.lastTurn.text.length>240,untrusted:true}:null,lastTurnComplete:g.turnCount===0&&g.lastTurn===null||g.lastTurn!==null&&g.turnCount===g.lastTurn.seq,consent:{self:g.role,members:g.members.length,invited:g.invited.length,asks:g.asksComplete?g.asks.length:null},...(g.closedReason?{closedReason:g.closedReason.slice(0,100)}:{}),untrusted:true}));
  if(rows.length&&(attached.length>6||detached.length>2))rows[0].contextCoverage={attachedTotal:attached.length,attachedShown:Math.min(6,attached.length),detachedTotal:detached.length,detachedShown:Math.min(2,detached.length)};
  return copy(rows);
 }
 return {guard,response,event,reconcile,turns,snapshot,context};
}
